## ADDED Requirements

### Requirement: Caller-supplied values SHALL be passed as Cypher parameters

Every Cypher statement executed by `Resolvers.js` and `ImageManagement.js` SHALL pass all request-derived values (IDs, strings, numbers, lists, coordinates) through the driver's parameters object. No request-derived value SHALL appear in the query text.

#### Scenario: Quote in an ID cannot alter a query
- **WHEN** an admin invokes `DeleteReference` with `pbotID: "x\"}) DETACH DELETE (n) //"`
- **THEN** the mutation fails because no node is found or validation rejects it
- **AND** no node other than one whose `pbotID` exactly equals that string is read, modified or deleted

#### Scenario: String values stored verbatim
- **WHEN** an admin creates a `Reference` whose `title` is `He said "hi" \ then left`
- **THEN** reading the node back returns exactly that title

### Requirement: Labels, relationship types and property names SHALL come from server allow-lists

Any identifier that must be interpolated into Cypher (node label, relationship type, property name) SHALL be checked against the allow-lists derived from `SchemaMaps.js` before interpolation. A mismatch SHALL raise an error before any query runs.

#### Scenario: Unknown node type rejected
- **WHEN** an internal call to `mutateNode` receives node type `"Reference) DETACH DELETE (x"`
- **THEN** an error is raised and no query is executed

### Requirement: Coordinates SHALL be validated numbers passed as parameters

`location` inputs SHALL be accepted only when `latitude` is a finite number in [-90, 90] and `longitude` a finite number in [-180, 180], and SHALL be written as `point({latitude: $lat, longitude: $lon})`.

#### Scenario: Non-numeric latitude rejected
- **WHEN** a `Collection` create supplies `location: {latitude: "0}) DETACH DELETE (n) //", longitude: 0}`
- **THEN** the mutation fails with a `ValidationError`, or with a GraphQL type error if the schema already types it as a number
- **AND** no query text contains the supplied latitude

### Requirement: Omitted optional fields SHALL NOT produce invalid Cypher

When a caller omits an optional input field, the generated statement SHALL remain valid. The field SHALL be left unchanged on update, and on create SHALL be handled the way it is today when the client sends an empty value.

#### Scenario: Create with only required fields
- **WHEN** an admin calls `CreateReference` with only `title`, `year`, `publicationType`, `authors` and `groups`
- **THEN** the mutation succeeds
- **AND** the error `Variable \`undefined\` not defined` does not occur
