import { getIdToken, signOut } from 'firebase/auth';
import { firebaseAuth } from './firebase';
import type { DashboardMetrics, LicenseActionPayload, Organization, OrganizationMember, OrganizationMemberRole, OrganizationMemberStatus, OrganizationUsage } from './types';

export class ConsoleApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

export async function callConsoleAdminApi<T>(path: string, body: unknown = {}, method: 'GET' | 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new ConsoleApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  let response: Response;
  try {
    const token = await getIdToken(user);
    response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new ConsoleApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload.error?.code || 'INTERNAL_ERROR';
    const message = payload.error?.message || 'The administrative service is unavailable.';
    if (code === 'UNAUTHENTICATED' && firebaseAuth.currentUser) await signOut(firebaseAuth);
    throw new ConsoleApiError(code, message, response.status);
  }
  return (payload.data ?? payload) as T;
}

export type LicenseMutationResult = { organizationId: string; license: Record<string, unknown>; auditLogId: string };
export const activateLicense = (orgId: string, body: { plan: string; maxUsers: number; trialStartedAt?: string; subscriptionStartedAt?: string; endsAt: string }) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/activate`, body);
export const renewLicense = (orgId: string, body: { plan?: string; maxUsers?: number; subscriptionStartedAt: string; subscriptionEndsAt: string }) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/renew`, body);
export const extendTrial = (orgId: string, trialEndsAt: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/extend-trial`, { trialEndsAt });
export const convertTrialToPaid = (orgId: string, body: { plan: 'STARTER' | 'TEAM' | 'LEGACY'; maxUsers: number; subscriptionStartedAt: string; subscriptionEndsAt: string }) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/convert-to-paid`, body);
export const extendSubscription = (orgId: string, subscriptionEndsAt: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/extend-subscription`, { subscriptionEndsAt });
export const changePlan = (orgId: string, plan: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/plan`, { plan }, 'PATCH');
export const changeSeatLimit = (orgId: string, maxUsers: number) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/seat-limit`, { maxUsers }, 'PATCH');
export const suspendOrganization = (orgId: string, reason?: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/suspend`, { reason });
export const expireLicense = (orgId: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/expire`);
export const reactivateOrganization = (orgId: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/reactivate`);
export const repairLicense = (orgId: string, body: LicenseActionPayload) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/repair`, body);
export const editLicenseDetails = (orgId: string, body: LicenseActionPayload) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/edit-details`, body, 'PATCH');
export const getPlatformAdmins = () => callConsoleAdminApi<Record<string, unknown>[]>('/api/platform-admins', {}, 'GET');
export const getDashboardMetrics = () => callConsoleAdminApi<DashboardMetrics>('/api/dashboard/metrics', {}, 'GET');
export const getOrganizations = () => callConsoleAdminApi<Organization[]>('/api/organizations', {}, 'GET');
export const getOrganization = (orgId: string) => callConsoleAdminApi<{ organization: Organization; members: OrganizationMember[] }>(`/api/organizations/${orgId}`, {}, 'GET');
export const updateOrganizationProfile = (orgId: string, body: { name?: string; businessType?: string; currency?: string; timezone?: string; reason?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/organizations/${orgId}`, body, 'PATCH');
export const getOrganizationUsage = (orgId: string) => callConsoleAdminApi<OrganizationUsage & { viewerRole: 'SUPER_ADMIN' | 'SUPPORT' }>(`/api/organizations/${orgId}/usage`, {}, 'GET');
export const recalculateOrganizationUsage = (orgId: string) => callConsoleAdminApi<OrganizationUsage>(`/api/organizations/${orgId}/usage/recalculate`, {});
export const setOrganizationStorageLimit = (orgId: string, storageLimitBytes: number | null) => callConsoleAdminApi<OrganizationUsage>(`/api/organizations/${orgId}/usage/limit`, { storageLimitBytes }, 'PATCH');
export type ExistingOrganizationUser = { uid: string; email: string; name: string };
export const lookupOrganizationUser = (orgId: string, email: string) => callConsoleAdminApi<ExistingOrganizationUser>(`/api/organizations/${orgId}/members?email=${encodeURIComponent(email)}`, {}, 'GET');
export const addOrganizationMember = (orgId: string, body: { email: string; role: OrganizationMemberRole; reason?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/organizations/${orgId}/members`, body);
export const updateOrganizationMember = (orgId: string, uid: string, body: { role?: OrganizationMemberRole; status?: Lowercase<OrganizationMemberStatus>; reason?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/organizations/${orgId}/members/${encodeURIComponent(uid)}`, body, 'PATCH');
export type ConsoleMembership = OrganizationMember & { organization: string; organizationId: string; licenseStatus: string; organizationHealth?: string; attentionReasons?: string[]; activeMemberCount?: number; maxUsers?: number | null };
export const getUsers = () => callConsoleAdminApi<ConsoleMembership[]>('/api/users', {}, 'GET');
export const getLicensing = () => callConsoleAdminApi<Organization[]>('/api/licensing', {}, 'GET');
export type ConsoleAuditLog = { id: string; action?: string; actorEmail?: string; actorRole?: string; targetType?: string; targetId?: string; organizationId?: string; previousValue?: unknown; newValue?: unknown; createdAt?: string };
export const getAuditLogs = (limit = 25, cursor?: string) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return callConsoleAdminApi<{ items: ConsoleAuditLog[]; nextCursor?: string; pageInfo?: { hasNextPage: boolean; hasPreviousPage: boolean; nextCursor?: string } }>(`/api/audit-logs?${params.toString()}`, {}, 'GET');
};
export const createPlatformAdmin = (body: { uid: string; role: string; status?: string }) => callConsoleAdminApi<Record<string, unknown>>('/api/platform-admins', body);
export const updatePlatformAdmin = (uid: string, body: { role?: string; status?: string; displayName?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/platform-admins/${uid}`, body, 'PATCH');
