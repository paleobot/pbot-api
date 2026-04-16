## 1. Spike: validate Pattern D end-to-end with `fuzzyReference`

- [x] 1.1 Introspect the augmented schema (e.g., via Apollo sandbox or a one-off `printSchema()` call) and confirm that `_ReferenceFilter`, `_ReferenceOrdering`, and `pbotID_in` (on `_ReferenceFilter`) exist with the expected shapes
- [x] 1.2 Add `fuzzyReferenceTitleIndex` to the dev Neo4j: `CALL db.index.fulltext.createNodeIndex('fuzzyReferenceTitleIndex', ['Reference'], ['title'])`
- [x] 1.3 Declare `fuzzyReference` in `schema.graphql` with `searchString: String!`, `fuzzyLimit: Int = 200`, `filter: _ReferenceFilter`, `first: Int`, `offset: Int`, `orderBy: [_ReferenceOrdering]`, returning `[Reference]` — no `@cypher` directive — including the index-creation Cypher in the doc-comment
- [x] 1.4 Implement the `fuzzyReference` resolver in `Resolvers.js` per the design.md recipe (fulltext call → `pbotID_in` injection → `neo4jgraphql()` delegation → JS re-sort by score unless `orderBy` is supplied) — implemented as shared `fuzzyDelegate` helper since the four other resolvers will use the identical pattern
- [x] 1.5 Manual verification: a simple fuzzy query returns expected References in score order
- [x] 1.6 Manual verification: `filter: { year: "..." }` correctly narrows results
- [x] 1.7 Manual verification: a nested relationship filter (e.g., `authors_some: { pbotID: "..." }`) works
- [x] 1.8 Manual verification: `orderBy` overrides score order
- [x] 1.9 Manual verification: a Reference belonging to a group the caller is NOT a member of is NOT returned (`cypherParams` group scoping confirmed)
- [x] 1.10 If any of 1.1–1.9 reveals a divergence from design.md, update design.md and proposal.md before continuing

## 2. Implement remaining four fuzzy queries

- [x] 2.1 Add `fuzzySchemaTitleIndex` to dev Neo4j; declare `fuzzySchema` in `schema.graphql`; implement resolver in `Resolvers.js`; manually verify
- [x] 2.2 Add `fuzzyCollectionNameIndex` to dev Neo4j; declare `fuzzyCollection` in `schema.graphql`; implement resolver in `Resolvers.js`; manually verify
- [x] 2.3 Add `fuzzyOTUNameIndex` to dev Neo4j; declare `fuzzyOTU` in `schema.graphql`; implement resolver in `Resolvers.js`; manually verify
- [x] 2.4 Declare `fuzzyPerson` in `schema.graphql` reusing the existing `fuzzyPersonNameIndex`; implement resolver (note: step 1 builds the per-field Lucene query string from `surname`/`given`/`middle` args, like the existing `fuzzyPersonSearch` does); manually verify
- [x] 2.5 If 2.1–2.4 reveal that the five resolvers share enough structure to warrant a small helper (`fuzzyResolverFactory`), extract one. Otherwise leave them as five hand-written resolvers.

## 3. Operational artifacts

- [x] 3.1 Create `cypher/setup-fuzzy-indexes.cypher` with idempotent creation calls for all five fulltext indexes (use `CALL db.index.fulltext.createNodeIndex(...)` wrapped so re-running is safe — `apoc.do.when` on `db.indexes()` lookup, or simply catch the "index already exists" error)
- [x] 3.2 Verify the setup script runs cleanly against a Neo4j instance where the indexes already exist (idempotency check)
- [x] 3.3 Add a deprecation doc-comment to `fuzzyPersonSearch` in `schema.graphql` pointing to `fuzzyPerson` as the replacement

## 4. Documentation

- [x] 4.1 Update `FUZZY_SEARCH.md` to describe the new pattern (Pattern D), list all five fuzzy queries, and reference `cypher/setup-fuzzy-indexes.cypher`
- [x] 4.2 Note in `FUZZY_SEARCH.md` that `fuzzyPersonSearch` is deprecated in favor of `fuzzyPerson`, and that the pbot-client migration is tracked separately in that repo

## 5. Pre-deploy verification

- [ ] 5.1 Run `cypher/setup-fuzzy-indexes.cypher` against the staging Neo4j (after merge to the deployment branch but before production traffic hits the new queries)
- [ ] 5.2 Smoke-test each of the five new queries against staging with realistic data volumes, confirming reasonable response times (< 500ms for typical searches)
- [ ] 5.3 Coordinate with whoever picks up the pbot-client change so they know the new queries are live
