## ADDED Requirements

### Requirement: `OTUCitedBy` exposes a `publishedInReference` flag

The relation-payload type `OTUCitedBy` (representing the `(:Reference)-[:CITED_BY]->(:OTU)` edge) SHALL expose an optional `publishedInReference: Boolean` field that indicates whether this citation is the publication in which the OTU's authority was established.

The value `null` (property absent on the underlying edge) and the value `false` MUST be treated as semantically equivalent by all consumers: the citation is not the publication-of-authority.

#### Scenario: Field is present on `OTUCitedBy`

- **WHEN** the augmented GraphQL schema is introspected
- **THEN** type `OTUCitedBy` has a field named `publishedInReference` of type `Boolean`

#### Scenario: Existing edges report null

- **GIVEN** an `OTU` with one or more existing `CITED_BY` edges that predate this change
- **WHEN** a client queries the OTU's `references` field
- **THEN** each returned `OTUCitedBy` has `publishedInReference: null`

#### Scenario: Newly written edge with `true` is read back as `true`

- **GIVEN** a `CreateOTU` or `UpdateOTU` mutation that sets `publishedInReference: true` on one of its references
- **WHEN** a client subsequently queries the OTU's `references` field
- **THEN** that `OTUCitedBy` has `publishedInReference: true`
- **AND** no other `OTUCitedBy` on the same OTU has `publishedInReference: true` (unless explicitly written by another mutation, see cardinality requirement)

### Requirement: `CitedByInput` accepts an optional `publishedInReference`

The shared `CitedByInput` input type SHALL accept an optional `publishedInReference: Boolean` field. For mutations on `OTU`, this value SHALL be persisted onto the corresponding `CITED_BY` edge. For mutations on every other node type that accepts `CitedByInput` (Schema, Description, Specimen, Collection, Synonym, Comment), the value SHALL be silently ignored and MUST NOT be persisted anywhere in the graph.

#### Scenario: Field accepted on OTU mutation and persisted

- **WHEN** a client calls `CreateOTU` or `UpdateOTU` with a reference entry that includes `publishedInReference: true`
- **THEN** the mutation succeeds
- **AND** the resulting `CITED_BY` edge in Neo4j carries the property `publishedInReference: true`

#### Scenario: Field accepted on non-OTU mutation but not persisted

- **WHEN** a client calls a mutation on a non-OTU node type (e.g. `CreateSpecimen`) with a reference entry that includes `publishedInReference: true`
- **THEN** the mutation succeeds
- **AND** the resulting `CITED_BY` edge in Neo4j does NOT carry a `publishedInReference` property

### Requirement: At most one reference per OTU may be flagged

The system SHALL reject any `CreateOTU` or `UpdateOTU` mutation whose `references` input list contains more than one entry with `publishedInReference === true`. The rejection MUST occur before any write to Neo4j.

This invariant applies to writes made through `mutateNode`. Direct Cypher writes that bypass the GraphQL layer are not covered.

#### Scenario: Two flagged references in a single mutation are rejected

- **WHEN** a client calls `CreateOTU` or `UpdateOTU` with two reference entries that both have `publishedInReference: true`
- **THEN** the mutation fails with a `ValidationError`
- **AND** no `OTU` node is created or modified
- **AND** no `CITED_BY` edges are created or modified

#### Scenario: Exactly one flagged reference is accepted

- **WHEN** a client calls `CreateOTU` or `UpdateOTU` with exactly one reference entry flagged
- **THEN** the mutation succeeds

#### Scenario: Zero flagged references is accepted

- **WHEN** a client calls `CreateOTU` or `UpdateOTU` with no flagged references (every entry has `publishedInReference: false` or omits the field)
- **THEN** the mutation succeeds

### Requirement: Flag is persisted as a native Boolean

The system SHALL persist `publishedInReference` on `CITED_BY` edges as a native Neo4j Boolean (`true` / `false`), not as a String (`"true"` / `"false"`). This requirement exists because the pre-existing relationship-property writer in `mutateNode` string-quoted every value; that writer is fixed as part of this change so Booleans (and Numbers) round-trip correctly.

The string-quoting behavior for String-typed relationship properties (notably `order` on `CITED_BY` edges across all node types) MUST be preserved — no regression.

#### Scenario: Boolean true round-trips

- **GIVEN** a `CreateOTU` mutation sets `publishedInReference: true` on a reference
- **WHEN** that property is read back via the GraphQL API
- **THEN** the value is `true` (Boolean) and no `Boolean cannot represent a non boolean value` serialization error occurs

#### Scenario: Boolean false round-trips

- **GIVEN** a `CreateOTU` mutation sets `publishedInReference: false` on a reference
- **WHEN** that property is read back via the GraphQL API
- **THEN** the value is `false` (Boolean), NOT `null` — i.e. the value was not silently dropped during persistence

#### Scenario: Existing String property `order` is unaffected

- **WHEN** any mutation persists `order` on a `CITED_BY` edge for any node type that accepts `CitedByInput`
- **THEN** `order` continues to be stored as a String, and reading it returns the same value the client supplied

### Requirement: Existing OTU behavior is preserved

The system SHALL NOT modify the behavior of any pre-existing OTU query or mutation behavior beyond the addition of the new field.

The `OTU.authority` String field SHALL remain present, writable, and readable with its current semantics. No existing `CITED_BY` edges SHALL be modified by deployment of this change.

#### Scenario: Existing `OTU.authority` String unchanged

- **WHEN** a client reads or writes `OTU.authority`
- **THEN** the behavior is identical to the behavior before this change

#### Scenario: No backfill on existing edges

- **GIVEN** any `CITED_BY` edge that existed before this change is deployed
- **WHEN** the change is deployed
- **THEN** that edge has no `publishedInReference` property (read as null)
