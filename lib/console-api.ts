import { getIdToken, signOut } from 'firebase/auth';
import { firebaseAuth } from './firebase';

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
export const activateLicense = (orgId: string, body: { planId: string; seatLimit: number; expiresAt: string }) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/activate`, body);
export const extendTrial = (orgId: string, trialEndsAt: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/extend-trial`, { trialEndsAt });
export const changePlan = (orgId: string, planId: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/plan`, { planId }, 'PATCH');
export const changeSeatLimit = (orgId: string, seatLimit: number) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/seat-limit`, { seatLimit }, 'PATCH');
export const suspendOrganization = (orgId: string, reason?: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/suspend`, { reason });
export const reactivateOrganization = (orgId: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/reactivate`);
export const cancelLicense = (orgId: string, effectiveAt?: string) => callConsoleAdminApi<LicenseMutationResult>(`/api/organizations/${orgId}/license/cancel`, { effectiveAt });
export const getPlatformAdmins = () => callConsoleAdminApi<Record<string, unknown>[]>('/api/platform-admins', {}, 'GET');
export const createPlatformAdmin = (body: { uid: string; role: string; status?: string }) => callConsoleAdminApi<Record<string, unknown>>('/api/platform-admins', body);
export const updatePlatformAdmin = (uid: string, body: { role?: string; status?: string; displayName?: string }) => callConsoleAdminApi<Record<string, unknown>>(`/api/platform-admins/${uid}`, body, 'PATCH');
