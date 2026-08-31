'use client';

import type { LicenseAdminAction, LicenseActionPayload } from './types';
import { ConsoleApiError, activateLicense, changePlan, changeSeatLimit, convertTrialToPaid, editLicenseDetails, expireLicense, extendSubscription, extendTrial, reactivateOrganization, repairLicense, renewLicense, suspendOrganization } from './console-api';

function endAt(value?: string) { return new Date(`${value}T23:59:59.000Z`).toISOString(); }
function startAt(value?: string) { return new Date(`${value}T00:00:00.000Z`).toISOString(); }

export async function dispatchLicenseAction(orgId: string, action: LicenseAdminAction, payload: LicenseActionPayload = {}) {
  switch (action) {
    case 'ACTIVATE':
      return activateLicense(orgId, { plan: payload.plan || 'TRIAL', maxUsers: payload.maxUsers || 1, ...(payload.plan === 'TRIAL' ? { trialStartedAt: startAt(payload.trialStartedAt) } : { subscriptionStartedAt: startAt(payload.subscriptionStartedAt) }), endsAt: endAt(payload.trialEndsAt || payload.subscriptionEndsAt) });
    case 'REPAIR_LICENSE':
      return repairLicense(orgId, { ...payload, ...(payload.plan === 'TRIAL' ? { trialStartedAt: startAt(payload.trialStartedAt), trialEndsAt: endAt(payload.trialEndsAt) } : { subscriptionStartedAt: startAt(payload.subscriptionStartedAt), subscriptionEndsAt: endAt(payload.subscriptionEndsAt) }) });
    case 'EDIT_LICENSE_DETAILS':
      return editLicenseDetails(orgId, { ...payload, ...(payload.plan === 'TRIAL' ? { trialStartedAt: payload.trialStartedAt ? startAt(payload.trialStartedAt) : undefined, trialEndsAt: payload.trialEndsAt ? endAt(payload.trialEndsAt) : undefined } : { subscriptionStartedAt: payload.subscriptionStartedAt ? startAt(payload.subscriptionStartedAt) : undefined, subscriptionEndsAt: payload.subscriptionEndsAt ? endAt(payload.subscriptionEndsAt) : undefined }) });
    case 'EXTEND_TRIAL':
      return extendTrial(orgId, endAt(payload.trialEndsAt));
    case 'CONVERT_TO_PAID':
      return convertTrialToPaid(orgId, { plan: payload.plan as 'SOLO' | 'STARTER' | 'TEAM' | 'LEGACY', maxUsers: payload.maxUsers || 1, subscriptionStartedAt: startAt(payload.subscriptionStartedAt), subscriptionEndsAt: endAt(payload.subscriptionEndsAt) });
    case 'EXTEND_SUBSCRIPTION':
      return extendSubscription(orgId, endAt(payload.subscriptionEndsAt));
    case 'RENEW':
      return renewLicense(orgId, { plan: payload.plan, maxUsers: payload.maxUsers, subscriptionStartedAt: startAt(payload.subscriptionStartedAt), subscriptionEndsAt: endAt(payload.subscriptionEndsAt) });
    case 'CHANGE_PLAN':
      return changePlan(orgId, payload.plan || 'TEAM');
    case 'CHANGE_SEAT_LIMIT':
      return changeSeatLimit(orgId, payload.maxUsers || 1);
    case 'SUSPEND':
      return suspendOrganization(orgId, payload.reason);
    case 'EXPIRE':
      return expireLicense(orgId);
    case 'REACTIVATE':
      return reactivateOrganization(orgId);
  }
}

export function licenseActionSuccessMessage(action: LicenseAdminAction, payload: LicenseActionPayload = {}) {
  switch (action) {
    case 'ACTIVATE': return 'Organization activated successfully.';
    case 'REPAIR_LICENSE': return 'License repaired successfully.';
    case 'EDIT_LICENSE_DETAILS': return 'License details corrected successfully.';
    case 'EXTEND_TRIAL': return 'Trial extended successfully.';
    case 'CONVERT_TO_PAID': return `Trial converted to ${payload.plan || 'paid'} successfully.`;
    case 'EXTEND_SUBSCRIPTION': return 'Subscription extended successfully.';
    case 'RENEW': return 'Subscription renewed successfully.';
    case 'CHANGE_PLAN': return 'Plan changed successfully.';
    case 'CHANGE_SEAT_LIMIT': return 'User limit updated successfully.';
    case 'SUSPEND': return 'Organization suspended.';
    case 'EXPIRE': return 'Organization marked expired.';
    case 'REACTIVATE': return 'Organization reactivated.';
  }
}

export function consoleLicenseErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The licensing request failed.';
}

export function isLicenseConflict(error: unknown): error is ConsoleApiError {
  return error instanceof ConsoleApiError && error.status === 409;
}
