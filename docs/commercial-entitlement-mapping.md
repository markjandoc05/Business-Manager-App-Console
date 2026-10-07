# Commercial product to Client entitlement mapping

## Decision

Commercial products and Client App authorization tiers are intentionally
separate.

| Platform product code | Offer distinction | Granted stable tier |
| --- | --- | --- |
| `founding_100` (`FOUNDING_100` display label) | Founding price and a Platform-configured customer-capacity (default 100) | `STARTER` |
| `standard` (`STANDARD` display label) | Standard price and unlimited enrollment | `STARTER` |

Both offers grant `STARTER`. They are not different entitlement tiers merely
because their price and signup policy differ. The authoritative mapping lives
in `lib/commercial-entitlement-contract.ts`; it is not editable through the
Console plan editor or a Client/browser request.

## Canonical license contract

The existing Client App canonical document remains:

```text
organizations/{organizationId}/license/current
```

For a commercial-product-linked license the Platform writes:

- `planId`: commercial product code (`founding_100` or `standard`)
- `entitlementTier`: immutable paid-tier snapshot (`STARTER`)
- `plan`: existing Client-supported entitlement value
- `status`: existing Client lifecycle value (`TRIAL`, `ACTIVE`, `EXPIRED`, or
  `SUSPENDED`)
- commercial lifecycle and price snapshot fields already used by the Platform
  (`subscriptionStatus`, trial/subscription dates, price, currency, interval)
- `maxUsers`: derived from the platform’s stable entitlement configuration

During a trial, `plan` deliberately remains `TRIAL` and `status` remains
`TRIAL`; this preserves the Client App contract. `entitlementTier: STARTER`
records the paid tier that the product grants. On conversion to an active
subscription, trusted Platform logic changes `plan` to the stored
`entitlementTier` (`STARTER`). The Client App continues authorizing only from
the supported `license.plan` and lifecycle values; it does not authorize from
commercial `planId` or `entitlementTier`.

There is no commercial storage entitlement today. The mapping explicitly
states `storageLimitBytes: null`; no storage field is added to the canonical
license or organization mirror until an enforceable Client contract exists.
Browser-provided storage values are rejected.

## Mirrors and atomicity

`license/current` is authoritative. The only organization-root enforcement
mirrors are written from it in the same Admin SDK transaction:

- `licenseStatus`
- `licenseWriteEnabled`
- `licenseExpiresAt`
- `maxUsers`

Historical root `status`, `plan`, and `subscriptionStatus` fields are
informational compatibility values, not entitlement authority. New workspace
provisioning writes them coherently, but all authorization and operations reads
use the canonical nested license and the four derived mirrors.

A successful commercial trial provisioning transaction includes the catalog
validation, product-to-tier resolution, canonical license, organization
mirrors, usage allocation, workspace bootstrap state (where applicable), and
platform audit record. A failure commits none of those writes.

## Legacy V1 behavior

V1 licenses without `planId` or `entitlementTier` remain valid Client licenses.
If a V1 `TRIAL` or `ACTIVE` license is encountered, trial/link and workspace
provisioning requests return that existing license idempotently without:

- creating another trial or organization;
- incrementing `platformPlanUsage`;
- relabeling the license as `founding_100` or `standard`; or
- changing its existing Client entitlement tier.

Pre-mapping commercial records retain their existing paid `plan` as their
snapshot when they are explicitly operated on. A product-linked trial without
a prior snapshot resolves once from the fixed platform mapping. No destructive
migration is required.

## Security and change control

Client requests accept only a product selection plus permitted workspace
metadata. Product price, trial length, availability, product cap, entitlement
tier, seats, storage, and license lifecycle are server-derived. Active Firebase
authentication and organization membership are required before tenant-scoped
operations; `platformAdmins` do not bypass that boundary.

The Founding capacity is a commercial allocation control only. It is stored as
`platformPlans/founding_100.foundingLimit`, can be changed only through the
trusted `SUPER_ADMIN` Console mutation, and is checked inside the provisioning
transaction. It does not change the product code, existing price snapshots,
stable `STARTER` entitlement, seat limits, or Client authorization behavior.

The plan update API does not accept `entitlementTier`. A malformed persisted
catalog mapping fails closed. Existing licenses retain their stored
`entitlementTier`, so a future deliberate mapping change cannot silently alter
existing customers.
