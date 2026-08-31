import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('organization IDs accept Firestore-safe identifiers and reject path-like values', () => {
  const source = fs.readFileSync(new URL('../lib/server/request.ts', import.meta.url), 'utf8');
  assert.match(source, /const ORGANIZATION_ID_PATTERN = \/\^\[A-Za-z0-9_-\]\{1,150\}\$\//);
  assert.match(source, /Invalid organization ID/);
});

test('Console API distinguishes token failures from transport failures', () => {
  const source = fs.readFileSync(new URL('../lib/console-api.ts', import.meta.url), 'utf8');
  assert.match(source, /Unable to reach the administrative service/);
  assert.match(source, /new ConsoleApiError\('NETWORK_ERROR'/);
  assert.match(source, /new ConsoleApiError\('UNAUTHENTICATED'/);
});
