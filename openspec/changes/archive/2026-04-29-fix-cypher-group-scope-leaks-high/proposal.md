## Why

The auto-injected group-scoping `whereClause` in `index.js:172` only fires on the standard `_<Type>Filter` MATCH path used by `neo4jgraphql()`. It does **not** apply inside hand-written `@cypher` directive bodies. Several `@cypher` fields traverse from a scope-checked starting node (`this`) to other independently-group-scoped entities without filtering — exposing content from groups the calling user does not belong to.

The leak surfaced during work on the OTU "Has Descriptions" client column (pbot-client change `otu-specimen-description-indicator`), where an audit of `OTU.mergedDescription` revealed that character-state data from cross-group Descriptions can flow into responses for any OTU the viewer can reach. A subsequent read of every `@cypher` directive in `schema.graphql` confirmed the same blind spot in multiple other places.

This change addresses the **HIGH severity** leaks where the affected node types are themselves directly group-scoped (have `ELEMENT_OF` relationships of their own). The uniform `EXISTS { (n)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }` predicate is the right fix shape for these. MEDIUM severity (hierarchy traversals) is tracked in the companion change `fix-cypher-group-scope-leaks-medium`.

Comment-related concerns originally bundled here have been pulled out into the separate change `audit-comment-group-inheritance`. Comments are not directly group-scoped — `type Comment` has no `elementOf` field, `CommentInput` has no `groups`, and `index.js:174` lists `Comment` in `skipPrefixNodeTypes`. The same one-line predicate shape used here would not work on Comment nodes (it would always return false for Comments, breaking rather than fixing the field). Whether Comments need any fix at all depends on a separate design question — does the inheritance model ("a Comment is visible iff its root Synonym is visible") hold under all reachable query paths? — that deserves its own audit.

## What Changes

Add explicit group-membership filters to the `@cypher` bodies of the two HIGH-severity read paths whose traversed nodes are themselves directly group-scoped. The fix shape is uniform: an `EXISTS { (n)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }` predicate at every traversed node that has its own `ELEMENT_OF` relationships.

In scope (HIGH severity, substantive content exposure):

- **`OTU.mergedDescription`** (`schema.graphql:232`) — filter on the traversed Specimen and Description. Currently exposes character/state content from cross-group Descriptions on type/holotype Specimens reachable from any visible OTU. Both Specimen and Description are directly group-scoped (have their own `ELEMENT_OF`).
- **`Person.entered`** (`schema.graphql:48`) — filter on the entered node `n`. Currently exposes every entity any visible Person has entered, regardless of whether the entity's group is in the viewer's scope. High-fanout: traverses across many entity types (Specimen, Description, Schema, Reference, OTU, Synonym, Character, State, Comment, etc.).

  **Side effect to acknowledge:** the predicate `EXISTS { (n)-[:ELEMENT_OF]->...` evaluates to false for any node type that has no `ELEMENT_OF` edges. Today that means Comments in particular will silently disappear from `entered` results after this fix. This is acceptable — Comments are reachable via their root Synonym anyway, and Person.entered's primary purpose is auditing contributions to scoped entities — but it is a deliberate behavior change worth flagging in the changelog.

A precondition smoke test on `Person.entered` (the simpler of the two remaining sites) is included in tasks before the larger field is patched, to validate end-to-end that `$cypherParams.user.pbotID` is correctly bound inside `apoc.cypher.runFirstColumn` invocations on this fork. (The originally-planned smoke target `Comment.subject` is no longer in scope.)

Out of scope, captured here for traceability:

- MEDIUM and LOW severity leaks → `fix-cypher-group-scope-leaks-medium`.
- Comment-visibility inheritance and the unfiltered top-level `Comment` query → `audit-comment-group-inheritance`.
- `Query.fuzzyPersonSearch` (deprecated, replaced by `fuzzyPerson`) — caller controls the `$groups` argument by design; not a leak so much as an opt-in bypass.
- `Query.GetNodeCount` — global counts by label; intentional aggregate. Re-evaluate in a separate proposal if needed.
- `Mutation.CreateCharacterInstance` and the broader mutation surface → `audit-mutation-group-authorization`.
- `Person.registered`, `Specimen.specimenNumber`, `Collection.lat`, `Collection.lon` — no traversal, no filter needed.

## Capabilities

### New Capabilities

- `cypher-field-group-scoping`: Group-membership filtering applied inside `@cypher` directive bodies that traverse beyond the auto-scoped root, so cross-group entities are not exposed through `@cypher` fields and queries. This change establishes the capability and covers the HIGH severity surface (limited to fields whose traversed nodes have native `ELEMENT_OF` scoping); the MEDIUM companion change extends the same predicate to additional fields.

### Modified Capabilities

None.

## Impact

- `schema.graphql` — `@cypher` statement bodies edited in place for the two listed fields. No type signature changes; clients should observe identical response shapes, just smaller result sets when cross-group data was previously included (and, in `Person.entered`, no Comment rows at all).
- `index.js` — no change required. Verified by spike: `cypherParams` set in `index.js:170` is automatically forwarded to every `@cypher` invocation by `neo4j-graphql-js` (`utils.js:152-158`, `selections.js:516`) as a single bound parameter `$cypherParams`. Inside `@cypher` bodies, the user pbotID is reachable as `$cypherParams.user.pbotID`.
- Public / unauthenticated callers — no special handling needed. Verified by spike: `UserManagement.js:15` falls back to `email = "guest"`, and the existing `cypherMatchPrefix` at `index.js:171` already requires a Person with `email: "guest"` to exist (otherwise unauthenticated requests would throw on `${user.pbotID}`). The new filter inherits that contract: for unauthenticated callers, `$cypherParams.user.pbotID` resolves to the guest Person's pbotID, naturally scoping results to whatever groups the guest belongs to (presumably "public").
- pbot-client `otu-specimen-description-indicator` capability — no contract change, but `mergedDescription` accordion content may differ for users who previously saw cross-group rows. Worth a regression check on a dev OTU known to span groups.
- No database schema or migration impact. No Neo4j index changes.
- Performance: `EXISTS { ... }` short-circuits on first match — per-node cost is O(1)-ish. The most concerning surface is `Person.entered` due to fanout; the filter actually *reduces* the candidate result set so post-filter response work decreases. Worth a sanity check on a realistic dataset but no expected regression.

## Release Notes

Security correction: closed two cross-group exposure paths in hand-written `@cypher` directive bodies that bypassed the auto-injected group-scoping `whereClause`.

- **`OTU.mergedDescription`** now filters traversed Specimen and Description nodes by caller group membership. Callers viewing an OTU that spans groups will see only the merged character/state rows derived from Specimens and Descriptions in groups they belong to.
- **`Person.entered`** now filters returned entries by caller group membership. **Behavior change to note:** entries pointing to nodes that have no `ELEMENT_OF` edges (Comments) are no longer returned by this field. Comment authorship remains discoverable via the natural Synonym → Comment thread path.

No GraphQL contract changes. No database migration. The filter relies on a `Person {email: "guest"}` row already required by the existing `cypherMatchPrefix` mechanism.
