import { NextResponse } from 'next/server';
import { ApiError } from './api-errors';
import { FIRESTORE_INDEX_ERROR_MESSAGE, isFirestoreIndexError } from './firestore-index-errors';

export function errorResponse(error: unknown) {
  const indexError = isFirestoreIndexError(error);
  const apiError = error instanceof ApiError
    ? error
    : indexError
      ? new ApiError('INTERNAL_ERROR', FIRESTORE_INDEX_ERROR_MESSAGE, 503)
      : new ApiError('INTERNAL_ERROR', 'An internal error occurred.', 500);
  if (!(error instanceof ApiError)) {
    if (indexError) {
      if (process.env.NODE_ENV !== 'production') console.info('[Console] Firestore index is unavailable or still building.', error);
    } else {
      console.error(error);
    }
  }
  return NextResponse.json({ success: false, error: { code: apiError.code, message: apiError.message } }, { status: apiError.status });
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}
