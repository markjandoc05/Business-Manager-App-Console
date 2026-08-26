import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { buildOrganizationLicenseMirror, canonicalLicensePath, compareOrganizationLicenseMirror, enforcementMirrors, parseCanonicalLicense, resolveCanonicalLicense } from '../lib/license-contract.ts';
import { deriveLicenseAdminState, deriveOrganizationAdminState } from '../lib/server/license-admin-state.ts';
import { resolveOrganizationLocaleSettingsFromData } from '../lib/server/organization-locale-settings.ts';
import { loadLicenseMirrorState } from '../lib/license-mirror.ts';

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const license = (status, end = future) => {
  const startedAt = new Date(new Date(end).getTime() - 86_400_000).toISOString();
  return { plan: status === 'TRIAL' ? 'TRIAL' : 'TEAM', status, maxUsers: 3, features: { crm: true }, trialStartedAt: status === 'TRIAL' ? startedAt : undefined, trialEndsAt: status === 'TRIAL' ? end : undefined, subscriptionStartedAt: status === 'ACTIVE' ? startedAt : undefined, subscriptionEndsAt: status === 'ACTIVE' ? end : undefined };
};

function fakeFirestore(organizationData, canonicalData, canonicalExists = true) {
  const organizationRef = { collection: () => ({ doc: () => ({ get: async () => ({ exists: canonicalExists, data: () => canonicalData }) }) }), get: async () => ({ exists: true, data: () => organizationData }) };
  return { collection: () => ({ doc: () => organizationRef }) };
}

test('canonical reader path is the nested current license document', () => {
  assert.equal(canonicalLicensePath('org-a'), 'organizations/org-a/license/current');
  assert.match(fs.readFileSync(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8'), /collection\('license'\)\.doc\('current'\)/);
  assert.doesNotMatch(fs.readFileSync(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8'), /data\.license\b/);
});

test('malformed or missing canonical licenses are safe and non-writable', () => {
  assert.equal(parseCanonicalLicense({ status: 'ACTIVE', plan: 'TEAM' }), null);
  assert.equal(parseCanonicalLicense({ status: 'EXPIRED', plan: 'TEAM', maxUsers: 3, subscriptionEndsAt: 'not-a-date' }), null);
  assert.equal(parseCanonicalLicense({ status: 'SUSPENDED', plan: 'TEAM', maxUsers: 3, features: { crm: 'yes' } }), null);
  assert.equal(parseCanonicalLicense({ ...license('ACTIVE'), subscriptionStartedAt: future, subscriptionEndsAt: past }), null);
  assert.equal(resolveCanonicalLicense(null).canWrite, false);
  assert.equal(resolveCanonicalLicense(null).status, 'UNKNOWN');
});

test('the server action resolver distinguishes document state and lifecycle actions', () => {
  const now = Date.now();
  const trial = { ...license('TRIAL', new Date(now + 10 * 86_400_000).toISOString()) };
  const active = { ...license('ACTIVE', new Date(now + 30 * 86_400_000).toISOString()) };
  const expired = { ...license('ACTIVE', new Date(now - 86_400_000).toISOString()) };
  const suspended = { ...active, status: 'SUSPENDED' };

  assert.deepEqual(deriveLicenseAdminState(undefined, 0, now), {
    documentState: 'NO_LICENSE', status: 'UNKNOWN', plan: null, activeMembers: 0, maxUsers: null, daysRemaining: null, expiresAt: null, allowedActions: ['ACTIVATE'],
  });
  assert.equal(deriveLicenseAdminState({ plan: 'TEAM', status: 'ACTIVE' }, 0, now).documentState, 'INVALID_LICENSE');
  assert.deepEqual(deriveLicenseAdminState(trial, 2, now).allowedActions, ['EDIT_LICENSE_DETAILS', 'EXTEND_TRIAL', 'CONVERT_TO_PAID', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE']);
  assert.deepEqual(deriveLicenseAdminState(active, 2, now).allowedActions, ['EDIT_LICENSE_DETAILS', 'EXTEND_SUBSCRIPTION', 'RENEW', 'CHANGE_PLAN', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE']);
  assert.deepEqual(deriveLicenseAdminState(expired, 2, now).allowedActions, ['EDIT_LICENSE_DETAILS', 'RENEW']);
  assert.deepEqual(deriveLicenseAdminState(suspended, 2, now).allowedActions, ['EDIT_LICENSE_DETAILS', 'REACTIVATE', 'RENEW', 'CHANGE_SEAT_LIMIT']);
});

test('ACTIVE, SUSPENDED, and EXPIRED produce the Client App enforcement semantics', () => {
  assert.deepEqual(enforcementMirrors(parseCanonicalLicense(license('ACTIVE')), Date.now()), { licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: parseCanonicalLicense(license('ACTIVE')).subscriptionEndsAt });
  assert.deepEqual(enforcementMirrors(parseCanonicalLicense(license('SUSPENDED')), Date.now()), { licenseStatus: 'SUSPENDED', licenseWriteEnabled: false, licenseExpiresAt: null });
  assert.deepEqual(enforcementMirrors(parseCanonicalLicense(license('EXPIRED')), Date.now()), { licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null });
});

test('TRIAL expiration overrides status and disables writes', () => {
  const trial = parseCanonicalLicense(license('TRIAL', past));
  const resolved = resolveCanonicalLicense(trial);
  assert.equal(resolved.status, 'EXPIRED');
  assert.equal(resolved.canWrite, false);
});

test('ACTIVE expiration overrides status and disables writes', () => {
  const active = parseCanonicalLicense(license('ACTIVE', past));
  assert.equal(resolveCanonicalLicense(active).status, 'EXPIRED');
  assert.deepEqual(enforcementMirrors(active), { licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null });
});

test('expiration is inclusive at the exact boundary and denies writes after it', () => {
  const endsAt = new Date('2027-01-01T00:00:00.000Z');
  const active = parseCanonicalLicense(license('ACTIVE', endsAt.toISOString()));
  assert.equal(resolveCanonicalLicense(active, endsAt.getTime()).canWrite, true);
  assert.equal(resolveCanonicalLicense(active, endsAt.getTime() + 1).canWrite, false);
});

test('platform license mutations require trusted server authorization and exclude tenant roles', () => {
  const handler = fs.readFileSync(new URL('../lib/server/license-handler.ts', import.meta.url), 'utf8');
  const auth = fs.readFileSync(new URL('../lib/server/platform-admin.ts', import.meta.url), 'utf8');
  assert.match(handler, /requirePlatformAdminToken\(idToken, \['SUPER_ADMIN'\]\)/);
  assert.match(auth, /verifyIdToken/);
  assert.match(auth, /platformAdmins/);
  assert.match(auth, /status !== 'ACTIVE'/);
  assert.match(auth, /roles\.includes\(data\.role\)/);
});

test('license mutation writes canonical document and organization mirrors in one transaction', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  assert.match(service, /organizationRef\.collection\('license'\)\.doc\('current'\)/);
  assert.match(service, /transaction\.set\(licenseRef/);
  assert.match(service, /transaction\.set\(organizationRef, \{ \.\.\.mirrors/);
  assert.match(service, /runTransaction/);
  assert.match(service, /transaction\.set\(auditRef/);
});

test('Phase 2 exposes renewal, status-changing operations, and validation guards', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  const handler = fs.readFileSync(new URL('../lib/server/license-handler.ts', import.meta.url), 'utf8');
  assert.match(service, /LicenseMutationAction = .*convert-to-paid.*extend-subscription/);
  assert.match(service, /subscriptionStartedAt/);
  assert.match(service, /subscriptionEndsAt/);
  assert.match(service, /maxUsers cannot be less than the active member count/);
  assert.match(service, /Only a suspended license can be reactivated/);
  assert.match(service, /Only a trial or active license can be suspended/);
  assert.match(service, /Only a trial or active license can be expired/);
  assert.match(handler, /requirePlatformAdminToken\(idToken, \['SUPER_ADMIN'\]\)/);
});

test('activation rejects ACTIVE licenses and preserves the transactional mutation contract', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  assert.match(service, /current\?\.status === 'ACTIVE'/);
  assert.match(service, /An active license must be renewed or changed rather than activated again/);
  assert.match(service, /transaction\.set\(licenseRef/);
  assert.match(service, /transaction\.set\(organizationRef, \{ \.\.\.mirrors/);
  assert.match(service, /transaction\.set\(auditRef/);
});

test('the required organization mirror is derived deterministically, including maxUsers', () => {
  const canonical = parseCanonicalLicense({ ...license('ACTIVE'), maxUsers: 5 });
  const mirror = buildOrganizationLicenseMirror(canonical, Date.now());
  assert.equal(mirror.maxUsers, 5);
  assert.equal(mirror.licenseStatus, 'ACTIVE');
  assert.equal(compareOrganizationLicenseMirror(canonical, mirror).status, 'CONSISTENT');
  assert.equal(compareOrganizationLicenseMirror(canonical, { ...mirror, maxUsers: 3 }).status, 'DRIFTED');
});

test('mirror reader distinguishes missing, invalid, and drifted canonical state', async () => {
  const missing = await loadLicenseMirrorState({ firestore: fakeFirestore({}, {}, false), organizationId: 'org-a' });
  assert.equal(missing.status, 'MISSING_CANONICAL_DOCUMENT');
  const invalid = await loadLicenseMirrorState({ firestore: fakeFirestore({}, { plan: 'TEAM', status: 'ACTIVE' }), organizationId: 'org-a' });
  assert.equal(invalid.status, 'INVALID_CANONICAL_LICENSE');
  const drifted = await loadLicenseMirrorState({ firestore: fakeFirestore({ licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: undefined, maxUsers: 3 }, { ...license('ACTIVE'), maxUsers: 5 }), organizationId: 'org-a' });
  assert.equal(drifted.status, 'DRIFTED');
  assert.deepEqual(drifted.differences.map(({ field }) => field), ['licenseExpiresAt', 'maxUsers']);
});

test('all license mutations use the centralized mirror helper', () => {
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  assert.match(service, /buildOrganizationLicenseMirror\(canonicalNext/);
  assert.match(service, /transaction\.set\(organizationRef, \{ \.\.\.mirrors/);
});

test('the organization detail action matrix does not offer activation for ACTIVE licenses', () => {
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  assert.match(detail, /licenseAdminState/);
  assert.match(detail, /allowedActions/);
  assert.doesNotMatch(detail, /evaluation\.status ===/);
  assert.doesNotMatch(detail, /\['ACTIVATE', 'EXTEND_TRIAL', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'EXPIRE'\]/);
});

test('read, route, and dialog contracts expose the licensing lifecycle foundation', () => {
  const readService = fs.readFileSync(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../components/console/LicenseActionDialog.tsx', import.meta.url), 'utf8');
  assert.match(readService, /licenseDocumentState/);
  assert.match(readService, /licenseAdminState/);
  assert.match(readService, /activeMemberCount/);
  assert.match(client, /convertTrialToPaid/);
  assert.match(client, /extendSubscription/);
  assert.match(dialog, /Convert to Paid/);
  assert.match(dialog, /Extend Subscription/);
  assert.match(dialog, /Current expiration/);
});

test('V1.1B licensing control center reuses the shared mutation dispatcher', () => {
  const licensing = fs.readFileSync(new URL('../components/console/LicensingModule.tsx', import.meta.url), 'utf8');
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  const dispatcher = fs.readFileSync(new URL('../lib/license-admin-actions.ts', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('../lib/use-license-admin-actions.ts', import.meta.url), 'utf8');
  assert.match(licensing, /useLicenseAdminActions/);
  assert.match(licensing, /licenseDocumentState/);
  assert.match(licensing, /licenseAdminState\?\.allowedActions/);
  assert.match(licensing, /Needs Attention/);
  assert.match(licensing, /Expiring within 7 days/);
  assert.match(licensing, /activeMemberCount/);
  assert.match(licensing, /hidden.*md:block/);
  assert.match(detail, /useLicenseAdminActions/);
  assert.doesNotMatch(detail, /if \(dialog === 'ACTIVATE'\)/);
  assert.match(dispatcher, /dispatchLicenseAction/);
  assert.match(dispatcher, /Organization activated successfully/);
  assert.match(dispatcher, /Subscription extended successfully/);
  assert.match(hook, /isLicenseConflict/);
  assert.match(dispatcher, /status === 409/);
  assert.match(hook, /await refresh\(\)/);
});

test('409 API errors preserve safe domain messages for the Console client', () => {
  const errors = fs.readFileSync(new URL('../lib/server/api-error-response.ts', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  assert.match(errors, /error: \{ code: apiError\.code, message: apiError\.message \}/);
  assert.match(client, /payload\.error\?\.message/);
});

test('the Console keeps tenant roles and unauthenticated callers outside platform operations', () => {
  const auth = fs.readFileSync(new URL('../lib/server/platform-admin.ts', import.meta.url), 'utf8');
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../components/console/LicenseActionDialog.tsx', import.meta.url), 'utf8');
  assert.match(auth, /A Firebase ID token is required/);
  assert.match(auth, /platform administrator is not authorized/);
  assert.match(detail, /platformAdmin\?\.role === 'SUPER_ADMIN'/);
  assert.match(dialog, /SUSPEND/);
  assert.match(dialog, /EXPIRE/);
});

test('V1.1C exposes server-derived organization health and operational controls', () => {
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  const organizations = fs.readFileSync(new URL('../components/console/OrganizationsModule.tsx', import.meta.url), 'utf8');
  const users = fs.readFileSync(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8');
  const state = fs.readFileSync(new URL('../lib/server/license-admin-state.ts', import.meta.url), 'utf8');
  const profile = fs.readFileSync(new URL('../lib/server/organization-admin-service.ts', import.meta.url), 'utf8');
  const memberRoute = fs.readFileSync(new URL('../app/api/organizations/[orgId]/members/[uid]/route.ts', import.meta.url), 'utf8');
  const memberHook = fs.readFileSync(new URL('../lib/use-organization-member-admin.ts', import.meta.url), 'utf8');
  const authScreen = fs.readFileSync(new URL('../components/AuthScreen.tsx', import.meta.url), 'utf8');
  assert.deepEqual(deriveOrganizationAdminState({ name: 'Example', timezone: 'Asia/Manila', currency: 'PHP' }, deriveLicenseAdminState({ ...license('ACTIVE'), subscriptionEndsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }, 2)), { health: 'WARNING', attentionReasons: ['LICENSE_EXPIRING_SOON'] });
  assert.match(state, /deriveOrganizationAdminState/);
  assert.match(detail, /SUPER ADMIN CONTROLS/);
  assert.match(detail, /REPAIR_LICENSE/);
  assert.match(memberHook, /updateOrganizationMember/);
  assert.match(organizations, /Action Needed/);
  assert.match(organizations, /organizationAdminState/);
  assert.match(users, /License impact/);
  assert.match(profile, /ORGANIZATION_PROFILE_UPDATED/);
  assert.match(profile, /ORGANIZATION_MEMBER_ROLE_CHANGED/);
  assert.match(memberRoute, /SUPER_ADMIN/);
  assert.doesNotMatch(authScreen, /Google sign-in debug/);
});

test('V1.1E exposes existing-user membership controls, metadata validation, and timezone-safe dates', () => {
  const service = fs.readFileSync(new URL('../lib/server/organization-admin-service.ts', import.meta.url), 'utf8');
  const addRoute = fs.readFileSync(new URL('../app/api/organizations/[orgId]/members/route.ts', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('../lib/use-organization-member-admin.ts', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../components/console/OrganizationAdminDialogs.tsx', import.meta.url), 'utf8');
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  const users = fs.readFileSync(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8');
  const organizations = fs.readFileSync(new URL('../components/console/OrganizationsModule.tsx', import.meta.url), 'utf8');
  const primitives = fs.readFileSync(new URL('../components/console/ConsolePrimitives.tsx', import.meta.url), 'utf8');
  assert.match(addRoute, /lookupExistingOrganizationUser/);
  assert.match(addRoute, /addOrganizationMember/);
  assert.match(service, /getUserByEmail/);
  assert.match(service, /ORGANIZATION_MEMBER_ADDED/);
  assert.match(service, /ORGANIZATION_MEMBER_ARCHIVED/);
  assert.match(service, /ORGANIZATION_MEMBER_RESTORED/);
  assert.match(service, /ORGANIZATION_MEMBER_SUSPENDED/);
  assert.match(service, /ORGANIZATION_MEMBER_REACTIVATED/);
  assert.match(service, /IANA timezone identifier/);
  assert.match(service, /ISO 4217 currency code/);
  assert.match(service, /at least one active ADMIN/);
  assert.match(service, /This organization has reached its active user limit/);
  assert.match(api, /lookupOrganizationUser/);
  assert.match(api, /addOrganizationMember/);
  assert.match(hook, /ADD_MEMBER/);
  assert.match(hook, /ARCHIVE_MEMBER/);
  assert.match(hook, /RESTORE_MEMBER/);
  assert.match(hook, /error\.status === 409/);
  assert.match(dialogs, /Only existing BSM users can be added/);
  assert.match(dialogs, /does not create or modify a Firebase Authentication account/);
  assert.match(dialogs, /Archive Member/);
  assert.match(detail, /Active Users/);
  assert.match(detail, /Available Seats/);
  assert.match(detail, /MISSING_TIMEZONE/);
  assert.match(detail, /formatDateInTimeZone/);
  assert.match(users, /Manage Membership/);
  assert.match(users, /useOrganizationMemberAdmin/);
  assert.match(organizations, /href=\{`\/organizations\/\$\{org\.id\}`\}/);
  assert.match(primitives, /timeZone: timezone \|\| 'UTC'/);

  const instant = '2026-01-01T23:30:00.000Z';
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(instant)), 'Jan 2, 2026');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' }).format(new Date(instant)), 'Jan 1, 2026');
});

test('V1.1G resolves organization locale settings from Client App canonical settings with compatibility fallback', () => {
  const canonical = resolveOrganizationLocaleSettingsFromData(
    { timezone: 'UTC', currency: 'USD' },
    { timezone: 'Asia/Manila', currency: 'PHP' },
    'org-a',
  );
  assert.deepEqual(canonical, {
    timezone: 'Asia/Manila',
    currency: 'PHP',
    timezoneSource: 'organizations/org-a/settings/settings.timezone',
    currencySource: 'organizations/org-a/settings/settings.currency',
  });

  const compatibility = resolveOrganizationLocaleSettingsFromData(
    { timezone: 'America/New_York', currency: 'USD' },
    {},
    'org-b',
  );
  assert.deepEqual(compatibility, {
    timezone: 'America/New_York',
    currency: 'USD',
    timezoneSource: 'organizations/org-b.timezone',
    currencySource: 'organizations/org-b.currency',
  });

  assert.deepEqual(resolveOrganizationLocaleSettingsFromData({}, {}, 'org-c'), {
    timezone: null,
    currency: null,
    timezoneSource: 'none',
    currencySource: 'none',
  });
});

test('V1.1I Members & Access controls are wired through forms, shared actions, API routes, and refresh', () => {
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
  const users = fs.readFileSync(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8');
  const dialogs = fs.readFileSync(new URL('../components/console/OrganizationAdminDialogs.tsx', import.meta.url), 'utf8');
  const hook = fs.readFileSync(new URL('../lib/use-organization-member-admin.ts', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  const addRoute = fs.readFileSync(new URL('../app/api/organizations/[orgId]/members/route.ts', import.meta.url), 'utf8');
  const updateRoute = fs.readFileSync(new URL('../app/api/organizations/[orgId]/members/[uid]/route.ts', import.meta.url), 'utf8');
  for (const action of ['ADD_MEMBER', 'CHANGE_ROLE', 'SUSPEND_MEMBER', 'REACTIVATE_MEMBER', 'ARCHIVE_MEMBER', 'RESTORE_MEMBER']) assert.match(hook, new RegExp(action));
  assert.match(dialogs, /event\.preventDefault\(\)/);
  assert.match(dialogs, /type="submit"/);
  assert.match(dialogs, /Adding…/);
  assert.match(dialogs, /Confirm Archive Member/);
  assert.match(detail, /setPendingMemberAction/);
  assert.match(detail, /await refresh|refresh: load/);
  assert.match(users, /useOrganizationMemberAdmin/);
  assert.match(api, /organizations\/\$\{orgId\}\/members/);
  assert.match(addRoute, /requirePlatformAdmin\(request, \['SUPER_ADMIN'\]\)/);
  assert.match(updateRoute, /requirePlatformAdmin\(request, \['SUPER_ADMIN'\]\)/);
  assert.match(hook, /await refresh\(\)/);
  assert.match(hook, /error\.status === 409/);
});

test('V1.1C repair and correction routes remain server-authorized and controlled', () => {
  const repairRoute = fs.readFileSync(new URL('../app/api/organizations/[orgId]/license/repair/route.ts', import.meta.url), 'utf8');
  const editRoute = fs.readFileSync(new URL('../app/api/organizations/[orgId]/license/edit-details/route.ts', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  const dispatcher = fs.readFileSync(new URL('../lib/license-admin-actions.ts', import.meta.url), 'utf8');
  assert.match(repairRoute, /repair-license/);
  assert.match(editRoute, /edit-details/);
  assert.match(service, /ORGANIZATION_LICENSE_REPAIRED/);
  assert.match(service, /ORGANIZATION_LICENSE_ADMIN_CORRECTED/);
  assert.match(service, /maxUsers cannot be less than the active member count/);
  assert.match(service, /The license is no longer invalid and was not repaired/);
  assert.match(api, /repairLicense/);
  assert.match(api, /updateOrganizationProfile/);
  assert.match(api, /updateOrganizationMember/);
  assert.match(dispatcher, /REPAIR_LICENSE/);
  assert.match(dispatcher, /EDIT_LICENSE_DETAILS/);
});

test('V1.1K responsive Console tables use shared compact accessible controls', () => {
  const primitives = fs.readFileSync(new URL('../components/console/ConsolePrimitives.tsx', import.meta.url), 'utf8');
  const organizations = fs.readFileSync(new URL('../components/console/OrganizationsModule.tsx', import.meta.url), 'utf8');
  const users = fs.readFileSync(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8');
  const licensing = fs.readFileSync(new URL('../components/console/LicensingModule.tsx', import.meta.url), 'utf8');
  const audit = fs.readFileSync(new URL('../components/console/AuditLogsModule.tsx', import.meta.url), 'utf8');
  const admins = fs.readFileSync(new URL('../components/console/PlatformAdminsModule.tsx', import.meta.url), 'utf8');
  const detail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');

  assert.match(primitives, /CompactIconButton/);
  assert.match(primitives, /aria-label={label}/);
  assert.match(primitives, /title={label}/);
  assert.match(primitives, /group-focus-visible:opacity-100/);
  for (const source of [organizations, users, licensing, audit, admins, detail]) {
    assert.match(source, /min-w-0|table-fixed/);
  }
  assert.match(organizations, /href=\{`\/organizations\/\$\{org\.id\}`\}/);
  assert.match(organizations, /CompactIconButton/);
  assert.match(users, /CompactIconButton/);
  assert.match(users, /#members-card/);
  assert.match(users, /Manage Membership/);
  assert.doesNotMatch(users, /<tr[^>]*onClick/);
  assert.match(licensing, /licenseAdminState\?\.allowedActions/);
  assert.match(licensing, /CompactIconButton/);
  assert.match(audit, /TruncatedText/);
  assert.match(audit, /md:hidden/);
  assert.match(admins, /CompactIconButton/);
  assert.match(detail, /setPendingMemberAction/);
  assert.match(detail, /CompactIconButton/);
  assert.match(detail, /ARCHIVE_MEMBER/);
  assert.doesNotMatch(detail, /<tr[^>]*onClick/);
});
