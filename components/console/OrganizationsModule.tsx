'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { getOrganizationRegistryPage } from '@/lib/console-api';
import type { OrganizationRegistryCreationDateFilter, OrganizationRegistryEntry, OrganizationRegistryFilters, OrganizationRegistryLicenseStatusFilter, OrganizationRegistryLifecycleFilter, OrganizationRegistryPlanOption, OrganizationRegistryPlatformStatusFilter } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { CompactBadge, CompactIconButton, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';

type RegistryDraft = Required<Pick<OrganizationRegistryFilters, 'query' | 'plan' | 'licenseStatus' | 'platformStatus' | 'creationDate' | 'lifecycle'>>;

const emptyFilters: RegistryDraft = {
  query: '',
  plan: 'ALL',
  licenseStatus: 'ALL',
  platformStatus: 'ALL',
  creationDate: 'ALL',
  lifecycle: 'ALL',
};

function initialFilters(searchParams: ReturnType<typeof useSearchParams>): RegistryDraft {
  const platformStatus = searchParams.get('health');
  return {
    ...emptyFilters,
    ...(platformStatus === 'HEALTHY' || platformStatus === 'WARNING' || platformStatus === 'ACTION_REQUIRED' ? { platformStatus } : {}),
  };
}

function visibleLicenseStatus(record: OrganizationRegistryEntry): Exclude<OrganizationRegistryLicenseStatusFilter, 'ALL'> {
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
  return record.planName || record.canonicalPlan || 'No plan';
}

function workspaceLabel(record: OrganizationRegistryEntry) {
  return record.platformMetadata.workspaceSlug ? `Workspace · ${record.platformMetadata.workspaceSlug}` : 'Centralized workspace';
}

function hasActiveFilters(filters: RegistryDraft) {
  return Boolean(filters.query.trim()) || filters.plan !== 'ALL' || filters.licenseStatus !== 'ALL' || filters.platformStatus !== 'ALL' || filters.creationDate !== 'ALL' || filters.lifecycle !== 'ALL';
}

export function OrganizationsModule() {
  const searchParams = useSearchParams();
  const { platformAdmin } = useAuth();
  const [items, setItems] = useState<OrganizationRegistryEntry[]>([]);
  const [planOptions, setPlanOptions] = useState<OrganizationRegistryPlanOption[]>([]);
  const [draft, setDraft] = useState<RegistryDraft>(() => initialFilters(searchParams));
  const [filters, setFilters] = useState<RegistryDraft>(() => initialFilters(searchParams));
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState(1);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pageCursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getOrganizationRegistryPage(filters, pageCursor);
      setItems(result.items);
      setPlanOptions(result.planOptions);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load the organization registry.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Registry data is external synchronization; pagination keeps each browser read bounded.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(cursor); }, [cursor, load, refreshVersion]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setCursorHistory([]);
    setCursor(undefined);
    setPage(1);
    setFilters(draft);
    setRefreshVersion((value) => value + 1);
  };

  const changeDraft = <K extends keyof RegistryDraft>(field: K, value: RegistryDraft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const clearFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setCursorHistory([]);
    setCursor(undefined);
    setPage(1);
    setRefreshVersion((value) => value + 1);
  };
  const quickFilter = (patch: Partial<RegistryDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setFilters(next);
    setCursorHistory([]);
    setCursor(undefined);
    setPage(1);
    setRefreshVersion((value) => value + 1);
  };
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
  const summaries = [
    { label: 'Loaded page', value: items.length, onClick: () => quickFilter({ licenseStatus: 'ALL', platformStatus: 'ALL' }) },
    { label: 'Trial', value: items.filter((item) => visibleLicenseStatus(item) === 'TRIAL').length, onClick: () => quickFilter({ licenseStatus: 'TRIAL' }) },
    { label: 'Active', value: items.filter((item) => visibleLicenseStatus(item) === 'ACTIVE').length, onClick: () => quickFilter({ licenseStatus: 'ACTIVE' }) },
    { label: 'Action required', value: items.filter((item) => item.platformStatus === 'ACTION_REQUIRED').length, onClick: () => quickFilter({ platformStatus: 'ACTION_REQUIRED' }) },
  ];

  if (loading && !items.length) return <LoadingState />;
  if (error && !items.length) return <ErrorState message={error} />;

  return <section className="space-y-5" aria-labelledby="organization-registry-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="organization-registry-heading" className="font-black text-gray-950">Organization registry</h2>
        <p className="mt-1 text-sm text-gray-500">Centralized organization registration, canonical licensing, and seat information only. Each workspace remains isolated from every other customer workspace.</p>
      </div>
      <button type="button" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh page</button>
    </div>

    {platformAdmin?.role === 'SUPPORT' && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">SUPPORT access is read-only. Subscription changes remain available only through authorized SUPER_ADMIN services.</p>}
    <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">This registry reads a bounded page of platform metadata only. It does not load tenant business records or member identities.</p>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {summaries.map((summary) => <button type="button" key={summary.label} onClick={summary.onClick} className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">{summary.label}</span><span className="mt-1 block text-2xl font-black text-gray-950">{summary.value}</span></button>)}
    </div>
    <p className="text-xs text-gray-500">Page summary—counts apply only to the currently loaded organization page.</p>

    <form onSubmit={applyFilters} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 lg:grid-cols-3">
      <label className="relative min-w-0 lg:col-span-3"><span className="sr-only">Search organization or workspace</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" /><input value={draft.query} onChange={(event) => changeDraft('query', event.target.value)} placeholder="Search organization or workspace" className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
      <select aria-label="Plan filter" value={draft.plan} onChange={(event) => changeDraft('plan', event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All plans</option>{planOptions.map((option) => <option key={option.planId} value={option.planId}>{option.displayName}</option>)}<option value="TRIAL">Legacy / Trial</option><option value="SOLO">Legacy / Solo</option><option value="STARTER">Legacy / Starter</option><option value="TEAM">Legacy / Team</option><option value="LEGACY">Legacy entitlement</option></select>
      <select aria-label="License status filter" value={draft.licenseStatus} onChange={(event) => changeDraft('licenseStatus', event.target.value as OrganizationRegistryLicenseStatusFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All license statuses</option><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="NO_LICENSE">No license</option><option value="NEEDS_ATTENTION">Needs attention</option></select>
      <select aria-label="Platform status filter" value={draft.platformStatus} onChange={(event) => changeDraft('platformStatus', event.target.value as OrganizationRegistryPlatformStatusFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All platform statuses</option><option value="HEALTHY">Healthy</option><option value="WARNING">Warning</option><option value="ACTION_REQUIRED">Action required</option></select>
      <select aria-label="Creation date filter" value={draft.creationDate} onChange={(event) => changeDraft('creationDate', event.target.value as OrganizationRegistryCreationDateFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">Any creation date</option><option value="WITHIN_7">Created within 7 days</option><option value="WITHIN_30">Created within 30 days</option><option value="WITHIN_90">Created within 90 days</option><option value="OLDER_THAN_90">Created over 90 days ago</option><option value="UNKNOWN">Creation date unavailable</option></select>
      <select aria-label="Renewal or trial state filter" value={draft.lifecycle} onChange={(event) => changeDraft('lifecycle', event.target.value as OrganizationRegistryLifecycleFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">Any renewal or trial state</option><option value="TRIAL_ENDS_7">Trial ends within 7 days</option><option value="TRIAL_ENDED">Trial ended</option><option value="RENEWS_30">Renews within 30 days</option><option value="RENEWAL_OVERDUE">Renewal overdue</option><option value="NO_RENEWAL_OR_TRIAL_DATE">No renewal or trial date</option></select>
      <div className="flex items-center justify-end gap-3"><button type="submit" disabled={loading} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">Apply filters</button>{hasActiveFilters(filters) && <button type="button" onClick={clearFilters} className="text-xs font-bold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500">Clear</button>}</div>
    </form>

    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{error}</div>}
    {!items.length ? <EmptyState title="No organizations in this page" message={nextCursor ? 'No records matched this bounded filter window. Continue to the next page to search further.' : 'Try clearing one or more filters.'} /> : <>
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full min-w-[1180px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[23%] px-3 py-2">Organization</th><th className="w-[14%] px-3 py-2">Plan</th><th className="w-[12%] px-3 py-2">License</th><th className="w-[13%] px-3 py-2">Platform</th><th className="w-[18%] px-3 py-2">Trial / renewal</th><th className="w-[9%] px-3 py-2">Seats</th><th className="w-[8%] px-3 py-2">Created</th><th className="w-[3%] px-3 py-2"><span className="sr-only">View</span></th></tr></thead><tbody className="divide-y divide-gray-100">
          {items.map((record) => <tr key={record.organizationId} className="hover:bg-gray-50"><td className="px-3 py-3"><Link href={`/organizations/${record.organizationId}`} className="block truncate font-bold text-gray-950 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" title={record.organizationName}>{record.organizationName}</Link><p className="mt-1 truncate text-xs text-gray-500" title={workspaceLabel(record)}>{workspaceLabel(record)}</p></td><td className="px-3 py-3"><TruncatedText value={planLabel(record)} className="font-semibold" /></td><td className="px-3 py-3"><CompactBadge label={visibleLicenseStatus(record)} tone={licenseTone(visibleLicenseStatus(record))} /></td><td className="px-3 py-3"><CompactBadge label={record.platformStatus.replace('_', ' ')} tone={platformTone(record.platformStatus)} /></td><td className="px-3 py-3 text-xs text-gray-600"><p>Trial end: {formatDate(record.trialEndsAt)}</p><p className="mt-1">Renewal: {formatDate(record.renewalDate || record.subscriptionEndsAt)}</p></td><td className="px-3 py-3 text-xs font-semibold text-gray-700">{record.activeSeatCount} / {record.maxUsers ?? '—'}</td><td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">{formatDate(record.createdAt)}</td><td className="px-3 py-3"><Link href={`/organizations/${record.organizationId}`} className="text-xs font-bold text-blue-700 hover:underline">View</Link></td></tr>)}
        </tbody></table>
      </div>
      <div className="space-y-3 md:hidden">{items.map((record) => <article key={record.organizationId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/organizations/${record.organizationId}`} className="block truncate font-bold text-gray-950 hover:text-blue-700">{record.organizationName}</Link><p className="mt-1 truncate text-xs text-gray-500">{workspaceLabel(record)}</p></div><CompactBadge label={visibleLicenseStatus(record)} tone={licenseTone(visibleLicenseStatus(record))} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-gray-400">Plan</dt><dd className="truncate font-semibold">{planLabel(record)}</dd></div><div><dt className="text-xs text-gray-400">Platform</dt><dd><CompactBadge label={record.platformStatus.replace('_', ' ')} tone={platformTone(record.platformStatus)} /></dd></div><div><dt className="text-xs text-gray-400">Trial end</dt><dd>{formatDate(record.trialEndsAt)}</dd></div><div><dt className="text-xs text-gray-400">Renewal</dt><dd>{formatDate(record.renewalDate || record.subscriptionEndsAt)}</dd></div><div><dt className="text-xs text-gray-400">Seats</dt><dd>{record.activeSeatCount} / {record.maxUsers ?? '—'}</dd></div><div><dt className="text-xs text-gray-400">Created</dt><dd>{formatDate(record.createdAt)}</dd></div></dl></article>)}</div>
    </>}

    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"><span className="text-xs font-semibold text-gray-500">Page {page} · {items.length} organization{items.length === 1 ? '' : 's'} shown · up to 25 per page{loading ? ' · Loading…' : ''}</span><div className="flex items-center gap-2"><CompactIconButton label="Previous organization page" onClick={previous} disabled={loading || page === 1}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label="Next organization page" onClick={next} disabled={loading || !nextCursor}><ChevronRight className="h-4 w-4" aria-hidden="true" /></CompactIconButton></div></div>
  </section>;
}
