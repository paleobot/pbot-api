## Why

`neo4j-graphql-js` (our fork at `paleobotany/neo4j-graphql-js`) generates an incorrect WHERE predicate when a relation-payload field (e.g. `Comment.references: [CommentCitedBy]`) is queried as a nested selection under a parent whose top-level type is NOT in `cypherParams.skipPrefixNodeTypes`.

Concretely, this query returns an empty `references` array:

```graphql
query {
  Synonym(filter: { pbotID: "..." }) {
    comments {
      references { Reference { pbotID title } order }
    }
  }
}
```

while the equivalent top-level `Comment(filter: {...}) { references { ... } }` works fine.

The generated Cypher contains:

```cypher
references: [(`synonym_comments`)<-[rel:CITED_BY]-(:`Reference`)
    WHERE exists((`synonym_comments`)-[:ELEMENT_OF|:MEMBER_OF]->(:Group)<-[:MEMBER_OF]-(p))
  | rel { ... }]
```

That `exists(...)` predicate tests the parent `Comment` for a `[:ELEMENT_OF]` edge to a `Group`. Comments have no such edge by design (they inherit group scope from their subject). Every candidate row is rejected, so the list comprehension is always empty.

The same bug will silently drop data for any future relation-payload field on a parent that lacks `[:ELEMENT_OF]` (currently: `Comment`, and any new node type we add without a direct group edge).

## What Changes

- Patch `relationTypeFieldOnNodeType` in the fork (`src/translate/translate.js`) so the group-scoping WHERE it injects:
  - Targets the **endpoint** node (the other end of the relation, e.g. the `Reference`), not the parent node.
  - Passes the endpoint's **node** type name (e.g. `Reference`) to the skip check, not the synthesized relation-payload type name (e.g. `_CommentReferences`) which users cannot reasonably predict.
- Bind an explicit variable for the endpoint in the list-comprehension pattern so the WHERE can reference it.
- Add a fork-level test covering the nested-under-non-group-parent case.
- Rebuild the fork, publish to the `ddm-dev` branch, bump `pbot-api` to consume the new revision.
- Back out the `_CommentReferences` skip-list entry in `pbot-api/index.js` once the fork fix is in place.

**Band-aid already in place:** `pbot-api/index.js` `cypherParams.skipPrefixNodeTypes` has been extended with `"_CommentReferences"` (and can be extended further as similar issues surface). This proposal does not regress that; it replaces it with a correct fix when applied.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities

- `graphql-group-scoping` (implicit, no existing OpenSpec spec): The behavior of `cypherParams.whereClause` on relation-payload fields changes from "filter the parent node" to "filter the endpoint node". For fields whose parent IS group-scoped (the common case — `Schema`, `Description`, `Specimen`, `Collection`, `OTU`, `Synonym`), behavior is unchanged: the parent was already filtered one level up, and the endpoint filter is what's semantically intended anyway. For fields whose parent is NOT group-scoped (currently `Comment`), previously-empty nested selections will now return correctly filtered data.

## Impact

- **Fork (`neo4j-graphql-js`)**: A ~20-line edit in `src/translate/translate.js`, a new test case, a rebuild, and a tarball/branch publish. Touching the fork is explicitly something we try to avoid (see `NEO4J-GRAPHQL-JS.md`), so this proposal is **left open intentionally** to be picked up when we have appetite for fork work.
- **`pbot-api`**: Bump `neo4j-graphql-js` dependency to new revision; remove `"_CommentReferences"` (and any sibling band-aid entries) from `cypherParams.skipPrefixNodeTypes`.
- **Clients (`pbot-client`, etc.)**: No GraphQL API changes. Previously-empty fields start returning data — clients must tolerate that (they already render data for the top-level Comment case, so no known breakage expected).
- **Data model**: No migrations. No Neo4j changes.
- **Band-aid workaround (already shipped):** `pbot-api/index.js` includes `"_CommentReferences"` in `skipPrefixNodeTypes` to unblock the `Synonym → comments → references` query today. This is a list to be maintained per-field until the fork fix lands — any new `*.references` (or similar relation-payload field) on a non-group-scoped parent will need its synthesized type name (`_<Parent><FieldName>`, capitalized) appended.
- **Why leave the proposal open:** The band-aid is sustainable as long as `Comment` remains the only non-group-scoped parent. If we add more such parents, or if the list of synthesized skip entries grows past a handful, revisit and apply this change.

## Why we're sticking with the band-aid (decision rationale, 2026-04-23)

The "proper fix" has more ripple than this document's design.md initially implied. Changing which node `cypherParams.whereClause` filters affects **every** relation-payload field in every query, not just the broken `Comment.references` case. For parents that ARE group-scoped (Schema, OTU, Synonym, etc.), the change is a no-op **only when the user also selects the endpoint node inside the payload** — because then the inner `nodeTypeFieldOnRelationType` clause is already filtering the endpoint correctly.

Consider a query that projects only payload scalars:

```graphql
Schema(filter: {...}) {
  references { order }   # no inner Reference { ... } selection
}
```

- **Today:** outer WHERE tests the parent Schema (passes), inner clause never fires (no endpoint selected), edge is returned.
- **After fix:** outer WHERE tests the Reference endpoint. If the Reference is in a group the user can't see, the edge disappears.

Arguably more correct, but a behavior change for every group-scoped parent's relation-payload field, surfaced only at runtime by clients that happen to project payload scalars without the endpoint. There's no audit of which `pbot-client` queries look like that, and there are no tests in `pbot-api` or the fork covering group-scoping behavior.

### What the band-aid actually costs

- **Per incident:** one string appended to an array, discoverable via `DEBUG=neo4j-graphql-js` in about 30 seconds. Documented in this proposal.
- **Conceptual debt:** a developer unfamiliar with this will be confused by the list. A short comment near `skipPrefixNodeTypes` in `index.js` mitigates.
- **Breadth:** bounded by the number of non-group-scoped parent types with relation-payload fields. Today that's just `Comment`. Adding a new such node type is rare and intentional.

### What the proper fix costs

- Edits to fork code neither maintainer nor anyone else fully understands.
- No test harness to catch regressions; the fork's test suite does not cover our group-scoping add-on at all.
- A behavior change affecting every relation-payload field in every query path, surfaced only at runtime.
- Fork maintenance: every future upstream rebase now carries another local patch to reconcile.

### Decision rule — when to revisit

Stay on the band-aid. Apply this change only if **any** of these trigger:

1. The skip list grows past ~4 synthesized `_<Parent><Field>` entries (real maintenance burden).
2. We add a second non-group-scoped parent node type (Comment-like) — at that point the pattern is clearly generalizable and the fork fix pays for itself.
3. We're already touching the fork for another reason (rebase, upstream merge, another bug), so the marginal cost of this fix is lower.
4. A customer-visible bug traces to this class of issue in a way the band-aid can't cover.

Until then: the proposal is doing its job by preserving the analysis so that, when one of those triggers fires, we don't re-derive any of this from scratch.
