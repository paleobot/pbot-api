# Group Scoping

This document captures the visibility model pbot-api enforces on group-scoped content and the preconditions a deployment must satisfy for it to work correctly.

## The Model

Most content types in pbot-api are *directly group-scoped*: they have an `ELEMENT_OF` edge to one or more `Group` nodes. A user is `MEMBER_OF` zero or more `Group`s. The visibility rule is:

> A node `n` is visible to user `u` iff there exists a `Group g` such that `(n)-[:ELEMENT_OF]->(g)` AND `(u)-[:MEMBER_OF]->(g)`.

For unauthenticated requests, `u` resolves to the guest Person (see "Preconditions" below), which is typically a member of the `public` Group only.

Directly-scoped types (each has its own `elementOf` field): `OTU`, `Specimen`, `Description`, `Schema`, `Reference`, `Synonym`, `Group`, `Image`, `Character`, `State`, `CharacterInstance`, `Collection`.

Not directly scoped: `Person` (it represents the user, not content), and `Comment` (its visibility is intended to inherit from the root entity of its REFERS_TO chain — see open question below).

## Enforcement Mechanisms

Two complementary mechanisms enforce the rule:

### 1. Auto-injected `whereClause` (covers standard queries)

`index.js:172` configures `cypherParams.whereClause`:

```js
whereClause: ` exists(($<>)-[:ELEMENT_OF|:MEMBER_OF]->(:Group)<-[:MEMBER_OF]-(p))`
```

The neo4j-graphql-js fork weaves this predicate into every `_<Type>Filter` MATCH it generates from the GraphQL schema. The `$<>` placeholder is rewritten to the matched node's variable. The `(p)` reference is bound by the `cypherMatchPrefix` at `index.js:171`:

```js
cypherMatchPrefix: `(p:Person {pbotID:"${user.pbotID}"})-[:MEMBER_OF]->(g:Group)<-[:ELEMENT_OF|:MEMBER_OF]-`
```

This covers the common case: every standard generated query, every nested rich-relationship lookup, every filter — they all run through this injection.

`index.js:174` lists `skipPrefixNodeTypes` for which the auto-injection is skipped. As of this writing: `Person`, `_SchemaAuthoredBy`, `_ReferenceAuthoredBy`, `Comment`, `_CommentEnteredBy`, `_CommentReferences`. Persons and Comments are skipped because they are not directly group-scoped; the others are workarounds for a fork bug in `relationTypeFieldOnNodeType` (tracked separately).

### 2. Inline predicates inside `@cypher` directive bodies

The auto-injection does **not** penetrate hand-written `@cypher` directives — they are wrapped by neo4j-graphql-js in `apoc.cypher.runFirstColumn(...)` and the body's MATCH/EXISTS clauses run as written. Any `@cypher` body that traverses from its anchor node to other group-scoped entities must apply the predicate explicitly.

Canonical predicate shape:

```cypher
EXISTS { (n)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }
```

Inside `@cypher` bodies, the parameter `$cypherParams` is the entire `cypherParams` object (set in `index.js:170`) bound as a single subquery parameter; `$cypherParams.user.pbotID` retrieves the calling user's pbotID.

Fields known to apply this pattern (kept up to date as audits land):

- `OTU.mergedDescription` — filters traversed Specimen and Description.
- `Person.entered` — filters the entered node `n`. Side effect: entries pointing to non-scoped types (notably Comments) are excluded; Comment authorship remains discoverable via Synonym → Comment threads.

Audits in progress that may add to this list: `fix-cypher-group-scope-leaks-medium`, `audit-comment-group-inheritance`, `audit-mutation-group-authorization`.

## Preconditions a Deployment Must Satisfy

Both enforcement mechanisms assume a `Person {email: "guest"}` row exists in the database and is `MEMBER_OF` the appropriate public-access Group(s). Without it:

- `UserManagement.js:15` falls back to `email = "guest"` for unauthenticated requests.
- `index.js:171` builds `cypherMatchPrefix` using `user.pbotID`. If `getUser` returns undefined because no guest Person exists, this throws.
- `@cypher` bodies that reference `$cypherParams.user.pbotID` would resolve to `null` and the predicate would return false — locking unauthenticated callers out of all `@cypher`-scoped content.

When standing up a new pbot-api instance, ensure:

1. A `Group {name: "public"}` exists.
2. A `Person {email: "guest", pbotID: <uuid>}` exists.
3. A `(:Person {email:"guest"})-[:MEMBER_OF]->(:Group {name:"public"})` edge exists.
4. Any content intended to be visible to anonymous users has `ELEMENT_OF` the public Group.

## Open Questions

- **Comment visibility model.** Comments are not directly group-scoped and are excluded from the auto-injection (`skipPrefixNodeTypes`). They presumably inherit visibility from the root entity of their REFERS_TO chain, but this is not yet verified end-to-end (especially against the auto-generated top-level `Comment(filter: …)` query). See `audit-comment-group-inheritance`.
- **Mutation authorization — two confirmed gaps.** `permissions.js` does not enforce caller-vs-supplied group membership in two places:
  - **Top-level entity creation** (`Resolvers.js` → `mutateNode`): mutations like `CreateOTU`, `CreateSpecimen`, `CreateDescription`, etc. accept a caller-supplied `groups: [String]` input and write `ELEMENT_OF` edges to those groups without checking that the caller is `MEMBER_OF` them. A caller can create content in a group they don't belong to.
  - **`groupCascade` updates** (`Resolvers.js` → `handleUpdate`, around line 249): with `groupCascade: true`, the mutation rewrites an existing entity's `ELEMENT_OF` set without checking that the caller is a member of either the source or target groups. A caller can move content between groups they don't belong to.
  - The `CharacterInstance` write path (`schema.graphql:1131` `CreateCharacterInstance`) inherits its parent Description's full group set without a caller-membership check, but this is intentional and correct: CharacterInstances are inseparable components of a Description, so members of every group the Description is in are entitled to see all its components, and edit access to the Description implies edit access to its components.
  - See `audit-mutation-group-authorization` for the proposal scoping a fix.

## When Adding a New `@cypher` Field

Before writing `@cypher` that traverses beyond its anchor:

1. Identify every traversed node type. For each, determine whether it is directly group-scoped (has `ELEMENT_OF`).
2. For every directly-scoped traversed node, apply the canonical predicate above as a `WHERE` clause.
3. For non-scoped traversed types (currently Person and Comment), the predicate would always return false. Decide deliberately whether (a) those types should be excluded from your field's result, (b) you can rely on an upstream scope check, or (c) you need a different fix shape. Document the decision in the change's design.md.
4. Add a smoke test if `$cypherParams` usage is new in the area you're touching.
