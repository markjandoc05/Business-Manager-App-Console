import { getIdToken, signOut } from 'firebase/auth';
import { firebaseAuth } from './firebase';
import type { ConsoleSubscriptionPlan, ConsoleSubscriptionPlanMarketing, DashboardMetrics, LicenseActionPayload, OrganizationMemberRole, OrganizationMemberStatus, OrganizationMembershipFilters, OrganizationMembershipPage, OrganizationOperationsDetail, OrganizationRegistryFilters, OrganizationRegistryPage, OrganizationUsage, PlatformAdminPage, PlatformAuditLogFilters, PlatformAuditLogPage, PlatformHealthData, SubscriptionLicenseDetail, SubscriptionOperationLicenseFilters, SubscriptionOperationLicensePage, SubscriptionOperationsOverview } from './types';

export class ConsoleApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

export async function callConsoleAdminApi<T>(path: string, body: unknown = {}, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<T> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new ConsoleApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  let response: Response;
  let token: string;
  try {
    token = await getIdToken(user);
  } catch {
    throw new ConsoleApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  }
  try {
    response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new ConsoleApiError('NETWORK_ERROR', 'Unable to reach the administrative service. Check your connection and try again.', 503);
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
export const convertTrialToPaid = (orgId: string, body: { plan: 'SOLO' | 'STARTER' | 'TEAM' | 'LEGACY'; maxUsers: number; subscriptionStartedAt: string; subscriptionEndsAt: string }) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/convert-to-paid`, body);
export const extendSubscription = (orgId: string, subscriptionEndsAt: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/extend-subscription`, { subscriptionEndsAt });
export const changePlan = (orgId: string, plan: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/plan`, { plan }, 'PATCH');
export const changeSeatLimit = (orgId: string, maxUsers: number) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/seat-limit`, { maxUsers }, 'PATCH');
export const suspendOrganization = (orgId: string, reason?: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/suspend`, { reason });
export const expireLicense = (orgId: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/expire`);
export const reactivateOrganization = (orgId: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/reactivate`);
export const repairLicense = (orgId: string, body: LicenseActionPayload) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/repair`, body);
export const editLicenseDetails = (orgId: string, body: LicenseActionPayload) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/edit-details`, body, 'PATCH');
export const getPlatformAdmins = (cursor?: string) => callConsoleAdminApi<PlatformAdminPage>(`/api/platform-admins${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {}, 'GET');
export const getDashboardMetrics = () => callConsoleAdminApi<DashboardMetrics>('/api/dashboard/metrics', {}, 'GET');
export const getPlatformHealth = () => callConsoleAdminApi<PlatformHealthData>('/api/platform-health', {}, 'GET');
export const getOrganizationRegistryPage = (filters: OrganizationRegistryFilters = {}, cursor?: string) => {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.plan && filters.plan !== 'ALL') params.set('plan', filters.plan);
  if (filters.licenseStatus && filters.licenseStatus !== 'ALL') params.set('licenseStatus', filters.licenseStatus);
  if (filters.platformStatus && filters.platformStatus !== 'ALL') params.set('platformStatus', filters.platformStatus);
  if (filters.creationDate && filters.creationDate !== 'ALL') params.set('creationDate', filters.creationDate);
  if (filters.lifecycle && filters.lifecycle !== 'ALL') params.set('lifecycle', filters.lifecycle);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return callConsoleAdminApi<OrganizationRegistryPage>(`/api/organizations${query ? `?${query}` : ''}`, {}, 'GET');
};
export const getOrganization = (orgId: string) => callConsoleAdminApi<OrganizationOperationsDetail>(`/api/organizations/${orgId}`, {}, 'GET');
export const updateOrganizationProfile = (orgId: string, body: { name?: string; businessType?: string; currency?: string; timezone?: string; reason?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/organizations/${orgId}`, body, 'PATCH');
export type OrganizationRegistrationResetMode = 'KEEP_AUTH' | 'DELETE_AUTH';
export type OrganizationRegistrationResetResult = {
  organizationId: string;
  organizationAlreadyRemoved: boolean;
  resetMode: OrganizationRegistrationResetMode;
  removedMemberCount: number;
  removedInvitationCount: number;
  removedSlugRecordCount: number;
  removedBootstrapRecordCount: number;
  removedIdempotencyRecordCount: number;
  deletedAuthUserCount: number;
  foundingUsageReconciled: boolean;
  auditLogId: string;
};
/** SUPER_ADMIN-only destructive test-registration command. The server derives all affected identities and records. */
export const resetOrganizationRegistration = (orgId: string, body: { mode: OrganizationRegistrationResetMode; confirmation: string }) => callConsoleAdminApi<OrganizationRegistrationResetResult>(`/api/organizations/${encodeURIComponent(orgId)}/registration-reset`, body);
export const getOrganizationUsage = (orgId: string) => callConsoleAdminApi<OrganizationUsage & { viewerRole: 'SUPER_ADMIN' | 'SUPPORT' }>(`/api/organizations/${orgId}/usage`, {}, 'GET');
export const recalculateOrganizationUsage = (orgId: string) => callConsoleAdminApi<OrganizationUsage>(`/api/organizations/${orgId}/usage/recalculate`, {});
export const setOrganizationStorageLimit = (orgId: string, storageLimitBytes: number | null) => callConsoleAdminApi<OrganizationUsage>(`/api/organizations/${orgId}/usage/limit`, { storageLimitBytes }, 'PATCH');
export type ExistingOrganizationUser = { uid: string | null; email: string; name: string; pendingInvitation: boolean };
export const lookupOrganizationUser = (orgId: string, email: string) => callConsoleAdminApi<ExistingOrganizationUser>(`/api/organizations/${orgId}/members?email=${encodeURIComponent(email)}`, {}, 'GET');
export const addOrganizationMember = (orgId: string, body: { email: string; role: OrganizationMemberRole; reason?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/organizations/${orgId}/members`, body);
export const updateOrganizationMember = (orgId: string, uid: string, body: { role?: OrganizationMemberRole; status?: Lowercase<OrganizationMemberStatus>; reason?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/organizations/${orgId}/members/${encodeURIComponent(uid)}`, body, 'PATCH');
export type { ConsoleMembership } from './types';
export const getOrganizationMembershipPage = (organizationId: string, filters: OrganizationMembershipFilters = {}, cursor?: string) => {
  const params = new URLSearchParams({ organizationId });
  if (filters.query) params.set('query', filters.query);
  if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
  if (cursor) params.set('cursor', cursor);
  return callConsoleAdminApi<OrganizationMembershipPage>(`/api/users?${params.toString()}`, {}, 'GET');
};
/** @deprecated The active Console uses getSubscriptionOperationLicensePage. */
export const getLicensing = (filters: SubscriptionOperationLicenseFilters = {}, cursor?: string) => {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.plan && filters.plan !== 'ALL') params.set('plan', filters.plan);
  if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
  if (filters.renewalPeriod && filters.renewalPeriod !== 'ALL') params.set('renewalPeriod', filters.renewalPeriod);
  if (filters.trialExpiration && filters.trialExpiration !== 'ALL') params.set('trialExpiration', filters.trialExpiration);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return callConsoleAdminApi<SubscriptionOperationLicensePage>(`/api/licensing${query ? `?${query}` : ''}`, {}, 'GET');
};
export const getSubscriptionOperations = () => callConsoleAdminApi<{ overview: SubscriptionOperationsOverview }>('/api/subscription-operations', {}, 'GET');
export const getSubscriptionOperationLicensePage = (filters: SubscriptionOperationLicenseFilters = {}, cursor?: string) => {
  const params = new URLSearchParams();
  if (filters.query) params.set('query', filters.query);
  if (filters.plan && filters.plan !== 'ALL') params.set('plan', filters.plan);
  if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
  if (filters.renewalPeriod && filters.renewalPeriod !== 'ALL') params.set('renewalPeriod', filters.renewalPeriod);
  if (filters.trialExpiration && filters.trialExpiration !== 'ALL') params.set('trialExpiration', filters.trialExpiration);
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return callConsoleAdminApi<SubscriptionOperationLicensePage>(`/api/subscription-operations/licenses${query ? `?${query}` : ''}`, {}, 'GET');
};
export const getSubscriptionLicenseDetail = (orgId: string) => callConsoleAdminApi<SubscriptionLicenseDetail>(`/api/subscription-operations/${encodeURIComponent(orgId)}`, {}, 'GET');
export const getSubscriptionPlans = () => callConsoleAdminApi<ConsoleSubscriptionPlan[]>('/api/subscription-plans', {}, 'GET');
export const bootstrapSubscriptionPlans = () => callConsoleAdminApi<Record<string, unknown>>('/api/subscription-plans', {}, 'POST');
export const updateSubscriptionPlan = (planId: string, body: Partial<Pick<ConsoleSubscriptionPlan, 'displayName' | 'price' | 'currency' | 'billingInterval' | 'trialDays' | 'noCreditCardRequired' | 'publicSignup'>>) => callConsoleAdminApi<Record<string, unknown>>(`/api/subscription-plans/${encodeURIComponent(planId)}`, body, 'PATCH');
/** Console-only response from the narrow Founding-capacity mutation. */
export type FoundingCapacityMutationResult = {
  changed: boolean;
  plan: Pick<ConsoleSubscriptionPlan, 'planId' | 'code' | 'displayName' | 'foundingLimit' | 'maxEligibleCustomers' | 'publicSignup'>;
  usage: ConsoleSubscriptionPlan['usage'];
  canonicalEligibleCustomerCount: number;
  auditLogId: string | null;
};
export const updateFoundingCustomerLimit = (foundingLimit: number) => callConsoleAdminApi<FoundingCapacityMutationResult>('/api/subscription-plans/founding_100/capacity', { foundingLimit }, 'PATCH');
export type PlanMarketingMutationResult = { planId: string; marketing: ConsoleSubscriptionPlanMarketing | null; marketingRevision: number; marketingUpdatedAt: string; marketingUpdatedByUid: string; auditLogId: string };
export const updateSubscriptionPlanMarketing = (planId: string, marketing: ConsoleSubscriptionPlanMarketing, expectedRevision?: number) => callConsoleAdminApi<PlanMarketingMutationResult>(`/api/subscription-plans/${encodeURIComponent(planId)}/marketing`, { marketing, ...(expectedRevision === undefined ? {} : { expectedRevision }) }, 'PATCH');
export const clearSubscriptionPlanMarketing = (planId: string, expectedRevision?: number) => callConsoleAdminApi<PlanMarketingMutationResult>(`/api/subscription-plans/${encodeURIComponent(planId)}/marketing`, expectedRevision === undefined ? {} : { expectedRevision }, 'DELETE');
export const getAuditLogs = (limit = 25, cursor?: string, filters: PlatformAuditLogFilters = {}) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return callConsoleAdminApi<PlatformAuditLogPage>(`/api/audit-logs?${params.toString()}`, {}, 'GET');
};
export const createPlatformAdmin = (body: { uid: string; role: string; status?: string }) => callConsoleAdminApi<Record<string, unknown>>('/api/platform-admins', body);
export const updatePlatformAdmin = (uid: string, body: { role?: string; status?: string; displayName?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/platform-admins/${uid}`, body, 'PATCH');
