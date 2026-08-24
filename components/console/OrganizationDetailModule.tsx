'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { activateLicense, cancelLicense, changePlan, changeSeatLimit, extendTrial, reactivateOrganization, suspendOrganization } from '@/lib/console-api';
import { fetchMembers, fetchOrganization } from '@/lib/organization-data';
import { evaluateOrganizationLicense } from '@/lib/license';
import { Organization, OrganizationMember } from '@/lib/types';
import { ConsolePage } from '../ConsoleShell';
import { ErrorState, formatDate, LoadingState, StatusBadge } from './ConsolePrimitives';
import { LicenseAction, LicenseActionDialog, LicenseActionPayload } from './LicenseActionDialog';
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
    const [organization, organizationMembers] = await Promise.all([fetchOrganization(orgId), fetchMembers(orgId)]);
    setOrg(organization); setMembers(organizationMembers);
  }, [orgId]);
  // Data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Unable to load organization.')); }, [load]);
  if (error) return <div className="p-6 lg:p-10"><ErrorState message={error} /></div>;
  if (!org) return <LoadingState />;
  const evaluation = evaluateOrganizationLicense(org);
  const runAction = async (payload: LicenseActionPayload) => {
    if (!dialog) return;
    setBusy(true); setMessage(null);
    try {
      if (dialog === 'ACTIVATE') await activateLicense(orgId, { planId: payload.planId || 'SOLO', seatLimit: payload.seatLimit || 1, expiresAt: new Date(`${payload.date}T23:59:59.000Z`).toISOString() });
      if (dialog === 'EXTEND_TRIAL') await extendTrial(orgId, new Date(`${payload.date}T23:59:59.000Z`).toISOString());
      if (dialog === 'CHANGE_PLAN') await changePlan(orgId, payload.planId || 'TEAM');
      if (dialog === 'CHANGE_SEAT_LIMIT') await changeSeatLimit(orgId, payload.seatLimit || 1);
      if (dialog === 'SUSPEND') await suspendOrganization(orgId, payload.reason);
      if (dialog === 'REACTIVATE') await reactivateOrganization(orgId);
      if (dialog === 'CANCEL') await cancelLicense(orgId);
      await load(); setDialog(null); setMessage('Administrative change completed and organization state refreshed.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'The administrative request failed.'); }
    finally { setBusy(false); }
  };
  const licenseRows = [['Plan', org.license?.planId || '—'], ['Seat limit', org.license?.seatLimit ?? '—'], ['Trial start', formatDate(org.license?.trialStartedAt)], ['Trial end', formatDate(org.license?.trialEndsAt)], ['Subscription start', formatDate(org.license?.startsAt)], ['Expiration', formatDate(org.license?.expiresAt)], ['Grace period', formatDate(org.license?.graceEndsAt)], ['Updated', formatDate(org.license?.updatedAt)]];
  const actions: LicenseAction[] = ['ACTIVATE', 'EXTEND_TRIAL', 'CHANGE_PLAN', 'CHANGE_SEAT_LIMIT', 'SUSPEND', 'REACTIVATE', 'CANCEL'];
  if (platformAdmin?.role !== 'SUPER_ADMIN') actions.length = 0;
  return (
    <ConsolePage title={org.name} description={org.slug ? `/${org.slug}` : 'Organization details'} action={<div className="flex gap-4"><button onClick={() => void load()} className="flex items-center gap-2 text-sm font-bold text-gray-500"><RefreshCw className="h-4 w-4" />Refresh</button><button onClick={() => router.push('/organizations')} className="flex items-center gap-2 text-sm font-bold text-blue-600"><ArrowLeft className="h-4 w-4" />Back</button></div>}>
      <div className="space-y-6">
        {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{message}</div>}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black">Organization overview</h2><dl className="mt-5 grid grid-cols-2 gap-4 text-sm">{[['Business name', org.name], ['Slug', org.slug || '—'], ['Business type', org.businessType || '—'], ['Currency', org.currency || '—'], ['Timezone', org.timezone || '—'], ['Organization ID', org.id]].map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 break-words text-gray-800">{value}</dd></div>)}</dl></section>
          <section className="rounded-xl border border-gray-200 bg-white p-6"><div className="flex items-center justify-between"><h2 className="font-black">License</h2><StatusBadge status={evaluation.status} /></div><dl className="mt-5 grid grid-cols-2 gap-4 text-sm">{licenseRows.map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 text-gray-800">{value}</dd></div>)}</dl><div className="mt-6 flex flex-wrap gap-2">{actions.map((item) => <button key={item} onClick={() => setDialog(item)} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-700 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50">{item.replace('_', ' ')}</button>)}</div></section>
        </div>
        <section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black">Members <span className="ml-1 text-sm font-normal text-gray-400">{members.length}</span></h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-400"><tr><th className="py-3">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody className="divide-y divide-gray-100">{members.map((member) => <tr key={member.id}><td className="py-3 font-semibold">{member.name || '—'}</td><td>{member.email || '—'}</td><td>{member.role}</td><td>{member.status}</td><td>{formatDate(member.joinedAt)}</td></tr>)}</tbody></table></div></section>
      </div>
      {dialog && <LicenseActionDialog action={dialog} organization={org} activeMembers={members.filter((member) => member.status === 'ACTIVE').length} busy={busy} onClose={() => !busy && setDialog(null)} onSubmit={(payload) => void runAction(payload)} />}
    </ConsolePage>
  );
}
