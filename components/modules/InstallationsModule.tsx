'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Search, Plus, Server } from 'lucide-react';
import { NewInstallationModal } from '../modals/NewInstallationModal';
import { InstallationDetailModal } from '../modals/InstallationDetailModal';
import { Installation } from '@/lib/types';

export function InstallationsModule() {
  const { installations } = useConsole();
  const [searchTerm, setSearchTerm] = useState('');
  const [envFilter, setEnvFilter] = useState('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedInstallation, setSelectedInstallation] = useState<Installation | null>(null);

  const filteredInstallations = installations.filter(
    (i) =>
      (i.name.toLowerCase().includes(searchTerm.toLowerCase()) || i.id.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (envFilter === 'ALL' || i.environment === envFilter)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-950 tracking-tight">Installations</h2>
          <p className="text-sm text-gray-500 mt-1">Manage BSM application deployments and infrastructure.</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Register Installation
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, ID, or domain..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>
        <select value={envFilter} onChange={(e) => setEnvFilter(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-800 font-bold uppercase tracking-wider">
          <option value="ALL">All Envs</option>
          <option value="PRODUCTION">Production</option>
          <option value="STAGING">Staging</option>
          <option value="DEVELOPMENT">Development</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="px-6 py-3">Installation / ID</th>
              <th className="px-6 py-3">Environment</th>
              <th className="px-6 py-3">Health</th>
              <th className="px-6 py-3">Version</th>
              <th className="px-6 py-3">Last Heartbeat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {filteredInstallations.map((inst) => (
              <tr key={inst.id} onClick={() => setSelectedInstallation(inst)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-900">{inst.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{inst.id}</div>
                </td>
                <td className="px-6 py-4 font-bold text-gray-700 uppercase text-xs">{inst.environment}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    inst.health === 'HEALTHY' ? 'bg-emerald-100 text-emerald-800' :
                    inst.health === 'CRITICAL' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {inst.health}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs">{inst.appVersion}</td>
                <td className="px-6 py-4 text-xs text-gray-600">{inst.lastHeartbeat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewInstallationModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
      {selectedInstallation && <InstallationDetailModal installation={selectedInstallation} onClose={() => setSelectedInstallation(null)} />}
    </div>
  );
}
