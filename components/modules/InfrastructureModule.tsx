'use client';

import React from 'react';
import { useConsole } from '@/lib/console-context';

export function InfrastructureModule() {
  const { infrastructure, installations } = useConsole();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-gray-950 tracking-tight">Infrastructure & Cloud Run Fleet</h2>
        <p className="text-sm text-gray-500 mt-1">Real-time resource allocation, Cloud Run container metrics, and Firestore clusters.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {infrastructure.map((infra) => {
          const inst = installations.find((i) => i.id === infra.installationId);
          return (
            <div key={infra.installationId} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 shadow-xs hover:border-blue-400 transition-all">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-blue-600">{infra.installationId}</span>
                <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                  infra.cloudRunStatus === 'Ready' ? 'bg-emerald-100 text-emerald-800' :
                  infra.cloudRunStatus === 'Scaling' ? 'bg-blue-100 text-blue-800' :
                  infra.cloudRunStatus === 'Updating' ? 'bg-indigo-100 text-indigo-800' :
                  'bg-rose-100 text-rose-800'
                }`}>
                  {infra.cloudRunStatus}
                </span>
              </div>

              <div>
                <h4 className="font-bold text-gray-900 text-sm">{inst?.customerName || 'Customer Instance'}</h4>
                <p className="text-xs font-mono text-gray-400">{inst?.cloudRunService} ({infra.firestoreRegion})</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100 text-xs">
                <div>
                  <span className="text-gray-400 uppercase tracking-widest text-[10px] font-bold block">CPU & Memory</span>
                  <strong className="text-gray-900 font-mono font-semibold">{infra.cpuAllocation} / {infra.memoryMb}MB</strong>
                </div>
                <div>
                  <span className="text-gray-400 uppercase tracking-widest text-[10px] font-bold block">Active Sockets</span>
                  <strong className="text-emerald-600 font-mono font-semibold">{infra.activeConnections} active</strong>
                </div>
                <div>
                  <span className="text-gray-400 uppercase tracking-widest text-[10px] font-bold block">5xx Error Rate</span>
                  <strong className={`font-mono font-semibold ${infra.errorRate5xx > 1 ? 'text-rose-600' : 'text-gray-900'}`}>
                    {infra.errorRate5xx}%
                  </strong>
                </div>
                <div>
                  <span className="text-gray-400 uppercase tracking-widest text-[10px] font-bold block">p95 Latency</span>
                  <strong className="text-gray-900 font-mono font-semibold">{infra.averageLatencyMs} ms</strong>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500 font-mono">
                <span>Instances: {infra.minInstances}-{infra.maxInstances}</span>
                <span>Storage: {infra.storageUsedGb} GB</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
