'use client';

import React, { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { fetchOrganizations } from '@/lib/organization-data';
import { evaluateOrganizationLicense } from '@/lib/license';
import { Organization } from '@/lib/types';
import { firestore } from '@/lib/firebase';
import { ErrorState, EmptyState, LoadingState, StatusBadge } from './ConsolePrimitives';

type RecentLog = { action?: string; actorEmail?: string };
export function DashboardModule() {
  const [items, setItems] = useState<Organization[]>([]); const [logs, setLogs] = useState<RecentLog[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => { Promise.all([fetchOrganizations(), getDocs(query(collection(firestore, 'platformAuditLogs'), orderBy('createdAt', 'desc'), limit(5))).catch(() => getDocs(query(collection(firestore, 'platformAuditLogs'), limit(5))))]).then(([organizations, auditSnapshot]) => { setItems(organizations); setLogs(auditSnapshot.docs.map((item) => item.data() as RecentLog)); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load dashboard data.')).finally(() => setLoading(false)); }, []);
  if (loading) return <LoadingState />; if (error) return <ErrorState message={error} />;
  const evaluations = items.map((organization) => evaluateOrganizationLicense(organization)); const cards: Array<[string, number]> = [['Total Organizations', items.length], ['Active Organizations', evaluations.filter((e) => e.status === 'ACTIVE').length], ['Trial Organizations', evaluations.filter((e) => e.status === 'TRIAL').length], ['Expired Organizations', evaluations.filter((e) => e.status === 'EXPIRED').length], ['Suspended Organizations', evaluations.filter((e) => e.status === 'SUSPENDED').length], ['Active Memberships', 0], ['Trials Ending Soon', 0], ['Licenses Expiring Soon', 0]];
  return <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p><p className="mt-3 text-3xl font-black text-gray-950">{value}</p></div>)}</div><div className="grid gap-6 lg:grid-cols-2"><div className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black text-gray-950">License distribution</h2>{!evaluations.length ? <div className="mt-4"><EmptyState title="No organizations yet" message="Organization metadata will appear here when the Client App creates workspaces." /></div> : <div className="mt-5 flex flex-wrap gap-2">{evaluations.map((evaluation, index) => <StatusBadge key={`${evaluation.status}-${index}`} status={evaluation.status} />)}</div>}</div><div className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black text-gray-950">Recent platform activity</h2>{!logs.length ? <p className="mt-4 text-sm text-gray-500">No administrative activity recorded.</p> : <ul className="mt-4 space-y-3">{logs.map((log, index) => <li key={index} className="border-b border-gray-100 pb-3 text-sm"><p className="font-bold">{log.action || 'Administrative action'}</p><p className="text-xs text-gray-500">{log.actorEmail || 'Platform administrator'}</p></li>)}</ul>}</div></div></div>;
}
