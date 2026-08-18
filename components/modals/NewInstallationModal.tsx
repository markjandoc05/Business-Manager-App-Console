'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { X, Server, Building2, Globe, Shield, Tag } from 'lucide-react';
import { Installation } from '@/lib/types';

interface NewInstallationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewInstallationModal({ isOpen, onClose }: NewInstallationModalProps) {
  const { addInstallation, customers } = useConsole();
  const [formData, setFormData] = useState({
    customerId: '', name: '', id: '', environment: 'PRODUCTION' as const, domain: '',
    cloudProject: '', firebaseProject: '', cloudRunService: '', region: 'us-central1', appVersion: 'v2.8.4', licenseId: ''
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === formData.customerId);
    addInstallation({
      ...formData,
      customerName: customer?.name || '',
      dbStatus: 'Connected',
      storageLimitMb: 25000,
      deploymentStatus: 'CURRENT',
      health: 'UNKNOWN',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-8 shadow-2xl border border-gray-100">
        <h3 className="text-xl font-black text-gray-950 mb-6">Register New Installation</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
          <select className="col-span-2 p-3 bg-gray-50 rounded-lg text-sm" onChange={e => setFormData({...formData, customerId: e.target.value})}>
            <option value="">Select Customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="Installation Name" onChange={e => setFormData({...formData, name: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="ID (e.g. BSM-0001-001)" onChange={e => setFormData({...formData, id: e.target.value.toUpperCase()})} />
          <select className="p-3 bg-gray-50 rounded-lg text-sm" onChange={e => setFormData({...formData, environment: e.target.value as any})}>
            <option value="PRODUCTION">Production</option><option value="STAGING">Staging</option><option value="DEVELOPMENT">Development</option>
          </select>
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="Licensed Domain" onChange={e => setFormData({...formData, domain: e.target.value})} />
          <input className="col-span-2 p-3 bg-gray-50 rounded-lg text-sm" placeholder="GCP Project ID" onChange={e => setFormData({...formData, cloudProject: e.target.value})} />
          <input className="col-span-2 p-3 bg-gray-50 rounded-lg text-sm" placeholder="Firebase Project ID" onChange={e => setFormData({...formData, firebaseProject: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="Cloud Run Service" onChange={e => setFormData({...formData, cloudRunService: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="Region (e.g. us-central1)" onChange={e => setFormData({...formData, region: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="App Version (e.g. v2.8.4)" onChange={e => setFormData({...formData, appVersion: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="License ID" onChange={e => setFormData({...formData, licenseId: e.target.value})} />
          
          <div className="col-span-2 flex justify-end gap-3 mt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-900">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Register Installation</button>
          </div>
        </form>
      </div>
    </div>
  );
}
