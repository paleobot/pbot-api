## Context

**Image paths today** (`ImageManagement.js`):

```
GET /images/:pbotID/:image
  ├─ auth: caller MEMBER_OF a group the Specimen {pbotID} is ELEMENT_OF   (parameterized ✅)
  └─ res.sendFile(path.resolve(imageDir, pbotID, image))                    (image unchecked ❌)

UploadImage / CreateImage / UpdateImage → uploadFile(file, imagedID)
  ├─ mkdirSync(path.resolve(imageDir, imagedID), {recursive:true})          (imagedID unchecked ❌)
  └─ createWriteStream(path.resolve(imageDir, imagedID, filename))          (filename unchecked ❌)

renameFile(pbotID)  → link from DB → new URL(link).pathname last 2 segments → path.join(imageDir, …)
deleteFile(path)    → fs.unlinkSync(path)   (path from uploadFile result or renameFile)
```

Confirmed on a scratch server (Node 26, `IMAGE_DIR` in the scratchpad): `GET /images/<public specimen>/..%2F..%2Fcanary.txt` returned the canary file. Not yet tested against prod through nginx; whether nginx passes `%2F` through unchanged depends on how its `proxy_pass` is written.

**Cypher today** (`Resolvers.js`): 13 `run` calls, none with a params object. Values are inserted three ways:
- raw inside quotes: `"${pbotID}"`, `"${enteredByPersonID}"`, `"${email}"`, `"${rootID}"`, … (24 sites), which a `"` breaks out of;
- `${JSON.stringify(value)}` (10 sites), which mostly escapes correctly but turns `undefined` into the bare token `undefined`;
- unquoted: `Point({latitude: ${lat}, longitude: ${lon}})`.

Labels (`${nodeType}`) and property names (`baseNode.${property}`) come from `schemaMap`/`schemaDeleteMap` keys, which the server controls.

## Goals / Non-Goals

**Goals:**
- No request input can make the API read, write, rename or delete a file outside `IMAGE_DIR`.
- No request input can change the structure of a Cypher query.
- Ship the file-read fix independently and fast.

**Non-Goals:**
- Account-lifecycle fixes (role on registration, email verification, reset flow). These need a separate change.
- Renaming or moving existing image files on disk.
- Behaviour changes to group scoping or the mutation rules in existing specs.

## Decisions

### D1. One path helper, three layers of defence

Add a single `safeImagePath(...segments)` helper used by every image file operation:
1. **Validate the shape:** the specimen/imaged ID must match the UUID format `pbotID` uses (`apoc.create.uuid()`). A filename must equal `path.basename(name)`, must not be `.`/`..`, and must have no NUL or `/` `\` characters.
2. **Resolve and check containment:** `const p = path.resolve(root, ...segs)`; require `p.startsWith(root + path.sep)`, where `root` is `path.resolve(IMAGE_DIR)` computed once at startup. Optionally also `fs.realpathSync` the parent to defeat symlinks planted under `IMAGE_DIR`.
3. **Use the framework's guard:** GET uses `res.sendFile(relPath, { root: IMAGE_DIR, dotfiles: 'deny' })`, which independently returns 403 when the path escapes `root`.

On failure: GET → 404 (don't reveal whether a file exists); upload → `ValidationError`. No filesystem call happens before validation passes.

*Alternatives:* using only `express.static`-style serving would lose the per-specimen group authorization; the containment check alone is correct but brittle if someone later adds an unguarded call.

### D2. Store uploads under a server-generated name

Store new uploads as `<uuid><ext>`, where `ext` is taken from a small allow-list based on `mimetype` (jpeg/png/gif/webp/tiff). Keep the sanitized original filename as a display property. `link` is built from the stored name. Existing files and links stay as they are; `renameFile` and `deleteFile` keep working with both naming styles because they resolve through `safeImagePath`.

This also fixes the collision TODO. `UpdateImage`'s rename/revert flow still works because it uses the DB `link`, not the client filename.

### D3. Parameterize every value, allow-list every identifier

- Every value goes into a params object: `session.run(query, params)` / `tx.run(query, params)`. Builders that loop over properties name their params by index (`$p0`, `$p1`, …) or by property (`$props.title`), avoiding `JSON.stringify`.
- Where possible, set whole property maps (`SET baseNode += $props`), with `$props` built from `schemaMap[nodeType].properties` filtered to keys the caller actually sent. Omitted optional fields are left out (no change) on update, and set to `null` explicitly on create only if the current semantics require it. Decide per path, keeping today's behaviour where the client always sends every field.
- `location`: validate both numbers are finite and in range, then `point({latitude: $lat, longitude: $lon})`.
- Labels, relationship types and property names still have to be interpolated (Cypher can't parameterize them). Assert each against `Object.keys(schemaMap)` / `schemaMap[nodeType].properties` / `schemaDeleteMap` before interpolating, and throw on a mismatch.
- The audit-history logic (`SET eb.${property} = baseNode.${property}`) keeps identifier interpolation under the same allow-list.

*Alternative:* escaping values with a helper. It's fragile, and the driver's parameters are the supported mechanism.

### D4. Ordering and shipping

Phase 1 (D1 applied to GET and upload, plus incident response) ships as its own small PR straight to `master`, ahead of `upgrade-api-node-26` if needed. It doesn't depend on the runtime. Phases 2–3 (D2, D3) follow; D3 is the largest piece of work and needs careful regression checks of the create/update/delete paths, with cascades and audit edges, against the existing specs.

## Risks / Trade-offs

- [Existing filenames containing characters the new validation rejects, which would make old images unreachable through GET] → Validate GET filenames with containment plus `basename` equality only, not a strict character set. Before shipping, list `IMAGE_DIR` and confirm every existing file passes.
- [A parameterization regression silently changes mutation semantics, e.g. omitted fields] → There is no automated test suite. Build a scripted before/after check: run the same create/update/delete set on Node 26 against a DB snapshot, and diff the resulting node/edge properties.
- [Rotating `JWT_SECRET` logs everyone out] → Accept it; announce it to users.
- [Specimen IDs that aren't UUIDs (legacy data)] → Check existing `Specimen.pbotID` values before enforcing the UUID format, and fall back to the containment check alone if any are found.

## Migration Plan

1. **Phase 1 hotfix:** `safeImagePath` + GET `{root}` + upload validation → deploy → verify the traversal request returns 404 and normal images still load.
2. **Incident response:** grep nginx access logs (all retained rotations) for `/images/` with `..`, `%2e`, `%2f`, `%5c`. Rotate secrets unless the logs clearly rule out exploitation. Restart PM2 afterwards.
3. **Phase 2:** server-generated upload names.
4. **Phase 3:** Cypher parameterization, one builder at a time, with the before/after diff harness.
5. **Rollback:** each phase is an independent revert. Phase 1 should not be rolled back without a replacement fix.

## Open Questions

- What nginx log retention exists on dev/prod, and is the API reachable on `:4001` directly (bypassing nginx)?
- Are any `Specimen.pbotID` values non-UUID?
- Does any client path rely on `UploadImage` keeping the original filename in the URL?
