# Local Platform API with Firebase emulators

This is the supported local configuration for the V1 Client-to-Platform API.
It deliberately uses Firebase's `demo-bsm-console` project and local emulator
hosts; it does not use the production Firebase project or make production
Firebase calls.

Do not place these values in `.env.local`. Keep `.env.local` as the normal
Console configuration and apply the emulator identity only to the two local
processes below. In particular, unset `FIREBASE_CONFIG` so it cannot introduce
a conflicting project ID.

## 1. Start the isolated Firebase emulators

```sh
./node_modules/.bin/firebase emulators:start --project demo-bsm-console --only auth,firestore
```

The default local endpoints are `127.0.0.1:9099` for Firebase Auth and
`127.0.0.1:8080` for Firestore.

## 1B. Cross-repository shared emulator startup (Client rules authoritative)

The Client App owns the Firebase Rules. For cross-repository E2E, run the
Firebase emulators with a temporary config that points to the Client App
`firestore.rules` and the shared demo project.

```sh
CLIENT_RULES_PATH="/Users/markjandoc/Documents/Business-Manager-App/firestore.rules"
TMP_EMULATOR_DIR=$(mktemp -d)
cat > "$TMP_EMULATOR_DIR/firebase.json" <<EOF
{
  "firestore": {
    "rules": "$CLIENT_RULES_PATH"
  },
  "emulators": {
    "auth": {
      "host": "127.0.0.1",
      "port": 9099
    },
    "firestore": {
      "host": "127.0.0.1",
      "port": 8080
    }
  }
}
EOF

./node_modules/.bin/firebase emulators:start --project demo-bsm-console --only auth,firestore --config "$TMP_EMULATOR_DIR/firebase.json"
```

Stop command:

```sh
Ctrl-C
```

The temp config file remains isolated to your local machine and is safe to discard.

## 2. Start the Developer Console / trusted Platform backend

Run this in a second terminal from the repository root:

```sh
env -u FIREBASE_CONFIG \
  FIREBASE_ADMIN_PROJECT_ID=demo-bsm-console \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bsm-console \
  GOOGLE_CLOUD_PROJECT=demo-bsm-console \
  GCLOUD_PROJECT=demo-bsm-console \
  BSM_EXPECTED_PROJECT_ID=demo-bsm-console \
  NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true \
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1 \
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT=9099 \
  NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=8080 \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  npm run dev
```

`npm run dev` remains the normal local command and serves the Console on
`http://localhost:3001`. The environment above makes the Firebase Admin SDK
use only the local emulators. The Platform's identity guard rejects partial,
contradictory, or production project identity when emulator hosts are present.

## 3. Bootstrap the persisted demo catalog

A fresh emulator starts empty. This local-only helper creates missing default
plan documents and creates the Founding usage counter only when it does not
already exist. It refuses to run unless both emulator hosts and the exact
`demo-bsm-console` identity are configured.

```sh
env -u FIREBASE_CONFIG \
  FIREBASE_ADMIN_PROJECT_ID=demo-bsm-console \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bsm-console \
  GOOGLE_CLOUD_PROJECT=demo-bsm-console \
  GCLOUD_PROJECT=demo-bsm-console \
  BSM_EXPECTED_PROJECT_ID=demo-bsm-console \
  NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true \
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1 \
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT=9099 \
  NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=8080 \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  ./node_modules/.bin/tsx scripts/bootstrap-local-platform-emulator.mts
```

It produces the V1 launch catalog without overwriting existing emulator plan
configuration:

| Product | Price | Trial | Public signup |
| --- | ---: | ---: | --- |
| `founding_100` | USD 99/year | 14 days | On |
| `standard` | USD 149/year | 14 days | Off |

## 4. Cross-repository environment checks

For local Browser + Platform E2E runs:

1. Start shared emulators using the Client App rules path from section 1B.
2. Start the Developer Console on `http://localhost:3001` using:

```sh
env -u FIREBASE_CONFIG \
  FIREBASE_ADMIN_PROJECT_ID=demo-bsm-console \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bsm-console \
  GOOGLE_CLOUD_PROJECT=demo-bsm-console \
  GCLOUD_PROJECT=demo-bsm-console \
  BSM_EXPECTED_PROJECT_ID=demo-bsm-console \
  NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true \
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1 \
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT=9099 \
  NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT=8080 \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  npm run dev
```

3. Run `scripts/bootstrap-local-platform-emulator.mts`.
4. Validate `/api/v1/plans`, `/api/v1/trials`, and
   `/api/v1/subscription` plus client-side Firestore reads through the
   Client App rules.

## Local smoke check

```sh
curl http://127.0.0.1:3001/api/v1/plans
```

The response should be HTTP 200 and list only `founding_100` while the initial
manual public-signup flags are in effect. `POST /api/v1/trials` and
`GET /api/v1/subscription` require an emulator-issued Firebase ID token; their
request and response contract remains defined in
[`client-platform-api-contract.md`](./client-platform-api-contract.md).
