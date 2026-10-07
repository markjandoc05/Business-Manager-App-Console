import { adminAuth, adminDb, assertFirebaseProject } from './firebase-admin-core';
import { ApiError } from './api-errors';
import type { PlatformAdminRole } from '../types';

export interface AuthenticatedPlatformAdmin {
  uid: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
}

export async function requirePlatformAdminToken(token: string, roles: PlatformAdminRole[] = ['SUPER_ADMIN', 'SUPPORT']): Promise<AuthenticatedPlatformAdmin> {
  try { assertFirebaseProject(); } catch (error) { console.error(error instanceof Error ? error.message : 'Firebase project configuration error.'); throw new ApiError('CONSOLE_SERVER_CONFIG_ERROR', 'Unable to load platform data.', 500); }
  if (!token) throw new ApiError('UNAUTHENTICATED', 'A Firebase ID token is required.', 401);

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token, true);
  } catch {
    throw new ApiError('UNAUTHENTICATED', 'The Firebase ID token is invalid or expired.', 401);
  }

  const snapshot = await adminDb.collection('platformAdmins').doc(decoded.uid).get();
  if (!snapshot.exists) throw new ApiError('UNAUTHORIZED', 'The authenticated user is not a platform administrator.', 403);
  const data = snapshot.data() || {};
  if (data.status === 'DISABLED') throw new ApiError('ADMIN_DISABLED', 'This platform administrator account is disabled.', 403);
  if (data.status !== 'ACTIVE' || !roles.includes(data.role)) throw new ApiError('UNAUTHORIZED', 'The platform administrator is not authorized for this operation.', 403);

  return {
    uid: decoded.uid,
    email: decoded.email || (typeof data.email === 'string' ? data.email : ''),
    displayName: decoded.name || (typeof data.displayName === 'string' ? data.displayName : ''),
    role: data.role as PlatformAdminRole,
  };
}

export async function requirePlatformAdmin(request: { headers: { get(name: string): string | null } }, roles: PlatformAdminRole[] = ['SUPER_ADMIN', 'SUPPORT']) {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return requirePlatformAdminToken(token, roles);
}
