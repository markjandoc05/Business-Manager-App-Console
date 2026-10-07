'use client';

import { useState } from 'react';
import type { OrganizationRegistrationResetMode } from '@/lib/console-api';

export function OrganizationRegistrationResetDialog({
  organizationId,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  organizationId: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (payload: { mode: OrganizationRegistrationResetMode; confirmation: string }) => void;
}) {
  const [mode, setMode] = useState<OrganizationRegistrationResetMode>('DELETE_AUTH');
  const [confirmation, setConfirmation] = useState('');
  const canConfirm = confirmation.trim() === organizationId && !busy;

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="registration-reset-title">
    <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <h2 id="registration-reset-title" className="text-xl font-black text-gray-950">Reset organization registration?</h2>
      <p className="mt-2 text-sm text-gray-600">This permanently removes the organization’s Firestore subtree and platform-owned signup links. Platform audit history is retained. It never exposes CRM records in the Console.</p>
      {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" role="alert">{error}</p>}

      <fieldset className="mt-5 space-y-3">
        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500">Reset scope</legend>
        <label className={`block cursor-pointer rounded-lg border p-4 ${mode === 'DELETE_AUTH' ? 'border-rose-300 bg-rose-50' : 'border-gray-200 bg-white'}`}>
          <input type="radio" name="registration-reset-mode" value="DELETE_AUTH" checked={mode === 'DELETE_AUTH'} onChange={() => setMode('DELETE_AUTH')} disabled={busy} className="sr-only" />
          <span className="block text-sm font-bold text-gray-950">Full test reset — free eligible email registrations</span>
          <span className="mt-1 block text-xs leading-5 text-gray-700">Deletes member Firebase Auth accounts and their platform user profiles only when each account belongs only to this organization and is not a platform administrator. This is the option for a genuinely fresh test registration.</span>
        </label>
        <label className={`block cursor-pointer rounded-lg border p-4 ${mode === 'KEEP_AUTH' ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>
          <input type="radio" name="registration-reset-mode" value="KEEP_AUTH" checked={mode === 'KEEP_AUTH'} onChange={() => setMode('KEEP_AUTH')} disabled={busy} className="sr-only" />
          <span className="block text-sm font-bold text-gray-950">Remove organization only</span>
          <span className="mt-1 block text-xs leading-5 text-gray-700">Keeps Firebase Auth accounts and platform user profiles. The same signed-in identity can create a new workspace, but its email is not freed for a brand-new Firebase account.</span>
        </label>
      </fieldset>

      <label className="mt-5 block text-sm font-bold text-gray-800">Type this organization ID to confirm
        <code className="mt-2 block break-all rounded bg-gray-100 px-3 py-2 text-xs font-normal text-gray-700">{organizationId}</code>
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} className="mt-2 block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm text-gray-950 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:bg-gray-100" aria-describedby="registration-reset-help" />
      </label>
      <p id="registration-reset-help" className="mt-2 text-xs leading-5 text-gray-500">This action is limited to SUPER_ADMIN. Accounts with another organization membership or platform-admin access are rejected rather than deleted.</p>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={() => onConfirm({ mode, confirmation: confirmation.trim() })} disabled={!canConfirm} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Resetting…' : 'Permanently reset organization'}</button>
      </div>
    </div>
  </div>;
}
