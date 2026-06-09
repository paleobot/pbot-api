## ADDED Requirements

### Requirement: Specimen edits preserve the Description link

The system SHALL preserve a Specimen's existing `DESCRIBED_BY` relationships to Descriptions across `UpdateSpecimen` mutations whenever the client submits the Specimen's current Description list. The resolver SHALL read the Description list from the `descriptionIDs` input field (matching `DescriptionInput`/`SpecimenInput` and the client payload), not a differently-named field.

#### Scenario: Editing an unrelated Specimen field keeps its Description

- **WHEN** a Specimen is linked to a Description and an `UpdateSpecimen` mutation changes only an unrelated field (e.g. `name` or `notes`) while submitting the Specimen's current `descriptionIDs`
- **THEN** the Specimen remains linked to the same Description after the mutation completes

#### Scenario: Resolver reads the correct relationship field

- **WHEN** the mutation resolver processes the Specimen `DESCRIBED_BY` relationship
- **THEN** it reads the value from the `descriptionIDs` input field that the schema defines and the client sends

### Requirement: A Specimen may exist without a Description

The system SHALL allow a Specimen to have zero `DESCRIBED_BY` relationships. The Specimen-side relationship requirement SHALL remain optional so that a Specimen can be created before any Description exists.

#### Scenario: Create a Specimen with no Description

- **WHEN** a Specimen is created or updated with an empty `descriptionIDs` list
- **THEN** the mutation succeeds and the Specimen has no `DESCRIBED_BY` relationship

### Requirement: A Description must have at least one Specimen

The system SHALL reject any Description create or update that does not include at least one Specimen. This requirement SHALL be enforced both at the GraphQL input layer (`DescriptionInput.specimenIDs` is a non-null list of non-null strings) and at the mutation resolver layer (the `DESCRIBED_BY` relationship is required), so that an omitted, null, or empty `specimenIDs` is rejected before any relationship is modified.

#### Scenario: Reject a Description with no specimens

- **WHEN** a `CreateDescription` or `UpdateDescription` mutation is submitted with `specimenIDs` omitted, null, or an empty list
- **THEN** the mutation is rejected with a validation error and no existing `DESCRIBED_BY` relationships are deleted

#### Scenario: Accept a Description with specimens

- **WHEN** a `CreateDescription` or `UpdateDescription` mutation is submitted with a non-empty `specimenIDs` list
- **THEN** the mutation succeeds and the Description is linked to exactly the submitted Specimens
