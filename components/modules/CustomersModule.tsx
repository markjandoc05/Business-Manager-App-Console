'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Users, Search, Plus, Building2 } from 'lucide-react';
import { CustomerDetailModal } from '../modals/CustomerDetailModal';
import { NewCustomerModal } from '../modals/NewCustomerModal';
import { Customer } from '@/lib/types';

export function CustomersModule() {
  const { customers, installations } = useConsole();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const filteredCustomers = customers.filter(
    (c) =>
      (c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.orgCode.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (typeFilter === 'ALL' || c.type === typeFilter) &&
      (statusFilter === 'ALL' || c.status === statusFilter)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-950 tracking-tight">Customer Organizations</h2>
          <p className="text-sm text-gray-500 mt-1">Manage BSM client accounts and view associated deployment footprints.</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, company, or org code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-800 font-bold uppercase tracking-wider">
          <option value="ALL">All Types</option>
          <option value="Corporate">Corporate</option>
          <option value="SMB">SMB</option>
          <option value="Enterprise">Enterprise</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm text-gray-800 font-bold uppercase tracking-wider">
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="TRIAL">Trial</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="px-6 py-3">Customer / Org</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Installs</th>
              <th className="px-6 py-3">Primary Contact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {filteredCustomers.map((cust) => (
              <tr key={cust.id} onClick={() => setSelectedCustomer(cust)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-900">{cust.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{cust.orgCode}</div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    cust.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' :
                    cust.status === 'TRIAL' ? 'bg-blue-100 text-blue-800' :
                    cust.status === 'SUSPENDED' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {cust.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs font-bold text-gray-700 uppercase">{cust.type}</td>
                <td className="px-6 py-4 font-mono font-bold text-gray-900">{cust.installationsCount}</td>
                <td className="px-6 py-4 text-xs text-gray-600">{cust.primaryContactEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewCustomerModal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} />
      {selectedCustomer && <CustomerDetailModal customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />}
    </div>
  );
}
