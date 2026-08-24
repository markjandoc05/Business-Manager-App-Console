'use client';

import React, { useEffect, useState } from 'react';
import { getAuditLogs, ConsoleAuditLog } from '@/lib/console-api';
import { EmptyState, ErrorState, formatDate, LoadingState } from './ConsolePrimitives';

export function AuditLogsModule() {
  const [logs, setLogs] = useState<ConsoleAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getAuditLogs().then((result) => setLogs(result.items)).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load audit logs.')).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!logs.length) return <EmptyState title="No audit activity yet" message="Administrative actions will appear here once recorded." />;
  const summarize = (value: unknown) => value === undefined ? '—' : JSON.stringify(value);
  return <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500"><tr><th className="px-5 py-3">Action</th><th>Admin</th><th>Target</th><th>Organization</th><th>Previous value</th><th>New value</th><th>Created</th></tr></thead><tbody className="divide-y divide-gray-100">{logs.map((log) => <tr key={log.id}><td className="px-5 py-4 font-bold">{log.action || '—'}</td><td>{log.actorEmail || '—'}<span className="ml-2 text-xs text-gray-400">{log.actorRole || ''}</span></td><td>{log.targetType || '—'} {log.targetId ? `· ${log.targetId}` : ''}</td><td>{log.organizationId || '—'}</td><td className="max-w-xs truncate text-xs">{summarize(log.previousValue)}</td><td className="max-w-xs truncate text-xs">{summarize(log.newValue)}</td><td>{formatDate(log.createdAt)}</td></tr>)}</tbody></table></div>;
}
