# mutation-group-authorization

Caller-side group-membership verification on write paths whose `groups` input is caller-controlled, so a user cannot cause writes to land in or move content into groups they are not a member of, and on deletes, so a user cannot delete content from groups they share none of.

## Purpose

`permissions.js` enforces only `isAuthenticated && isAdmin` on every mutation. "Admin" is a global role, not per-group. Without an additional in-resolver check, an authenticated admin could create or move content into groups they don't belong to, or delete content from any group. This capability captures the requirement that `mutateNode` (`Resolvers.js`) verify caller `MEMBER_OF` membership, in the same Neo4j write transaction as the mutation itself:

- on the two write paths where `data.groups` is caller-controlled (top-level entity creation and `groupCascade` updates), against the requested group set;
- on deletes, against the target's current `ELEMENT_OF` groups read from the database (for a Comment, those of the root of its `REFERS_TO` chain). The caller must share at least one; records with no group fail closed. Added by `authorize-delete-by-group` (2026-11-16).
## Requirements
### Requirement: Caller MUST be a member of every group named in caller-supplied `groups` on top-level entity creation

For mutations that create new top-level entities of a node type whose `groups` input is caller-controlled — namely `OTU`, `Description`, `Reference`, `Schema`, `Collection`, `Synonym`, `Comment` — the system SHALL verify that the calling user has a `MEMBER_OF` edge to every `Group` named in the caller-supplied `groups: [String]` argument before any `ELEMENT_OF` edge is written.

If any supplied group is not in the caller's `MEMBER_OF` set, the mutation SHALL fail with a `ValidationError` whose message names the unauthorized group ID(s), and no node, relationship, or `ENTERED_BY` edge SHALL be created.

The check SHALL run inside the same Neo4j write transaction as the create itself, so membership read and `ELEMENT_OF` write are atomic.

This requirement does NOT apply to node types whose `groups` are server-controlled or inherited:

- `Person` create: server forces `[publicGroupID]`.
- `Group` create: the new group is its own `ELEMENT_OF`; the creator becomes `MEMBER_OF` automatically.
- `Character`, `State`, `CharacterInstance`, `Specimen`, `Image` create: groups are fetched from the parent (`Schema`, `Description`, etc.) server-side; caller-supplied `groups` is ignored.

#### Scenario: Caller not a member of supplied group — create rejected

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and a separate group `B`
- **WHEN** `U` invokes `CreateOTU` with `groups: [B.pbotID]`
- **THEN** the mutation MUST fail with a `ValidationError` naming `B.pbotID`
- **AND** no `OTU` node, no `ELEMENT_OF` edge, and no `ENTERED_BY` edge MUST be created

#### Scenario: Caller member of some but not all supplied groups — create rejected, no partial write

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only
- **WHEN** `U` invokes `CreateDescription` with `groups: [A.pbotID, B.pbotID]`
- **THEN** the mutation MUST fail with a `ValidationError` naming `B.pbotID`
- **AND** the new entity MUST NOT exist with `ELEMENT_OF` to `A` alone (no partial success)

#### Scenario: Caller member of all supplied groups — create succeeds

- **GIVEN** a calling user `U` who is `MEMBER_OF` groups `A` and `B`
- **WHEN** `U` invokes `CreateOTU` with `groups: [A.pbotID, B.pbotID]`
- **THEN** the mutation MUST succeed
- **AND** the new `OTU` MUST have `ELEMENT_OF` edges to both `A` and `B`

#### Scenario: Server-controlled-group mutation unaffected

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and a `Schema` `S` that is `ELEMENT_OF` groups `A` and `B`
- **WHEN** `U` invokes `CreateCharacter` with `parentID: S.pbotID`
- **THEN** the mutation MUST succeed and the new `Character` MUST be `ELEMENT_OF` both `A` and `B`, inherited from `S` — no membership check is applied because `groups` is not caller-controlled for this node type

### Requirement: Caller MUST be a member of every group in the symmetric difference between current and requested `groups` on update

For update mutations on entities of a node type whose `groups` input is caller-controlled (same set as the create requirement: `OTU`, `Description`, `Reference`, `Schema`, `Collection`, `Synonym`, `Comment`), the system SHALL compute the symmetric difference between the entity's current `ELEMENT_OF` group ID set and the caller's requested `data.groups`, and SHALL verify that the calling user is `MEMBER_OF` every group in that difference before any `ELEMENT_OF` edge is added or removed.

If any group in the symmetric difference is outside the caller's `MEMBER_OF` set, the mutation SHALL fail with a `ValidationError` naming the unauthorized group ID(s), and no `ELEMENT_OF`, `ENTERED_BY`, or property change SHALL be persisted.

The check applies symmetrically to additions and removals: a caller cannot add the entity to a group they are not a member of, and cannot remove the entity from a group they are not a member of (the "rescue" direction).

The check SHALL run inside the same Neo4j write transaction as the update.

The check SHALL NOT run when `data.groupCascade === true`. The `groupCascade` flag is set only by `mutateNode`'s recursive cascade loop on children whose group set has already been validated one frame up on the parent update; it is not exposed as a public mutation input. This short-circuit prevents redundant re-checks during cascade and avoids spurious failures when a cascaded child's existing group set is wider than the caller's `MEMBER_OF` set.

The privatization guard at `Resolvers.js:878` (blocking removal of `publicGroupID` from a node that is currently public) is independent of this requirement and remains in force.

#### Scenario: Caller not a member of an added group — update rejected

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and an existing `OTU` `O` that is `ELEMENT_OF` group `A` only
- **WHEN** `U` invokes `UpdateOTU` on `O` with `groups: [A.pbotID, B.pbotID]`
- **THEN** the mutation MUST fail with a `ValidationError` naming `B.pbotID`
- **AND** `O.ELEMENT_OF` MUST remain `[A]`

#### Scenario: Caller not a member of a removed group — update rejected (rescue prevention)

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and an existing `Description` `D` that is `ELEMENT_OF` groups `A` and `B`
- **WHEN** `U` invokes `UpdateDescription` on `D` with `groups: [A.pbotID]`
- **THEN** the mutation MUST fail with a `ValidationError` naming `B.pbotID`
- **AND** `D.ELEMENT_OF` MUST remain `[A, B]`

#### Scenario: Symmetric-difference check — caller member of all changed groups — succeeds with cascade

- **GIVEN** a calling user `U` who is `MEMBER_OF` groups `A` and `B`, and an existing `OTU` `O` that is `ELEMENT_OF` `[A, B]` with cascade-related children inheriting that set
- **WHEN** `U` invokes `UpdateOTU` on `O` with `groups: [A.pbotID]`
- **THEN** the mutation MUST succeed
- **AND** `O.ELEMENT_OF` MUST become `[A]`
- **AND** the recursive cascade to children (entered with `groupCascade: true`) MUST proceed without re-running the membership check on each child

#### Scenario: No change to `groups` — update unaffected

- **GIVEN** a calling user `U` and an existing entity whose current `ELEMENT_OF` set equals the requested `data.groups` (or `data.groups` is omitted)
- **WHEN** `U` invokes the update mutation
- **THEN** the symmetric difference is empty and no membership check failure can occur for the `groups` field

### Requirement: Membership check failures MUST NOT leak group information beyond the supplied IDs

The `ValidationError` message raised on a failed membership check SHALL list only the group ID(s) the caller themselves supplied (or, on update, the group ID(s) currently on the entity that the caller is attempting to remove). The error message MUST NOT enumerate the caller's full `MEMBER_OF` set, nor the full set of groups the entity currently belongs to.

#### Scenario: Error message scoped to supplied IDs

- **GIVEN** a caller supplying `groups: [A, B, C]` on `CreateOTU` and being a member only of `A`
- **WHEN** the mutation fails the membership check
- **THEN** the error message names `B` and `C` (the unauthorized supplied IDs)
- **AND** the error message MUST NOT name any other group ID the caller is or is not a member of

### Requirement: Caller MUST share at least one group with the target of a delete

For every delete mutation resolved through `mutateNode` with type `"delete"`, the system SHALL verify that the calling user has a `MEMBER_OF` edge to at least one `Group` that the target node is `ELEMENT_OF`. This covers `DeleteReference`, `DeleteSchema`, `DeleteCharacter`, `DeleteState`, `DeleteDescription`, `DeleteCharacterInstance`, `DeleteOTU`, `DeleteSynonym`, `DeleteComment`, `DeleteSpecimen`, `DeleteCollection`, `DeleteGroup` and `DeleteImage`.

The target's group set SHALL be read from the database by the target's `pbotID` inside the same write transaction as the delete. Caller-supplied `groups` input SHALL NOT be used.

For a `Comment` target, the group set SHALL be that of the root of its `REFERS_TO` chain, meaning the first node reached that is not a `Comment`.

If the target has no group set (including a Comment whose chain has no root, or whose root has no `ELEMENT_OF`), the delete SHALL be rejected.

The check SHALL run before blocking relationships are evaluated and before any write. On failure, the mutation SHALL fail with a `ValidationError`, and no label change, archived relationship, `type:"DELETE"` audit edge (archived as `_ENTERED_BY`) or cascaded child delete SHALL be persisted.

Records in the `public` group receive no special treatment: any member of `public` satisfies the check for them.

#### Scenario: Caller shares no group with a private record — delete rejected

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and a `Schema` `S` that is `ELEMENT_OF` group `B` only
- **WHEN** `U` invokes `DeleteSchema` on `S`
- **THEN** the mutation MUST fail with a `ValidationError`
- **AND** `S` MUST still carry the `Schema` label with its `ELEMENT_OF` edge to `B`, and no `ENTERED_BY` or `_ENTERED_BY` edge with `type:"DELETE"` MUST exist on `S`

#### Scenario: Caller shares one of several groups — delete succeeds

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and an `OTU` `O` that is `ELEMENT_OF` groups `A` and `B`
- **WHEN** `U` invokes `DeleteOTU` on `O` and `O` has no blocking relationships
- **THEN** the mutation MUST succeed and `O` MUST be soft-deleted

#### Scenario: Public record — any public member may delete

- **GIVEN** a calling user `U` who is `MEMBER_OF` `public`, and a `Reference` `R` that is `ELEMENT_OF` `public` only
- **WHEN** `U` invokes `DeleteReference` on `R` and `R` has no blocking relationships
- **THEN** the mutation MUST succeed

#### Scenario: Caller cannot supply groups on delete

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and a `Collection` `C` that is `ELEMENT_OF` group `B` only
- **WHEN** `U` invokes `DeleteCollection` on `C` with `groups: [A.pbotID]` in the input
- **THEN** the request MUST fail GraphQL validation, because `DeleteInput` declares no `groups` field
- **AND** when `U` invokes `DeleteCollection(data: {pbotID: C.pbotID})`, the mutation MUST fail with a `ValidationError`

#### Scenario: Comment checked against its root Synonym

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, a `Synonym` `Y` that is `ELEMENT_OF` group `B` only, and a `Comment` `K2` that `REFERS_TO` a `Comment` `K1` that `REFERS_TO` `Y`
- **WHEN** `U` invokes `DeleteComment` on `K2`
- **THEN** the mutation MUST fail with a `ValidationError`

#### Scenario: Record with no groups — fail closed

- **GIVEN** a `Specimen` `P` with no `ELEMENT_OF` edges
- **WHEN** any caller invokes `DeleteSpecimen` on `P`
- **THEN** the mutation MUST fail with a `ValidationError`

#### Scenario: Group delete requires membership in that group

- **GIVEN** a calling user `U` who is not `MEMBER_OF` group `G`
- **WHEN** `U` invokes `DeleteGroup` on `G`
- **THEN** the mutation MUST fail with a `ValidationError`

### Requirement: Internal cascade deletes MUST NOT re-run the delete group check

When `mutateNode` recurses into cascade children during a delete with `cascade: true`, it SHALL mark the child call with a server-only `deleteCascade` flag, and the delete group check SHALL be skipped for calls carrying that flag. The flag SHALL NOT be declared in any GraphQL input type, so callers cannot set it.

#### Scenario: Cascade delete of a Collection removes its Specimens

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A`, and a `Collection` `C` in `A` with `Specimen`s `P1` and `P2` collected in it
- **WHEN** `U` invokes `DeleteCollection` on `C` with `cascade: true`
- **THEN** the group check MUST run once, for `C`
- **AND** `C`, `P1` and `P2` MUST all be soft-deleted

#### Scenario: Caller cannot set the cascade flag

- **WHEN** a caller invokes `DeleteSchema` with `deleteCascade: true` in the input
- **THEN** the request MUST be rejected by GraphQL input validation as an unknown field

