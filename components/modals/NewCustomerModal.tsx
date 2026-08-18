'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { X, Building2 } from 'lucide-react';

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewCustomerModal({ isOpen, onClose }: NewCustomerModalProps) {
  const { addCustomer } = useConsole();
  const [formData, setFormData] = useState({
    name: '', company: '', orgCode: '', type: 'Corporate' as const, status: 'ACTIVE' as const,
    plan: 'Enterprise' as const, primaryContactEmail: '', phone: '', website: '', address: '', country: '', internalNotes: ''
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addCustomer(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-8 shadow-2xl border border-gray-100">
        <h3 className="text-xl font-black text-gray-950 mb-6">Register New Customer</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
          <input className="col-span-2 p-3 bg-gray-50 rounded-lg text-sm" placeholder="Business Name" onChange={e => setFormData({...formData, name: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="Company Name" onChange={e => setFormData({...formData, company: e.target.value})} />
          <input className="p-3 bg-gray-50 rounded-lg text-sm" placeholder="Org Code (e.g. CUST-0001)" onChange={e => setFormData({...formData, orgCode: e.target.value.toUpperCase()})} />
          <select className="p-3 bg-gray-50 rounded-lg text-sm" onChange={e => setFormData({...formData, type: e.target.value as any})}>
            <option value="Corporate">Corporate</option><option value="SMB">SMB</option><option value="Enterprise">Enterprise</option>
          </select>
          <select className="p-3 bg-gray-50 rounded-lg text-sm" onChange={e => setFormData({...formData, status: e.target.value as any})}>
            <option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="SUSPENDED">Suspended</option>
          </select>
          <input className="col-span-2 p-3 bg-gray-50 rounded-lg text-sm" placeholder="Email" type="email" onChange={e => setFormData({...formData, primaryContactEmail: e.target.value})} />
          <textarea className="col-span-2 p-3 bg-gray-50 rounded-lg text-sm" placeholder="Internal Notes" onChange={e => setFormData({...formData, internalNotes: e.target.value})} />
          <div className="col-span-2 flex justify-end gap-3 mt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-900">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Register Customer</button>
          </div>
        </form>
      </div>
    </div>
  );
}
