'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search } from 'lucide-react';
import { getOrganizations } from '@/lib/console-api';
import type { OrganizationRegistryEntry } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { CompactBadge, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';

type LicenseStatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_LICENSE' | 'NEEDS_ATTENTION';
type PlatformStatusFilter = 'ALL' | 'HEALTHY' | 'WARNING' | 'ACTION_REQUIRED';
type CreationDateFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_30' | 'WITHIN_90' | 'OLDER_THAN_90' | 'UNKNOWN';
type LifecycleFilter = 'ALL' | 'TRIAL_ENDS_7' | 'TRIAL_ENDED' | 'RENEWS_30' | 'RENEWAL_OVERDUE' | 'NO_RENEWAL_OR_TRIAL_DATE';

const DAY_MS = 86_400_000;

function dateMillis(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function visibleLicenseStatus(record: OrganizationRegistryEntry): Exclude<LicenseStatusFilter, 'ALL'> {
  if (record.licenseDocumentState === 'NO_LICENSE') return 'NO_LICENSE';
  if (record.licenseDocumentState === 'INVALID_LICENSE') return 'NEEDS_ATTENTION';
  return record.licenseStatus === 'ACTIVE' || record.licenseStatus === 'TRIAL' || record.licenseStatus === 'EXPIRED' || record.licenseStatus === 'SUSPENDED'
    ? record.licenseStatus
    : 'NEEDS_ATTENTION';
}

function licenseTone(status: ReturnType<typeof visibleLicenseStatus>) {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'TRIAL') return 'info' as const;
  if (status === 'EXPIRED' || status === 'SUSPENDED') return 'danger' as const;
  return 'warning' as const;
}

function platformTone(status: OrganizationRegistryEntry['platformStatus']) {
  return status === 'HEALTHY' ? 'success' as const : status === 'WARNING' ? 'warning' as const : 'danger' as const;
}

function planLabel(record: OrganizationRegistryEntry) {
  return record.planName || record.planId || record.canonicalPlan || '—';
}

function creationMatches(value: string | undefined, filter: CreationDateFilter, now: number) {
  if (filter === 'ALL') return true;
  const createdAt = dateMillis(value);
  if (filter === 'UNKNOWN') return createdAt === undefined;
  if (createdAt === undefined) return false;
  if (filter === 'OLDER_THAN_90') return createdAt < now - 90 * DAY_MS;
  const days = filter === 'WITHIN_7' ? 7 : filter === 'WITHIN_30' ? 30 : 90;
  return createdAt >= now - days * DAY_MS && createdAt <= now;
}

function lifecycleMatches(record: OrganizationRegistryEntry, filter: LifecycleFilter, now: number) {
  if (filter === 'ALL') return true;
  const trialEndsAt = dateMillis(record.trialEndsAt);
  const renewalAt = dateMillis(record.renewalDate || record.subscriptionEndsAt);
  if (filter === 'NO_RENEWAL_OR_TRIAL_DATE') return trialEndsAt === undefined && renewalAt === undefined;
  if (filter === 'TRIAL_ENDED') return trialEndsAt !== undefined && trialEndsAt < now;
  if (filter === 'TRIAL_ENDS_7') return trialEndsAt !== undefined && trialEndsAt >= now && trialEndsAt <= now + 7 * DAY_MS;
  if (filter === 'RENEWAL_OVERDUE') return renewalAt !== undefined && renewalAt < now;
  return renewalAt !== undefined && renewalAt >= now && renewalAt <= now + 30 * DAY_MS;
}

export function OrganizationsModule() {
  const { platformAdmin } = useAuth();
  const [items, setItems] = useState<OrganizationRegistryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('ALL');
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusFilter>('ALL');
  const [platformStatus, setPlatformStatus] = useState<PlatformStatusFilter>('ALL');
  const [creationDate, setCreationDate] = useState<CreationDateFilter>('ALL');
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setItems(await getOrganizations()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the organization registry.'); }
    finally { setLoading(false); }
  }, []);

  // Registry data is an external synchronization; these state updates are intentional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const planOptions = useMemo(() => [...new Map(items.map((item) => [item.planId || item.canonicalPlan || '', planLabel(item)])).entries()].filter(([value]) => value), [items]);
  const filtered = useMemo(() => {
    const now = Date.now();
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((record) => {
      const matchesQuery = !normalizedQuery || [record.organizationName, record.organizationId].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesPlan = plan === 'ALL' || record.planId === plan || record.canonicalPlan === plan;
      const matchesLicense = licenseStatus === 'ALL' || visibleLicenseStatus(record) === licenseStatus;
      const matchesPlatform = platformStatus === 'ALL' || record.platformStatus === platformStatus;
      return matchesQuery
        && matchesPlan
        && matchesLicense
        && matchesPlatform
        && creationMatches(record.createdAt, creationDate, now)
        && lifecycleMatches(record, lifecycle, now);
    });
  }, [creationDate, items, licenseStatus, lifecycle, plan, platformStatus, query]);

  const clearFilters = () => {
    setQuery('');
    setPlan('ALL');
    setLicenseStatus('ALL');
    setPlatformStatus('ALL');
    setCreationDate('ALL');
    setLifecycle('ALL');
  };
  const hasFilters = Boolean(query.trim()) || plan !== 'ALL' || licenseStatus !== 'ALL' || platformStatus !== 'ALL' || creationDate !== 'ALL' || lifecycle !== 'ALL';
  const summaries = [
    { label: 'Organizations', value: items.length, onClick: () => setLicenseStatus('ALL') },
    { label: 'Trial', value: items.filter((item) => visibleLicenseStatus(item) === 'TRIAL').length, onClick: () => setLicenseStatus('TRIAL') },
    { label: 'Active', value: items.filter((item) => visibleLicenseStatus(item) === 'ACTIVE').length, onClick: () => setLicenseStatus('ACTIVE') },
    { label: 'Action required', value: items.filter((item) => item.platformStatus === 'ACTION_REQUIRED').length, onClick: () => setPlatformStatus('ACTION_REQUIRED') },
  ];

  if (loading && !items.length) return <LoadingState />;
  if (error && !items.length) return <ErrorState message={error} />;

  return <section className="space-y-5" aria-labelledby="organization-registry-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="organization-registry-heading" className="font-black text-gray-950">Organization registry</h2>
        <p className="mt-1 text-sm text-gray-500">Centralized organization registration, canonical licensing, and seat information only. Organizations remain isolated by organizationId.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button>
    </div>

    {platformAdmin?.role === 'SUPPORT' && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">SUPPORT access is read-only. Subscription changes remain available only through authorized SUPER_ADMIN services.</p>}
    <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">This registry does not load tenant business records or member identities.</p>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {summaries.map((summary) => <button type="button" key={summary.label} onClick={summary.onClick} className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">{summary.label}</span><span className="mt-1 block text-2xl font-black text-gray-950">{summary.value}</span></button>)}
    </div>

    <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 lg:grid-cols-3">
      <label className="relative min-w-0 lg:col-span-3"><span className="sr-only">Search organization or ID</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organization or ID" className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
      <select aria-label="Plan filter" value={plan} onChange={(event) => setPlan(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All plans</option>{planOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="License status filter" value={licenseStatus} onChange={(event) => setLicenseStatus(event.target.value as LicenseStatusFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All license statuses</option><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="NO_LICENSE">No license</option><option value="NEEDS_ATTENTION">Needs attention</option></select>
      <select aria-label="Platform status filter" value={platformStatus} onChange={(event) => setPlatformStatus(event.target.value as PlatformStatusFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All platform statuses</option><option value="HEALTHY">Healthy</option><option value="WARNING">Warning</option><option value="ACTION_REQUIRED">Action required</option></select>
      <select aria-label="Creation date filter" value={creationDate} onChange={(event) => setCreationDate(event.target.value as CreationDateFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">Any creation date</option><option value="WITHIN_7">Created within 7 days</option><option value="WITHIN_30">Created within 30 days</option><option value="WITHIN_90">Created within 90 days</option><option value="OLDER_THAN_90">Created over 90 days ago</option><option value="UNKNOWN">Creation date unavailable</option></select>
      <select aria-label="Renewal or trial state filter" value={lifecycle} onChange={(event) => setLifecycle(event.target.value as LifecycleFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">Any renewal or trial state</option><option value="TRIAL_ENDS_7">Trial ends within 7 days</option><option value="TRIAL_ENDED">Trial ended</option><option value="RENEWS_30">Renews within 30 days</option><option value="RENEWAL_OVERDUE">Renewal overdue</option><option value="NO_RENEWAL_OR_TRIAL_DATE">No renewal or trial date</option></select>
      <div className="flex items-center justify-end">{hasFilters && <button type="button" onClick={clearFilters} className="text-xs font-bold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500">Clear filters</button>}</div>
    </div>

    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{error}</div>}
    {!filtered.length ? <EmptyState title="No organizations found" message="Try clearing one or more filters." /> : <>
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full min-w-[1250px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[22%] px-3 py-2">Organization</th><th className="w-[11%] px-3 py-2">Platform</th><th className="w-[13%] px-3 py-2">Current plan</th><th className="w-[13%] px-3 py-2">Current / canonical</th><th className="w-[11%] px-3 py-2">Trial end</th><th className="w-[11%] px-3 py-2">Renewal</th><th className="w-[9%] px-3 py-2">Seats</th><th className="w-[8%] px-3 py-2">Created</th><th className="w-[4%] px-3 py-2">View</th></tr></thead><tbody className="divide-y divide-gray-100">
          {filtered.map((record) => { const status = visibleLicenseStatus(record); return <tr key={record.organizationId} className="h-16 hover:bg-gray-50"><td className="px-3 py-2"><Link href={`/organizations/${record.organizationId}`} title={record.organizationName} className="block max-w-full truncate font-bold text-gray-900 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{record.organizationName}</Link><TruncatedText value={record.organizationId} className="font-mono text-xs text-gray-500" /></td><td className="px-3 py-2"><CompactBadge label={record.platformStatus.replaceAll('_', ' ')} tone={platformTone(record.platformStatus)} /></td><td className="px-3 py-2"><TruncatedText value={planLabel(record)} /></td><td className="px-3 py-2"><CompactBadge label={status.replaceAll('_', ' ')} tone={licenseTone(status)} /><p className="mt-1 text-[10px] text-gray-500">Canonical: {record.canonicalLicenseStatus || '—'}</p></td><td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{formatDate(record.trialEndsAt)}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{formatDate(record.renewalDate || record.subscriptionEndsAt)}</td><td className="px-3 py-2 whitespace-nowrap">{record.activeSeatCount} / {record.maxUsers ?? '—'}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{formatDate(record.createdAt)}</td><td className="px-3 py-2"><Link href={`/organizations/${record.organizationId}`} className="text-xs font-bold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500">Open</Link></td></tr>; })}
        </tbody></table>
      </div>
      <div className="space-y-3 md:hidden">{filtered.map((record) => { const status = visibleLicenseStatus(record); return <article key={record.organizationId} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/organizations/${record.organizationId}`} title={record.organizationName} className="block truncate font-bold text-gray-900 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{record.organizationName}</Link><TruncatedText value={record.organizationId} className="mt-1 font-mono text-xs text-gray-500" /></div><CompactBadge label={status.replaceAll('_', ' ')} tone={licenseTone(status)} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-gray-400">Platform</dt><dd><CompactBadge label={record.platformStatus.replaceAll('_', ' ')} tone={platformTone(record.platformStatus)} /></dd></div><div><dt className="text-xs text-gray-400">Plan</dt><dd><TruncatedText value={planLabel(record)} /></dd></div><div><dt className="text-xs text-gray-400">Canonical status</dt><dd>{record.canonicalLicenseStatus || '—'}</dd></div><div><dt className="text-xs text-gray-400">Trial end</dt><dd>{formatDate(record.trialEndsAt)}</dd></div><div><dt className="text-xs text-gray-400">Renewal</dt><dd>{formatDate(record.renewalDate || record.subscriptionEndsAt)}</dd></div><div><dt className="text-xs text-gray-400">Seats</dt><dd>{record.activeSeatCount} / {record.maxUsers ?? '—'}</dd></div><div><dt className="text-xs text-gray-400">Created</dt><dd>{formatDate(record.createdAt)}</dd></div></dl></article>; })}</div>
    </>}
  </section>;
}
