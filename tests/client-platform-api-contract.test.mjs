import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contract = await import('../lib/client-platform-api-contract.ts');

test('versioned Client Platform API constants pin the public transport contract', () => {
  assert.equal(contract.CLIENT_PLATFORM_API_BASE_URL_ENV, 'VENTALE_PLATFORM_API_BASE_URL');
  assert.deepEqual(contract.CLIENT_PLATFORM_API_ROUTES, {
    plans: '/api/v1/plans',
    trials: '/api/v1/trials',
    subscription: '/api/v1/subscription',
  });
  assert.equal(contract.CLIENT_PLATFORM_IDEMPOTENCY_KEY_PATTERN.test('9b5ccf3a-1ed7-4c1c-a2a3-34bd5e2d0d64'), true);
  assert.equal(contract.CLIENT_PLATFORM_IDEMPOTENCY_KEY_PATTERN.test('too-short'), false);
  assert.equal(contract.CLIENT_PLATFORM_IDEMPOTENCY_RETENTION_DAYS, 30);
  assert.deepEqual(contract.CLIENT_PLATFORM_ERROR_HTTP_STATUS, {
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INVALID_PLAN: 400,
    PLAN_UNAVAILABLE: 409,
    FOUNDING_LIMIT_REACHED: 409,
    TRIAL_ALREADY_EXISTS: 409,
    WORKSPACE_ALREADY_EXISTS: 409,
    IDEMPOTENCY_CONFLICT: 409,
    INVALID_REQUEST: 400,
    LICENSE_NOT_FOUND: 404,
    PROVISIONING_FAILED: 500,
    INTERNAL_ERROR: 500,
  });
});

test('routes are a v1 facade over trusted handlers and token verification checks revocation', async () => {
  const [plansRoute, trialsRoute, subscriptionRoute, legacyPlansRoute, legacyPlanRoute, eligibilityRoute, trialRoute, linkRoute, legacyStatusRoute, auth, document] = await Promise.all([
    readFile(new URL('../app/api/v1/plans/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/v1/trials/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/v1/subscription/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/public/signup-plans/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/public/signup-plan/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/client/licensing/eligibility/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/client/licensing/trial/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/client/licensing/link/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/client/licensing/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/client-organization-auth.ts', import.meta.url), 'utf8'),
    readFile(new URL('../docs/client-platform-api-contract.md', import.meta.url), 'utf8'),
  ]);
  assert.match(plansRoute, /listClientPlatformPublicPlans/);
  assert.match(trialsRoute, /provisionClientPlatformTrial/);
  assert.match(trialsRoute, /idempotency-key/);
  assert.match(subscriptionRoute, /getClientPlatformSubscription/);
  assert.match(auth, /verifyIdToken\(token, true\)/);
  assert.match(document, /VENTALE_PLATFORM_API_BASE_URL/);
  assert.match(document, /same-origin Client App server proxy/);
  assert.match(document, /`marketing` is optional, display-only Platform plan metadata/);
  assert.match(document, /founding_100.*STARTER/s);
  assert.match(document, /standard.*STARTER/s);
  assert.doesNotMatch(document, /Access-Control-Allow-Origin: \*/);
  assert.match(document, /There is intentionally no versioned eligibility or license-link route/);
  assert.match(document, /Existing compatibility routes — do not use for new Client integration/);
  assert.match(document, /GET` \| `\/api\/public\/signup-plans/);
  assert.match(document, /POST` \| `\/api\/client\/licensing\/eligibility/);
  assert.match(document, /POST` \| `\/api\/client\/licensing\/trial/);
  assert.match(document, /POST` \| `\/api\/client\/licensing\/link/);
  assert.match(document, /GET` \| `\/api\/client\/licensing\?organizationId=/);
  assert.match(document, /provisioning response initially, then\s+`GET \/api\/v1\/subscription`/s);
  assert.match(legacyPlansRoute, /listPublicSignupPlans/);
  assert.match(legacyPlanRoute, /listPublicSignupPlans/);
  assert.match(eligibilityRoute, /handleClientSubscriptionEligibility/);
  assert.match(trialRoute, /handleClientSubscriptionTrial/);
  assert.match(linkRoute, /handleClientSubscriptionLink/);
  assert.match(legacyStatusRoute, /handleClientSubscriptionStatus/);
});
