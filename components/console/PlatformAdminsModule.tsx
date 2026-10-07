'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Power, UserCog } from 'lucide-react';
import { createPlatformAdmin, getPlatformAdmins, updatePlatformAdmin } from '@/lib/console-api';
import type { PlatformAdminListEntry } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { CompactActionGroup, CompactBadge, CompactIconButton, ConfirmActionDialog, formatDate, ErrorState, LoadingState, EmptyState, TruncatedText } from './ConsolePrimitives';

type PendingAction =
  | { kind: 'add' }
  | { kind: 'status'; admin: PlatformAdminListEntry; nextStatus: 'ACTIVE' | 'DISABLED' }
  | { kind: 'role'; admin: PlatformAdminListEntry; nextRole: 'SUPER_ADMIN' | 'SUPPORT' };

function identityLabel(admin: PlatformAdminListEntry) {
  return admin.displayName || admin.email || 'Unnamed platform administrator';
}

export function PlatformAdminsModule() {
  const { platformAdmin } = useAuth();
  const [admins, setAdmins] = useState<PlatformAdminListEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ uid: string; role: 'SUPER_ADMIN' | 'SUPPORT' }>({ uid: '', role: 'SUPPORT' });
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const canManage = platformAdmin?.role === 'SUPER_ADMIN';
  // Clear privileged drafts when the external authorization profile changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!(canManage)) { setShowAdd(false); setPending(null); setForm({ uid: '', role: 'SUPPORT' }); } }, [canManage]);

  const load = useCallback(async (pageCursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPlatformAdmins(pageCursor);
      setAdmins(result.items);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load platform administrators.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Data loading is external synchronization; this directory is cursor-paged.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(cursor); }, [cursor, load]);

  const add = async () => {
    if (!form.uid.trim()) {
      setMessage('Firebase Auth UID is required.');
      return false;
    }
    setBusy(true);
    try {
      await createPlatformAdmin(form);
      setMessage('Platform administrator added.');
      setShowAdd(false);
      setForm({ uid: '', role: 'SUPPORT' });
      setCursorHistory([]);
      setPage(1);
      if (cursor) setCursor(undefined);
      else await load(undefined);
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to add platform administrator.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const update = async (admin: PlatformAdminListEntry, patch: { role?: 'SUPER_ADMIN' | 'SUPPORT'; status?: 'ACTIVE' | 'DISABLED' }) => {
    setBusy(true);
    try {
      await updatePlatformAdmin(admin.uid, patch);
      setMessage('Platform administrator updated.');
      await load(cursor);
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to update platform administrator.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    const action = pending;
    const success = action.kind === 'add'
      ? await add()
      : action.kind === 'status'
        ? await update(action.admin, { status: action.nextStatus })
        : await update(action.admin, { role: action.nextRole });
    if (success) setPending(null);
  };

  const previous = () => {
    const previousCursor = cursorHistory.at(-1);
    setCursorHistory((history) => history.slice(0, -1));
    setCursor(previousCursor);
    setPage((value) => Math.max(1, value - 1));
  };
  const next = () => {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor]);
    setCursor(nextCursor);
    setPage((value) => value + 1);
  };

  const pendingIdentity = pending && pending.kind !== 'add' ? identityLabel(pending.admin) : undefined;
  const pendingTitle = pending?.kind === 'add'
    ? 'Add platform administrator?'
    : pending?.kind === 'status'
      ? `${pending.nextStatus === 'ACTIVE' ? 'Reactivate' : 'Disable'} platform administrator?`
      : pending?.kind === 'role'
        ? 'Change platform administrator role?'
        : '';
  const pendingDescription = pending?.kind === 'add'
    ? <>Create a <strong>{form.role}</strong> platform administrator for the verified Firebase account supplied in the form.</>
    : pending?.kind === 'status'
      ? <><strong>{pendingIdentity}</strong> will be {pending.nextStatus === 'ACTIVE' ? 'reactivated' : 'disabled'}.</>
      : <><strong>{pendingIdentity}</strong> will change to the <strong>{pending?.kind === 'role' ? pending.nextRole : ''}</strong> role.</>;
  const pendingConfirmLabel = pending?.kind === 'add' ? 'Add Platform Admin' : pending?.kind === 'status' ? pending.nextStatus === 'ACTIVE' ? 'Reactivate Admin' : 'Disable Admin' : 'Change Role';
  const pendingBusyLabel = pending?.kind === 'add' ? 'Adding…' : 'Saving…';

  if (loading && !admins.length) return <LoadingState />;
  if (error && !admins.length) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800" role="status">{message}</div>}
      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{error}</div>}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-gray-950">Platform administrators</h2>
            <p className="mt-1 text-sm text-gray-500">Separate from organization membership. This directory is read in bounded pages.</p>
          </div>
          {canManage && <button type="button" onClick={() => setShowAdd(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Add platform admin</button>}
        </div>
        {platformAdmin?.role === 'SUPPORT' && <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">SUPPORT can review this directory but cannot change platform access.</p>}
      </section>

      {!admins.length ? <EmptyState title="No platform administrators found" message="No records are available in this page." /> : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
            <table className="w-full min-w-[960px] table-fixed text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="w-[19%] px-3 py-2">Name</th><th className="w-[23%] px-3 py-2">Email</th><th className="w-[14%] px-3 py-2">Role</th><th className="w-[14%] px-3 py-2">Status</th><th className="w-[12%] px-3 py-2">Created</th><th className="w-[12%] px-3 py-2">Updated</th><th className="w-[6%] px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {admins.map((admin) => {
                  const identity = identityLabel(admin);
                  const status = admin.status || '—';
                  return <tr key={admin.uid} className="h-14 hover:bg-gray-50"><td className="px-3 py-2 font-bold"><TruncatedText value={identity} /></td><td className="px-3 py-2"><TruncatedText value={admin.email} className="text-gray-600" /></td><td className="px-3 py-2"><CompactBadge label={admin.role || '—'} tone={admin.role === 'SUPER_ADMIN' ? 'info' : 'neutral'} /></td><td className="px-3 py-2"><CompactBadge label={status} tone={status === 'ACTIVE' ? 'success' : 'danger'} /></td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatDate(admin.createdAt)}</td><td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatDate(admin.updatedAt)}</td><td className="px-3 py-2">{canManage && <CompactActionGroup><CompactIconButton label={`${status === 'ACTIVE' ? 'Disable' : 'Reactivate'} ${identity}`} onClick={() => setPending({ kind: 'status', admin, nextStatus: status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })} disabled={busy} className="text-blue-700"><Power className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label={`Change role for ${identity}`} onClick={() => setPending({ kind: 'role', admin, nextRole: admin.role === 'SUPER_ADMIN' ? 'SUPPORT' : 'SUPER_ADMIN' })} disabled={busy}><UserCog className="h-4 w-4" aria-hidden="true" /></CompactIconButton></CompactActionGroup>}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {admins.map((admin) => {
              const identity = identityLabel(admin);
              const status = admin.status || '—';
              return <article key={admin.uid} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><TruncatedText value={identity} className="font-bold" />{admin.displayName && <TruncatedText value={admin.email} className="text-xs text-gray-500" />}</div><CompactBadge label={status} tone={status === 'ACTIVE' ? 'success' : 'danger'} /></div><div className="mt-3 flex flex-wrap gap-2"><CompactBadge label={admin.role || '—'} tone={admin.role === 'SUPER_ADMIN' ? 'info' : 'neutral'} /><span className="text-xs text-gray-500">Updated {formatDate(admin.updatedAt)}</span></div>{canManage && <CompactActionGroup className="mt-4"><CompactIconButton label={`${status === 'ACTIVE' ? 'Disable' : 'Reactivate'} ${identity}`} onClick={() => setPending({ kind: 'status', admin, nextStatus: status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })} disabled={busy} className="text-blue-700"><Power className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label={`Change role for ${identity}`} onClick={() => setPending({ kind: 'role', admin, nextRole: admin.role === 'SUPER_ADMIN' ? 'SUPPORT' : 'SUPER_ADMIN' })} disabled={busy}><UserCog className="h-4 w-4" aria-hidden="true" /></CompactIconButton></CompactActionGroup>}</article>;
            })}
          </div>
        </>
      )}

      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"><span className="text-xs font-semibold text-gray-500">Page {page} · {admins.length} administrator{admins.length === 1 ? '' : 's'} shown · up to 25 per page{loading ? ' · Loading…' : ''}</span><div className="flex items-center gap-2"><CompactIconButton label="Previous platform administrators page" onClick={previous} disabled={loading || page === 1}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></CompactIconButton><CompactIconButton label="Next platform administrators page" onClick={next} disabled={loading || !nextCursor}><ChevronRight className="h-4 w-4" aria-hidden="true" /></CompactIconButton></div></div>

      {canManage && showAdd && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">Add platform admin</h2><p className="mt-1 text-sm text-gray-500">The Firebase Auth UID must belong to an existing user. It is used only for this privileged creation request.</p><input value={form.uid} onChange={(event) => setForm({ ...form, uid: event.target.value })} placeholder="Firebase Auth UID" spellCheck={false} className="mt-5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'SUPER_ADMIN' | 'SUPPORT' })} className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="SUPPORT">SUPPORT</option><option value="SUPER_ADMIN">SUPER_ADMIN</option></select><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setShowAdd(false)} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold">Cancel</button><button type="button" onClick={() => { if (!form.uid.trim()) setMessage('Firebase Auth UID is required.'); else setPending({ kind: 'add' }); }} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Add admin</button></div></div></div>}
      {canManage && pending && <ConfirmActionDialog open title={pendingTitle} description={pendingDescription} confirmLabel={pendingConfirmLabel} busyLabel={pendingBusyLabel} busy={busy} variant={pending.kind === 'status' && pending.nextStatus === 'DISABLED' ? 'danger' : 'primary'} onConfirm={confirmPending} onCancel={() => !busy && setPending(null)} />}
    </div>
  );
}
