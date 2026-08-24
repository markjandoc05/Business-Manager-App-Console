# Firestore rules merge assessment

The Console’s first authenticated Firestore read is:

```text
platformAdmins/{authenticated-uid}
```

It is issued by `lib/auth-context.tsx` to determine whether the signed-in
Google user is an active platform administrator. The first post-authentication
dashboard reads are collection queries on `organizations` and
`platformAuditLogs`. The Organizations and Users screens additionally read
`organizations/{orgId}/members`; organization details read the organization
document and that members subcollection.

## Safe fix

Merge [`firestore.console.rules.fragment`](../firestore.console.rules.fragment)
into the authoritative Client App ruleset for `bsm-client-app-web`. Do not
deploy the repository’s [`firestore.rules`](../firestore.rules) by itself: it is
a Console-only ruleset and does not contain the Client App’s tenant rules,
including its license-field protections.

The fragment:

- recognizes only authenticated `platformAdmins/{uid}` documents with role
  `SUPER_ADMIN` or `SUPPORT` and status `ACTIVE`;
- allows an active platform admin to read organizations, organization members,
  organization settings, the slug registry, and platform audit logs;
- allows a platform admin to read only their own platform-admin document;
- grants no browser writes, including no writes to licenses, memberships,
  settings, platform admins, or audit logs;
- does not change the Client App’s `ADMIN`, `MANAGER`, or `USER` organization
  authorization.

The server API continues to use Firebase Admin SDK for privileged mutations and
writes audit records. Firestore rules must retain the Client App’s existing
tenant matches and any explicit license-field protections when this fragment is
merged.

## Validation matrix

| Actor | `platformAdmins/{uid}` | Organizations / members / settings | Audit logs | Browser writes |
|---|---|---|---|---|
| Active `SUPER_ADMIN` | Own document only | Read | Read | Denied |
| Active `SUPPORT` | Own document only | Read | Read | Denied |
| Disabled platform admin | Denied | Denied | Denied | Denied |
| Organization `ADMIN` / `MANAGER` / `USER` | Denied unless independently covered by Client App rules | Client App tenant rules only | Denied unless independently covered by Client App rules | Client App rules only; Console fragment adds none |
| Unauthenticated | Denied | Denied | Denied | Denied |

## Current deployment comparison

The deployed rules could not be retrieved with the installed Firebase CLI (it
has no `firestore:rules:get` command in this environment). The Firestore
database itself is confirmed to be `projects/bsm-client-app-web/databases/(default)`
in `asia-southeast1`. Therefore the live ruleset remains unverified. The
reported permission error is consistent with the deployed rules not yet
allowing the `platformAdmins/{uid}` lookup, but that cannot be proven without
the deployed rules or a browser network-console error showing the exact path.

No deployment was performed.
