## MODIFIED Requirements

### Requirement: Caller MUST share at least one group with the target of a delete

For every delete mutation resolved through `mutateNode` with type `"delete"`, the system SHALL verify that the calling user has a `MEMBER_OF` edge to at least one `Group` that the target node is `ELEMENT_OF`. This covers `DeleteReference`, `DeleteSchema`, `DeleteCharacter`, `DeleteState`, `DeleteDescription`, `DeleteCharacterInstance`, `DeleteOTU`, `DeleteSynonym`, `DeleteComment`, `DeleteSpecimen`, `DeleteCollection`, `DeleteGroup` and `DeleteImage`.

The target's group set SHALL be read from the database by the target's `pbotID` inside the same write transaction as the delete. Caller-supplied `groups` input SHALL NOT be used.

For a `Comment` target, the group set SHALL be that of the root of its `REFERS_TO` chain, meaning the first node reached that is not a `Comment`.

If the target has no group set (including a Comment whose chain has no root, or whose root has no `ELEMENT_OF`), the delete SHALL be rejected.

The check SHALL run before blocking relationships are evaluated and before any write. On failure, the mutation SHALL fail with a `ValidationError`, and no label change, archived relationship, `ENTERED_BY {type:"DELETE"}` edge or cascaded child delete SHALL be persisted.

Records in the `public` group receive no special treatment: any member of `public` satisfies the check for them.

#### Scenario: Caller shares no group with a private record — delete rejected

- **GIVEN** a calling user `U` who is `MEMBER_OF` group `A` only, and a `Schema` `S` that is `ELEMENT_OF` group `B` only
- **WHEN** `U` invokes `DeleteSchema` on `S`
- **THEN** the mutation MUST fail with a `ValidationError`
- **AND** `S` MUST still carry the `Schema` label with its `ELEMENT_OF` edge to `B`, and no `ENTERED_BY {type:"DELETE"}` edge MUST exist

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

