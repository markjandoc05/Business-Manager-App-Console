'use client';

import React from 'react';
import { AuthScreen } from './AuthScreen';
import { ConsoleShell } from './ConsoleShell';
import { useAuth } from '@/lib/auth-context';
import { ConsolePage } from './ConsoleShell';
import { DashboardModule } from './console/DashboardModule';
import { OrganizationsModule } from './console/OrganizationsModule';
import { OrganizationDetailModule } from './console/OrganizationDetailModule';
import { UsersModule } from './console/UsersModule';
import { LicensingModule } from './console/LicensingModule';
import { AuditLogsModule } from './console/AuditLogsModule';
import { PlatformAdminsModule } from './console/PlatformAdminsModule';

export function ConsoleApp({ page, orgId }: { page: string; orgId?: string }) {
  const { status } = useAuth();
  if (status !== 'authorized') return <AuthScreen />;
  return <ConsoleShell>
    {page === 'dashboard' && <ConsolePage title="Dashboard" description="Monitor organizations, memberships, and platform licensing."><DashboardModule /></ConsolePage>}
    {page === 'organizations' && <ConsolePage title="Organizations" description="Manage BSM workspaces, subscriptions, and account status."><OrganizationsModule /></ConsolePage>}
    {page === 'organization-detail' && orgId && <OrganizationDetailModule orgId={orgId} />}
    {page === 'users' && <ConsolePage title="Users" description="Review organization memberships across the BSM platform."><UsersModule /></ConsolePage>}
    {page === 'licensing' && <ConsolePage title="Licensing" description="Manage organization activation, subscriptions, user limits, and license status."><LicensingModule /></ConsolePage>}
    {page === 'audit-logs' && <ConsolePage title="Audit Logs" description="Review append-only administrative activity across the platform."><AuditLogsModule /></ConsolePage>}
    {page === 'platform-admins' && <ConsolePage title="Platform Admins" description="Review the administrator identity currently authorized for this console."><PlatformAdminsModule /></ConsolePage>}
    {page === 'settings' && <ConsolePage title="Settings" description="Console configuration and security boundaries."><PlatformAdminsModule /></ConsolePage>}
  </ConsoleShell>;
}
