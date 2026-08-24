'use client';

import React, { useState } from 'react';
import { Organization } from '@/lib/types';

export type LicenseAction = 'ACTIVATE' | 'EXTEND_TRIAL' | 'CHANGE_PLAN' | 'CHANGE_SEAT_LIMIT' | 'SUSPEND' | 'REACTIVATE' | 'CANCEL';
export type LicenseActionPayload = { planId?: string; seatLimit?: number; date?: string; reason?: string };

export function LicenseActionDialog({ action, organization, activeMembers, busy, onClose, onSubmit }: { action: LicenseAction; organization: Organization; activeMembers: number; busy: boolean; onClose: () => void; onSubmit: (payload: LicenseActionPayload) => void }) {
  const [planId, setPlanId] = useState<'FREE_TRIAL' | 'SOLO' | 'TEAM'>(organization.license?.planId || 'SOLO');
  const [seatLimit, setSeatLimit] = useState(String(organization.license?.seatLimit || Math.max(activeMembers, 1)));
  const [date, setDate] = useState(organization.license?.expiresAt?.slice(0, 10) || organization.license?.trialEndsAt?.slice(0, 10) || '');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const title = action.replace('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  const submit = () => {
    if ((action === 'ACTIVATE' || action === 'EXTEND_TRIAL') && !date) return setValidation('A valid date is required.');
    if ((action === 'ACTIVATE' || action === 'CHANGE_PLAN' || action === 'CHANGE_SEAT_LIMIT') && (!Number.isInteger(Number(seatLimit)) || Number(seatLimit) <= 0 || Number(seatLimit) < activeMembers)) return setValidation(`Seat limit must be at least the ${activeMembers} active members.`);
    if (action === 'CHANGE_PLAN' && !['FREE_TRIAL', 'SOLO', 'TEAM'].includes(planId)) return setValidation('Select a supported plan.');
    onSubmit({ planId, seatLimit: Number(seatLimit), date, reason });
  };
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-gray-950">{title}</h2><p className="mt-1 text-sm text-gray-500">The server remains authoritative and will record this action in the audit log.</p>{(action === 'ACTIVATE' || action === 'CHANGE_PLAN') && <label className="mt-5 block text-sm font-bold">Plan<select value={planId} onChange={(e) => setPlanId(e.target.value as typeof planId)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"><option value="FREE_TRIAL">FREE_TRIAL</option><option value="SOLO">SOLO</option><option value="TEAM">TEAM</option></select></label>}{(action === 'ACTIVATE' || action === 'CHANGE_SEAT_LIMIT') && <label className="mt-4 block text-sm font-bold">Seat limit <span className="font-normal text-gray-500">({activeMembers} active members)</span><input type="number" min={activeMembers} value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}{(action === 'ACTIVATE' || action === 'EXTEND_TRIAL') && <label className="mt-4 block text-sm font-bold">{action === 'ACTIVATE' ? 'Expiration date' : 'New trial end date'}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}{action === 'SUSPEND' && <><p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Suspending restricts workspace access but does not delete business data.</p><label className="mt-4 block text-sm font-bold">Reason (optional)<textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label></>}{(action === 'REACTIVATE' || action === 'CANCEL') && <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{action === 'REACTIVATE' ? 'The server will restore only a currently valid trial, subscription, or grace-period state.' : 'Cancellation does not delete organization or business data.'}</p>}{validation && <p className="mt-4 text-sm font-semibold text-rose-600">{validation}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button><button onClick={submit} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : `Confirm ${title}`}</button></div></div></div>;
}
