import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routes = [
  '../app/api/organizations/route.ts',
  '../app/api/organizations/[orgId]/route.ts',
  '../app/api/users/route.ts',
  '../app/api/licensing/route.ts',
  '../app/api/subscription-operations/route.ts',
  '../app/api/subscription-operations/[orgId]/route.ts',
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

test('the V1 Console exposes no Domains & Installations API surface', async () => {
  const [shell, app, apiClient] = await Promise.all([
    readFile(new URL('../components/ConsoleShell.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/ConsoleApp.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/console-api.ts', import.meta.url), 'utf8'),
  ]);
  for (const source of [shell, app, apiClient]) {
    assert.doesNotMatch(source, /Domains & Installations|\/api\/installations|\/api\/domains|getPlatformInstallations|getPlatformDomains/);
  }
});
