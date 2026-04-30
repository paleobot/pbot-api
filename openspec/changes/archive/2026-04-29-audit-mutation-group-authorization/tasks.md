# Tasks

**Status: OPEN — design complete, not scheduled.** Phase 1 (documentation) can ship independently of Phase 2 (fix). Phase 2 should not ship without Phase 1.

## Phase 1 — Document

- [x] In `docs/group-scoping.md`, replace or extend the "Open Questions" section with a "Known mutation-side gaps" section that names both gaps explicitly:
  - Gap 1: caller-supplied `groups` on `CreateOTU`, `CreateDescription`, `CreateReference`, `CreateSchema`, `CreateCollection`, `CreateSynonym`, `CreateComment` is written to `ELEMENT_OF` without verifying caller membership.
  - Gap 2: `groupCascade` updates rewrite an entity's `ELEMENT_OF` set from caller-supplied input without verifying caller membership of either added or removed groups.
- [x] Note that `CreateCharacterInstance` is NOT a gap (CIs inherit their Description's group set by design) and that `Character`, `State`, `Specimen`, `Image` create/update inherit from their parent server-side.
- [x] Note that `Person` and `Group` mutations are immune (server-controlled groups; creator auto-becomes member).
- [x] Cross-link the doc section to this OpenSpec change.

## Phase 2 — Fix

### Verification before coding

- [x] Confirm `groupCascade` is not exposed as an input field on any mutation in `schema.graphql` — it must remain an internal flag set only by `mutateNode`'s recursive cascade loop. If it is exposed, file a follow-up to remove it before implementing this fix. **Verified: `grep -n "groupCascade" schema.graphql` returns no matches; flag is purely internal to `mutateNode`.**
- [x] Confirm `Image` create/update inherits groups from parent in all paths (Resolvers.js:800-806, 865-874). If any caller-controllable code path remains, add `Image` to `CALLER_CONTROLLED_GROUP_TYPES`. **Verified: both paths route through `getGroups(tx, data)` which resolves `data.imageOf` to the parent's group set; no caller-controllable code path remains. `Image` stays out of `CALLER_CONTROLLED_GROUP_TYPES`.**

### Implementation

- [x] Add `assertCallerCanWriteGroups(tx, callerPbotID, requestedGroupIDs)` helper in `Resolvers.js` (or a new `auth.js`). Throws `ValidationError` listing unauthorized group IDs when the caller is not a member of every supplied group.
- [x] Add `fetchCurrentGroupIDs(tx, pbotID)` helper that returns the entity's current `ELEMENT_OF` group ID list (reuses or parallels the cypher in `isPublic` / existing group lookups).
- [x] Define `CALLER_CONTROLLED_GROUP_TYPES = {OTU, Description, Reference, Schema, Collection, Synonym, Comment}` near the top of `Resolvers.js`.
- [x] In `mutateNode`, inside `session.writeTransaction`, before `handleCreate`:
  - skip if `data.groupCascade` is truthy
  - if `type === "create"` and `nodeType` is in `CALLER_CONTROLLED_GROUP_TYPES`, call `assertCallerCanWriteGroups(tx, context.user.pbotID, data.groups || [])`.
- [x] In `mutateNode`, inside `session.writeTransaction`, before `handleUpdate`:
  - skip if `data.groupCascade` is truthy
  - if `type === "update"` and `nodeType` is in `CALLER_CONTROLLED_GROUP_TYPES`, fetch current group IDs, compute symmetric difference with `data.groups`, call `assertCallerCanWriteGroups` on the diff.

### Testing (manual — repo has no automated suite)

- [x] Set up two test users: `alice` member of group `A` only, `bob` member of group `B` only. Both have `admin` role.
- [x] As `alice`, attempt `CreateOTU` with `groups: [<id of B>]`. Expect `ValidationError`, no node created.
- [x] As `alice`, attempt `CreateOTU` with `groups: [<id of A>, <id of B>]`. Expect `ValidationError`, no node created (no partial writes).
- [x] As `alice`, `CreateOTU` with `groups: [<id of A>]`. Expect success.
- [x] As `alice`, `UpdateOTU` on the OTU just created, setting `groups: [<id of A>, <id of B>]`. Expect `ValidationError` (adding B; alice not a member).
- [x] As `alice`, take an OTU currently in groups `[A, B]` (created via direct DB insert or `bob`'s session). Attempt `UpdateOTU` with `groups: [<id of A>]`. Expect `ValidationError` (removing B; alice not a member of B).
- [x] As `alice`, on an OTU in `[A, B]` where alice happens to be a member of both: `UpdateOTU` with `groups: [<id of A>]`. Expect success and `groupCascade` propagates to children.
- [x] Verify no regressions on `Character`, `State`, `Specimen`, `Image`, `CharacterInstance` create/update (these inherit groups; new check is a no-op for them).
- [x] Verify `Person` registration and self-edit unaffected.
- [x] Verify `CreateGroup` still works (creator auto-joins; not in caller-controlled set).

### Documentation

- [x] Update `docs/group-scoping.md` "Known mutation-side gaps" section with a closing note pointing to the implemented check and listing the node types now covered.
- [x] Add a one-line comment near `CALLER_CONTROLLED_GROUP_TYPES` in `Resolvers.js` explaining why each excluded type is excluded (server-controlled or inherited).

### Coupling check

- [x] Before merging, re-read the in-progress `fix-relation-payload-nested-where-clause` proposal to confirm no overlap on the touched code paths in `Resolvers.js` / `index.js`. **Confirmed: that change only touches `index.js:173` `skipPrefixNodeTypes` and the upstream fork; no overlap with `Resolvers.js` `mutateNode`.**
