'use client';

import React from 'react';
import { AlertTriangle, CalendarClock, ShieldCheck, X } from 'lucide-react';
import type { LicenseAdminAction, SubscriptionLicenseDetail } from '@/lib/types';
import { licenseActionLabel } from './LicenseActionDialog';
import { CompactBadge, EmptyState, formatDate } from './ConsolePrimitives';

function money(value: number | null, currency?: string) {
  if (value === null || value === undefined || !currency) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function statusTone(status: string) {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'TRIAL') return 'info' as const;
  if (status === 'EXPIRED' || status === 'SUSPENDED') return 'danger' as const;
  return 'warning' as const;
}

function auditTone(action: string) {
  if (action.includes('SUSPEND') || action.includes('EXPIRED')) return 'danger' as const;
  if (action.includes('ACTIVATED') || action.includes('REACTIVATED') || action.includes('RENEWED')) return 'success' as const;
  return 'info' as const;
}

function auditLabel(action: string) {
  return action.replace(/^ORGANIZATION_/, '').replace(/^SUBSCRIPTION_/, '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-gray-800">{value || '—'}</dd></div>;
}

function productLabel(detail: SubscriptionLicenseDetail) {
  return detail.plan?.displayName || detail.license.planName || 'No linked commercial product';
}

export function SubscriptionLicenseDetailsDialog({ detail, canMutate, onClose, onAction }: {
  detail: SubscriptionLicenseDetail;
  canMutate: boolean;
  onClose: () => void;
  onAction: (action: LicenseAdminAction) => void;
}) {
  const { license, plan, auditHistory } = detail;
  const commercialProduct = productLabel(detail);
  return <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={`Subscription license details for ${license.organizationName}`}>
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5 sm:p-6">
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Subscription license</p><h2 className="mt-1 truncate text-xl font-black text-gray-950">{license.organizationName}</h2><p className="mt-1 text-xs text-gray-500">Platform subscription record</p></div>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Close subscription license details"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      <div className="overflow-y-auto p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-2"><CompactBadge label={license.documentState === 'VALID_LICENSE' ? license.status : license.documentState.replace('_', ' ')} tone={statusTone(license.status)} />{license.planName && <CompactBadge label={license.planName} tone="neutral" />}</div>
        <p className="mb-5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />This view contains only platform subscription, license, seat, and audit information.</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 p-4" aria-labelledby="canonical-license-heading">
            <h3 id="canonical-license-heading" className="font-black text-gray-950">Canonical license</h3>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailField label="Effective status" value={license.status} />
              <DetailField label="Canonical status" value={license.canonicalStatus || '—'} />
              <DetailField label="Canonical plan" value={license.canonicalPlan || '—'} />
              <DetailField label="Granted paid tier" value={license.entitlementTier || '—'} />
              <DetailField label="Commercial product" value={commercialProduct} />
              <DetailField label="Trial end" value={formatDate(license.trialEndsAt)} />
              <DetailField label="Subscription start" value={formatDate(license.subscriptionStartedAt)} />
              <DetailField label="Renewal date" value={formatDate(license.renewalDate || license.subscriptionEndsAt)} />
              <DetailField label="Seat usage" value={license.maxUsers === null ? `${license.activeSeatCount} / —` : `${license.activeSeatCount} / ${license.maxUsers}`} />
              <DetailField label="Price snapshot" value={money(license.priceAtSubscription, license.currency)} />
              <DetailField label="Billing interval" value={license.billingInterval || '—'} />
            </dl>
          </section>
          <section className="rounded-xl border border-gray-200 p-4" aria-labelledby="plan-information-heading">
            <h3 id="plan-information-heading" className="font-black text-gray-950">Plan information</h3>
            {plan ? (
              <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DetailField label="Plan" value={plan.displayName} />
                <DetailField label="Granted Client tier" value={plan.entitlementTier} />
                <DetailField label="Current catalog price" value={money(plan.price, plan.currency)} />
                <DetailField label="Current trial" value={`${plan.trialDays} days`} />
                <DetailField label="Billing interval" value={plan.billingInterval} />
                <DetailField label="Public signup" value={plan.publicSignup ? 'ON' : 'OFF'} />
                <DetailField label="Enrollment limit" value={plan.planId === 'founding_100' ? plan.foundingLimit : plan.maxEligibleCustomers === null ? 'Unlimited' : plan.maxEligibleCustomers} />
                <DetailField label="Card requirement" value={plan.noCreditCardRequired ? 'No card required' : 'Card required'} />
              </dl>
            ) : <p className="mt-4 text-sm text-gray-500">No platform plan record is linked to this legacy license.</p>}
          </section>
        </div>
        {canMutate && license.allowedActions.length > 0 && <section className="mt-5 rounded-xl border border-blue-200 bg-blue-50/50 p-4" aria-labelledby="license-actions-heading"><h3 id="license-actions-heading" className="font-black text-gray-950">Authorized license actions</h3><p className="mt-1 text-xs text-gray-600">Each action uses the existing server-authorized license workflow and creates its normal audit record.</p><div className="mt-3 flex flex-wrap gap-2">{license.allowedActions.map((action) => <button key={action} type="button" onClick={() => onAction(action)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{licenseActionLabel(action)}</button>)}</div></section>}
        <section className="mt-5 rounded-xl border border-gray-200 p-4" aria-labelledby="subscription-audit-heading">
          <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-gray-500" aria-hidden="true" /><h3 id="subscription-audit-heading" className="font-black text-gray-950">Relevant subscription audit history</h3></div>
          {auditHistory.length === 0 ? <div className="mt-4"><EmptyState title="No subscription audit records" message="Subscription-related platform actions will appear here." /></div> : (
            <div className="mt-4 space-y-2">
              {auditHistory.map((event) => (
                <article key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="min-w-0"><CompactBadge label={auditLabel(event.action)} tone={auditTone(event.action)} /><p className="mt-1 truncate text-xs text-gray-600">{event.actorRole || 'System'}</p></div>
                  <div className="text-right text-xs text-gray-500"><p>{formatDate(event.createdAt)}</p></div>
                </article>
              ))}
            </div>
          )}
        </section>
        {!license.planId && <p className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />This is a legacy canonical license without a platform plan link. Existing authorized repair workflows remain available when applicable.</p>}
      </div>
    </div>
  </div>;
}
