## Context

The pbot-api currently exposes one fuzzy-search query, `fuzzyPersonSearch`, implemented as a `@cypher` directive in `schema.graphql`. The directive's Cypher block builds a Lucene query string, calls the `fuzzyPersonNameIndex` fulltext index, and applies a hand-rolled `WHERE` clause for non-fuzzy filters (`pbotID`, `email`, `orcid`, `excludeList`, `groups`).

This pattern works but has structural problems:

1. **Filter logic is duplicated.** The auto-generated `Person` query already supports rich filters (`_PersonFilter`), nested relationship filters, ordering, pagination, and group scoping via `cypherParams`. The `@cypher` block re-implements a tiny subset of this by hand.
2. **Group scoping is re-implemented.** The auto-generated query gets group scoping for free via `cypherParams` and `additionalLabels`. The `@cypher` directive bypasses both, requiring the developer to remember to add an `EXISTS { MATCH ... }` clause — a real gotcha.
3. **It doesn't compose.** Adding a new filter means editing Cypher inside a string literal in `schema.graphql`. Adding fuzzy variants for Schema, Reference, Collection, OTU — each with their own form filter sets — would multiply this complexity by five.

The exploration phase identified that `neo4j-graphql-js` exposes `neo4jgraphql()` and `cypherQuery()` as a public escape hatch (documented at `docs/neo4j-graphql-js-api.md:130-220`). When called from a custom resolver where `resolveInfo.returnType` is `[Reference]` (or any node type), the library uses the **return type** to drive its standard auto-generation — full filter, projection, `cypherParams`, and ordering machinery. The custom resolver only needs to do the part that the library *can't* do: the fulltext index call.

## Goals / Non-Goals

**Goals:**
- Add fuzzy search for Schema, Reference, Collection, OTU with the same pattern across all entities.
- Refactor Person fuzzy search onto the same pattern (as a new `fuzzyPerson` field), deprecating `fuzzyPersonSearch`.
- Inherit *all* existing filter, projection, ordering, pagination, and group-scoping behavior from the auto-generated node queries — no hand-rolled WHERE clauses.
- Score-ordered results by default; explicit `orderBy` overrides.
- Operational story: idempotent index-creation script + doc-comments in schema.

**Non-Goals:**
- Removing `fuzzyPersonSearch` (separate future change after pbot-client migrates).
- Changes to pbot-client (separate change in that repo).
- Cross-field fuzzy matching for the four new entities (single-field per node, per the team's scope decision).
- Exposing fuzzy match scores in the GraphQL response.
- Pagination *of the fuzzy candidate set* (only the post-filter result set is paginated; the candidate set is bounded by `fuzzyLimit`).

## Decisions

### Decision 1: Use `neo4jgraphql()` + delegation pattern (Pattern D)

**Choice:** Each fuzzy resolver does a fulltext index call to get score-ordered `pbotID`s, injects them into a `pbotID_in` filter (all five entities use `pbotID` as their primary key), and delegates to `neo4jgraphql()` for the actual node query.

**Rationale:**
- Inherits the entire auto-generated query path, including `cypherParams` group scoping and all filter inputs.
- ~25 lines per node vs. growing `@cypher` blocks.
- Future schema changes (new properties, new relationships) automatically benefit.
- Documented, supported public API of neo4j-graphql-js.

**Alternatives considered:**
- **Pattern A — `@cypher` only** (current `fuzzyPersonSearch` approach): rejected as the duplication-of-logic problem above.
- **Pattern B — raw Cypher in resolver, no delegation**: rejected because we lose neo4j-graphql-js's projection, requiring us to manually implement nested-field traversal.
- **Pattern C — fuzzy + JS post-filter**: rejected because it's just B with extra steps; same projection problem; client gets bloated payloads.

### Decision 2: Field naming — `fuzzy<Type>` (no `Search` suffix)

**Choice:** New fields are named `fuzzyPerson`, `fuzzySchema`, `fuzzyReference`, `fuzzyCollection`, `fuzzyOTU`.

**Rationale:**
- We can't reuse `fuzzyPersonSearch` while the deprecated version coexists with the new one.
- Shorter and consistent; the redundant `Search` suffix doesn't add information.
- Establishes a single naming convention for all five.

**Alternatives considered:**
- `fuzzy<Type>Search` — would conflict with existing `fuzzyPersonSearch`.
- `fuzzy<Type>2` — ugly and temporary.
- Renaming old to `fuzzyPersonSearchLegacy` and reusing `fuzzyPersonSearch` for the new — still a breaking change for the client.

### Decision 3: Re-sort by fuzzy score in JS, but `orderBy` wins

**Choice:** After `neo4jgraphql()` returns results, the resolver re-sorts them by their position in the score-ordered ID list returned from step 1 — *unless* the caller passed an explicit `orderBy`, in which case the auto-generated query's ordering is preserved.

**Rationale:**
- Score order is the natural default for fuzzy search ("most-likely match first").
- Respecting explicit `orderBy` keeps the principle of least surprise — if the user asked for alphabetical, give them alphabetical.
- Score is an internal artifact; not exposed to the client.

**Alternatives considered:**
- **Always score-order** — rejected; surprises users who pass `orderBy`.
- **Expose score in the response** — rejected for now (team decision); could be added later as a backward-compatible field addition.

### Decision 4: `fuzzyLimit` ceiling on the candidate set, default 200

**Choice:** Step 1 of each resolver applies `LIMIT $fuzzyLimit` to the fulltext call before passing IDs into the delegated query. Default 200, overridable per-call.

**Rationale:**
- Lucene `~` fuzzy matching is generous and can return thousands of low-score matches against a large corpus.
- An unbounded candidate set means a multi-thousand-element `<idField>_in: [...]` parameter — large Cypher params, slow scans.
- 200 is conservative: top-200-by-score is almost always a superset of what survives downstream filters in realistic usage.
- Override is available for the rare case where a caller knows they need a wider net.

**Trade-off:** If filters are aggressive *and* the matching documents are low-score, they may fall outside the top-200 and the caller sees fewer results than they "should." Acceptable; surfaced as a known limitation.

### Decision 5: Single-field fulltext indexes for the four new entities

**Choice:** One fulltext index per new entity, single property each:
- `fuzzySchemaTitleIndex` on `Schema(title)`
- `fuzzyReferenceTitleIndex` on `Reference(title)`
- `fuzzyCollectionNameIndex` on `Collection(name)`
- `fuzzyOTUNameIndex` on `OTU(name)`

The existing composite `fuzzyPersonNameIndex` over `Person(given, middle, surname)` is reused unchanged by `fuzzyPerson`.

**Rationale:**
- Per the team's scope decision, only one property per new entity needs fuzzy support.
- Single-field indexes simplify the Lucene query string in step 1 — no per-field qualifiers needed. (Note: the original plan was `$searchString + '~'`, but the spike revealed that the search string must be tokenized first — see Decision 7.)
- Person stays composite because Person fuzzy search legitimately spans `surname`, `given`, and `middle`.

**Alternatives considered:**
- **Composite indexes for everything** — rejected as overkill; adds Lucene-syntax complexity for no current benefit.

### Decision 6: Index-creation Cypher lives in schema doc-comments AND a setup script

**Choice:** Each new field's doc-comment in `schema.graphql` includes the exact `CALL db.index.fulltext.createNodeIndex(...)` invocation, matching the precedent set by `fuzzyPersonSearch`. A new file `cypher/setup-fuzzy-indexes.cypher` consolidates all five index-creation calls (idempotent — uses `IF NOT EXISTS` semantics or equivalent) for ops use across environments.

**Rationale:**
- Doc-comments keep the requirement next to the field that needs it; first place a developer looks.
- A setup script avoids hunting through `schema.graphql` to bootstrap a new environment.
- Both forms decay in lockstep when fields are removed (the doc-comment goes with the field; the script entry should be removed in the same change).

## Risks / Trade-offs

- **`_<Type>Filter` and `_<Type>Ordering` input names assumed** — the augment-types code (`src/augment/types/node/node.js:213`, `src/augment/types/node/query.js:90`) generates `_${typeName}Filter` and `_${typeName}Ordering`. Confirmed by source review of the fork; **must be confirmed end-to-end** by introspecting the augmented schema in apply task 1 before broader implementation. → **Mitigation:** Task 1 is the Reference spike that verifies this for one entity before the others are built.

- **`cypherParams` group scoping inside delegated `neo4jgraphql()`** — based on source review (`src/index.js:35-145`), `cypherParams` is read from `context` regardless of where `neo4jgraphql` is called from, so group scoping should flow through. **Unverified end-to-end.** → **Mitigation:** Task 1 includes a multi-group test that verifies a Reference in another group is not returned by a fuzzy search executed by a user not in that group.

- **`pbotID_in` filter availability** — all five entities use `pbotID` as their primary key (verified by reading `schema.graphql`); the auto-generated `_<Type>Filter` should expose `pbotID_in: [ID!]` for each. **Confirm via introspection** in task 1.

- **Missing index = runtime error**, not silent empty result. Neo4j errors when `db.index.fulltext.queryNodes` is called against a non-existent index. → **Mitigation:** the setup script must be run in every environment before deploying these queries; rollout plan should call this out.

- **`fuzzyPersonSearch` deprecation window**: the old query stays functional until a future change removes it. Risk that the client never migrates and the deprecation persists indefinitely. → **Mitigation:** out of scope to enforce; the pbot-client change is the natural forcing function.

- **Performance characteristics** of `<idField>_in: [200 items]` against deep filter graphs (especially OTU with its many relationships) is not measured. → **Mitigation:** task 1 includes a smoke test with realistic data volumes; if degradation is significant, lower the default `fuzzyLimit` or revisit pagination strategy.

## Migration Plan

1. **Apply task 1 (spike + Reference)**: implement `fuzzyReference` end-to-end. Verify augmented filter/ordering names, `cypherParams` flow, `<idField>_in` availability, and basic performance. If anything diverges from this design, update design.md before proceeding.
2. **Apply tasks 2–5**: implement `fuzzySchema`, `fuzzyCollection`, `fuzzyOTU`, and `fuzzyPerson` using the validated pattern.
3. **Apply task 6**: `cypher/setup-fuzzy-indexes.cypher` setup script.
4. **Apply task 7**: deprecation doc-comment on `fuzzyPersonSearch`.
5. **Pre-deploy ops**: run `cypher/setup-fuzzy-indexes.cypher` in dev → staging → prod Neo4j. Each is a one-time, idempotent operation.
6. **Deploy pbot-api**: pushes to `master` auto-deploy via PM2 watch + GitHub Actions SSH. New fuzzy queries become available immediately.
7. **Rollback**: revert the schema.graphql + Resolvers.js changes. Indexes can stay (harmless) or be dropped via `db.index.drop(...)`. No data migration to undo.

### Decision 7: Tokenize search strings before building Lucene queries (spike finding)

**Choice:** `fuzzyDelegate` splits the raw search string on non-alphanumeric characters (`/[^a-zA-Z0-9]+/`), appends `~` to each token, and joins with spaces. This `buildLuceneQuery` helper replaces the original `$searchString + '~'` approach. Callers pass the raw `searchString`; Lucene query construction is internal to `fuzzyDelegate`.

**Rationale:**
- Neo4j's fulltext index standard analyzer tokenizes indexed values on non-alphanumeric characters (hyphens, punctuation, etc.). The query parser must split the same way, or terms won't match.
- Without tokenization, characters like `-` are interpreted as Lucene's NOT operator. A search for `"Ref-ddm-08-25a"` becomes `Ref NOT ddm NOT 08 fuzzy(25a)` — which excludes the target document.
- Discovered during the Reference spike: `"Manual~"` (single token) worked; `"Ref-ddm-08-25a~"` (hyphens) returned nothing.

**Trade-off:** Splitting into tokens means each term is fuzzy-matched independently with OR semantics. A search like `"Ref-ddm-08-25a"` becomes `Ref~ ddm~ 08~ 25a~`, which can match documents containing any of those tokens. Short tokens like `08` may match broadly, but the score ordering and `fuzzyLimit` cap keep results manageable.

## Open Questions

- Should `fuzzyLimit` have a hard upper bound enforced server-side (e.g., reject `fuzzyLimit > 1000`) to prevent abuse? Current proposal says no — defer until we see misuse.
- Is there value in a tiny shared helper (`fuzzyResolverFactory(typeName, indexName, idField)`) that produces the five resolvers, or do we keep them as five hand-written resolvers for readability? Lean: hand-written. Revisit after task 1 if duplication feels excessive.
