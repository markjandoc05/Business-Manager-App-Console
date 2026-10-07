'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, Eye, RefreshCw, Search, Settings2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { getSubscriptionLicenseDetail, getSubscriptionOperations } from '@/lib/console-api';
import type { LicenseAdminAction, LicenseActionPayload, Organization, SubscriptionOperationLicense, SubscriptionOperationsData } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { licenseActionLabel, LicenseActionDialog } from './LicenseActionDialog';
import { SubscriptionLicenseDetailsDialog } from './SubscriptionLicenseDetailsDialog';
import { useLicenseAdminActions } from '@/lib/use-license-admin-actions';
import { CompactActionGroup, CompactBadge, CompactIconButton, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';

type StatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_LICENSE' | 'NEEDS_ATTENTION';
type RenewalFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_30' | 'WITHIN_90' | 'OVERDUE' | 'NO_DATE';
type TrialFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_14' | 'EXPIRED' | 'NO_TRIAL';

const DAY_MS = 86_400_000;

function dateMillis(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function money(value: number | null, currency?: string) {
  if (value === null || value === undefined || !currency) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function displayStatus(license: SubscriptionOperationLicense) {
  if (license.documentState === 'NO_LICENSE') return 'NO_LICENSE';
  if (license.documentState === 'INVALID_LICENSE') return 'NEEDS_ATTENTION';
  return license.status;
}

function statusLabel(license: SubscriptionOperationLicense) {
  return displayStatus(license).replaceAll('_', ' ');
}

function statusTone(license: SubscriptionOperationLicense) {
  const status = displayStatus(license);
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'TRIAL') return 'info' as const;
  if (status === 'EXPIRED' || status === 'SUSPENDED') return 'danger' as const;
  return 'warning' as const;
}

function planLabel(license: SubscriptionOperationLicense) {
  return license.planName || license.planId || license.canonicalPlan || '—';
}

function renewalAt(license: SubscriptionOperationLicense) {
  return license.renewalDate || license.subscriptionEndsAt;
}

function inUpcomingPeriod(value: string | undefined, period: RenewalFilter, now: number) {
  if (period === 'ALL') return true;
  const dueAt = dateMillis(value);
  if (period === 'NO_DATE') return dueAt === undefined;
  if (dueAt === undefined) return false;
  if (period === 'OVERDUE') return dueAt < now;
  const days = period === 'WITHIN_7' ? 7 : period === 'WITHIN_30' ? 30 : 90;
  return dueAt >= now && dueAt <= now + days * DAY_MS;
}

function trialMatches(value: string | undefined, filter: TrialFilter, now: number) {
  if (filter === 'ALL') return true;
  const endsAt = dateMillis(value);
  if (filter === 'NO_TRIAL') return endsAt === undefined;
  if (endsAt === undefined) return false;
  if (filter === 'EXPIRED') return endsAt < now;
  const days = filter === 'WITHIN_7' ? 7 : 14;
  return endsAt >= now && endsAt <= now + days * DAY_MS;
}

function actionOrganization(license: SubscriptionOperationLicense): Organization {
  return {
    id: license.organizationId,
    name: license.organizationName,
    activeMemberCount: license.activeSeatCount,
    licenseDocumentState: license.documentState,
    license: {
      planId: license.planId || undefined,
      entitlementTier: license.entitlementTier || undefined,
      plan: license.canonicalPlan || undefined,
      status: license.canonicalStatus || undefined,
      canonicalStatus: license.canonicalStatus || undefined,
      maxUsers: license.maxUsers ?? undefined,
      trialEndsAt: license.trialEndsAt,
      subscriptionStartedAt: license.subscriptionStartedAt,
      subscriptionEndsAt: license.subscriptionEndsAt,
      renewalDate: license.renewalDate,
      priceAtSubscription: license.priceAtSubscription,
      currency: license.currency,
      billingInterval: license.billingInterval,
    },
    licenseAdminState: {
      documentState: license.documentState,
      status: license.status,
      plan: license.canonicalPlan,
      activeMembers: license.activeSeatCount,
      maxUsers: license.maxUsers,
      daysRemaining: null,
      expiresAt: renewalAt(license) || null,
      allowedActions: license.allowedActions,
    },
  };
}

function DetailLoadingDialog({ name, error, onClose }: { name: string; error: string | null; onClose: () => void }) {
  return <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={`Subscription license details for ${name}`}><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Subscription license</p><h2 className="mt-1 text-xl font-black text-gray-950">{name}</h2></div><button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-bold text-gray-500 hover:bg-gray-100">Close</button></div>{error ? <div className="mt-5"><ErrorState message={error} /></div> : <div className="mt-5"><LoadingState /></div>}</div></div>;
}

export function SubscriptionOperationsModule() {
  const { platformAdmin } = useAuth();
  const searchParams = useSearchParams();
  const canMutate = platformAdmin?.role === 'SUPER_ADMIN';
  const [data, setData] = useState<SubscriptionOperationsData | null>(null);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [renewalPeriod, setRenewalPeriod] = useState<RenewalFilter>('ALL');
  const [trialExpiration, setTrialExpiration] = useState<TrialFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<SubscriptionOperationLicense | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getSubscriptionLicenseDetail>> | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<{ license: SubscriptionOperationLicense; action: LicenseAdminAction } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await getSubscriptionOperations()); }
    finally { setLoading(false); }
  }, []);
  // Platform operations data is an external synchronization; the state update is intentional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load subscription operations.')); }, [load]);
  // Preserve existing dashboard links into licensing while routing them to the
  // more specific subscription operations filters.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const statusParam = searchParams.get('status');
    const expirationParam = searchParams.get('expiration');
    if (['ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED', 'NO_LICENSE', 'NEEDS_ATTENTION'].includes(statusParam || '')) setStatus(statusParam as StatusFilter);
    if (expirationParam === 'SOON') setRenewalPeriod('WITHIN_30');
  }, [searchParams]);

  const selectedOrganization = useMemo(() => selectedAction ? actionOrganization(selectedAction.license) : undefined, [selectedAction]);
  const { busy, message, runAction } = useLicenseAdminActions({ organizationId: selectedAction?.license.organizationId, refresh: load, onConflict: () => setSelectedAction(null) });
  const licenses = data?.licenses || [];
  const planOptions = useMemo(() => [...new Map(licenses.map((license) => [license.planId || license.canonicalPlan || '', planLabel(license)])).entries()].filter(([value]) => value), [licenses]);
  const filtered = useMemo(() => {
    const now = Date.now();
    const normalizedQuery = query.trim().toLowerCase();
    return licenses.filter((license) => {
      const matchesQuery = !normalizedQuery || [license.organizationName, license.organizationId].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesPlan = plan === 'ALL' || license.planId === plan || license.canonicalPlan === plan;
      const matchesStatus = status === 'ALL' || displayStatus(license) === status;
      return matchesQuery && matchesPlan && matchesStatus && inUpcomingPeriod(renewalAt(license), renewalPeriod, now) && trialMatches(license.trialEndsAt, trialExpiration, now);
    });
  }, [licenses, plan, query, renewalPeriod, status, trialExpiration]);

  const openDetails = async (license: SubscriptionOperationLicense) => {
    setDetailTarget(license); setDetail(null); setDetailError(null);
    try { setDetail(await getSubscriptionLicenseDetail(license.organizationId)); }
    catch (reason) { setDetailError(reason instanceof Error ? reason.message : 'Unable to load subscription license details.'); }
  };
  const submitSelectedAction = async (payload: LicenseActionPayload) => {
    if (!selectedAction || !(await runAction(selectedAction.action, payload))) return;
    setSelectedAction(null);
    setDetail(null);
    setDetailTarget(null);
  };
  const clearFilters = () => { setQuery(''); setPlan('ALL'); setStatus('ALL'); setRenewalPeriod('ALL'); setTrialExpiration('ALL'); };
  const hasFilters = query.trim() || plan !== 'ALL' || status !== 'ALL' || renewalPeriod !== 'ALL' || trialExpiration !== 'ALL';

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} />;
  const overview = data?.overview;
  if (!overview) return <ErrorState message="Subscription operations are unavailable." />;
  const summaryCards = [
    { label: 'Founding 100', value: `${overview.founding100.canonicalEligibleCustomerCount} / ${overview.founding100.limit}`, onClick: () => setPlan('founding_100') },
    { label: 'Standard subscriptions', value: overview.standardSubscriptionCount, onClick: () => setPlan('standard') },
    { label: 'Trial', value: overview.trialCount, onClick: () => setStatus('TRIAL') },
    { label: 'Active', value: overview.activeCount, onClick: () => setStatus('ACTIVE') },
    { label: 'Expired', value: overview.expiredCount, onClick: () => setStatus('EXPIRED') },
    { label: 'Suspended', value: overview.suspendedCount, onClick: () => setStatus('SUSPENDED') },
    { label: 'Upcoming renewals', value: overview.upcomingRenewals.length, onClick: () => setRenewalPeriod('WITHIN_30') },
  ];

  return <section className="space-y-5" aria-labelledby="subscription-operations-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="subscription-operations-heading" className="font-black text-gray-950">Subscription &amp; License Operations</h2><p className="mt-1 text-sm text-gray-500">Platform-only license health, plan snapshots, seats, renewals, and authorized actions.</p></div><button type="button" onClick={() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to refresh subscription operations.'))} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh operations</button></div>
    {message && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" role="status">{message}</p>}
    {error && <ErrorState message={error} />}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">{summaryCards.map((card) => <button key={card.label} type="button" onClick={card.onClick} className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">{card.label}</span><span className="mt-1 block text-xl font-black text-gray-950">{card.value}</span></button>)}</div>
    <section className={`rounded-xl border p-4 ${overview.founding100.matches ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-300 bg-rose-50'}`} aria-labelledby="founding-reconciliation-heading"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 id="founding-reconciliation-heading" className="font-black text-gray-950">Founding 100 allocation reconciliation</h3>{overview.founding100.matches ? <CompactBadge label="Matched" tone="success" /> : <CompactBadge label="Mismatch" tone="danger" />}</div><p className="mt-1 text-xs text-gray-600">Read-only comparison of canonical eligible licenses against the stored platform usage counter.</p></div><CompactBadge label={overview.founding100.publicSignup ? 'Public signup ON' : 'Public signup OFF'} tone={overview.founding100.publicSignup ? 'success' : 'neutral'} /></div><dl className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Canonical count</dt><dd className="mt-1 text-lg font-black text-gray-950">{overview.founding100.canonicalEligibleCustomerCount}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Stored counter</dt><dd className="mt-1 text-lg font-black text-gray-950">{overview.founding100.storedEligibleCustomerCount}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Difference</dt><dd className={`mt-1 text-lg font-black ${overview.founding100.matches ? 'text-emerald-700' : 'text-rose-700'}`}>{overview.founding100.difference > 0 ? '+' : ''}{overview.founding100.difference}</dd></div></dl>{!overview.founding100.matches && <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-rose-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Counter mismatch detected. This screen is read-only; investigate through the existing approved maintenance process.</p>}</section>
    {overview.upcomingRenewals.length > 0 && <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="upcoming-renewals-heading"><div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-gray-500" aria-hidden="true" /><h3 id="upcoming-renewals-heading" className="font-black text-gray-950">Upcoming renewals · next 30 days</h3></div><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{overview.upcomingRenewals.map((license) => <button key={license.organizationId} type="button" onClick={() => void openDetails(license)} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="block truncate font-bold text-gray-950">{license.organizationName}</span><span className="mt-1 block text-xs text-gray-600">{planLabel(license)} · {formatDate(renewalAt(license))}</span></button>)}</div></section>}
    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="subscription-license-table-heading"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="subscription-license-table-heading" className="font-black text-gray-950">License records</h3><p className="mt-1 text-xs text-gray-500">Only platform subscription and license fields are displayed.</p></div><span className="text-xs font-semibold text-gray-500">{filtered.length} of {licenses.length}</span></div><div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(135px,0.45fr))]"><label className="relative min-w-0"><span className="sr-only">Search organization</span><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organization or ID" className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><label><span className="sr-only">Plan</span><select aria-label="Plan filter" value={plan} onChange={(event) => setPlan(event.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All plans</option>{planOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="sr-only">License status</span><select aria-label="License status filter" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All statuses</option><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="NO_LICENSE">No license</option><option value="NEEDS_ATTENTION">Needs attention</option></select></label><label><span className="sr-only">Renewal period</span><select aria-label="Renewal period filter" value={renewalPeriod} onChange={(event) => setRenewalPeriod(event.target.value as RenewalFilter)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All renewal periods</option><option value="WITHIN_7">Renews within 7 days</option><option value="WITHIN_30">Renews within 30 days</option><option value="WITHIN_90">Renews within 90 days</option><option value="OVERDUE">Renewal overdue</option><option value="NO_DATE">No renewal date</option></select></label><label><span className="sr-only">Trial expiration</span><select aria-label="Trial expiration filter" value={trialExpiration} onChange={(event) => setTrialExpiration(event.target.value as TrialFilter)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All trial expiration</option><option value="WITHIN_7">Trial ends within 7 days</option><option value="WITHIN_14">Trial ends within 14 days</option><option value="EXPIRED">Trial expired</option><option value="NO_TRIAL">No trial date</option></select></label></div>{hasFilters && <button type="button" onClick={clearFilters} className="mt-3 rounded-lg px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Clear filters</button>}
      {!filtered.length ? <div className="mt-4"><EmptyState title="No matching license records" message="Adjust or clear the subscription filters to view platform license records." /></div> : <><div className="mt-4 hidden overflow-x-auto rounded-xl border border-gray-200 md:block"><table className="w-full min-w-[1480px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[17%] px-3 py-2">Organization</th><th className="w-[11%] px-3 py-2">Plan</th><th className="w-[10%] px-3 py-2">License status</th><th className="w-[10%] px-3 py-2">Trial end</th><th className="w-[11%] px-3 py-2">Subscription start</th><th className="w-[11%] px-3 py-2">Renewal</th><th className="w-[10%] px-3 py-2">Price snapshot</th><th className="w-[8%] px-3 py-2">Billing</th><th className="w-[7%] px-3 py-2">Seats</th><th className="w-[5%] px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-gray-100">{filtered.map((license) => <tr key={license.organizationId} className="h-16 hover:bg-gray-50"><td className="min-w-0 px-3 py-2"><button type="button" onClick={() => void openDetails(license)} className="block max-w-full truncate text-left font-bold text-gray-950 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{license.organizationName}</button><TruncatedText value={license.organizationId} className="font-mono text-[10px] text-gray-500" /></td><td className="min-w-0 px-3 py-2"><TruncatedText value={planLabel(license)} className="font-semibold" /><TruncatedText value={license.planId || license.canonicalPlan || undefined} className="font-mono text-[10px] text-gray-500" /></td><td className="px-3 py-2"><CompactBadge label={statusLabel(license)} tone={statusTone(license)} /></td><td className="px-3 py-2 text-xs text-gray-600">{formatDate(license.trialEndsAt)}</td><td className="px-3 py-2 text-xs text-gray-600">{formatDate(license.subscriptionStartedAt)}</td><td className="px-3 py-2 text-xs text-gray-600">{formatDate(renewalAt(license))}</td><td className="px-3 py-2 text-xs font-semibold text-gray-700">{money(license.priceAtSubscription, license.currency)}</td><td className="px-3 py-2 text-xs text-gray-600">{license.billingInterval || '—'}</td><td className="px-3 py-2 text-xs font-semibold text-gray-700">{license.maxUsers === null ? `${license.activeSeatCount} / —` : `${license.activeSeatCount} / ${license.maxUsers}`}</td><td className="px-3 py-2"><CompactActionGroup><CompactIconButton label={`View subscription license details for ${license.organizationName}`} onClick={() => void openDetails(license)}><Eye className="h-4 w-4" aria-hidden="true" /></CompactIconButton>{canMutate && license.allowedActions.length > 0 && <details className="relative"><summary aria-label={`More authorized license actions for ${license.organizationName}`} title={`More authorized license actions for ${license.organizationName}`} className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronDown className="h-4 w-4" aria-hidden="true" /></summary><div className="absolute right-0 z-20 mt-2 min-w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">{license.allowedActions.map((action) => <button key={action} type="button" onClick={() => setSelectedAction({ license, action })} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700">{licenseActionLabel(action)}</button>)}</div></details>}</CompactActionGroup></td></tr>)}</tbody></table></div><div className="mt-4 space-y-3 md:hidden">{filtered.map((license) => <article key={license.organizationId} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><button type="button" onClick={() => void openDetails(license)} className="block max-w-full truncate text-left font-bold text-gray-950 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{license.organizationName}</button><TruncatedText value={license.organizationId} className="mt-1 font-mono text-[10px] text-gray-500" /></div><CompactBadge label={statusLabel(license)} tone={statusTone(license)} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Plan</dt><dd className="mt-1 truncate font-semibold">{planLabel(license)}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Seats</dt><dd className="mt-1 font-semibold">{license.maxUsers === null ? `${license.activeSeatCount} / —` : `${license.activeSeatCount} / ${license.maxUsers}`}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Trial end</dt><dd className="mt-1">{formatDate(license.trialEndsAt)}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Renewal</dt><dd className="mt-1">{formatDate(renewalAt(license))}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Price snapshot</dt><dd className="mt-1">{money(license.priceAtSubscription, license.currency)}</dd></div><div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Billing</dt><dd className="mt-1">{license.billingInterval || '—'}</dd></div></dl><div className="mt-4"><button type="button" onClick={() => void openDetails(license)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50"><Settings2 className="h-3.5 w-3.5" aria-hidden="true" />View license operations</button></div></article>)}</div></>}</section>
    {detailTarget && !detail && <DetailLoadingDialog name={detailTarget.organizationName} error={detailError} onClose={() => { setDetailTarget(null); setDetailError(null); }} />}
    {detail && <SubscriptionLicenseDetailsDialog detail={detail} canMutate={canMutate} onClose={() => { setDetail(null); setDetailTarget(null); }} onAction={(action) => setSelectedAction({ license: detail.license, action })} />}
    {selectedAction && selectedOrganization && <LicenseActionDialog action={selectedAction.action} organization={selectedOrganization} activeMembers={selectedAction.license.activeSeatCount} busy={busy} onClose={() => !busy && setSelectedAction(null)} onSubmit={(payload) => void submitSelectedAction(payload)} />}
  </section>;
}
