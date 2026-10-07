import type { QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';

/**
 * Canonical licenses are stored only at `organizations/{organizationId}/license/current`.
 *
 * Firestore's production project intentionally has no collection-group index
 * for `license.planId`.  A field-filtered collection-group query therefore
 * fails at runtime.  The platform needs an exact, server-side count for the
 * capped Founding 100 product, so it reads the canonical-license group and
 * filters the small, platform-owned V1 dataset in trusted server code instead.
 * No browser receives these records or controls the predicate.
 */
function currentLicenseForPlan(document: QueryDocumentSnapshot, planId: string) {
  return document.id === 'current' && document.data().planId === planId;
}

/** Reads only canonical `license/current` documents, never tenant CRM data. */
export async function listCanonicalLicenseDocuments() {
  const snapshot = await adminDb.collectionGroup('license').get();
  return snapshot.docs.filter((document) => document.id === 'current');
}

export async function listCanonicalLicenseDocumentsForPlan(planId: string) {
  return (await listCanonicalLicenseDocuments()).filter((document) => currentLicenseForPlan(document, planId));
}

export async function listCanonicalLicenseDocumentsForPlanInTransaction(
  transaction: Transaction,
  planId: string,
) {
  const snapshot = await transaction.get(adminDb.collectionGroup('license'));
  return snapshot.docs.filter((document) => currentLicenseForPlan(document, planId));
}
