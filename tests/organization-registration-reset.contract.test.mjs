import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [route, service, api, detail, dialog] = await Promise.all([
  readFile(new URL('../app/api/organizations/[orgId]/registration-reset/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/organization-registration-reset-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/OrganizationRegistrationResetDialog.tsx', import.meta.url), 'utf8'),
]);

test('registration reset is an explicit SUPER_ADMIN-only command with a narrow request shape', () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /requirePlatformAdmin\(request, \['SUPER_ADMIN'\]\)/);
  assert.match(route, /readJsonBody/);
  assert.match(route, /resetOrganizationForRegistration/);
  assert.match(service, /const RESET_MODES = \['KEEP_AUTH', 'DELETE_AUTH'\]/);
  assert.match(service, /rejectUnknownFields\(body, \['mode', 'confirmation'\]\)/);
  assert.match(service, /Confirmation must exactly match the organization ID/);
  assert.doesNotMatch(service, /actorEmail|targetEmail|userEmail|request\.body/);
  assert.match(api, /\/registration-reset/);
  assert.match(api, /OrganizationRegistrationResetMode/);
});

test('full reset derives and protects identities server-side before deletion', () => {
  assert.match(service, /collectionGroup\('members'\)\.get\(\)/);
  assert.match(service, /collection\('platformAdmins'\)\.doc\(uid\)\.get\(\)/);
  assert.match(service, /cannot delete a platform administrator account/);
  assert.match(service, /cannot delete an account that belongs to another organization/);
  assert.match(service, /adminAuth\.deleteUsers\(preflight\.memberUids\)/);
  assert.match(service, /adminDb\.collection\('users'\)\.doc\(uid\)/);
  assert.match(service, /adminDb\.recursiveDelete\(preflight\.organizationRef\)/);
  assert.match(service, /organizationSlugs/);
  assert.match(service, /workspaceBootstrap/);
  assert.match(service, /CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION/);
  assert.match(service, /organizationInvitations/);
  assert.match(service, /reconcileSubscriptionPlanUsage\('founding_100'\)/);
  assert.match(service, /action: 'ORGANIZATION_REGISTRATION_RESET'/);
  assert.doesNotMatch(service, /collection\('leads'\)|collection\('clients'\)|collection\('deals'\)|collection\('tasks'\)|collection\('notes'\)|collection\('documents'\)/);
});

test('the Console exposes reset controls only to SUPER_ADMIN and requires an exact confirmation', () => {
  assert.match(detail, /platformAdmin\?\.role === 'SUPER_ADMIN'/);
  assert.match(detail, /OrganizationRegistrationResetDialog/);
  assert.match(dialog, /confirmation\.trim\(\) === organizationId/);
  assert.match(dialog, /Full test reset — free eligible email registrations/);
  assert.match(dialog, /platform-admin access are rejected rather than deleted/);
  assert.doesNotMatch(dialog, /email\s*:\s*|actorEmail|targetEmail/);
});
