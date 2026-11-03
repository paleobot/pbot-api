## Context

- **Runtime today:** prod PM2 `interpreter: /home/doug/.nvm/versions/node/v16.17.0/bin/node`; local default 18.20.8. Neither has an `engines` field or `.nvmrc`.
- **Deploy today:** GitHub Actions SSHes in and runs `git fetch && git reset --hard origin/master`. PM2 watch mode restarts the app. There is no `npm ci` and no PM2 reload, so a dependency or interpreter change needs a manual step.
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

### D3. Use Apollo's error classes

Throw `AuthenticationError` (no user) and `ForbiddenError` (user without `admin`) from `apollo-server-errors`, which `apollo-server-core` 3 re-exports. That gives `UNAUTHENTICATED`/`FORBIDDEN` codes instead of `INTERNAL_SERVER_ERROR`. `pbot-client/src` has no matches for "Not Authorised", so the change in message text is safe. Drop shield's `debug: true` exposure and the `console.log(ctx.user)` debug output.

### D4. Runtime baseline and its enforcement

- `package.json`: `"engines": {"node": ">=26.12.1"}`. With `engine-strict` unset, npm only warns; the deploy check (below) is the real gate.
- `.nvmrc`: `26`.
- **Deploy check:** a workflow step runs `node -v` over SSH as the deploy user (using `nvm use` if needed) and fails if it is older than 26.12.1. Do **not** use `process.versions.brotli`: the patched 26.13.0 still reports `1.2.0`, which is nominally in the affected range, and it is unclear whether Node backported the fix without changing that string.

### D5. PM2 interpreter

Point the `pbot-api` entry at a stable nvm alias path instead of a versioned one: for example, create `nvm alias pbot-api 26` and use `~/.nvm/alias/...`, or set `interpreter: "node"` and start PM2 from a shell where `nvm use` has run. Pick whichever the server's PM2 setup supports during cutover, and record the choice in the runbook. Leave the `pbot-client` entry unchanged.

### D6. npm 11 install-script approval

npm 11 warns that `bcrypt`, `@apollo/protobufjs` and `core-js` install scripts are not covered by `allowScripts`. In the smoke test they still ran. The server's npm may behave differently, so explicitly approve `bcrypt` (the only one that matters at runtime) and commit the resulting config. As a fallback, the runbook verifies `node -e "require('bcrypt')"` after `npm ci`.

## Risks / Trade-offs

- [The gate behaves differently from shield in an edge case, such as subscriptions or nested mutation payloads] → The schema has no subscriptions; the spec scenarios cover anonymous, non-admin and admin callers, plus a newly added mutation.
- [PM2 keeps running Node 16 after the code deploys] → The cutover runbook uses `pm2 delete` + `pm2 start`, then verifies with `pm2 show pbot-api`. The deploy check catches drift.
- [The `master` push deploys automatically before the server has Node 26, and PM2 restarts on 16 with code that still works there] → Nothing in this change requires Node 26 *syntax*, so the order is safe either way. Do the cutover right after merging anyway.
- [Apollo Server 3 is EOL] → Accepted for now; it ran cleanly on 26. Revisit separately.
- [`nodemailer` send was not exercised] → It's pure JS and loads fine. Add a password-reset email check to the post-cutover verification.

## Migration Plan

1. Merge to `master`. The auto-deploy updates the code; PM2 restarts on the old interpreter, which still works because nothing requires Node 26.
2. On the server, as the PM2 user: `nvm install 26` → `cd repos/pbot-api && npm ci` → `node -e "require('bcrypt')"` → update/confirm the interpreter path → `pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save`.
3. Verify: `pm2 show pbot-api` shows Node ≥ 26.12.1; login; one admin mutation; an anonymous mutation returns `UNAUTHENTICATED`; image upload and view; password-reset email.
4. **Rollback:** point the interpreter back to v16.17.0 and `git revert` the change. The old `graphql-shield` code works on 16. Reinstall `node_modules` with the old lockfile.

## Open Questions

- Which interpreter form does the server's PM2 setup support (D5)? Resolve during cutover.
- Is anything else (cron jobs, scripts) on the server using the Node 16 install that should also move?
