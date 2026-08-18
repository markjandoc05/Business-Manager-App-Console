'use client';

import React from 'react';
import { useConsole } from '@/lib/console-context';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { ToastContainer } from '@/components/ToastContainer';
import { DashboardModule } from '@/components/modules/DashboardModule';
import { CustomersModule } from '@/components/modules/CustomersModule';
import { InstallationsModule } from '@/components/modules/InstallationsModule';
import { LicensesModule } from '@/components/modules/LicensesModule';
import { InfrastructureModule } from '@/components/modules/InfrastructureModule';
import { DeploymentsModule } from '@/components/modules/DeploymentsModule';
import { ActivityModule } from '@/components/modules/ActivityModule';
import { SettingsModule } from '@/components/modules/SettingsModule';

export default function Page() {
  const { activeTab } = useConsole();

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <DashboardModule />}
            {activeTab === 'customers' && <CustomersModule />}
            {activeTab === 'installations' && <InstallationsModule />}
            {activeTab === 'licenses' && <LicensesModule />}
            {activeTab === 'infrastructure' && <InfrastructureModule />}
            {activeTab === 'deployments' && <DeploymentsModule />}
            {activeTab === 'activity' && <ActivityModule />}
            {activeTab === 'settings' && <SettingsModule />}
          </div>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
