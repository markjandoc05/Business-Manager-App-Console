'use client';

import React, { useState } from 'react';
import { Organization, LicenseAdminAction, LicenseActionPayload, OrganizationPlan } from '@/lib/types';

export type LicenseAction = LicenseAdminAction;
export type { LicenseActionPayload } from '@/lib/types';

const labels: Record<LicenseAction, string> = { ACTIVATE: 'Activate Organization', REPAIR_LICENSE: 'Repair License', EDIT_LICENSE_DETAILS: 'Edit License Details', EXTEND_TRIAL: 'Extend Trial', CONVERT_TO_PAID: 'Convert to Paid', EXTEND_SUBSCRIPTION: 'Extend Subscription', RENEW: 'Renew Subscription', CHANGE_PLAN: 'Change Plan', CHANGE_SEAT_LIMIT: 'Change User Limit', SUSPEND: 'Suspend Organization', EXPIRE: 'Mark Expired', REACTIVATE: 'Reactivate Organization' };
const paidPlans: OrganizationPlan[] = ['STARTER', 'TEAM', 'LEGACY'];
function dateOnly(value?: string) { return value ? value.slice(0, 10) : ''; }
export function licenseActionLabel(action: LicenseAction) { return labels[action]; }

export function LicenseActionDialog({ action, organization, activeMembers, busy, onClose, onSubmit }: { action: LicenseAction; organization: Organization; activeMembers: number; busy: boolean; onClose: () => void; onSubmit: (payload: LicenseActionPayload) => void }) {
  const [plan, setPlan] = useState<OrganizationPlan>(action === 'CONVERT_TO_PAID' || action === 'RENEW' || action === 'CHANGE_PLAN' || action === 'REPAIR_LICENSE' ? 'TEAM' : organization.license?.plan || 'TRIAL');
  const [maxUsers, setMaxUsers] = useState(String(organization.license?.maxUsers || Math.max(activeMembers, 1)));
  const [startDate, setStartDate] = useState(dateOnly(organization.license?.trialStartedAt || organization.license?.subscriptionStartedAt) || new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(dateOnly(organization.license?.subscriptionEndsAt) || dateOnly(organization.license?.trialEndsAt));
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const title = labels[action];
  const hasSeatInput = ['ACTIVATE', 'REPAIR_LICENSE', 'EDIT_LICENSE_DETAILS', 'CONVERT_TO_PAID', 'RENEW', 'CHANGE_SEAT_LIMIT'].includes(action);
  const hasPlanInput = ['ACTIVATE', 'REPAIR_LICENSE', 'EDIT_LICENSE_DETAILS', 'CONVERT_TO_PAID', 'RENEW', 'CHANGE_PLAN'].includes(action);
  const hasStartInput = ['ACTIVATE', 'REPAIR_LICENSE', 'EDIT_LICENSE_DETAILS', 'CONVERT_TO_PAID', 'RENEW'].includes(action);
  const hasEndInput = ['ACTIVATE', 'REPAIR_LICENSE', 'EDIT_LICENSE_DETAILS', 'CONVERT_TO_PAID', 'RENEW', 'EXTEND_TRIAL', 'EXTEND_SUBSCRIPTION'].includes(action);
  const selectablePlans = action === 'ACTIVATE' || action === 'REPAIR_LICENSE' ? ['TRIAL', ...paidPlans] : action === 'EDIT_LICENSE_DETAILS' ? [organization.license?.plan || plan] : paidPlans;
  const submit = () => {
    setValidation('');
    if (hasEndInput && !endDate) return setValidation('A valid end date is required.');
    if (hasStartInput && !startDate) return setValidation('A valid start date is required.');
    if (hasStartInput && startDate >= endDate) return setValidation('The subscription end date must be after the start date.');
    if (action === 'EXTEND_SUBSCRIPTION' && organization.license?.subscriptionEndsAt && endDate <= dateOnly(organization.license.subscriptionEndsAt)) return setValidation('The new expiration must be later than the current expiration.');
    if (action === 'EXTEND_TRIAL' && organization.license?.trialEndsAt && endDate <= dateOnly(organization.license.trialEndsAt)) return setValidation('The new trial end must be later than the current trial end.');
    if (hasSeatInput && (!Number.isInteger(Number(maxUsers)) || Number(maxUsers) <= 0 || Number(maxUsers) < activeMembers)) return setValidation(`Maximum users must be at least the ${activeMembers} active members.`);
    if (hasPlanInput && !['TRIAL', ...paidPlans].includes(plan)) return setValidation('Select a supported plan.');
    if ((action === 'CONVERT_TO_PAID' || action === 'RENEW' || action === 'CHANGE_PLAN') && !paidPlans.includes(plan)) return setValidation('Select a paid plan.');
    if ((action === 'REPAIR_LICENSE' || action === 'EDIT_LICENSE_DETAILS') && !reason.trim()) return setValidation('An administrative reason is required.');
    onSubmit({ plan, maxUsers: Number(maxUsers), trialStartedAt: plan === 'TRIAL' ? startDate : undefined, subscriptionStartedAt: plan !== 'TRIAL' ? startDate : undefined, subscriptionEndsAt: plan !== 'TRIAL' ? endDate : undefined, trialEndsAt: plan === 'TRIAL' ? endDate : undefined, reason });
  };
  const destructive = action === 'SUSPEND' || action === 'EXPIRE';
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-gray-950">{title}</h2><p className="mt-1 text-sm text-gray-500">You are about to <strong>{title.toLowerCase()}</strong> for <strong>{organization.name}</strong>. The server remains authoritative and will record this action in the audit log.</p>
    {hasPlanInput && <label className="mt-5 block text-sm font-bold">Plan<select value={plan} onChange={(e) => setPlan(e.target.value as OrganizationPlan)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal">{selectablePlans.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
    {hasSeatInput && <label className="mt-4 block text-sm font-bold">Maximum users <span className="font-normal text-gray-500">({activeMembers} active members)</span><input type="number" min={activeMembers} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}
    {hasStartInput && <label className="mt-4 block text-sm font-bold">{plan === 'TRIAL' ? 'Trial start date' : 'Subscription start date'}<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}
    {action === 'EXTEND_SUBSCRIPTION' && <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">Current expiration: <strong>{dateOnly(organization.license?.subscriptionEndsAt) || '—'}</strong></p>}
    {action === 'EXTEND_TRIAL' && <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">Current trial end: <strong>{dateOnly(organization.license?.trialEndsAt) || '—'}</strong></p>}
    {hasEndInput && <label className="mt-4 block text-sm font-bold">{action === 'EXTEND_TRIAL' ? 'New trial end date' : action === 'EXTEND_SUBSCRIPTION' ? 'New expiration date' : plan === 'TRIAL' ? 'Trial end date' : 'Subscription end date'}<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}
    {(action === 'REPAIR_LICENSE' || action === 'EDIT_LICENSE_DETAILS') && <label className="mt-4 block text-sm font-bold">Reason for repair/correction<textarea required value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label>}
    {action === 'SUSPEND' && <><p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Suspending disables tenant writes without deleting business data.</p><label className="mt-4 block text-sm font-bold">Reason (optional)<textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" /></label></>}
    {(action === 'EXPIRE' || action === 'REACTIVATE') && <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{action === 'EXPIRE' ? 'This marks the canonical license expired and disables tenant writes.' : 'The server restores only a currently valid trial or subscription.'}</p>}
    {validation && <p className="mt-4 text-sm font-semibold text-rose-600">{validation}</p>}<div className="mt-6 flex justify-end gap-3"><button onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button><button onClick={submit} disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${destructive ? 'bg-rose-700' : 'bg-blue-600'}`}>{busy ? `${title}…` : title}</button></div></div></div>;
}
