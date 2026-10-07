'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Building2, ChevronLeft, ChevronRight, Plus, Search, UserCog, X } from 'lucide-react';
import { getOrganizationMembershipPage, getOrganizationRegistryPage, lookupOrganizationUser } from '@/lib/console-api';
import type { ConsoleMembership, OrganizationMember, OrganizationMemberStatus, OrganizationRegistryEntry } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { useOrganizationMemberAdmin } from '@/lib/use-organization-member-admin';
import { CompactActionGroup, CompactBadge, CompactIconButton, EmptyState, ErrorState, LoadingState, TruncatedText } from './ConsolePrimitives';
import { AddMemberDialog, MemberAccessDialog } from './OrganizationAdminDialogs';

const PAGE_SIZE_LABEL = 'up to 25 per page';

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

function workspaceLabel(organization: OrganizationRegistryEntry) {
  return organization.platformMetadata.workspaceSlug ? `Workspace · ${organization.platformMetadata.workspaceSlug}` : 'Centralized workspace';
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
    // Do not expose internal auth diagnostics through the membership page.
    lastLoginFailureCode: row.lastLoginStatus === 'FAILED' ? 'ACCESS_FAILED' : undefined,
  };
}

export function UsersModule() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { platformAdmin } = useAuth();
  const [organizationId, setOrganizationId] = useState<string | undefined>(() => searchParams.get('organizationId') || undefined);
  const [organizationChoices, setOrganizationChoices] = useState<OrganizationRegistryEntry[]>([]);
  const [organizationSearchDraft, setOrganizationSearchDraft] = useState('');
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [organizationCursor, setOrganizationCursor] = useState<string | undefined>();
  const [organizationNextCursor, setOrganizationNextCursor] = useState<string | undefined>();
  const [organizationCursorHistory, setOrganizationCursorHistory] = useState<Array<string | undefined>>([]);
  const [organizationPage, setOrganizationPage] = useState(1);
  const [organizationLoading, setOrganizationLoading] = useState(false);
  const [rows, setRows] = useState<ConsoleMembership[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationRegistryEntry | null>(null);
  const [memberQueryDraft, setMemberQueryDraft] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberStatusDraft, setMemberStatusDraft] = useState<OrganizationMemberStatus | 'ALL'>('ALL');
  const [memberStatus, setMemberStatus] = useState<OrganizationMemberStatus | 'ALL'>('ALL');
  const [memberCursor, setMemberCursor] = useState<string | undefined>();
  const [memberNextCursor, setMemberNextCursor] = useState<string | undefined>();
  const [memberCursorHistory, setMemberCursorHistory] = useState<Array<string | undefined>>([]);
  const [memberPage, setMemberPage] = useState(1);
  const [membershipRefreshVersion, setMembershipRefreshVersion] = useState(0);
  const [membershipLoading, setMembershipLoading] = useState(Boolean(searchParams.get('organizationId')));
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConsoleMembership | null>(null);
  const [adding, setAdding] = useState(false);
  const isSuperAdmin = platformAdmin?.role === 'SUPER_ADMIN';
  // Clear privileged drafts when the external authorization profile changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!(isSuperAdmin)) { setSelected(null); setAdding(false); } }, [isSuperAdmin]);

  const loadOrganizationChoices = useCallback(async (pageCursor?: string) => {
    setOrganizationLoading(true);
    setError(null);
    try {
      const result = await getOrganizationRegistryPage({ query: organizationSearch }, pageCursor);
      setOrganizationChoices(result.items);
      setOrganizationNextCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load organizations.');
    } finally {
      setOrganizationLoading(false);
    }
  }, [organizationSearch]);

  const loadMemberships = useCallback(async (pageCursor?: string) => {
    if (!organizationId) return;
    setMembershipLoading(true);
    setError(null);
    try {
      const result = await getOrganizationMembershipPage(organizationId, { query: memberQuery, status: memberStatus }, pageCursor);
      setRows(result.members);
      setSelectedOrganization(result.organization);
      setMemberNextCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load organization memberships.');
    } finally {
      setMembershipLoading(false);
    }
  }, [memberQuery, memberStatus, organizationId]);

  // Each screen reads only one bounded registry or membership page at a time.
  useEffect(() => {
    if (!organizationId) void Promise.resolve().then(() => loadOrganizationChoices(organizationCursor));
  }, [loadOrganizationChoices, organizationCursor, organizationId]);
  useEffect(() => {
    if (organizationId) void Promise.resolve().then(() => loadMemberships(memberCursor));
  }, [loadMemberships, memberCursor, membershipRefreshVersion, organizationId]);

  const refreshMemberships = useCallback(async () => {
    await loadMemberships(memberCursor);
  }, [loadMemberships, memberCursor]);
  const mutationOrganizationId = selected?.organizationId || selectedOrganization?.organizationId;
  const { busy, message, runMemberAction } = useOrganizationMemberAdmin({ organizationId: mutationOrganizationId, refresh: refreshMemberships });

  const selectOrganization = (nextOrganizationId: string) => {
    setOrganizationId(nextOrganizationId);
    setRows([]);
    setSelectedOrganization(null);
    setSelected(null);
    setAdding(false);
    setMemberQueryDraft('');
    setMemberQuery('');
    setMemberStatusDraft('ALL');
    setMemberStatus('ALL');
    setMemberCursor(undefined);
    setMemberNextCursor(undefined);
    setMemberCursorHistory([]);
    setMemberPage(1);
    router.push(`/users?organizationId=${encodeURIComponent(nextOrganizationId)}`);
  };
  const clearOrganization = () => {
    setOrganizationId(undefined);
    setRows([]);
    setSelectedOrganization(null);
    setSelected(null);
    setAdding(false);
    setMemberCursor(undefined);
    setMemberNextCursor(undefined);
    setMemberCursorHistory([]);
    setMemberPage(1);
    router.push('/users');
  };
  const applyOrganizationSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setOrganizationSearch(organizationSearchDraft.trim());
    setOrganizationCursor(undefined);
    setOrganizationCursorHistory([]);
    setOrganizationPage(1);
  };
  const applyMembershipFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setMemberQuery(memberQueryDraft.trim());
    setMemberStatus(memberStatusDraft);
    setMemberCursor(undefined);
    setMemberCursorHistory([]);
    setMemberPage(1);
    setMembershipRefreshVersion((value) => value + 1);
  };
  const clearMembershipFilters = () => {
    setMemberQueryDraft('');
    setMemberQuery('');
    setMemberStatusDraft('ALL');
    setMemberStatus('ALL');
    setMemberCursor(undefined);
    setMemberCursorHistory([]);
    setMemberPage(1);
    setMembershipRefreshVersion((value) => value + 1);
  };
  const previousOrganizationPage = () => {
    const previousCursor = organizationCursorHistory.at(-1);
    setOrganizationCursorHistory((history) => history.slice(0, -1));
    setOrganizationCursor(previousCursor);
    setOrganizationPage((value) => Math.max(1, value - 1));
  };
  const nextOrganizationPage = () => {
    if (!organizationNextCursor) return;
    setOrganizationCursorHistory((history) => [...history, organizationCursor]);
    setOrganizationCursor(organizationNextCursor);
    setOrganizationPage((value) => value + 1);
  };
  const previousMemberPage = () => {
    const previousCursor = memberCursorHistory.at(-1);
    setMemberCursorHistory((history) => history.slice(0, -1));
    setMemberCursor(previousCursor);
    setMemberPage((value) => Math.max(1, value - 1));
  };
  const nextMemberPage = () => {
    if (!memberNextCursor) return;
    setMemberCursorHistory((history) => [...history, memberCursor]);
    setMemberCursor(memberNextCursor);
    setMemberPage((value) => value + 1);
  };
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

  if (membershipLoading && organizationId && !selectedOrganization) return <LoadingState />;
  if (error && organizationId && !selectedOrganization && !rows.length) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800" role="status">{message}</div>}
      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">{error}</div>}
      <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">Organization roles apply only inside that organization. Developer Console access requires separate platform SUPER_ADMIN or SUPPORT authorization. Membership removal archives organization access; it never deletes a Firebase account or customer records.</p>

      <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="organization-membership-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="organization-membership-heading" className="font-black text-gray-950">Organization membership</h2>
            <p className="mt-1 text-sm text-gray-500">Membership is read one organization at a time. Only SUPER_ADMIN can change access.</p>
          </div>
          {isSuperAdmin && <button type="button" onClick={() => setAdding(true)} disabled={!selectedOrganization || busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add member</button>}
        </div>
        {platformAdmin?.role === 'SUPPORT' && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">SUPPORT remains read-only. SUPPORT can review organization membership but cannot add, suspend, remove, or change members.</p>}

        {selectedOrganization ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <div className="min-w-0"><p className="truncate font-bold text-gray-950">{selectedOrganization.organizationName}</p><p className="mt-1 truncate text-xs text-gray-600">{workspaceLabel(selectedOrganization)} · {selectedOrganization.activeSeatCount} / {selectedOrganization.maxUsers ?? '—'} seats</p></div>
            <button type="button" onClick={clearOrganization} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"><X className="h-3.5 w-3.5" aria-hidden="true" />Change organization</button>
          </div>
        ) : (
          <div className="mt-4"><form onSubmit={applyOrganizationSearch} className="flex flex-wrap gap-2"><label className="relative min-w-[220px] flex-1"><span className="sr-only">Search organization</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" aria-hidden="true" /><input value={organizationSearchDraft} onChange={(event) => setOrganizationSearchDraft(event.target.value)} placeholder="Search organization or workspace" className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><button type="submit" disabled={organizationLoading} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">Find organization</button></form><p className="mt-2 text-xs text-gray-500">Choose an organization before viewing members. The browser never loads all organization memberships.</p></div>
        )}
      </section>

      {!selectedOrganization ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4" aria-label="Choose organization">
          <div className="flex items-center justify-between gap-3"><h3 className="font-black text-gray-950">Choose an organization</h3><span className="text-xs text-gray-500">Page {organizationPage} · {organizationChoices.length} shown · {PAGE_SIZE_LABEL}</span></div>
          {organizationLoading && !organizationChoices.length ? <div className="mt-4"><LoadingState /></div> : !organizationChoices.length ? <div className="mt-4"><EmptyState title="No organizations found" message={organizationNextCursor ? 'Continue to the next page to search further.' : 'Try a different organization or workspace search.'} /></div> : <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{organizationChoices.map((organization) => <button key={organization.organizationId} type="button" onClick={() => selectOrganization(organization.organizationId)} className="min-w-0 rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500"><span className="block truncate font-bold text-gray-950">{organization.organizationName}</span><span className="mt-1 block truncate text-xs text-gray-500">{workspaceLabel(organization)}</span><span className="mt-2 block text-xs text-gray-600">{organization.planName || organization.canonicalPlan || 'No plan'} · {organization.licenseStatus}</span></button>)}</div>}
          <div className="mt-4 flex items-center justify-end gap-2"><CompactIconButton label="Previous organization choices page" onClick={previousOrganizationPage} disabled={organizationLoading || organizationPage === 1}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label="Next organization choices page" onClick={nextOrganizationPage} disabled={organizationLoading || !organizationNextCursor}><ChevronRight className="h-4 w-4" aria-hidden="true" /></CompactIconButton></div>
        </section>
      ) : (
        <>
          <form onSubmit={applyMembershipFilters} className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"><label className="min-w-[220px] flex-1 text-sm font-bold text-gray-700">Search member access<input value={memberQueryDraft} onChange={(event) => setMemberQueryDraft(event.target.value)} placeholder="Name, email, role, or access status" className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><label className="min-w-[180px] text-sm font-bold text-gray-700">Membership status<select value={memberStatusDraft} onChange={(event) => setMemberStatusDraft(event.target.value as OrganizationMemberStatus | 'ALL')} className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option><option value="ARCHIVED">Archived</option><option value="DISABLED">Disabled</option></select></label><button type="submit" disabled={membershipLoading} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-50">Apply</button>{(memberQuery || memberStatus !== 'ALL') && <button type="button" onClick={clearMembershipFilters} className="pb-2 text-xs font-bold text-blue-700 hover:underline">Clear</button>}</form>

          {!rows.length && !membershipLoading ? <EmptyState title="No memberships in this organization" message={isSuperAdmin ? 'Use Add member to grant organization access to an existing verified user or create a pending assignment.' : 'Try changing the membership filters.'} /> : <>
            <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block"><table className="w-full min-w-[1120px] table-fixed text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[20%] px-3 py-2">Member</th><th className="w-[22%] px-3 py-2">Email</th><th className="w-[10%] px-3 py-2">Role</th><th className="w-[11%] px-3 py-2">Status</th><th className="w-[15%] px-3 py-2">Last Login</th><th className="w-[10%] px-3 py-2">Login Status</th><th className="w-[9%] px-3 py-2">License impact</th><th className="w-[3%] px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => { const displayName = row.name || row.email || '—'; const status = row.status.toLowerCase(); return <tr key={`${row.organizationId}-${row.id}`} className="h-14 hover:bg-gray-50"><td className="px-3 py-2 font-bold"><TruncatedText value={displayName} /></td><td className="px-3 py-2"><TruncatedText value={row.email} className="text-gray-600" /></td><td className="px-3 py-2"><CompactBadge label={row.role} tone="info" /></td><td className="px-3 py-2"><CompactBadge label={status} tone={accessTone(status)} /></td><td className="whitespace-nowrap px-3 py-2">{loginDate(row.lastLoginAt)}</td><td className="px-3 py-2"><CompactBadge label={loginStatusLabel(row)} tone={loginStatusTone(row)} /></td><td className={`px-3 py-2 ${row.organizationHealth === 'ACTION_REQUIRED' ? 'font-bold text-amber-700' : 'text-gray-600'}`}><TruncatedText value={licenseImpact(row)} /></td><td className="px-3 py-2"><CompactActionGroup><CompactIconButton label={`View Organization for ${displayName}`} onClick={() => openOrganization(row)}><Building2 className="h-4 w-4" aria-hidden="true" /></CompactIconButton>{isSuperAdmin && <CompactIconButton label={`Manage Membership for ${displayName}`} onClick={() => setSelected(row)} className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><UserCog className="h-4 w-4" aria-hidden="true" /></CompactIconButton>}</CompactActionGroup></td></tr>; })}</tbody></table></div>
            <div className="space-y-3 md:hidden">{rows.map((row) => { const displayName = row.name || row.email || '—'; const status = row.status.toLowerCase(); return <article key={`${row.organizationId}-${row.id}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><TruncatedText value={displayName} className="font-bold" />{row.name && <TruncatedText value={row.email} className="text-xs text-gray-500" />}</div><CompactBadge label={status} tone={accessTone(status)} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-gray-400">Role</dt><dd><CompactBadge label={row.role} tone="info" /></dd></div><div><dt className="text-xs text-gray-400">Last Login</dt><dd>{loginDate(row.lastLoginAt)}</dd></div><div><dt className="text-xs text-gray-400">Login Status</dt><dd><CompactBadge label={loginStatusLabel(row)} tone={loginStatusTone(row)} /></dd></div><div><dt className="text-xs text-gray-400">Active / limit</dt><dd>{row.activeMemberCount ?? 0} / {row.maxUsers ?? '—'}</dd></div></dl><CompactActionGroup className="mt-4"><CompactIconButton label={`View Organization for ${displayName}`} onClick={() => openOrganization(row)}><Building2 className="h-4 w-4" aria-hidden="true" /></CompactIconButton>{isSuperAdmin && <CompactIconButton label={`Manage Membership for ${displayName}`} onClick={() => setSelected(row)} className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><UserCog className="h-4 w-4" aria-hidden="true" /></CompactIconButton>}</CompactActionGroup></article>; })}</div>
          </>}
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"><span className="text-xs font-semibold text-gray-500">Page {memberPage} · {rows.length} membership{rows.length === 1 ? '' : 's'} shown · {PAGE_SIZE_LABEL}{membershipLoading ? ' · Loading…' : ''}</span><div className="flex items-center gap-2"><CompactIconButton label="Previous membership page" onClick={previousMemberPage} disabled={membershipLoading || memberPage === 1}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label="Next membership page" onClick={nextMemberPage} disabled={membershipLoading || !memberNextCursor}><ChevronRight className="h-4 w-4" aria-hidden="true" /></CompactIconButton></div></div>
        </>
      )}

      {isSuperAdmin && adding && selectedOrganization && <AddMemberDialog busy={busy} onClose={() => !busy && setAdding(false)} onLookup={(email) => lookupOrganizationUser(selectedOrganization.organizationId, email)} onSubmit={(payload) => void addMember(payload)} />}
      {isSuperAdmin && selected && <MemberAccessDialog member={memberForDialog(selected)} activeMembers={selected.activeMemberCount ?? 0} maxUsers={selected.maxUsers ?? null} busy={busy} onClose={() => !busy && setSelected(null)} onSubmit={(payload) => void saveMember(payload)} onSuspend={() => void suspendMember()} onArchive={() => void archiveMember()} />}
    </div>
  );
}
