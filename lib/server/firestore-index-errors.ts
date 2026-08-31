export const FIRESTORE_INDEX_ERROR_MESSAGE = 'Data is temporarily unavailable while the database index is being prepared. Please try again shortly.';

export function isFirestoreIndexError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  return code === 'failed-precondition'
    && /requires an index|index is (?:currently )?(?:being )?(?:built|building|prepared|used)|database index is being prepared/i.test(candidate.message || '');
}
