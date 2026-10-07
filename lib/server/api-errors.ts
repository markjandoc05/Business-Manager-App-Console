export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'ADMIN_DISABLED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'CONFLICT'
  | 'CONSOLE_SERVER_CONFIG_ERROR'
  | 'INTERNAL_ERROR'
  // Stable errors used only by the versioned Client Platform API facade. The
  // older Console routes retain their existing generic error vocabulary.
  | 'FORBIDDEN'
  | 'INVALID_PLAN'
  | 'PLAN_UNAVAILABLE'
  | 'FOUNDING_LIMIT_REACHED'
  | 'FOUNDING_LIMIT_BELOW_USAGE'
  | 'TRIAL_ALREADY_EXISTS'
  | 'WORKSPACE_ALREADY_EXISTS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'LICENSE_NOT_FOUND'
  | 'PROVISIONING_FAILED';

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly status: number) { super(message); }
}
