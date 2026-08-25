import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routes = [
  '../app/api/organizations/route.ts',
  '../app/api/organizations/[orgId]/route.ts',
  '../app/api/users/route.ts',
  '../app/api/licensing/route.ts',
  '../app/api/audit-logs/route.ts',
  '../app/api/organizations/[orgId]/usage/route.ts',
];

test('platform read APIs require the shared platform-admin authorization layer', async () => {
  for (const routePath of routes) {
    const source = await readFile(new URL(routePath, import.meta.url), 'utf8');
    assert.match(source, /requirePlatformAdmin\(request\)/, routePath);
    assert.match(source, /successResponse\(/, routePath);
  }
});
