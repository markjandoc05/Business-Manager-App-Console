'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPlatformAdmin, getPlatformAdmins, updatePlatformAdmin } from '@/lib/console-api';
import { useAuth } from '@/lib/auth-context';
import { formatDate, ErrorState, LoadingState, EmptyState } from './ConsolePrimitives';

type AdminRecord = { uid: string; email?: string; displayName?: string; role?: string; status?: string; createdAt?: string; updatedAt?: string };

export function PlatformAdminsModule() {
  const { platformAdmin } = useAuth();
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<{ uid: string; role: string }>({ uid: '', role: 'SUPPORT' });
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = platformAdmin?.role === 'SUPER_ADMIN';
  const load = useCallback(async () => { setLoading(true); try { setAdmins((await getPlatformAdmins()) as AdminRecord[]); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load platform administrators.'); } finally { setLoading(false); } }, []);
  // Data loading is an external synchronization; the state updates are intentional here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const add = async () => { if (!form.uid.trim()) return setMessage('Firebase Auth UID is required.'); setBusy(true); try { await createPlatformAdmin(form); setMessage('Platform administrator added.'); setShowAdd(false); setForm({ uid: '', role: 'SUPPORT' }); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to add platform administrator.'); } finally { setBusy(false); } };
  const update = async (admin: AdminRecord, patch: { role?: string; status?: string }) => { setBusy(true); try { await updatePlatformAdmin(admin.uid, patch); setMessage('Platform administrator updated.'); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to update platform administrator.'); } finally { setBusy(false); } };
  if (loading) return <LoadingState />; if (error) return <ErrorState message={error} />;
  return <div className="space-y-4">{message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">{message}</div>}{canManage && <button onClick={() => setShowAdd(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Add Platform Admin</button>}{!admins.length ? <EmptyState title="No platform administrators found" message="Bootstrap the first SUPER_ADMIN using the documented server-side procedure." /> : <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white"><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500"><tr><th className="px-5 py-3">Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Updated</th><th>Actions</th></tr></thead><tbody className="divide-y divide-gray-100">{admins.map((admin) => <tr key={admin.uid}><td className="px-5 py-4 font-bold">{admin.displayName || '—'}</td><td>{admin.email || '—'}</td><td>{admin.role || '—'}</td><td>{admin.status || '—'}</td><td>{formatDate(admin.createdAt)}</td><td>{formatDate(admin.updatedAt)}</td><td>{canManage && <div className="flex gap-2"><button disabled={busy} onClick={() => void update(admin, { status: admin.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })} className="text-xs font-bold text-blue-600 disabled:opacity-50">{admin.status === 'ACTIVE' ? 'Disable' : 'Reactivate'}</button><button disabled={busy} onClick={() => void update(admin, { role: admin.role === 'SUPER_ADMIN' ? 'SUPPORT' : 'SUPER_ADMIN' })} className="text-xs font-bold text-gray-600 disabled:opacity-50">Change role</button></div>}</td></tr>)}</tbody></table></div>}{showAdd && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black">Add platform admin</h2><p className="mt-1 text-sm text-gray-500">The UID must belong to an existing Firebase Authentication user.</p><input value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })} placeholder="Firebase Auth UID" className="mt-5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" /><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="SUPPORT">SUPPORT</option><option value="SUPER_ADMIN">SUPER_ADMIN</option></select><div className="mt-5 flex justify-end gap-3"><button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold">Cancel</button><button onClick={() => void add()} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">{busy ? 'Saving…' : 'Add admin'}</button></div></div></div>}</div>;
}
