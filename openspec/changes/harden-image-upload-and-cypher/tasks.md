## 1. Hotfix: image path containment (ship first, on its own)

- [x] 1.1 Add `safeImagePath(...segments)` in `ImageManagement.js`: resolve `IMAGE_DIR` once at startup, validate segments (basename equality, no `.`/`..`/NUL/`/`/`\`), resolve, then check `startsWith(root + path.sep)`
- [x] 1.2 GET `/images/:pbotID/:image`: validate via `safeImagePath`, return 404 on failure, serve with `res.sendFile(rel, { root: IMAGE_DIR, dotfiles: 'deny' })`
- [x] 1.3 `uploadFile`: validate `imagedID` as a UUID and run containment before `mkdirSync`/`createWriteStream`; raise `ValidationError` on failure
- [x] 1.4 `renameFile` / `deleteFile`: route every path through `safeImagePath`; refuse anything outside `IMAGE_DIR`
- [x] 1.5 Before enforcing: list `IMAGE_DIR` and confirm all existing files pass GET validation; query for any non-UUID `Specimen.pbotID` (local only: 14/14 Specimen IDs are UUIDs, all 8 files pass)
- [x] 1.6 Verify locally: `..%2F` / `..%5C` / `..` requests → 404; a legitimate image → 200; an unauthorized specimen → 401; upload with `specimenID: "../x"` → `ValidationError`, nothing created outside `IMAGE_DIR` (passed on Node 16.17.0 and 18.20.8; "no access" was tested with a nonexistent specimen UUID; busboy already strips `../` from multipart filenames, so such uploads land as the basename inside the specimen dir)
- [x] 1.6a Fix process crash on unauthenticated image GET: `getUser` returned null and `user.pbotID` threw inside an unawaited async route (unhandled rejection). Now returns 401; the handler is wrapped in try/catch
- [x] 1.6b Repeat the 1.5 data check against prod (non-UUID `Specimen.pbotID`, unusual filenames under prod `IMAGE_DIR`) before deploying
  - 2026-11-03: maintainer confirmed all prod `Specimen.pbotID` values are UUIDs
- [ ] 1.7 Deploy manually to dev, verify (traversal request → 404, normal images load), then to prod after 1.6b

## 2. Incident response

- [x] 2.1 Check whether the API port (4001) is reachable directly, bypassing nginx, on dev/prod
  - 2026-11-03: not reachable from outside on dev or prod, so all external API traffic goes through nginx and the nginx logs (2.2) and the Brotli block cover it
- [ ] 2.2 Grep all retained nginx access logs for `/images/` requests containing `..`, `%2e`, `%2f` or `%5c` (case-insensitive); record the result
  - dev (2026-11-03): logs cover ~2026-10-20 to 2026-11-03 (daily rotation, 14 kept). 30 image requests, all `/images/<uuid>/<file>`, which confirms the pattern matches real traffic. 0 traversal hits. Exposure dates from 2022-09-02 (`1ededa0`), so this cannot rule out earlier exploitation.
  - prod: log search not run. Analysis of prod's nginx config makes it largely moot: nginx picks a `location` using the normalised URI (with `%2F` decoded and `..` resolved), and API routes are `location /images { proxy_pass http://localhost:4001; }`. Any traversal that leaves `IMAGE_DIR` on disk also leaves `/images` in the URI and falls through to the client catch-all, as observed: `…/..%2F..%2F.env` → `index.html`, 200. The only reachable gap was sibling directories of `IMAGE_DIR` named `images*`, because the prefix has no trailing slash. Port 4001 is not externally reachable. Conclusion: `.env` was not reachable through nginx. Optional hardening: change it to `location /images/`.
- [x] 2.3 Rotate `JWT_SECRET`, `NEO4J_PASSWORD` and `EMAIL_PASSWORD` unless 2.2 conclusively rules out exploitation; restart PM2; tell users they need to log in again
  - 2026-11-03 decision: rotated `JWT_SECRET` on prod only. Reasons: tokens never expire, a live prod token was shared during the investigation, and `handleImages` logs bearer tokens. Dev's `JWT_SECRET` was left as is. `NEO4J_PASSWORD` and `EMAIL_PASSWORD` were not rotated, per the nginx analysis in 2.2.

## 3. Server-generated upload filenames

- [ ] 3.1 Store new uploads as `<uuid><ext>` with the extension allow-listed by `mimetype`; keep the sanitized original name as a display property
- [ ] 3.2 Confirm `UpdateImage` rename/revert and `DeleteImage` work for both old-style and new-style filenames
- [ ] 3.3 Confirm `pbot-client` does not depend on the original filename appearing in `link`

## 4. Cypher parameterization

- [ ] 4.1 Build a before/after harness: a scripted set of create/update/delete mutations (with cascades) run against a DB snapshot, dumping resulting node/edge properties for diffing
- [ ] 4.2 Add identifier allow-list assertions (labels, relationship types, property names) from `SchemaMaps.js`
- [ ] 4.3 Parameterize the `mutateNode` create path (SET via `$props`; `location` via `point({latitude:$lat, longitude:$lon})` with numeric validation); handle omitted optional fields
- [ ] 4.4 Parameterize the update path, including audit-history `ENTERED_BY` property comparisons
- [ ] 4.5 Parameterize the delete paths (blocking/cascade/nonblocking checks, soft-delete relabeling)
- [ ] 4.6 Parameterize the remaining helpers: `getPerson`, synonym checks (~line 74), group-scoping lookups (~lines 160–250), and `renameFile`'s lookup in `ImageManagement.js`
- [ ] 4.7 Confirm with grep that no `.run(` call lacks a params argument and no `"${` remains in Cypher text
- [ ] 4.8 Run the harness; the diff must be empty apart from intended fixes (omitted-field handling); run the injection scenarios from the spec
