## Root Cause

In `src/translate/translate.js`, `relationTypeFieldOnNodeType` handles GraphQL fields whose type is a `@relation`-directive payload (e.g. `Comment.references: [CommentCitedBy]`). When building the list comprehension that realizes this field in Cypher, it calls `additionalWhereClause` to optionally inject the `cypherParams.whereClause` group-scoping predicate:

```js
const extraWereClause = additionalWhereClause(
  cypherParams,
  safeLabel([innerSchemaType.name, ...getAdditionalLabels(...)]),  // (A)
  safeVar(variableName)                                             // (B)
);
```

Two things are wrong with this call:

**(A) Wrong `typeName` for the skip check.** `innerSchemaType.name` is the augmentation-synthesized relation-payload type — e.g. `_CommentReferences` for `Comment.references` — NOT the user-authored type name (`CommentCitedBy`) and NOT the endpoint node type (`Reference`). Users configure `skipPrefixNodeTypes` with node type names they understand. The generated name is undocumented and per-field, making the skip check effectively unreachable without spelunking debug logs.

**(B) Wrong variable for `$<>` substitution.** `variableName` is the **parent** node (the `Comment`). The emitted predicate is therefore `exists((comment_var)-[:ELEMENT_OF...]->(:Group)<-[...]-(p))`. This is the wrong question — the parent was already group-filtered one level up, and the filter we *want* here is on the other endpoint of the relation (the `Reference`). For parents that lack `[:ELEMENT_OF]` (e.g. `Comment`), the predicate always fails and the list comprehension is always empty.

Note: The sibling function `relationFieldOnNodeType` (handling regular `@relation` fields like `Synonym.comments`) already does the right thing — it passes the endpoint's node type name and the endpoint variable. That's why `Synonym.comments` works. The bug is specific to relation-payload-typed fields.

Note also: `nodeTypeFieldOnRelationType`, which handles the inner `Reference { ... }` selection inside the payload, *also* emits a correct WHERE on the endpoint. That inner clause is fine. It's the outer clause from `relationTypeFieldOnNodeType` that kills the comprehension.

## Fix

Introduce an endpoint variable in the list-comprehension pattern, then feed it (and the endpoint node type) to `additionalWhereClause`.

```js
const endpointTypeName = (selectsOutgoingField || isFromField)
  ? toTypeName
  : fromTypeName;
const endpointVar = `${nestedVariable}_endpoint`;

const extraWereClause = additionalWhereClause(
  cypherParams,
  safeLabel([endpointTypeName, ...getAdditionalLabels(
    resolveInfo.schema.getType(endpointTypeName), cypherParams
  )]),
  safeVar(endpointVar)
);
```

Then change the emitted pattern from

```
...]-${selectsOutgoingField || isFromField ? '>' : ''}(:${safeLabel(nestedTypeLabels)})
```

to

```
...]-${selectsOutgoingField || isFromField ? '>' : ''}(${safeVar(endpointVar)}:${safeLabel(nestedTypeLabels)})
```

Result for `Synonym → comments → references`:

```cypher
references: [(`synonym_comments`)<-[rel:`CITED_BY`]-(`synonym_comments_references_endpoint`:`Reference`)
    WHERE exists((`synonym_comments_references_endpoint`)-[:ELEMENT_OF|:MEMBER_OF]->(:Group)<-[:MEMBER_OF]-(p))
  | rel { ... }]
```

— which is semantically what we want and aligns with what `relationFieldOnNodeType` already emits for regular `@relation` fields.

## Risks & Edge Cases

- **Reflexive relations.** The `innerSchemaTypeRelation.from === innerSchemaTypeRelation.to` branch (early in `relationTypeFieldOnNodeType`) returns without building a list comprehension at all. The fix doesn't apply there; verify with `Comment.comments` (self-recursive `REFERS_TO`).
- **Variable-name collision.** `${nestedVariable}_endpoint` extends an already-path-uniquified name, so collision in the same comprehension is not expected. Double-check under deeply nested selections in a test.
- **Redundant inner WHERE.** The inner `nodeTypeFieldOnRelationType` clause that filters the same endpoint becomes redundant but harmless (two predicates, both true). Cleaning that up is a follow-up, not part of this change.
- **Parents that ARE group-scoped.** For `Schema`, `OTU`, etc. (fields with `elementOf`), the pre-fix broken-but-tolerated behavior was "filter the parent, which already passes" — effectively a no-op. After the fix, the clause filters the endpoint instead, also a no-op in practice (both endpoint types are group-scoped). Net: no behavioral change for the common case.
- **Fork staleness.** We haven't rebased on upstream `neo4j-graphql-js` in a while (see `NEO4J-GRAPHQL-JS.md`). The line numbers cited here are for the fork's current `ddm-dev` tip. A future rebase may shift them but is unlikely to change the shape of the fix.
- **Publishing the fork.** We consume the fork via `git+https://github.com/paleobot/neo4j-graphql-js.git#ddm-dev`. After the fix, bump via commit SHA (not branch pin) to ensure deterministic `npm install` behavior.

## Alternatives Considered

1. **Band-aid via `skipPrefixNodeTypes`.** Already in use. Requires appending `_<Parent><FieldName>` for every non-group-scoped parent's relation-payload field. Brittle, invisible to developers who don't know the synthesized name. Acceptable short-term; this proposal replaces it.

2. **Inject the filter via a Neo4j label or a second audit edge on `Comment`.** Would change the data model and affect other code paths (soft-delete, authorship). Overkill for a code-gen bug in one function.

3. **Disable `cypherParams` group-scoping for relation-payload fields entirely.** Strictly more permissive than today. Relies on the inner `nodeTypeFieldOnRelationType` clause for correctness. Simpler patch but loses the belt-and-braces structure the codebase is built around.

Option 1 is our current posture (band-aid shipped). Option 2 is rejected. Option 3 is a viable simpler fork patch if the bound-endpoint approach turns out to be messier than expected in practice.
