'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Customer } from '@/lib/types';
import { X, Building2, User, Mail, Globe, MapPin, Phone, MessageSquare, Server, KeyRound, Activity } from 'lucide-react';

interface Props {
  customer: Customer;
  onClose: () => void;
}

export function CustomerDetailModal({ customer, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'installations' | 'licenses' | 'domains' | 'notes' | 'activity'>('overview');
  const { installations, licenses, activities } = useConsole();
  
  const custInstallations = installations.filter(i => i.customerId === customer.id);
  const custLicenses = licenses.filter(l => l.customerId === customer.id);
  const custActivities = activities.filter(a => a.customerName === customer.name);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-gray-950 tracking-tight">{customer.name}</h2>
            <p className="text-xs font-mono text-blue-600 font-bold">{customer.id} • {customer.orgCode}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex border-b border-gray-100">
          {['overview', 'installations', 'licenses', 'domains', 'notes', 'activity'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-6 py-3 text-xs font-bold uppercase tracking-wider ${activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="font-bold text-gray-900 flex items-center gap-2"><Building2 className="w-4 h-4" /> Company Details</h4>
                <p className="text-sm"><strong>Business:</strong> {customer.company}</p>
                <p className="text-sm"><strong>Type:</strong> {customer.type}</p>
                <p className="text-sm"><strong>Status:</strong> {customer.status}</p>
                <p className="text-sm"><strong>Country:</strong> {customer.country}</p>
              </div>
              <div className="space-y-4">
                <h4 className="font-bold text-gray-900 flex items-center gap-2"><User className="w-4 h-4" /> Contact</h4>
                <p className="text-sm flex items-center gap-2"><Mail className="w-4 h-4" /> {customer.primaryContactEmail}</p>
                <p className="text-sm flex items-center gap-2"><Phone className="w-4 h-4" /> {customer.phone}</p>
                <p className="text-sm flex items-center gap-2"><Globe className="w-4 h-4" /> <a href={customer.website} target="_blank" className="text-blue-600 hover:underline">{customer.website}</a></p>
                <p className="text-sm flex items-start gap-2"><MapPin className="w-4 h-4 mt-0.5" /> {customer.address}</p>
              </div>
            </div>
          )}
          {activeTab === 'installations' && (
            <table className="w-full text-sm">
              <thead className="text-[10px] text-gray-400 uppercase font-bold">
                <tr><th className="pb-3 text-left">ID</th><th className="pb-3">Region</th><th className="pb-3">Health</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {custInstallations.map(i => <tr key={i.id}><td className="py-3 font-mono">{i.id}</td><td className="py-3 text-center">{i.region}</td><td className="py-3 text-center">{i.health}</td></tr>)}
              </tbody>
            </table>
          )}
           {activeTab === 'notes' && (
            <div className="bg-gray-50 p-4 rounded-xl text-sm italic text-gray-700">{customer.internalNotes}</div>
           )}
           {/* Licenses, Domains, Activity would follow similar patterns */}
        </div>
      </div>
    </div>
  );
}
