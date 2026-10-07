import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CLIENT_PLATFORM_IDEMPOTENCY_KEY_PATTERN,
  CLIENT_PLATFORM_IDEMPOTENCY_RETENTION_DAYS,
  type ClientPlatformPublicPlan,
} from '../client-platform-api-contract';
import { commercialProductEntitlement } from '../commercial-entitlement-contract';
import { isSubscriptionPlanId } from '../subscription-plan-contract';
import { ApiError } from './api-errors';
import { adminDb } from './firebase-admin-core';
import { requireActiveOrganizationMemberToken, requireAuthenticatedClientToken } from './client-organization-auth';
import { validateOrganizationId } from './request';
import { listPublicSignupPlans } from './subscription-plan-service';
import {
  CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION,
  getClientPlatformSubscriptionStatus,
  provisionSubscriptionTrial,
  type SubscriptionProvisioningIdempotency,
} from './subscription-license-service';

const TRIAL_REQUEST_FIELDS = ['productCode', 'workspace'];
const WORKSPACE_REQUEST_FIELDS = ['businessName', 'requestedSlug', 'businessType', 'phone', 'website', 'currency', 'timezone'];

interface ClientPlatformWorkspaceRequest {
  name: string;
  requestedSlug?: string;
  businessType: string;
  phone?: string;
  website?: string;
  currency: string;
  timezone: string;
}

interface ClientPlatformProvisioningRequest {
  productCode: string;
  workspace: ClientPlatformWorkspaceRequest;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST', `${field} must be an object.`, 400);
  return value as Record<string, unknown>;
}

function rejectUnsupportedFields(value: Record<string, unknown>, allowed: readonly string[]) {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported) throw new ApiError('INVALID_REQUEST', `Unsupported request field: ${unsupported}.`, 400);
}

function requestString(value: unknown, field: string, required = true) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new ApiError('INVALID_REQUEST', `${field} must be a non-empty string.`, 400);
  return value.trim();
}

/**
 * This parser is intentionally allowlist-only. It converts Client-safe
 * onboarding labels to the existing trusted provisioning input; it does not
 * introduce an alternate license-writing path.
 */
export function parseClientPlatformProvisioningRequest(value: unknown): ClientPlatformProvisioningRequest {
  const body = requireObject(value, 'request body');
  rejectUnsupportedFields(body, TRIAL_REQUEST_FIELDS);
  const productCode = requestString(body.productCode, 'productCode');
  if (!isSubscriptionPlanId(productCode) || !commercialProductEntitlement(productCode)) {
    throw new ApiError('INVALID_PLAN', 'The requested commercial product is invalid.', 400);
  }
  const workspaceBody = requireObject(body.workspace, 'workspace');
  rejectUnsupportedFields(workspaceBody, WORKSPACE_REQUEST_FIELDS);
  return {
    productCode,
    workspace: {
      name: requestString(workspaceBody.businessName, 'workspace.businessName')!,
      requestedSlug: requestString(workspaceBody.requestedSlug, 'workspace.requestedSlug', false),
      businessType: requestString(workspaceBody.businessType, 'workspace.businessType')!,
      phone: requestString(workspaceBody.phone, 'workspace.phone', false),
      website: requestString(workspaceBody.website, 'workspace.website', false),
      currency: requestString(workspaceBody.currency, 'workspace.currency')!,
      timezone: requestString(workspaceBody.timezone, 'workspace.timezone')!,
    },
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function idempotencyKey(value: string | null) {
  const key = value?.trim() || '';
  if (!CLIENT_PLATFORM_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError('INVALID_REQUEST', 'Idempotency-Key must be an opaque 16-128 character request key.', 400);
  }
  return key;
}

function requestFingerprint(request: ClientPlatformProvisioningRequest) {
  // Fixed property ordering makes harmless JSON formatting differences replay
  // as the same trusted request, while any business-field change conflicts.
  return sha256(JSON.stringify({
    productCode: request.productCode,
    workspace: {
      businessName: request.workspace.name,
      requestedSlug: request.workspace.requestedSlug || null,
      businessType: request.workspace.businessType,
      phone: request.workspace.phone || null,
      website: request.workspace.website || null,
      currency: request.workspace.currency,
      timezone: request.workspace.timezone,
    },
  }));
}

function provisioningIdempotency(
  uid: string,
  rawKey: string | null,
  request: ClientPlatformProvisioningRequest,
): SubscriptionProvisioningIdempotency {
  const key = idempotencyKey(rawKey);
  // The raw caller key is neither used as a document ID nor persisted. Its
  // scope includes both identity and endpoint, so another authenticated user
  // cannot observe or conflict with this caller's replay record.
  const scopeHash = sha256(`POST /api/v1/trials\u0000${uid}\u0000${key}`);
  return {
    reference: adminDb.collection(CLIENT_PROVISIONING_IDEMPOTENCY_COLLECTION).doc(scopeHash),
    endpoint: 'POST /api/v1/trials',
    uid,
    requestFingerprint: requestFingerprint(request),
    retentionUntil: Timestamp.fromMillis(Date.now() + CLIENT_PLATFORM_IDEMPOTENCY_RETENTION_DAYS * 86_400_000),
  };
}

export async function listClientPlatformPublicPlans() {
  const plans = await listPublicSignupPlans();
  const publicPlans: ClientPlatformPublicPlan[] = plans.map((plan) => ({
    code: plan.code,
    name: plan.name,
    price: plan.price,
    currency: 'USD',
    billingInterval: 'year',
    trialDays: plan.trialDays,
    requiresCard: !plan.noCreditCardRequired,
    available: true,
    ...(plan.marketing ? { marketing: { badge: plan.marketing.badge, messages: [...plan.marketing.messages] } } : {}),
  }));
  return { plans: publicPlans };
}

export async function provisionClientPlatformTrial(
  idToken: string,
  body: unknown,
  rawIdempotencyKey: string | null,
) {
  const request = parseClientPlatformProvisioningRequest(body);
  const user = await requireAuthenticatedClientToken(idToken, false, true);
  const replay = provisioningIdempotency(user.uid, rawIdempotencyKey, request);
  let result;
  try {
    result = await provisionSubscriptionTrial(request.productCode, user, request.workspace, replay);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('PROVISIONING_FAILED', 'Workspace provisioning could not be completed.', 500);
  }
  try {
    const subscription = await getClientPlatformSubscriptionStatus(result.organizationId);
    return {
      workspaceId: subscription.workspaceId,
      organizationId: subscription.organizationId,
      productCode: subscription.productCode,
      legacy: subscription.legacy,
      idempotent: result.idempotent,
      provisioningStatus: subscription.legacy
        ? 'LEGACY_RECONCILED'
        : result.idempotent ? 'REUSED' : 'PROVISIONED',
      license: subscription.license,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== 'LICENSE_NOT_FOUND') throw error;
    throw new ApiError('PROVISIONING_FAILED', 'Workspace provisioning could not be completed.', 500);
  }
}

export async function getClientPlatformSubscription(idToken: string, workspaceId: string) {
  const organizationId = validateOrganizationId(workspaceId);
  await requireActiveOrganizationMemberToken(idToken, organizationId, ['ADMIN', 'MANAGER', 'USER']);
  return getClientPlatformSubscriptionStatus(organizationId);
}
