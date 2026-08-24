# Console platform-admin bootstrap

The first Console administrator must be created server-side. There is no public “make me admin” endpoint.

1. Create or identify the Firebase Authentication user and copy its UID.
2. In a server-only environment with Application Default Credentials, or the `FIREBASE_ADMIN_*` variables configured, run:

```bash
BSM_BOOTSTRAP_ADMIN_UID="firebase-auth-uid" \
BSM_BOOTSTRAP_ADMIN_EMAIL="admin@example.com" \
npm run bootstrap:platform-admin
```

The script verifies that the UID and email match Firebase Authentication, refuses to overwrite an existing `platformAdmins/{uid}` record, and creates:

```text
platformAdmins/{uid}
  email
  displayName
  role: SUPER_ADMIN
  status: ACTIVE
  createdAt
  updatedAt
  createdBy: bootstrap
  updatedBy: bootstrap
```

Do not run this against production until the target project and UID have been independently verified. The script does not deploy anything.

## Authorization matrix

`SUPER_ADMIN` may perform all read operations and all license/platform-admin mutations. `SUPPORT` may perform read operations, including platform-admin listing where permitted, but cannot mutate licenses or platform-admin records. The API enforces this matrix; hiding buttons is only a usability feature.
