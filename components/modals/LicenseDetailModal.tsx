'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { License } from '@/lib/types';
import { X, KeyRound, ShieldCheck, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';

interface Props {
  license: License;
  onClose: () => void;
}

export function LicenseDetailModal({ license, onClose }: Props) {
  const { customers, installations, updateLicenseStatus } = useConsole();
  const inst = installations.find(i => i.id === license.installationId);
  const cust = customers.find(c => c.id === license.customerId);

  const [showRenew, setShowRenew] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-gray-950 tracking-tight">License Details</h2>
            <p className="text-xs font-mono text-blue-600 font-bold">{license.id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><strong>Customer:</strong> {cust?.name}</p>
            <p><strong>Installation:</strong> {license.installationId}</p>
            <p><strong>Status:</strong> <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${license.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100'}`}>{license.status}</span></p>
            <p><strong>Expires:</strong> {license.expiresAt}</p>
          </div>

          {!showRenew ? (
            <div className="flex gap-3 pt-6 border-t border-gray-100">
               {license.status !== 'ACTIVE' && <button onClick={() => updateLicenseStatus(license.id, 'ACTIVE')} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase">Activate</button>}
               {license.status === 'ACTIVE' && <button onClick={() => updateLicenseStatus(license.id, 'SUSPENDED')} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold uppercase">Suspend</button>}
               <button onClick={() => setShowRenew(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold uppercase">Renew</button>
            </div>
          ) : (
            <div className="p-4 bg-gray-50 rounded-xl space-y-4">
              <h4 className="font-bold text-sm">Renew License</h4>
              <select className="w-full p-2 rounded border text-sm">
                <option>1 Month</option><option>1 Year</option>
              </select>
              <textarea className="w-full p-2 rounded border text-sm" placeholder="Internal Note"></textarea>
              <div className="flex gap-2">
                <button onClick={() => setShowRenew(false)} className="px-4 py-2 bg-gray-200 rounded text-xs font-bold uppercase">Cancel</button>
                <button onClick={() => { /* add logic */ setShowRenew(false)}} className="px-4 py-2 bg-blue-600 text-white rounded text-xs font-bold uppercase">Confirm Renewal</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
