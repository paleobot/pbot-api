## Why

While smoke-testing the Node 26 upgrade (2026-11-03) we found three injection-class flaws. One is confirmed exploitable by any registered user:

1. **Arbitrary file read (confirmed):** `GET /images/:pbotID/:image` checks that the caller can see the specimen `:pbotID`, then calls `res.sendFile(path.resolve(imageDir, req.params.pbotID, req.params.image))`. Express URL-decodes route params, so `/images/<public specimen>/..%2F..%2F<file>` returns any file the API process can read. In a scratch copy, a canary file outside `IMAGE_DIR` came back with HTTP 200. Registration is open with no email verification and every new user is `MEMBER_OF` the `public` group, so the attacker only needs to register. `.env` is readable this way, and it holds `JWT_SECRET` (enough to forge a token for any account), `NEO4J_PASSWORD` and `EMAIL_PASSWORD`.
2. **Arbitrary file write:** `uploadFile` (`ImageManagement.js`) passes the client's `specimenID`/`imageOf` and the uploaded `filename` straight to `path.resolve(imageDir, …)` and `fs.mkdirSync(…, {recursive: true})`. Because every registered user is granted `admin`, "admin-only" does not narrow who can do this.
3. **Cypher built by string interpolation:** none of the 13 `session.run`/`tx.run` calls in `Resolvers.js` pass a parameters object. Values are placed in query text either raw inside quotes (24 `"${…}"` sites, e.g. `n.pbotID = "${pbotID}"`) or through `JSON.stringify`, and `location` latitude/longitude are inserted with no quoting at all. A `"` in a caller-supplied ID breaks out of the string literal. `renameFile` in `ImageManagement.js` has the same pattern.

## What Changes

- **Hotfix (ship first, on its own):** make every image filesystem path stay inside `IMAGE_DIR`. Validate the `:pbotID` and `:image` route params and the upload `specimenID`/`filename` (UUID / safe-basename rules), resolve, then check containment. Use `res.sendFile(name, {root})` so Express rejects traversal. Any input that fails is a 400/404 and touches no files.
- **Incident response:** review nginx access logs for `/images/` requests containing `..`, `%2e` or `%2f`. Rotate `JWT_SECRET` (this logs out all users), `NEO4J_PASSWORD` and `EMAIL_PASSWORD` unless the logs prove there was no exploitation.
- Store uploads under a server-generated filename (keeping a sanitized display name), replacing the "not worrying about collisions" TODO.
- Convert all Cypher in `Resolvers.js` and `ImageManagement.js` to driver parameters (`$name`) for every value. Labels and property names stay interpolated, but only from the server-side allow-lists in `SchemaMaps.js`. `location` becomes `point({latitude: $lat, longitude: $lon})` with numeric validation.
- Optional fields omitted by the caller must be handled explicitly (unset or `null`). Today `JSON.stringify(undefined)` produces invalid Cypher (`baseNode.firstPage = undefined`).

## Capabilities

### New Capabilities
- `image-file-path-safety`: every filesystem path built from request data (image GET, upload, rename, delete) resolves inside `IMAGE_DIR`, and anything else is rejected before any filesystem access.
- `cypher-parameterized-values`: no caller-supplied value is ever placed into Cypher query text; values travel as driver parameters, and labels/property names come only from server allow-lists.

### Modified Capabilities
<!-- None. Existing specs (mutation-group-authorization, cypher-field-group-scoping, etc.) keep their behavior; this change alters how the queries are built, not what they do. -->

## Impact

- **Code:** `ImageManagement.js` (GET handler, `uploadFile`, `renameFile`, `deleteFile`), `Resolvers.js` (`mutateNode` and the create/update/delete query builders, `getPerson`, synonym checks), possibly `SchemaMaps.js` (expose the allow-lists).
- **Data:** existing image files keep their current names and links. The new storage naming applies to new uploads only, and links stay valid because the stored `link` remains authoritative.
- **Ops:** secret rotation invalidates all existing JWTs, so users must log in again.
- **Out of scope (recommended as a separate change):** account-lifecycle weaknesses found during the same review. Every registration gets `admin`; `useExistingUser` lets anyone claim a password-less Person node with no email verification; `surname === "dummy"` skips the existing-user check; and password reset works by clearing the password and waiting for re-registration, which leaves a takeover window.
