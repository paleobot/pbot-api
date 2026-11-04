## Context

- **Runtime today:** prod PM2 `interpreter: /home/doug/.nvm/versions/node/v16.17.0/bin/node`; local default 18.20.8. Neither has an `engines` field or `.nvmrc`.
- **Deploy today:** manual on both dev and prod. Someone updates the checkout on the server and PM2 watch mode restarts the app. Dependency and interpreter changes need extra manual steps (`npm ci`, PM2 delete/start). `.github/workflows/deploy-dev.yaml` is a leftover and is not used.
- **Smoke test (2026-11-03, Node 26.13.0, scratch copy against local Neo4j):**

  | Check | Result |
  |---|---|
  | `npm ci` (npm 11.20) | ✅ bcrypt N-API v3 prebuilt binding installed; npm warned about unapproved install scripts |
  | Server boot | ❌ `graphql-shield/esm/rules.js`: `util` has no export `isUndefined` |
  | Boot with a scratch shim | ✅ |
  | Fork Cypher reads (incl. nested), `@cypher` query, fuzzy search | ✅ |
  | Login (bcrypt compare + jwt sign) | ✅ |
  | `CreateReference` → `DeleteReference` (soft delete) | ✅ |
  | `UploadImage` multipart → file | ✅ byte-identical |
  | `--trace-deprecation` output | 0 warnings |

- **Current `permissions.js`:** `Query.*: allow`, `Mutation.*: and(isAuthenticated, isAdmin)`, `debug: true`, `allowExternalErrors: true`. `isAuthenticated` tests `ctx.user !== null`.

## Goals / Non-Goals

**Goals:**
- Run the API on Node ≥ 26.12.1 in every environment.
- Remove the one Node 26 blocker (`graphql-shield`) without weakening mutation authorization.
- Make the runtime version declared, checked and hard to regress silently.

**Non-Goals:**
- Apollo Server 4/5, Express 5, or other dependency modernization.
- `pbot-client` runtime or its PM2 entry.
- Changing *who* is an admin. Registration currently grants `admin` to every new user; that is a separate concern.
- Fixing the path-traversal and Cypher-interpolation findings (`harden-image-upload-and-cypher`).

## Decisions

### D1. Replace `graphql-shield` with a type-level `graphql-middleware` middleware

`graphql-middleware` is already a dependency, already wraps the schema (`applyMiddleware(schema, permissions, middleware)`) and runs on Node 26. A middleware keyed on the `Mutation` type (not on individual fields) wraps every Mutation field, including ones added later, which matches shield's `"*"` behaviour and fails closed.

Shape: `{ Mutation: async (resolve, parent, args, ctx, info) => { gate(ctx); return resolve(parent, args, ctx, info) } }`. Export it from `permissions.js` so the `index.js` wiring and ordering stay as they are. The gate must run before the existing middleware that injects `enteredByPersonID`.

*Alternatives considered:*
- **`patch-package` shim on `graphql-shield`:** a one-line fix, but it keeps a patched, abandoned dependency on the auth path.
- **`graphql-shield` 8.0 alpha:** unmaintained pre-release.
- **Check in each resolver:** easy to forget for new mutations, and the fork's auto-generated mutations have no hand-written resolver.

### D2. Treat "no user" as any falsy `ctx.user`

The gate checks `!ctx.user` and then `!Array.isArray(ctx.user.roles) || !ctx.user.roles.includes('admin')`. This closes the case where `undefined` passed the old `!== null` test and then crashed `isAdmin` with a TypeError.

*Found during implementation:* `ctx.user` is almost never falsy in practice. When a request has no token or an invalid one, `getUser` falls back to the shared `guest` Person (roles `["user"]`). So the gate also treats a user with no `pbotID`, or with email `guest`, as unauthenticated. Without that, anonymous callers would get `FORBIDDEN` instead of the `UNAUTHENTICATED` the spec requires. Shield also rejected guest, but only through `isAdmin`, with "Not Authorised!".

### D3. Use Apollo's error classes

Throw `AuthenticationError` (no user) and `ForbiddenError` (user without `admin`) from `apollo-server-errors`, which `apollo-server-core` 3 re-exports. That gives `UNAUTHENTICATED`/`FORBIDDEN` codes instead of `INTERNAL_SERVER_ERROR`. `pbot-client/src` has no matches for "Not Authorised", so the change in message text is safe. Drop shield's `debug: true` exposure and the `console.log(ctx.user)` debug output.

### D4. Runtime baseline and its enforcement

- `package.json`: `"engines": {"node": ">=26.12.1"}`. With `engine-strict` unset, npm only warns; the startup guard (below) is the real gate.
- `.nvmrc`: `26`.
- **Startup guard:** at the very top of `index.js`, before any other imports run, compare `process.versions.node` with 26.12.1. If it is older, log a clear message naming the required version and the running one, then `process.exit(1)`. Deploys are manual and there's no CI step, so the process is the one place every deploy path goes through. It also catches PM2 still pointing at the old interpreter after a code update. Do **not** use `process.versions.brotli`: the patched 26.13.0 still reports `1.2.0`, which is nominally in the affected range, and it is unclear whether Node backported the fix without changing that string.
- *Alternative considered:* a CI/deploy-workflow check. Rejected because deploys don't go through a workflow.
- *Ordering note:* ESM hoists `import` statements, so the guard must live in a tiny module imported first, or use a dynamic `import()` for the rest of the app. Otherwise an incompatible dependency could crash at import time before the guard runs. On Node 16/18, `graphql-shield` would no longer be present, so the remaining imports should load and the guard's message will be what the operator sees.

### D5. PM2 interpreter

**Chosen:** `ecosystem.config.cjs` computes the interpreter at `pm2 start`. It uses the newest `~/.nvm/versions/node/v<major>.*/bin/node`, where `<major>` comes from `.nvmrc`, and fails with a clear message if that major isn't installed. Leave the `pbot-client` entry unchanged.

*Alternatives rejected:*
- **nvm alias:** an alias is a text file under `~/.nvm/alias/`, not a binary path.
- **`interpreter: "node"`:** PM2 then runs the app on the Node its own daemon was started with, likely v16 on the server.
- **A hand-maintained symlink:** one more manual step to forget.

The guard still catches a stale interpreter. The runbook is in `NODE-RUNTIME.md`.

### D6. npm 11 install-script approval

npm 11 warns that `bcrypt`, `@apollo/protobufjs` and `core-js` install scripts are not covered by `allowScripts`. In the smoke test they still ran. The server's npm may behave differently, so explicitly approve `bcrypt` (the only one that matters at runtime) and commit the resulting config. As a fallback, the runbook verifies `node -e "require('bcrypt')"` after `npm ci`.

## Risks / Trade-offs

- [The gate behaves differently from shield in an edge case, such as subscriptions or nested mutation payloads] → The schema has no subscriptions; the spec scenarios cover anonymous, non-admin and admin callers, plus a newly added mutation.
- [PM2 keeps running Node 16 after the code is updated] → The startup guard refuses to boot, so the API is down with a clear log message rather than silently running unpatched. The cutover runbook installs Node 26 and switches the interpreter in the same session as the code update, so the downtime window is minutes.
- [The guard turns a forgotten runtime step into an outage] → Accepted, deliberately: an unpatched runtime is the thing this change exists to prevent. The runbook orders the steps so the guard should never fire during a normal cutover.
- [Apollo Server 3 is EOL] → Accepted for now; it ran cleanly on 26. Revisit separately.
- [`nodemailer` send was not exercised] → It's pure JS and loads fine on 26. Its only caller is the password-reset flow, which is not in use, so there's nothing to verify after cutover.

## Migration Plan

Run the same steps on dev first, then on prod, as the PM2 user:

1. `nvm install 26` (before touching the code, so the new runtime is ready).
2. Update the checkout to the release containing this change. PM2 watch mode restarts on the old interpreter, and the startup guard exits. That is expected; continue straight on.
3. `cd repos/pbot-api && npm ci` → `node -e "require('bcrypt')"`.
4. Update/confirm the interpreter path → `pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save`.
5. Verify: `pm2 show pbot-api` shows Node ≥ 26.12.1; login; one admin mutation; an anonymous mutation returns `UNAUTHENTICATED`; image upload and view.
6. **Rollback:** check out the previous release, point the interpreter back to v16.17.0, and reinstall `node_modules` from the old lockfile. The old `graphql-shield` code works on 16, and the old code has no guard.

## Open Questions

- ~~Which interpreter form does the server's PM2 setup support (D5)?~~ Resolved: computed from `.nvmrc` (see D5).
- Is anything else (cron jobs, scripts) on the server using the Node 16 install that should also move?
