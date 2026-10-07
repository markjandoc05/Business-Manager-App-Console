import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [overviewRoute, pageRoute, detailRoute, service, planService, licenseService, licenseAdminService, moduleSource, detailDialog, apiClient, plansModule, marketingModule] = await Promise.all([
  readFile(new URL('../app/api/subscription-operations/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/subscription-operations/licenses/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/subscription-operations/[orgId]/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/subscription-operations-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/subscription-plan-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/subscription-license-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/SubscriptionOperationsModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/SubscriptionLicenseDetailsDialog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/SubscriptionPlansModule.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/console/PlanMarketingModule.tsx', import.meta.url), 'utf8'),
]);

test('subscription operations reads remain platform-admin authorized and read-only', () => {
  for (const route of [overviewRoute, pageRoute, detailRoute]) {
    assert.match(route, /requirePlatformAdmin\(request\)/);
    assert.match(route, /successResponse\(/);
    assert.doesNotMatch(route, /POST|PATCH|DELETE/);
  }
  assert.match(service, /compareFounding100Usage/);
  assert.doesNotMatch(service, /reconcileSubscriptionPlanUsage/);
  assert.match(service, /where\('organizationId', '==', organizationId\)/);
  assert.match(service, /SUBSCRIPTION_AUDIT_ACTIONS/);
  assert.match(service, /listConsoleSubscriptionOrganizationPage/);
  assert.match(service, /LICENSE_PAGE_SCAN_CAP/);
  assert.doesNotMatch(service, /previousValue/);
  assert.doesNotMatch(service, /newValue/);
});

test('subscription reads and provisioning avoid the unavailable planId collection-group index', () => {
  for (const source of [planService, licenseService, licenseAdminService]) {
    assert.doesNotMatch(source, /collectionGroup\('license'\)\.where\('planId'/);
  }
  assert.match(planService, /listCanonicalLicenseDocumentsForPlan/);
  assert.match(licenseService, /listCanonicalLicenseDocumentsForPlanInTransaction/);
});

test('subscription operations UI exposes only subscription operations and existing action paths', () => {
  for (const source of [moduleSource, detailDialog]) {
    assert.doesNotMatch(source, /\bleads\b|\bclients\b|\bdeals\b|\btasks\b|\bnotes\b|customer documents/i);
  }
  assert.match(moduleSource, /Founding 100/);
  assert.match(moduleSource, /Founding capacity/);
  assert.match(moduleSource, /remainingCapacity/);
  assert.doesNotMatch(moduleSource, /\/ 100/);
  assert.match(moduleSource, /Canonical count/);
  assert.match(moduleSource, /Stored counter/);
  assert.match(moduleSource, /Search organization/);
  assert.match(moduleSource, /Plan filter/);
  assert.match(moduleSource, /License status filter/);
  assert.match(moduleSource, /Renewal period filter/);
  assert.match(moduleSource, /Trial expiration filter/);
  assert.match(moduleSource, /Price snapshot/);
  assert.match(moduleSource, /Subscription start/);
  assert.match(moduleSource, /Server-paged platform subscription records/);
  assert.match(moduleSource, /Records are read in server-side pages of up to 25/);
  assert.doesNotMatch(moduleSource, /TruncatedText value=\{license\.organizationId\}/);
  assert.match(moduleSource, /useLicenseAdminActions/);
  assert.match(moduleSource, /LicenseActionDialog/);
  assert.match(detailDialog, /Relevant subscription audit history/);
  assert.match(detailDialog, /Commercial product/);
  assert.match(detailDialog, /productLabel/);
  assert.doesNotMatch(detailDialog, /Platform plan code/);
  assert.doesNotMatch(detailDialog, /<DetailField label="Code"/);
  assert.match(apiClient, /getSubscriptionOperations/);
  assert.match(apiClient, /getSubscriptionOperationLicensePage/);
  assert.match(apiClient, /getSubscriptionLicenseDetail/);
});

test('subscription operations filters and mutations remain deterministic and role-gated', () => {
  assert.match(moduleSource, /const canMutate = platformAdmin\?\.role === 'SUPER_ADMIN'/);
  assert.match(moduleSource, /applyFilters/);
  assert.match(moduleSource, /nextPage/);
  assert.match(moduleSource, /previousPage/);
  assert.match(moduleSource, /canMutate && license\.allowedActions\.length > 0/);
  assert.match(detailDialog, /canMutate/);
});

test('normal Console views prefer readable commercial labels over technical plan identifiers', () => {
  for (const source of [plansModule, marketingModule]) assert.doesNotMatch(source, /plan\.code/);
  assert.doesNotMatch(detailDialog, /value=\{license\.planId/);
  assert.doesNotMatch(detailDialog, />\{event\.planId\}</);
});
