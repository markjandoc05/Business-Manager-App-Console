import { getStorage } from 'firebase-admin/storage';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin-core';
import { ApiError } from './api-errors';
import { validateOrganizationId } from './request';
import type { AuthenticatedPlatformAdmin } from './platform-admin';
import type { OrganizationUsage, OrganizationUsageBreakdown } from '../types';
import { estimateFirestoreDocumentBytes, summarizeStorageFiles, usageAttentionReason, usageStatus } from '../organization-usage';

const BUSINESS_COLLECTIONS = ['leads', 'clients', 'deals', 'tasks', 'activities', 'members'] as const;
const inFlightReconciliations = new Set<string>();
const COVERAGE_NOTES = [
  'Database estimate covers the organization, current license/settings, leads, clients, deals, tasks, activities and members. Sales, payments, catalog and nested histories/documents are excluded.',
  'File estimate covers only organization-scoped files; legacy files outside that namespace are excluded.',
];

function safeDate(value: unknown) {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return undefined;
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function safeInteger(value: unknown, fallback = 0) {
  return Math.max(0, Math.floor(safeNumber(value, fallback)));
}

function emptyBreakdown(): OrganizationUsageBreakdown { return { leads: 0, clients: 0, deals: 0, tasks: 0, activities: 0, members: 0, files: 0 }; }

export function storedUsage(data: Record<string, unknown> | undefined): OrganizationUsage {
  const storageBytes = safeNumber(data?.storageBytes);
  const storageLimitBytes = typeof data?.storageLimitBytes === 'number' && Number.isFinite(data.storageLimitBytes) && data.storageLimitBytes > 0 ? data.storageLimitBytes : null;
  const breakdownData = data?.breakdown && typeof data.breakdown === 'object' ? data.breakdown as Record<string, unknown> : {};
  const breakdown = { leads: safeInteger(breakdownData.leads), clients: safeInteger(breakdownData.clients), deals: safeInteger(breakdownData.deals), tasks: safeInteger(breakdownData.tasks), activities: safeInteger(breakdownData.activities), members: safeInteger(breakdownData.members), files: safeInteger(data?.fileCount ?? breakdownData.files) };
  const lastCalculatedAt = safeDate(data?.lastCalculatedAt);
  const usageAvailable = Boolean(lastCalculatedAt && Number.isFinite(Date.parse(lastCalculatedAt)))
    && typeof data?.totalBytesEstimated === 'number' && Number.isFinite(data.totalBytesEstimated) && data.totalBytesEstimated >= 0
    && typeof data?.firestoreBytesEstimated === 'number' && Number.isFinite(data.firestoreBytesEstimated) && data.firestoreBytesEstimated >= 0;
  const storageAvailable = usageAvailable && data?.storageAvailable === true
    && typeof data.storageBytes === 'number' && Number.isFinite(data.storageBytes) && data.storageBytes >= 0;
  const status = storageAvailable ? usageStatus(storageBytes, storageLimitBytes) : { usagePercent: null, status: 'UNAVAILABLE' as const };
  const usageCoverage = data?.usageCoverage === 'PARTIAL' ? 'PARTIAL' as const : 'UNKNOWN' as const;
  const usageNotes = [...COVERAGE_NOTES];
  if (!storageAvailable) usageNotes.push('File usage is unavailable or unverified. Recalculate with storage configured to measure organization files.');
  if (usageCoverage === 'UNKNOWN') usageNotes.push('This legacy summary has unverified coverage. Recalculate to refresh its coverage information.');
  return {
    usageAvailable,
    storageAvailable,
    usageCoverage,
    usageNotes,
    storageBytes,
    firestoreBytesEstimated: safeNumber(data?.firestoreBytesEstimated),
    totalBytesEstimated: safeNumber(data?.totalBytesEstimated, storageBytes + safeNumber(data?.firestoreBytesEstimated)),
    fileCount: safeInteger(data?.fileCount),
    recordCount: safeInteger(data?.recordCount),
    breakdown,
    storageLimitBytes,
    usagePercent: status.usagePercent,
    usageStatus: status.status,
    lastCalculatedAt,
    lastReconciledAt: safeDate(data?.lastReconciledAt),
  };
}

async function scanStorage(orgId: string) {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) return { storageAvailable: false, storageBytes: 0, fileCount: 0 };
  const [files] = await getStorage().bucket(bucketName).getFiles({ prefix: `organizations/${orgId}/` });
  if (files.some((file) => {
    const size = file.metadata.size;
    return !((typeof size === 'number' || (typeof size === 'string' && /^\d+$/.test(size))) && Number.isSafeInteger(Number(size)) && Number(size) >= 0);
  })) throw new ApiError('INTERNAL_ERROR', 'File sizes are unavailable. Existing usage data was preserved.', 503);
  return { ...summarizeStorageFiles(files), storageAvailable: true };
}

async function calculateUsage(orgId: string) {
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const [organizationSnapshot, licenseSnapshot, settingsSnapshot, ...collectionSnapshots] = await Promise.all([
    organizationRef.get(),
    organizationRef.collection('license').doc('current').get(),
    organizationRef.collection('settings').doc('settings').get(),
    ...BUSINESS_COLLECTIONS.map((collectionName) => organizationRef.collection(collectionName).get()),
  ]);
  if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
  const storage = await scanStorage(orgId);
  const breakdown = emptyBreakdown();
  const recordSizes = [estimateFirestoreDocumentBytes(organizationSnapshot.data() || {}), licenseSnapshot.exists ? estimateFirestoreDocumentBytes(licenseSnapshot.data() || {}) : 0, settingsSnapshot.exists ? estimateFirestoreDocumentBytes(settingsSnapshot.data() || {}) : 0];
  collectionSnapshots.forEach((snapshot, index) => {
    const collectionName = BUSINESS_COLLECTIONS[index];
    breakdown[collectionName] = snapshot.size;
    for (const document of snapshot.docs) recordSizes.push(estimateFirestoreDocumentBytes(document.data()));
  });
  breakdown.files = storage.fileCount;
  const firestoreBytesEstimated = recordSizes.reduce((total, size) => total + size, 0);
  const recordCount = BUSINESS_COLLECTIONS.reduce((total, collectionName) => total + breakdown[collectionName], 0);
  const totalBytesEstimated = storage.storageBytes + firestoreBytesEstimated;
  const timestamps = Timestamp.now();
  return {
    usageAvailable: true,
    storageAvailable: storage.storageAvailable,
    usageCoverage: 'PARTIAL' as const,
    storageBytes: storage.storageBytes,
    firestoreBytesEstimated,
    totalBytesEstimated,
    fileCount: storage.fileCount,
    recordCount,
    breakdown,
    lastCalculatedAt: timestamps.toDate().toISOString(),
    lastReconciledAt: timestamps.toDate().toISOString(),
    _timestamp: timestamps,
  };
}

export async function getOrganizationUsage(orgId: string) {
  validateOrganizationId(orgId);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const usageSnapshot = await organizationRef.collection('usage').doc('current').get();
  return storedUsage(usageSnapshot.exists ? usageSnapshot.data() : undefined);
}

export async function recalculateOrganizationUsage(orgId: string, actor: AuthenticatedPlatformAdmin) {
  validateOrganizationId(orgId);
  if (actor.role !== 'SUPER_ADMIN') throw new ApiError('UNAUTHORIZED', 'Only SUPER_ADMIN can recalculate organization usage.', 403);
  if (inFlightReconciliations.has(orgId)) throw new ApiError('CONFLICT', 'Usage calculation is already running for this organization.', 409);
  inFlightReconciliations.add(orgId);
  try {
    const organizationRef = adminDb.collection('organizations').doc(orgId);
    const usageRef = organizationRef.collection('usage').doc('current');
    const calculated = await calculateUsage(orgId);
    const auditRef = adminDb.collection('platformAuditLogs').doc();
    return await adminDb.runTransaction(async (transaction) => {
      const organizationSnapshot = await transaction.get(organizationRef);
      const currentUsageSnapshot = await transaction.get(usageRef);
      if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
      const currentUsage = currentUsageSnapshot.data() || {};
      const storageLimitBytes = typeof currentUsage.storageLimitBytes === 'number' && Number.isFinite(currentUsage.storageLimitBytes) && currentUsage.storageLimitBytes > 0 ? currentUsage.storageLimitBytes : null;
      const writeData = { ...currentUsage, storageAvailable: calculated.storageAvailable, usageCoverage: calculated.usageCoverage, storageBytes: calculated.storageBytes, firestoreBytesEstimated: calculated.firestoreBytesEstimated, totalBytesEstimated: calculated.totalBytesEstimated, fileCount: calculated.fileCount, recordCount: calculated.recordCount, breakdown: calculated.breakdown, storageLimitBytes, lastCalculatedAt: calculated._timestamp, lastReconciledAt: calculated._timestamp, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid };
      transaction.set(usageRef, writeData);
      transaction.set(auditRef, { action: 'ORGANIZATION_USAGE_RECALCULATED', actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role, targetType: 'ORGANIZATION_USAGE', targetId: orgId, organizationId: orgId, previousValue: currentUsageSnapshot.exists ? currentUsageSnapshot.data() : null, newValue: { storageAvailable: calculated.storageAvailable, usageCoverage: calculated.usageCoverage, storageBytes: calculated.storageBytes, firestoreBytesEstimated: calculated.firestoreBytesEstimated, totalBytesEstimated: calculated.totalBytesEstimated, fileCount: calculated.fileCount, recordCount: calculated.recordCount, breakdown: calculated.breakdown, storageLimitBytes }, metadata: {}, createdAt: FieldValue.serverTimestamp() });
      return storedUsage({ ...writeData, lastCalculatedAt: calculated.lastCalculatedAt, lastReconciledAt: calculated.lastReconciledAt });
    });
  } finally { inFlightReconciliations.delete(orgId); }
}

export async function setOrganizationStorageLimit(orgId: string, storageLimitBytes: number | null, actor: AuthenticatedPlatformAdmin) {
  validateOrganizationId(orgId);
  if (actor.role !== 'SUPER_ADMIN') throw new ApiError('UNAUTHORIZED', 'Only SUPER_ADMIN can set organization storage limits.', 403);
  if (storageLimitBytes !== null && (!Number.isInteger(storageLimitBytes) || storageLimitBytes <= 0)) throw new ApiError('INVALID_REQUEST', 'storageLimitBytes must be a positive integer or null.', 400);
  const organizationRef = adminDb.collection('organizations').doc(orgId);
  const usageRef = organizationRef.collection('usage').doc('current');
  const auditRef = adminDb.collection('platformAuditLogs').doc();
  let result: OrganizationUsage | undefined;
  await adminDb.runTransaction(async (transaction) => {
    const organizationSnapshot = await transaction.get(organizationRef);
    const usageSnapshot = await transaction.get(usageRef);
    if (!organizationSnapshot.exists) throw new ApiError('NOT_FOUND', 'Organization not found.', 404);
    const before = usageSnapshot.exists ? usageSnapshot.data() || {} : {};
    transaction.set(usageRef, { storageLimitBytes, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
    transaction.set(auditRef, { action: 'ORGANIZATION_STORAGE_LIMIT_UPDATED', actorUid: actor.uid, actorEmail: actor.email, actorRole: actor.role, targetType: 'ORGANIZATION_USAGE', targetId: orgId, organizationId: orgId, previousValue: { storageLimitBytes: before.storageLimitBytes ?? null }, newValue: { storageLimitBytes }, metadata: {}, createdAt: FieldValue.serverTimestamp() });
    result = storedUsage({ ...before, storageLimitBytes });
  });
  return result;
}

export { usageAttentionReason };
