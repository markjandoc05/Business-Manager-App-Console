'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Search, Plus, Server, GitBranch, RefreshCw, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { Installation, DeploymentRecord, Release } from '@/lib/types';

export function DeploymentsModule() {
  const { installations, deployments, releases, triggerDeployment, addRelease } = useConsole();
  const [searchTerm, setSearchTerm] = useState('');
  
  const latestStable = releases.filter(r => r.releaseStatus === 'STABLE').sort((a, b) => b.version.localeCompare(a.version))[0];

  const versionDistribution = installations.reduce((acc, inst) => {
    acc[inst.appVersion] = (acc[inst.appVersion] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredInstallations = installations.filter(
    (i) =>
      i.name.toLowerCase().includes(searchTerm.toLowerCase()) || i.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Master Version Section */}
      <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-950 tracking-tight">Business Sales Manager</h2>
          <p className="text-sm text-gray-500">Latest Stable Version: <span className="font-bold text-gray-900">{latestStable?.version}</span> ({latestStable?.releaseDate})</p>
        </div>
        <div className="px-4 py-2 bg-emerald-100 text-emerald-800 rounded-lg text-xs font-bold uppercase tracking-wider">{latestStable?.releaseStatus}</div>
      </section>

      {/* Installation List */}
      <section className="space-y-4">
        <h3 className="text-lg font-bold text-gray-950">Installations</h3>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                <th className="px-6 py-3">Customer / Installation</th>
                <th className="px-6 py-3">Version</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Last Deployment</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {filteredInstallations.map((inst) => (
                <tr key={inst.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{inst.customerName}</div>
                    <div className="text-xs text-gray-500 font-mono">{inst.name}</div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">{inst.appVersion}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      inst.deploymentStatus === 'CURRENT' ? 'bg-emerald-100 text-emerald-800' :
                      inst.deploymentStatus === 'UPDATE_AVAILABLE' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                    }`}>
                      {inst.deploymentStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-600">N/A</td>
                  <td className="px-6 py-4 text-right">
                    {inst.deploymentStatus === 'UPDATE_AVAILABLE' && (
                        <button onClick={() => triggerDeployment(inst.id, latestStable?.version || 'v0.0.0')} className="text-blue-600 font-bold uppercase tracking-wider text-xs hover:underline">Deploy</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
