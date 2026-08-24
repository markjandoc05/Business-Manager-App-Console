'use client';

import React from 'react';
import { licenseStatusClasses, EvaluatedLicenseStatus } from '@/lib/license';

export function StatusBadge({ status }: { status: EvaluatedLicenseStatus | string }) { return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${licenseStatusClasses(status as EvaluatedLicenseStatus)}`}>{status.replace('_', ' ')}</span>; }
export function LoadingState() { return <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading platform data…</div>; }
export function EmptyState({ title, message }: { title: string; message: string }) { return <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center"><p className="font-bold text-gray-800">{title}</p><p className="mt-1 text-sm text-gray-500">{message}</p></div>; }
export function ErrorState({ message }: { message: string }) { return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{message}</div>; }
export function formatDate(value?: string) { return value ? new Date(value).toLocaleDateString() : '—'; }
