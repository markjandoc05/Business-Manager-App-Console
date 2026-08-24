'use client';

import React, { ReactNode, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, ClipboardList, LayoutDashboard, Menu, Shield, Users, X, CreditCard, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

const navigation = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/organizations', label: 'Organizations', icon: Building2 },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/licensing', label: 'Licensing', icon: CreditCard },
  { href: '/audit-logs', label: 'Audit Logs', icon: ClipboardList },
  { href: '/platform-admins', label: 'Platform Admins', icon: Shield },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { platformAdmin, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const go = (href: string) => { setMobileOpen(false); router.push(href); };
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 lg:flex">
      <button className="fixed left-4 top-4 z-40 rounded-lg bg-slate-950 p-2 text-white lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-slate-950 text-slate-300 transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center justify-between border-b border-slate-800 px-6">
          <button onClick={() => go('/')} className="flex items-center gap-3 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-xl font-black text-white">B</span><span><span className="block font-black tracking-tight text-white">BSM CONSOLE</span><span className="block text-[10px] uppercase tracking-widest text-slate-500">Platform operations</span></span></button>
          <button className="text-slate-400 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-1 px-4 py-6">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return <button key={href} onClick={() => go(href)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</button>;
          })}
        </nav>
        <div className="border-t border-slate-800 p-5">
          <div className="mb-3 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">{platformAdmin?.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><div className="min-w-0"><p className="truncate text-xs font-bold text-white">{platformAdmin?.displayName}</p><p className="truncate text-[10px] uppercase tracking-wider text-blue-400">{platformAdmin?.role}</p></div></div>
          <button onClick={() => void signOut()} className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 pt-16 lg:pt-0">{children}</main>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="border-b border-gray-200 bg-white px-6 py-6 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-black tracking-tight text-gray-950">{title}</h1><p className="mt-1 text-sm text-gray-500">{description}</p></div>{action}</div></header>;
}

export function ConsolePage({ title, description, children, action }: { title: string; description: string; children: ReactNode; action?: ReactNode }) {
  return <><PageHeader title={title} description={description} action={action} /><div className="mx-auto max-w-7xl p-6 lg:p-10">{children}</div></>;
}
