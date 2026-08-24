export type ApiErrorCode = 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'ADMIN_DISABLED' | 'NOT_FOUND' | 'INVALID_REQUEST' | 'CONFLICT' | 'CONSOLE_SERVER_CONFIG_ERROR' | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly status: number) { super(message); }
}
