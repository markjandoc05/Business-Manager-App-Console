'use client';

import React from 'react';
import { useConsole } from '@/lib/console-context';
import { Server, Users, KeyRound, AlertTriangle, ShieldAlert, Rocket, CheckCircle2, XCircle } from 'lucide-react';

export function DashboardModule() {
  const { customers, installations, licenses, infrastructure, deployments, activities, setActiveTab } = useConsole();

  // Calculations
  const totalCustomers = customers.length;
  const totalInstalls = installations.length;
  const activeLicenses = licenses.filter(l => l.status === 'ACTIVE').length;
  const expiringSoonLicenses = licenses.filter(l => l.status === 'EXPIRING').length;
  const expiredLicenses = licenses.filter(l => l.status === 'EXPIRED').length;
  const attentionInstalls = installations.filter(i => i.health !== 'HEALTHY').length;

  const healthCounts = {
    HEALTHY: installations.filter(i => i.health === 'HEALTHY').length,
    ATTENTION: installations.filter(i => i.health === 'ATTENTION').length,
    OFFLINE: installations.filter(i => i.health === 'OFFLINE').length,
    CRITICAL: installations.filter(i => i.health === 'CRITICAL').length,
    UNKNOWN: installations.filter(i => i.health === 'UNKNOWN').length,
  };

  const versionStatus = {
    latest: 'v2.8.4',
    current: installations.filter(i => i.deploymentStatus === 'CURRENT').length,
    updateAvailable: installations.filter(i => i.deploymentStatus === 'UPDATE_AVAILABLE').length,
    outdated: installations.filter(i => i.deploymentStatus === 'FAILED').length,
  };

  const infraAlerts = infrastructure.filter(i => i.errorRate5xx > 1 || i.activeConnections === 0);

  return (
    <div className="space-y-8">
      {/* 6 KPI Cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total Customers', value: totalCustomers, tab: 'customers', icon: Users, color: 'text-slate-900' },
          { label: 'Total Installs', value: totalInstalls, tab: 'installations', icon: Server, color: 'text-slate-900' },
          { label: 'Active Licenses', value: activeLicenses, tab: 'licenses', icon: KeyRound, color: 'text-emerald-600' },
          { label: 'Expiring Soon', value: expiringSoonLicenses, tab: 'licenses', icon: AlertTriangle, color: 'text-amber-600' },
          { label: 'Expired Licenses', value: expiredLicenses, tab: 'licenses', icon: XCircle, color: 'text-rose-600' },
          { label: 'Requires Attention', value: attentionInstalls, tab: 'installations', icon: ShieldAlert, color: 'text-rose-600' },
        ].map(card => (
          <div key={card.label} onClick={() => setActiveTab(card.tab)} className="bg-white p-4 border border-gray-200 rounded-xl cursor-pointer hover:border-blue-400 shadow-xs">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{card.label}</p>
            <h2 className={`text-4xl font-black tracking-tighter ${card.color}`}>{card.value}</h2>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Installation Health */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
          <h3 className="font-bold text-gray-800 uppercase tracking-tight mb-4">Installation Health</h3>
          <div className="grid grid-cols-5 gap-4">
            {Object.entries(healthCounts).map(([status, count]) => (
              <div key={status} onClick={() => setActiveTab('installations')} className="text-center cursor-pointer p-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-100">
                <p className="text-2xl font-black text-slate-900">{count}</p>
                <p className="text-[10px] font-bold text-gray-400 uppercase">{status}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Version Status */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
          <h3 className="font-bold text-gray-800 uppercase tracking-tight mb-4">Version Status (Latest: {versionStatus.latest})</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-gray-50">
              <p className="text-2xl font-black text-gray-600">{versionStatus.current}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Current</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-50">
              <p className="text-2xl font-black text-blue-600">{versionStatus.updateAvailable}</p>
              <p className="text-[10px] font-bold text-blue-400 uppercase">Update Available</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-rose-50">
              <p className="text-2xl font-black text-rose-600">{versionStatus.outdated}</p>
              <p className="text-[10px] font-bold text-rose-400 uppercase">Outdated/Failed</p>
            </div>
          </div>
        </section>
      </div>

      {/* Licenses Requiring Attention */}
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 uppercase tracking-tight">Licenses Requiring Attention</h3>
          <button onClick={() => setActiveTab('licenses')} className="text-xs font-bold text-blue-600 hover:underline">View All →</button>
        </div>
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            <tr>
              <th className="px-6 py-3">Customer</th>
              <th className="px-6 py-3">Installation</th>
              <th className="px-6 py-3">Expiration</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {licenses.filter(l => l.status === 'EXPIRING' || l.status === 'EXPIRED').slice(0, 5).map(lic => {
              const inst = installations.find(i => i.id === lic.installationId);
              return (
                <tr key={lic.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-bold text-gray-900">{inst?.customerName}</td>
                  <td className="px-6 py-4 font-mono text-xs">{lic.installationId}</td>
                  <td className="px-6 py-4 font-mono text-xs">{lic.expiresAt}</td>
                  <td className="px-6 py-4">
                     <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${lic.status === 'EXPIRING' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                      {lic.status}
                     </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {/* Infrastructure Alerts & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
          <div className="p-5 border-b border-gray-100"><h3 className="font-bold text-gray-800 uppercase tracking-tight">Infrastructure Alerts</h3></div>
          <div className="p-5 space-y-4">
            {infraAlerts.map(i => (
              <div key={i.installationId} className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <p className="text-xs font-bold text-rose-900">Alert: Instance {i.installationId} has issues (Error Rate: {i.errorRate5xx}%)</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between"><h3 className="font-bold text-gray-800 uppercase tracking-tight">Recent Activity</h3><button onClick={() => setActiveTab('activity')} className="text-xs font-bold text-blue-600 hover:underline">View All →</button></div>
          <div className="p-5 space-y-4">
            {activities.slice(0, 5).map(act => (
              <div key={act.id} className="flex items-center gap-3 text-xs">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <p><strong className="font-bold">{act.actor}</strong> {act.description}</p>
                <p className="text-gray-400 ml-auto font-mono">{act.timestamp}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
