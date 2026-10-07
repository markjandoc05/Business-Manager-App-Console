'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { ConsoleAuditLog, getAuditLogs } from '@/lib/console-api';
import { CompactBadge, CompactIconButton, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';

const PAGE_SIZE = 25;

function summarize(value: unknown) {
  if (value === undefined || value === null) return '—';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function actionTone(action?: string) {
  if (action?.includes('FAILED') || action?.includes('SUSPEND') || action?.includes('EXPIRE')) return 'danger' as const;
  if (action?.includes('REACTIVATE') || action?.includes('ACTIVATE') || action?.includes('ADD')) return 'success' as const;
  return 'info' as const;
}

export function AuditLogsModule() {
  const searchParams = useSearchParams();
  const organizationFilter = searchParams.get('organizationId') || '';
  return <OrganizationAuditLogs key={organizationFilter} organizationFilter={organizationFilter} />;
}

function OrganizationAuditLogs({ organizationFilter }: { organizationFilter: string }) {
  const [logs, setLogs] = useState<ConsoleAuditLog[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (pageCursor?: string) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getAuditLogs(PAGE_SIZE, pageCursor, organizationFilter || undefined);
      if (currentRequest !== requestId.current) return;
      setLogs(result.items);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      if (currentRequest === requestId.current) setError(reason instanceof Error ? reason.message : 'Unable to load audit logs.');
    } finally { if (currentRequest === requestId.current) setLoading(false); }
  }, [organizationFilter]);

  // Audit data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(cursor); return () => { requestId.current += 1; }; }, [cursor, load]);

  const visibleLogs = logs;
  const previous = () => {
    const previousCursor = cursorHistory.at(-1);
    setCursorHistory((history) => history.slice(0, -1));
    setCursor(previousCursor);
    setPage((value) => Math.max(1, value - 1));
  };
  const next = () => {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor]);
    setCursor(nextCursor);
    setPage((value) => value + 1);
  };

  if (loading && !logs.length) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return <div className="space-y-3">
    {organizationFilter && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800"><span>Showing activity for organization <strong>{organizationFilter}</strong>.</span><a href="/audit-logs" className="font-bold underline underline-offset-2">Clear filter</a></div>}
    {!visibleLogs.length ? <EmptyState title="No audit activity" message={organizationFilter ? 'No activity has been recorded for this organization.' : 'Administrative actions will appear here once recorded.'} /> : <>
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block"><table className="w-full min-w-[1050px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[17%] px-3 py-2">Action</th><th className="w-[19%] px-3 py-2">Admin</th><th className="w-[17%] px-3 py-2">Target</th><th className="w-[14%] px-3 py-2">Organization</th><th className="w-[13%] px-3 py-2">Previous</th><th className="w-[13%] px-3 py-2">New</th><th className="w-[7%] px-3 py-2">Created</th></tr></thead><tbody className="divide-y divide-gray-100">{visibleLogs.map((log) => <tr key={log.id} className="h-14 hover:bg-gray-50"><td className="px-3 py-2"><CompactBadge label={log.action || 'UNKNOWN'} tone={actionTone(log.action)} /></td><td className="px-3 py-2"><TruncatedText value={log.actorEmail} className="font-semibold" /><TruncatedText value={log.actorRole} className="text-xs text-gray-500" /></td><td className="px-3 py-2"><TruncatedText value={`${log.targetType || '—'}${log.targetId ? ` · ${log.targetId}` : ''}`} /></td><td className="px-3 py-2"><TruncatedText value={log.organizationId} className="text-gray-600" /></td><td className="px-3 py-2 text-xs text-gray-500"><TruncatedText value={summarize(log.previousValue)} /></td><td className="px-3 py-2 text-xs text-gray-500"><TruncatedText value={summarize(log.newValue)} /></td><td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDate(log.createdAt)}</td></tr>)}</tbody></table></div>
      <div className="space-y-3 md:hidden">{visibleLogs.map((log) => <article key={log.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><CompactBadge label={log.action || 'UNKNOWN'} tone={actionTone(log.action)} /><span className="shrink-0 text-xs text-gray-500">{formatDate(log.createdAt)}</span></div><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-gray-400">Admin</dt><dd className="truncate font-semibold" title={log.actorEmail}>{log.actorEmail || '—'}</dd></div><div><dt className="text-xs text-gray-400">Target</dt><dd className="truncate" title={log.targetId}>{log.targetType || '—'}{log.targetId ? ` · ${log.targetId}` : ''}</dd></div><div><dt className="text-xs text-gray-400">Organization</dt><dd className="truncate" title={log.organizationId}>{log.organizationId || '—'}</dd></div><div><dt className="text-xs text-gray-400">Actor role</dt><dd>{log.actorRole || '—'}</dd></div></dl><div className="mt-3 grid gap-2 text-xs"><p className="truncate text-gray-500" title={summarize(log.previousValue)}>Previous: {summarize(log.previousValue)}</p><p className="truncate text-gray-500" title={summarize(log.newValue)}>New: {summarize(log.newValue)}</p></div></article>)}</div>
    </>}
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"><span className="text-xs font-semibold text-gray-500">Page {page}{loading ? ' · Loading…' : ''}</span><div className="flex items-center gap-2"><CompactIconButton label="Previous audit log page" onClick={previous} disabled={loading || page === 1}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label="Next audit log page" onClick={next} disabled={loading || !nextCursor}><ChevronRight className="h-4 w-4" aria-hidden="true" /></CompactIconButton></div></div>
  </div>;
}
