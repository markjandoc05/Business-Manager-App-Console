# Phase 5A.3 runtime decision

The Console production runtime is intentionally `npm start`, which invokes
`next start` after the Cloud Run source build. The service does not execute
`.next/standalone/server.js` and the current healthy Cloud Run revision uses
that `next start` path.

Accordingly, `next.config.mjs` intentionally omits `output: 'standalone'`.
Restoring it is not required for the selected Cloud Run/buildpack architecture
and would reintroduce the previously avoided standalone/startup boundary.
