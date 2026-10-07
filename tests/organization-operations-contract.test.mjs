import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [listRoute, detailRoute, service, readService, registry, detail, usage, users, shell, app, apiClient] = await Promise.all([
  readFile(new URL('../app/api/organizations/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/organizations/[orgId]/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/organization-operations-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/OrganizationsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/OrganizationUsageSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/ConsoleShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/ConsoleApp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8'),
]);

test('organization registry and detail APIs use platform-admin authorization and safe read models', () => {
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /requirePlatformAdmin\(request\)/);
    assert.match(route, /successResponse\(/);
  }
  assert.match(listRoute, /listOrganizationRegistryPage/);
  assert.match(detailRoute, /getOrganizationOperationsDetail/);
  assert.match(service, /getConsoleOrganizationSummary/);
  assert.match(service, /listSubscriptionPlans/);
  assert.match(service, /where\('organizationId', '==', organizationId\)/);
  assert.doesNotMatch(service, /platformInstallationMetadataByOrganizationIds|platformInstallations|platformDomains|installationMetadata/);
  assert.match(apiClient, /OrganizationRegistryPage/);
  assert.match(apiClient, /OrganizationOperationsDetail/);
  assert.doesNotMatch(apiClient, /getPlatformInstallations|getPlatformInstallation|getPlatformDomains|getPlatformDomain|\/api\/installations|\/api\/domains/);
});

test('organization operations projection is allowlisted and excludes tenant records and PII', () => {
  const summaryStart = readService.indexOf('export async function getConsoleOrganizationSummary');
  const summaryEnd = readService.indexOf('export async function getConsoleOrganization(orgId', summaryStart);
  const summarySource = readService.slice(summaryStart, summaryEnd);
  assert.ok(summaryStart >= 0);
  assert.ok(summaryEnd > summaryStart);
  assert.match(readService, /platformMetadata/);
  assert.doesNotMatch(readService, /data\.installationId|data\.appVersion|data\.applicationVersion|data\.deploymentStatus|settingsData\.website/);
  assert.doesNotMatch(service, /actorEmail|targetEmail|previousValue|newValue/);
  const registryPageStart = service.indexOf('export async function listOrganizationRegistryPage');
  const registryPageEnd = service.indexOf('export function parseOrganizationMembershipFilters', registryPageStart);
  const registryPageSource = service.slice(registryPageStart, registryPageEnd);
  assert.ok(registryPageStart >= 0);
  assert.ok(registryPageEnd > registryPageStart);
  assert.doesNotMatch(registryPageSource, /collection\('members'\)|collection\('usage'\)|collection\('leads'\)|collection\('clients'\)|collection\('deals'\)|collection\('tasks'\)|collection\('notes'\)|collection\('documents'\)|platformInstallations|platformDomains/);
  assert.doesNotMatch(summarySource, /collection\('members'\)\.get\(\)/);
  for (const source of [registry, detail]) {
    assert.doesNotMatch(source, /ownerEmail|OrganizationMember|useOrganizationMemberAdmin|lastLogin|lookupOrganizationUser/);
  }
  for (const source of [registry]) {
    assert.doesNotMatch(source, /ownerEmail|OrganizationMember|useOrganizationMemberAdmin|OrganizationUsageSection|lastLogin|lookupOrganizationUser/);
  }
  assert.match(detail, /OrganizationUsageSection/);
  assert.match(usage, /Operational usage estimates only—not Firebase or Google Cloud billing, invoicing, or customer charges/);
  assert.match(usage, /Record breakdown \(counts only\)/);
  assert.match(usage, /never returns record contents/);
  assert.match(detail, /Raw audit values and identities remain redacted/);
  assert.doesNotMatch(detail, /Domain &amp; installation|Installation status|platform installation registry|primaryVentaleDomain|customDomain/);
  assert.match(users, /Organization roles apply only inside that organization/);
  assert.match(users, /SUPPORT remains read-only/);
  assert.match(shell, /Members & Access/);
  assert.match(app, /Platform Health/);
  assert.doesNotMatch(shell, /Domains & Installations|\/installations/);
  assert.doesNotMatch(app, /DomainsInstallationsModule|InstallationDetailModule|DomainDetailModule/);
});

test('registry filters and detail fields cover platform operations without browser-side mutation logic', () => {
  assert.match(registry, /Search organization or workspace/);
  assert.match(registry, /Plan filter/);
  assert.match(registry, /License status filter/);
  assert.match(registry, /Creation date filter/);
  assert.match(registry, /Renewal or trial state filter/);
  assert.match(registry, /platformStatus/);
  assert.match(registry, /Trial end/);
  assert.match(detail, /Workspace reference/);
  assert.match(detail, /Canonical license status/);
  assert.match(detail, /Price snapshot/);
  assert.match(usage, /Data &amp; Storage/);
  assert.match(detail, /Recent platform activity/);
  assert.match(detail, /Showing up to five recent events/);
  assert.match(service, /listOrganizationPlatformAuditHistory\(orgId, 5\)/);
  assert.match(registry, /platformAdmin\?\.role === 'SUPPORT'/);
  assert.match(registry, /getOrganizationRegistryPage/);
  assert.match(registry, /Previous organization page/);
  assert.match(registry, /Next organization page/);
  assert.doesNotMatch(registry, /TruncatedText value=\{record\.organizationId\}/);
  assert.match(detail, /platformAdmin\?\.role === 'SUPPORT'/);
  assert.doesNotMatch(registry, /useLicenseAdminActions|updateOrganizationProfile|callConsoleAdminApi/);
  assert.doesNotMatch(detail, /useLicenseAdminActions|updateOrganizationProfile|callConsoleAdminApi/);
  assert.doesNotMatch(detail, /record\.planId \|\|/);
});
