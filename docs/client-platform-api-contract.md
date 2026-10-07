# Ventale Client-to-Platform API contract (v1)

This is the authoritative transport contract for the Ventale Client App. It
uses the Developer Console's trusted Platform backend and its existing
subscription/provisioning transaction. New Client work must use these versioned
routes, rather than the older unversioned Console integration routes.

## Base URL and transport model

The Client App **server runtime** must configure this server-only environment
variable:

```text
VENTALE_PLATFORM_API_BASE_URL
```

It contains the origin only, without a trailing API path.

| Environment | Value / configuration |
| --- | --- |
| Local development | `http://localhost:3001` |
| UAT/staging | An environment-specific Platform origin supplied through `VENTALE_PLATFORM_API_BASE_URL` in the Client App server deployment configuration |
| Production | The production Platform origin supplied through the same server-only deployment variable |

Do not use a `NEXT_PUBLIC_` variable and do not hardcode a production origin in
the Client App. The paths below are appended to that origin.

The supported integration is **Option 2: a same-origin Client App server proxy**.
The browser calls a Client App route; that route forwards the Firebase ID token
to the Platform API. Browser code does not call the Developer Console origin
directly.

- The Platform API does not enable cross-origin browser access and sends no
  `Access-Control-Allow-Origin` header.
- Wildcard origins are prohibited. There is no direct-browser CORS allowlist in
  this release.
- The proxy forwards `Authorization`, and for provisioning,
  `Idempotency-Key` and `Content-Type: application/json`.
- The Platform uses bearer tokens, not cross-site cookies. The proxy must not
  use `credentials: include` when contacting the Platform origin.

## Endpoint summary

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/plans` | None | List plans currently available for public signup |
| `POST` | `/api/v1/trials` | Firebase ID token + `Idempotency-Key` | Provision one new workspace and its trial license atomically |
| `GET` | `/api/v1/subscription?workspaceId={workspaceId}` | Firebase ID token | Read the caller-authorized workspace's canonical license state |

There is intentionally no versioned eligibility or license-link route. Public
availability comes from `GET /api/v1/plans`; `POST /api/v1/trials` evaluates
eligibility, provisions, and links the canonical license in its single trusted
transaction. New Client App work must use only these three versioned routes.

All successful responses use:

```json
{ "success": true, "data": {} }
```

All errors use:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request is invalid."
  }
}
```

The stable error envelope intentionally excludes stack traces, Firebase/Admin
errors, database paths, counter state, and eligibility implementation details.

## Existing compatibility routes — do not use for new Client integration

The following routes still exist for pre-V1 Console/Client compatibility. They
are not aliases for the V1 contract: several expose a different data model,
use generic Console error codes, and trial/link requests have no
`Idempotency-Key` replay contract. Do not mix them with `/api/v1/*` in a new
Client implementation.

| Method | Path | Auth | Exact request | Successful `data` shape |
| --- | --- | --- | --- | --- |
| `GET` | `/api/public/signup-plans` | None | None | Array of `{ planId, code, name, displayName, price, currency, billingInterval, trialDays, noCreditCardRequired, maxEligibleCustomers, publicSignup }` |
| `GET` | `/api/public/signup-plan` | None | None | The first item from the preceding array; `404 NOT_FOUND` if none is available |
| `POST` | `/api/client/licensing/eligibility` | Firebase ID token; active `ADMIN` membership | `{ organizationId, planId? , planCode? }`; at least one plan field is required and both must match if supplied | `{ organizationId, plan, usage, eligible, reason?, idempotent, legacy }` where `plan` is the public-plan shape above and `usage` includes `{ planId, eligibleCustomerCount, limit, remaining, isFull, source, updatedAt? }` |
| `POST` | `/api/client/licensing/trial` | Firebase ID token; active `ADMIN` membership for an existing organization, or a valid token for legacy workspace bootstrap | `{ organizationId?, planId? , planCode?, workspace? }`; existing organization requires `organizationId`; bootstrap requires `workspace` and forbids `organizationId` | Existing-organization/bootstrapped subscription result: `{ workspaceId, organizationId, plan, license, auditLogId, idempotent, legacy? }` |
| `POST` | `/api/client/licensing/link` | Same as legacy trial | Exactly the legacy trial request | Exactly the legacy trial response; it delegates to the same handler |
| `GET` | `/api/client/licensing?organizationId={organizationId}` | Firebase ID token; active `ADMIN`, `MANAGER`, or `USER` membership | Query `organizationId` | `{ organizationId, license }`; `license` is the legacy lower-case subscription projection or `null` if the nested document is absent/invalid |

The legacy bootstrap `workspace` object uses `name` rather than V1
`businessName`; its allowed fields are `name`, `requestedSlug`, `businessType`,
`phone`, `website`, `currency`, and `timezone`. Its license status is the
legacy lower-case subscription status (`trialing`, `active`, `expired`, or
`cancelled`), not the V1 canonical status. These routes return the generic
`{ success, data }` / `{ success: false, error: { code, message } }` Console
envelope, but their error-code vocabulary is not the stable V1 vocabulary.

## Authentication

Every protected endpoint requires exactly this header:

```http
Authorization: Bearer <Firebase ID token>
```

No client-supplied UID, organization identity header, platform-admin role, or
service-account credential is accepted. The Platform verifies the Firebase ID
token with Firebase Admin SDK revocation checking enabled, derives the UID from
the verified token, and fails closed for missing, invalid, expired, or revoked
tokens.

`GET /api/v1/subscription` additionally verifies that the derived UID is an
active member of `workspaceId` with role `ADMIN`, `MANAGER`, or `USER`.
Platform-admin membership does not bypass tenant membership.

## `GET /api/v1/plans`

This endpoint returns only commercial data required for public signup. It
contains neither Founding usage counters nor tenant information.

```http
GET /api/v1/plans
```

```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "code": "founding_100",
        "name": "Founding 100",
        "price": 99,
        "currency": "USD",
        "billingInterval": "year",
        "trialDays": 14,
        "requiresCard": false,
        "available": true,
        "marketing": {
          "badge": "Limited to the first 100 customers",
          "messages": [
            "Keep your Founding rate for as long as your subscription remains active.",
            "Standard price after the first 100: $149/year"
          ]
        }
      }
    ]
  }
}
```

Only a plan whose trusted catalog `publicSignup` flag is on and whose capped
allocation is below its Platform-configured capacity appears in `plans`.
`available` is therefore always `true` for returned items. The configured
capacity, usage counter, and eligibility mechanics are intentionally not
returned. Switching `founding_100` off and `standard` on, or increasing a full
Founding capacity, changes this response without a Client App deploy.

`marketing` is optional, display-only Platform plan metadata. When present it
contains only a `badge` string and an ordered `messages` string array. The
Client may render it but must not use it for price, eligibility, entitlement,
seat, trial, or authorization logic. The Platform returns Founding marketing
only when the Founding offer itself is available; no usage counts or internal
allocation details are exposed. Plans without configured promotional copy,
including Standard at launch, omit `marketing`.

The Platform Console owns this copy through a separate `SUPER_ADMIN`-only
marketing editor. Configuration update metadata and audit details are never
returned here. This endpoint is dynamic and sends `Cache-Control: no-store`,
so the next request reflects a completed Platform marketing edit.

## `POST /api/v1/trials`

This endpoint is for new workspace provisioning. It creates the organization,
active admin membership, canonical trial license, derived organization mirrors,
usage allocation, bootstrap record, idempotency record, and audit record in one
trusted Firestore transaction.

### Required headers

```http
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
Idempotency-Key: 9b5ccf3a-1ed7-4c1c-a2a3-34bd5e2d0d64
```

`Idempotency-Key` is required. It must match
`^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$`: 16–128 opaque ASCII characters. The
raw key is not stored as a Firestore document ID or returned in an API response.

### Exact request JSON

```json
{
  "productCode": "founding_100",
  "workspace": {
    "businessName": "Acme Studio",
    "requestedSlug": "acme-studio",
    "businessType": "Agency",
    "phone": "+63 900 000 0000",
    "website": "https://acme.example",
    "currency": "USD",
    "timezone": "Asia/Manila"
  }
}
```

`productCode`, `workspace.businessName`, `workspace.businessType`,
`workspace.currency`, and `workspace.timezone` are required. `requestedSlug`,
`phone`, and `website` are optional. If `requestedSlug` is omitted, the
Platform derives a slug from `businessName`. A supplied slug must be lowercase
and match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (maximum 64 characters).

All accepted workspace values are strings of at most 200 characters.
`workspace.currency` must be one of `PHP`, `USD`, `AUD`, `SGD`, `EUR`, `GBP`;
`workspace.timezone` must be a valid IANA time-zone name. `website` is stored
as an approved business-profile string; this API does not treat it as a domain
verification request.

The request is allowlist-only. It rejects fields such as `uid`, `price`,
`currency` outside `workspace`, `entitlementTier`, `plan`, `licenseStatus`,
`trialDays`, `seatLimit`, `maxUsers`, `storageLimit`, `subscriptionStatus`,
and arbitrary workspace settings.

### Successful response JSON

A newly committed provisioning request returns HTTP `201`:

```json
{
  "success": true,
  "data": {
    "workspaceId": "generatedOrganizationId",
    "organizationId": "generatedOrganizationId",
    "productCode": "founding_100",
    "legacy": false,
    "idempotent": false,
    "provisioningStatus": "PROVISIONED",
    "license": {
      "plan": "TRIAL",
      "status": "TRIAL",
      "trialStartedAt": "2026-09-13T00:00:00.000Z",
      "trialEndsAt": "2026-09-27T00:00:00.000Z",
      "subscriptionStartedAt": null,
      "renewalDate": null,
      "expirationDate": "2026-09-27T00:00:00.000Z",
      "maxUsers": 3,
      "billingInterval": "year"
    }
  }
}
```

All date values are RFC 3339 UTC strings or `null`. `provisioningStatus` is
one of:

- `PROVISIONED` — this request committed a new workspace/license.
- `REUSED` — the same caller already has the matching committed workspace or
  the same idempotency record was replayed; HTTP `200`.
- `LEGACY_RECONCILED` — a valid V1 workspace/license was found; no new
  workspace, license, trial, or commercial allocation was created; HTTP `200`.

## Idempotency behavior

Idempotency is scoped to **authenticated Firebase UID + `POST /api/v1/trials`
+ opaque key**. The Platform stores a hash of that scope and a hash of the
normalized approved request payload. The replay record is committed in the same
transaction as the workspace and license.

| Situation | Behavior |
| --- | --- |
| Same UID, key, and normalized request | Return the previously committed result with HTTP `200` and `idempotent: true` |
| Same key, different approved payload, same UID | HTTP `409`, `IDEMPOTENCY_CONFLICT`; no writes |
| Same raw key, different Firebase UID | Separate scoped records; neither identity can read or alter the other's result |
| Response lost after the transaction committed | Retry the same request/key; receive the committed result, without duplicate writes |
| Concurrent identical requests | Firestore transaction serialization allows one commit; the other request replays the same committed result |

Each record has a 30-day `retentionUntil` marker. There is no automatic cleanup
job in this release, so records are retained at least 30 days and remain safely
replayable until an explicitly authorized retention job is introduced. Clients
must treat idempotency keys as single-use and should retain them for retrying a
single onboarding attempt.

## `GET /api/v1/subscription`

```http
GET /api/v1/subscription?workspaceId=generatedOrganizationId
Authorization: Bearer <Firebase ID token>
```

`workspaceId` is required and is validated server-side. The Platform derives
identity from the ID token and verifies active tenant membership before reading
the canonical license. It never accepts a browser-supplied UID or trusts an
organization mirror as license authority.

```json
{
  "success": true,
  "data": {
    "workspaceId": "generatedOrganizationId",
    "organizationId": "generatedOrganizationId",
    "productCode": "founding_100",
    "legacy": false,
    "license": {
      "plan": "TRIAL",
      "status": "TRIAL",
      "trialStartedAt": "2026-09-13T00:00:00.000Z",
      "trialEndsAt": "2026-09-27T00:00:00.000Z",
      "subscriptionStartedAt": null,
      "renewalDate": null,
      "expirationDate": "2026-09-27T00:00:00.000Z",
      "maxUsers": 3,
      "billingInterval": "year"
    }
  }
}
```

The `license.plan` field is the existing stable Client entitlement value:
`TRIAL`, `SOLO`, `STARTER`, `TEAM`, or `LEGACY`. `license.status` is only one of
`TRIAL`, `ACTIVE`, `EXPIRED`, or `SUSPENDED`. There is no `CANCELLED`,
`INACTIVE`, or commercial-only status in this contract.

## Canonical license synchronization

The canonical document remains:

```text
organizations/{organizationId}/license/current
```

The V1 transport contract uses **the provisioning response initially, then
`GET /api/v1/subscription` for explicit refresh/status reads**. In practice:

1. After a successful `POST /api/v1/trials`, use the returned `workspaceId`,
   `productCode`, and `license` immediately.
2. On application reload, token refresh, workspace switch, or any explicit
   subscription-status refresh, call `GET /api/v1/subscription` through the
   Client App server proxy.
3. An existing Client App Firestore listener may continue to observe the
   canonical document for its established Client authorization behavior, but
   it is outside this HTTP transport contract and must never become a
   Client-side license-writing path.

The Client must not infer entitlement from an organization-root mirror. The
Platform API and canonical `license/current` document remain authoritative;
the root mirrors are server-derived enforcement compatibility fields.

## Commercial product versus Client entitlement

Commercial identity is separate from the stable Client authorization tier:

| Product code | Frozen paid entitlement | Trial `license.plan` |
| --- | --- | --- |
| `founding_100` | `STARTER` | `TRIAL` |
| `standard` | `STARTER` | `TRIAL` |

Both offers grant `STARTER`; pricing and availability do not create different
Client authorization logic. The Platform stores the frozen future tier
server-side as part of the canonical commercial license. It deliberately does
not accept or expose that server-only field as a browser-selected entitlement.
When a trial becomes active, trusted Platform lifecycle logic moves the
canonical `license.plan` to the stored tier.

## Legacy V1 behavior

V1 licenses with no commercial `planId` remain valid. The subscription read
returns `legacy: true` and `productCode: null`, while preserving their existing
stable `license.plan` and status. Provisioning detects a valid V1 workspace
before creating anything and returns `LEGACY_RECONCILED`; it does not create a
second trial, relabel the entitlement, increment Founding usage, or require a
destructive migration.

## Errors and HTTP status mapping

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Missing, invalid, expired, or revoked Firebase ID token |
| 403 | `FORBIDDEN` | No active membership for the requested workspace |
| 400 | `INVALID_REQUEST` | Invalid JSON, missing header/field, or unsupported field |
| 400 | `INVALID_PLAN` | Unknown or malformed commercial product code |
| 409 | `PLAN_UNAVAILABLE` | A known product is not currently public for signup |
| 409 | `FOUNDING_LIMIT_REACHED` | The trusted Founding 100 allocation is full |
| 409 | `TRIAL_ALREADY_EXISTS` | A current trial/subscription blocks a distinct trial operation |
| 409 | `WORKSPACE_ALREADY_EXISTS` | The account or requested slug already resolves to a non-reusable workspace state |
| 409 | `IDEMPOTENCY_CONFLICT` | Key was reused with a different request or invalid replay record |
| 404 | `LICENSE_NOT_FOUND` | Authorized workspace has no valid canonical license |
| 500 | `PROVISIONING_FAILED` | Provisioning could not complete safely; retry with the same key |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |

`/api/v1/trials` favors `REUSED` or `LEGACY_RECONCILED` for a safely detected
existing workspace. `TRIAL_ALREADY_EXISTS` remains a stable error for a
distinct trial operation that detects a current license rather than a safe
provisioning replay.

## Data and security boundary

These endpoints use Firebase Admin only on the Platform server. They do not
change Firebase Rules and do not grant arbitrary Firestore access. No response
contains leads, clients, deals, tasks, notes, documents, sales data, member
PII, Firestore paths, customer CRM records, platform counters, price authority,
seat authority, storage authority, lifecycle authority, or service-account
credentials.
