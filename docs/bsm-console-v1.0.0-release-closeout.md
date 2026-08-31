# BSM Console v1.0.0 release closeout

## Stable baseline

- Stable source commit: `e7bc13e`
- Stable Cloud Run revision: `bsm-console-candidate-5b-20260824`
- Rollback revision: `bsm-console-00009-gj4`
- Project: `bsm-client-app-web`
- Region: `asia-southeast1`
- Production domain: `https://console.aiph.tech`
- Runtime service account: `bsm-console-runtime@bsm-client-app-web.iam.gserviceaccount.com`

## Licensing and platform contract

Canonical license plans: `TRIAL`, `SOLO`, `STARTER`, `TEAM`, `LEGACY`.

Canonical license statuses: `TRIAL`, `ACTIVE`, `SUSPENDED`, `EXPIRED`.

Required organization license mirrors:

- `licenseStatus`
- `licenseWriteEnabled`
- `licenseExpiresAt`
- `maxUsers`

Platform roles: `SUPER_ADMIN`, `SUPPORT`.

Platform statuses: `ACTIVE`, `DISABLED`.

Firebase Admin uses Application Default Credentials. Browser privileged writes
are denied. Cross-tenant reads use authenticated Console server APIs, and
license mutations execute server-side in Admin SDK transactions. The last
active `SUPER_ADMIN` cannot be disabled or demoted.

The previous Cloud Run revision is retained for rollback. The authoritative
Firestore Rules source remains in the `Business-Manager-App` repository; the
Console `firestore.rules` file must not be independently deployed.

## Rollback procedure

Rollback target: `bsm-console-00009-gj4`.

```bash
gcloud run services update-traffic bsm-console \
  --project=bsm-client-app-web \
  --region=asia-southeast1 \
  --to-revisions=bsm-console-00009-gj4=100
```

This command is prepared for controlled rollback only and was not executed as
part of the stable V1 release.

## Non-blocking maintenance

- P2-A: favicon 404 responses.
- P2-B: Node module-type warnings in standalone contract tests.

Both are non-blocking maintenance items.
