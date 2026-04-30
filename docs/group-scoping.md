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

## Known Mutation-Side Gaps

`permissions.js` enforces only `isAuthenticated && isAdmin` on every mutation. "Admin" is a global role, not per-group, so the shield layer alone does not prevent an authenticated admin from writing into groups they are not a member of. Two write paths in `Resolvers.js` rely on caller-supplied group sets and currently lack a `MEMBER_OF` check:

### Gap 1: Top-level entity creation accepts unverified `groups` input

Affected mutations: `CreateOTU`, `CreateDescription`, `CreateReference`, `CreateSchema`, `CreateCollection`, `CreateSynonym`, `CreateComment`. These flow through `mutateNode` (`Resolvers.js:698`) → `handleCreate` (`Resolvers.js:521`), which writes one `ELEMENT_OF` edge per ID in the caller-supplied `data.groups: [String]`. There is no verification that the caller is `MEMBER_OF` those groups. A caller can place content in a group they do not belong to. The `enteredBy` audit edge correctly records the caller, so the action is traceable, but it is not prevented.

### Gap 2: `groupCascade` updates rewrite `ELEMENT_OF` without membership checks

Affected mutations: update mutations on the same node-type set as Gap 1. `handleUpdate` (`Resolvers.js:241`) checks `data.groupCascade` and, when truthy, short-circuits to a pure `ELEMENT_OF` rewrite from `data.groups`. The parent update path that triggers the cascade (`Resolvers.js:884-907`) takes caller-supplied `data.groups` directly. There is no verification that the caller is a member of either the groups being added or the groups being removed. A caller can move content into groups they don't belong to, or "rescue" content out of groups they don't belong to.

### Node types NOT affected (and why)

| nodeType | Why immune |
|---|---|
| `Person` | `mutateNode` forces `data.groups = [publicGroupID]` on create (`Resolvers.js:768`) and ensures public is included on update (`Resolvers.js:828-834`). |
| `Group` | New group is its own `ELEMENT_OF`; creator becomes `MEMBER_OF` automatically via special cypher (`Resolvers.js:600-606`). The caller cannot join a group they aren't already creating. |
| `Character`, `State`, `CharacterInstance`, `Specimen`, `Image` | `mutateNode` calls `getGroups(tx, data)` to fetch the parent's group set and overwrites `data.groups` server-side on both create (`Resolvers.js:800-806`) and update (`Resolvers.js:865-874`). The `getGroups` helper resolves the parent via `data.schemaID || data.descriptionID || data.collection || data.imageOf`. |

`CreateCharacterInstance` is explicitly NOT a gap: CharacterInstances are inseparable components of a Description, so inheriting the Description's full group set is correct — members of every group the Description belongs to are entitled to see all its components, and edit access to the Description implies edit access to its components.

### Tracking

See `openspec/changes/audit-mutation-group-authorization/` for the proposal, design, capability spec, and task list scoping the fix.

### Implemented mitigations

`mutateNode` (`Resolvers.js`) now applies caller-membership checks against the same write transaction as the mutation itself, via the `CALLER_CONTROLLED_GROUP_TYPES` set and the `assertCallerCanWriteGroups` / `fetchCurrentGroupIDs` helpers. Coverage:

- **Create**: for `OTU`, `Description`, `Reference`, `Schema`, `Collection`, `Synonym`, `Comment`, the caller must be `MEMBER_OF` every group in `data.groups`. Otherwise the mutation fails with a `ValidationError` listing the unauthorized group IDs and no node is written.
- **Update**: for the same node-type set, the caller must be `MEMBER_OF` every group in the symmetric difference between the entity's current `ELEMENT_OF` set and the requested `data.groups`. This closes both addition (writing into a group the caller doesn't belong to) and removal (rescuing content out of a group the caller doesn't belong to).
- The check is skipped when `data.groupCascade === true`. That flag is set only by `mutateNode`'s internal recursive cascade loop (it is not part of any mutation input in `schema.graphql`); the parent's caller-supplied groups have already been validated one frame up, and re-checking each cascaded child would force every cascade write to re-fetch the same caller membership and could spuriously fail when a child currently lives in groups wider than the caller's `MEMBER_OF` set.

The privatization guard (`Resolvers.js`, blocking removal of `publicGroupID` from a node currently in the public Group) is independent of these checks and remains in force.

## When Adding a New `@cypher` Field

Before writing `@cypher` that traverses beyond its anchor:

1. Identify every traversed node type. For each, determine whether it is directly group-scoped (has `ELEMENT_OF`).
2. For every directly-scoped traversed node, apply the canonical predicate above as a `WHERE` clause.
3. For non-scoped traversed types (currently Person and Comment), the predicate would always return false. Decide deliberately whether (a) those types should be excluded from your field's result, (b) you can rely on an upstream scope check, or (c) you need a different fix shape. Document the decision in the change's design.md.
4. Add a smoke test if `$cypherParams` usage is new in the area you're touching.
