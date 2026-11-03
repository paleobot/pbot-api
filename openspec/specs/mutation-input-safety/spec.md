# mutation-input-safety Specification

## Purpose
Prevent request values from changing the structure of mutation Cypher: ID inputs must be UUIDs and free-text values are escaped as string literals. `parameterize-cypher-values` is the planned full fix.
## Requirements
### Requirement: ID-bearing mutation inputs SHALL be UUIDs

Before executing any Cypher, a mutation SHALL validate every ID-bearing input field: `pbotID`, `enteredByPersonID`, every relationship field declared for the node type, and the ID fields `schemaID`, `descriptionID`, `characterID`, `stateID`, `parentID`, `imageOf`, `subjectID`, `collection`, `elements`, `members`, `groups` and `otus`. Each non-empty string value, or each `pbotID` of an object value, SHALL match the UUID format. Otherwise the mutation SHALL fail with a `ValidationError` naming the field, and no query SHALL run. `null`, absent and empty-string values SHALL be accepted.

#### Scenario: Quote in pbotID rejected before any query
- **WHEN** an admin invokes `DeleteReference` with `pbotID: "x\"}) DETACH DELETE (n) //"`
- **THEN** the mutation fails with a `ValidationError` naming `pbotID`
- **AND** no node is read, modified or deleted

#### Scenario: Non-UUID relationship target rejected
- **WHEN** an admin invokes `CreateReference` with `groups: ["not-a-uuid"]`
- **THEN** the mutation fails with a `ValidationError` naming `groups`

#### Scenario: Non-UUID pbotID inside an object list rejected
- **WHEN** an admin invokes `CreateReference` with `authors: [{pbotID: "\" OR 1=1 //", order: "1"}]`
- **THEN** the mutation fails with a `ValidationError` naming `authors`

#### Scenario: Valid UUIDs and empty optional IDs accepted
- **WHEN** an admin invokes a create mutation whose ID fields are valid UUIDs and whose unset optional ID fields are `""` or absent
- **THEN** validation passes and the mutation proceeds as before

### Requirement: Free-text mutation values SHALL be escaped string literals

Free-text values that the mutation code places in Cypher text, namely the duplicate-check fields (`title`, `surname`, `given`, `middle`, `link`, `name`, `content`), relationship property values, and the email used for Person lookups, SHALL be passed as driver parameters or emitted as properly escaped Cypher string literals, so that no value can end a literal early or otherwise alter the query.

#### Scenario: Quote in a title cannot alter the duplicate check
- **WHEN** an admin creates a `Reference` whose `title` is `x"}) DETACH DELETE (n) //`
- **THEN** no node is deleted
- **AND** reading the created node back returns exactly that title

#### Scenario: Quote and backslash stored verbatim
- **WHEN** an admin creates a `Reference` whose `title` is `He said "hi" \ then left`
- **THEN** reading the node back returns exactly that title

#### Scenario: Relationship property value cannot inject
- **WHEN** an admin creates a `Reference` with `authors: [{pbotID: <valid Person UUID>, order: "1\"}]->(x) DETACH DELETE (x) //"}]`
- **THEN** no node other than the new Reference and its relationships is created, modified or deleted

### Requirement: Image rename lookup SHALL NOT interpolate the image ID

The `Image` lookup performed before an image file is renamed SHALL pass the image `pbotID` as a driver parameter.

#### Scenario: Quote in UpdateImage pbotID cannot alter the lookup
- **WHEN** an admin invokes `UpdateImage` with an uploaded file and `pbotID: "x\"}) DETACH DELETE (n) //"`
- **THEN** the mutation fails
- **AND** no node is modified or deleted

