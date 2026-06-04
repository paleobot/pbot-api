## Why

`OTU.authority` is a free-text string that, in practice, names the original publication where the taxon was described — the same publication is typically also one of the OTU's cited references. There is currently no way to mark *which* of an OTU's cited references is that publication. Downstream consumers (PDF rendering, the eventual pbdb2 data migration) need to disambiguate it.

We considered (and rejected — see `design.md`) a larger redesign that promoted `authority` to a first-class `Authority` node with parsed-out fields (citation, descriptors, year, publishedInReference). That redesign accumulated open questions on sharing semantics, migration audit trail, group scoping, and cutover ordering. The simpler observation is that the relevant disambiguation can ride on the **existing** `(:Reference)-[:CITED_BY]->(:OTU)` edge as a single boolean property. The `authority` string stays as-is. Parsing of the string is deferred to the pbdb2 migration, where it belongs.

## What Changes

- Add `publishedInReference: Boolean` to the `OTUCitedBy` relation-payload type in `schema.graphql`.
- Add `publishedInReference: Boolean` to the shared `CitedByInput` in `schema.graphql`. The property is silently dropped by `mutateNode` for every node type other than OTU (per the `properties` list in `SchemaMaps.js`), so this does not leak meaningful behavior into Schema/Description/Specimen/Collection/Synonym/Comment inputs.
- Add `"publishedInReference"` to the `properties` list on OTU's `CITED_BY` entry in `SchemaMaps.js` so it actually persists.
- Add a server-side cardinality check inside the existing `if ("OTU" === nodeType)` block in `Resolvers.js`: at most one entry in `data.references` may have `publishedInReference: true`. Violations throw `ValidationError`. This guards both client and direct-API writers.
- Fix a latent bug in the relationship-property persistence path in `Resolvers.js` (`handleCreate` line ~609-613 and `handleUpdate` line ~515-519). The pre-existing code wrote every relationship property as a Cypher string literal (`prop: "${val}"`) and used a JS truthy guard (`&& relInstance[prop]`) to decide whether to emit. The result was that Boolean `true` would persist as the string `"true"` and Boolean `false` would be silently dropped, which broke the new `publishedInReference` field. Both call sites are replaced with a type-aware emitter that writes Booleans and Numbers as Cypher literals and continues to string-quote everything else. This fix was discovered during verification of the OTU change; rolling it into the same change since the OTU feature cannot ship without it. See `design.md` for the patch and a discussion of relationship-typing limitations that remain after this fix.

Out of scope (tracked in the `pbot-client` repo as a separate OpenSpec change):

- OTU mutation form: single-select checkbox (or equivalent UI) for marking exactly one reference as `publishedInReference`.
- OTU display (web and PDF): flag the publication-of-authority citation visually.

## Capabilities

### New Capabilities

- **`otu-published-in-reference`** (implicit, no existing OpenSpec spec): The `OTU ←CITED_BY← Reference` edge gains an optional boolean `publishedInReference` indicating "this citation is the publication where the taxon's authority was established." At most one such flagged edge is allowed per OTU.

### Modified Capabilities

None.

## Impact

- **Schema (`schema.graphql`)**: Two additive fields (`OTUCitedBy.publishedInReference`, `CitedByInput.publishedInReference`). Both nullable. No breaking change.
- **`SchemaMaps.js`**: One string added to OTU's CITED_BY `properties` list.
- **`Resolvers.js`**: One validation block (~5 lines) inside the existing OTU branch, plus a small replacement (~7 lines, applied identically at two near-duplicate call sites) of the relationship-property emitter.
- **Data model (Neo4j)**: No migration. Existing `CITED_BY` relationships remain without the property; null is treated as false everywhere.
- **Clients (`pbot-client`, direct-API users)**: GraphQL change is additive — existing queries and mutations continue to work unchanged. New writers can begin populating `publishedInReference` once UI lands. Direct-API users who already understand `CitedByInput` get a new optional field; cardinality is enforced server-side.
- **Future pbdb2 migration**: When the `authority` string is parsed, the `publishedInReference` flag on the OTU's `CITED_BY` edges gives the parser a strong hint about which `Reference` corresponds to the authority — improves disambiguation without requiring any structural change at migration time.
