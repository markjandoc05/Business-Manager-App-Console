'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Power, Save } from 'lucide-react';
import { bootstrapSubscriptionPlans, getSubscriptionPlans, updateFoundingCustomerLimit, updateSubscriptionPlan } from '@/lib/console-api';
import type { ConsoleSubscriptionPlan } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { ErrorState, LoadingState } from './ConsolePrimitives';

function money(plan: ConsoleSubscriptionPlan) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: plan.currency, maximumFractionDigits: 2 }).format(plan.price);
}

function customerLimit(plan: ConsoleSubscriptionPlan) {
  return plan.planId === 'founding_100' ? plan.foundingLimit : plan.maxEligibleCustomers;
}

function PlanEditor({ plan, onSaved, onCancel }: { plan: ConsoleSubscriptionPlan; onSaved: () => Promise<void>; onCancel: () => void }) {
  const [displayName, setDisplayName] = useState(plan.displayName);
  const [price, setPrice] = useState(String(plan.price));
  const [trialDays, setTrialDays] = useState(String(plan.trialDays));
  const [noCreditCardRequired, setNoCreditCardRequired] = useState(plan.noCreditCardRequired);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateSubscriptionPlan(plan.planId, {
        displayName,
        price: Number(price),
        trialDays: Number(trialDays),
        noCreditCardRequired,
      });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save the subscription plan.');
    } finally {
      setBusy(false);
    }
  };

  return <form onSubmit={(event) => void save(event)} className="mt-4 space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-bold text-gray-600">Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold text-gray-600">Annual price (USD)<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal" /></label>
      <label className="text-xs font-bold text-gray-600">Trial days<input type="number" min="1" max="365" step="1" value={trialDays} onChange={(event) => setTrialDays(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal" /></label>
    </div>
    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700"><input type="checkbox" checked={noCreditCardRequired} onChange={(event) => setNoCreditCardRequired(event.target.checked)} />No credit card required</label>
    {error && <p className="text-xs font-semibold text-rose-700" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600">Cancel</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Saving…' : 'Save plan'}</button></div>
  </form>;
}

function FoundingCapacityEditor({ plan, onSaved, onCancel }: { plan: ConsoleSubscriptionPlan; onSaved: () => Promise<void>; onCancel: () => void }) {
  const [foundingLimit, setFoundingLimit] = useState(String(plan.foundingLimit ?? plan.maxEligibleCustomers ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateFoundingCustomerLimit(Number(foundingLimit));
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update the Founding customer limit.');
    } finally {
      setBusy(false);
    }
  };

  return <form onSubmit={(event) => void save(event)} className="mt-4 space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
    <label className="block text-xs font-bold text-gray-600">Founding customer limit<input aria-label="Founding customer limit" type="number" min="1" max="100000" step="1" value={foundingLimit} onChange={(event) => setFoundingLimit(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal" /></label>
    <p className="text-xs text-gray-600">Applies only to new Founding allocations. Existing licenses, entitlement, price snapshots, and renewal behavior are unchanged. If display-only marketing names a capacity, review that copy separately.</p>
    {error && <p className="text-xs font-semibold text-rose-700" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600">Cancel</button><button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Saving…' : 'Save capacity'}</button></div>
  </form>;
}

export function SubscriptionPlansModule() {
  const { platformAdmin } = useAuth();
  const [plans, setPlans] = useState<ConsoleSubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingConfiguration, setEditingConfiguration] = useState<string | null>(null);
  const [editingCapacity, setEditingCapacity] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const canMutate = platformAdmin?.role === 'SUPER_ADMIN';
  // Clear privileged drafts when the external authorization profile changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!(canMutate)) { setEditingCapacity(null); setEditingConfiguration(null); } }, [canMutate]);

  const load = useCallback(async () => {
    setError(null);
    setPlans(await getSubscriptionPlans());
  }, []);

  // Data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load subscription plans.')).finally(() => setLoading(false)); }, [load]);

  const bootstrap = async () => {
    setBusyPlan('catalog');
    setError(null);
    setMessage(null);
    try {
      const result = await bootstrapSubscriptionPlans();
      await load();
      const created = Array.isArray(result.created) ? result.created.length : 0;
      const backfilled = Array.isArray(result.backfilledFoundingLimitPlanIds) ? result.backfilledFoundingLimitPlanIds.length : 0;
      setMessage(`${created} missing plan definition(s) initialized.${backfilled ? ` ${backfilled} Founding capacity field(s) backfilled.` : ''}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to initialize the plan catalog.');
    } finally {
      setBusyPlan(null);
    }
  };

  const toggle = async (plan: ConsoleSubscriptionPlan) => {
    setBusyPlan(plan.planId);
    setError(null);
    setMessage(null);
    try {
      await updateSubscriptionPlan(plan.planId, { publicSignup: !plan.publicSignup });
      await load();
      setMessage(`${plan.displayName} public signup is now ${!plan.publicSignup ? 'ON' : 'OFF'}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change public signup.');
    } finally {
      setBusyPlan(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error && !plans.length) return <ErrorState message={error} />;
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-labelledby="subscription-plans-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="subscription-plans-heading" className="font-black text-gray-950">Subscription plans</h2><p className="mt-1 text-sm text-gray-500">Platform-owned pricing, trials, signup availability, and Founding customer allocation.</p></div>{canMutate && plans.some((plan) => plan.source === 'default') && <button type="button" onClick={() => void bootstrap()} disabled={busyPlan !== null} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50">Initialize catalog</button>}</div>
    {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
    {error && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
    <div className="grid gap-3 lg:grid-cols-2">{plans.map((plan) => {
      const isFounding = plan.planId === 'founding_100';
      const limit = customerLimit(plan);
      return <article key={plan.planId} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-black text-gray-950">{plan.displayName}</h3>{plan.source === 'default' && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Defaults pending</span>}</div></div><span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${plan.publicSignup && !plan.usage.isFull ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-500'}`}>{plan.publicSignup && !plan.usage.isFull ? 'Public signup ON' : plan.usage.isFull ? 'Capacity reached' : 'Public signup OFF'}</span></div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Price</dt><dd className="mt-1 font-black text-gray-950">{money(plan)} / {plan.billingInterval}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Trial</dt><dd className="mt-1">{plan.trialDays} days · {plan.noCreditCardRequired ? 'No card' : 'Card required'}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Client entitlement</dt><dd className="mt-1 font-semibold">{plan.entitlementTier}</dd></div>{isFounding && <div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Founding customer limit</dt><dd className="mt-1 font-semibold">{limit ?? '—'}</dd></div>}<div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Current usage</dt><dd className="mt-1 font-semibold">{plan.usage.eligibleCustomerCount}{limit === null ? ' / Unlimited' : ` / ${limit ?? '—'}`}</dd></div><div><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">Remaining</dt><dd className="mt-1 font-semibold">{plan.usage.remaining === null ? 'Unlimited' : plan.usage.remaining}</dd></div></dl>
        <p className="mt-3 text-[11px] text-gray-500">Commercial pricing and signup settings do not alter the Client App authorization tier.</p>
        {canMutate && <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-200 pt-3"><button type="button" onClick={() => void toggle(plan)} disabled={busyPlan !== null} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"><Power className="h-3.5 w-3.5" aria-hidden="true" />{plan.publicSignup ? 'Turn signup OFF' : 'Turn signup ON'}</button>{isFounding && <button type="button" onClick={() => { setEditingCapacity(editingCapacity === plan.planId ? null : plan.planId); setEditingConfiguration(null); }} disabled={busyPlan !== null} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit Founding capacity</button>}<button type="button" onClick={() => { setEditingConfiguration(editingConfiguration === plan.planId ? null : plan.planId); setEditingCapacity(null); }} disabled={busyPlan !== null} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit configuration</button></div>}
        {!canMutate && plan.publicSignup && !plan.usage.isFull && <p className="mt-4 flex items-center gap-2 border-t border-gray-200 pt-3 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5" aria-hidden="true" />Available for public signup</p>}
        {canMutate && editingCapacity === plan.planId && <FoundingCapacityEditor plan={plan} onSaved={async () => { setEditingCapacity(null); await load(); setMessage(`${plan.displayName} customer capacity updated.`); }} onCancel={() => setEditingCapacity(null)} />}
        {canMutate && editingConfiguration === plan.planId && <PlanEditor plan={plan} onSaved={async () => { setEditingConfiguration(null); await load(); setMessage(`${plan.displayName} updated.`); }} onCancel={() => setEditingConfiguration(null)} />}
      </article>;
    })}</div>
  </section>;
}
