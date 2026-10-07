import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { ApiError } from './api-errors';
import { AuthenticatedPlatformAdmin } from './platform-admin';
import { enumValue, requiredString, readJsonBody } from './request';
import { NextRequest } from 'next/server';
import type { PlatformAdminPage } from '../types';

const ROLES = ['SUPER_ADMIN', 'SUPPORT'] as const;
const STATUSES = ['ACTIVE', 'DISABLED'] as const;

const PLATFORM_ADMIN_PAGE_SIZE = 25;

/** Bounded platform-admin directory page; no browser-side full directory load. */
export async function listPlatformAdminPage(cursor?: string): Promise<PlatformAdminPage> {
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512 || cursor.includes('/'))) {
    throw new ApiError('INVALID_REQUEST', 'Invalid platform administrator pagination cursor.', 400);
  }
  let query = adminDb.collection('platformAdmins').orderBy(FieldPath.documentId()).limit(PLATFORM_ADMIN_PAGE_SIZE + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const items = snapshot.docs.slice(0, PLATFORM_ADMIN_PAGE_SIZE).map((item) => {
    const data = item.data();
    const date = (value: unknown) => value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate().toISOString() : undefined;
    return {
      uid: item.id,
      email: typeof data.email === 'string' ? data.email : undefined,
      // The Console never needs to render an opaque Firebase UID as a name.
      displayName: typeof data.displayName === 'string' && data.displayName.trim()
        ? data.displayName.trim()
        : typeof data.email === 'string' && data.email.trim()
          ? data.email.trim()
          : 'Unnamed platform administrator',
      role: data.role === 'SUPER_ADMIN' || data.role === 'SUPPORT' ? data.role : undefined,
      status: data.status === 'ACTIVE' || data.status === 'DISABLED' ? data.status : undefined,
      createdAt: date(data.createdAt),
      updatedAt: date(data.updatedAt),
    };
  });
  const hasMore = snapshot.docs.length > PLATFORM_ADMIN_PAGE_SIZE;
  const nextCursor = hasMore ? items.at(-1)?.uid : undefined;
  return { items, ...(nextCursor ? { nextCursor } : {}), hasMore };
}

export async function createPlatformAdmin(request: NextRequest, actor: AuthenticatedPlatformAdmin) {
  const body = await readJsonBody(request);
  const uid = requiredString(body, 'uid');
  const role = enumValue(body.role, 'role', ROLES);
  const status = enumValue(body.status ?? 'ACTIVE', 'status', STATUSES);
  const authUser = await adminAuth.getUser(uid).catch(() => { throw new ApiError('NOT_FOUND', 'Firebase Authentication user not found.', 404); });
  const ref = adminDb.collection('platformAdmins').doc(uid);
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  await adminDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) throw new ApiError('CONFLICT', 'A platform administrator record already exists for this UID.', 409);
    transaction.set(ref, { email: authUser.email || '', displayName: authUser.displayName || '', role, status, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: actor.uid, updatedBy: actor.uid });
    transaction.set(auditRef, {
      action: 'PLATFORM_ADMIN_ADDED',
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'PLATFORM_ADMIN',
      targetId: uid,
      metadata: { role, status },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { uid, email: authUser.email || '', displayName: authUser.displayName || '', role, status };
}

export async function updatePlatformAdmin(request: NextRequest, uid: string, actor: AuthenticatedPlatformAdmin) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(uid)) throw new ApiError('INVALID_REQUEST', 'Invalid platform administrator UID.', 400);
  const body = await readJsonBody(request);
  const role = body.role === undefined ? undefined : enumValue(body.role, 'role', ROLES);
  const status = body.status === undefined ? undefined : enumValue(body.status, 'status', STATUSES);
  if (body.displayName !== undefined && (typeof body.displayName !== 'string' || !body.displayName.trim())) throw new ApiError('INVALID_REQUEST', 'displayName must be a non-empty string.', 400);
  const ref = adminDb.collection('platformAdmins').doc(uid);
  const result = await adminDb.runTransaction(async (transaction) => {
    const targetSnapshot = await transaction.get(ref);
    if (!targetSnapshot.exists) throw new ApiError('NOT_FOUND', 'Platform administrator not found.', 404);
    const current = targetSnapshot.data() || {};
    const adminsSnapshot = await transaction.get(adminDb.collection('platformAdmins'));
    const activeSuperAdmins = adminsSnapshot.docs.filter((item) => item.data().role === 'SUPER_ADMIN' && item.data().status === 'ACTIVE');
    const removingSuperAdmin = current.role === 'SUPER_ADMIN' && current.status === 'ACTIVE' && (role === 'SUPPORT' || status === 'DISABLED');
    if (removingSuperAdmin && activeSuperAdmins.length <= 1) throw new ApiError('CONFLICT', 'The last active SUPER_ADMIN cannot be disabled or demoted.', 409);
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
    const next = { ...current, ...(role ? { role } : {}), ...(status ? { status } : {}), ...(displayName ? { displayName } : {}), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid };
    transaction.set(ref, next, { merge: true });
    const auditRef = adminDb.collection('platformAuditLogs').doc();
    const auditAction = status === 'DISABLED' ? 'PLATFORM_ADMIN_DISABLED' : status === 'ACTIVE' && current.status === 'DISABLED' ? 'PLATFORM_ADMIN_REACTIVATED' : role && role !== current.role ? 'PLATFORM_ADMIN_ROLE_CHANGED' : 'PLATFORM_ADMIN_UPDATED';
    transaction.set(auditRef, {
      action: auditAction,
      actorUid: actor.uid,
      actorRole: actor.role,
      targetType: 'PLATFORM_ADMIN',
      targetId: uid,
      metadata: {
        previousRole: current.role,
        nextRole: next.role,
        previousStatus: current.status,
        nextStatus: next.status,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { uid, email: typeof current.email === 'string' ? current.email : '', displayName: next.displayName, role: next.role, status: next.status };
  });
  return result;
}
