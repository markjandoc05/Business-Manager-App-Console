import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [organizationsRoute, usersRoute, platformAdminsRoute, legacyLicensingRoute, organizationService, platformAdminService, organizationModule, usersModule, platformAdminsModule, subscriptionModule, auditModule, apiClient] = await Promise.all([
  readFile(new URL('../app/api/organizations/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/users/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/platform-admins/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/licensing/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/organization-operations-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/platform-admin-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/OrganizationsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/PlatformAdminsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/SubscriptionOperationsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/AuditLogsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8'),
]);

test('active Console collection lists are bounded server-side and require platform authorization', () => {
  for (const route of [organizationsRoute, usersRoute, platformAdminsRoute, legacyLicensingRoute]) {
    assert.match(route, /requirePlatformAdmin\(request\)/);
    assert.match(route, /successResponse\(/);
  }
  assert.match(organizationsRoute, /listOrganizationRegistryPage/);
  assert.match(usersRoute, /organizationId is required for membership reads/);
  assert.match(usersRoute, /listOrganizationMembershipPage/);
  assert.match(platformAdminsRoute, /listPlatformAdminPage/);
  assert.match(legacyLicensingRoute, /listSubscriptionOperationLicenses/);
  assert.doesNotMatch(usersRoute, /listConsoleMemberships/);
});

test('organization and membership pages use bounded cursors rather than full registry reads', () => {
  assert.match(organizationService, /REGISTRY_PAGE_SIZE = 25/);
  assert.match(organizationService, /REGISTRY_SCAN_CAP = 100/);
  assert.match(organizationService, /MEMBERSHIP_PAGE_SIZE = 25/);
  assert.match(organizationService, /MEMBERSHIP_SCAN_CAP = 100/);
  assert.match(organizationService, /orderBy\(FieldPath\.documentId\(\)\)/);
  assert.match(organizationService, /listOrganizationRegistryPage/);
  assert.match(organizationService, /listOrganizationMembershipPage/);
  assert.match(organizationService, /hasRegistryFilters/);
  assert.match(organizationService, /hasMembershipFilters/);
  assert.match(organizationService, /REGISTRY_PAGE_SIZE \+ 1/);
  assert.match(organizationService, /MEMBERSHIP_PAGE_SIZE \+ 1/);
  assert.match(organizationService, /validateOrganizationId\(organizationId\)/);
  assert.match(organizationService, /getConsoleOrganizationView/);
  assert.doesNotMatch(organizationService, /export async function listConsoleMemberships/);
  assert.match(platformAdminService, /PLATFORM_ADMIN_PAGE_SIZE = 25/);
  assert.match(platformAdminService, /orderBy\(FieldPath\.documentId\(\)\)/);
});

test('Console pages use cursors and avoid exposing raw organization IDs in registry rows', () => {
  assert.match(organizationModule, /getOrganizationRegistryPage/);
  assert.match(organizationModule, /Previous organization page/);
  assert.match(organizationModule, /Next organization page/);
  assert.match(organizationModule, /up to 25 per page/);
  assert.doesNotMatch(organizationModule, /TruncatedText value=\{record\.organizationId\}/);
  assert.match(usersModule, /getOrganizationMembershipPage/);
  assert.match(usersModule, /Choose an organization before viewing members/);
  assert.match(usersModule, /Previous membership page/);
  assert.match(usersModule, /Next membership page/);
  assert.match(usersModule, /up to 25 per page/);
  assert.match(platformAdminsModule, /Previous platform administrators page/);
  assert.match(platformAdminsModule, /Next platform administrators page/);
  assert.match(platformAdminsModule, /up to 25 per page/);
  assert.match(subscriptionModule, /Server-paged platform subscription records/);
  assert.match(subscriptionModule, /loadOverview/);
  assert.match(subscriptionModule, /loadLicensePage/);
  assert.match(subscriptionModule, /up to 25 per page/);
  assert.doesNotMatch(subscriptionModule, /Promise\.all\(\[getSubscriptionOperations\(\), getSubscriptionOperationLicensePage/);
  assert.match(auditModule, /Previous audit log page/);
  assert.match(auditModule, /Next audit log page/);
  assert.match(auditModule, /up to \{PAGE_SIZE\} per page/);
  assert.match(apiClient, /getOrganizationRegistryPage/);
  assert.match(apiClient, /getOrganizationMembershipPage/);
});
