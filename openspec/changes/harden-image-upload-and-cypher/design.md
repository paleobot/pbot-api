## Context

**Image paths (before the hotfix)** (`ImageManagement.js`):

```
GET /images/:pbotID/:image
  ├─ auth: caller MEMBER_OF a group the Specimen {pbotID} is ELEMENT_OF   (parameterized ✅)
  └─ res.sendFile(path.resolve(imageDir, pbotID, image))                    (image unchecked ❌)

UploadImage            → uploadFile(file, specimenID)                       (no group check ❌)
CreateImage            → uploadFile(...)  → mutateNode (group check)        (file written first ❌)
UpdateImage            → renameFile(...) → uploadFile(...) → mutateNode     (rename + write first ❌)
renameFile(pbotID)     → "${pbotID}" lookup → link → path.join(imageDir, …)
deleteFile(path)       → fs.unlinkSync(path)
```

**Cypher in mutations** (`Resolvers.js`): 5 of the 13 `run` calls pass no parameters, and some that pass a params object (`getPerson`, `isSynonym`) still interpolate the value into the text. Raw `"${…}"` sites fall into two kinds:
- **IDs:** `pbotID`, `enteredByPersonID` (server-injected), relationship target IDs (`remoteID`), `rootID` (`schemaID`/`descriptionID`/`collection`/`imageOf`), `parentID`, `stateID`, `characterID`, `subjectID`, `otus[]`.
- **Free text:** `isDuplicate`'s `title`, `surname`, `given`, `middle`, `link`, `name`, `content`; relationship property values (`"${val}"` in the create and update builders); `getPerson`'s `email`.

`location` latitude/longitude are interpolated unquoted, but the `Latitude`/`Longitude` custom scalars only accept numbers in range. Queries are parameterized (`fuzzyDelegate` uses `$q`/`$limit`; `@cypher` fields bind arguments as parameters).

**Data:** every `pbotID` in the local DB is a UUID: 2,600+ nodes across 28 labels, including soft-deleted `_Label` nodes. Prod `Specimen` IDs have been confirmed; the other labels still need checking on prod.

## Goals / Non-Goals

**Goals:**
- No request input can read, write, rename or delete a file outside `IMAGE_DIR`.
- No request input can change the structure of a mutation's Cypher.
- No caller can write image files for a specimen outside their groups.
- Each item can be deployed on Node 16/18 now, independently of `upgrade-api-node-26`.

**Non-Goals:**
- Full Cypher parameterization (`parameterize-cypher-values`).
- Server-generated upload filenames (`generated-image-filenames`).
- Account-lifecycle fixes (a separate change).

## Decisions

### D1. One path helper, three layers of defence (implemented)

`safeImagePath(imagedID, filename?)`:
1. Validate the shape: the ID is a UUID; a filename equals its own `path.basename`, isn't `.`/`..`, and contains no `/`, `\` or NUL.
2. Resolve the path and check it is under the resolved `IMAGE_DIR`.
3. GET serves via `res.sendFile(rel, { root: IMAGE_DIR, dotfiles: 'deny' })`.

`assertInsideImageDir` guards `renameFile` and `deleteFile`. GET failures return 404; upload failures raise `ValidationError`. The GET handler returns 401 for a missing or invalid token instead of dereferencing a null user.

### D2. Mutation input stopgap: UUID-check IDs, escape free text

At the very top of `mutateNode`, before any session work, `assertMutationIDs(nodeType, data)` walks:
- `pbotID` and `enteredByPersonID`;
- every `graphqlName` in `schemaMap[nodeType].relationships`;
- a fixed list of ID fields used outside `schemaMap`: `schemaID`, `descriptionID`, `characterID`, `stateID`, `parentID`, `imageOf`, `subjectID`, `collection`, `elements`, `members`, `groups`, `otus`.

Values may be a string, an array of strings, or an array of objects carrying `pbotID` (`authors`, `references`). Each non-empty string must be a UUID. `null`, `undefined` and `""` are allowed, since the client sends `""` for unset optional IDs and an empty string can't inject anything. Failure raises `ValidationError` naming the field.

The self-contained helpers `isDuplicate`, `getPerson` and `isSynonym` are switched to real driver parameters, which is as small a change as escaping and strictly better. The remaining free-text interpolations, relationship property values inside the create/update string builders, switch from `"${x}"` to `${JSON.stringify(String(x))}`. JSON string escaping (`\"`, `\\`, control characters, `\uXXXX`) is valid Cypher string-literal syntax, and the main property `SET` path already relies on it. The relationship-property site already skips `undefined`/`null` values before building the literal.

`renameFile`'s lookup becomes `MATCH (n {pbotID: $pbotID})`, because `UpdateImage` calls it before `mutateNode`.

*Why a stopgap and not full parameterization:* this is about an hour of work and leaves query semantics alone. Full parameterization touches every builder and needs a regression harness first (`parameterize-cypher-values`). The UUID rule stays useful afterwards as input validation.

*Alternative considered:* escaping IDs instead of validating them. Validation is stricter and catches malformed client input earlier.

### D3. Group authorization before any image file write

Add `assertCanWriteSpecimenImages(context, specimenID)`. It runs the same parameterized query the GET path uses (caller `MEMBER_OF` a group the Specimen is `ELEMENT_OF`) and throws `ForbiddenError` when the caller isn't in one. Call it:
- in `UploadImage` before `uploadFile`;
- in `CreateImage` before `uploadFile`;
- in `UpdateImage` before `renameFile`, using the Image's current `imageOf` specimen. If the update moves the image to another specimen, also check the target `imageOf`.

`CreateImage` deletes the just-uploaded file if `mutateNode` throws, mirroring `UpdateImage`'s existing cleanup.

*Alternative considered:* move the file write after `mutateNode`. That's a bigger reorder, and `link` has to be known before the node is written.

## Risks / Trade-offs

- [Non-UUID IDs on prod break mutations that reference them] → Run the all-labels query on prod before deploying D2 (task 3.1).
- [`JSON.stringify` changes how stored strings compare in `isDuplicate`] → The escaped literal is the same value as the raw one for any string without `"` or `\`. For strings that do contain them, the old query was a syntax error, so nothing that worked before changes.
- [The ID field list misses a field] → The list comes from diffing every `*Input` type against `schemaMap.properties`. The full parameterization in `parameterize-cypher-values` removes the dependence on the list.
- [`UpdateImage` checking the old specimen's group blocks legitimate moves between groups] → Require membership of both the old and new specimens' groups; moving an image out of a group you can't write to should fail anyway.

## Migration Plan

1. **Done:** D1 hotfix deployed to dev and prod; incident response complete.
2. D2: implement, verify on Node 16/18, run the prod ID check, deploy to dev, then prod.
3. D3: implement, verify, deploy to dev, then prod.
4. Archive this change once 2 and 3 are on prod.
5. **Rollback:** each item is a single independent commit to revert.

## Open Questions

- Does `pbot-client` ever send IDs that aren't UUIDs, such as placeholders or `"new"`? Grep the client before deploying D2.
