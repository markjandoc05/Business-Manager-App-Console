'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { KeyRound, Search, AlertTriangle, ShieldCheck, XCircle, RotateCcw } from 'lucide-react';
import { LicenseDetailModal } from '../modals/LicenseDetailModal';
import { License } from '@/lib/types';

export function LicensesModule() {
  const { licenses, installations, customers } = useConsole();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);

  const filteredLicenses = licenses.filter((lic) => {
    const matchesSearch =
      lic.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lic.installationId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || lic.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-950 tracking-tight">License Management</h2>
          <p className="text-sm text-gray-500 mt-1">Orchestrate commercial access and subscription lifecycles for BSM fleet.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by License ID or Installation ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-800 font-bold uppercase tracking-wider">
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRING">Expiring</option>
          <option value="EXPIRED">Expired</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="px-6 py-3">License / ID</th>
              <th className="px-6 py-3">Customer / Installation</th>
              <th className="px-6 py-3">Expiration</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {filteredLicenses.map((lic) => {
              const inst = installations.find(i => i.id === lic.installationId);
              const cust = customers.find(c => c.id === lic.customerId);
              return (
                <tr key={lic.id} onClick={() => setSelectedLicense(lic)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                  <td className="px-6 py-4">
                    <div className="font-mono font-bold text-gray-900">{lic.id}</div>
                    <div className="text-xs text-gray-500 font-mono">{lic.licenseKeyMasked}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{cust?.name}</div>
                    <div className="text-xs text-gray-500 font-mono">{lic.installationId}</div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">{lic.expiresAt}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      lic.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' :
                      lic.status === 'EXPIRING' ? 'bg-amber-100 text-amber-800' :
                      lic.status === 'EXPIRED' ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {lic.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-blue-600 hover:underline text-xs font-bold uppercase tracking-wider">Manage</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedLicense && <LicenseDetailModal license={selectedLicense} onClose={() => setSelectedLicense(null)} />}
    </div>
  );
}
