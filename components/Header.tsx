'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Search, Plus, Shield, Server } from 'lucide-react';
import { NewCustomerModal } from './modals/NewCustomerModal';
import { NewInstallationModal } from './modals/NewInstallationModal';

export function Header() {
  const { installations, licenses, activeTab } = useConsole();
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [installationModalOpen, setInstallationModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const healthyCount = installations.filter((i) => i.health === 'HEALTHY').length;
  const criticalCount = installations.filter((i) => i.health === 'CRITICAL' || i.health === 'ATTENTION').length;

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 px-8 flex items-center justify-between z-10 sticky top-0 shadow-xs">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400 font-medium">Console</span>
          <span className="text-gray-300">/</span>
          <span className="font-bold text-gray-800 uppercase tracking-tight">{activeTab}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {healthyCount}/{installations.length} Systems Healthy
            </div>
            {criticalCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1 bg-rose-50 text-rose-700 rounded-full border border-rose-100 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                {criticalCount} Attention Required
              </div>
            )}
            <div className="text-gray-500 px-3 py-1 border border-gray-200 rounded-full text-xs font-mono font-medium">
              v2.8.4-prod
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCustomerModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold transition-colors border border-gray-200"
            >
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              New Customer
            </button>

            <button
              onClick={() => setInstallationModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <Server className="w-3.5 h-3.5" />
              Provision Instance
            </button>
          </div>
        </div>
      </header>

      <NewCustomerModal isOpen={customerModalOpen} onClose={() => setCustomerModalOpen(false)} />
      <NewInstallationModal isOpen={installationModalOpen} onClose={() => setInstallationModalOpen(false)} />
    </>
  );
}
