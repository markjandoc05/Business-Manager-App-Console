'use client';

import React, { useState } from 'react';
import type { ExistingOrganizationUser } from '@/lib/console-api';
import type { Organization, OrganizationMember, OrganizationMemberRole } from '@/lib/types';
import { formatDateInTimeZone } from './ConsolePrimitives';

const memberStatuses = ['active', 'pending', 'inactive', 'suspended', 'archived', 'disabled'] as const;
const timezoneOptions = ['Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney', 'UTC'];
const currencyOptions = ['PHP', 'USD', 'EUR', 'GBP', 'SGD', 'AUD', 'JPY', 'CAD', 'CNY', 'HKD', 'KRW', 'INR', 'NZD', 'CHF', 'THB', 'MYR', 'IDR'];

function loginDate(value?: string, timezone?: string) {
  return value ? formatDateInTimeZone(value, timezone) : 'Never';
}

function loginStatusLabel(status?: OrganizationMember['lastLoginStatus']) {
  return status === 'SUCCESS' ? 'Successful' : status === 'FAILED' ? 'Failed' : 'No login yet';
}

function loginFailureReason(code?: string) {
  if (code === 'MEMBERSHIP_INACTIVE') return 'Membership is inactive';
  if (code === 'LICENSE_BLOCKED') return 'License blocked workspace access';
  if (code === 'BOOTSTRAP_FAILED') return 'Workspace bootstrap failed';
  if (code === 'ORGANIZATION_ACCESS_FAILED') return 'Organization access failed';
  if (code === 'AUTHORIZATION_FAILED') return 'Authorization failed';
  if (code === 'WORKSPACE_ACCESS_FAILED') return 'Workspace access failed';
  return 'Workspace access failed';
}

function DialogShell({ title, children, busy, onClose, onSubmit, submitLabel, busyLabel = 'Saving…' }: {
  title: string;
  children: React.ReactNode;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  busyLabel?: string;
}) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(); }} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <h2 className="text-xl font-black text-gray-950">{title}</h2>
      {children}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Cancel</button>
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">{busy ? busyLabel : submitLabel}</button>
      </div>
    </form>
  </div>;
}

export function OrganizationProfileDialog({ organization, busy, onClose, onSubmit }: {
  organization: Organization;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; businessType: string; currency: string; timezone: string; reason?: string }) => void;
}) {
  const [name, setName] = useState(organization.name);
  const [businessType, setBusinessType] = useState(organization.businessType || '');
  const [currency, setCurrency] = useState(organization.currency || '');
  const [timezone, setTimezone] = useState(organization.timezone || '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const timezones = organization.timezone && !timezoneOptions.includes(organization.timezone) ? [organization.timezone, ...timezoneOptions] : timezoneOptions;
  const currencies = organization.currency && !currencyOptions.includes(organization.currency) ? [organization.currency, ...currencyOptions] : currencyOptions;
  const submit = () => {
    if (!name.trim()) return setError('Business name is required.');
    setError('');
    onSubmit({ name: name.trim(), businessType: businessType.trim(), currency: currency.trim(), timezone: timezone.trim(), reason: reason.trim() || undefined });
  };
  return <DialogShell title="Edit Organization" busy={busy} onClose={onClose} onSubmit={submit} submitLabel="Save changes">
    <p className="mt-1 text-sm text-gray-500">Only supported organization metadata can be changed. The platform record and workspace reference remain immutable.</p>
    <label className="mt-5 block text-sm font-bold">Business name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
    <label className="mt-4 block text-sm font-bold">Business type<input value={businessType} onChange={(event) => setBusinessType(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
    <label className="mt-4 block text-sm font-bold">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"><option value="">Not Set</option>{currencies.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <label className="mt-4 block text-sm font-bold">Timezone<select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"><option value="">Not Set</option>{timezones.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <label className="mt-4 block text-sm font-bold">Administrative reason <span className="font-normal text-gray-500">(optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
    {error && <p className="mt-3 text-sm font-semibold text-rose-600" role="alert">{error}</p>}
  </DialogShell>;
}

export function AddMemberDialog({ busy, onClose, onLookup, onSubmit }: {
  busy: boolean;
  onClose: () => void;
  onLookup: (email: string) => Promise<ExistingOrganizationUser>;
  onSubmit: (payload: { email: string; role: OrganizationMemberRole; reason?: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationMemberRole>('USER');
  const [reason, setReason] = useState('');
  const [account, setAccount] = useState<ExistingOrganizationUser | null>(null);
  const [error, setError] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const findAccount = async () => {
    setError('');
    setAccount(null);
    setLookupBusy(true);
    try { setAccount(await onLookup(email.trim())); }
    catch (lookupError) { setError(lookupError instanceof Error ? lookupError.message : 'Unable to find this Ventale account.'); }
    finally { setLookupBusy(false); }
  };
  return <DialogShell title="Add Member" busy={busy} busyLabel="Adding…" onClose={onClose} onSubmit={() => account ? onSubmit({ email: account.email, role, reason: reason.trim() || undefined }) : setError('Check the email before adding a member.')} submitLabel="Add Member">
    <p className="mt-1 text-sm text-gray-500">Existing users are linked by Firebase UID. If the user has not signed in yet, this creates a pending email assignment that can only be claimed by that verified Firebase identity.</p>
    <label className="mt-5 block text-sm font-bold">Email<input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setAccount(null); }} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
    <button type="button" onClick={() => void findAccount()} disabled={busy || lookupBusy || !email.trim()} className="mt-3 rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">{lookupBusy ? 'Checking…' : 'Check email'}</button>
    {account && <div className={`mt-4 rounded-lg border p-3 text-sm ${account.pendingInvitation ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><p className="font-bold">{account.pendingInvitation ? 'Pending assignment will be created' : account.name || 'Existing user'}</p><p>{account.email}</p>{account.pendingInvitation && <p className="mt-1 text-xs">The user must sign in with this verified email to claim access.</p>}</div>}
    <label className="mt-4 block text-sm font-bold">Organization role<select value={role} onChange={(event) => setRole(event.target.value as OrganizationMemberRole)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"><option value="ADMIN">ADMIN</option><option value="MANAGER">MANAGER</option><option value="USER">USER</option></select></label>
    <label className="mt-4 block text-sm font-bold">Reason <span className="font-normal text-gray-500">(optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
    {error && <p className="mt-3 text-sm font-semibold text-rose-600" role="alert">{error}</p>}
  </DialogShell>;
}

export function MemberAccessDialog({ member, activeMembers, maxUsers, timezone, busy, onClose, onSubmit, onSuspend, onArchive }: {
  member: OrganizationMember;
  activeMembers: number;
  maxUsers: number | null;
  timezone?: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { role?: OrganizationMemberRole; status?: typeof memberStatuses[number]; reason?: string }) => void;
  onSuspend?: () => void;
  onArchive?: () => void;
}) {
  const [role, setRole] = useState<OrganizationMemberRole>(member.role);
  const [status, setStatus] = useState<typeof memberStatuses[number]>(member.status.toLowerCase() as typeof memberStatuses[number]);
  const [reason, setReason] = useState('');
  const [suspendConfirm, setSuspendConfirm] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const isActive = member.status.toLowerCase() === 'active';
  const isArchived = member.status.toLowerCase() === 'archived';

  return <DialogShell title={`Manage ${member.name || member.email || 'member'}`} busy={busy} onClose={onClose} onSubmit={() => onSubmit({ role, status, reason: reason.trim() || undefined })} submitLabel="Save member access">
    <p className="mt-1 text-sm text-gray-500">Changes affect this organization only, not Firebase Authentication or the user’s other organization memberships.</p>
    <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900"><div>Active users: <strong>{activeMembers}</strong></div><div>License limit: <strong>{maxUsers ?? '—'}</strong></div><div>Available seats: <strong>{maxUsers === null ? '—' : Math.max(0, maxUsers - activeMembers)}</strong></div></div>
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Login activity</p><dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-gray-500">Last Successful Login</dt><dd className="mt-1 text-gray-800">{loginDate(member.lastSuccessfulLoginAt, timezone)}</dd></div><div><dt className="text-xs text-gray-500">Last Failed Login</dt><dd className="mt-1 text-gray-800">{loginDate(member.lastFailedLoginAt, timezone)}</dd></div><div><dt className="text-xs text-gray-500">Latest Login Status</dt><dd className="mt-1 text-gray-800">{loginStatusLabel(member.lastLoginStatus)}</dd></div>{member.lastLoginFailureCode && <div><dt className="text-xs text-gray-500">Failure Reason</dt><dd className="mt-1 text-gray-800">{loginFailureReason(member.lastLoginFailureCode)}</dd></div>}</dl></div>
    <label className="mt-5 block text-sm font-bold">Organization role<select value={role} onChange={(event) => setRole(event.target.value as OrganizationMemberRole)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"><option value="ADMIN">ADMIN</option><option value="MANAGER">MANAGER</option><option value="USER">USER</option></select></label>
    <label className="mt-4 block text-sm font-bold">Membership status<select value={status} onChange={(event) => setStatus(event.target.value as typeof memberStatuses[number])} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100">{memberStatuses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <label className="mt-4 block text-sm font-bold">Administrative reason <span className="font-normal text-gray-500">(optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" /></label>
    {((onSuspend && isActive) || (onArchive && !isArchived)) && <div className="mt-5 border-t border-gray-200 pt-4"><p className="text-xs font-bold uppercase tracking-wider text-gray-400">Direct access actions</p><div className="mt-3 flex flex-wrap gap-2">{onSuspend && isActive && <button type="button" onClick={() => setSuspendConfirm(true)} disabled={busy} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500">Suspend access</button>}{onArchive && !isArchived && <button type="button" onClick={() => setArchiveConfirm(true)} disabled={busy} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500">Remove member</button>}</div>{suspendConfirm && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">Suspend organization access?</p><p className="mt-1">The member loses access to this organization and releases their active seat. Their Firebase account is not disabled.</p><button type="button" onClick={onSuspend} disabled={busy} className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500">Confirm suspend access</button></div>}{archiveConfirm && <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p className="font-bold">Remove member from this organization?</p><p className="mt-1">The membership is archived so access history and auditability remain intact. The Firebase account and other organization memberships are not deleted.</p><button type="button" onClick={onArchive} disabled={busy} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-rose-500">Confirm remove member</button></div>}</div>}
  </DialogShell>;
}

export function MemberActionConfirmDialog({ action, member, busy, onClose, onConfirm }: {
  action: 'SUSPEND_MEMBER' | 'REACTIVATE_MEMBER' | 'ARCHIVE_MEMBER' | 'RESTORE_MEMBER';
  member: OrganizationMember;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const labels = {
    SUSPEND_MEMBER: ['Suspend member access?', 'Suspend Access', 'Access will be suspended and the active seat will be released.'],
    REACTIVATE_MEMBER: ['Reactivate member access?', 'Reactivate Access', 'This will consume an available active seat.'],
    ARCHIVE_MEMBER: ['Archive member?', 'Confirm Archive Member', 'Access will be removed while historical records are preserved.'],
    RESTORE_MEMBER: ['Restore member?', 'Restore Member', 'This will restore active organization access and consume a seat.'],
  } as const;
  const [title, submitLabel, description] = labels[action];
  return <DialogShell title={title} busy={busy} onClose={onClose} onSubmit={onConfirm} submitLabel={submitLabel} busyLabel={`${submitLabel}…`}><p className="mt-3 text-sm text-gray-600">{member.name || member.email || 'This member'} · {member.email || 'No email available'}</p><p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{description}</p></DialogShell>;
}
