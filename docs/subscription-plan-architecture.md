# Ventale subscription plan architecture

The Developer Console owns the platform subscription catalog. The initial
catalog is:

| Plan | Code | Price | Trial | Signup | Eligible-customer limit |
| --- | --- | --- | --- | --- | --- |
| Founding 100 | `founding_100` | `$99 USD/year` | 14 days, no card | ON | 100 by default; configurable by `SUPER_ADMIN` |
| Standard | `standard` | `$149 USD/year` | 14 days, no card | OFF | Unlimited |

## Firestore model

Plans and licenses are separate documents:

- `platformPlans/{planId}` is the source of truth for display name, price,
  currency, interval, trial policy, public signup, the Founding `foundingLimit`, and
  optional public display-only marketing copy (`badge` and `messages`). The
  copy is not an entitlement, eligibility, or provisioning input.
- `platformPlanUsage/{planId}` is a server-maintained allocation counter. The
  counter is used by the Founding 100 transaction so two concurrent trials
  cannot both claim the last available slot.
- `organizations/{organizationId}/license/current` remains the existing
  Client App canonical license document. New records add `planId`,
  `entitlementTier`, `subscriptionStatus`, `organizationId`, `renewalDate`,
  `priceAtSubscription`, `currency`, and `billingInterval`.

The existing uppercase `status` and organization enforcement mirrors remain in
place for Client App compatibility. `subscriptionStatus` is the platform
subscription state: `trialing`, `active`, `expired`, or `cancelled`. A price is
copied onto the license when the trial/license is linked, so later catalog
price edits do not rewrite the customer’s snapshot. The canonical product map
is documented in [commercial-entitlement-mapping.md](./commercial-entitlement-mapping.md):
both `founding_100` and `standard` grant the stable `STARTER` tier. During a
trial, `license.plan` stays `TRIAL` for Client compatibility and the frozen
paid tier is recorded separately as `entitlementTier`.

The only enforcement mirrors on the organization root are `licenseStatus`,
`licenseWriteEnabled`, `licenseExpiresAt`, and `maxUsers`; they are derived
from the nested canonical license in the same transaction. Root `status`,
`plan`, and `subscriptionStatus` values are compatibility metadata, not
authorization inputs.

The `founding_100` plan stores a positive integer `foundingLimit` (default
`100`, maximum `100000`) as its authoritative customer-allocation capacity.
`maxEligibleCustomers` is retained only as a compatibility projection and is
written atomically to the same value; allocation and eligibility use
`foundingLimit`. Existing catalog documents without the new field resolve to
the safe historical default on read. An explicit Console catalog bootstrap can
persist that backfill; ordinary reads do not modify data.

Display-only marketing remains a separately versioned plan setting. Capacity
changes do not rewrite operator-authored marketing copy; an administrator must
review any copy that names a customer count after changing the capacity.

Founding 100 also stores `autoRolloverEnabled: false` and
`autoRolloverPlanId: standard`. Those fields reserve the policy for a future
automatic rollover job; current behavior is manual signup switching. The
current Console API does not permit enabling rollover. The Founding capacity is
the one explicit manual enrollment-limit control; Standard remains uncapped.

### Display-only plan marketing

The Console exposes a separate **Plan Marketing** page for active Platform
`SUPER_ADMIN` accounts. Its dedicated mutation surface can change only
`marketing`, which is an optional plain-text object with an optional badge
(maximum 160 characters) and one to three messages (maximum 300 characters
each). It cannot change price, commercial code, public signup, allocation
limits, trial policy, entitlement, licensing, or provisioning configuration.

Each change is an Admin SDK transaction that records an incrementing marketing
revision, update time, and actor UID internally, along with a minimal audit
event. The public plan response never returns this metadata. An explicit clear
retains a private marker in the catalog so the Founding default copy is not
silently restored; public responses simply omit `marketing`. Existing catalog
documents without the new field continue to use the configured Founding
default without a data migration.

## APIs

Console-admin APIs require the existing platform-admin authorization layer:

- `GET /api/subscription-plans` — list plans and usage counts.
- `POST /api/subscription-plans` — initialize missing default plan documents;
  `SUPER_ADMIN` only.
- `PATCH /api/subscription-plans/{planId}` — edit configuration or toggle
  `publicSignup`; `SUPER_ADMIN` only.
- `PATCH /api/subscription-plans/founding_100/capacity` — accepts only
  `{ "foundingLimit": integer }`; validates `1..100000`, rejects a value below
  the canonical eligible Founding usage with `FOUNDING_LIMIT_BELOW_USAGE`, and
  is `SUPER_ADMIN` only. It does not change public-signup, licenses, pricing,
  entitlement, or the product code.
- `PATCH /api/subscription-plans/{planId}/marketing` — update only validated
  display marketing with optional optimistic `expectedRevision`; `SUPER_ADMIN`
  only.
- `DELETE /api/subscription-plans/{planId}/marketing` — clear only display
  marketing with optional optimistic `expectedRevision`; `SUPER_ADMIN` only.

Client-facing APIs use Firebase ID tokens plus active organization membership;
they never accept plan prices, limits, signup flags, or license status from the
caller:

- `GET /api/public/signup-plans` — currently public, non-full plans only.
- `GET /api/public/signup-plan` — compatibility response for clients that
  support one current public plan.
- `POST /api/client/licensing/eligibility` — validate `{ organizationId,
  planId }` as an active organization admin.
- `POST /api/client/licensing/trial` — atomically create/link a trial license
  for `{ organizationId, planId }`, or provision a new workspace and license
  for the prepared Client App `{ planCode, workspace }` onboarding boundary.
- `POST /api/client/licensing/link` — integration alias for trial linking.
- `GET /api/client/licensing?organizationId=...` — return the current tenant
  license status to an active organization member.

Client tenant authorization is separate from `platformAdmins`. Console roles do
not grant access to another organization through these routes. Firestore rules
are unchanged; browser writes remain disabled and the Admin SDK performs the
privileged plan/license/counter writes.

The final versioned Client integration surface is documented separately in
[client-platform-api-contract.md](./client-platform-api-contract.md). It uses
`GET /api/v1/plans`, `POST /api/v1/trials`, and
`GET /api/v1/subscription?workspaceId=...` as thin transport facades over these
same services; it does not duplicate the licensing transaction.

The sibling Client App’s current license-create allowlist contains only its
legacy onboarding fields and all later license updates are denied. The new
`planId`, `subscriptionStatus`, pricing snapshot, and plan catalog fields are
therefore server-only additions; no production Client App rules were changed
by this task.

## Idempotency and allocation verification

Trial and workspace-provisioning retries return the existing same-plan license
without writing a new license, counter, or audit record. Valid V1 licenses with
no commercial `planId` return safely without a commercial relabel or a second
trial. The initial write and the `platformPlanUsage` increment occur in one
Firestore transaction. For the capped Founding plan, that transaction uses the
configured `foundingLimit` and the higher of the counter and the canonical
eligible-license count, so a stale low counter fails closed rather than
admitting a customer beyond the configured capacity. Raising capacity makes a
public Founding offer available immediately when `publicSignup` remains on; it
never changes existing licenses.

`compareFounding100Usage()` is a read-only maintenance check that compares the
stored Founding counter with canonical eligible (`trialing` or `active`)
licenses and reports configured and remaining capacity. It does not modify any
data. The existing write-capable
`reconcileSubscriptionPlanUsage()` is not exposed through an API route and is
reserved for an explicit operator maintenance action.

The canonical comparison and allocation guard intentionally scan only
`license/current` documents and filter the product code in trusted server
code. This keeps configured-capacity enforcement and Console reconciliation
independent of an optional Firestore collection-group index on `planId`; no
Rules or index change is required for the V1 transport endpoints.

## Initialization and maintenance

The repository does not write production data as part of this implementation.
Run the guarded bootstrap command when an operator explicitly wants to create
the two missing catalog documents:

```text
FIREBASE_ADMIN_PROJECT_ID=bsm-client-app-web npm run bootstrap:subscription-plans
FIREBASE_ADMIN_PROJECT_ID=bsm-client-app-web npm run bootstrap:subscription-plans -- --apply --confirm-project-id bsm-client-app-web
```

The first command is a dry run. An explicit apply creates only missing catalog
documents and may backfill `foundingLimit: 100` only on a known historical
Founding document whose legacy `maxEligibleCustomers` is exactly `100`; any
other existing shape requires review. The Console’s explicit catalog-initialize
action uses the same guarded compatibility backfill. Neither path runs
automatically or alters licenses or usage.
