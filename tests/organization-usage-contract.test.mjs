import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { estimateFirestoreDocumentBytes, formatBytes, summarizeStorageFiles, usageAttentionReason, usageStatus } from '../lib/organization-usage.ts';

const service = await readFile(new URL('../lib/server/organization-usage-service.ts', import.meta.url), 'utf8');
const readRoute = await readFile(new URL('../app/api/organizations/[orgId]/usage/route.ts', import.meta.url), 'utf8');
const recalculateRoute = await readFile(new URL('../app/api/organizations/[orgId]/usage/recalculate/route.ts', import.meta.url), 'utf8');
const limitRoute = await readFile(new URL('../app/api/organizations/[orgId]/usage/limit/route.ts', import.meta.url), 'utf8');
const detail = await readFile(new URL('../components/console/OrganizationUsageSection.tsx', import.meta.url), 'utf8');

test('usage formatting and informational limit states are deterministic', () => {
  assert.equal(formatBytes(800), '800 B');
  assert.equal(formatBytes(4.2 * 1024 * 1024), '4.2 MB');
  assert.equal(usageStatus(79, 100).status, 'NORMAL');
  assert.equal(usageStatus(80, 100).status, 'WARNING');
  assert.equal(usageStatus(90, 100).status, 'HIGH');
  assert.equal(usageStatus(100, 100).status, 'FULL');
  assert.equal(usageStatus(100, null).status, 'NO_LIMIT');
  assert.equal(usageAttentionReason('WARNING'), 'STORAGE_USAGE_WARNING');
  assert.equal(usageAttentionReason('HIGH'), 'STORAGE_USAGE_HIGH');
  assert.equal(usageAttentionReason('FULL'), 'STORAGE_LIMIT_REACHED');
  assert.deepEqual(summarizeStorageFiles([{ metadata: { size: '100' } }, { metadata: { size: 50 } }, { metadata: { size: '-4' } }]), { storageBytes: 150, fileCount: 3 });
  assert.ok(estimateFirestoreDocumentBytes({ name: 'Acme', count: 2 }) > 0);
});

test('usage is server-managed, reconciled atomically, and scoped to one organization', () => {
  assert.match(service, /collection\('usage'\)\.doc\('current'\)/);
  assert.match(service, /organizations\/\$\{orgId\}\//);
  assert.match(service, /getFiles\(\{ prefix: `organizations\/\$\{orgId\}\//);
  assert.match(service, /transaction\.set\(usageRef, writeData\)/);
  assert.match(service, /ORGANIZATION_USAGE_RECALCULATED/);
  assert.match(service, /inFlightReconciliations/);
  assert.match(service, /storageBytes: 0/);
  assert.match(readRoute, /requirePlatformAdmin\(request\)/);
  assert.match(recalculateRoute, /requirePlatformAdmin\(request, \['SUPER_ADMIN'\]\)/);
  assert.match(limitRoute, /requirePlatformAdmin\(request, \['SUPER_ADMIN'\]\)/);
  assert.match(detail, /Usage not calculated yet/);
  assert.match(detail, /Recalculate organization usage\?/);
  assert.match(detail, /Database Data/);
  assert.match(detail, /estimated/);
  assert.match(detail, /does not block usage/);
});
