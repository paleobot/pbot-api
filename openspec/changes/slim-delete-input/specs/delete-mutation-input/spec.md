## ADDED Requirements

### Requirement: Delete mutations SHALL accept a slim `DeleteInput`

The schema SHALL declare an input type `DeleteInput` with exactly these fields: `pbotID: String!`, `cascade: Boolean` and `enteredByPersonID: String`. The following mutations SHALL take `data: DeleteInput!` as their only argument: `DeleteReference`, `DeleteSchema`, `DeleteCharacter`, `DeleteState`, `DeleteDescription`, `DeleteCharacterInstance`, `DeleteOTU`, `DeleteSynonym`, `DeleteComment`, `DeleteSpecimen`, `DeleteCollection`, `DeleteGroup` and `DeleteImage`.

`DeleteInput` SHALL NOT declare `deleteCascade` or any entity field (for example `groups`, `title`, `purpose` or `references`).

#### Scenario: Delete with only pbotID succeeds

- **GIVEN** an admin `U` who shares a group with a `Schema` `S` that has no blocking relationships
- **WHEN** `U` invokes `DeleteSchema(data: {pbotID: S.pbotID})`
- **THEN** the mutation MUST succeed and `S` MUST be soft-deleted

#### Scenario: Entity fields are rejected by GraphQL validation

- **WHEN** a caller invokes `DeleteSchema(data: {pbotID: "<uuid>", title: "x"})`
- **THEN** the request MUST fail GraphQL validation because `title` is not defined on `DeleteInput`
- **AND** no resolver MUST run

#### Scenario: Old entity-typed delete variable is rejected

- **WHEN** a client sends `mutation ($data: SchemaInput!) { DeleteSchema(data: $data) { pbotID } }`
- **THEN** the request MUST fail GraphQL validation with a variable type mismatch

#### Scenario: deleteCascade cannot be supplied

- **WHEN** a caller invokes `DeleteSpecimen(data: {pbotID: "<uuid>", deleteCascade: true})`
- **THEN** the request MUST fail GraphQL validation because `deleteCascade` is not defined on `DeleteInput`

### Requirement: Deletability SHALL NOT depend on the target's other field values

Whether a delete succeeds SHALL depend only on the target `pbotID`, the `cascade` flag, the caller's group membership and the target's relationships. A target whose stored properties are missing or null, including properties that the entity's create/update input marks as required, SHALL be deletable under the same rules as any other target.

#### Scenario: Schema with null purpose can be deleted

- **GIVEN** an admin `U` who shares a group with a `Schema` `S` whose `purpose` property is null, and `S` has no blocking relationships
- **WHEN** `U` invokes `DeleteSchema(data: {pbotID: S.pbotID})`
- **THEN** the mutation MUST succeed and `S` MUST be soft-deleted

#### Scenario: Cascade delete with slim input

- **GIVEN** an admin `U` who shares a group with a `Schema` `S` that has `Character`s
- **WHEN** `U` invokes `DeleteSchema(data: {pbotID: S.pbotID, cascade: true})`
- **THEN** `S` and its cascade-related nodes MUST be soft-deleted as before this change

### Requirement: OTU create/update pre-checks SHALL NOT run on delete

The OTU validations that check type specimens, the holotype and `publishedInReference` SHALL run only for create and update. A delete of an OTU SHALL NOT read `typeSpecimens`, `identifiedSpecimens`, `holotypeSpecimen` or `references` from the input.

#### Scenario: OTU delete with slim input does not crash

- **GIVEN** an admin `U` who shares a group with an `OTU` `O` that has no blocking relationships
- **WHEN** `U` invokes `DeleteOTU(data: {pbotID: O.pbotID})`
- **THEN** the mutation MUST succeed and `O` MUST be soft-deleted
- **AND** no `TypeError` MUST be raised

### Requirement: The server SHALL set the delete author regardless of input

The `enteredByPersonID` recorded on the `ENTERED_BY {type:"DELETE"}` edge SHALL be the authenticated caller's `pbotID`. A value the caller supplies in `DeleteInput.enteredByPersonID` SHALL be overwritten.

#### Scenario: Supplied enteredByPersonID is ignored

- **GIVEN** an admin `U` and another Person `V`
- **WHEN** `U` invokes `DeleteReference(data: {pbotID: R.pbotID, enteredByPersonID: V.pbotID})` and the delete succeeds
- **THEN** the `ENTERED_BY {type:"DELETE"}` edge on `R` MUST point to `U`, not `V`

### Requirement: Undeletable node types SHALL keep refusing deletes

`DeletePerson`, `DeleteOrgan` and `DeletePreservationMode` SHALL keep their existing signatures and SHALL keep failing with a `ValidationError` for every call.

#### Scenario: Person delete still refused

- **WHEN** an admin invokes `DeletePerson` with a valid `PersonInput`
- **THEN** the mutation MUST fail with a `ValidationError` stating that Person nodes cannot be deleted
