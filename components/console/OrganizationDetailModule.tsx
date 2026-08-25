'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { activateLicense, changePlan, changeSeatLimit, convertTrialToPaid, expireLicense, extendSubscription, extendTrial, getOrganization, reactivateOrganization, renewLicense, suspendOrganization, ConsoleApiError } from '@/lib/console-api';
import { Organization, OrganizationMember } from '@/lib/types';
import { ConsolePage } from '../ConsoleShell';
import { ErrorState, formatDate, LoadingState, StatusBadge } from './ConsolePrimitives';
import { LicenseAction, LicenseActionDialog, LicenseActionPayload, licenseActionLabel } from './LicenseActionDialog';
import { useAuth } from '@/lib/auth-context';

export function OrganizationDetailModule({ orgId }: { orgId: string }) {
  const router = useRouter();
  const { platformAdmin } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<LicenseAction | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    const result = await getOrganization(orgId);
    setOrg(result.organization);
    setMembers(result.members);
  }, [orgId]);
  // Data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Unable to load organization.')); }, [load]);
  if (error) return <div className="p-6 lg:p-10"><ErrorState message={error} /></div>;
  if (!org) return <LoadingState />;

  const adminState = org.licenseAdminState;
  const status = adminState?.status || org.licenseStatus || 'UNKNOWN';
  const actions: LicenseAction[] = platformAdmin?.role === 'SUPER_ADMIN' ? (adminState?.allowedActions || []) : [];
  const licenseRows = [
    ['Plan', org.license?.plan || '—'],
    ['Maximum users', adminState?.maxUsers ?? '—'],
    ['Active members', adminState?.activeMembers ?? org.activeMemberCount ?? '—'],
    ['Trial start', formatDate(org.license?.trialStartedAt)],
    ['Trial end', formatDate(org.license?.trialEndsAt)],
    ['Subscription start', formatDate(org.license?.subscriptionStartedAt)],
    ['Expiration', formatDate(adminState?.expiresAt || undefined)],
    ['Days remaining', adminState?.daysRemaining ?? '—'],
    ['Write enabled', org.license ? (org.licenseWriteEnabled ? 'YES' : 'NO') : '—'],
    ['Updated', formatDate(org.license?.updatedAt)],
  ];
  const runAction = async (payload: LicenseActionPayload) => {
    if (!dialog) return;
    setBusy(true);
    setMessage(null);
    try {
      const endAt = (value?: string) => new Date(`${value}T23:59:59.000Z`).toISOString();
      const startAt = (value?: string) => new Date(`${value}T00:00:00.000Z`).toISOString();
      if (dialog === 'ACTIVATE') await activateLicense(orgId, { plan: payload.plan || 'TRIAL', maxUsers: payload.maxUsers || 1, ...(payload.plan === 'TRIAL' ? {} : { subscriptionStartedAt: startAt(payload.subscriptionStartedAt) }), endsAt: endAt(payload.trialEndsAt || payload.subscriptionEndsAt) });
      if (dialog === 'CONVERT_TO_PAID') await convertTrialToPaid(orgId, { plan: payload.plan as 'STARTER' | 'TEAM' | 'LEGACY', maxUsers: payload.maxUsers || 1, subscriptionStartedAt: startAt(payload.subscriptionStartedAt), subscriptionEndsAt: endAt(payload.subscriptionEndsAt) });
      if (dialog === 'EXTEND_SUBSCRIPTION') await extendSubscription(orgId, endAt(payload.subscriptionEndsAt));
      if (dialog === 'RENEW') await renewLicense(orgId, { plan: payload.plan, maxUsers: payload.maxUsers, subscriptionStartedAt: startAt(payload.subscriptionStartedAt), subscriptionEndsAt: endAt(payload.subscriptionEndsAt) });
      if (dialog === 'EXTEND_TRIAL') await extendTrial(orgId, endAt(payload.trialEndsAt));
      if (dialog === 'CHANGE_PLAN') await changePlan(orgId, payload.plan || 'TEAM');
      if (dialog === 'CHANGE_SEAT_LIMIT') await changeSeatLimit(orgId, payload.maxUsers || 1);
      if (dialog === 'SUSPEND') await suspendOrganization(orgId, payload.reason);
      if (dialog === 'EXPIRE') await expireLicense(orgId);
      if (dialog === 'REACTIVATE') await reactivateOrganization(orgId);
      await load();
      setDialog(null);
      setMessage('Administrative change completed and organization state refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The administrative request failed.');
      if (e instanceof ConsoleApiError && e.status === 409) {
        setDialog(null);
        try { await load(); } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh organization state.'); }
      }
    } finally {
      setBusy(false);
    }
  };

  return <ConsolePage title={org.name} description={org.slug ? `/${org.slug}` : 'Organization details'} action={<div className="flex gap-4"><button onClick={() => void load()} className="flex items-center gap-2 text-sm font-bold text-gray-500"><RefreshCw className="h-4 w-4" />Refresh</button><button onClick={() => router.push('/organizations')} className="flex items-center gap-2 text-sm font-bold text-blue-600"><ArrowLeft className="h-4 w-4" />Back</button></div>}>
    <div className="space-y-6">
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{message}</div>}
      {adminState?.documentState === 'INVALID_LICENSE' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">License requires attention</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black">Organization overview</h2><dl className="mt-5 grid grid-cols-2 gap-4 text-sm">{[['Business name', org.name], ['Slug', org.slug || '—'], ['Business type', org.businessType || '—'], ['Currency', org.currency || '—'], ['Timezone', org.timezone || '—'], ['Organization ID', org.id]].map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 break-words text-gray-800">{value}</dd></div>)}</dl></section>
        <section className="rounded-xl border border-gray-200 bg-white p-6"><div className="flex items-center justify-between"><h2 className="font-black">License</h2><StatusBadge status={status} /></div><dl className="mt-5 grid grid-cols-2 gap-4 text-sm">{licenseRows.map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 text-gray-800">{value}</dd></div>)}</dl><div className="mt-6 flex flex-wrap gap-2">{actions.map((item) => <button key={item} onClick={() => setDialog(item)} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black tracking-wider text-gray-700 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50">{licenseActionLabel(item)}</button>)}</div></section>
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black">Members <span className="ml-1 text-sm font-normal text-gray-400">{members.length}</span></h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-400"><tr><th className="py-3">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody className="divide-y divide-gray-100">{members.map((member) => <tr key={member.id}><td className="py-3 font-semibold">{member.name || '—'}</td><td>{member.email || '—'}</td><td>{member.role}</td><td>{member.status}</td><td>{formatDate(member.joinedAt)}</td></tr>)}</tbody></table></div></section>
    </div>
    {dialog && <LicenseActionDialog action={dialog} organization={org} activeMembers={org.activeMemberCount ?? 0} busy={busy} onClose={() => !busy && setDialog(null)} onSubmit={(payload) => void runAction(payload)} />}
  </ConsolePage>;
}
