import { adminDb } from './firebase-admin-core';
import { deriveLicenseAdminState, deriveOrganizationAdminState } from './license-admin-state';
import { resolveOrganizationLocaleSettingsFromData } from './organization-locale-settings';
import { storedUsage } from './organization-usage-service';
import { usageAttentionReason } from '../organization-usage';
import { mapConsoleReads, readCollectionPages } from './bounded-console-reads';
import { auditDetail, attentionPriority, attentionReasonLabels, humanizeAuditAction, primaryDashboardAction, seatUtilization as calculateSeatUtilization } from '../dashboard-model';
import type { DashboardActivityItem, DashboardAttentionItem, DashboardMetrics, DashboardSeatUtilizationItem, DashboardUpcomingLicenseAction, OrganizationAttentionReason } from '../types';

const SOON_DAYS = 30;

function safeDate(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function safeAuditValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(safeAuditValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeAuditValue(item)]));
  return undefined;
}

function firstAttentionReason(reasons: OrganizationAttentionReason[]) { return [...reasons].sort((left, right) => attentionPriority(left) - attentionPriority(right))[0]; }
function countReason(reasons: OrganizationAttentionReason[], targets: OrganizationAttentionReason[]) { return reasons.some((reason) => targets.includes(reason)) ? 1 : 0; }

export async function getDashboardMetrics(now = Date.now()): Promise<DashboardMetrics> {
  const organizations = await readCollectionPages(adminDb.collection('organizations'));
  const rows = await mapConsoleReads(organizations, async (organization) => {
    const organizationData = organization.data() || {};
    const [licenseSnapshot, settingsSnapshot, activeMembersSnapshot, usageSnapshot] = await Promise.all([
      organization.ref.collection('license').doc('current').get(),
      organization.ref.collection('settings').doc('settings').get(),
      organization.ref.collection('members').where('status', '==', 'active').count().get(),
      organization.ref.collection('usage').doc('current').get(),
    ]);
    const rawLicense = licenseSnapshot.exists ? licenseSnapshot.data() : undefined;
    const activeMemberCount = activeMembersSnapshot.data().count;
    const licenseAdminState = deriveLicenseAdminState(rawLicense, activeMemberCount, now);
    const locale = resolveOrganizationLocaleSettingsFromData(organizationData, settingsSnapshot.exists ? settingsSnapshot.data() || {} : {}, organization.id);
    const organizationAdminState = deriveOrganizationAdminState({ ...organizationData, timezone: locale.timezone, currency: locale.currency }, licenseAdminState);
    const usage = storedUsage(usageSnapshot.exists ? usageSnapshot.data() : undefined);
    const storageReason = usage.usageAvailable ? usageAttentionReason(usage.usageStatus) : undefined;
    const attentionReasons = storageReason ? [...organizationAdminState.attentionReasons, storageReason] : organizationAdminState.attentionReasons;
    return { id: organization.id, name: typeof organizationData.name === 'string' && organizationData.name.trim() ? organizationData.name : 'Unnamed organization', licenseAdminState, organizationAdminState, attentionReasons, usage };
  });

  const attentionSummary = {
    invalidLicense: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['INVALID_LICENSE']), 0),
    noLicense: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['NO_LICENSE']), 0),
    expired: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['LICENSE_EXPIRED']), 0),
    seatLimitExceeded: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['SEAT_LIMIT_EXCEEDED']), 0),
    expiringSoon: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['TRIAL_EXPIRING_SOON', 'LICENSE_EXPIRING_SOON']), 0),
    suspended: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['LICENSE_SUSPENDED']), 0),
    missingSetup: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['MISSING_TIMEZONE', 'MISSING_CURRENCY', 'MISSING_REQUIRED_ORGANIZATION_DATA']), 0),
    storageWarning: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['STORAGE_USAGE_WARNING']), 0),
    storageHigh: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['STORAGE_USAGE_HIGH']), 0),
    storageLimitReached: rows.reduce((total, row) => total + countReason(row.attentionReasons, ['STORAGE_LIMIT_REACHED']), 0),
  };

  const attention = rows
    .filter((row) => row.attentionReasons.length > 0)
    .map((row): DashboardAttentionItem | null => {
      const reason = firstAttentionReason(row.attentionReasons);
      if (!reason) return null;
      return { organizationId: row.id, organizationName: row.name, reason, reasonLabel: attentionReasonLabels[reason], priority: attentionPriority(reason), status: row.licenseAdminState.status, plan: row.licenseAdminState.plan, activeMemberCount: row.licenseAdminState.activeMembers, maxUsers: row.licenseAdminState.maxUsers, daysRemaining: row.licenseAdminState.daysRemaining, expiresAt: row.licenseAdminState.expiresAt, allowedActions: row.licenseAdminState.allowedActions, primaryAction: primaryDashboardAction(row.licenseAdminState, reason), usagePercent: row.usage.usagePercent, usageStatus: row.usage.usageStatus };
    })
    .filter((item): item is DashboardAttentionItem => item !== null)
    .sort((left, right) => left.priority - right.priority || left.organizationName.localeCompare(right.organizationName))
    .slice(0, 5);

  const licensingOverview = {
    active: rows.filter((row) => row.licenseAdminState.status === 'ACTIVE').length,
    trial: rows.filter((row) => row.licenseAdminState.status === 'TRIAL').length,
    expired: rows.filter((row) => row.licenseAdminState.status === 'EXPIRED').length,
    suspended: rows.filter((row) => row.licenseAdminState.status === 'SUSPENDED').length,
    invalid: rows.filter((row) => row.licenseAdminState.documentState === 'INVALID_LICENSE').length,
    noLicense: rows.filter((row) => row.licenseAdminState.documentState === 'NO_LICENSE').length,
  };
  const planDistribution = { TRIAL: 0, SOLO: 0, STARTER: 0, TEAM: 0, LEGACY: 0 };
  for (const row of rows) if (row.licenseAdminState.plan) planDistribution[row.licenseAdminState.plan] += 1;

  const upcomingLicenseActions = rows
    .filter((row) => row.licenseAdminState.expiresAt && (row.licenseAdminState.status === 'EXPIRED' || (row.licenseAdminState.daysRemaining !== null && row.licenseAdminState.daysRemaining <= SOON_DAYS)))
    .map((row): DashboardUpcomingLicenseAction | null => {
      const reason = row.licenseAdminState.status === 'EXPIRED' ? 'LICENSE_EXPIRED' : row.licenseAdminState.status === 'TRIAL' ? 'TRIAL_EXPIRING_SOON' : 'LICENSE_EXPIRING_SOON';
      const action = primaryDashboardAction(row.licenseAdminState, reason);
      return action ? { organizationId: row.id, organizationName: row.name, plan: row.licenseAdminState.plan, status: row.licenseAdminState.status, expiresAt: row.licenseAdminState.expiresAt, daysRemaining: row.licenseAdminState.daysRemaining, action, allowedActions: row.licenseAdminState.allowedActions } : null;
    })
    .filter((item): item is DashboardUpcomingLicenseAction => item !== null)
    .sort((left, right) => (left.daysRemaining ?? 0) - (right.daysRemaining ?? 0) || left.organizationName.localeCompare(right.organizationName))
    .slice(0, 5);

  const seatUtilization = rows.map((row): DashboardSeatUtilizationItem => ({ organizationId: row.id, organizationName: row.name, activeMemberCount: row.licenseAdminState.activeMembers, maxUsers: row.licenseAdminState.maxUsers, ...calculateSeatUtilization(row.licenseAdminState.activeMembers, row.licenseAdminState.maxUsers) })).filter((item) => item.state !== 'UNLICENSED' && (item.state === 'OVER_LIMIT' || item.utilizationPercent !== null && item.utilizationPercent >= 80 || item.availableSeats !== null && item.availableSeats <= 2)).sort((left, right) => (right.utilizationPercent ?? 0) - (left.utilizationPercent ?? 0) || left.organizationName.localeCompare(right.organizationName)).slice(0, 5);

  const organizationNames = new Map(rows.map((row) => [row.id, row.name]));
  const auditSnapshot = await adminDb.collection('platformAuditLogs').orderBy('createdAt', 'desc').limit(10).get();
  const recentActivity: DashboardActivityItem[] = auditSnapshot.docs.map((item) => {
    const data = item.data();
    const organizationId = typeof data.organizationId === 'string' ? data.organizationId : undefined;
    return { id: item.id, action: typeof data.action === 'string' ? data.action : undefined, title: humanizeAuditAction(typeof data.action === 'string' ? data.action : undefined), actorName: typeof data.actorName === 'string' && data.actorName ? data.actorName : typeof data.actorEmail === 'string' && data.actorEmail ? data.actorEmail : 'Platform administrator', actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : undefined, organizationId, organizationName: organizationId ? organizationNames.get(organizationId) : undefined, detail: auditDetail(safeAuditValue(data.previousValue), safeAuditValue(data.newValue)), createdAt: safeDate(data.createdAt) };
  });

  return {
    summary: { organizationsTotal: rows.length, organizationsActive: licensingOverview.active, organizationsTrial: licensingOverview.trial, organizationsAttention: rows.filter((row) => row.organizationAdminState.health === 'ACTION_REQUIRED' || row.attentionReasons.some((reason) => reason.startsWith('STORAGE_'))).length, activeMembers: rows.reduce((total, row) => total + row.licenseAdminState.activeMembers, 0), licensesExpiringSoon: rows.filter((row) => ['ACTIVE', 'TRIAL'].includes(row.licenseAdminState.status) && row.licenseAdminState.daysRemaining !== null && row.licenseAdminState.daysRemaining <= SOON_DAYS).length, licensesExpired: licensingOverview.expired, licensesSuspended: licensingOverview.suspended },
    attentionSummary,
    attention,
    licensingOverview,
    planDistribution,
    upcomingLicenseActions,
    seatUtilization,
    recentActivity,
  };
}
