## Context

Mutations in `Resolvers.js` build relationships from the input payload using a destructive replace pattern (delete all edges of an updatable type, recreate those present in the payload). The only guard against leaving a relationship empty is the `CITED_BY` mapping's `required` flag in `SchemaMaps.js`, which throws synchronously — before any Cypher runs — when a required relationship field is absent or empty. At the GraphQL boundary, `[CitedByInput!]!` rejects omitted/null `references` early, but an empty array `[]` still satisfies that type, so resolver-level `required: true` is what closes the empty-array case.

Today references are under-enforced. Seven node types carry a `CITED_BY` (`graphqlName: "references"`) mapping — Schema, Description, OTU, Synonym, Comment, Specimen, Collection — and all seven are `required: false`. Two input types (`SchemaInput`, `OTUInput`) are already `[CitedByInput!]!`; the rest are `[CitedByInput]`.

Investigation established which types should be hardened by combining client behavior and existing data:

| Type | input | client ReferenceManager | client enforces ≥1 | existing 0-ref nodes |
|------|-------|-------------------------|--------------------|----------------------|
| Schema | `[CitedByInput!]!` | `single` (+ `.min(1)`) | yes | 0 (1/16 in local test DB only) |
| Description | `[CitedByInput]` | default (optional falsy) | yes | 0 / 17 |
| OTU | `[CitedByInput!]!` | `displayPublishedIn` (optional falsy) | yes | 0 / 22 |
| Synonym | `[CitedByInput]` | default (optional falsy) | yes | 0 / 5 |
| Collection | `[CitedByInput]` | default (optional falsy) | yes | 0 / 14 |
| Comment | `[CitedByInput]` | `optional={true}` | no | 4 / 7 |
| Specimen | `[CitedByInput]` | `optional={true}` | no | 10 / 11 |

The client enforces ≥1 reference via `ReferenceManager`, not Yup `.min(1)`: when `optional` is falsy (or `single`), the first reference row has no remove button (`ReferenceManager.js` line 89: `index > 0 || props.optional`), so the list cannot be emptied, and the per-row `pbotID: required('Reference title is required')` shape validation blocks submission with a blank title. The five targeted types pass `optional` falsy; Comment and Specimen pass `optional={true}`.

## Goals / Non-Goals

**Goals:**
- Enforce ≥1 reference at both the GraphQL and resolver layers for Schema, Description, OTU, Synonym, Collection.
- Close the half-hardened gap on Schema and OTU (input already non-null, resolver still accepted empty).
- Keep references optional for Comment and Specimen.

**Non-Goals:**
- Redesigning the destructive update pattern (tracked separately).
- `pbot-client` changes (none needed; the five forms already enforce ≥1 reference inline via `ReferenceManager`).
- Backfilling references onto Comment/Specimen rows.

## Decisions

**Decision 1: Harden exactly five types; exclude Comment and Specimen.**
The five targeted types have ~100% existing reference coverage and a client that produces a reference. Comment and Specimen initialize references to `[]`, have no client minimum, and have majority-zero-reference data; hardening them would reject valid creates and block edits of most existing rows. Alternative considered — harden all seven and backfill — rejected: it imposes a citation on conceptually citation-free nodes (a Specimen catalogued before publication; an annotation Comment) and creates a migration burden for little benefit.

**Decision 2: Enforce at both layers, consistently.**
Set `[CitedByInput!]!` on the three inputs still using `[CitedByInput]` (Description, Synonym, Collection) and set `required: true` on all five `CITED_BY` mappings. The schema type gives an early, clear rejection for omitted/null; the resolver `required` closes the empty-array case and prevents any delete Cypher from running. Schema and OTU only need the resolver-side flag since their inputs are already non-null.

**Decision 3: No client change needed.**
The five targeted forms already enforce ≥1 reference inline via `ReferenceManager` (un-removable first row + blank-title shape message), so a ref-less submit is blocked before it reaches the API. This change makes the API agree with that existing client contract; the API enforcement is a backstop for direct/out-of-band callers, not a fix for a client gap.

## Risks / Trade-offs

- **[Breaking for out-of-band API callers]** → Any direct caller omitting references on the five types now errors. Mitigation: this is the intended tightening; the client already sends references.
- **[Coupling to destructive update]** → `required: true` is safe only because the client re-sends the full references array on update. Mitigation: documented; the non-destructive-update redesign is tracked separately.

## Migration Plan

1. Apply the edits (`schema.graphql` ×3, `SchemaMaps.js` ×5).
2. Restart the server (PM2 watch in production).
3. Verify per spec: omitted/null/empty references rejected on the five types with no links deleted; non-empty accepted; Comment and Specimen still accept zero references.
4. Rollback: revert the commit; no data migration to undo.
