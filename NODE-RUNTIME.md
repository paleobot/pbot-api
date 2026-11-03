# Node.js runtime

The API requires **Node.js ≥ 26.12.1**, the first 26.x patched against CVE-2026-111497 (the Brotli decoder out-of-bounds write known as "Node2Shell").

The requirement is enforced in three places:

| Where | What it does |
|---|---|
| `package.json` `engines` | Makes npm warn when installing on an older runtime |
| `.nvmrc` (`26`) | Makes `nvm use` / `nvm install` select Node 26 |
| `runtime-guard.js` | Imported first by `index.js`. On Node < 26.12.1 it logs the required and running versions and exits 1 before any port opens. This is the gate that actually stops the API. |

The guard checks `process.versions.node`, not `process.versions.brotli`. Patched Node 26.13.0 still reports Brotli `1.2.0`, so the Brotli version can't tell you whether the runtime is patched.

## PM2 interpreter

`ecosystem.config.cjs` sets the `pbot-api` interpreter to the newest nvm-installed Node matching the major version in `.nvmrc`. It looks in `~/.nvm/versions/node/v26.*` for the PM2 user. The `pbot-client` entry still pins v16.17.0; the client is out of scope for this change.

PM2 resolves the interpreter only at `pm2 start` and stores it. A `pm2 restart` or a watch-mode reload keeps the old interpreter. After installing a newer Node, or after updating `.nvmrc`, run:

```bash
pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save
```

## npm install scripts

npm 11 runs dependency install scripts only when they're approved. `bcrypt` is approved in `package.json` under `allowScripts`. The approval is pinned to `bcrypt@5.1.1`, so a bcrypt upgrade needs `npm install-scripts approve bcrypt` again.

npm also warns about `@apollo/protobufjs` and `core-js`. Neither script is needed at runtime.

## Cutover runbook (one time, dev first, then prod)

Run the steps as the PM2 user on the server.

1. Install the runtime before touching the code:
   ```bash
   nvm install 26
   node -v   # expect >= v26.12.1
   ```
2. Update the checkout to the release that contains this change.
   - PM2 watch mode will restart the app on the old interpreter, and the guard will exit with `pbot-api requires Node.js >= 26.12.1 ...`.
   - This is expected. Carry straight on; the API is down until step 4.
3. Reinstall dependencies on Node 26:
   ```bash
   cd ~/repos/pbot-api
   nvm use            # reads .nvmrc
   npm ci
   node -e "require('bcrypt')"   # must print nothing
   ```
4. Switch the PM2 interpreter:
   ```bash
   node -e 'console.log(require("./ecosystem.config.cjs").apps[0].interpreter)'   # expect .../v26.x/bin/node
   pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save
   ```
5. Verify:
   - `pm2 show pbot-api`: the interpreter is under `v26.*`. `pm2 logs pbot-api` shows `GraphQL server ready`.
   - Log in from the client and save one record (an admin mutation).
   - An anonymous mutation returns `UNAUTHENTICATED`:
     ```bash
     curl -s -H 'content-type: application/json' -H 'apollo-require-preflight: 1' \
       -d '{"query":"mutation{DeleteReference(data:{pbotID:\"00000000-0000-4000-8000-000000000000\"}){pbotID}}"}' \
       https://<host>/graphql
     ```
   - Upload an image and view it.
   - Request a password reset and confirm the email arrives (this exercises nodemailer on Node 26).
6. Look for anything else on the server still using Node 16, and record it below:
   ```bash
   crontab -l; pm2 ls; ls ~/.nvm/versions/node
   ```

**Rollback:**
1. Check out the previous release.
2. Run `rm -rf node_modules && npm ci` under Node 16.17.0 (`nvm use 16.17.0`).
3. Restart: `pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api`. The old ecosystem file pins v16.17.0.

The old code has no guard and still uses `graphql-shield`, which works on 16. Rolling back puts the API back on an unpatched runtime, so use it only as a stopgap; the nginx `Content-Encoding: br` block stays in place.

## Cutover log

| Server | Date | Node | Other Node 16 users found |
|---|---|---|---|
| dev | | | |
| prod | | | |
