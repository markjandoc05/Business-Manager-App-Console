import { NextResponse } from 'next/server';

export type ApiErrorCode = 'UNAUTHENTICATED' | 'UNAUTHORIZED' | 'ADMIN_DISABLED' | 'NOT_FOUND' | 'INVALID_REQUEST' | 'CONFLICT' | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly status: number) { super(message); }
}

export function errorResponse(error: unknown) {
  const apiError = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 'An internal error occurred.', 500);
  if (!(error instanceof ApiError)) console.error(error);
  return NextResponse.json({ success: false, error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
