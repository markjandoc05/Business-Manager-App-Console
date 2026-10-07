import { NextResponse } from 'next/server';
import {
  CLIENT_PLATFORM_ERROR_HTTP_STATUS,
  CLIENT_PLATFORM_ERROR_MESSAGES,
  type ClientPlatformApiErrorCode,
} from '../client-platform-api-contract';
import { ApiError } from './api-errors';

function stableErrorCode(error: unknown): ClientPlatformApiErrorCode {
  if (!(error instanceof ApiError)) return 'INTERNAL_ERROR';
  switch (error.code) {
    case 'UNAUTHENTICATED': return 'UNAUTHENTICATED';
    case 'UNAUTHORIZED':
    case 'FORBIDDEN': return 'FORBIDDEN';
    case 'INVALID_PLAN': return 'INVALID_PLAN';
    case 'PLAN_UNAVAILABLE': return 'PLAN_UNAVAILABLE';
    case 'FOUNDING_LIMIT_REACHED': return 'FOUNDING_LIMIT_REACHED';
    case 'TRIAL_ALREADY_EXISTS': return 'TRIAL_ALREADY_EXISTS';
    case 'WORKSPACE_ALREADY_EXISTS': return 'WORKSPACE_ALREADY_EXISTS';
    case 'IDEMPOTENCY_CONFLICT': return 'IDEMPOTENCY_CONFLICT';
    case 'INVALID_REQUEST': return 'INVALID_REQUEST';
    case 'LICENSE_NOT_FOUND':
    case 'NOT_FOUND': return 'LICENSE_NOT_FOUND';
    case 'PROVISIONING_FAILED': return 'PROVISIONING_FAILED';
    default: return 'INTERNAL_ERROR';
  }
}

/**
 * The versioned API intentionally uses a fixed public envelope. It does not
 * reuse detailed Console error messages, which may describe internal Firebase
 * state or operational paths that a Client App does not need to know.
 */
export function clientPlatformErrorResponse(error: unknown) {
  const code = stableErrorCode(error);
  if (!(error instanceof ApiError)) console.error('[Client Platform API] unexpected request failure', error);
  return NextResponse.json(
    { success: false, error: { code, message: CLIENT_PLATFORM_ERROR_MESSAGES[code] } },
    {
      status: CLIENT_PLATFORM_ERROR_HTTP_STATUS[code],
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export function clientPlatformSuccessResponse<T>(data: T, status = 200) {
  return NextResponse.json(
    { success: true, data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
