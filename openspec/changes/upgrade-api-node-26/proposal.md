## Why

CVE-2026-111497 ("Node2Shell") is an out-of-bounds write in the Brotli decoder bundled with Node.js. It is on CISA's KEV list and public exploits exist. The API runs on Node 16.17.0 in production (`ecosystem.config.cjs`) and Node 18.20.8 locally. Both lines are end-of-life, bundle a Brotli in the affected range, and will never be patched. The nginx stopgap rejects `Content-Encoding: br` at the edge, but the only real fix is a patched runtime (Node ≥ 26.12.1).

A smoke test on Node 26.13.0 (2026-11-03) found exactly one blocker. `graphql-shield` 7.6.5 does `import { isUndefined } from 'util'`, and Node 23 removed that API, so the server cannot boot. `graphql-shield` has had no stable release since December 2022. Everything else passed on Node 26: Apollo Server 3, the `neo4j-graphql-js` fork, neo4j-driver 4.4, bcrypt, graphql-upload, login, create/delete mutations and image upload, with no deprecation warnings.

## What Changes

- Replace `graphql-shield` with a `graphql-middleware` type-level middleware on `Mutation` that enforces authenticated + `admin`, and remove the `graphql-shield` dependency.
- Fix the latent gap where an `undefined` (rather than `null`) `ctx.user` passed `isAuthenticated`.
- **BREAKING (error shape only):** unauthorized mutations return Apollo `UNAUTHENTICATED` / `FORBIDDEN` errors instead of shield's `"Not Authorised!"` with code `INTERNAL_SERVER_ERROR`. `pbot-client` does not match on the old message.
- Declare the runtime baseline: `"engines": {"node": ">=26.12.1"}` and `.nvmrc` (`26`).
- Fix `ecosystem.config.cjs` so the `pbot-api` entry no longer hard-codes `/home/doug/.nvm/versions/node/v16.17.0/bin/node`. The `pbot-client` entry is out of scope (the client is served as built HTML).
- Add a startup guard in `index.js` that refuses to start the API on Node older than 26.12.1. Deploys are manual, so the process itself is the only reliable place to enforce this. The guard checks `process.versions.node`, **not** `process.versions.brotli`, because 26.13.0 still reports Brotli `1.2.0`.
- Handle npm 11's install-script approval for `bcrypt` (plus `@apollo/protobufjs` and `core-js`) so `npm ci` reliably produces a working native binding.
- Document a one-time server cutover runbook for dev and prod. PM2 keeps its interpreter across restarts, so updating the code alone does not change the runtime.

## Capabilities

### New Capabilities
- `mutation-admin-gate`: every GraphQL mutation requires an authenticated caller with the `admin` role, fails closed for mutations added later, and returns standard Apollo auth error codes.
- `runtime-baseline`: the API declares and enforces a minimum Node.js version that is patched against CVE-2026-111497.

### Modified Capabilities
<!-- None. `mutation-group-authorization` describes in-resolver group checks that sit on top of the admin gate; its requirements are unchanged. -->

## Impact

- **Code:** `permissions.js` (rewritten), `index.js` (startup version guard; middleware wiring unchanged), `package.json`, `package-lock.json`, new `.nvmrc`, `ecosystem.config.cjs`. The unused `.github/workflows/deploy-dev.yaml` is left untouched.
- **Dependencies:** remove `graphql-shield`. No other dependency changes are required for Node 26.
- **Ops:** dev/prod server needs `nvm install 26`, `npm ci`, and a PM2 delete/start. See design.md.
- **Out of scope:** Apollo Server 3 → 4 (EOL but works on 26), Express 5, `pbot-client` runtime, and the security issues found during the smoke test (tracked in `harden-image-upload-and-cypher`).
