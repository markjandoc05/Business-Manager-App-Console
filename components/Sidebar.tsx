'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useConsole } from '@/lib/console-context';
import {
  LayoutDashboard,
  Users,
  Server,
  KeyRound,
  HardDrive,
  Rocket,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { DeveloperRole } from '@/lib/types';

export function Sidebar() {
  const { activeTab, setActiveTab, currentDeveloper, setCurrentDeveloper, developers } = useConsole();
  const [collapsed, setCollapsed] = useState(false);
  const [showRoleSelector, setShowRoleSelector] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'installations', label: 'Installations', icon: Server },
    { id: 'licenses', label: 'Licenses', icon: KeyRound },
    { id: 'infrastructure', label: 'Infrastructure', icon: HardDrive },
    { id: 'deployments', label: 'Deployments', icon: Rocket },
    { id: 'activity', label: 'Activity Logs', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const roleColors: Record<DeveloperRole, string> = {
    OWNER: 'text-blue-500',
    DEVELOPER: 'text-sky-400',
    SUPPORT: 'text-emerald-400',
  };

  return (
    <aside
      className={`relative bg-slate-950 text-slate-400 flex flex-col border-r border-slate-800 transition-all duration-300 z-20 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800/80 justify-between">
        {!collapsed && (
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-black text-xl shadow-md shrink-0">
              B
            </div>
            <span className="text-white font-bold tracking-tight text-lg truncate">BSM CONSOLE</span>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-black text-xl shadow-md">
              B
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full p-1 border border-slate-700 shadow-md transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors group relative ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'hover:bg-slate-900 hover:text-white text-slate-400'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-blue-500' : 'text-slate-400 group-hover:text-white'}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-slate-900 text-slate-200 text-xs rounded shadow-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-150 transition-opacity z-50">
                  {item.label}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom User Profile & Role Switcher */}
      <div className="p-4 border-t border-slate-800 relative bg-slate-950">
        {showRoleSelector && !collapsed && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl z-50 space-y-1">
            <div className="text-[10px] uppercase font-semibold text-slate-400 px-2 py-1">Switch Role</div>
            {developers.map((dev) => (
              <button
                key={dev.id}
                onClick={() => {
                  setCurrentDeveloper(dev);
                  setShowRoleSelector(false);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                  currentDeveloper.id === dev.id ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div>
                  <div className="font-semibold">{dev.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{dev.role}</div>
                </div>
                {currentDeveloper.id === dev.id && <UserCheck className="w-4 h-4 text-blue-400" />}
              </button>
            ))}
          </div>
        )}

        {!collapsed ? (
          <div>
            <div
              onClick={() => setShowRoleSelector(!showRoleSelector)}
              className="flex items-center gap-3 mb-4 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold uppercase shrink-0 border border-slate-700">
                {currentDeveloper.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{currentDeveloper.name}</p>
                <p className={`text-[10px] uppercase tracking-wider font-bold ${roleColors[currentDeveloper.role]}`}>
                  {currentDeveloper.role} (Change)
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('settings')}
              className="w-full text-left text-xs font-medium hover:text-white py-1 transition-colors"
            >
              Account Settings
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <div
              className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold uppercase cursor-pointer border border-slate-700"
              onClick={() => setShowRoleSelector(!showRoleSelector)}
              title={`${currentDeveloper.name} (${currentDeveloper.role})`}
            >
              {currentDeveloper.name.split(' ').map((n) => n[0]).join('')}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
