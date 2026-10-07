import { adminAuth, adminDb, assertFirebaseProject } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { validateOrganizationId } from './request';

export interface AuthenticatedOrganizationMember {
  uid: string;
  email: string;
  organizationId: string;
  role: string;
}

export interface AuthenticatedClientUser {
  uid: string;
  email: string;
  displayName: string;
}

/**
 * Client App authorization is deliberately independent from platform-admin
 * authorization. A caller must be an active member of the requested tenant;
 * platform-admin status never grants Client App tenant access here.
 */
export async function requireActiveOrganizationMemberToken(
  token: string,
  organizationId: string,
  roles: string[] = ['ADMIN'],
): Promise<AuthenticatedOrganizationMember> {
  const orgId = validateOrganizationId(organizationId);
  const decoded = await requireAuthenticatedClientToken(token, true);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const memberSnapshot = await organizationRef.collection('members').doc(decoded.uid).get();
  const member = memberSnapshot.data() || {};
  const role = typeof member.role === 'string' ? member.role : '';
  const status = typeof member.status === 'string' ? member.status.toLowerCase() : '';
  if (!memberSnapshot.exists || status !== 'active' || !roles.includes(role)) {
    throw new ApiError('UNAUTHORIZED', 'The authenticated user is not authorized for this organization.', 403);
  }
  const organizationSnapshot = await organizationRef.get();
  if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  return { uid: decoded.uid, email: decoded.email || '', organizationId: orgId, role };
}

export function assertActiveClientProfile(uid: string, data: Record<string, unknown> | undefined, exists: boolean, allowMissing = false, allowPendingOnboarding = false) {
  // First-time trial provisioning creates the profile atomically. An existing
  // blocked profile can never be revived; a canonical pending identity may
  // activate only through transaction-proven first-time provisioning.
  if (!exists && allowMissing) return;
  if (allowPendingOnboarding && exists && data?.uid === uid && data.status === 'pending' && data.active === false) return;
  if (!exists || data?.uid !== uid || data.status !== 'active' || (Object.prototype.hasOwnProperty.call(data, 'active') && data.active !== true)) {
    throw new ApiError('UNAUTHORIZED', 'This application account is not active.', 403);
  }
}

export async function requireAuthenticatedClientToken(token: string, requireProfile = false, allowPendingOnboarding = false): Promise<AuthenticatedClientUser> {
  try { assertFirebaseProject(); } catch { throw new ApiError('CONSOLE_SERVER_CONFIG_ERROR', 'Unable to load platform data.', 500); }
  if (!token) throw new ApiError('UNAUTHENTICATED', 'A Firebase ID token is required.', 401);
  let decoded;
  try {
    // checkRevoked=true keeps the transport contract fail-closed for a token
    // revoked by Firebase Auth, rather than accepting it until natural expiry.
    decoded = await adminAuth.verifyIdToken(token, true);
  } catch {
    throw new ApiError('UNAUTHENTICATED', 'The Firebase ID token is invalid or expired.', 401);
  }
  const profile = await adminDb.collection('users').doc(decoded.uid).get();
  assertActiveClientProfile(decoded.uid, profile.data(), profile.exists, !requireProfile, allowPendingOnboarding);
  return { uid: decoded.uid, email: decoded.email || '', displayName: decoded.name || decoded.email || 'User' };
}

export function bearerToken(request: { headers: { get(name: string): string | null } }) {
  const header = request.headers.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
