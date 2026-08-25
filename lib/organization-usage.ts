import type { OrganizationUsageStatus } from './types';

export function estimateFirestoreDocumentBytes(data: unknown): number {
  const serialized = JSON.stringify(normalizeValue(data));
  return new TextEncoder().encode(serialized === undefined ? 'null' : serialized).length;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalizeValue(item)]));
  return String(value);
}

export function usageStatus(storageBytes: number, storageLimitBytes: number | null): { usagePercent: number | null; status: OrganizationUsageStatus } {
  if (!storageLimitBytes || storageLimitBytes <= 0) return { usagePercent: null, status: 'NO_LIMIT' };
  const usagePercent = Math.round((Math.max(0, storageBytes) / storageLimitBytes) * 1000) / 10;
  return { usagePercent, status: usagePercent >= 100 ? 'FULL' : usagePercent >= 90 ? 'HIGH' : usagePercent >= 80 ? 'WARNING' : 'NORMAL' };
}

export function formatBytes(bytes: number | null | undefined): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = units[0];
  for (let index = 0; index < units.length && amount >= 1024; index += 1) { amount /= 1024; unit = units[index]; }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

export function usageAttentionReason(status: OrganizationUsageStatus): 'STORAGE_USAGE_WARNING' | 'STORAGE_USAGE_HIGH' | 'STORAGE_LIMIT_REACHED' | undefined {
  return status === 'FULL' ? 'STORAGE_LIMIT_REACHED' : status === 'HIGH' ? 'STORAGE_USAGE_HIGH' : status === 'WARNING' ? 'STORAGE_USAGE_WARNING' : undefined;
}

export function summarizeStorageFiles(files: Array<{ metadata?: { size?: unknown } }>) {
  return files.reduce((result, file) => {
    const size = Number(file.metadata?.size || 0);
    if (Number.isFinite(size) && size > 0) result.storageBytes += size;
    result.fileCount += 1;
    return result;
  }, { storageBytes: 0, fileCount: 0 });
}
