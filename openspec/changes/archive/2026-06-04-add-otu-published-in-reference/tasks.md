# Tasks

## Schema

- [x] In `schema.graphql`, add `publishedInReference: Boolean` to the `OTUCitedBy` type (line 554-558).
- [x] In `schema.graphql`, add `publishedInReference: Boolean` to the `CitedByInput` input (line 858-861).

## Persistence

- [x] In `SchemaMaps.js`, add `"publishedInReference"` to the `properties` list on OTU's `CITED_BY` relationship entry (line 600-603).

## Server-side validation

- [x] In `Resolvers.js`, inside the existing `if ("OTU" === nodeType)` block (line 778-795), add a check that throws `ValidationError` when more than one entry in `data.references` has `publishedInReference === true`.

## Relationship-property persistence fix (discovered during verification)

- [x] In `Resolvers.js` `handleCreate` (line ~609-613), replace the relationship-property emitter with the type-aware version from `design.md` (Boolean/Number unquoted, String quoted, null/undefined skipped).
- [x] Apply the identical replacement in `handleUpdate` (line ~515-519).
- [x] Confirm that the existing `order` field on CITED_BY edges across all node types (Reference, Schema, Description, OTU, Synonym, Comment, Specimen, Collection) still persists as a quoted String — no regression on the only consumer in use today.

## Manual verification

- [x] Mutation with two references both flagged `publishedInReference: true` → `ValidationError` returned, no write performed.
- [x] Mutation with exactly one flagged reference → succeeds; subsequent query of the OTU returns `publishedInReference: true` on the flagged edge only.
- [x] Mutation with no flagged references → succeeds; behavior unchanged from today.
- [x] Existing OTU updated without supplying `publishedInReference` on any reference → succeeds; existing edges remain unflagged (no implicit backfill).
- [x] Direct Cypher inspection (`MATCH (r:Reference)-[c:CITED_BY {publishedInReference: true}]->(o:OTU) RETURN ...`) confirms the property lands on the edge **as a native Boolean** (not a String `"true"`), and that `false` is persisted (not dropped).
- [x] Confirm the field is exposed by introspection on `OTUCitedBy` and `CitedByInput`.
- [x] Spot-check that mutations on Schema, Description, Specimen, Collection, Synonym, and Comment that include `publishedInReference` in their `references` input do NOT persist the property anywhere (silent drop is the intended behavior; just confirm nothing breaks).

## Handoff

- [ ] Once deployed, open a corresponding OpenSpec change in `pbot-client` covering: OTU mutation form widget (single-select for `publishedInReference`), web display flagging, PDF display flagging.
