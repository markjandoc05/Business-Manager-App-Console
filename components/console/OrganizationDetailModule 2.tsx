'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { getOrganization, resetOrganizationRegistration, type OrganizationRegistrationResetMode } from '@/lib/console-api';
import type { OrganizationOperationsDetail, OrganizationRegistryEntry } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { ConsolePage } from '../ConsoleShell';
import { CompactBadge, EmptyState, ErrorState, formatDate, LoadingState } from './ConsolePrimitives';
import { OrganizationUsageSection } from './OrganizationUsageSection';
import { OrganizationRegistrationResetDialog } from './OrganizationRegistrationResetDialog';

function visibleLicenseStatus(record: OrganizationRegistryEntry) {
  if (record.licenseDocumentState === 'NO_LICENSE') return 'NO_LICENSE';
  if (record.licenseDocumentState === 'INVALID_LICENSE') return 'NEEDS_ATTENTION';
  return record.licenseStatus;
}

function statusTone(status: ReturnType<typeof visibleLicenseStatus>) {
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

function money(value: number | null, currency?: string) {
  if (value === null || value === undefined || !currency) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value}`; }
}

function auditLabel(action: string) {
  return action.replace(/^ORGANIZATION_/, '').replace(/^SUBSCRIPTION_/, '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function auditTone(action: string) {
  if (action.includes('SUSPENDED') || action.includes('EXPIRED')) return 'danger' as const;
  if (action.includes('ACTIVATED') || action.includes('RENEWED') || action.includes('REACTIVATED')) return 'success' as const;
  return 'info' as const;
}

function DetailField({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className={`mt-1 break-words text-sm text-gray-800 ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</dd></div>;
}

export function OrganizationDetailModule({ orgId }: { orgId: string }) {
  const { platformAdmin } = useAuth();
  const router = useRouter();
  const [detail, setDetail] = useState<OrganizationOperationsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setDetail(await getOrganization(orgId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the organization detail.'); }
    finally { setLoading(false); }
  }, [orgId]);

  // This is a read-only platform projection synchronized from the API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const resetRegistration = useCallback(async ({ mode, confirmation }: { mode: OrganizationRegistrationResetMode; confirmation: string }) => {
    setResetBusy(true);
    setResetError(null);
    try {
      await resetOrganizationRegistration(orgId, { mode, confirmation });
      router.replace('/organizations');
    } catch (reason) {
      setResetError(reason instanceof Error ? reason.message : 'The organization registration could not be reset.');
    } finally { setResetBusy(false); }
  }, [orgId, router]);

  const record = detail?.organization;
  const metadata = record?.platformMetadata;
  const licenseStatus = useMemo(() => record ? visibleLicenseStatus(record) : 'UNKNOWN', [record]);

  if (loading && !detail) return <LoadingState />;
  if (error && !detail) return <div className="p-6 lg:p-10"><ErrorState message={error} /></div>;
  if (!detail || !record) return <div className="p-6 lg:p-10"><EmptyState title="Organization unavailable" message="The platform API did not return this organization." /></div>;

  return <ConsolePage title={record.organizationName} description="Platform-safe organization and subscription detail" action={<div className="flex flex-wrap gap-4"><button type="button" onClick={() => void load()} aria-label="Refresh organization" disabled={loading} className="flex items-center gap-2 text-sm font-bold text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh</button><Link href="/organizations" className="flex items-center gap-2 text-sm font-bold text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Link></div>}>
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{error}</div>}
      {platformAdmin?.role === 'SUPPORT' && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">SUPPORT access is read-only. Authorized subscription actions are available only to SUPER_ADMIN in Licensing.</p>}
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">This detail is restricted to organization registration, licensing, and operational usage estimates. It never loads customer CRM record contents.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-black text-gray-950">Organization metadata</h2><CompactBadge label={record.platformStatus.replaceAll('_', ' ')} tone={platformTone(record.platformStatus)} /></div><dl className="mt-5 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"><DetailField label="Business / workspace" value={record.organizationName} /><DetailField label="Organization ID" value={record.organizationId} mono /><DetailField label="Created" value={formatDate(record.createdAt)} /><DetailField label="Workspace slug" value={metadata?.workspaceSlug || 'Not reported'} mono /><DetailField label="Platform status" value={record.platformStatus.replaceAll('_', ' ')} /></dl><div className="mt-6 border-t border-gray-100 pt-4"><Link href={`/users?organizationId=${encodeURIComponent(record.organizationId)}`} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500">Manage organization members <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link></div></section>
        <section id="subscription-card" className="rounded-xl border border-gray-200 bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-gray-950">License &amp; subscription</h2><p className="mt-1 text-sm text-gray-500">Canonical license data and subscription price snapshot.</p></div><CompactBadge label={licenseStatus.replaceAll('_', ' ')} tone={statusTone(licenseStatus)} /></div><dl className="mt-5 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"><DetailField label="Current plan" value={planLabel(record)} /><DetailField label="Canonical license status" value={record.canonicalLicenseStatus || '—'} /><DetailField label="License document" value={record.licenseDocumentState.replaceAll('_', ' ')} /><DetailField label="Seats used / limit" value={`${record.activeSeatCount} / ${record.maxUsers ?? '—'}`} /><DetailField label="Trial end" value={formatDate(record.trialEndsAt)} /><DetailField label="Subscription start" value={formatDate(record.subscriptionStartedAt)} /><DetailField label="Renewal date" value={formatDate(record.renewalDate || record.subscriptionEndsAt)} /><DetailField label="Price snapshot" value={money(record.priceAtSubscription, record.currency)} /><DetailField label="Currency" value={record.currency || '—'} /><DetailField label="Billing interval" value={record.billingInterval || '—'} /></dl><div className="mt-6"><Link href="/licensing" className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500">Open Licensing <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link></div></section>
      </div>

      <OrganizationUsageSection orgId={orgId} isSuperAdmin={platformAdmin?.role === 'SUPER_ADMIN'} />

      {platformAdmin?.role === 'SUPER_ADMIN' && <section className="rounded-xl border border-rose-200 bg-rose-50 p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-black text-rose-950">Test registration reset</h2><p className="mt-1 max-w-2xl text-sm text-rose-900">Permanently remove this organization’s scoped Firestore records and signup links so it can be tested as a new registration. Full reset can also free member emails only when server-side safety checks prove those accounts have no other platform access.</p></div><button type="button" onClick={() => { setResetError(null); setResetOpen(true); }} disabled={resetBusy} className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50">Reset registration</button></div></section>}

      <section className="rounded-xl border border-gray-200 bg-white p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-gray-950">Relevant platform audit history</h2><p className="mt-1 text-sm text-gray-500">Allowlisted organization and license events only; raw audit values and identities are redacted.</p></div><span className="text-xs font-semibold text-gray-500">{detail.auditHistory.length} event{detail.auditHistory.length === 1 ? '' : 's'}</span></div>{detail.auditHistory.length ? <div className="mt-5 hidden overflow-x-auto rounded-lg border border-gray-100 md:block"><table className="w-full min-w-[620px] table-fixed text-left text-sm"><thead className="border-b border-gray-100 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[54%] px-3 py-2">Action</th><th className="w-[20%] px-3 py-2">Actor role</th><th className="w-[26%] px-3 py-2">Recorded</th></tr></thead><tbody className="divide-y divide-gray-100">{detail.auditHistory.map((item) => <tr key={item.id} className="h-12"><td className="px-3 py-2"><CompactBadge label={auditLabel(item.action)} tone={auditTone(item.action)} /></td><td className="px-3 py-2 text-gray-700">{item.actorRole || 'Platform service'}</td><td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{formatDate(item.createdAt)}</td></tr>)}</tbody></table></div> : <div className="mt-5"><EmptyState title="No relevant platform audit events" message="Future organization and subscription operations will appear here when they are recorded." /></div>} {detail.auditHistory.length > 0 && <div className="mt-4 space-y-3 md:hidden">{detail.auditHistory.map((item) => <article key={item.id} className="min-w-0 rounded-lg border border-gray-100 p-3"><CompactBadge label={auditLabel(item.action)} tone={auditTone(item.action)} /><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><DetailField label="Actor role" value={item.actorRole || 'Platform service'} /><DetailField label="Recorded" value={formatDate(item.createdAt)} /></dl></article>)}</div>}</section>
      {resetOpen && <OrganizationRegistrationResetDialog organizationId={record.organizationId} busy={resetBusy} error={resetError} onClose={() => { if (!resetBusy) { setResetOpen(false); setResetError(null); } }} onConfirm={(payload) => void resetRegistration(payload)} />}
    </div>
  </ConsolePage>;
}
