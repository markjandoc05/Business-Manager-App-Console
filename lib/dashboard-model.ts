import type { LicenseAdminAction, LicenseAdminState, OrganizationAttentionReason } from './types';

export const ATTENTION_PRIORITY: OrganizationAttentionReason[] = [
  'INVALID_LICENSE',
  'NO_LICENSE',
  'LICENSE_EXPIRED',
  'SEAT_LIMIT_EXCEEDED',
  'STORAGE_LIMIT_REACHED',
  'STORAGE_USAGE_HIGH',
  'STORAGE_USAGE_WARNING',
  'TRIAL_EXPIRING_SOON',
  'LICENSE_EXPIRING_SOON',
  'LICENSE_SUSPENDED',
  'MISSING_TIMEZONE',
  'MISSING_CURRENCY',
  'MISSING_REQUIRED_ORGANIZATION_DATA',
];

export const attentionReasonLabels: Record<OrganizationAttentionReason, string> = {
  INVALID_LICENSE: 'Invalid license',
  NO_LICENSE: 'No license',
  LICENSE_EXPIRED: 'License expired',
  SEAT_LIMIT_EXCEEDED: 'Seat limit exceeded',
  TRIAL_EXPIRING_SOON: 'Trial expiring soon',
  LICENSE_EXPIRING_SOON: 'License expiring soon',
  LICENSE_SUSPENDED: 'License suspended',
  MISSING_TIMEZONE: 'Timezone not set',
  MISSING_CURRENCY: 'Currency not set',
  MISSING_REQUIRED_ORGANIZATION_DATA: 'Organization setup incomplete',
  STORAGE_USAGE_WARNING: 'Storage usage warning',
  STORAGE_USAGE_HIGH: 'Storage usage high',
  STORAGE_LIMIT_REACHED: 'Storage limit reached',
};

export function attentionPriority(reason: OrganizationAttentionReason) {
  return ATTENTION_PRIORITY.indexOf(reason);
}

export function primaryDashboardAction(state: LicenseAdminState, reason?: OrganizationAttentionReason): LicenseAdminAction | undefined {
  if (reason === 'INVALID_LICENSE' && state.allowedActions.includes('REPAIR_LICENSE')) return 'REPAIR_LICENSE';
  if (reason === 'NO_LICENSE' && state.allowedActions.includes('ACTIVATE')) return 'ACTIVATE';
  if (reason === 'LICENSE_EXPIRED' && state.allowedActions.includes('RENEW')) return 'RENEW';
  if (reason === 'TRIAL_EXPIRING_SOON' && state.allowedActions.includes('EXTEND_TRIAL')) return 'EXTEND_TRIAL';
  if (reason === 'LICENSE_EXPIRING_SOON' && state.allowedActions.includes('EXTEND_SUBSCRIPTION')) return 'EXTEND_SUBSCRIPTION';
  return state.allowedActions.find((action) => ['REPAIR_LICENSE', 'ACTIVATE', 'RENEW', 'EXTEND_TRIAL', 'EXTEND_SUBSCRIPTION', 'REACTIVATE', 'CHANGE_SEAT_LIMIT'].includes(action));
}

export function seatUtilization(activeMembers: number, maxUsers: number | null) {
  if (maxUsers === null || maxUsers <= 0) return { availableSeats: null, utilizationPercent: null, state: 'UNLICENSED' as const };
  const availableSeats = maxUsers - activeMembers;
  const utilizationPercent = Math.round((activeMembers / maxUsers) * 100);
  return { availableSeats, utilizationPercent, state: activeMembers > maxUsers ? 'OVER_LIMIT' as const : utilizationPercent >= 100 ? 'FULL' as const : 'NEAR_LIMIT' as const };
}

export function humanizeAuditAction(action?: string) {
  const labels: Record<string, string> = {
    ORGANIZATION_MEMBER_REACTIVATED: 'Reactivated a member',
    ORGANIZATION_MEMBER_ROLE_CHANGED: 'Changed a member role',
    ORGANIZATION_MEMBER_SUSPENDED: 'Suspended a member',
    ORGANIZATION_MEMBER_ARCHIVED: 'Archived a member',
    ORGANIZATION_MEMBER_RESTORED: 'Restored a member',
    ORGANIZATION_MEMBER_ADDED: 'Added a member',
    ORGANIZATION_MEMBER_STATUS_CHANGED: 'Changed member access',
    ORGANIZATION_LICENSE_REPAIRED: 'Repaired organization license',
    ORGANIZATION_LICENSE_ADMIN_CORRECTED: 'Corrected organization license',
    ORGANIZATION_LICENSE_ACTIVATED: 'Activated organization license',
    ORGANIZATION_LICENSE_RENEWED: 'Renewed organization license',
    TRIAL_EXTENDED: 'Extended trial',
    ORGANIZATION_TRIAL_CONVERTED_TO_PAID: 'Converted trial to paid',
    ORGANIZATION_SUBSCRIPTION_EXTENDED: 'Extended subscription',
    ORGANIZATION_PLAN_CHANGED: 'Changed license plan',
    MAX_USERS_CHANGED: 'Changed user limit',
    ORGANIZATION_LICENSE_SUSPENDED: 'Suspended organization license',
    ORGANIZATION_LICENSE_EXPIRED: 'Expired organization license',
    ORGANIZATION_LICENSE_REACTIVATED: 'Reactivated organization license',
    ORGANIZATION_PROFILE_UPDATED: 'Updated organization settings',
    ORGANIZATION_TIMEZONE_UPDATED: 'Updated organization timezone',
    ORGANIZATION_CURRENCY_UPDATED: 'Updated organization currency',
    PLATFORM_ADMIN_ADDED: 'Added a platform administrator',
    PLATFORM_ADMIN_DISABLED: 'Disabled a platform administrator',
    PLATFORM_ADMIN_REACTIVATED: 'Reactivated a platform administrator',
    PLATFORM_ADMIN_ROLE_CHANGED: 'Changed a platform administrator role',
    PLATFORM_ADMIN_UPDATED: 'Updated a platform administrator',
  };
  return action ? labels[action] || action.replaceAll('_', ' ').toLowerCase() : 'Administrative activity';
}

export function auditDetail(previousValue: unknown, newValue: unknown) {
  const previous = previousValue && typeof previousValue === 'object' ? previousValue as Record<string, unknown> : {};
  const next = newValue && typeof newValue === 'object' ? newValue as Record<string, unknown> : {};
  if (previous.role !== undefined && next.role !== undefined && previous.role !== next.role) return `${String(previous.role)} → ${String(next.role)}`;
  if (previous.status !== undefined && next.status !== undefined && previous.status !== next.status) return `${String(previous.status)} → ${String(next.status)}`;
  if (next.reason && typeof next.reason === 'string') return next.reason;
  return undefined;
}
