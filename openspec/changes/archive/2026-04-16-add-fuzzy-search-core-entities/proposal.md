## Why

Users searching for Schemas, References, Collections, and OTUs (Taxa) often don't know the exact spelling of the name or title. The existing `fuzzyPersonSearch` query proves this is a real need — users hit the same wall on the other core entities. Adding fuzzy search across these four entity types (`Schema.title`, `Reference.title`, `Collection.name`, `OTU.name`) closes that gap with a consistent pattern. We also take the opportunity to refactor Person fuzzy search onto the same pattern for consistency, leveraging neo4j-graphql-js's auto-generated filter, projection, and group-scoping logic instead of hand-rolled `@cypher`.

## What Changes

- Add five new GraphQL query fields, all built on the same "Pattern D" approach (custom resolver does the fulltext lookup, then delegates to `neo4jgraphql()` so the auto-generated node query handles filters, projection, and `cypherParams` group-scoping):
  - `fuzzyPerson(...)` → `[Person]` (replacement for `fuzzyPersonSearch`)
  - `fuzzySchema(...)` → `[Schema]`
  - `fuzzyReference(...)` → `[Reference]`
  - `fuzzyCollection(...)` → `[Collection]`
  - `fuzzyOTU(...)` → `[OTU]`
- Each fuzzy field accepts the standard `filter`, `first`, `offset`, and `orderBy` arguments of its underlying node type (`_PersonFilter`, `_SchemaFilter`, etc.), plus a fuzzy-specific `searchString` (or per-field equivalents for Person), and `fuzzyLimit` (default 200) capping how many candidates the fulltext index returns before downstream filters apply.
- Each resolver re-sorts results by fuzzy score in JS *unless* an explicit `orderBy` was supplied, in which case `orderBy` wins.
- Add four new single-property Neo4j fulltext indexes (one per new entity). The existing `fuzzyPersonNameIndex` (composite over `given, middle, surname`) is reused by `fuzzyPerson` — no Person index changes.
- Document each index-creation Cypher in schema.graphql doc-comments (matching the `fuzzyPersonSearch` precedent) and add a `cypher/setup-fuzzy-indexes.cypher` script for ops use.
- **Deprecate `fuzzyPersonSearch`** in a schema doc-comment but leave it functional. `pbot-client` migration to `fuzzyPerson` is a separate change in that repo. Removal of `fuzzyPersonSearch` is a future change after the client has migrated.

## Capabilities

### New Capabilities
- `fuzzy-search`: Fuzzy (Lucene-edit-distance) search across the core entity types — Person, Schema, Reference, Collection, OTU — with full filter and projection parity with the standard auto-generated node queries, score-ordered by default, and group-scoped via the same `cypherParams` mechanism the standard queries use.

### Modified Capabilities
<!-- None — no existing OpenSpec specs to modify. The deprecation of fuzzyPersonSearch is a doc-comment change, not a spec-level change. -->

## Impact

- **`schema.graphql`**: Five new query field declarations under `type Query`, each referencing auto-generated `_<Type>Filter` and `_<Type>Ordering` input types. No `@cypher` directives on the new fields. `fuzzyPersonSearch` gets a deprecation doc-comment.
- **`Resolvers.js`**: Five new `Query` resolvers (~25 lines each, plus one shared helper).
- **`cypher/setup-fuzzy-indexes.cypher`** (new): Idempotent fulltext index creation script for dev/staging/prod Neo4j environments. Includes the four new indexes; the existing `fuzzyPersonNameIndex` creation Cypher is included for documentation completeness but is a no-op where it already exists.
- **Neo4j operational change**: Each environment must run the new index-creation Cypher before the new queries will function. Missing-index behavior is a Neo4j error at query time — surfaceable, not silent.
- **Backward-compat**: `fuzzyPersonSearch` continues to work unchanged. Auto-generated `Person`, `Schema`, `Reference`, `Collection`, `OTU` queries are untouched. No breaking changes to existing GraphQL clients.
- **Client (`pbot-client`)**: A separate change in that repo will (1) migrate `PersonQueryResults` from `fuzzyPersonSearch` to `fuzzyPerson`, and (2) add fuzzy-mode toggles to the four other query forms, mirroring the existing `PersonQueryForm` pattern. Out of scope here.
- **Open questions to verify in the first apply task** (before broader implementation):
  - Confirm augmented filter/ordering input names are exactly `_<TypeName>Filter` and `_<TypeName>Ordering` for all five types in this codebase.
  - Confirm `cypherParams` group-scoping flows through `neo4jgraphql()` when called from inside a custom resolver (expected based on fork source review, but unverified end-to-end here).
  - Confirm the auto-generated `pbotID_in` filter exists for each entity. (Note: all five entities use `pbotID` as their primary key — the client-side form variables `referenceID`/`schemaID`/`collectionID`/`otuID` are form-only names, not schema fields.)
