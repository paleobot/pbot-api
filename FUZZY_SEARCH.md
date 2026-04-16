# Fuzzy Search

## Overview

Fuzzy search allows users to find records by approximate text matching, using Neo4j fulltext indexes with Lucene fuzzy matching (`~` operator, Damerau-Levenshtein edit distance).

Five fuzzy search queries are available:

| Query | Index | Indexed Fields |
|-------|-------|----------------|
| `fuzzyPerson` | `fuzzyPersonNameIndex` | `given`, `middle`, `surname` |
| `fuzzySchema` | `fuzzySchemaTitleIndex` | `title` |
| `fuzzyReference` | `fuzzyReferenceTitleIndex` | `title` |
| `fuzzyCollection` | `fuzzyCollectionNameIndex` | `name` |
| `fuzzyOTU` | `fuzzyOTUNameIndex` | `name` |

All indexes can be created (or re-created idempotently) via `cypher/setup-fuzzy-indexes.cypher`.

## Architecture: Pattern D (delegation)

Each fuzzy query uses a two-step resolver pattern:

1. **Fulltext lookup** — A custom resolver runs `CALL db.index.fulltext.queryNodes(...)` via `session.run()` to get score-ordered candidate `pbotID`s.
2. **Delegation** — The resolver injects those IDs as `filter: { pbotID_in: [...] }` and calls `neo4jgraphql()`, which generates the standard auto-generated node query. This inherits all standard filters, projection, ordering, pagination, and group scoping (via `cypherParams`).

Results are ordered by fuzzy score by default. Supplying `orderBy` overrides score ordering.

`fuzzyLimit` (default 200) caps the candidate set from step 1. This prevents multi-thousand-element `pbotID_in` arrays from degrading query performance.

### Lucene query construction

The search string must be tokenized to match how Neo4j's standard analyzer indexes text. The `buildLuceneQuery()` helper splits on non-alphanumeric characters and appends `~` to each token:

- `"Manual"` → `"Manual~"`
- `"Ref-ddm-08-25a"` → `"Ref~ ddm~ 08~ 25a~"`
- `"García-López"` → `"Garc~ a~ L~ pez~"`

Without this tokenization, characters like `-` are interpreted as Lucene's NOT operator, causing searches for hyphenated terms to silently return no results.

For `fuzzyPerson`, each name field gets a Lucene field qualifier: `surname:Smith~ given:John~`.

### Key files

| File | Role |
|------|------|
| `schema.graphql` | Query declarations (no `@cypher` — these are resolver-backed) |
| `Resolvers.js` | `buildLuceneQuery()`, `fuzzyDelegate()`, and per-query resolvers |
| `cypher/setup-fuzzy-indexes.cypher` | Idempotent index creation for all five indexes |

## Legacy: `fuzzyPersonSearch`

The original `fuzzyPersonSearch` query in `schema.graphql` uses a `@cypher` directive with hand-rolled WHERE clauses. It is **deprecated** in favor of `fuzzyPerson`, which inherits all standard filters and group scoping automatically. `fuzzyPersonSearch` will be removed after pbot-client migrates to `fuzzyPerson` (tracked separately in that repo).

### Differences from the legacy approach

| | `fuzzyPersonSearch` (legacy) | `fuzzyPerson` (new) |
|---|---|---|
| Implementation | `@cypher` directive | Custom resolver + `neo4jgraphql()` delegation |
| Filters | Hand-rolled WHERE clauses | Inherits full `_PersonFilter` |
| Group scoping | Hand-rolled EXISTS subquery | Automatic via `cypherParams` |
| Ordering | None (index order) | Score order by default, `orderBy` override |
| Pagination | None | `first` / `offset` |
