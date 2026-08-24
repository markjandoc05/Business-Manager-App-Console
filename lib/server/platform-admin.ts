import { adminAuth, adminDb, assertFirebaseProject } from './firebase-admin';
import { ApiError } from './api-errors';
import { NextRequest } from 'next/server';
import { PlatformAdminRole } from '@/lib/types';

export interface AuthenticatedPlatformAdmin {
  uid: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
}

export async function requirePlatformAdmin(request: NextRequest, roles: PlatformAdminRole[] = ['SUPER_ADMIN', 'SUPPORT']): Promise<AuthenticatedPlatformAdmin> {
  try { assertFirebaseProject(); } catch (error) { console.error(error instanceof Error ? error.message : 'Firebase project configuration error.'); throw new ApiError('INTERNAL_ERROR', 'Server Firebase project configuration is invalid.', 500); }
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError('UNAUTHENTICATED', 'A Firebase ID token is required.', 401);

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
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
