'use client';

import React from 'react';
import { useConsole } from '@/lib/console-context';
import { Shield, UserCheck, Lock } from 'lucide-react';

export function SettingsModule() {
  const { currentDeveloper, developers, setCurrentDeveloper } = useConsole();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-black text-gray-950 tracking-tight">Developer Console Settings & Roles</h2>
        <p className="text-sm text-gray-500 mt-1">Configure security levels, role-based access control, and master registry integrations.</p>
      </div>

      {/* Role & Permissions Matrix */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-gray-900">Role-Based Access Control (RBAC)</h3>
            <p className="text-xs text-gray-500">Currently active session: <strong className="text-blue-600 font-mono">{currentDeveloper.name} ({currentDeveloper.role})</strong></p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-5 rounded-xl border ${currentDeveloper.role === 'OWNER' ? 'bg-purple-50 border-purple-200 shadow-xs' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-black text-purple-900 text-sm tracking-wide">OWNER</span>
              {currentDeveloper.role === 'OWNER' && <UserCheck className="w-4 h-4 text-purple-700" />}
            </div>
            <p className="text-xs text-gray-600 mb-3">Full system access, master billing, cryptographic license issuance, and developer user administration.</p>
            <ul className="text-[11px] text-gray-700 space-y-1 font-mono font-semibold">
              <li>✓ All Installations</li>
              <li>✓ License Revocation</li>
              <li>✓ Role Management</li>
            </ul>
          </div>

          <div className={`p-5 rounded-xl border ${currentDeveloper.role === 'DEVELOPER' ? 'bg-blue-50 border-blue-200 shadow-xs' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-black text-blue-950 text-sm tracking-wide">DEVELOPER</span>
              {currentDeveloper.role === 'DEVELOPER' && <UserCheck className="w-4 h-4 text-blue-700" />}
            </div>
            <p className="text-xs text-gray-600 mb-3">Installation provisioning, Cloud Run infrastructure monitoring, rolling deployments, and health probes.</p>
            <ul className="text-[11px] text-gray-700 space-y-1 font-mono font-semibold">
              <li>✓ Provision Instances</li>
              <li>✓ Trigger Deployments</li>
              <li>✓ Infrastructure Metrics</li>
            </ul>
          </div>

          <div className={`p-5 rounded-xl border ${currentDeveloper.role === 'SUPPORT' ? 'bg-emerald-50 border-emerald-200 shadow-xs' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-black text-emerald-950 text-sm tracking-wide">SUPPORT</span>
              {currentDeveloper.role === 'SUPPORT' && <UserCheck className="w-4 h-4 text-emerald-700" />}
            </div>
            <p className="text-xs text-gray-600 mb-3">Customer organization lookup, license status inspection, and operational metadata with restricted infrastructure controls.</p>
            <ul className="text-[11px] text-gray-700 space-y-1 font-mono font-semibold">
              <li>✓ Customer Directory</li>
              <li>✓ License Status View</li>
              <li>✗ Direct Cloud Run Op</li>
            </ul>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Switch active role for testing permissions:</span>
          <div className="flex gap-2">
            {developers.map((dev) => (
              <button
                key={dev.id}
                onClick={() => setCurrentDeveloper(dev)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider border transition-colors ${
                  currentDeveloper.id === dev.id
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {dev.role}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Security Notice */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-gray-900">Security & API Boundary</h3>
            <p className="text-xs text-gray-500">Environment security compliance and secret isolation</p>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-700 space-y-2 font-mono">
          <div>• Firebase Admin credentials & private keys are isolated to secure backend runners.</div>
          <div>• Customer PII CRM records are strictly excluded from Developer Console telemetry.</div>
          <div>• API Key authentication enforces bearer token verification via secure backend gateway.</div>
        </div>
      </div>
    </div>
  );
}
