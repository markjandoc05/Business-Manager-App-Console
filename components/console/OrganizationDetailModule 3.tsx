'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { callConsoleAdminApi } from '@/lib/console-api';
import { fetchMembers, fetchOrganization } from '@/lib/organization-data';
import { evaluateOrganizationLicense } from '@/lib/license';
import { Organization, OrganizationMember } from '@/lib/types';
import { ConsolePage } from '../ConsoleShell';
import { ErrorState, formatDate, LoadingState, StatusBadge } from './ConsolePrimitives';

type ActionRequest = { path: string; method: 'POST' | 'PATCH'; body: Record<string, unknown> };

export function OrganizationDetailModule({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchOrganization(orgId), fetchMembers(orgId)])
      .then(([organization, organizationMembers]) => { setOrg(organization); setMembers(organizationMembers); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load organization.'));
  }, [orgId]);

  if (error) return <div className="p-6 lg:p-10"><ErrorState message={error} /></div>;
  if (!org) return <LoadingState />;

  const evaluation = evaluateOrganizationLicense(org);
  const runAction = async (name: string) => {
    const requests: Record<string, ActionRequest> = {
      ACTIVATE: { path: `/api/organizations/${orgId}/license/activate`, method: 'POST', body: { planId: org.license?.planId || 'SOLO', seatLimit: org.license?.seatLimit || Math.max(members.length, 1), expiresAt: org.license?.expiresAt || '' } },
      EXTEND_TRIAL: { path: `/api/organizations/${orgId}/license/extend-trial`, method: 'POST', body: { trialEndsAt: org.license?.trialEndsAt || '' } },
      CHANGE_PLAN: { path: `/api/organizations/${orgId}/license/plan`, method: 'PATCH', body: { planId: org.license?.planId || 'TEAM' } },
      CHANGE_SEAT_LIMIT: { path: `/api/organizations/${orgId}/license/seat-limit`, method: 'PATCH', body: { seatLimit: Math.max(members.length, org.license?.seatLimit || 1) } },
      SUSPEND: { path: `/api/organizations/${orgId}/license/suspend`, method: 'POST', body: { reason: 'Suspended from the BSM Console.' } },
      REACTIVATE: { path: `/api/organizations/${orgId}/license/reactivate`, method: 'POST', body: {} },
      CANCEL: { path: `/api/organizations/${orgId}/license/cancel`, method: 'POST', body: {} },
    };
    const request = requests[name];
    if (!request) return;
    setMessage(null);
    try { await callConsoleAdminApi(request.path, request.body, request.method); setMessage('Administrative change completed. Refresh the organization to view the updated license.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Secure administrative service is unavailable.'); }
  };

  return <ConsolePage title={org.name} description={org.slug ? `/${org.slug}` : 'Organization details'} action={<button onClick={() => router.push('/organizations')} className="flex items-center gap-2 text-sm font-bold text-blue-600"><ArrowLeft className="h-4 w-4" />Back to organizations</button>}>
    <div className="space-y-6">
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{message}</div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black">Organization overview</h2><dl className="mt-5 grid grid-cols-2 gap-4 text-sm">{[['Business name', org.name], ['Slug', org.slug || '—'], ['Business type', org.businessType || '—'], ['Currency', org.currency || '—'], ['Timezone', org.timezone || '—'], ['Organization ID', org.id]].map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 break-words text-gray-800">{value}</dd></div>)}</dl></section>
        <section className="rounded-xl border border-gray-200 bg-white p-6"><div className="flex items-center justify-between"><h2 className="font-black">License</h2><StatusBadge status={evaluation.status} /></div><dl className="mt-5 grid grid-cols-2 gap-4 text-sm">{[['Plan', org.license?.planId || '—'], ['Seat limit', org.license?.seatLimit ?? '—'], ['Trial start', formatDate(org.license?.trialStartedAt)], ['Trial end', formatDate(org.license?.trialEndsAt)], ['Subscription start', formatDate(org.license?.startsAt)], ['Expiration', formatDate(org.license?.expiresAt)], ['Grace period', formatDate(org.license?.graceEndsAt)]].map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</dt><dd className="mt-1 text-gray-800">{value}</dd></div>)}</dl><div className="mt-6 flex flex-wrap gap-2">{['ACTIVATE', 'EXTEND_TRIAL', 'CHANGE_PLAN', 'SUSPEND', 'REACTIVATE', 'CANCEL'].map((item) => <button key={item} onClick={() => void runAction(item)} className="rounded-lg border border-gray-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-700 hover:border-blue-400 hover:text-blue-600">{item.replace('_', ' ')}</button>)}</div></section>
      </div>
      <section className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black">Members <span className="ml-1 text-sm font-normal text-gray-400">{members.length}</span></h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-400"><tr><th className="py-3">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody className="divide-y divide-gray-100">{members.map((member) => <tr key={member.id}><td className="py-3 font-semibold">{member.name || '—'}</td><td>{member.email || '—'}</td><td>{member.role}</td><td>{member.status}</td><td>{formatDate(member.joinedAt)}</td></tr>)}</tbody></table></div></section>
    </div>
  </ConsolePage>;
}
