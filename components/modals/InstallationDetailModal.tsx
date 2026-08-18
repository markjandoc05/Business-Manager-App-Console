'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Installation } from '@/lib/types';
import { X, Server, Building2, Globe, Shield, Tag, Activity, Database, Clock } from 'lucide-react';

interface Props {
  installation: Installation;
  onClose: () => void;
}

export function InstallationDetailModal({ installation, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'infrastructure' | 'usage' | 'license' | 'deployments' | 'configuration' | 'activity'>('overview');
  const { licenses, deployments, activities } = useConsole();
  
  const license = licenses.find(l => l.id === installation.licenseId);
  const instDeployments = deployments.filter(d => d.installationId === installation.id);
  const instActivities = activities.filter(a => a.installationId === installation.id);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-gray-950 tracking-tight">{installation.name}</h2>
            <p className="text-xs font-mono text-blue-600 font-bold">{installation.id} • {installation.environment}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex border-b border-gray-100 overflow-x-auto">
          {['overview', 'infrastructure', 'usage', 'license', 'deployments', 'configuration', 'activity'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-4 py-3 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 gap-6 text-sm">
              <p><strong>Customer:</strong> {installation.customerName}</p>
              <p><strong>Domain:</strong> {installation.domain}</p>
              <p><strong>Version:</strong> {installation.appVersion}</p>
              <p><strong>Health:</strong> {installation.health}</p>
              <p><strong>Last Heartbeat:</strong> {installation.lastHeartbeat}</p>
              <p><strong>Created:</strong> {installation.createdAt}</p>
            </div>
          )}
          {activeTab === 'usage' && (
             <div className="grid grid-cols-3 gap-4">
               <div className="p-4 bg-gray-50 rounded-lg"><p className="text-xs text-gray-500">Users</p><p className="font-bold">{installation.activeUsersNow}</p></div>
               <div className="p-4 bg-gray-50 rounded-lg"><p className="text-xs text-gray-500">Leads</p><p className="font-bold">{installation.totalLeadsCount}</p></div>
               <div className="p-4 bg-gray-50 rounded-lg"><p className="text-xs text-gray-500">Storage</p><p className="font-bold">{installation.storageUsedMb} MB</p></div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
