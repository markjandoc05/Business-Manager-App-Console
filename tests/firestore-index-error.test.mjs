import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRESTORE_INDEX_ERROR_MESSAGE, isFirestoreIndexError } from '../lib/server/firestore-index-errors.ts';

test('classifies missing and building Firestore indexes', () => {
  assert.equal(isFirestoreIndexError({ code: 'failed-precondition', message: 'The query requires an index. You can create it here.' }), true);
  assert.equal(isFirestoreIndexError({ code: 'FAILED-PRECONDITION', message: 'The database index is currently building.' }), true);
  assert.match(FIRESTORE_INDEX_ERROR_MESSAGE, /temporarily unavailable/);
});

test('does not classify unrelated failed-precondition errors as index errors', () => {
  assert.equal(isFirestoreIndexError({ code: 'failed-precondition', message: 'The write precondition was not met.' }), false);
});
