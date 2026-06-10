## ADDED Requirements

### Requirement: Citation-required node types must have at least one reference

The system SHALL require at least one citation reference on create and update for the node types whose references are conceptually mandatory: **Schema, Description, OTU, Synonym, and Collection**. This requirement SHALL be enforced both at the GraphQL input layer (`references` is a non-null list of non-null `CitedByInput`) and at the mutation-resolver layer (the `CITED_BY` relationship is `required`), so that an omitted, null, or empty `references` value is rejected before any relationship is modified.

#### Scenario: Reject a citation-required node with no references

- **WHEN** a create or update mutation for a Schema, Description, OTU, Synonym, or Collection is submitted with `references` omitted, null, or an empty list
- **THEN** the mutation is rejected with a validation error and no existing `CITED_BY` relationships are deleted

#### Scenario: Accept a citation-required node with references

- **WHEN** a create or update mutation for a Schema, Description, OTU, Synonym, or Collection is submitted with a non-empty `references` list
- **THEN** the mutation succeeds and the node is linked to exactly the submitted references

#### Scenario: Empty array is rejected at the resolver layer

- **WHEN** a create or update mutation for a citation-required node passes GraphQL validation with an empty `references` list (which satisfies the non-null list type)
- **THEN** the resolver rejects it because the `CITED_BY` relationship is required, before executing any Cypher

### Requirement: Comment and Specimen references remain optional

The system SHALL allow Comment and Specimen nodes to be created and updated with zero references. The `references` input for these types SHALL remain nullable/emptyable and their `CITED_BY` mapping SHALL remain not required, so that a Specimen may be catalogued before any publication cites it and a Comment need not carry a citation.

#### Scenario: Create a Specimen with no references

- **WHEN** a Specimen is created or updated with `references` omitted or empty
- **THEN** the mutation succeeds and the Specimen has no `CITED_BY` relationship

#### Scenario: Create a Comment with no references

- **WHEN** a Comment is created or updated with `references` omitted or empty
- **THEN** the mutation succeeds and the Comment has no `CITED_BY` relationship
