import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const types = fs.readFileSync(new URL('../lib/types.ts', import.meta.url), 'utf8');
const readService = fs.readFileSync(new URL('../lib/server/console-read-service.ts', import.meta.url), 'utf8');
const organizationDetail = fs.readFileSync(new URL('../components/console/OrganizationDetailModule.tsx', import.meta.url), 'utf8');
const usersModule = fs.readFileSync(new URL('../components/console/UsersModule.tsx', import.meta.url), 'utf8');
const dialogs = fs.readFileSync(new URL('../components/console/OrganizationAdminDialogs.tsx', import.meta.url), 'utf8');

test('Console membership contracts include canonical login activity fields', () => {
  for (const field of ['lastLoginAt', 'lastLoginStatus', 'lastSuccessfulLoginAt', 'lastFailedLoginAt', 'lastLoginFailureCode']) assert.match(types, new RegExp(field));
  for (const field of ['lastLoginAt', 'lastLoginStatus', 'lastSuccessfulLoginAt', 'lastFailedLoginAt', 'lastLoginFailureCode']) assert.match(readService, new RegExp(field));
});

test('Console renders login status safely without exposing raw failure codes in member tables', () => {
  assert.match(organizationDetail, /Last Login/);
  assert.match(organizationDetail, /Login Status/);
  assert.match(organizationDetail, /No login yet/);
  assert.match(usersModule, /Last Login/);
  assert.match(usersModule, /Login Status/);
  assert.match(dialogs, /Last Successful Login/);
  assert.match(dialogs, /Last Failed Login/);
  assert.match(dialogs, /Latest Login Status/);
  assert.match(dialogs, /Failure Reason/);
  assert.doesNotMatch(organizationDetail, /member\.lastLoginFailureCode/);
  assert.doesNotMatch(usersModule, /row\.lastLoginFailureCode/);
});
