## ADDED Requirements

### Requirement: Every mutation SHALL require an authenticated caller

The system SHALL reject any GraphQL mutation whose request context has no authenticated user (`ctx.user` is `null`, `undefined`, or otherwise falsy) before the mutation's resolver runs. The rejection SHALL be an Apollo `AuthenticationError` (extension code `UNAUTHENTICATED`). No database write, file write, or `ENTERED_BY` edge SHALL occur.

#### Scenario: Anonymous mutation rejected
- **WHEN** a request without an `Authorization` header invokes `DeleteReference`
- **THEN** the response contains an error with extension code `UNAUTHENTICATED`
- **AND** the `DeleteReference` resolver is not invoked

#### Scenario: Undefined user treated as unauthenticated
- **WHEN** the request context resolves `ctx.user` to `undefined`
- **THEN** the mutation is rejected with code `UNAUTHENTICATED`
- **AND** no `TypeError` is raised from reading `ctx.user.roles`

#### Scenario: Guest fallback user treated as unauthenticated
- **WHEN** a request has no token or an invalid one, so the context resolves `ctx.user` to the shared `guest` Person
- **THEN** the mutation is rejected with code `UNAUTHENTICATED`, not `FORBIDDEN`

### Requirement: Every mutation SHALL require the `admin` role

The system SHALL reject any GraphQL mutation from an authenticated caller whose `ctx.user.roles` does not include `"admin"`, using an Apollo `ForbiddenError` (extension code `FORBIDDEN`), before the mutation's resolver runs.

#### Scenario: Non-admin mutation rejected
- **WHEN** an authenticated user whose roles are `["user"]` invokes `CreateReference`
- **THEN** the response contains an error with extension code `FORBIDDEN`
- **AND** no `Reference` node is created

#### Scenario: Admin mutation allowed
- **WHEN** an authenticated user whose roles include `"admin"` invokes `CreateReference` with valid input
- **THEN** the mutation resolver runs and the created node's `ENTERED_BY` edge points to that user

### Requirement: The mutation gate SHALL fail closed for mutations added later

The authorization check SHALL apply to the `Mutation` type as a whole rather than to an enumerated list of fields, so any mutation added to `schema.graphql` (including fork-generated mutations) is gated without further code changes.

#### Scenario: Newly added mutation is gated
- **WHEN** a new mutation field is added to `schema.graphql` without any change to the permissions module
- **AND** an anonymous request invokes it
- **THEN** the request is rejected with code `UNAUTHENTICATED`

### Requirement: Queries SHALL remain publicly accessible

The mutation gate SHALL NOT apply to `Query` fields; read access stays governed by the existing group-scoping `cypherParams`.

#### Scenario: Anonymous query allowed
- **WHEN** a request without an `Authorization` header queries `Reference(first: 1)`
- **THEN** the query executes and returns data visible to the public group
