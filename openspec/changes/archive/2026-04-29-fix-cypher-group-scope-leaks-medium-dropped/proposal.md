## Status

**Dropped — no implementation.** This change was originally proposed as the MEDIUM-severity companion to `fix-cypher-group-scope-leaks-high`, scoped to seven `@cypher` fields and queries that traverse Character/State hierarchies. Subsequent analysis showed there is no leak at this layer and the change was abandoned. This document is preserved in the archive as a breadcrumb so future readers can find the reasoning.

## Original Scope

Seven `@cypher` fields and queries:

- `Character.characterOf` (`schema.graphql:112`)
- `State.stateOf` (`schema.graphql:136`)
- `Character.deepOrder` (`schema.graphql:102`)
- `State.deepOrder` (`schema.graphql:126`)
- `Query.GetAllCharacters(schemaID)` (`schema.graphql:767`)
- `Query.GetAllStates(characterID)` (`schema.graphql:758`)
- `Query.GetLeafStates(characterID)` (`schema.graphql:747`)

The proposal assumed these traversals exposed cross-group hierarchy nodes the way `OTU.mergedDescription` exposed cross-group Descriptions. They don't.

## Why It Was Dropped

### Inheritance closes the four upward-walk paths

`type Character`, `type State`, and `type CharacterInstance` have no `elementOf` GraphQL field. Per `SchemaMaps.js:458-503`, the cypher-builder mutation infrastructure does write `ELEMENT_OF` edges to these nodes during create/update, with the convention that a child's `ELEMENT_OF` set is a subset of the parent's (a Character's groups ⊆ its parent Character/Schema's groups; a State's groups ⊆ its parent State/Character's groups; a CharacterInstance's groups = its Description's groups, set via `schema.graphql:1136-1151`).

Practical consequence: walking UP from a visible child to its parent never reveals a node less visible than the child already was. So:

- `Character.characterOf` and `State.stateOf` — return parent. No leak: parent.groups ⊇ child.groups.
- `Character.deepOrder` and `State.deepOrder` — walk ancestors collecting order strings. No leak by the same inheritance argument.

### The three downward-walk queries are dormant code

`Query.GetAllCharacters`, `Query.GetAllStates`, and `Query.GetLeafStates` do have a different leak class: they take a caller-supplied root node ID, match it via raw `@cypher` (which bypasses the auto-injected `whereClause`), and walk descendants. A caller could in principle supply a private Schema's or Character's `pbotID` and read its descendants — content they couldn't reach via the standard `Schema`/`Character` query path.

However:

1. The leak requires the caller to know (or guess) a UUID for a node they otherwise can't see. UUIDs aren't enumerable through any visible API. The attack surface is effectively limited to UUIDs leaked through other channels.
2. A grep of the active pbot-client code base found no callers of any of these three queries. They appear to be artifacts of a previous iteration.

Given the dormant-code status and the negligible practical attack surface even if revived, the decision is to leave them alone. If a future change resurrects these queries for active use, this document and the archived `fix-cypher-group-scope-leaks-high` together provide the reasoning and the canonical predicate shape needed to add caller-supplied-root validation at that time.

## Capabilities

None added or modified. The `cypher-field-group-scoping` capability (introduced by `fix-cypher-group-scope-leaks-high`) covers the directly-scoped `@cypher` traversals; this change adds nothing.

## Impact

None. Schema, code, and runtime behavior unchanged.
