'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, File, HardDrive, RefreshCw, Settings2 } from 'lucide-react';
import { ConsoleApiError, getOrganizationUsage, recalculateOrganizationUsage, setOrganizationStorageLimit } from '@/lib/console-api';
import type { OrganizationUsage } from '@/lib/types';
import { formatBytes } from '@/lib/organization-usage';
import { CompactBadge, CompactIconButton, ConfirmActionDialog, ErrorState, formatDate } from './ConsolePrimitives';

const MB = 1024 * 1024;
const LIMIT_PRESETS = [{ value: 'NONE', label: 'No limit configured', bytes: null }, { value: '500MB', label: '500 MB', bytes: 500 * MB }, { value: '1GB', label: '1 GB', bytes: 1024 * MB }, { value: '5GB', label: '5 GB', bytes: 5 * 1024 * MB }, { value: '10GB', label: '10 GB', bytes: 10 * 1024 * MB }] as const;

function usageTone(status: OrganizationUsage['usageStatus']) { return status === 'FULL' ? 'danger' as const : status === 'HIGH' ? 'warning' as const : status === 'WARNING' ? 'warning' as const : status === 'NORMAL' ? 'success' as const : 'neutral' as const; }
function statusLabel(status: OrganizationUsage['usageStatus']) { return status === 'NO_LIMIT' ? 'No limit' : status.charAt(0) + status.slice(1).toLowerCase(); }

export function OrganizationUsageSection({ orgId, isSuperAdmin }: { orgId: string; isSuperAdmin: boolean }) {
  const [usage, setUsage] = useState<OrganizationUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recalculateOpen, setRecalculateOpen] = useState(false);
  const [recalculateBusy, setRecalculateBusy] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitSelection, setLimitSelection] = useState('NONE');
  const [customLimitMb, setCustomLimitMb] = useState('');
  const [limitError, setLimitError] = useState<string | null>(null);
  // Clear privileged drafts when the external authorization profile changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!(isSuperAdmin)) { setRecalculateOpen(false); setLimitOpen(false); setLimitError(null); } }, [isSuperAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getOrganizationUsage(orgId);
      setUsage(result);
      const preset = LIMIT_PRESETS.find((item) => item.bytes === result.storageLimitBytes);
      setLimitSelection(preset?.value || 'CUSTOM');
      setCustomLimitMb(result.storageLimitBytes && !preset ? String(Math.round(result.storageLimitBytes / MB)) : '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load organization usage.'); }
    finally { setLoading(false); }
  }, [orgId]);
  // Usage data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const recalculate = async () => {
    setRecalculateBusy(true);
    setMessage(null);
    try { setUsage(await recalculateOrganizationUsage(orgId)); setRecalculateOpen(false); setMessage('Known usage estimates refreshed. Coverage is partial.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Unable to recalculate usage. Existing usage data was preserved.'); }
    finally { setRecalculateBusy(false); }
  };

  const selectedLimit = useMemo(() => limitSelection === 'CUSTOM' ? (Number(customLimitMb) > 0 ? Math.round(Number(customLimitMb) * MB) : null) : LIMIT_PRESETS.find((item) => item.value === limitSelection)?.bytes ?? null, [customLimitMb, limitSelection]);
  const saveLimit = async () => {
    if (limitSelection === 'CUSTOM' && (!Number.isFinite(Number(customLimitMb)) || Number(customLimitMb) <= 0)) { setLimitError('Enter a storage limit greater than zero.'); return; }
    setLimitBusy(true); setLimitError(null); setMessage(null);
    try { setUsage(await setOrganizationStorageLimit(orgId, selectedLimit)); setLimitOpen(false); setMessage('Storage limit updated. It is informational only and does not block usage.'); }
    catch (reason) { setLimitError(reason instanceof Error ? reason.message : 'Unable to update the storage limit.'); }
    finally { setLimitBusy(false); }
  };

  const progress = usage?.usagePercent === null || usage?.usagePercent === undefined ? 0 : Math.min(100, usage.usagePercent);
  return <><section className="rounded-xl border border-gray-200 bg-white p-4" id="data-storage"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-black text-gray-950">Data &amp; Storage</h2>{usage?.usageAvailable && <CompactBadge label={statusLabel(usage.usageStatus)} tone={usageTone(usage.usageStatus)} />}</div><p className="mt-1 text-sm text-gray-500">Operational usage estimates only—not Firebase or Google Cloud billing, invoicing, or customer charges. Record contents are never shown.</p></div>{isSuperAdmin && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setMessage(null); setRecalculateOpen(true); }} disabled={recalculateBusy} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Recalculate Usage</button>{usage?.usageAvailable && <CompactIconButton label="Set storage limit" onClick={() => { setLimitError(null); setLimitOpen(true); }}><Settings2 className="h-4 w-4" aria-hidden="true" /></CompactIconButton>}</div>}</div>{message && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" role="status">{message}</p>}{loading ? <div className="mt-4 h-28 animate-pulse rounded-lg bg-gray-100" aria-label="Loading usage" /> : error ? <div className="mt-4"><ErrorState message={error} /></div> : !usage?.usageAvailable ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4"><div><p className="font-bold text-gray-800">Usage not calculated yet.</p><p className="mt-1 text-sm text-gray-500">The organization has no stored usage summary. Recalculation aggregates allowlisted record counts and organization-scoped file metadata; it never returns record contents.</p></div>{isSuperAdmin && <button type="button" onClick={() => setRecalculateOpen(true)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700">Recalculate Usage</button>}</div> : <><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg border border-gray-100 bg-gray-50 p-3"><div className="flex items-center gap-2 text-xs font-bold text-gray-500"><HardDrive className="h-4 w-4" aria-hidden="true" />Total Estimated Usage</div><p className="mt-2 text-xl font-black text-gray-950">{formatBytes(usage.totalBytesEstimated)}</p></div><div className="rounded-lg border border-gray-100 bg-gray-50 p-3"><div className="flex items-center gap-2 text-xs font-bold text-gray-500"><File className="h-4 w-4" aria-hidden="true" />Files</div><p className="mt-2 text-xl font-black text-gray-950">{formatBytes(usage.storageBytes)}</p><p className="text-xs text-gray-500">{usage.fileCount} file{usage.fileCount === 1 ? '' : 's'}</p></div><div className="rounded-lg border border-gray-100 bg-gray-50 p-3"><div className="flex items-center gap-2 text-xs font-bold text-gray-500"><Database className="h-4 w-4" aria-hidden="true" />Database Data</div><p className="mt-2 text-xl font-black text-gray-950">{formatBytes(usage.firestoreBytesEstimated)} <span className="text-xs font-semibold text-gray-500">estimated</span></p><p className="text-xs text-gray-500">{usage.recordCount} record{usage.recordCount === 1 ? '' : 's'}</p></div><div className="rounded-lg border border-gray-100 bg-gray-50 p-3"><div className="text-xs font-bold text-gray-500">Storage Limit</div><p className="mt-2 text-xl font-black text-gray-950">{usage.storageLimitBytes ? formatBytes(usage.storageLimitBytes) : 'None'}</p><p className="text-xs text-gray-500">{usage.usagePercent === null ? 'No limit configured' : `${usage.usagePercent}% used`}</p></div></div>{usage.storageLimitBytes && <div className="mt-4"><div className="flex items-center justify-between gap-2 text-xs font-semibold text-gray-500"><span>{usage.usagePercent}% of {formatBytes(usage.storageLimitBytes)}</span><span>{statusLabel(usage.usageStatus)}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${usage.usageStatus === 'FULL' ? 'bg-rose-600' : usage.usageStatus === 'HIGH' ? 'bg-orange-500' : usage.usageStatus === 'WARNING' ? 'bg-amber-500' : 'bg-blue-600'}`} style={{ width: `${progress}%` }} /></div></div>}<div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500"><span>Last calculated: {formatDate(usage.lastCalculatedAt)}</span><span>Last reconciled: {formatDate(usage.lastReconciledAt)}</span></div><details className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"><summary className="cursor-pointer text-xs font-bold text-gray-600">Record breakdown (counts only)</summary><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600 sm:grid-cols-4">{Object.entries(usage.breakdown).map(([label, value]) => <div key={label} className="flex justify-between gap-2"><span className="capitalize">{label}</span><strong>{value}</strong></div>)}</div></details></>}</section>
    {isSuperAdmin && recalculateOpen && <ConfirmActionDialog open title="Recalculate organization usage?" description={<>{message && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{message}</p>}<p>This aggregates counts and estimated bytes from allowlisted organization collections and organization-scoped files. It may consume Firebase reads; no record contents are returned. Existing usage data is preserved if the calculation fails.</p></>} confirmLabel="Recalculate Usage" busyLabel="Calculating…" busy={recalculateBusy} onConfirm={recalculate} onCancel={() => !recalculateBusy && setRecalculateOpen(false)} />}
    {isSuperAdmin && limitOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Set storage limit"><form onSubmit={(event) => { event.preventDefault(); void saveLimit(); }} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-gray-950">Set storage limit</h2><p className="mt-2 text-sm text-gray-600">This limit is informational only. It will not block uploads, database writes, or change license status.</p><label className="mt-5 block text-sm font-bold">Storage limit<select value={limitSelection} onChange={(event) => setLimitSelection(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal">{LIMIT_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}<option value="CUSTOM">Custom</option></select></label>{limitSelection === 'CUSTOM' && <label className="mt-4 block text-sm font-bold">Custom limit (MB)<input type="number" min="1" step="1" value={customLimitMb} onChange={(event) => setCustomLimitMb(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}{limitError && <p className="mt-3 text-sm font-semibold text-rose-600" role="alert">{limitError}</p>}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => !limitBusy && setLimitOpen(false)} disabled={limitBusy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button><button type="submit" disabled={limitBusy} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{limitBusy ? 'Saving…' : 'Save storage limit'}</button></div></form></div>}
  </>;
}
