'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, Plus, UserCog } from 'lucide-react';
import { getOrganizations, getUsers, lookupOrganizationUser, type ConsoleMembership } from '@/lib/console-api';
import type { OrganizationMember, OrganizationRegistryEntry } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { useOrganizationMemberAdmin } from '@/lib/use-organization-member-admin';
import { CompactActionGroup, CompactBadge, CompactIconButton, EmptyState, ErrorState, LoadingState, TruncatedText } from './ConsolePrimitives';
import { AddMemberDialog, MemberAccessDialog } from './OrganizationAdminDialogs';

function licenseImpact(row: ConsoleMembership) {
  if (row.organizationHealth === 'ACTION_REQUIRED') return 'Action Required';
  if (row.organizationHealth === 'WARNING') return 'Attention Soon';
  return 'No immediate impact';
}

function accessTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'suspended' || status === 'archived' || status === 'disabled') return 'danger';
  return 'neutral';
}

function loginStatusLabel(row: ConsoleMembership) {
  return row.lastLoginStatus === 'SUCCESS' ? 'Successful' : row.lastLoginStatus === 'FAILED' ? 'Failed' : 'No login yet';
}

function loginStatusTone(row: ConsoleMembership): 'neutral' | 'success' | 'danger' {
  return row.lastLoginStatus === 'SUCCESS' ? 'success' : row.lastLoginStatus === 'FAILED' ? 'danger' : 'neutral';
}

function loginDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function memberForDialog(row: ConsoleMembership): OrganizationMember {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt,
    lastLoginAt: row.lastLoginAt,
    lastLoginStatus: row.lastLoginStatus,
    lastSuccessfulLoginAt: row.lastSuccessfulLoginAt,
    lastFailedLoginAt: row.lastFailedLoginAt,
    // The list response may retain a diagnostic code for server-side operations,
    // but the Console only projects a generic failed-access reason to admins.
    lastLoginFailureCode: row.lastLoginStatus === 'FAILED' ? 'ACCESS_FAILED' : undefined,
  };
}

export function UsersModule() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { platformAdmin } = useAuth();
  const [rows, setRows] = useState<ConsoleMembership[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationRegistryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [organizationId, setOrganizationId] = useState(() => searchParams.get('organizationId') || 'ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConsoleMembership | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [nextRows, nextOrganizations] = await Promise.all([getUsers(), getOrganizations()]);
    setRows(nextRows);
    setOrganizations(nextOrganizations);
  }, []);

  // Membership and organization registry data are external synchronization.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void load()
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load memberships.'))
      .finally(() => setLoading(false));
  }, [load]);

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.organizationId === organizationId) || null,
    [organizationId, organizations],
  );
  const mutationOrganizationId = selected?.organizationId || selectedOrganization?.organizationId;
  const { busy, message, runMemberAction } = useOrganizationMemberAdmin({ organizationId: mutationOrganizationId, refresh: load });
  const isSuperAdmin = platformAdmin?.role === 'SUPER_ADMIN';

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesOrganization = organizationId === 'ALL' || row.organizationId === organizationId;
      const matchesQuery = !normalizedQuery || [row.name, row.email, row.organization, row.role, row.status]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
      return matchesOrganization && matchesQuery;
    });
  }, [organizationId, query, rows]);

  const openOrganization = (row: ConsoleMembership) => router.push(`/organizations/${row.organizationId}`);
  const saveMember = async (payload: { role?: 'ADMIN' | 'MANAGER' | 'USER'; status?: 'active' | 'pending' | 'inactive' | 'suspended' | 'archived' | 'disabled'; reason?: string }) => {
    if (selected && await runMemberAction('UPDATE_MEMBER', selected.userId || selected.id, payload)) setSelected(null);
  };
  const suspendMember = async () => {
    if (selected && await runMemberAction('SUSPEND_MEMBER', selected.userId || selected.id, { reason: 'Suspended from Members & Access.' })) setSelected(null);
  };
  const archiveMember = async () => {
    if (selected && await runMemberAction('ARCHIVE_MEMBER', selected.userId || selected.id, { reason: 'Removed from organization in Members & Access.' })) setSelected(null);
  };
  const addMember = async (payload: { email: string; role: 'ADMIN' | 'MANAGER' | 'USER'; reason?: string }) => {
    if (await runMemberAction('ADD_MEMBER', undefined, payload)) setAdding(false);
  };

  if (loading) return <LoadingState />;
  if (error && !rows.length && !organizations.length) return <ErrorState message={error} />;

  return <div className="space-y-4">
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800" role="status">{message}</div>}
    {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">{error}</div>}
    <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">Organization roles apply only inside that organization. Developer Console access requires separate platform SUPER_ADMIN or SUPPORT authorization. Membership removal archives organization access; it never deletes a Firebase account or customer records.</p>

    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="organization-membership-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="organization-membership-heading" className="font-black text-gray-950">Organization membership</h2>
          <p className="mt-1 text-sm text-gray-500">Select an organization to add or manage its workspace members. Only SUPER_ADMIN can change access.</p>
        </div>
        {isSuperAdmin && <button type="button" onClick={() => setAdding(true)} disabled={!selectedOrganization || busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add member</button>}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(240px,0.7fr)_minmax(280px,1fr)]">
        <label className="block text-sm font-bold text-gray-700">Organization<select aria-label="Organization membership filter" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All organizations</option>{organizations.map((organization) => <option key={organization.organizationId} value={organization.organizationId}>{organization.organizationName} · {organization.organizationId}</option>)}</select></label>
        <label className="block text-sm font-bold text-gray-700">Search member access<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, role, or access status" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
      </div>
      {isSuperAdmin && !selectedOrganization && <p className="mt-3 text-xs text-gray-500">Select one organization before adding a member.</p>}
      {platformAdmin?.role === 'SUPPORT' && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">SUPPORT remains read-only. SUPPORT can review organization membership but cannot add, suspend, remove, or change members.</p>}
    </section>

    {!filtered.length ? <EmptyState title={selectedOrganization ? 'No memberships in this organization' : 'No memberships found'} message={selectedOrganization && isSuperAdmin ? 'Use Add member to grant organization access to an existing verified user or create a pending assignment.' : 'Try changing the organization or search filters.'} /> : <>
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full min-w-[1350px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[16%] px-3 py-2">Member</th><th className="w-[18%] px-3 py-2">Email</th><th className="w-[16%] px-3 py-2">Organization</th><th className="w-[9%] px-3 py-2">Role</th><th className="w-[10%] px-3 py-2">Status</th><th className="w-[13%] px-3 py-2">Last Login</th><th className="w-[10%] px-3 py-2">Login Status</th><th className="w-[10%] px-3 py-2">License impact</th><th className="w-[8%] px-3 py-2">Action</th></tr></thead><tbody className="divide-y divide-gray-100">
          {filtered.map((row) => {
            const displayName = row.name || row.email || '—';
            const status = row.status.toLowerCase();
            return <tr key={`${row.organizationId}-${row.id}`} className="h-14 hover:bg-gray-50"><td className="px-3 py-2 font-bold"><TruncatedText value={displayName} /></td><td className="px-3 py-2"><TruncatedText value={row.email} className="text-gray-600" /></td><td className="px-3 py-2"><TruncatedText value={row.organization} /></td><td className="px-3 py-2"><CompactBadge label={row.role} tone="info" /></td><td className="px-3 py-2"><CompactBadge label={status} tone={accessTone(status)} /></td><td className="px-3 py-2 whitespace-nowrap">{loginDate(row.lastLoginAt)}</td><td className="px-3 py-2"><CompactBadge label={loginStatusLabel(row)} tone={loginStatusTone(row)} /></td><td className={`px-3 py-2 ${row.organizationHealth === 'ACTION_REQUIRED' ? 'font-bold text-amber-700' : 'text-gray-600'}`}><TruncatedText value={licenseImpact(row)} /></td><td className="px-3 py-2"><CompactActionGroup><CompactIconButton label={`View Organization for ${displayName}`} onClick={() => openOrganization(row)}><Building2 className="h-4 w-4" aria-hidden="true" /></CompactIconButton>{isSuperAdmin && <CompactIconButton label={`Manage Membership for ${displayName}`} onClick={() => setSelected(row)} className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><UserCog className="h-4 w-4" aria-hidden="true" /></CompactIconButton>}</CompactActionGroup></td></tr>;
          })}
        </tbody></table>
      </div>
      <div className="space-y-3 md:hidden">{filtered.map((row) => {
        const displayName = row.name || row.email || '—';
        const status = row.status.toLowerCase();
        return <article key={`${row.organizationId}-${row.id}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><TruncatedText value={displayName} className="font-bold" />{row.name && <TruncatedText value={row.email} className="text-xs text-gray-500" />}</div><CompactBadge label={status} tone={accessTone(status)} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="min-w-0"><dt className="text-xs text-gray-400">Organization</dt><dd><TruncatedText value={row.organization} /></dd></div><div><dt className="text-xs text-gray-400">Role</dt><dd><CompactBadge label={row.role} tone="info" /></dd></div><div><dt className="text-xs text-gray-400">Last Login</dt><dd>{loginDate(row.lastLoginAt)}</dd></div><div><dt className="text-xs text-gray-400">Login Status</dt><dd><CompactBadge label={loginStatusLabel(row)} tone={loginStatusTone(row)} /></dd></div><div className="text-xs text-gray-400"><dt>License impact</dt><dd className="text-gray-700" title={licenseImpact(row)}>{licenseImpact(row)}</dd></div><div><dt className="text-xs text-gray-400">Active / limit</dt><dd>{row.activeMemberCount ?? 0} / {row.maxUsers ?? '—'}</dd></div></dl><CompactActionGroup className="mt-4"><CompactIconButton label={`View Organization for ${displayName}`} onClick={() => openOrganization(row)}><Building2 className="h-4 w-4" aria-hidden="true" /></CompactIconButton>{isSuperAdmin && <CompactIconButton label={`Manage Membership for ${displayName}`} onClick={() => setSelected(row)} className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><UserCog className="h-4 w-4" aria-hidden="true" /></CompactIconButton>}</CompactActionGroup></article>;
      })}</div>
    </>}

    {adding && selectedOrganization && <AddMemberDialog busy={busy} onClose={() => !busy && setAdding(false)} onLookup={(email) => lookupOrganizationUser(selectedOrganization.organizationId, email)} onSubmit={(payload) => void addMember(payload)} />}
    {selected && <MemberAccessDialog member={memberForDialog(selected)} activeMembers={selected.activeMemberCount ?? 0} maxUsers={selected.maxUsers ?? null} busy={busy} onClose={() => !busy && setSelected(null)} onSubmit={(payload) => void saveMember(payload)} onSuspend={() => void suspendMember()} onArchive={() => void archiveMember()} />}
  </div>;
}
