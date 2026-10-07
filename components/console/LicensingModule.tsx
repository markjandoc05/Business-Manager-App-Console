'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, CircleCheck, Eye, History, Power, RefreshCw, Search, Settings2, Wrench } from 'lucide-react';
import { getLicensing } from '@/lib/console-api';
import type { LicenseAdminAction, LicenseAdminState, LicenseActionPayload, LicenseDocumentState, Organization, OrganizationPlan } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { licenseActionLabel } from './LicenseActionDialog';
import { LicenseActionDialog } from './LicenseActionDialog';
import { useLicenseAdminActions } from '@/lib/use-license-admin-actions';
import { CompactActionGroup, CompactIconButton, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';

type StatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED' | 'NO_LICENSE' | 'NEEDS_ATTENTION';
type PlanFilter = 'ALL' | OrganizationPlan;
type ExpirationFilter = 'ALL' | 'WITHIN_7' | 'WITHIN_30' | 'EXPIRED';

const statusLabels: Record<StatusFilter | 'UNKNOWN', string> = {
  ALL: 'All statuses', ACTIVE: 'Active', TRIAL: 'Trial', EXPIRED: 'Expired', SUSPENDED: 'Suspended', NO_LICENSE: 'No License', NEEDS_ATTENTION: 'Needs Attention', UNKNOWN: 'Needs Attention',
};
type OrganizationDocumentStatus = LicenseDocumentState | 'UNKNOWN';
const planLabels: Record<string, string> = { TRIAL: 'Trial', SOLO: 'Solo', STARTER: 'Starter', TEAM: 'Team', LEGACY: 'Legacy' };

function documentStatus(org: Organization): OrganizationDocumentStatus {
  return org.licenseDocumentState || 'UNKNOWN';
}

function statusLabel(org: Organization) {
  const state = org.licenseAdminState;
  if (org.licenseDocumentState === 'NO_LICENSE') return 'No License';
  if (org.licenseDocumentState === 'INVALID_LICENSE') return 'Needs Attention';
  return statusLabels[state?.status || 'UNKNOWN'];
}

function statusClasses(org: Organization) {
  const state = org.licenseAdminState;
  if (org.licenseDocumentState === 'NO_LICENSE' || org.licenseDocumentState === 'INVALID_LICENSE') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (state?.status === 'TRIAL') return 'border-violet-200 bg-violet-50 text-violet-800';
  if (state?.status === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (state?.status === 'EXPIRED') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (state?.status === 'SUSPENDED') return 'border-slate-300 bg-slate-100 text-slate-800';
  return 'border-gray-200 bg-gray-100 text-gray-700';
}

function LicenseStatusBadge({ organization }: { organization: Organization }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${statusClasses(organization)}`}>{statusLabel(organization)}</span>;
}

function remainingLabel(state?: LicenseAdminState) {
  if (!state || state.daysRemaining === null) return '—';
  if (state.status === 'EXPIRED') return 'Expired';
  if (state.daysRemaining === 0) return 'Today';
  return `${state.daysRemaining} day${state.daysRemaining === 1 ? '' : 's'}`;
}

function remainingClasses(state?: LicenseAdminState) {
  if (!state || state.daysRemaining === null) return 'text-gray-500';
  if (state.status === 'EXPIRED') return 'font-bold text-rose-700';
  if (state.daysRemaining <= 7) return 'font-bold text-amber-700';
  if (state.daysRemaining <= 30) return 'font-semibold text-amber-600';
  return 'text-gray-700';
}

function hasServerDaysRemaining(organization: Organization, maxDays: number) {
  const state = organization.licenseAdminState;
  return organization.licenseDocumentState === 'VALID_LICENSE' && state !== undefined && state.daysRemaining !== null && state.daysRemaining >= 0 && state.daysRemaining <= maxDays;
}

function isExpiringSoon(organization: Organization) {
  return organization.licenseAdminState?.status === 'ACTIVE' && hasServerDaysRemaining(organization, 30);
}

function isWithin30Days(organization: Organization) {
  return hasServerDaysRemaining(organization, 30);
}

function primaryAction(organization: Organization): LicenseAdminAction | 'REVIEW' | 'MANAGE' {
  const state = organization.licenseAdminState;
  const allowed = state?.allowedActions || [];
  if (organization.licenseDocumentState === 'NO_LICENSE' && allowed.includes('ACTIVATE')) return 'ACTIVATE';
  if (organization.licenseDocumentState === 'INVALID_LICENSE' && allowed.includes('REPAIR_LICENSE')) return 'REPAIR_LICENSE';
  if (state?.status === 'TRIAL' && isWithin30Days(organization) && allowed.includes('EXTEND_TRIAL')) return 'EXTEND_TRIAL';
  if (state?.status === 'ACTIVE' && isExpiringSoon(organization) && allowed.includes('EXTEND_SUBSCRIPTION')) return 'EXTEND_SUBSCRIPTION';
  if (state?.status === 'EXPIRED' && allowed.includes('RENEW')) return 'RENEW';
  if (state?.status === 'SUSPENDED' && allowed.includes('REACTIVATE')) return 'REACTIVATE';
  return 'MANAGE';
}

function isActiveFilter(status: StatusFilter, plan: PlanFilter, expiration: ExpirationFilter, query: string) {
  return status !== 'ALL' || plan !== 'ALL' || expiration !== 'ALL' || query.trim().length > 0;
}

function licenseActionIcon(action: LicenseAdminAction | 'REVIEW' | 'MANAGE' | 'VIEW') {
  if (action === 'REPAIR_LICENSE') return <Wrench className="h-4 w-4" aria-hidden="true" />;
  if (action === 'ACTIVATE') return <Power className="h-4 w-4" aria-hidden="true" />;
  if (action === 'RENEW' || action === 'EXTEND_TRIAL' || action === 'EXTEND_SUBSCRIPTION') return <RefreshCw className="h-4 w-4" aria-hidden="true" />;
  if (action === 'REACTIVATE') return <CircleCheck className="h-4 w-4" aria-hidden="true" />;
  return <Settings2 className="h-4 w-4" aria-hidden="true" />;
}

function ActionMenu({ organization, primary, canMutate, busy, onAction, onView, onHistory }: { organization: Organization; primary: LicenseAdminAction | 'REVIEW' | 'MANAGE' | 'VIEW'; canMutate: boolean; busy: boolean; onAction: (action: LicenseAdminAction) => void; onView: () => void; onHistory: () => void }) {
  const allowed = canMutate ? organization.licenseAdminState?.allowedActions || [] : [];
  const secondaryActions = allowed.filter((action) => action !== primary);
  const primaryLabel = primary === 'REVIEW' ? 'Review' : primary === 'MANAGE' ? 'Manage' : primary === 'VIEW' ? 'View Organization' : licenseActionLabel(primary);
  return <CompactActionGroup><CompactIconButton label={`${primaryLabel} for ${organization.name}`} onClick={() => primary === 'REVIEW' || primary === 'MANAGE' || primary === 'VIEW' ? onView() : onAction(primary)} disabled={busy} className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">{licenseActionIcon(primary)}</CompactIconButton>{primary !== 'VIEW' && <CompactIconButton label={`View Organization for ${organization.name}`} onClick={onView}><Eye className="h-4 w-4" aria-hidden="true" /></CompactIconButton>}<CompactIconButton label={`View license history for ${organization.name}`} onClick={onHistory}><History className="h-4 w-4" aria-hidden="true" /></CompactIconButton>{secondaryActions.length > 0 && <details className="relative"><summary aria-label={`More license actions for ${organization.name}`} title={`More license actions for ${organization.name}`} className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronDown className="h-4 w-4" aria-hidden="true" /><span className="sr-only">More license actions</span></summary><div className="absolute right-0 z-20 mt-2 min-w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">{secondaryActions.map((action) => <button type="button" key={action} onClick={() => onAction(action)} disabled={busy} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">{licenseActionLabel(action)}</button>)}</div></details>}</CompactActionGroup>;
}

export function LicensingModule() {
  const router = useRouter();
  const { platformAdmin } = useAuth();
  const [items, setItems] = useState<Organization[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [plan, setPlan] = useState<PlanFilter>('ALL');
  const [expiration, setExpiration] = useState<ExpirationFilter>('ALL');
  const [selected, setSelected] = useState<{ organization: Organization; action: LicenseAdminAction } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canMutate = platformAdmin?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setError(null);
    const result = await getLicensing();
    setItems(result);
  }, []);
  // Data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Unable to load licensing data.')).finally(() => setLoading(false)); }, [load]);
  // URL query parameters are an external navigation input for the existing licensing filters.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const params = new URLSearchParams(window.location.search); const statusParam = params.get('status'); const expirationParam = params.get('expiration'); if (['ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED', 'NO_LICENSE', 'NEEDS_ATTENTION'].includes(statusParam || '')) setStatus(statusParam as StatusFilter); if (expirationParam === 'SOON') setExpiration('WITHIN_30'); }, []);

  const { busy, message, runAction } = useLicenseAdminActions({ organizationId: selected?.organization.id, refresh: load, onConflict: () => setSelected(null) });
  const counts = useMemo(() => ({
    active: items.filter((org) => org.licenseAdminState?.status === 'ACTIVE').length,
    trial: items.filter((org) => org.licenseAdminState?.status === 'TRIAL').length,
    expiring: items.filter((org) => isExpiringSoon(org)).length,
    expired: items.filter((org) => org.licenseAdminState?.status === 'EXPIRED').length,
    suspended: items.filter((org) => org.licenseAdminState?.status === 'SUSPENDED').length,
    attention: items.filter((org) => ['NO_LICENSE', 'INVALID_LICENSE'].includes(org.licenseAdminState?.documentState || '')).length,
  }), [items]);

  const filtered = useMemo(() => items.filter((org) => {
    const state = org.licenseAdminState;
    const normalizedQuery = query.trim().toLowerCase();
    const matchesSearch = !normalizedQuery || [org.name, org.slug, org.ownerEmail].some((value) => value?.toLowerCase().includes(normalizedQuery));
    const matchesStatus = status === 'ALL' || (status === 'NO_LICENSE' && documentStatus(org) === 'NO_LICENSE') || (status === 'NEEDS_ATTENTION' && documentStatus(org) === 'INVALID_LICENSE') || state?.status === status;
    const matchesPlan = plan === 'ALL' || state?.plan === plan;
    const matchesExpiration = expiration === 'ALL' || (expiration === 'EXPIRED' && state?.status === 'EXPIRED') || (expiration === 'WITHIN_7' && hasServerDaysRemaining(org, 7)) || (expiration === 'WITHIN_30' && hasServerDaysRemaining(org, 30));
    return matchesSearch && matchesStatus && matchesPlan && matchesExpiration;
  }), [expiration, items, plan, query, status]);

  const clearFilters = () => { setQuery(''); setStatus('ALL'); setPlan('ALL'); setExpiration('ALL'); };
  const openAction = (organization: Organization, action: LicenseAdminAction) => setSelected({ organization, action });
  const viewOrganization = (organization: Organization) => router.push(`/organizations/${organization.id}`);
  const viewHistory = (organization: Organization) => router.push(`/audit-logs?organizationId=${encodeURIComponent(organization.id)}`);
  const activeMemberCount = (organization: Organization) => organization.activeMemberCount ?? 0;
  const submitAction = async (payload: LicenseActionPayload) => { if (selected && await runAction(selected.action, payload)) setSelected(null); };
  const cards = [
    { label: 'Active', value: counts.active, onClick: () => { setStatus('ACTIVE'); setExpiration('ALL'); } },
    { label: 'Trial', value: counts.trial, onClick: () => { setStatus('TRIAL'); setExpiration('ALL'); } },
    { label: 'Expiring Soon', value: counts.expiring, onClick: () => setExpiration('WITHIN_30') },
    { label: 'Expired', value: counts.expired, onClick: () => setStatus('EXPIRED') },
    { label: 'Suspended', value: counts.suspended, onClick: () => setStatus('SUSPENDED') },
    { label: 'Needs Attention', value: counts.attention, onClick: () => setStatus('NEEDS_ATTENTION') },
  ];

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const hasFilters = isActiveFilter(status, plan, expiration, query);
  return <div className="space-y-6">
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800" role="status">{message}</div>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{cards.map((card) => <button type="button" key={card.label} onClick={card.onClick} className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="block text-xs font-bold text-gray-500">{card.label}</span><span className="mt-2 block text-2xl font-black text-gray-950">{card.value}</span></button>)}</div>
    <div className="rounded-xl border border-gray-200 bg-white p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><label className="relative min-w-0 flex-1"><span className="sr-only">Search organizations</span><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search organizations..." className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label><span className="sr-only">Status</span><select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="NO_LICENSE">No License</option><option value="NEEDS_ATTENTION">Needs Attention</option></select></label><label><span className="sr-only">Plan</span><select aria-label="Plan filter" value={plan} onChange={(e) => setPlan(e.target.value as PlanFilter)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All plans</option>{(['TRIAL', 'STARTER', 'TEAM', 'LEGACY'] as OrganizationPlan[]).map((item) => <option key={item} value={item}>{planLabels[item]}</option>)}</select></label><label><span className="sr-only">Expiration</span><select aria-label="Expiration filter" value={expiration} onChange={(e) => setExpiration(e.target.value as ExpirationFilter)} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All expirations</option><option value="WITHIN_7">Expiring within 7 days</option><option value="WITHIN_30">Expiring within 30 days</option><option value="EXPIRED">Expired</option></select></label></div>{hasFilters && <button type="button" onClick={clearFilters} className="self-start rounded-lg px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 lg:self-auto">Clear filters</button>}</div></div>
    {!filtered.length ? <EmptyState title="No matching license records" message="Try clearing one or more filters. License data is read from the server-derived organization state." /> : <>
      <div className="hidden overflow-visible rounded-xl border border-gray-200 bg-white md:block"><div className="overflow-x-auto"><table className="w-full min-w-[980px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[27%] px-3 py-2">Organization</th><th className="w-[11%] px-3 py-2">Plan</th><th className="w-[15%] px-3 py-2">Status</th><th className="w-[12%] px-3 py-2">Users</th><th className="w-[13%] px-3 py-2">Expiration</th><th className="w-[11%] px-3 py-2">Remaining</th><th className="w-[11%] px-3 py-2">Action</th></tr></thead><tbody className="divide-y divide-gray-100">{filtered.map((organization) => { const state = organization.licenseAdminState; const primary = canMutate ? primaryAction(organization) : 'VIEW'; return <tr key={organization.id} className="h-14 align-middle hover:bg-gray-50"><td className="min-w-0 px-3 py-2"><button type="button" onClick={() => viewOrganization(organization)} title={organization.name} className="block max-w-full truncate font-bold text-gray-900 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{organization.name}</button><TruncatedText value={organization.ownerEmail || organization.slug} className="text-xs text-gray-500" /></td><td className="px-3 py-2"><TruncatedText value={state?.plan ? planLabels[state.plan] : undefined} /></td><td className="px-3 py-2"><LicenseStatusBadge organization={organization} /></td><td className="px-3 py-2 font-semibold">{state ? `${activeMemberCount(organization)} / ${state.maxUsers ?? '—'}` : '—'}</td><td className="px-3 py-2">{formatDate(state?.expiresAt || undefined)}</td><td className={`px-3 py-2 ${remainingClasses(state)}`} title={remainingLabel(state)}>{remainingLabel(state)}</td><td className="px-3 py-2"><ActionMenu organization={organization} primary={primary} canMutate={canMutate} busy={busy} onAction={(action) => openAction(organization, action)} onView={() => viewOrganization(organization)} onHistory={() => viewHistory(organization)} /></td></tr>; })}</tbody></table></div></div>
      <div className="space-y-3 md:hidden">{filtered.map((organization) => { const state = organization.licenseAdminState; const primary = canMutate ? primaryAction(organization) : 'VIEW'; return <article key={organization.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><button type="button" onClick={() => viewOrganization(organization)} title={organization.name} className="block max-w-full truncate text-left font-bold text-gray-900 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{organization.name}</button><TruncatedText value={organization.ownerEmail || organization.slug} className="mt-1 text-xs text-gray-500" /></div><LicenseStatusBadge organization={organization} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Plan</dt><dd className="mt-1">{state?.plan ? planLabels[state.plan] : '—'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Users</dt><dd className="mt-1 font-semibold">{state ? `${activeMemberCount(organization)} / ${state.maxUsers ?? '—'}` : '—'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Expiration</dt><dd className="mt-1">{formatDate(state?.expiresAt || undefined)}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Remaining</dt><dd className={`mt-1 ${remainingClasses(state)}`} title={remainingLabel(state)}>{remainingLabel(state)}</dd></div></dl><div className="mt-4"><ActionMenu organization={organization} primary={primary} canMutate={canMutate} busy={busy} onAction={(action) => openAction(organization, action)} onView={() => viewOrganization(organization)} onHistory={() => viewHistory(organization)} /></div></article>; })}</div>
    </>}
    {canMutate && selected && <LicenseActionDialog action={selected.action} organization={selected.organization} activeMembers={selected.organization.activeMemberCount ?? 0} busy={busy} onClose={() => !busy && setSelected(null)} onSubmit={(payload) => void submitAction(payload)} />}
  </div>;
}
