import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [commercial, plans, licenses] = await Promise.all([
  import('../lib/commercial-entitlement-contract.ts'),
  import('../lib/subscription-plan-contract.ts'),
  import('../lib/license-contract.ts'),
]);

test('commercial products resolve to the documented stable entitlement tier', () => {
  assert.equal(commercial.commercialProductEntitlement('founding_100')?.entitlementTier, 'STARTER');
  assert.equal(commercial.commercialProductEntitlement('standard')?.entitlementTier, 'STARTER');
  assert.equal(commercial.commercialProductEntitlement('founding_100')?.storageLimitBytes, null);
  assert.equal(commercial.commercialProductEntitlement('standard')?.storageLimitBytes, null);
  assert.equal(commercial.commercialProductEntitlement('unknown_product'), null);
  assert.equal(plans.parseSubscriptionPlan('founding_100', plans.DEFAULT_SUBSCRIPTION_PLANS.founding_100)?.entitlementTier, 'STARTER');
  assert.equal(plans.parseSubscriptionPlan('standard', plans.DEFAULT_SUBSCRIPTION_PLANS.standard)?.entitlementTier, 'STARTER');
  assert.equal(plans.parseSubscriptionPlan('unknown_product', { ...plans.DEFAULT_SUBSCRIPTION_PLANS.standard, code: 'unknown_product' }), null);
});

test('catalog projections cannot override the platform-owned mapping', () => {
  assert.equal(plans.parseSubscriptionPlan('founding_100', { ...plans.DEFAULT_SUBSCRIPTION_PLANS.founding_100, entitlementTier: 'TEAM' }), null);
  // Pre-mapping catalog documents remain readable: the resolver fills their
  // fixed server-side projection rather than requiring a destructive rewrite.
  const legacyCatalogDocument = { ...plans.DEFAULT_SUBSCRIPTION_PLANS.standard };
  delete legacyCatalogDocument.entitlementTier;
  assert.equal(plans.parseSubscriptionPlan('standard', legacyCatalogDocument)?.entitlementTier, 'STARTER');
});

test('canonical licenses preserve the Client plan contract while freezing paid entitlement', () => {
  const now = Date.now();
  const trial = licenses.parseCanonicalLicense({
    organizationId: 'commercial-contract-trial', planId: 'founding_100', entitlementTier: 'STARTER', plan: 'TRIAL', status: 'TRIAL', subscriptionStatus: 'trialing', maxUsers: 3, features: {},
    trialStartedAt: new Date(now), trialEndsAt: new Date(now + 86_400_000),
  });
  assert.equal(trial?.plan, 'TRIAL');
  assert.equal(trial?.entitlementTier, 'STARTER');
  const active = licenses.parseCanonicalLicense({
    organizationId: 'commercial-contract-active', planId: 'standard', entitlementTier: 'STARTER', plan: 'STARTER', status: 'ACTIVE', subscriptionStatus: 'active', maxUsers: 3, features: {},
    subscriptionStartedAt: new Date(now), subscriptionEndsAt: new Date(now + 86_400_000),
  });
  assert.equal(active?.plan, 'STARTER');
  assert.equal(active?.entitlementTier, 'STARTER');
  assert.equal(licenses.parseCanonicalLicense({
    organizationId: 'commercial-contract-invalid', planId: 'standard', entitlementTier: 'STARTER', plan: 'TEAM', status: 'ACTIVE', subscriptionStatus: 'active', maxUsers: 7, features: {},
    subscriptionStartedAt: new Date(now), subscriptionEndsAt: new Date(now + 86_400_000),
  }), null);
});

test('all supported V1 tiers remain valid without a commercial product link', () => {
  const now = Date.now();
  const v1Trial = licenses.parseCanonicalLicense({
    plan: 'TRIAL', status: 'TRIAL', maxUsers: 3, features: {}, trialStartedAt: new Date(now), trialEndsAt: new Date(now + 86_400_000),
  });
  assert.equal(v1Trial?.planId, undefined);
  assert.equal(v1Trial?.entitlementTier, undefined);
  for (const plan of ['SOLO', 'STARTER', 'TEAM', 'LEGACY']) {
    const legacy = licenses.parseCanonicalLicense({
      plan, status: 'ACTIVE', maxUsers: plan === 'SOLO' ? 1 : 3, features: {}, subscriptionStartedAt: new Date(now), subscriptionEndsAt: new Date(now + 86_400_000),
    });
    assert.equal(legacy?.plan, plan);
    assert.equal(legacy?.planId, undefined);
    assert.equal(legacy?.entitlementTier, undefined);
  }
});

test('Client request boundary permits only product selection and workspace metadata', async () => {
  const handler = await readFile(new URL('../lib/server/client-subscription-handler.ts', import.meta.url), 'utf8');
  assert.match(handler, /requirePlanSelectionOnly/);
  assert.match(handler, /Unsupported subscription request field/);
  assert.doesNotMatch(handler, /\['organizationId', 'planId', 'planCode', 'entitlementTier'/);
  assert.doesNotMatch(handler, /\['organizationId', 'planId', 'planCode', 'seatLimit'/);
  assert.doesNotMatch(handler, /\['organizationId', 'planId', 'planCode', 'storageLimitBytes'/);
});
