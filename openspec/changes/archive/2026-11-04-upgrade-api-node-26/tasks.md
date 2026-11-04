## 1. Replace graphql-shield

- [x] 1.1 Rewrite `permissions.js` as a `graphql-middleware` middleware keyed on the `Mutation` type: falsy `ctx.user` → `AuthenticationError`; missing `admin` role → `ForbiddenError`; otherwise call `resolve`
- [x] 1.2 Remove the `console.log(ctx.user)` and other auth debug logging
- [x] 1.3 Confirm `index.js` still passes `permissions` to `applyMiddleware` before the `enteredByPersonID` middleware (no reordering)
- [x] 1.4 `npm uninstall graphql-shield` and confirm nothing else imports it (`grep -rn graphql-shield --include=*.js . | grep -v node_modules`)

## 2. Runtime baseline

- [x] 2.1 Add `"engines": {"node": ">=26.12.1"}` to `package.json`
- [x] 2.2 Add `.nvmrc` containing `26`
- [x] 2.3 Approve the `bcrypt` install script under npm 11 (`npm install-scripts approve bcrypt`) and commit the resulting config
- [x] 2.4 Regenerate `package-lock.json` with `rm -rf node_modules && npm install` on Node 26; confirm `node -e "require('bcrypt')"` works

## 3. Local verification on Node 26

- [x] 3.1 `node --trace-deprecation index.js` boots cleanly with no deprecation warnings
- [x] 3.2 Anonymous mutation → `UNAUTHENTICATED`; resolver not invoked
- [x] 3.3 Authenticated non-admin mutation → `FORBIDDEN` (temporarily remove `admin` from a local test user, or use a user without it)
- [x] 3.4 Admin `CreateReference` then `DeleteReference` succeed; `ENTERED_BY` CREATE/DELETE edges are correct
- [x] 3.5 Anonymous `Reference(first: 1)` query returns data
- [x] 3.6 Login, `UploadImage`, and GET `/images/:pbotID/:image` for a legitimate file all work
- [x] 3.7 Confirm on Node 18 that the app fails only at the startup guard (task 4.2), not earlier at an import, so operators see the intended message

## 4. Deployment plumbing

- [x] 4.1 Change the `pbot-api` entry in `ecosystem.config.cjs` to a non-versioned interpreter (design D5); leave `pbot-client` unchanged
- [x] 4.2 Add the startup version guard (design D4): a small module imported first by `index.js` that exits non-zero with a clear message on Node < 26.12.1; verify it fires on Node 18 and passes on 26
- [x] 4.3 Write the cutover runbook (design Migration Plan) in `NODE-RUNTIME.md` or in CLAUDE.md's "Running the Server" section, and update CLAUDE.md to mention Node 26

## 5. Server cutover (manual, dev first, then prod)

- [x] 5.1 On the server as the PM2 user: `nvm install 26`, update the checkout, `npm ci`, `node -e "require('bcrypt')"`
- [x] 5.2 `pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save`
- [x] 5.3 Verify `pm2 show pbot-api` reports Node ≥ 26.12.1
- [x] 5.4 Post-cutover checks: login, one admin mutation, anonymous mutation rejected, image upload and view
- [x] 5.5 Check whether other processes or cron jobs on the server use Node 16; record findings in the runbook
