/**
 * Public, versioned transport constants for the trusted Platform API.
 *
 * `VENTALE_PLATFORM_API_BASE_URL` belongs in the Client App server runtime,
 * never in browser-visible configuration. The Platform itself has no reason
 * to read that outbound URL.
 */
export const CLIENT_PLATFORM_API_BASE_URL_ENV = 'VENTALE_PLATFORM_API_BASE_URL';
export const CLIENT_PLATFORM_API_PREFIX = '/api/v1';

export const CLIENT_PLATFORM_API_ROUTES = {
  plans: `${CLIENT_PLATFORM_API_PREFIX}/plans`,
  trials: `${CLIENT_PLATFORM_API_PREFIX}/trials`,
  subscription: `${CLIENT_PLATFORM_API_PREFIX}/subscription`,
} as const;

export const CLIENT_PLATFORM_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/;
export const CLIENT_PLATFORM_IDEMPOTENCY_RETENTION_DAYS = 30;

export const CLIENT_PLATFORM_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_PLAN',
  'PLAN_UNAVAILABLE',
  'FOUNDING_LIMIT_REACHED',
  'TRIAL_ALREADY_EXISTS',
  'WORKSPACE_ALREADY_EXISTS',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_REQUEST',
  'LICENSE_NOT_FOUND',
  'PROVISIONING_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ClientPlatformApiErrorCode = typeof CLIENT_PLATFORM_ERROR_CODES[number];

export const CLIENT_PLATFORM_ERROR_HTTP_STATUS: Record<ClientPlatformApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_PLAN: 400,
  PLAN_UNAVAILABLE: 409,
  FOUNDING_LIMIT_REACHED: 409,
  TRIAL_ALREADY_EXISTS: 409,
  WORKSPACE_ALREADY_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_REQUEST: 400,
  LICENSE_NOT_FOUND: 404,
  PROVISIONING_FAILED: 500,
  INTERNAL_ERROR: 500,
};

export const CLIENT_PLATFORM_ERROR_MESSAGES: Record<ClientPlatformApiErrorCode, string> = {
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You are not authorized to access this workspace.',
  INVALID_PLAN: 'The selected product code is not supported.',
  PLAN_UNAVAILABLE: 'The selected product is not currently available.',
  FOUNDING_LIMIT_REACHED: 'The Founding 100 offer is no longer available.',
  TRIAL_ALREADY_EXISTS: 'A current trial or subscription already exists.',
  WORKSPACE_ALREADY_EXISTS: 'A workspace already exists for this account or requested slug.',
  IDEMPOTENCY_CONFLICT: 'This idempotency key was already used for a different request.',
  INVALID_REQUEST: 'The request is invalid.',
  LICENSE_NOT_FOUND: 'No canonical license was found for this workspace.',
  PROVISIONING_FAILED: 'Workspace provisioning could not be completed. Retry with the same idempotency key.',
  INTERNAL_ERROR: 'An internal error occurred.',
};

/** Optional Platform-owned presentation metadata; never an authorization input. */
export interface ClientPlatformPlanMarketing {
  badge?: string;
  messages: string[];
}

export interface ClientPlatformPublicPlan {
  code: string;
  name: string;
  price: number;
  currency: 'USD';
  billingInterval: 'year';
  trialDays: number;
  requiresCard: boolean;
  available: true;
  marketing?: ClientPlatformPlanMarketing;
}

export interface ClientPlatformLicense {
  plan: 'TRIAL' | 'SOLO' | 'STARTER' | 'TEAM' | 'LEGACY';
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  subscriptionStartedAt: string | null;
  renewalDate: string | null;
  expirationDate: string | null;
  maxUsers: number;
  billingInterval: 'year' | null;
}

export interface ClientPlatformSubscriptionStatus {
  workspaceId: string;
  organizationId: string;
  productCode: string | null;
  legacy: boolean;
  license: ClientPlatformLicense;
}
