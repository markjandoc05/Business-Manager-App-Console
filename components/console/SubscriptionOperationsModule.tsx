'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Eye, RefreshCw, Search, Settings2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { getSubscriptionLicenseDetail, getSubscriptionOperationLicensePage, getSubscriptionOperations } from '@/lib/console-api';
import type { LicenseAdminAction, LicenseActionPayload, Organization, SubscriptionLicenseStatusFilter, SubscriptionOperationLicense, SubscriptionOperationLicenseFilters, SubscriptionOperationLicensePage, SubscriptionOperationsOverview, SubscriptionRenewalFilter, SubscriptionTrialFilter } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { licenseActionLabel, LicenseActionDialog } from './LicenseActionDialog';
import { SubscriptionLicenseDetailsDialog } from './SubscriptionLicenseDetailsDialog';
import { useLicenseAdminActions } from '@/lib/use-license-admin-actions';
import { CompactActionGroup, CompactBadge, CompactIconButton, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';

const PLAN_OPTIONS = [
  ['founding_100', 'Founding 100'], ['standard', 'Standard'],
  ['TRIAL', 'Trial entitlement'], ['SOLO', 'Solo entitlement'],
  ['STARTER', 'Starter entitlement'], ['TEAM', 'Team entitlement'], ['LEGACY', 'Legacy entitlement'],
] as const;

function money(value: number | null, currency?: string) {
  if (value === null || value === undefined || !currency) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function displayStatus(license: SubscriptionOperationLicense) {
  if (license.documentState === 'NO_LICENSE') return 'NO_LICENSE';
  if (license.documentState === 'INVALID_LICENSE') return 'NEEDS_ATTENTION';
  return license.status;
}

function statusLabel(license: SubscriptionOperationLicense) { return displayStatus(license).replaceAll('_', ' '); }

function statusTone(license: SubscriptionOperationLicense) {
  const status = displayStatus(license);
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'TRIAL') return 'info' as const;
  if (status === 'EXPIRED' || status === 'SUSPENDED') return 'danger' as const;
  return 'warning' as const;
}

function planLabel(license: SubscriptionOperationLicense) { return license.planName || license.canonicalPlan || 'No plan'; }
function renewalAt(license: SubscriptionOperationLicense) { return license.renewalDate || license.subscriptionEndsAt; }

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
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={`Subscription license details for ${name}`}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Subscription license</p>
            <h2 className="mt-1 text-xl font-black text-gray-950">{name}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm font-bold text-gray-500 hover:bg-gray-100">Close</button>
        </div>
        <div className="mt-5">{error ? <ErrorState message={error} /> : <LoadingState />}</div>
      </div>
    </div>
  );
}

function LicenseRowActions({ license, canMutate, onOpenDetails, onAction }: {
  license: SubscriptionOperationLicense;
  canMutate: boolean;
  onOpenDetails: (license: SubscriptionOperationLicense) => void;
  onAction: (license: SubscriptionOperationLicense, action: LicenseAdminAction) => void;
}) {
  return (
    <CompactActionGroup>
      <CompactIconButton label={`View subscription license details for ${license.organizationName}`} onClick={() => onOpenDetails(license)}>
        <Eye className="h-4 w-4" aria-hidden="true" />
      </CompactIconButton>
      {canMutate && license.allowedActions.length > 0 && (
        <details className="relative">
          <summary aria-label={`More authorized license actions for ${license.organizationName}`} className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-20 mt-2 min-w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
            {license.allowedActions.map((action) => (
              <button key={action} type="button" onClick={() => onAction(license, action)} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700">
                {licenseActionLabel(action)}
              </button>
            ))}
          </div>
        </details>
      )}
    </CompactActionGroup>
  );
}

export function SubscriptionOperationsModule() {
  const { platformAdmin } = useAuth();
  const searchParams = useSearchParams();
  const canMutate = platformAdmin?.role === 'SUPER_ADMIN';
  const [overview, setOverview] = useState<SubscriptionOperationsOverview | null>(null);
  const [page, setPage] = useState<SubscriptionOperationLicensePage | null>(null);
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('ALL');
  const [status, setStatus] = useState<SubscriptionLicenseStatusFilter>('ALL');
  const [renewalPeriod, setRenewalPeriod] = useState<SubscriptionRenewalFilter>('ALL');
  const [trialExpiration, setTrialExpiration] = useState<SubscriptionTrialFilter>('ALL');
  const [activeFilters, setActiveFilters] = useState<SubscriptionOperationLicenseFilters>({});
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<SubscriptionOperationLicense | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getSubscriptionLicenseDetail>> | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<{ license: SubscriptionOperationLicense; action: LicenseAdminAction } | null>(null);
  // Clear privileged drafts when the external authorization profile changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!(canMutate)) { setSelectedAction(null); } }, [canMutate]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const operationData = await getSubscriptionOperations();
      setOverview(operationData.overview);
    } catch (reason) {
      setOverviewError(reason instanceof Error ? reason.message : 'Unable to load subscription overview.');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadLicensePage = useCallback(async () => {
    setPageLoading(true);
    setPageError(null);
    try {
      setPage(await getSubscriptionOperationLicensePage(activeFilters, cursor));
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : 'Unable to load subscription license records.');
    } finally {
      setPageLoading(false);
    }
  }, [activeFilters, cursor]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadOverview(), loadLicensePage()]);
  }, [loadLicensePage, loadOverview]);

  // These synchronize read-only trusted Console data; browser state holds no authority.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadOverview(); }, [loadOverview]);
  // License navigation and filters do not recompute the full aggregate overview.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadLicensePage(); }, [loadLicensePage]);
  useEffect(() => {
    const statusParam = searchParams.get('status');
    const expirationParam = searchParams.get('expiration');
    void Promise.resolve().then(() => {
      if (['ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED', 'NO_LICENSE', 'NEEDS_ATTENTION'].includes(statusParam || '')) {
        setStatus(statusParam as SubscriptionLicenseStatusFilter);
        setActiveFilters((current) => ({ ...current, status: statusParam as SubscriptionLicenseStatusFilter }));
        setCursor(undefined);
        setPreviousCursors([]);
      }
      if (expirationParam === 'SOON') {
        setRenewalPeriod('WITHIN_30');
        setActiveFilters((current) => ({ ...current, renewalPeriod: 'WITHIN_30' }));
        setCursor(undefined);
        setPreviousCursors([]);
      }
    });
  }, [searchParams]);

  const selectedOrganization = useMemo(() => selectedAction ? actionOrganization(selectedAction.license) : undefined, [selectedAction]);
  const { busy, message, runAction } = useLicenseAdminActions({ organizationId: selectedAction?.license.organizationId, refresh: refreshAll, onConflict: () => setSelectedAction(null) });
  const licenses = page?.licenses || [];
  const pageNumber = previousCursors.length + 1;
  const applyFilters = (event?: React.FormEvent) => {
    event?.preventDefault();
    setActiveFilters({ query: query || undefined, plan, status, renewalPeriod, trialExpiration });
    setCursor(undefined);
    setPreviousCursors([]);
  };
  const applyQuickFilters = (next: SubscriptionOperationLicenseFilters) => {
    setPlan(next.plan || 'ALL');
    setStatus(next.status || 'ALL');
    setRenewalPeriod(next.renewalPeriod || 'ALL');
    setTrialExpiration(next.trialExpiration || 'ALL');
    setActiveFilters(next);
    setCursor(undefined);
    setPreviousCursors([]);
  };
  const clearFilters = () => {
    setQuery('');
    setPlan('ALL');
    setStatus('ALL');
    setRenewalPeriod('ALL');
    setTrialExpiration('ALL');
    setActiveFilters({});
    setCursor(undefined);
    setPreviousCursors([]);
  };
  const hasFilters = Boolean(activeFilters.query || activeFilters.plan || (activeFilters.status && activeFilters.status !== 'ALL') || (activeFilters.renewalPeriod && activeFilters.renewalPeriod !== 'ALL') || (activeFilters.trialExpiration && activeFilters.trialExpiration !== 'ALL'));
  const nextPage = () => {
    if (page?.nextCursor) {
      setPreviousCursors((current) => [...current, cursor]);
      setCursor(page.nextCursor);
    }
  };
  const previousPage = () => {
    if (previousCursors.length) {
      const previous = previousCursors[previousCursors.length - 1];
      setPreviousCursors((current) => current.slice(0, -1));
      setCursor(previous);
    }
  };
  const openDetails = async (license: SubscriptionOperationLicense) => {
    setDetailTarget(license);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(await getSubscriptionLicenseDetail(license.organizationId));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : 'Unable to load subscription license details.');
    }
  };
  const submitSelectedAction = async (payload: LicenseActionPayload) => {
    if (!selectedAction || !(await runAction(selectedAction.action, payload))) return;
    setSelectedAction(null);
    setDetail(null);
    setDetailTarget(null);
  };

  const loading = overviewLoading || pageLoading;
  const error = overviewError || pageError;
  if (overviewLoading && !overview) return <LoadingState />;
  if (overviewError && !overview) return <ErrorState message={overviewError} />;
  if (!overview) return <ErrorState message="Subscription operations are unavailable." />;

  const summaryCards = [
    { label: 'Founding 100', value: `${overview.founding100.canonicalEligibleCustomerCount} / ${overview.founding100.limit}`, filters: { plan: 'founding_100' } },
    { label: 'Standard', value: overview.standardSubscriptionCount, filters: { plan: 'standard' } },
    { label: 'Trials', value: overview.trialCount, filters: { status: 'TRIAL' as const } },
    { label: 'Active', value: overview.activeCount, filters: { status: 'ACTIVE' as const } },
    { label: 'Expired', value: overview.expiredCount, filters: { status: 'EXPIRED' as const } },
    { label: 'Suspended', value: overview.suspendedCount, filters: { status: 'SUSPENDED' as const } },
  ];

  return (
    <section className="space-y-5" aria-labelledby="subscription-operations-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="subscription-operations-heading" className="font-black text-gray-950">Subscription &amp; License Operations</h2>
          <p className="mt-1 text-sm text-gray-500">Platform-only license health and authorized operations.</p>
        </div>
        <button type="button" onClick={() => void refreshAll()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh all
        </button>
      </div>

      {message && <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" role="status">{message}</p>}
      {error && <ErrorState message={error} />}

      <aside className={`rounded-xl border p-3 text-sm ${overview.founding100.usageExceedsLimit ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-gray-200 bg-white text-gray-700'}`} aria-label="Founding customer capacity">
        <span className="font-black">Founding capacity</span>
        <span className="ml-2">{overview.founding100.canonicalEligibleCustomerCount} / {overview.founding100.limit}</span>
        <span className="ml-3 text-xs">{overview.founding100.remainingCapacity} remaining</span>
        {overview.founding100.usageExceedsLimit && <span className="ml-3 text-xs font-bold">Canonical usage exceeds the configured limit. No records were changed.</span>}
      </aside>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <button key={card.label} type="button" onClick={() => applyQuickFilters(card.filters)} className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-500">{card.label}</span>
            <span className="mt-1 block text-xl font-black text-gray-950">{card.value}</span>
          </button>
        ))}
      </div>

      <section className={`rounded-xl border p-4 ${overview.founding100.matches ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-300 bg-rose-50'}`} aria-labelledby="founding-reconciliation-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 id="founding-reconciliation-heading" className="font-black text-gray-950">Founding 100 reconciliation</h3>
              <CompactBadge label={overview.founding100.matches ? 'Matched' : 'Mismatch'} tone={overview.founding100.matches ? 'success' : 'danger'} />
            </div>
            <p className="mt-1 text-xs text-gray-600">Read-only canonical-license and stored-counter comparison.</p>
          </div>
          <CompactBadge label={overview.founding100.publicSignup ? 'Public signup ON' : 'Public signup OFF'} tone={overview.founding100.publicSignup ? 'success' : 'neutral'} />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Canonical count</dt><dd className="mt-1 text-lg font-black text-gray-950">{overview.founding100.canonicalEligibleCustomerCount}</dd></div>
          <div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Stored counter</dt><dd className="mt-1 text-lg font-black text-gray-950">{overview.founding100.storedEligibleCustomerCount}</dd></div>
          <div><dt className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Difference</dt><dd className={`mt-1 text-lg font-black ${overview.founding100.matches ? 'text-emerald-700' : 'text-rose-700'}`}>{overview.founding100.difference > 0 ? '+' : ''}{overview.founding100.difference}</dd></div>
        </dl>
        {!overview.founding100.matches && <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-rose-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Counter mismatch detected. This screen does not repair it.</p>}
      </section>

      {overview.upcomingRenewals.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="upcoming-renewals-heading">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-gray-500" aria-hidden="true" />
            <h3 id="upcoming-renewals-heading" className="font-black text-gray-950">Upcoming renewals · next 30 days</h3>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {overview.upcomingRenewals.map((license) => (
              <button key={license.organizationId} type="button" onClick={() => void openDetails(license)} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <span className="block truncate font-bold text-gray-950">{license.organizationName}</span>
                <span className="mt-1 block text-xs text-gray-600">{planLabel(license)} · {formatDate(renewalAt(license))}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="subscription-license-table-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="subscription-license-table-heading" className="font-black text-gray-950">License records</h3>
            <p className="mt-1 text-xs text-gray-500">Server-paged platform subscription records. Full license detail and audit history open on demand.</p>
          </div>
          <span className="text-xs font-semibold text-gray-500">Page {pageNumber} · {licenses.length} license{licenses.length === 1 ? '' : 's'} shown · up to 25 per page</span>
        </div>

        <form onSubmit={applyFilters} className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(130px,0.45fr))_auto]">
          <label className="relative min-w-0">
            <span className="sr-only">Search organization</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organization" className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </label>
          <select aria-label="Plan filter" value={plan} onChange={(event) => setPlan(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All plans</option>{PLAN_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="License status filter" value={status} onChange={(event) => setStatus(event.target.value as SubscriptionLicenseStatusFilter)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All statuses</option><option value="TRIAL">Trial</option><option value="ACTIVE">Active</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="NO_LICENSE">No license</option><option value="NEEDS_ATTENTION">Needs attention</option></select>
          <select aria-label="Renewal period filter" value={renewalPeriod} onChange={(event) => setRenewalPeriod(event.target.value as SubscriptionRenewalFilter)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All renewals</option><option value="WITHIN_7">Within 7 days</option><option value="WITHIN_30">Within 30 days</option><option value="WITHIN_90">Within 90 days</option><option value="OVERDUE">Overdue</option><option value="NO_DATE">No renewal date</option></select>
          <select aria-label="Trial expiration filter" value={trialExpiration} onChange={(event) => setTrialExpiration(event.target.value as SubscriptionTrialFilter)} className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All trial states</option><option value="WITHIN_7">Ends within 7 days</option><option value="WITHIN_14">Ends within 14 days</option><option value="EXPIRED">Expired</option><option value="NO_TRIAL">No trial date</option></select>
          <button type="submit" disabled={loading} className="rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">Apply</button>
        </form>
        {hasFilters && <button type="button" onClick={clearFilters} className="mt-3 rounded-lg px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500">Clear filters</button>}

        {!licenses.length && !loading ? (
          <div className="mt-4"><EmptyState title="No matching license records" message="Adjust the server-side filters or continue to the next page." /></div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-gray-200 md:block">
              <table className="w-full min-w-[1080px] table-fixed text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr><th className="w-[21%] px-3 py-2">Organization</th><th className="w-[15%] px-3 py-2">Plan</th><th className="w-[12%] px-3 py-2">Status</th><th className="w-[21%] px-3 py-2">Trial / renewal</th><th className="w-[13%] px-3 py-2">Price &amp; billing</th><th className="w-[9%] px-3 py-2">Seats</th><th className="w-[9%] px-3 py-2">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {licenses.map((license) => (
                    <tr key={license.organizationId} className="hover:bg-gray-50">
                      <td className="min-w-0 px-3 py-3"><button type="button" onClick={() => void openDetails(license)} className="block max-w-[240px] truncate text-left font-bold text-gray-950 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{license.organizationName}</button></td>
                      <td className="px-3 py-3"><TruncatedText value={planLabel(license)} className="font-semibold" />{license.entitlementTier && <p className="mt-1 text-[10px] text-gray-500">Client tier: {license.entitlementTier}</p>}</td>
                      <td className="px-3 py-3"><CompactBadge label={statusLabel(license)} tone={statusTone(license)} /></td>
                      <td className="px-3 py-3 text-xs text-gray-600"><p>Trial end: {formatDate(license.trialEndsAt)}</p><p className="mt-1">Renewal: {formatDate(renewalAt(license))}</p><p className="mt-1 text-gray-400">Subscription start: {formatDate(license.subscriptionStartedAt)}</p></td>
                      <td className="px-3 py-3 text-xs text-gray-600"><p className="font-semibold text-gray-700">{money(license.priceAtSubscription, license.currency)}</p><p className="mt-1">{license.billingInterval || '—'}</p></td>
                      <td className="px-3 py-3 text-xs font-semibold text-gray-700">{license.maxUsers === null ? `${license.activeSeatCount} / —` : `${license.activeSeatCount} / ${license.maxUsers}`}</td>
                      <td className="px-3 py-3"><LicenseRowActions license={license} canMutate={canMutate} onOpenDetails={(next) => void openDetails(next)} onAction={(next, action) => setSelectedAction({ license: next, action })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-3 md:hidden">
              {licenses.map((license) => (
                <article key={license.organizationId} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => void openDetails(license)} className="block min-w-0 max-w-full truncate text-left font-bold text-gray-950 hover:text-blue-700">{license.organizationName}</button>
                    <CompactBadge label={statusLabel(license)} tone={statusTone(license)} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-[10px] font-bold uppercase text-gray-400">Plan</dt><dd className="mt-1 truncate font-semibold">{planLabel(license)}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase text-gray-400">Seats</dt><dd className="mt-1 font-semibold">{license.maxUsers === null ? `${license.activeSeatCount} / —` : `${license.activeSeatCount} / ${license.maxUsers}`}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase text-gray-400">Trial end</dt><dd className="mt-1">{formatDate(license.trialEndsAt)}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase text-gray-400">Renewal</dt><dd className="mt-1">{formatDate(renewalAt(license))}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase text-gray-400">Price snapshot</dt><dd className="mt-1">{money(license.priceAtSubscription, license.currency)}</dd></div>
                    <div><dt className="text-[10px] font-bold uppercase text-gray-400">Billing</dt><dd className="mt-1">{license.billingInterval || '—'}</dd></div>
                  </dl>
                  <button type="button" onClick={() => void openDetails(license)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:border-blue-300 hover:bg-blue-50"><Settings2 className="h-3.5 w-3.5" aria-hidden="true" />View license operations</button>
                </article>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500">Records are read in server-side pages of up to 25. Filters are applied on the trusted backend.</p>
          <div className="flex gap-2">
            <button type="button" onClick={previousPage} disabled={loading || previousCursors.length === 0} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />Previous</button>
            <button type="button" onClick={nextPage} disabled={loading || !page?.hasMore || !page.nextCursor} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </div>
        </div>
      </section>

      {detailTarget && !detail && <DetailLoadingDialog name={detailTarget.organizationName} error={detailError} onClose={() => { setDetailTarget(null); setDetailError(null); }} />}
      {detail && <SubscriptionLicenseDetailsDialog detail={detail} canMutate={canMutate} onClose={() => { setDetail(null); setDetailTarget(null); }} onAction={(action) => setSelectedAction({ license: detail.license, action })} />}
      {canMutate && selectedAction && selectedOrganization && <LicenseActionDialog action={selectedAction.action} organization={selectedOrganization} activeMembers={selectedAction.license.activeSeatCount} busy={busy} onClose={() => !busy && setSelectedAction(null)} onSubmit={(payload) => void submitSelectedAction(payload)} />}
    </section>
  );
}
