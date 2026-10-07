import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { derivePlatformHealthStatus } from '../lib/server/platform-health-service.ts';

const route = await readFile(new URL('../app/api/platform-health/route.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../lib/server/platform-health-service.ts', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../components/console/DashboardModule.tsx', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
const planService = await readFile(new URL('../lib/server/subscription-plan-service.ts', import.meta.url), 'utf8');
const subscriptionOperations = await readFile(new URL('../lib/server/subscription-operations-service.ts', import.meta.url), 'utf8');

const healthyChecks = [
  { id: 'CONSOLE_BACKEND', label: 'Developer Console backend', status: 'HEALTHY', detail: 'ok' },
  { id: 'FIRESTORE', label: 'Firestore connectivity', status: 'HEALTHY', detail: 'ok' },
];

test('overall platform health fails safely when a required check is unavailable', () => {
  assert.equal(derivePlatformHealthStatus(healthyChecks, []), 'HEALTHY');
  assert.equal(derivePlatformHealthStatus([...healthyChecks, { id: 'PLAN_CATALOG', label: 'Platform plan catalog', status: 'DEGRADED', detail: 'warning' }], []), 'DEGRADED');
  assert.equal(derivePlatformHealthStatus([...healthyChecks, { id: 'FIRESTORE', label: 'Firestore connectivity', status: 'UNAVAILABLE', detail: 'unavailable' }], []), 'UNAVAILABLE');
  assert.equal(derivePlatformHealthStatus(healthyChecks, [{ code: 'FOUNDING_100_USAGE_MISMATCH', title: 'Mismatch', detail: 'safe' }]), 'DEGRADED');
});

test('Platform Health is platform-admin-only and uses trusted read-only checks', () => {
  assert.match(route, /requirePlatformAdmin\(request\)/);
  assert.match(route, /getPlatformHealth\(\)/);
  assert.match(service, /adminDb\.collection\('platformPlans'\)\.limit\(1\)\.get\(\)/);
  assert.match(service, /adminAuth\.listUsers\(1\)/);
  assert.match(service, /getPlatformSubscriptionHealthInspection/);
  assert.match(service, /inspectSubscriptionPlanCatalog/);
  assert.doesNotMatch(service, /getSubscriptionOperations/);
  assert.doesNotMatch(service, /loadLicenseMirrorState/);
  assert.doesNotMatch(service, /platformAuditLogs/);
  assert.doesNotMatch(service, /\.set\(|\.update\(|\.delete\(|runTransaction/);
});

test('Platform Health reuses one canonical scan for subscription and mirror integrity', () => {
  assert.match(subscriptionOperations, /getPlatformSubscriptionHealthInspection/);
  assert.match(subscriptionOperations, /listCanonicalLicenseDocuments\(\)/);
  assert.match(subscriptionOperations, /listSubscriptionPlans\(canonicalDocuments\)/);
  assert.match(subscriptionOperations, /compareFounding100Usage\(canonicalDocuments\)/);
  assert.match(subscriptionOperations, /compareOrganizationLicenseMirror/);
  assert.match(subscriptionOperations, /organizations\/\{organizationId\}\/license\/current/);
  assert.doesNotMatch(subscriptionOperations, /collection\('(leads|clients|deals|tasks|notes|documents)'\)/i);
});

test('health response and UI expose aggregates and warnings without CRM data or repair controls', () => {
  assert.match(service, /FOUNDING_100_USAGE_MISMATCH/);
  assert.match(service, /FOUNDING_CAPACITY_EXCEEDED/);
  assert.match(service, /foundingCapacity/);
  assert.match(service, /CANONICAL_LICENSE_MALFORMED/);
  assert.match(service, /ORGANIZATION_LICENSE_MIRROR_INCONSISTENT/);
  assert.doesNotMatch(service, /collection\('(leads|clients|deals|tasks|notes|documents)'\)/i);
  assert.match(apiClient, /getPlatformHealth/);
  assert.match(dashboard, /Overall platform status/);
  assert.match(dashboard, /Run health checks/);
  assert.match(dashboard, /Checks run on demand/);
  assert.match(dashboard, /runHealthChecks/);
  assert.doesNotMatch(dashboard, /Promise\.allSettled\(\[getDashboardMetrics\(\), getPlatformHealth\(\)\]\)/);
  assert.match(dashboard, /Subscription integrity warnings/);
  assert.match(dashboard, /Viewing this screen never repairs records or creates audit activity/);
  assert.doesNotMatch(dashboard, /Repair Founding|Reconcile Founding|Repair mirror/);
});

test('plan-catalog inspection treats absent persisted launch plans as an operational warning', () => {
  assert.match(planService, /inspectSubscriptionPlanCatalog/);
  assert.match(planService, /missingPlanIds/);
  assert.match(planService, /invalidPlanIds/);
  assert.match(planService, /SUBSCRIPTION_PLAN_IDS\.filter/);
});
