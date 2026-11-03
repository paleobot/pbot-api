## Why

While smoke-testing the Node 26 upgrade (2026-11-03) we found injection-class and authorization flaws in the image and mutation code. Registration is open, has no email verification, and gives every new user the `admin` role and `public` group membership. So "admin-only" does not limit who can exploit any of these:

1. **Arbitrary file read (confirmed on a scratch server; fixed and deployed):** `GET /images/:pbotID/:image` passed the URL-decoded `:image` param to `path.resolve` → `res.sendFile`. Prod's nginx turned out to block the `.env` path, because it selects a `location` using the normalised URI. Even so, the code was exploitable wherever the API could be reached directly.
2. **Arbitrary file write:** `uploadFile` built paths from the client's `specimenID`/`imageOf` and filename.
3. **Cypher injection in mutations:** `Resolvers.js` places request values in query text. IDs go in raw (`n.pbotID = "${pbotID}"`), and so does free text in `isDuplicate` (`{title: "${data.title}"}`) and in relationship property values. A `"` in any of them breaks out of the string. Queries are not affected: the fuzzy-search resolvers use driver parameters.
4. **Image writes skip group authorization:** `UploadImage` writes files for any `specimenID` with no group check (`pbot-client`'s `ImageMutateForm` uses it). `CreateImage` and `UpdateImage` write or rename files *before* `mutateNode`'s group-membership check, and don't clean up if that check fails. Any registered user who knows a specimen's UUID and filename can overwrite its images.

This change closes all four quickly with targeted fixes. The full refactors are split out into their own changes so this one can be finished and archived.

## What Changes

- **Done:** contain every image filesystem path inside `IMAGE_DIR` (GET, upload, rename, delete). Fix the process crash on image GETs with no token or an invalid one.
- **Done:** incident response (log review, nginx routing analysis, `JWT_SECRET` rotation on prod).
- **Mutation input stopgap:** before any query runs, reject any ID-bearing mutation input that isn't a UUID. Escape the remaining free-text interpolations with `JSON.stringify` (the main property `SET` path already does this). Parameterize `renameFile`'s lookup, which runs before `mutateNode`.
- **Image write authorization:** require the caller to be a member of a group the target Specimen belongs to before any image file is written or renamed. Remove an uploaded file if the subsequent mutation fails.

## Capabilities

### New Capabilities
- `image-file-path-safety`: every filesystem path built from request or stored data stays inside `IMAGE_DIR`, and image file writes require group access to the target specimen.
- `mutation-input-safety`: request values cannot change the structure of mutation Cypher. ID inputs must be UUIDs, and free-text values are escaped as string literals.

### Modified Capabilities
<!-- None. -->

## Impact

- **Code:** `ImageManagement.js` (done, plus the group check), `Resolvers.js` (`mutateNode` entry validation, `isDuplicate`, relationship-property literals, `getPerson`, the image resolvers).
- **Data:** none. All existing `pbotID`s are UUIDs: verified locally, and to be confirmed on prod before deploying.
- **Spun off:**
  - `parameterize-cypher-values`: replace every interpolation with driver parameters. This is the real fix that this change's stopgap holds the line for.
  - `generated-image-filenames`: server-generated upload filenames and an extension allow-list.
- **Out of scope (recommended as a separate change):** account and session weaknesses:
  - every registration gets `admin`;
  - `useExistingUser` lets anyone claim a password-less Person node, with no email verification;
  - `surname === "dummy"` skips the existing-user check;
  - password reset clears the password and waits for re-registration, which leaves a takeover window;
  - login JWTs have no expiry (`expiresIn` is commented out) and cannot be revoked per user, so only rotating `JWT_SECRET` kills a token (fix: restore expiry and add a per-Person `tokensValidAfter` compared to `iat`);
  - bearer tokens are written to PM2 logs (`console.log(token)` in `handleImages` and in the GraphQL context in `index.js`);
  - an invalid token silently falls back to the `guest` user instead of producing an authentication error.
- **Out of scope (separate change):** node-level authorization for inherited-group types. `mutateNode` checks caller group membership only for caller-controlled types (`CALLER_CONTROLLED_GROUP_TYPES`). For `Image`, `Character`, `State`, `CharacterInstance` and `Specimen`, nothing checks that the caller belongs to the parent's groups, so a non-member can create or edit these nodes under another group's parent (seen for `Image` on 2026-11-03). This change only gates image *file* writes.
