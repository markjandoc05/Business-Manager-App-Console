import { requireActiveOrganizationMemberToken, requireAuthenticatedClientToken } from './client-organization-auth';
import { getCurrentSubscriptionLicense, provisionSubscriptionTrial, startSubscriptionTrial, validateSubscriptionEligibility } from './subscription-license-service';
import { ApiError } from './api-errors';
import { requiredString } from './request';

function requirePlanSelectionOnly(body: Record<string, unknown>, allowWorkspace = false) {
  const allowed = allowWorkspace ? ['organizationId', 'planId', 'planCode', 'workspace'] : ['organizationId', 'planId', 'planCode'];
  const unsupported = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unsupported.length) throw new ApiError('INVALID_REQUEST', `Unsupported subscription request field: ${unsupported[0]}.`, 400);
}

function selectedPlanId(body: Record<string, unknown>) {
  const planId = body.planId;
  const planCode = body.planCode;
  if (planId !== undefined && typeof planId !== 'string') throw new ApiError('INVALID_REQUEST', 'planId must be a non-empty string.', 400);
  if (planCode !== undefined && typeof planCode !== 'string') throw new ApiError('INVALID_REQUEST', 'planCode must be a non-empty string.', 400);
  if (planId !== undefined && planCode !== undefined && planId !== planCode) throw new ApiError('INVALID_REQUEST', 'planId and planCode must match when both are supplied.', 400);
  const selected = (typeof planId === 'string' ? planId : planCode) as string | undefined;
  if (!selected?.trim()) throw new ApiError('INVALID_REQUEST', 'planId is required.', 400);
  return selected.trim();
}

export async function handleClientSubscriptionEligibility(idToken: string, body: Record<string, unknown>) {
  requirePlanSelectionOnly(body);
  const organizationId = requiredString(body, 'organizationId');
  const planId = selectedPlanId(body);
  await requireActiveOrganizationMemberToken(idToken, organizationId, ['ADMIN']);
  return validateSubscriptionEligibility(organizationId, planId);
}

export async function handleClientSubscriptionTrial(idToken: string, body: Record<string, unknown>) {
  requirePlanSelectionOnly(body, true);
  const planId = selectedPlanId(body);
  if (body.workspace !== undefined) {
    if (body.organizationId !== undefined) throw new ApiError('INVALID_REQUEST', 'organizationId cannot be supplied with workspace provisioning.', 400);
    return provisionSubscriptionTrial(planId, await requireAuthenticatedClientToken(idToken, false, true), body.workspace);
  }
  const organizationId = requiredString(body, 'organizationId');
  const actor = await requireActiveOrganizationMemberToken(idToken, organizationId, ['ADMIN']);
  return startSubscriptionTrial(organizationId, planId, actor);
}

export async function handleClientSubscriptionLink(idToken: string, body: Record<string, unknown>) {
  return handleClientSubscriptionTrial(idToken, body);
}

export async function handleClientSubscriptionStatus(idToken: string, organizationId: string) {
  await requireActiveOrganizationMemberToken(idToken, organizationId, ['ADMIN', 'MANAGER', 'USER']);
  return getCurrentSubscriptionLicense(organizationId);
}
