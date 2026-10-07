import { FieldValue, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { enumValue, requiredString, validateOrganizationId } from './request';
import type { AuthenticatedPlatformAdmin } from './platform-admin';
import { CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION } from './subscription-license-service';
import { reconcileSubscriptionPlanUsage } from './subscription-plan-service';

const RESET_MODES = ['KEEP_AUTH', 'DELETE_AUTH'] as const;
const MAX_AUTH_USERS_PER_RESET = 1_000;

export type OrganizationRegistrationResetMode = typeof RESET_MODES[number];

export interface OrganizationRegistrationResetResult {
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
}

interface ResetPreflight {
  organizationRef: DocumentReference;
  organizationId: string;
  organizationAlreadyRemoved: boolean;
  memberUids: string[];
  memberCount: number;
  planId: string | null;
  invitationRefs: DocumentReference[];
  slugRefs: DocumentReference[];
  bootstrapRefs: DocumentReference[];
  idempotencyRefs: DocumentReference[];
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) throw new ApiError('INVALID_REQUEST', `Unsupported field: ${unknown}.`, 400);
}

function safeUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  // Firebase Authentication UIDs are bounded and cannot contain a path
  // separator. Do not use an arbitrary member value as an Auth deletion key.
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : null;
}

function memberUid(member: QueryDocumentSnapshot): string | null {
  const stored = safeUserId(member.data()?.userId);
  const documentId = safeUserId(member.id);
  // Current V1 membership documents use uid as both the document ID and
  // `userId`. Document-ID-only records are supported for legacy V1 data, but
  // mismatched identifiers fail closed for the Auth-deletion mode.
  if (stored && stored === documentId) return stored;
  if (!stored && documentId) return documentId;
  return null;
}

function organizationIdForMember(member: QueryDocumentSnapshot): string | null {
  const organizationId = member.ref.parent.parent?.id;
  try { return organizationId ? validateOrganizationId(organizationId) : null; }
  catch { return null; }
}

function uniqueReferences(references: DocumentReference[]) {
  return [...new Map(references.map((reference) => [reference.path, reference])).values()];
}

function resetModeFor(body: Record<string, unknown>, organizationId: string): OrganizationRegistrationResetMode {
  rejectUnknownFields(body, ['mode', 'confirmation']);
  const mode = enumValue(body.mode, 'mode', RESET_MODES);
  if (requiredString(body, 'confirmation') !== organizationId) {
    throw new ApiError('INVALID_REQUEST', 'Confirmation must exactly match the organization ID.', 400);
  }
  return mode;
}

function idempotencyTargetsOrganization(data: Record<string, unknown>, organizationId: string) {
  const result = data.result;
  return Boolean(result && typeof result === 'object' && !Array.isArray(result)
    && (result as Record<string, unknown>).organizationId === organizationId);
}

async function deleteReferences(references: DocumentReference[]) {
  const unique = uniqueReferences(references);
  for (let index = 0; index < unique.length; index += 450) {
    const batch = adminDb.batch();
    for (const reference of unique.slice(index, index + 450)) batch.delete(reference);
    await batch.commit();
  }
}

async function assertAuthUsersAreExclusiveToOrganization(organizationId: string, memberUids: string[]) {
  if (memberUids.length > MAX_AUTH_USERS_PER_RESET) {
    throw new ApiError('CONFLICT', 'This organization has too many members for a registration reset. Use the approved data-retention process.', 409);
  }
  if (!memberUids.length) return;

  const [allMemberships, platformAdminSnapshots] = await Promise.all([
    // This trusted, server-only cross-organization check examines only
    // membership identifiers. It never returns membership or CRM data to the
    // caller, and it makes Auth deletion fail closed for legacy records too.
    adminDb.collectionGroup('members').get(),
    Promise.all(memberUids.map((uid) => adminDb.collection('platformAdmins').doc(uid).get())),
  ]);

  if (platformAdminSnapshots.some((snapshot) => snapshot.exists)) {
    throw new ApiError('CONFLICT', 'A registration reset cannot delete a platform administrator account.', 409);
  }

  const membershipOrganizationIds = new Map<string, Set<string>>();
  for (const membership of allMemberships.docs) {
    const membershipOrganizationId = organizationIdForMember(membership);
    if (!membershipOrganizationId) continue;
    const data = membership.data() || {};
    for (const candidate of [safeUserId(data.userId), safeUserId(membership.id)]) {
      if (!candidate || !memberUids.includes(candidate)) continue;
      const organizations = membershipOrganizationIds.get(candidate) || new Set<string>();
      organizations.add(membershipOrganizationId);
      membershipOrganizationIds.set(candidate, organizations);
    }
  }

  if (memberUids.some((uid) => [...(membershipOrganizationIds.get(uid) || [])].some((candidate) => candidate !== organizationId))) {
    throw new ApiError('CONFLICT', 'A registration reset cannot delete an account that belongs to another organization.', 409);
  }
}

async function buildResetPreflight(organizationId: string, mode: OrganizationRegistrationResetMode): Promise<ResetPreflight> {
  const orgId = validateOrganizationId(organizationId);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const [organizationSnapshot, invitationsSnapshot, slugsSnapshot, bootstrapByOrganizationSnapshot, idempotencyByOrganizationSnapshot] = await Promise.all([
    organizationRef.get(),
    adminDb.collection('organizationInvitations').where('organizationId', '==', orgId).get(),
    adminDb.collection('organizationSlugs').where('organizationId', '==', orgId).get(),
    adminDb.collection('workspaceBootstrap').where('organizationId', '==', orgId).get(),
    adminDb.collection(CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION).where('result.organizationId', '==', orgId).get(),
  ]);

  const organizationAlreadyRemoved = !organizationSnapshot.exists;
  if (organizationAlreadyRemoved
    && !invitationsSnapshot.size
    && !slugsSnapshot.size
    && !bootstrapByOrganizationSnapshot.size
    && !idempotencyByOrganizationSnapshot.size) {
    throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  }
  const [membersSnapshot, licenseSnapshot] = organizationAlreadyRemoved
    ? [null, null]
    : await Promise.all([
      organizationRef.collection('members').get(),
      organizationRef.collection('license').doc('current').get(),
    ]);

  const memberUids = membersSnapshot?.docs.map(memberUid) || [];
  if (mode === 'DELETE_AUTH' && memberUids.some((uid) => !uid)) {
    throw new ApiError('CONFLICT', 'A registration reset cannot safely identify every organization member.', 409);
  }
  const resolvedMemberUids = [...new Set(memberUids.filter((uid): uid is string => Boolean(uid)))];

  if (mode === 'DELETE_AUTH') await assertAuthUsersAreExclusiveToOrganization(orgId, resolvedMemberUids);

  // Modern records can be found by their organization ID. The per-member
  // fallback also clears older valid replay/bootstrap records whose nested
  // result predates that queryable field.
  const perMemberLinks = await Promise.all(resolvedMemberUids.map(async (uid) => {
    const [bootstrap, idempotency] = await Promise.all([
      adminDb.collection('workspaceBootstrap').doc(uid).get(),
      adminDb.collection(CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION).where('uid', '==', uid).get(),
    ]);
    return { bootstrap, idempotency };
  }));
  const bootstrapRefs = uniqueReferences([
    ...bootstrapByOrganizationSnapshot.docs.map((document) => document.ref),
    ...perMemberLinks.flatMap(({ bootstrap }) => bootstrap.exists && bootstrap.data()?.organizationId === orgId ? [bootstrap.ref] : []),
  ]);
  const idempotencyRefs = uniqueReferences([
    ...idempotencyByOrganizationSnapshot.docs.map((document) => document.ref),
    ...perMemberLinks.flatMap(({ idempotency }) => idempotency.docs
      .filter((document) => idempotencyTargetsOrganization(document.data() || {}, orgId))
      .map((document) => document.ref)),
  ]);
  const licenseData = licenseSnapshot?.exists ? licenseSnapshot.data() || {} : {};

  return {
    organizationRef,
    organizationId: orgId,
    organizationAlreadyRemoved,
    memberUids: resolvedMemberUids,
    memberCount: membersSnapshot?.size || 0,
    planId: licenseData.planId === 'founding_100' ? 'founding_100' : null,
    invitationRefs: invitationsSnapshot.docs.map((document) => document.ref),
    slugRefs: slugsSnapshot.docs.map((document) => document.ref),
    bootstrapRefs,
    idempotencyRefs,
  };
}

async function writeResetAudit(
  organizationId: string,
  actor: AuthenticatedPlatformAdmin,
  mode: OrganizationRegistrationResetMode,
  result: 'SUCCESS' | 'FAILED' | 'DENIED',
  metadata: Record<string, unknown>,
) {
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  await auditRef.set({
    action: 'ORGANIZATION_REGISTRATION_RESET',
    actorUid: actor.uid,
    actorRole: actor.role,
    targetType: 'ORGANIZATION',
    targetId: organizationId,
    organizationId,
    result,
    metadata: { registrationReset: true, resetMode: mode, ...metadata },
    createdAt: FieldValue.serverTimestamp(),
  });
  return auditRef.id;
}

/**
 * Permanently removes one organization’s Firestore subtree and the small set
 * of platform-owned provisioning links that could otherwise block a fresh
 * signup. Auth accounts are removed only in DELETE_AUTH mode after a
 * server-side proof that they have no other organization or platform access.
 *
 * This is intentionally a SUPER_ADMIN-only test-registration workflow, not a
 * general retention/deletion subsystem. It never returns CRM documents,
 * member emails, Auth profile data, or raw linked records.
 */
export async function resetOrganizationForRegistration(
  organizationId: string,
  body: Record<string, unknown>,
  actor: AuthenticatedPlatformAdmin,
): Promise<OrganizationRegistrationResetResult> {
  if (actor.role !== 'SUPER_ADMIN') throw new ApiError('UNAUTHORIZED', 'Only SUPER_ADMIN can reset an organization registration.', 403);
  const orgId = validateOrganizationId(organizationId);
  const mode = resetModeFor(body, orgId);

  let preflight: ResetPreflight;
  try {
    preflight = await buildResetPreflight(orgId, mode);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 404) {
      try { await writeResetAudit(orgId, actor, mode, 'DENIED', { denied: true }); }
      catch { /* Audit availability must not turn a denied destructive request into a reset. */ }
    }
    throw error;
  }

  try {
    let deletedAuthUserCount = 0;
    if (mode === 'DELETE_AUTH' && preflight.memberUids.length) {
      const deletion = await adminAuth.deleteUsers(preflight.memberUids);
      if (deletion.failureCount > 0) {
        throw new ApiError('CONFLICT', 'The eligible Firebase Authentication accounts could not all be removed. Organization records were retained, but some accounts may already have been deleted; review platform audit logs before retrying.', 409);
      }
      deletedAuthUserCount = deletion.successCount;
    }

    // Remove global replay/bootstrap/invitation records first. Keep the slug
    // reservation until the organization subtree is gone so another signup
    // cannot claim it while the old workspace still exists. If a prior
    // request reached the root deletion but failed afterwards, the route can
    // safely resume only these global cleanups without touching Auth again.
    await deleteReferences([
      ...preflight.invitationRefs,
      ...preflight.bootstrapRefs,
      ...preflight.idempotencyRefs,
    ]);
    if (mode === 'DELETE_AUTH') {
      await deleteReferences(preflight.memberUids.map((uid) => adminDb.collection('users').doc(uid)));
    }
    await adminDb.recursiveDelete(preflight.organizationRef);
    await deleteReferences(preflight.slugRefs);

    let foundingUsageReconciled = false;
    if (preflight.planId === 'founding_100' || preflight.organizationAlreadyRemoved) {
      await reconcileSubscriptionPlanUsage('founding_100');
      foundingUsageReconciled = true;
    }

    const auditLogId = await writeResetAudit(orgId, actor, mode, 'SUCCESS', {
      removedMemberCount: preflight.memberCount,
      removedInvitationCount: preflight.invitationRefs.length,
      removedSlugRecordCount: preflight.slugRefs.length,
      removedBootstrapRecordCount: preflight.bootstrapRefs.length,
      removedIdempotencyRecordCount: preflight.idempotencyRefs.length,
      deletedAuthUserCount,
      foundingUsageReconciled,
    });
    return {
      organizationId: orgId,
      organizationAlreadyRemoved: preflight.organizationAlreadyRemoved,
      resetMode: mode,
      removedMemberCount: preflight.memberCount,
      removedInvitationCount: preflight.invitationRefs.length,
      removedSlugRecordCount: preflight.slugRefs.length,
      removedBootstrapRecordCount: preflight.bootstrapRefs.length,
      removedIdempotencyRecordCount: preflight.idempotencyRefs.length,
      deletedAuthUserCount,
      foundingUsageReconciled,
      auditLogId,
    };
  } catch (error) {
    try { await writeResetAudit(orgId, actor, mode, 'FAILED', { failed: true }); }
    catch { /* Preserve the original error; this catch never retries deletion. */ }
    if (error instanceof ApiError) throw error;
    throw new ApiError('CONFLICT', 'The registration reset did not complete. Review platform audit logs before retrying.', 409);
  }
}
