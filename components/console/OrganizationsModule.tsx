'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheck, Power, RefreshCw, Search, Settings2, Wrench } from 'lucide-react';
import { getOrganizations } from '@/lib/console-api';
import type { LicenseAdminAction, Organization, OrganizationPlan } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { CompactActionGroup, CompactBadge, CompactIconButton, EmptyState, ErrorState, formatDate, LoadingState, TruncatedText } from './ConsolePrimitives';
import { licenseActionLabel } from './LicenseActionDialog';

type OrganizationFilter = 'ALL' | 'ACTION_REQUIRED' | 'NO_LICENSE' | 'INVALID_LICENSE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'HEALTHY';
const planLabels: Record<string, string> = { TRIAL: 'Trial', SOLO: 'Solo', STARTER: 'Starter', TEAM: 'Team', LEGACY: 'Legacy' };

function reasonLabel(reason?: string) {
  return ({ NO_LICENSE: 'No License', INVALID_LICENSE: 'Invalid License', LICENSE_EXPIRED: 'Renewal Required', LICENSE_EXPIRING_SOON: 'License Expiring Soon', TRIAL_EXPIRING_SOON: 'Trial Expiring Soon', LICENSE_SUSPENDED: 'License Suspended', SEAT_LIMIT_EXCEEDED: 'Seat Limit Exceeded', MISSING_REQUIRED_ORGANIZATION_DATA: 'Missing Required Data', MISSING_TIMEZONE: 'Timezone Not Set', MISSING_CURRENCY: 'Currency Not Set' } as Record<string, string>)[reason || ''] || '—';
}

function statusLabel(organization: Organization) {
  const state = organization.licenseAdminState;
  if (organization.licenseDocumentState === 'NO_LICENSE') return 'No License';
  if (organization.licenseDocumentState === 'INVALID_LICENSE') return 'Needs Attention';
  if (state?.status === 'ACTIVE') return 'Active';
  if (state?.status === 'TRIAL') return 'Trial';
  if (state?.status === 'EXPIRED') return 'Expired';
  if (state?.status === 'SUSPENDED') return 'Suspended';
  return 'Needs Attention';
}

function primaryAction(organization: Organization): LicenseAdminAction | 'MANAGE' {
  const state = organization.licenseAdminState;
  const allowed = state?.allowedActions || [];
  const reasons = organization.organizationAdminState?.attentionReasons || [];
  if (reasons.includes('INVALID_LICENSE') && allowed.includes('REPAIR_LICENSE')) return 'REPAIR_LICENSE';
  if (reasons.includes('NO_LICENSE') && allowed.includes('ACTIVATE')) return 'ACTIVATE';
  if (reasons.includes('LICENSE_EXPIRED') && allowed.includes('RENEW')) return 'RENEW';
  if (reasons.includes('LICENSE_SUSPENDED') && allowed.includes('REACTIVATE')) return 'REACTIVATE';
  if (reasons.includes('TRIAL_EXPIRING_SOON') && allowed.includes('EXTEND_TRIAL')) return 'EXTEND_TRIAL';
  if (reasons.includes('LICENSE_EXPIRING_SOON') && allowed.includes('EXTEND_SUBSCRIPTION')) return 'EXTEND_SUBSCRIPTION';
  return 'MANAGE';
}

function actionLabel(action: LicenseAdminAction | 'MANAGE') { return action === 'MANAGE' ? 'Manage' : licenseActionLabel(action); }
function actionIcon(action: LicenseAdminAction | 'MANAGE') {
  if (action === 'REPAIR_LICENSE') return <Wrench className="h-4 w-4" aria-hidden="true" />;
  if (action === 'ACTIVATE') return <Power className="h-4 w-4" aria-hidden="true" />;
  if (action === 'RENEW' || action === 'EXTEND_TRIAL' || action === 'EXTEND_SUBSCRIPTION') return <RefreshCw className="h-4 w-4" aria-hidden="true" />;
  if (action === 'REACTIVATE') return <CircleCheck className="h-4 w-4" aria-hidden="true" />;
  return <Settings2 className="h-4 w-4" aria-hidden="true" />;
}
function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' { if (status === 'Active') return 'success'; if (status === 'Expired' || status === 'Suspended') return 'danger'; if (status === 'Trial') return 'info'; return 'warning'; }

export function OrganizationsModule() {
  const router = useRouter();
  const { platformAdmin } = useAuth();
  const [items, setItems] = useState<Organization[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OrganizationFilter>('ALL');
  const [plan, setPlan] = useState<'ALL' | OrganizationPlan>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getOrganizations().then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load organizations.')).finally(() => setLoading(false)); }, []);
  // URL query parameters are an external navigation input for the existing organization filters.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const health = new URLSearchParams(window.location.search).get('health'); if (health === 'ACTION_REQUIRED') setFilter('ACTION_REQUIRED'); }, []);
  const filtered = useMemo(() => items.filter((org) => { const q = query.trim().toLowerCase(); const reasons = org.organizationAdminState?.attentionReasons || []; const matchesSearch = !q || [org.name, org.slug, org.ownerEmail].some((field) => field?.toLowerCase().includes(q)); const matchesFilter = filter === 'ALL' || (filter === 'ACTION_REQUIRED' && org.organizationAdminState?.health === 'ACTION_REQUIRED') || (filter === 'HEALTHY' && org.organizationAdminState?.health === 'HEALTHY') || (filter === 'NO_LICENSE' && reasons.includes('NO_LICENSE')) || (filter === 'INVALID_LICENSE' && reasons.includes('INVALID_LICENSE')) || (filter === 'EXPIRING_SOON' && (reasons.includes('LICENSE_EXPIRING_SOON') || reasons.includes('TRIAL_EXPIRING_SOON'))) || (filter === 'EXPIRED' && reasons.includes('LICENSE_EXPIRED')) || (filter === 'SUSPENDED' && reasons.includes('LICENSE_SUSPENDED')); return matchesSearch && matchesFilter && (plan === 'ALL' || org.licenseAdminState?.plan === plan); }), [filter, items, plan, query]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const canMutate = platformAdmin?.role === 'SUPER_ADMIN';
  const view = (org: Organization) => router.push(`/organizations/${org.id}`);
  const renderAction = (org: Organization) => { const action = canMutate ? primaryAction(org) : 'MANAGE'; const label = `${action === 'REPAIR_LICENSE' ? 'Resolve license' : actionLabel(action)} for ${org.name}`; return <CompactIconButton label={label} onClick={() => view(org)} className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">{actionIcon(action)}</CompactIconButton>; };
  const countFor = (target: OrganizationFilter) => items.filter((org) => target === 'ALL' ? true : target === 'ACTION_REQUIRED' ? org.organizationAdminState?.health === 'ACTION_REQUIRED' : target === 'HEALTHY' ? org.organizationAdminState?.health === 'HEALTHY' : (org.organizationAdminState?.attentionReasons || []).some((reason) => target === 'EXPIRING_SOON' ? ['LICENSE_EXPIRING_SOON', 'TRIAL_EXPIRING_SOON'].includes(reason) : target === 'EXPIRED' ? reason === 'LICENSE_EXPIRED' : target === 'SUSPENDED' ? reason === 'LICENSE_SUSPENDED' : reason === target)).length;
  const summary = (['ALL', 'ACTION_REQUIRED', 'NO_LICENSE', 'INVALID_LICENSE', 'EXPIRING_SOON', 'EXPIRED', 'SUSPENDED', 'HEALTHY'] as OrganizationFilter[]).map((value) => ({ value, label: value === 'ALL' ? 'All' : value === 'ACTION_REQUIRED' ? 'Action Required' : value === 'EXPIRING_SOON' ? 'Expiring Soon' : value.replaceAll('_', ' '), count: countFor(value) }));
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">{summary.map((item) => <button type="button" key={item.value} onClick={() => setFilter(item.value)} className="rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">{item.label}</span><span className="mt-1 block text-xl font-black">{item.count}</span></button>)}</div><div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 lg:flex-row"><label className="relative min-w-0 flex-1"><span className="sr-only">Search organizations</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, slug, or owner email" className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><select aria-label="Organization attention filter" value={filter} onChange={(event) => setFilter(event.target.value as OrganizationFilter)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All organizations</option><option value="ACTION_REQUIRED">Action Required</option><option value="NO_LICENSE">No License</option><option value="INVALID_LICENSE">Invalid License</option><option value="EXPIRING_SOON">Expiring Soon</option><option value="EXPIRED">Expired</option><option value="SUSPENDED">Suspended</option><option value="HEALTHY">Healthy</option></select><select aria-label="Organization plan filter" value={plan} onChange={(event) => setPlan(event.target.value as 'ALL' | OrganizationPlan)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"><option value="ALL">All plans</option>{Object.entries(planLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{!filtered.length ? <EmptyState title="No organizations found" message="Try clearing one or more filters." /> : <><div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block"><table className="w-full min-w-[980px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[28%] px-3 py-2">Organization</th><th className="w-[11%] px-3 py-2">Members</th><th className="w-[11%] px-3 py-2">License</th><th className="w-[13%] px-3 py-2">Status</th><th className="w-[17%] px-3 py-2">Action Needed</th><th className="w-[11%] px-3 py-2">Updated</th><th className="w-[9%] px-3 py-2">Action</th></tr></thead><tbody className="divide-y divide-gray-100">{filtered.map((org) => { const state = org.licenseAdminState; const reasons = org.organizationAdminState?.attentionReasons || []; return <tr key={org.id} className="h-14 hover:bg-gray-50"><td className="px-3 py-2"><Link href={`/organizations/${org.id}`} title={org.name} className="block max-w-full truncate font-bold text-gray-900 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">{org.name}</Link><TruncatedText value={org.slug || org.ownerEmail} className="text-xs text-gray-500" /></td><td className="px-3 py-2">{org.activeMemberCount ?? 0} member{org.activeMemberCount === 1 ? '' : 's'}</td><td className="px-3 py-2"><TruncatedText value={state?.plan ? planLabels[state.plan] : undefined} /></td><td className="px-3 py-2"><CompactBadge label={statusLabel(org)} tone={statusTone(statusLabel(org))} /></td><td className="px-3 py-2"><TruncatedText value={reasonLabel(reasons[0])} className="text-amber-700" /></td><td className="px-3 py-2 text-gray-500">{formatDate(org.updatedAt)}</td><td className="px-3 py-2"><CompactActionGroup>{renderAction(org)}</CompactActionGroup></td></tr>; })}</tbody></table></div><div className="space-y-3 md:hidden">{filtered.map((org) => { const state = org.licenseAdminState; const reasons = org.organizationAdminState?.attentionReasons || []; return <article key={org.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/organizations/${org.id}`} title={org.name} className="block max-w-full truncate text-left font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">{org.name}</Link><TruncatedText value={org.ownerEmail || org.slug} className="mt-1 text-xs text-gray-500" /></div><CompactBadge label={statusLabel(org)} tone={statusTone(statusLabel(org))} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-gray-400">Members</dt><dd>{org.activeMemberCount ?? 0}</dd></div><div><dt className="text-xs text-gray-400">License</dt><dd>{state?.plan ? planLabels[state.plan] : '—'}</dd></div><div><dt className="text-xs text-gray-400">Action Needed</dt><dd className="truncate text-amber-700" title={reasonLabel(reasons[0])}>{reasonLabel(reasons[0])}</dd></div><div><dt className="text-xs text-gray-400">Updated</dt><dd>{formatDate(org.updatedAt)}</dd></div></dl><div className="mt-4"><CompactActionGroup>{renderAction(org)}</CompactActionGroup></div></article>; })}</div></>}</div>;
}
