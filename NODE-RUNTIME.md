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

`ecosystem.config.cjs` sets each app's interpreter with `nvmNode(dir)`, which picks the newest nvm-installed Node matching the major version in that app's `.nvmrc`:

| App | `.nvmrc` | Resolves to (PM2 user) |
|---|---|---|
| `pbot-api` | `./.nvmrc` | `~/.nvm/versions/node/v26.*` |
| `pbot-client` | `./client/.nvmrc` (owned by the pbot-client repo) | `~/.nvm/versions/node/v26.*` |

PM2 evaluates the whole file even with `--only`, so a missing `.nvmrc` or a missing Node major for **either** app makes `pm2 start` fail for both, with an error naming what is missing. Running processes are unaffected: watch restarts and `pm2 restart` reuse the stored config.

The `pbot-client` entry is used on the **dev host only**. Prod runs no client Node process; it serves the static build through nginx. See "pbot-client on the dev host" below.

### The PM2 daemon and systemd

Since 2026-11-04, pm2 **7.1.2** is installed globally under Node 26, and the daemon runs on Node 26. nvm keeps global packages separately for each Node version, so `pm2` is on PATH only when the shell is on Node 26. `nvm alias default 26` is set on both servers, so new shells start there. **Run both npm and pm2 commands on Node 26.**

A systemd unit starts the daemon at boot:

| Server | Unit | Before 2026-11-04 |
|---|---|---|
| dev | `/etc/systemd/system/pbot-pm2.service` (hand-named) | pm2 5.1.2 on Node 17.4.0 |
| prod | `/etc/systemd/system/pm2-doug.service` | pm2 5.3.0 on Node 16.7.0 |

Both units are `Type=forking` with `PIDFile=~/.pm2/pm2.pid` and `Restart=on-failure`, and their `PATH`, `ExecStart` (`pm2 resurrect`), `ExecReload` and `ExecStop` (`pm2 kill`) name `~/.nvm/versions/node/v26.13.0/...` directly. systemd owns the daemon, so:

- **Don't use `pm2 update`.** It kills the daemon behind systemd's back. systemd then treats the service as stopped and kills its cgroup, and the replacement daemon ends up in your login session instead.
- **Don't use `pm2 startup` / `pm2 unstartup`.** On dev, `unstartup` won't find `pbot-pm2.service`, and `startup` would add a second unit that resurrects the same apps.
- To restart the daemon, run `sudo systemctl restart <unit>`. It resurrects from `~/.pm2/dump.pm2`, so run `pm2 save` first whenever the process list has changed.

#### Moving to a newer Node 26.x (or a new pm2)

systemd can't glob, so the unit pins the patch version. Saved apps also keep their stored interpreter. As the PM2 user:

```bash
nvm install 26                                   # e.g. v26.14.0
npm install -g pm2@<version>                     # global packages don't carry over between Node versions
pm2 save
sudo cp /etc/systemd/system/<unit> ~/<unit>.pre-upgrade
sudo systemctl stop <unit>
sudo sed -i 's|/home/doug/.nvm/versions/node/v26.13.0/|/home/doug/.nvm/versions/node/<new>/|g' /etc/systemd/system/<unit>
grep -E "PATH|Exec" /etc/systemd/system/<unit>   # all under <new>
sudo systemctl daemon-reload
sudo systemctl start <unit>
```

Then recreate each app so it picks up the newer interpreter (see below), and run `pm2 save`. Check with `readlink /proc/$(cat ~/.pm2/pm2.pid)/exe` and `pm2 show <app>`. To roll back, stop the unit, restore the `.pre-upgrade` copy, run `daemon-reload`, and start it again.

PM2 resolves the interpreter only at `pm2 start` and stores it. A `pm2 restart` or a watch-mode reload keeps the old interpreter. After installing a newer Node, or after updating `.nvmrc`, run:

```bash
pm2 delete pbot-api
pm2 start ecosystem.config.cjs --only pbot-api
pm2 save
```

## npm install scripts

npm 11 runs dependency install scripts only when they're approved. `bcrypt` is approved in `package.json` under `allowScripts`. The approval is pinned to `bcrypt@5.1.1`, so a bcrypt upgrade needs `npm install-scripts approve bcrypt` again.

npm also warns about `@apollo/protobufjs` and `core-js`. Neither script is needed at runtime.

## Cutover runbook (one time, dev first, then prod)

Run the steps as the PM2 user on the server.

### Step 1: Install Node 26

Do this before touching the code.

```bash
nvm install 26
node -v
```

`node -v` should print v26.12.1 or later.

### Step 2: Update the checkout

Pull the release that contains this change.

PM2 watch mode restarts the app on the old interpreter, and the guard exits with `pbot-api requires Node.js >= 26.12.1 ...`. This is expected. Carry straight on: the API is down until step 4.

### Step 3: Reinstall dependencies on Node 26

```bash
cd ~/repos/pbot-api
nvm use
npm ci
node -e "require('bcrypt')"
```

`nvm use` reads `.nvmrc` and selects 26. The bcrypt check must print nothing.

Expect many `npm warn deprecated ...` lines, plus an `install-scripts` warning about `@apollo/protobufjs` and `core-js`. They come from old dependencies such as Apollo Server 3 and are harmless. What matters is that `npm ci` ends without an `npm error` line.

### Step 4: Switch the PM2 interpreter

First confirm the config resolves to Node 26:

```bash
node -e 'console.log(require("./ecosystem.config.cjs").apps[0].interpreter)'
```

It should print a path under `.../v26.x/bin/node`. Then restart the API from the Node that has pm2 (Node 26 since 2026-11-04; during the original cutover, pm2 was still on the old Node):

```bash
nvm use 26
pm2 delete pbot-api
pm2 start ecosystem.config.cjs --only pbot-api
pm2 save
```

### Step 5: Verify

Check the interpreter and the startup log:

```bash
pm2 show pbot-api
pm2 logs pbot-api
```

The interpreter should be under `v26.*`, and the log should show `GraphQL server ready`.

Log in from the client and save one record (an admin mutation).

Check that an anonymous mutation is rejected (replace `<host>`):

```bash
curl -s -H 'content-type: application/json' -H 'apollo-require-preflight: 1' -d '{"query":"mutation{DeleteReference(data:{pbotID:\"00000000-0000-4000-8000-000000000000\", authors:[], groups:[]}){pbotID}}"}' https://<host>/graphql
```

Expect `"code":"UNAUTHENTICATED"` and the message `You must be logged in to do this`. A `GRAPHQL_VALIDATION_FAILED` error means the query never reached the gate, so it proves nothing.

Upload an image and view it.

### Step 6: Look for other old-Node processes

```bash
crontab -l
pm2 ls
ls ~/.nvm/versions/node
```

Record anything still using Node 16 or 18 in the tables below.

### Rollback

Rolling back puts the API back on an unpatched runtime, so use it only as a stopgap, and re-add the nginx `Content-Encoding: br` block first (it was removed 2026-11-04). The old code has no guard and still uses `graphql-shield`, which works on 16.

Check out the previous release, then reinstall dependencies on Node 16:

```bash
nvm use 16.17.0
rm -rf node_modules
npm ci
```

Restart the API. pm2 lives under Node 26, and the old ecosystem file pins the interpreter to v16.17.0. Prod has v16.7.0 instead, so edit the interpreter path to match whichever 16.x the server has.

```bash
nvm use 26
pm2 delete pbot-api
pm2 start ecosystem.config.cjs --only pbot-api
pm2 save
```

## pbot-client on the dev host

On dev, PM2 runs the client's webpack dev server from `~/repos/pbot-api/client`, which is a checkout of the pbot-client repo. The `pbot-client` entry:

- runs `craco start` (`./node_modules/@craco/craco/dist/bin/craco.js` with `args: "start"`), so dev gets the same webpack polyfills as local `npm start` and the prod build. Before this change it ran `react-scripts/scripts/start.js` directly, without them.
- resolves its interpreter from `client/.nvmrc` (Node 26). The client declares `engines.node >=26.12.1` but has no startup guard; `pm2 show pbot-client` is the check.
- has `watch: false`. The pbot-client deploy (`git reset --hard origin/master` in `client/`) only changes `src/`, which webpack recompiles by itself. After a dependency change, run `npm ci` in `client/` and then `pm2 restart pbot-client`, both on Node 26.

### Client cutover runbook (dev only, one time)

Run as the PM2 user on dev. The order matters: `client/.nvmrc` must exist before pbot-api's new ecosystem file is used.

1. **Update the client first.** Pull the pbot-client branch under test (`ddm-dev`) into `client/`, then confirm `.nvmrc` is there:
   ```bash
   cd ~/repos/pbot-api/client
   git pull origin ddm-dev
   cat .nvmrc      # 26
   ```
   Once `master` is fast-forwarded, the deploy workflow keeps `client/` on `master` (`git reset --hard origin/master`).
2. **Update pbot-api.** The server's checkout had an uncommitted edit pinning the client interpreter to v18.20.8. Discard it, then pull the same branch:
   ```bash
   cd ~/repos/pbot-api
   git checkout -- ecosystem.config.cjs
   git pull origin ddm-dev
   ```
   PM2 watch restarts `pbot-api` with its stored config. This is harmless.
3. **Dependencies (optional).** The Node 18-installed `client/node_modules` were verified on Node 26, so this is hygiene only. Stop the client first. `npm ci` deletes `node_modules`, and a running dev server then logs a burst of `Module build failed … ENOENT` errors into `pbot-client-out.log`. They are harmless, but they look like a failure later.
   ```bash
   nvm use 26
   pm2 stop pbot-client
   cd ~/repos/pbot-api/client && npm ci
   ```
   Step 5 deletes and recreates the process, so there's no need to start it again here.
4. **Check what the ecosystem file resolves to:**
   ```bash
   cd ~/repos/pbot-api
   node -e 'require("./ecosystem.config.cjs").apps.forEach(a => console.log(a.name, a.interpreter, a.script, a.args || ""))'
   ```
   Both interpreters should be under `v26.*`, and the client script should be `…/craco/dist/bin/craco.js start`.
5. **Recreate the client process** from the Node that has pm2 (Node 26 now; it was 18.20.8 when this cutover ran). Use `delete` + `start`, because `restart` keeps the old interpreter and script. Don't use `pm2 update` or `restart all`; `pbot-api` doesn't need touching.
   ```bash
   nvm use 26
   pm2 delete pbot-client
   pm2 start ecosystem.config.cjs --only pbot-client
   pm2 save
   ```
6. **Verify:**
   - `pm2 show pbot-client` shows Node.js version ≥ 26.12.1, script path `…/craco/dist/bin/craco.js`, args `start`, and watch ✘.
   - The out log shows `Compiled successfully` or `Compiled with warnings` (ESLint warnings only) after the newest `Starting the development server...`: `grep -n "Starting the development\|ompiled" ~/.pm2/logs/pbot-client-out.log | tail -5`. `pm2 logs --lines 0` only follows new output, so it looks hung once the compile has finished.
   - `curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/` prints `200`.
   - In the browser: load the site, run a query, log in and save a record, and export a PDF. The PDF export exercises the CRACO polyfills dev didn't have before.
7. Add a row to the cutover log below.

### Client rollback

This needs v18.20.8 still installed on dev. Check out the previous `ecosystem.config.cjs`, and locally set the `pbot-client` interpreter to `/home/doug/.nvm/versions/node/v18.20.8/bin/node` (the old file says v16.17.0). Then:

```bash
nvm use 26
pm2 delete pbot-client
pm2 start ecosystem.config.cjs --only pbot-client
pm2 save
```

While rolled back, the client is on an unpatched runtime, so re-add the dev nginx `br` block first (it was removed 2026-11-04).

## nginx `Content-Encoding: br` stopgap

| Server | Node processes serving HTTP | `br` block |
|---|---|---|
| prod | `pbot-api` on 26 (the client is static files via nginx) | Removed 2026-11-04 |
| dev | `pbot-api` on 26, `pbot-client` dev server on 26 | Removed 2026-11-04 |

The nginx config lives on the servers, not in either repo. If either rollback below puts a process back on Node < 26.12.1, re-add the block on that server first.

## Other Node runtimes on the server

| Process | Server | Node | Status |
|---|---|---|---|
| PM2 daemon | dev, prod | 26.13.0 | pm2 7.1.2 under systemd since 2026-11-04 (see "The PM2 daemon and systemd"). |
| `pbot-client` (PM2) | dev only | 26.13.0 | Moved by pbot-client change `upgrade-client-node-26`; see "pbot-client on the dev host". |

Old Node versions are still installed on both servers as a rollback path. See "Post-bake cleanup" below.

## Post-bake cleanup (pending)

Both servers have run on Node 26, with pm2 7.1.2 under systemd, since 2026-11-04, and both rebooted cleanly. The old Node versions and the `.pre-v26` backups were kept as a rollback path. When you're confident, remove them as below. **After this, none of the rollback sections in this file can work.**

Run each command on its own, as `doug`.

### 1. Make sure nothing still uses them (both servers)

```bash
nvm use 26
```
```bash
ls ~/.nvm/versions/node
```
```bash
grep -l "v1[6-8]\.\|v20\." ~/.pm2/dump.pm2 /etc/systemd/system/*.service
```
This should print nothing.
```bash
crontab -l
```
This should show no `nvm` or `node` lines, or "no crontab".
```bash
cat ~/.nvm/alias/default
```
This should print `26`.

If any check fails, stop and find out what still uses the old version.

### 2. Remove the old Node versions

`nvm uninstall` won't remove the version your shell is using, which is why step 1 runs `nvm use 26`. Remove every version that step 1's `ls` showed, except v26.x.

**dev** (as of 2026-11-04: v17.4.0, v18.20.8, and anything else `ls` shows):
```bash
nvm uninstall 17.4.0
```
```bash
nvm uninstall 18.20.8
```

**prod** (as of 2026-11-04: v16.7.0, v18.20.8, v20.20.2):
```bash
nvm uninstall 16.7.0
```
```bash
nvm uninstall 18.20.8
```
```bash
nvm uninstall 20.20.2
```

### 3. Remove the backups

**Both servers:**
```bash
rm ~/.pm2/dump.pm2.pre-v26
```
**dev:**
```bash
rm ~/pbot-pm2.service.pre-v26
```
**prod:**
```bash
rm ~/pm2-doug.service.pre-v26
```

### 4. Check (both servers)

```bash
ls ~/.nvm/versions/node
```
This should show only v26.x.
```bash
pm2 ls
```
Everything should still be `online`.

### 5. Update this file

- Remove the rollback sections that need old Node: "Rollback" under the API cutover runbook, and "Client rollback".
- Drop the "re-add the block if a rollback…" sentence from the nginx section.
- Add a cutover-log row for each server's cleanup.
- Remove this section, or mark it done.

## Cutover log

| Server | Date | Node | Other old-Node users found |
|---|---|---|---|
| dev | 2026-11-03 | 26.13.0 | PM2 daemon and `pbot-client` on 18.20.8; nothing in cron |
| dev (`pbot-client`) | 2026-11-04 | 26.13.0 | `pbot-client` moved to Node 26 via `craco start`, watch off |
| dev (PM2 daemon) | 2026-11-04 | 26.13.0 | `pbot-pm2.service` moved from pm2 5.1.2 on Node 17.4.0 to pm2 7.1.2 on Node 26. Reboot verified 2026-11-04 |
| prod (PM2 daemon) | 2026-11-04 | 26.13.0 | `pm2-doug.service` moved from pm2 5.3.0 on Node 16.7.0 to pm2 7.1.2 on Node 26. Removed the stray pm2 7.0.1 from v20.20.2. Reboot verified 2026-11-04 |
| prod | 2026-11-03 | 26.13.0 | PM2 daemon on 18.20.8; nothing in cron. (An earlier version of this row also listed `pbot-client`; that was wrong, because prod has no client Node process.) |

The 2026-11-03 rows say the PM2 daemon was on 18.20.8. That was wrong. As found on 2026-11-04, on dev only the pm2 CLI was under 18.20.8 and the daemon ran on 17.4.0. On prod, both the CLI and the daemon were on 16.7.0, with no pm2 under 18.20.8.
