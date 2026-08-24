import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../app/api/dashboard/metrics/route.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../lib/server/dashboard-service.ts', import.meta.url), 'utf8');

test('dashboard metrics require platform-admin authorization and use the Admin SDK boundary', () => {
  assert.match(route, /requirePlatformAdmin\(request\)/);
  assert.match(route, /getDashboardMetrics\(\)/);
  assert.match(service, /adminDb\.collection\('organizations'\)/);
  assert.match(service, /\.where\('status', '==', 'active'\)\.count\(\)\.get\(\)/);
});
