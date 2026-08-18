'use client';

import React, { useState } from 'react';
import { useConsole } from '@/lib/console-context';
import { Search, Filter } from 'lucide-react';
import { ActivityRecord } from '@/lib/types';
import { ActivityDetailModal } from '../modals/ActivityDetailModal';

export function ActivityModule() {
  const { activities } = useConsole();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedActivity, setSelectedActivity] = useState<ActivityRecord | null>(null);

  const filteredActivities = activities.filter((act) => 
    act.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    act.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
    act.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    act.installationId?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-gray-950 tracking-tight">Audit Log</h2>
          <p className="text-sm text-gray-500 mt-1">Read-only history of system actions and events.</p>
        </div>
      </div>

      <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-xs flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-10 pr-4 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <th className="px-6 py-3">Date / Time</th>
              <th className="px-6 py-3">Actor</th>
              <th className="px-6 py-3">Action</th>
              <th className="px-6 py-3">Details</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {filteredActivities.map((act) => (
              <tr key={act.id} onClick={() => setSelectedActivity(act)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                <td className="px-6 py-4 font-mono text-xs text-gray-500">{act.timestamp}</td>
                <td className="px-6 py-4 font-bold text-gray-900">{act.actor}</td>
                <td className="px-6 py-4 font-mono text-xs text-blue-600">{act.action}</td>
                <td className="px-6 py-4 text-gray-600 truncate max-w-xs">{act.description}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    act.severity === 'SUCCESS' ? 'bg-emerald-100 text-emerald-800' :
                    act.severity === 'WARN' ? 'bg-amber-100 text-amber-800' :
                    act.severity === 'ERROR' ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {act.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedActivity && <ActivityDetailModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}
    </div>
  );
}
