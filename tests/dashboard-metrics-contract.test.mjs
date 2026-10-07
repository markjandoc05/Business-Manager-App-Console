import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { attentionPriority, humanizeAuditAction, seatUtilization } from '../lib/dashboard-model.ts';

const route = await readFile(new URL('../app/api/dashboard/metrics/route.ts', import.meta.url), 'utf8');
const service = await readFile(new URL('../lib/server/dashboard-service.ts', import.meta.url), 'utf8');
const auditService = await readFile(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../components/console/DashboardModule.tsx', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
const organizations = await readFile(new URL('../components/console/OrganizationsModule.tsx', import.meta.url), 'utf8');
const licensing = await readFile(new URL('../components/console/SubscriptionOperationsModule.tsx', import.meta.url), 'utf8');
const auditLogs = await readFile(new URL('../components/console/AuditLogsModule.tsx', import.meta.url), 'utf8');
const primitives = await readFile(new URL('../components/console/ConsolePrimitives.tsx', import.meta.url), 'utf8');
const platformAdmins = await readFile(new URL('../components/console/PlatformAdminsModule.tsx', import.meta.url), 'utf8');
const licenseDialog = await readFile(new URL('../components/console/LicenseActionDialog.tsx', import.meta.url), 'utf8');

test('dashboard metrics require platform-admin authorization and use the Admin SDK boundary', () => {
  assert.match(route, /requirePlatformAdmin\(request\)/);
  assert.match(route, /getDashboardMetrics\(\)/);
  assert.match(service, /adminDb\.collection\('organizations'\)/);
  assert.match(service, /\.where\('status', '==', 'active'\)\.count\(\)\.get\(\)/);
});

test('dashboard read model exposes bounded operational sections and authoritative state derivation', () => {
  assert.match(service, /deriveLicenseAdminState/);
  assert.match(service, /deriveOrganizationAdminState/);
  assert.match(service, /attention\.slice|\.slice\(0, 5\)/);
  assert.match(service, /upcomingLicenseActions/);
  assert.match(service, /seatUtilization/);
  assert.match(service, /\.limit\(10\)/);
  assert.match(service, /humanizeAuditAction/);
  assert.match(service, /collection\('usage'\)\.doc\('current'\)/);
  assert.match(service, /STORAGE_LIMIT_REACHED/);
  assert.match(apiClient, /getDashboardMetrics/);
});

test('dashboard model prioritizes critical attention, calculates safe seats, and humanizes activity', () => {
  assert.ok(attentionPriority('INVALID_LICENSE') < attentionPriority('MISSING_TIMEZONE'));
  assert.ok(attentionPriority('SEAT_LIMIT_EXCEEDED') < attentionPriority('LICENSE_EXPIRING_SOON'));
  assert.deepEqual(seatUtilization(4, 5), { availableSeats: 1, utilizationPercent: 80, state: 'NEAR_LIMIT' });
  assert.deepEqual(seatUtilization(5, 5), { availableSeats: 0, utilizationPercent: 100, state: 'FULL' });
  assert.deepEqual(seatUtilization(5, 0), { availableSeats: null, utilizationPercent: null, state: 'UNLICENSED' });
  assert.equal(humanizeAuditAction('ORGANIZATION_MEMBER_REACTIVATED'), 'Reactivated a member');
  assert.equal(humanizeAuditAction('ORGANIZATION_LICENSE_REPAIRED'), 'Repaired organization license');
});

test('dashboard UI provides operational navigation, responsive sections, and read-only SUPPORT paths', () => {
  for (const path of ['/organizations', '/licensing?status=ACTIVE', '/licensing?status=TRIAL', '/users', '/licensing?expiration=SOON', '/licensing?status=EXPIRED', '/licensing?status=SUSPENDED']) assert.match(dashboard, new RegExp(path.replace(/[?]/g, '\\?')));
  assert.match(dashboard, /Needs Attention/);
  assert.match(dashboard, /Licensing Overview/);
  assert.match(dashboard, /Upcoming License Actions/);
  assert.match(dashboard, /Seat Utilization/);
  assert.match(dashboard, /Recent Platform Activity/);
  assert.match(dashboard, /Storage/);
  assert.match(dashboard, /grid-cols-2|lg:grid-cols-2/);
  assert.match(dashboard, /CompactIconButton/);
  assert.match(dashboard, /platformAdmin\?\.role === 'SUPER_ADMIN'/);
  assert.match(organizations, /platformStatus/);
  assert.match(licensing, /expirationParam === 'SOON'/);
});

test('V1.1N bounds audit pages and persists a lightweight attention panel', () => {
  assert.match(service, /orderBy\('createdAt', 'desc'\)\.limit/);
  assert.match(auditService, /startAfter\(cursorSnapshot\)/);
  assert.match(auditService, /pageInfo: \{ hasNextPage: Boolean\(nextCursor\), hasPreviousPage: Boolean\(cursor\)/);
  assert.match(auditService, /\.\.\.\(nextCursor \? \{ nextCursor \} : \{\}\)/);
  assert.match(apiClient, /getAuditLogs = \(limit = 25, cursor\?: string, filters: PlatformAuditLogFilters = \{\}\)/);
  assert.match(auditLogs, /getAuditLogs\(PAGE_SIZE, pageCursor, filters\)/);
  assert.match(auditLogs, /Previous audit log page/);
  assert.match(auditLogs, /Next audit log page/);
  assert.match(dashboard, /bsm-console-dashboard-attention-collapsed/);
  assert.match(dashboard, /localStorage\.setItem/);
  assert.match(dashboard, /Expand Needs Attention/);
  assert.match(primitives, /ConfirmActionDialog/);
  assert.match(platformAdmins, /confirmPending/);
  assert.match(platformAdmins, /Change platform administrator role/);
  assert.match(licenseDialog, /The server remains authoritative/);
  assert.match(licenseDialog, /busy \? `\$\{title\}…`/);
});
