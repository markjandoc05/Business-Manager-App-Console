# Mac Console reconciliation — 2026-10-07

This isolated integration starts from accepted cloud/native candidate bd7a4446daa74dcb7a567d6905b874c8fb70cf80 and preserves the Mac unpublished snapshot based on52e311d29907e4b116dfc0d9324d871afc5c22e7. Original work and accepted candidates were not overwritten. Raw BASE/CLOUD/MAC/MERGED artifacts and source hashes remain in the private handoff.

| Conflict file | Resolution |
| --- | --- |
| app/api/audit-logs/route.ts | Preserve all six Mac filter parameters and bounded page contract; retain platform authorization. |
| components/console/AuditLogsModule.tsx | Preserve sanitized filter/details interface; key tenant scope and invalidate prior requests to prevent stale response replacement. |
| components/console/LicensingModule.tsx | Preserve Mac Plan/Subscription composition; retain role checks in its active child editors. |
| components/console/OrganizationDetailModule.tsx | Preserve organization operations projection and registration controls; clear/gate privileged reset drafts on role loss. |
| components/console/OrganizationUsageSection.tsx | Preserve current Mac presentation; clear/gate usage and limit dialogs on role loss. |
| components/console/PlatformAdminsModule.tsx | Preserve cursor pages and current mutation contract; clear/gate privileged drafts on role loss. |
| components/console/UsersModule.tsx | Preserve tenant member pages and operations; retain current role gates, including immediate Add Member gating. |
| docs/phase-1a-license-contract.md | Preserve commercial contract and document expiration-aware canonical/root mirrors. |
| lib/console-api.ts | Preserve active Mac route/shape contracts and six-field audit filters. |
| lib/server/console-read-service.ts | Preserve sanitized Mac projections/pages; retain bounded full legacy organization reads, bounded hydration, indexed organization audits, and scoped cursor validation. |
| lib/server/dashboard-service.ts | Preserve Mac dashboard projection plus bounded complete reads and fanout. |
| lib/server/license-service.ts | Preserve commercial entitlement snapshots and atomic capacity accounting; use expiration-aware buildOrganizationLicenseState. |
| lib/server/organization-usage-service.ts | Read current limit in the transaction, preserve concurrent limits, and return committed usage; retain the Mac writer's metadata allowlist instead of reintroducing raw before/after values or emails. |
| tests/console-license-contract.test.mjs | Assert preserved current commercial/mirror contract. |
| tests/dashboard-metrics-contract.test.mjs | Assert complete bounded metrics with current projection. |

Three clean overlaps (lib/types.ts, lib/license-contract.ts, tests/console-admin-controls.integration.test.mjs) were retained and runtime validated. Nonoverlapping Mac source and its deletions were integrated separately.

Further validation corrections retain existing contracts: exclude unimported numbered backup components from TypeScript/lint while preserving their source; remove the unsupported cancel route whose action contradicts the explicit no-cancel contract. Cancellation remains subscription metadata attached to canonical SUSPENDED state.

Global Client account authorization now requires exact UID/status and active alias consistency. Only a transaction-proven first-time identity with no workspace/bootstrap/replay links may create a missing profile or activate the canonical pending/active:false profile produced by trusted Client bootstrap. Existing/replayed workspaces require a present active global profile. Replay also checks current active ADMIN membership and organization existence. Add Member similarly cannot repair a blocked or previously linked profile, and cannot add a disabled Auth account.

Recent detail audit previews order by createdAt before limiting. Member actions remain included with only id/action/actorRole/createdAt. Full history stays separately paginated. No email, target UID, raw values, tokens, or CRM data was added to these projections.

The paired Client parser now accepts actual REUSED responses only with idempotent=true and the requested product, preserves current lifecycle state, and leaves authorization to canonical workspace state. Initial PROVISIONED responses retain trial/date validation.

No pricing, trial length, entitlement mapping, customer capacity, tenant role, per-customer deployment, or expired-trial conversion policy was selected or changed. No production operation is authorized by this document.
