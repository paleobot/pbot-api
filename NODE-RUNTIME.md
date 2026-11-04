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

`ecosystem.config.cjs` sets the `pbot-api` interpreter to the newest nvm-installed Node matching the major version in `.nvmrc`. It looks in `~/.nvm/versions/node/v26.*` for the PM2 user.

The `pbot-client` entry in this file still pins v16.17.0, but that entry isn't what runs the client on the servers. The client runs under PM2 on **Node 18.20.8**, which is end-of-life and still in the CVE-affected range. Moving it is out of scope for this change; see "Other Node runtimes on the server" below.

### PM2 itself runs on the old Node

PM2 is a global npm package, and nvm keeps global packages separately for each Node version. On the servers PM2 is installed under v18.20.8. After `nvm use 26` (or `nvm install 26`, which switches the shell), `pm2` is not on PATH.

That's fine. The PM2 daemon doesn't serve HTTP, and what matters for the CVE is the interpreter PM2 launches `pbot-api` with, which `ecosystem.config.cjs` sets to v26. The config file uses only `fs`/`os`/`path`, so a PM2 running on Node 18 can load it. **Run npm steps on Node 26 and PM2 commands on Node 18.** To switch back, use `nvm use 18.20.8`, or call `~/.nvm/versions/node/v18.20.8/bin/pm2` directly.

Moving PM2 itself to 26 is optional, and can wait until nothing else needs the old daemon:
```bash
nvm use 26
npm install -g pm2
pm2 update                    # restarts the daemon on the new pm2/Node, keeps the process list
pm2 unstartup && pm2 startup  # re-run the sudo command it prints; the boot script embeds the old Node path
pm2 save
```
`pm2 update` restarts every managed app, including `pbot-client`. Each app keeps its own stored interpreter.

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
3. Reinstall dependencies **on Node 26**:
   ```bash
   cd ~/repos/pbot-api
   nvm use            # reads .nvmrc -> 26
   npm ci
   node -e "require('bcrypt')"   # must print nothing
   ```
   Expect a lot of `npm warn deprecated ...` lines and an `install-scripts` warning about `@apollo/protobufjs`/`core-js`. They come from old transitive dependencies (Apollo Server 3 and friends) and are harmless. What matters is that `npm ci` ends without `npm error` and the bcrypt check prints nothing. They are a different thing from the runtime `DeprecationWarning`s that `--trace-deprecation` checks for (none at boot).
4. Switch the PM2 interpreter, **running PM2 on Node 18** (see "PM2 itself runs on the old Node"):
   ```bash
   node -e 'console.log(require("./ecosystem.config.cjs").apps[0].interpreter)'   # expect .../v26.x/bin/node
   nvm use 18.20.8    # the Node that has pm2 installed
   pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api && pm2 save
   ```
5. Verify:
   - `pm2 show pbot-api`: the interpreter is under `v26.*`. `pm2 logs pbot-api` shows `GraphQL server ready`.
   - Log in from the client and save one record (an admin mutation).
   - An anonymous mutation returns `UNAUTHENTICATED`:
     ```bash
     curl -s -H 'content-type: application/json' -H 'apollo-require-preflight: 1' \
       -d '{"query":"mutation{DeleteReference(data:{pbotID:\"00000000-0000-4000-8000-000000000000\", authors:[], groups:[]}){pbotID}}"}' \
       https://<host>/graphql
     ```
     Expect `"code":"UNAUTHENTICATED"` and the message `You must be logged in to do this`. A `GRAPHQL_VALIDATION_FAILED` error means the query never reached the gate, so it proves nothing.
   - Upload an image and view it.
6. Look for anything else on the server still using an old Node (16 or 18), and record it below:
   ```bash
   crontab -l; pm2 ls; ls ~/.nvm/versions/node
   ```

**Rollback:**
1. Check out the previous release.
2. Run `rm -rf node_modules && npm ci` under Node 16.17.0 (`nvm use 16.17.0`).
3. Restart from the Node that has pm2 (`nvm use 18.20.8`): `pm2 delete pbot-api && pm2 start ecosystem.config.cjs --only pbot-api`. The old ecosystem file pins v16.17.0.

The old code has no guard and still uses `graphql-shield`, which works on 16. Rolling back puts the API back on an unpatched runtime, so use it only as a stopgap; the nginx `Content-Encoding: br` block stays in place.

## Other Node runtimes on the server

| Process | Node | Status |
|---|---|---|
| PM2 daemon | 18.20.8 | Fine for now: it doesn't serve HTTP. Optionally move it to 26 (above). |
| `pbot-client` (PM2) | 18.20.8 | End-of-life and in the CVE-affected range. Deferred, as a separate change in the client repo. The nginx `Content-Encoding: br` block stays in place until it moves. |

## Cutover log

| Server | Date | Node | Other old-Node users found |
|---|---|---|---|
| dev | | | |
| prod | | | |
