'use client';

import React from 'react';
import { ActivityRecord } from '@/lib/types';
import { X, Clock, User, Tag, AlertTriangle, Info } from 'lucide-react';

interface Props {
  activity: ActivityRecord;
  onClose: () => void;
}

export function ActivityDetailModal({ activity, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-black text-gray-950 tracking-tight">Activity Details</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-gray-500 font-bold uppercase text-[10px]">Timestamp</p><p className="font-mono text-xs">{activity.timestamp}</p></div>
            <div><p className="text-gray-500 font-bold uppercase text-[10px]">Actor</p><p className="text-gray-900 font-bold">{activity.actor}</p></div>
            <div><p className="text-gray-500 font-bold uppercase text-[10px]">Action</p><p className="text-blue-600 font-bold font-mono text-xs">{activity.action}</p></div>
            <div><p className="text-gray-500 font-bold uppercase text-[10px]">Category</p><p className="text-gray-900 font-bold">{activity.type}</p></div>
            {activity.customerName && <div><p className="text-gray-500 font-bold uppercase text-[10px]">Customer</p><p className="text-gray-900">{activity.customerName}</p></div>}
            {activity.installationId && <div><p className="text-gray-500 font-bold uppercase text-[10px]">Installation</p><p className="text-gray-900 font-mono">{activity.installationId}</p></div>}
          </div>
          <div>
            <p className="text-gray-500 font-bold uppercase text-[10px]">Description</p>
            <p className="text-gray-800 bg-gray-50 p-3 rounded-lg mt-1">{activity.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
