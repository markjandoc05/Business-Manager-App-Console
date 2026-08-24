'use client';

import React, { useEffect, useState } from 'react';
import { evaluateOrganizationLicense } from '@/lib/license';
import { DashboardMetrics, getAuditLogs, getDashboardMetrics, getOrganizations } from '@/lib/console-api';
import { Organization } from '@/lib/types';
import { EmptyState, LoadingState, StatusBadge } from './ConsolePrimitives';

type RecentLog = { action?: string; actorEmail?: string };

export function DashboardModule() {
  const [items, setItems] = useState<Organization[]>([]);
  const [logs, setLogs] = useState<RecentLog[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    Promise.allSettled([
      getOrganizations(),
      getDashboardMetrics(),
      getAuditLogs(),
    ]).then(([organizationsResult, metricsResult, activityResult]) => {
      if (organizationsResult.status === 'fulfilled') setItems(organizationsResult.value);
      else setOrganizationsError(organizationsResult.reason instanceof Error ? organizationsResult.reason.message : 'Unable to load organizations.');
      if (metricsResult.status === 'fulfilled') setMetrics(metricsResult.value);
      else setMetricsError(metricsResult.reason instanceof Error ? metricsResult.reason.message : 'Unable to load dashboard metrics.');
      if (activityResult.status === 'fulfilled') setLogs(activityResult.value.items.slice(0, 5) as RecentLog[]);
      else setActivityError(activityResult.reason instanceof Error ? activityResult.reason.message : 'Unable to load recent activity.');
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  const evaluations = items.map((organization) => evaluateOrganizationLicense(organization, new Date(now)));
  const cards: Array<[string, number | null]> = metrics ? [
    ['Total Organizations', metrics.totalOrganizations], ['Active Organizations', metrics.activeOrganizations],
    ['Trial Organizations', metrics.trialOrganizations], ['Expired Organizations', metrics.expiredOrganizations],
    ['Suspended Organizations', metrics.suspendedOrganizations], ['Active Memberships', metrics.activeMemberships],
    ['Trials Ending Soon', metrics.trialsEndingSoon], ['Licenses Expiring Soon', metrics.licensesExpiringSoon],
  ] : [
    ['Total Organizations', null], ['Active Organizations', null], ['Trial Organizations', null], ['Expired Organizations', null],
    ['Suspended Organizations', null], ['Active Memberships', null], ['Trials Ending Soon', null], ['Licenses Expiring Soon', null],
  ];

  return <div className="space-y-6">
    {metricsError && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Dashboard metrics unavailable: {metricsError}</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-gray-200 bg-white p-5"><p className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</p><p className="mt-3 text-3xl font-black text-gray-950">{value === null ? '—' : value}</p></div>)}</div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black text-gray-950">License distribution</h2>{organizationsError ? <p className="mt-4 text-sm text-amber-700">Organization data unavailable: {organizationsError}</p> : !evaluations.length ? <div className="mt-4"><EmptyState title="No organizations yet" message="Organization metadata will appear here when the Client App creates workspaces." /></div> : <div className="mt-5 flex flex-wrap gap-2">{evaluations.map((evaluation, index) => <StatusBadge key={`${evaluation.status}-${index}`} status={evaluation.status} />)}</div>}</div>
      <div className="rounded-xl border border-gray-200 bg-white p-6"><h2 className="font-black text-gray-950">Recent platform activity</h2>{activityError ? <p className="mt-4 text-sm text-amber-700">Recent activity unavailable: {activityError}</p> : !logs.length ? <p className="mt-4 text-sm text-gray-500">No administrative activity recorded.</p> : <ul className="mt-4 space-y-3">{logs.map((log, index) => <li key={index} className="border-b border-gray-100 pb-3 text-sm"><p className="font-bold">{log.action || 'Administrative action'}</p><p className="text-xs text-gray-500">{log.actorEmail || 'Platform administrator'}</p></li>)}</ul>}</div>
    </div>
  </div>;
}
