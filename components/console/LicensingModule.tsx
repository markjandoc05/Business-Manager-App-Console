'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLicensing } from '@/lib/console-api';
import { evaluateOrganizationLicense } from '@/lib/license';
import { Organization, OrganizationLicenseStatus } from '@/lib/types';
import { EmptyState, ErrorState, formatDate, LoadingState, StatusBadge } from './ConsolePrimitives';

const filters: Array<'ALL' | OrganizationLicenseStatus | 'EXPIRING_SOON' | 'TRIAL_ENDING_SOON'> = ['ALL', 'TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'EXPIRING_SOON', 'TRIAL_ENDING_SOON'];

export function LicensingModule() {
  const router = useRouter();
  const [items, setItems] = useState<Organization[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof filters[number]>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => { getLicensing().then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load licensing data.')).finally(() => setLoading(false)); }, []);
  const filtered = useMemo(() => items.filter((org) => {
    const evaluation = evaluateOrganizationLicense(org);
    const q = query.toLowerCase();
    const soon = (value?: string) => value ? new Date(value).getTime() - now <= 30 * 24 * 60 * 60 * 1000 && new Date(value).getTime() >= now : false;
    return (!q || [org.name, org.slug, org.ownerEmail].some((value) => value?.toLowerCase().includes(q))) && (filter === 'ALL' || filter === evaluation.status || (filter === 'EXPIRING_SOON' && soon(org.license?.subscriptionEndsAt)) || (filter === 'TRIAL_ENDING_SOON' && soon(org.license?.trialEndsAt)));
  }), [filter, items, now, query]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  return <div className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search organization, slug, or owner" className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-500" /><select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm">{filters.map((item) => <option key={item} value={item}>{item === 'ALL' ? 'All statuses' : item.replaceAll('_', ' ')}</option>)}</select></div>{!filtered.length ? <EmptyState title="No matching license records" message="License data is read from canonical license documents." /> : <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500"><tr><th className="px-5 py-3">Organization</th><th>Plan</th><th>Status</th><th>Seat usage</th><th>Trial end</th><th>Expiration</th><th>Write enabled</th><th>Actions</th></tr></thead><tbody className="divide-y divide-gray-100">{filtered.map((org) => { const evaluation = evaluateOrganizationLicense(org); return <tr key={org.id}><td className="px-5 py-4 font-bold">{org.name}<p className="text-xs font-normal text-gray-400">{org.ownerEmail || org.slug || '—'}</p></td><td>{org.license?.plan || '—'}</td><td><StatusBadge status={evaluation.status} /></td><td>— / {org.license?.maxUsers ?? '—'}</td><td>{formatDate(org.license?.trialEndsAt)}</td><td>{formatDate(org.license?.subscriptionEndsAt)}</td><td>{org.license ? (evaluation.accessAllowed ? 'YES' : 'NO') : '—'}</td><td><button onClick={() => router.push(`/organizations/${org.id}`)} className="text-xs font-bold text-blue-600">Manage</button></td></tr>; })}</tbody></table></div>}</div>;
}
