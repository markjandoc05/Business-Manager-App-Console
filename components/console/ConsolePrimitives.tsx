'use client';

import React from 'react';
import { licenseStatusClasses, EvaluatedLicenseStatus } from '@/lib/license';

export function StatusBadge({ status }: { status: EvaluatedLicenseStatus | string }) { return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${licenseStatusClasses(status as EvaluatedLicenseStatus)}`}>{status.replace('_', ' ')}</span>; }
export function LoadingState() { return <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading platform data…</div>; }
export function EmptyState({ title, message }: { title: string; message: string }) { return <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center"><p className="font-bold text-gray-800">{title}</p><p className="mt-1 text-sm text-gray-500">{message}</p></div>; }
export function ErrorState({ message }: { message: string }) { return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{message}</div>; }
export function CompactIconButton({ label, children, className = '', type = 'button', ...props }: { label: string; children: React.ReactNode; className?: string; type?: 'button' | 'submit' | 'reset' } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'type' | 'children' | 'className'>) {
  return <button {...props} type={type} aria-label={label} title={label} className={`group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}<span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-[100] mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-semibold normal-case tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label}</span></button>;
}
export function CompactActionGroup({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <div className={`flex items-center gap-1.5 ${className}`}>{children}</div>; }
export function ConfirmActionDialog({ open, title, description, confirmLabel, busyLabel = 'Saving…', busy, variant = 'primary', onConfirm, onCancel }: { open: boolean; title: string; description: React.ReactNode; confirmLabel: string; busyLabel?: string; busy: boolean; variant?: 'primary' | 'danger'; onConfirm: () => void | Promise<void>; onCancel: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-gray-950">{title}</h2><div className="mt-3 text-sm text-gray-600">{description}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button><button type="button" onClick={() => void onConfirm()} disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${variant === 'danger' ? 'bg-rose-700' : 'bg-blue-700'}`}>{busy ? busyLabel : confirmLabel}</button></div></div></div>;
}
export function CompactBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  const classes = { neutral: 'border-gray-200 bg-gray-50 text-gray-700', success: 'border-emerald-200 bg-emerald-50 text-emerald-700', warning: 'border-amber-200 bg-amber-50 text-amber-800', danger: 'border-rose-200 bg-rose-50 text-rose-700', info: 'border-blue-200 bg-blue-50 text-blue-700' };
  return <span className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${classes[tone]}`} title={label}>{label}</span>;
}
export function TruncatedText({ value, className = '' }: { value?: React.ReactNode; className?: string }) { const label = value === undefined || value === null || value === '' ? '—' : String(value); return <span className={`block min-w-0 truncate ${className}`} title={label}>{label}</span>; }
export function formatDate(value?: string) { return value ? new Date(value).toLocaleDateString() : '—'; }
export function formatDateInTimeZone(value?: string, timezone?: string | null) {
  if (!value) return '—';
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: timezone || 'UTC' }).format(new Date(value)); } catch { return formatDate(value); }
}
