## Why

This is a stub / placeholder change to track two confirmed write-side authorization gaps. It is intentionally proposal-only at this point — design, specs, and tasks are deferred until someone is ready to address the gaps.

The gaps were originally surfaced as part of the broader read-side group-scoping audit (see archived changes `fix-cypher-group-scope-leaks-high` and `fix-cypher-group-scope-leaks-medium-dropped`). The earlier framing of this proposal centered on `Mutation.CreateCharacterInstance` inheriting all of its parent Description's groups without checking caller membership; that concern has been resolved without code change because CharacterInstances exist solely as components of a Description, so inheriting the Description's full group set is the correct behavior — members of every group the Description belongs to are entitled to see all its components, and authorization to edit the Description implies authorization to add or remove components on it.

What remains, and what this stub now scopes, are two distinct gaps that `permissions.js` does **not** cover:

### Gap 1: Top-level entity creation accepts unverified `groups` input

Mutations that create new top-level entities (`CreateOTU`, `CreateSpecimen`, `CreateDescription`, `CreateReference`, `CreateSchema`, `CreateGroup`, `CreateCharacter`, `CreateState`, `CreateSynonym`, `CreateImage`, `CreateCollection`, etc.) live in `Resolvers.js` under the generic `mutateNode` cypher-builder. They take a caller-supplied `groups: [String]` input and write `ELEMENT_OF` edges to those groups. There is no check that the calling user is `MEMBER_OF` the supplied groups.

Practical consequence: a malicious or careless caller can create entities directly into private groups they are not a member of — placing content in another group's space. The created entity's `enteredBy` correctly records the caller's `pbotID`, so the action is traceable, but it is not prevented.

### Gap 2: `groupCascade` updates rewrite `ELEMENT_OF` without authz checks

`handleUpdate` in `Resolvers.js` (around line 249) accepts a `groupCascade: true` flag that turns the mutation into a pure `ELEMENT_OF` rewrite for an existing entity. There is no check that the caller is a member of either the source groups (those being removed) or the target groups (those being added).

Practical consequence: a caller with the ability to invoke an update on an entity could move private content out of its current groups and into others — including out of groups they belong to and into groups they don't. Same traceability vs. prevention story as Gap 1.

## What Changes

This change has two phases.

**Phase 1 — Document.** Add a section to `docs/group-scoping.md` that explicitly describes both gaps. This makes the gaps discoverable for anyone reading the document; the OpenSpec stub alone is harder to find. The document already has an "Open Questions" section that mentions mutation authz at a high level — replace or extend that with the concrete details from this proposal.

**Phase 2 — Fix.** Address both gaps. Likely fix shape:

- For Gap 1: in `mutateNode` (`Resolvers.js`), when writing `ELEMENT_OF` edges from caller-supplied `groups: [String]`, intersect the supplied list with the caller's `MEMBER_OF` groups before writing — or reject the request with an error if any supplied group is not in the caller's set. Decision between "silently filter" vs. "fail loudly" is a design call.
- For Gap 2: in the `groupCascade` branch of `handleUpdate`, apply the same caller-membership check to both the new and existing group sets — caller must be a member of every group being added, and arguably every group being removed (otherwise a non-member could partially "rescue" content out of a group they have no relationship to).

The Phase 1 documentation can ship without Phase 2; Phase 2 should not ship without first re-reading Phase 1's documentation to ensure the fix matches the documented contract.

## Capabilities

### New Capabilities

- `mutation-group-authorization`: Caller-side group-membership verification on the two confirmed write paths above (top-level entity creation with caller-supplied groups, and `groupCascade` updates), so a user cannot cause writes to land in or move content into groups they are not a member of.

### Modified Capabilities

None known. `permissions.js` does not currently cover either gap, so this is net-new authorization rather than a tightening of existing rules.

## Impact

- **Phase 1 (document):** edit `docs/group-scoping.md` only. No code change.
- **Phase 2 (fix):** primarily `Resolvers.js` — `mutateNode` and `handleUpdate`. May also touch `permissions.js` if the chosen fix shape is to add resolver-boundary rules rather than cypher-builder edits.
- **Coupling to `fix-relation-payload-nested-where-clause`:** That existing in-progress change is also write-path-adjacent; check during Phase 2 whether its scope already addresses anything covered here, so we don't duplicate work.
- **Behavior change:** any caller currently relying on the gaps (e.g., a tool that creates entities in private groups it isn't a member of) will start failing. This is a correction, not a regression, but worth surfacing in changelog when Phase 2 ships.

## Status

**Proposal stub only.** The CharacterInstance trigger that originally motivated this change has been resolved by reasoning, not implementation. The two remaining gaps are confirmed but parked. Advance to design / specs / tasks when ready to address them.
