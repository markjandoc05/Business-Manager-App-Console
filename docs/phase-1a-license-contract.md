# Phase 1A license contract

The Client App repository at `/Users/markjandoc/Documents/Business-Manager-App`
is authoritative.

## Canonical source

```text
organizations/{orgId}/license/current
```

The canonical document fields are:

- `plan`: `TRIAL`, `STARTER`, `TEAM`, or `LEGACY`
- `status`: `TRIAL`, `ACTIVE`, `EXPIRED`, or `SUSPENDED`
- `trialStartedAt`, `trialEndsAt`
- `subscriptionStartedAt`, `subscriptionEndsAt`
- `maxUsers`
- `features`
- `createdAt`, `updatedAt`, `updatedBy`

The organization document contains enforcement mirrors only:

- `licenseStatus`
- `licenseWriteEnabled`
- `licenseExpiresAt`

The Client App rules use the mirrors for business-write enforcement. A trial
or active subscription is writable until its corresponding end timestamp;
suspended and expired licenses are read-only. Missing canonical license data is
not silently converted to an active license by the Console.

## Console alignment

The Console reads the nested canonical document and treats an embedded
organization `license` field as non-authoritative. Privileged mutations use a
single Admin SDK transaction that writes both:

1. `organizations/{orgId}/license/current`
2. the three organization enforcement mirrors
3. the platform audit record

The mutation lifecycle follows the Client App management script: activate,
renew/extend, suspend, expire-by-policy, and reactivate only when a current
trial or subscription remains valid. The Console does not introduce an
organization lifecycle field in this phase.

## Rules merge recommendation

Use the Client App’s complete `firestore.rules` as the base. Merge only the
Console platform-admin read helper and read matches from
[`firestore.console.rules.fragment`](../firestore.console.rules.fragment).
Preserve the Client App rules for tenant membership, license reads, mirror
enforcement, deals, tasks, activities, settings, and legacy-root denial.

Do not deploy this repository’s standalone `firestore.rules`; it is not the
complete shared ruleset.
