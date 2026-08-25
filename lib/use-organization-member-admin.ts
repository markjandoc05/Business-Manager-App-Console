'use client';

import { useCallback, useState } from 'react';
import { ConsoleApiError, addOrganizationMember, updateOrganizationMember } from './console-api';
import type { OrganizationMemberRole } from './types';

export type MemberAdminAction = 'ADD_MEMBER' | 'CHANGE_ROLE' | 'SUSPEND_MEMBER' | 'REACTIVATE_MEMBER' | 'ARCHIVE_MEMBER' | 'RESTORE_MEMBER' | 'UPDATE_MEMBER';
export type MemberAdminPayload = { email?: string; role?: OrganizationMemberRole; status?: 'active' | 'pending' | 'inactive' | 'suspended' | 'archived' | 'disabled'; reason?: string };

export async function dispatchOrganizationMemberAdminAction(action: MemberAdminAction, organizationId: string, memberUid: string | undefined, payload: MemberAdminPayload) {
  if (action === 'ADD_MEMBER') return addOrganizationMember(organizationId, { email: payload.email?.trim() || '', role: payload.role || 'USER', reason: payload.reason });
  if (!memberUid) throw new Error('A member is required for this action.');
  if (action === 'CHANGE_ROLE') {
    if (!payload.role) throw new Error('A tenant role is required for this action.');
    return updateOrganizationMember(organizationId, memberUid, { role: payload.role, reason: payload.reason });
  }
  if (action === 'SUSPEND_MEMBER') return updateOrganizationMember(organizationId, memberUid, { status: 'suspended', reason: payload.reason });
  if (action === 'REACTIVATE_MEMBER' || action === 'RESTORE_MEMBER') return updateOrganizationMember(organizationId, memberUid, { status: 'active', reason: payload.reason });
  if (action === 'ARCHIVE_MEMBER') return updateOrganizationMember(organizationId, memberUid, { status: 'archived', reason: payload.reason });
  return updateOrganizationMember(organizationId, memberUid, payload);
}

export function memberAdminSuccessMessage(action: MemberAdminAction) {
  return ({ ADD_MEMBER: 'Member added successfully.', CHANGE_ROLE: 'Member role updated successfully.', SUSPEND_MEMBER: 'Member access suspended.', REACTIVATE_MEMBER: 'Member reactivated successfully.', ARCHIVE_MEMBER: 'Member archived successfully.', RESTORE_MEMBER: 'Member restored successfully.', UPDATE_MEMBER: 'Member access updated successfully.' } as Record<MemberAdminAction, string>)[action];
}

export function useOrganizationMemberAdmin({ organizationId, refresh }: { organizationId?: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const runMemberAction = useCallback(async (action: MemberAdminAction, memberUid: string | undefined, payload: MemberAdminPayload = {}) => {
    if (!organizationId) return false;
    setBusy(true); setMessage(null);
    try { await dispatchOrganizationMemberAdminAction(action, organizationId, memberUid, payload); await refresh(); setMessage(memberAdminSuccessMessage(action)); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The member administration request failed.'); if (error instanceof ConsoleApiError && error.status === 409) await refresh().catch(() => undefined); return false; }
    finally { setBusy(false); }
  }, [organizationId, refresh]);
  return { busy, message, runMemberAction, setMessage };
}
