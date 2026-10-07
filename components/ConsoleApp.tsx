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
import { PlanMarketingModule } from './console/PlanMarketingModule';

export function ConsoleApp({ page, orgId }: { page: string; orgId?: string }) {
  const { status } = useAuth();
  if (status !== 'authorized') return <AuthScreen />;
  return <ConsoleShell>
    {page === 'dashboard' && <ConsolePage title="Platform Health" description="Monitor the centralized Ventale platform through organization, membership, and licensing health—not per-customer deployments."><DashboardModule /></ConsolePage>}
    {page === 'organizations' && <ConsolePage title="Customers & Organizations" description="Review centralized organization registration, canonical licensing, and organizationId-scoped workspace metadata."><OrganizationsModule /></ConsolePage>}
    {page === 'organization-detail' && orgId && <OrganizationDetailModule orgId={orgId} />}
    {page === 'users' && <ConsolePage title="Members & Access" description="Review organization membership and access. Organization roles never grant Developer Console access."><UsersModule /></ConsolePage>}
    {page === 'licensing' && <ConsolePage title="Subscriptions & Licenses" description="Manage platform subscription plans, canonical license snapshots, renewals, seats, and authorized license actions."><LicensingModule /></ConsolePage>}
    {page === 'plan-marketing' && <ConsolePage title="Plan Marketing" description="Manage Platform-owned display copy for public plans. Commercial terms and license authority remain read-only."><PlanMarketingModule /></ConsolePage>}
    {page === 'audit-logs' && <ConsolePage title="Audit Logs" description="Review append-only administrative activity across the platform."><AuditLogsModule /></ConsolePage>}
    {page === 'platform-admins' && <ConsolePage title="Platform Admins" description="Review the administrator identity currently authorized for this console."><PlatformAdminsModule /></ConsolePage>}
    {page === 'settings' && <ConsolePage title="Settings" description="Console configuration and security boundaries."><PlatformAdminsModule /></ConsolePage>}
  </ConsoleShell>;
}
