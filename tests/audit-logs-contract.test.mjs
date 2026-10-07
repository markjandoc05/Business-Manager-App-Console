import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [route, service, module, api, subscriptionService, dashboardService, licenseService, planService, subscriptionLicenseService, organizationAdminService, organizationUsageService, platformAdminService] = await Promise.all([
  readFile(new URL('../app/api/audit-logs/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/AuditLogsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/subscription-operations-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/dashboard-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/subscription-plan-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/subscription-license-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/organization-admin-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/organization-usage-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/platform-admin-service.ts', import.meta.url), 'utf8'),
]);

test('Audit Logs requires platform-admin authorization and accepts only bounded read filters', () => {
  assert.match(route, /requirePlatformAdmin\(request\)/);
  assert.match(route, /dateFrom|dateTo/);
  assert.match(route, /action:/);
  assert.match(route, /organizationId:/);
  assert.match(route, /actorRole:/);
  assert.match(route, /targetType:/);
  assert.match(service, /AUDIT_PAGE_MAX = 50/);
  assert.match(service, /AUDIT_SCAN_CAP = 250/);
  assert.match(service, /orderBy\('createdAt', 'desc'\)/);
  assert.match(service, /startAfter\(cursorSnapshot\)/);
  assert.match(service, /normalizeAuditFilters/);
  assert.match(service, /auditMatches/);
  assert.match(service, /hasAuditFilters/);
  assert.match(service, /safeLimit \+ 1/);
  assert.match(service, /withAuditOrganizationNames/);
  assert.doesNotMatch(service, /\.set\(|\.update\(|\.delete\(|runTransaction/);
});

test('Audit Logs projects only allowlisted metadata and omits identities, raw values, and CRM data', () => {
  assert.match(service, /safeAuditTargetId/);
  assert.match(service, /auditDetails/);
  assert.match(service, /SAFE_CHANGED_FIELDS/);
  assert.match(service, /PLATFORM_EVENT/);
  assert.doesNotMatch(service, /actorEmail|targetEmail|previousValue|newValue/);
  assert.doesNotMatch(service, /collection\('(leads|clients|deals|tasks|notes|documents)'\)/i);
  assert.doesNotMatch(module, /actorEmail|targetEmail|previousValue|newValue|summarize\(/);
  assert.match(module, /Allowlisted administrative metadata only/);
  assert.match(module, /Raw request data, before\/after values, emails, tokens, and tenant CRM data are not available/);
  assert.match(subscriptionService, /actorRole:/);
  assert.doesNotMatch(subscriptionService, /actorEmail: typeof data\.actorEmail/);
  assert.doesNotMatch(dashboardService, /actorEmail|targetEmail|previousValue|newValue/);
});

test('active audit writers persist only the safe platform audit schema', () => {
  for (const writer of [licenseService, planService, subscriptionLicenseService, organizationAdminService, organizationUsageService, platformAdminService]) {
    assert.doesNotMatch(writer, /actorEmail|targetEmail|previousValue|newValue/);
  }
  assert.doesNotMatch(licenseService, /metadata:\s*\{[^}]*reason/);
  assert.doesNotMatch(organizationAdminService, /metadata:\s*\{[^}]*reason/);
});

test('the Console client submits audit filters to the server and uses a safe detail view', () => {
  assert.match(api, /getAuditLogs = \(limit = 25, cursor\?: string, filters: PlatformAuditLogFilters/);
  assert.match(api, /params\.set\(key, value\)/);
  assert.match(module, /Filters are evaluated server-side/);
  assert.match(module, /Apply filters/);
  assert.match(module, /View safe details/);
  assert.match(module, /OrganizationCell/);
  assert.match(module, /Previous audit log page/);
  assert.match(module, /Next audit log page/);
});
