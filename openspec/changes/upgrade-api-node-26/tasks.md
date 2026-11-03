## 1. Replace graphql-shield

- [ ] 1.1 Rewrite `permissions.js` as a `graphql-middleware` middleware keyed on the `Mutation` type: falsy `ctx.user` → `AuthenticationError`; missing `admin` role → `ForbiddenError`; otherwise call `resolve`
- [ ] 1.2 Remove the `console.log(ctx.user)` and other auth debug logging
- [ ] 1.3 Confirm `index.js` still passes `permissions` to `applyMiddleware` before the `enteredByPersonID` middleware (no reordering)
- [ ] 1.4 `npm uninstall graphql-shield` and confirm nothing else imports it (`grep -rn graphql-shield --include=*.js . | grep -v node_modules`)

## 2. Runtime baseline

- [ ] 2.1 Add `"engines": {"node": ">=26.12.1"}` to `package.json`
- [ ] 2.2 Add `.nvmrc` containing `26`
- [ ] 2.3 Approve the `bcrypt` install script under npm 11 (`npm install-scripts approve bcrypt`) and commit the resulting config
- [ ] 2.4 Regenerate `package-lock.json` with `rm -rf node_modules && npm install` on Node 26; confirm `node -e "require('bcrypt')"` works

## 3. Local verification on Node 26

- [ ] 3.1 `node --trace-deprecation index.js` boots cleanly with no deprecation warnings
- [ ] 3.2 Anonymous mutation → `UNAUTHENTICATED`; resolver not invoked
- [ ] 3.3 Authenticated non-admin mutation → `FORBIDDEN` (temporarily remove `admin` from a local test user, or use a user without it)
- [ ] 3.4 Admin `CreateReference` then `DeleteReference` succeed; `ENTERED_BY` CREATE/DELETE edges are correct
- [ ] 3.5 Anonymous `Reference(first: 1)` query returns data
- [ ] 3.6 Login, `UploadImage`, and GET `/images/:pbotID/:image` for a legitimate file all work
- [ ] 3.7 Re-run tasks 3.1–3.6 on Node 18 to confirm the change is safe to deploy before the server cutover

## 4. Deployment plumbing

- [ ] 4.1 Change the `pbot-api` entry in `ecosystem.config.cjs` to a non-versioned interpreter (design D5); leave `pbot-client` unchanged
- [ ] 4.2 Add a workflow step that runs `node -v` on the server as the PM2 user and fails if it is below 26.12.1
- [ ] 4.3 Write the cutover runbook (design Migration Plan) in `NODE-RUNTIME.md` or in CLAUDE.md's "Running the Server" section, and update CLAUDE.md to mention Node 26

## 5. Server cutover (manual, after merge)

- [ ] 5.1 On the server as the PM2 user: `nvm install 26`, `npm ci`, `node -e "require('bcrypt')"`
- [ ] 5.2 `pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save`
- [ ] 5.3 Verify `pm2 show pbot-api` reports Node ≥ 26.12.1
- [ ] 5.4 Post-cutover checks: login, one admin mutation, anonymous mutation rejected, image upload and view, password-reset email delivered
- [ ] 5.5 Check whether other processes or cron jobs on the server use Node 16; record findings in the runbook
