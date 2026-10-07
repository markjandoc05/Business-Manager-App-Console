'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Minus, Plus, Save, Trash2 } from 'lucide-react';
import { clearSubscriptionPlanMarketing, getSubscriptionPlans, updateSubscriptionPlanMarketing } from '@/lib/console-api';
import { useAuth } from '@/lib/auth-context';
import type { ConsoleSubscriptionPlan, ConsoleSubscriptionPlanMarketing } from '@/lib/types';
import { EmptyState, ErrorState, LoadingState } from './ConsolePrimitives';

function money(plan: ConsoleSubscriptionPlan) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: plan.currency, maximumFractionDigits: 2 }).format(plan.price);
}

function isPlainText(value: string) {
  return !/[<>]|&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/i.test(value);
}

function validateMarketing(badge: string, messages: string[]) {
  const normalizedBadge = badge.trim();
  const normalizedMessages = messages.map((message) => message.trim());
  if (normalizedBadge && (normalizedBadge.length > 160 || !isPlainText(normalizedBadge))) return 'Badge must be plain text and no longer than 160 characters.';
  if (normalizedMessages.length < 1 || normalizedMessages.length > 3 || normalizedMessages.some((message) => !message || message.length > 300 || !isPlainText(message))) {
    return 'Add one to three non-empty plain-text messages, each up to 300 characters.';
  }
  return null;
}

function publicAvailability(plan: ConsoleSubscriptionPlan) {
  return plan.publicSignup && !plan.usage.isFull;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Platform default';
}

function MarketingCard({ plan, onSaved }: { plan: ConsoleSubscriptionPlan; onSaved: () => Promise<void> }) {
  const [badge, setBadge] = useState(plan.marketing?.badge || '');
  const [messages, setMessages] = useState<string[]>(plan.marketing?.messages || ['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const updateMessage = (index: number, value: string) => setMessages((current) => current.map((message, currentIndex) => currentIndex === index ? value : message));
  const removeMessage = (index: number) => setMessages((current) => current.length === 1 ? [''] : current.filter((_, currentIndex) => currentIndex !== index));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const validation = validateMarketing(badge, messages);
    if (validation) { setError(validation); return; }
    const marketing: ConsoleSubscriptionPlanMarketing = {
      ...(badge.trim() ? { badge: badge.trim() } : {}),
      messages: messages.map((message) => message.trim()),
    };
    setBusy(true); setError(null); setSuccess(null);
    try {
      await updateSubscriptionPlanMarketing(plan.planId, marketing, plan.marketingRevision);
      await onSaved();
      setSuccess('Marketing saved. The next public plans request will use this copy when the plan is available.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save plan marketing.');
    } finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setError(null); setSuccess(null);
    try {
      await clearSubscriptionPlanMarketing(plan.planId, plan.marketingRevision);
      await onSaved();
      setSuccess('Marketing cleared. It will be omitted from public plan responses.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to clear plan marketing.');
    } finally { setBusy(false); }
  };

  const previewMessages = messages.map((message) => message.trim()).filter(Boolean);
  const available = publicAvailability(plan);
  return <article className="rounded-xl border border-gray-200 bg-white shadow-sm">
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0"><h2 className="font-black text-gray-950">{plan.displayName}</h2><p className="mt-2 text-xs text-gray-500">{plan.marketing ? `${plan.marketing.messages.length} marketing message${plan.marketing.messages.length === 1 ? '' : 's'} configured` : 'No promotional copy configured'}</p></div>
        <div className="flex items-center gap-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${available ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>{available ? 'Publicly available' : plan.usage.isFull ? 'Offer full' : 'Public signup off'}</span><ChevronDown className="h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-180" aria-hidden="true" /></div>
      </summary>
      <div className="border-t border-gray-100 px-5 pb-5">
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase tracking-wide text-gray-400">Plan</dt><dd className="mt-1 font-semibold">{plan.displayName}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wide text-gray-400">Price</dt><dd className="mt-1 font-semibold">{money(plan)} / {plan.billingInterval}</dd></div></dl>
    <p className="mt-3 text-xs text-gray-500">Availability, price, enrollment limits, entitlements, trials, and licensing remain read-only here.</p>

    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <form onSubmit={(event) => void save(event)} className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div><h3 className="font-black text-gray-950">Display-only marketing</h3><p className="mt-1 text-xs text-gray-500">Plain text only. Badge is optional; add one to three messages.</p></div>
        <label className="block text-sm font-bold text-gray-700">Badge <span className="font-normal text-gray-400">(optional)</span><input value={badge} maxLength={160} onChange={(event) => setBadge(event.target.value)} placeholder="Limited to the first 100 customers" className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
        <div><div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-gray-700">Messages</span><button type="button" onClick={() => setMessages((current) => current.length < 3 ? [...current, ''] : current)} disabled={busy || messages.length >= 3} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 disabled:opacity-40"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add message</button></div><div className="mt-2 space-y-2">{messages.map((message, index) => <div key={index} className="flex gap-2"><textarea aria-label={`Marketing message ${index + 1}`} value={message} maxLength={300} rows={3} onChange={(event) => updateMessage(index, event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><button type="button" onClick={() => removeMessage(index)} disabled={busy} className="self-start rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label={`Remove marketing message ${index + 1}`}><Minus className="h-4 w-4" aria-hidden="true" /></button></div>)}</div></div>
        <p className="text-xs text-gray-500">Last marketing update: {formatDate(plan.marketingUpdatedAt)} · Revision {plan.marketingRevision}</p>
        {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
        {success && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{success}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Save className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Saving…' : 'Save marketing'}</button>{plan.marketing && <button type="button" onClick={() => setConfirmClear(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Clear</button>}</div>
        {confirmClear && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p className="font-bold">Clear promotional copy?</p><p className="mt-1">The public plan remains available if configured, but its `marketing` object will be omitted.</p><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setConfirmClear(false)} disabled={busy} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700">Cancel</button><button type="button" onClick={() => void clear()} disabled={busy} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Confirm clear</button></div></div>}
      </form>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label={`${plan.displayName} client-card preview`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">Client-card preview</p><h3 className="mt-1 text-lg font-black text-slate-950">{plan.displayName}</h3></div><span className="text-sm font-black text-slate-950">{money(plan)} / {plan.billingInterval}</span></div>{badge.trim() && <span className="mt-4 inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-800">{badge.trim()}</span>}<ul className="mt-4 space-y-2 text-sm text-slate-700">{previewMessages.length ? previewMessages.map((message, index) => <li key={`${index}-${message}`} className="rounded-lg bg-white px-3 py-2 shadow-sm">{message}</li>) : <li className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-slate-500">Add valid messages to preview the public marketing copy.</li>}</ul><p className="mt-4 text-xs text-slate-500">Preview only. Client rendering follows the next `GET /api/v1/plans` response and is never controlled by this card.</p></section>
    </div>
      </div>
    </details>
  </article>;
}

export function PlanMarketingModule() {
  const { platformAdmin } = useAuth();
  const [plans, setPlans] = useState<ConsoleSubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isSuperAdmin = platformAdmin?.role === 'SUPER_ADMIN';

  const load = useCallback(async () => {
    setError(null);
    setPlans(await getSubscriptionPlans());
  }, []);

  // Read state is synchronized from the trusted Console API; mutations use a separate SUPER_ADMIN route.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load plan marketing.')).finally(() => setLoading(false)); }, [load]);

  if (!isSuperAdmin) return <EmptyState title="Plan marketing is restricted" message="Only active Platform SUPER_ADMIN accounts can view or edit this Platform-owned promotional configuration." />;
  if (loading) return <LoadingState />;
  if (error && !plans.length) return <ErrorState message={error} />;
  return <section className="space-y-4" aria-labelledby="plan-marketing-heading"><div className="rounded-xl border border-gray-200 bg-white p-5"><h2 id="plan-marketing-heading" className="font-black text-gray-950">Plan Marketing</h2><p className="mt-1 text-sm text-gray-500">Manage display-only promotional copy returned to the Client App. This does not edit commercial terms, availability, product authority, or licenses.</p></div>{error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}{plans.length ? plans.map((plan) => <MarketingCard key={`${plan.planId}-${plan.marketingRevision}`} plan={plan} onSaved={load} />) : <EmptyState title="No plans available" message="Initialize the trusted plan catalog before managing display-only marketing." />}</section>;
}
