import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { DEFAULT_FOUNDING_CUSTOMER_LIMIT, DEFAULT_SUBSCRIPTION_PLANS, MAX_FOUNDING_CUSTOMER_LIMIT, buildSubscriptionPlanUsage, parseSubscriptionPlan, publicSubscriptionPlan } = await import('../lib/subscription-plan-contract.ts');

test('Ventale default plan catalog matches the initial launch state', () => {
  assert.deepEqual(DEFAULT_SUBSCRIPTION_PLANS.founding_100, {
    planId: 'founding_100', code: 'founding_100', entitlementTier: 'STARTER', displayName: 'Founding 100', price: 99, currency: 'USD', billingInterval: 'year', trialDays: 14,
    noCreditCardRequired: true, foundingLimit: 100, maxEligibleCustomers: 100, publicSignup: true,
    marketing: {
      badge: 'Limited to the first 100 customers',
      messages: [
        'Keep your Founding rate for as long as your subscription remains active.',
        'Standard price after the first 100: $149/year',
      ],
    },
    marketingRevision: 0,
    autoRolloverEnabled: false, autoRolloverPlanId: 'standard',
  });
  assert.deepEqual(DEFAULT_SUBSCRIPTION_PLANS.standard, {
    planId: 'standard', code: 'standard', entitlementTier: 'STARTER', displayName: 'Standard', price: 149, currency: 'USD', billingInterval: 'year', trialDays: 14,
    noCreditCardRequired: true, foundingLimit: null, maxEligibleCustomers: null, publicSignup: false, marketingRevision: 0, autoRolloverEnabled: false, autoRolloverPlanId: null,
  });
});

test('plan parsing rejects client-controlled or malformed catalog values', () => {
  const plan = parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100 });
  assert.equal(plan?.price, 99);
  assert.deepEqual(plan?.marketing, DEFAULT_SUBSCRIPTION_PLANS.founding_100.marketing);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: { badge: '', messages: ['copy'] } }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: { badge: 'Copy', messages: [] } }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: { badge: '<b>Copy</b>', messages: ['copy'] } }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: { messages: ['one', 'two', 'three', 'four'] } }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: { badge: 'Copy', messages: ['copy'], internal: 'not-public' } }), null);
  assert.deepEqual(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: { messages: ['Plain copy'] } })?.marketing, { messages: ['Plain copy'] });
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, marketing: null })?.marketing, undefined);
  assert.equal(parseSubscriptionPlan('standard', { ...DEFAULT_SUBSCRIPTION_PLANS.standard })?.marketing, undefined);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, price: -1 }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, code: 'standard' }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, publicSignup: 'true' }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, maxEligibleCustomers: 101 }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, foundingLimit: 101, maxEligibleCustomers: 101 })?.foundingLimit, 101);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, foundingLimit: 101, maxEligibleCustomers: 100 }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, foundingLimit: 0, maxEligibleCustomers: 0 }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, foundingLimit: MAX_FOUNDING_CUSTOMER_LIMIT + 1, maxEligibleCustomers: MAX_FOUNDING_CUSTOMER_LIMIT + 1 }), null);
  const legacyFounding = { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100 };
  delete legacyFounding.foundingLimit;
  assert.equal(parseSubscriptionPlan('founding_100', legacyFounding)?.foundingLimit, DEFAULT_FOUNDING_CUSTOMER_LIMIT);
  assert.equal(parseSubscriptionPlan('standard', { ...DEFAULT_SUBSCRIPTION_PLANS.standard, maxEligibleCustomers: 1 }), null);
  assert.equal(parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100, autoRolloverEnabled: true }), null);
});

test('Founding 100 usage is capped and public data excludes internal counters', () => {
  const plan = parseSubscriptionPlan('founding_100', { ...DEFAULT_SUBSCRIPTION_PLANS.founding_100 });
  assert.ok(plan);
  const publicPlan = publicSubscriptionPlan(plan);
  assert.deepEqual(buildSubscriptionPlanUsage(plan, 100), { planId: 'founding_100', eligibleCustomerCount: 100, limit: 100, remaining: 0, isFull: true, source: 'counter', updatedAt: undefined });
  assert.equal('usage' in publicPlan, false);
  assert.equal('autoRolloverEnabled' in publicPlan, false);
  assert.equal('entitlementTier' in publicPlan, false);
  assert.deepEqual(publicPlan.marketing, DEFAULT_SUBSCRIPTION_PLANS.founding_100.marketing);
});

test('Console and Client API routes are separated by authorization purpose', async () => {
  const [consoleRoute, capacityRoute, plansModule, publicRoute, clientTrialRoute, clientHandler, planService, licenseService] = await Promise.all([
    readFile(new URL('../app/api/subscription-plans/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/subscription-plans/[planId]/capacity/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/console/SubscriptionPlansModule.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/public/signup-plans/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/client/licensing/trial/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/client-subscription-handler.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/subscription-plan-service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/subscription-license-service.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(consoleRoute, /requirePlatformAdmin/);
  assert.match(consoleRoute, /listSubscriptionPlans/);
  assert.match(capacityRoute, /requirePlatformAdmin\(request, \['SUPER_ADMIN'\]\)/);
  assert.match(capacityRoute, /updateFoundingCustomerLimit/);
  assert.match(plansModule, /Founding customer limit/);
  assert.match(plansModule, /updateFoundingCustomerLimit/);
  assert.doesNotMatch(plansModule, /\/ 100/);
  assert.match(publicRoute, /listPublicSignupPlans/);
  assert.match(clientTrialRoute, /requireActiveOrganizationMemberToken|handleClientSubscriptionTrial/);
  assert.match(clientHandler, /Unsupported subscription request field/);
  assert.doesNotMatch(clientHandler, /'price'|'trialDays'|'maxUsers'|'subscriptionStatus'/);
  assert.match(planService, /compareFounding100Usage/);
  assert.match(planService, /updateFoundingCustomerLimit/);
  assert.match(planService, /FOUNDING_LIMIT_BELOW_USAGE/);
  assert.match(planService, /publicSignupChanged/);
  assert.match(licenseService, /allocationCountInTransaction/);
  assert.match(licenseService, /Math\.max\(storedCount, canonicalCount\)/);
});

test('subscription and manual license actions retain the required platform audit coverage', async () => {
  const [subscriptionLicenseService, subscriptionPlanService, licenseService] = await Promise.all([
    readFile(new URL('../lib/server/subscription-license-service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/subscription-plan-service.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/server/license-service.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(subscriptionLicenseService, /action: 'SUBSCRIPTION_TRIAL_STARTED'/);
  assert.match(subscriptionLicenseService, /licenseCreated: true/);
  assert.match(subscriptionLicenseService, /licenseLinked: true/);
  assert.match(subscriptionPlanService, /action: 'SUBSCRIPTION_PLAN_UPDATED'/);
  assert.match(subscriptionPlanService, /action: 'FOUNDING_LIMIT_UPDATED'/);
  assert.match(subscriptionPlanService, /publicSignupChanged/);
  assert.match(licenseService, /activate: 'ORGANIZATION_LICENSE_ACTIVATED'/);
  assert.match(licenseService, /suspend: 'ORGANIZATION_LICENSE_SUSPENDED'/);
  assert.match(licenseService, /expire: 'ORGANIZATION_LICENSE_EXPIRED'/);
  assert.match(licenseService, /ORGANIZATION_LICENSE_ADMIN_CORRECTED/);
  assert.match(licenseService, /transaction\.set\(auditRef/);
});
