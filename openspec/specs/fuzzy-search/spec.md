## ADDED Requirements

### Requirement: Fuzzy search query for each core entity type

The system SHALL expose one fuzzy search GraphQL query per core entity type — `fuzzyPerson`, `fuzzySchema`, `fuzzyReference`, `fuzzyCollection`, `fuzzyOTU` — each returning a list of nodes of the corresponding type.

Each fuzzy query MUST accept the standard filter, ordering, and pagination arguments of its underlying node type (`_<TypeName>Filter`, `_<TypeName>Ordering`, `first`, `offset`) in addition to the fuzzy-specific arguments described below.

#### Scenario: Fuzzy query field exists for each entity type

- **WHEN** the augmented GraphQL schema is introspected
- **THEN** queries `fuzzyPerson`, `fuzzySchema`, `fuzzyReference`, `fuzzyCollection`, and `fuzzyOTU` are each present on the `Query` type
- **AND** each returns a list of the corresponding node type (`[Person]`, `[Schema]`, `[Reference]`, `[Collection]`, `[OTU]`)

#### Scenario: Fuzzy query accepts standard filter inputs

- **WHEN** a client introspects the arguments of any fuzzy query field
- **THEN** the field accepts a `filter` argument of the auto-generated `_<TypeName>Filter` input
- **AND** the field accepts an `orderBy` argument of `[_<TypeName>Ordering]`
- **AND** the field accepts `first: Int` and `offset: Int`

### Requirement: Fuzzy match against an entity's designated text property

For `fuzzySchema`, `fuzzyReference`, `fuzzyCollection`, and `fuzzyOTU`, the system SHALL accept a `searchString: String` argument and return only nodes whose designated text property fuzzy-matches `searchString` according to Lucene edit-distance semantics (`~` operator).

The designated text property per entity is: `Schema.title`, `Reference.title`, `Collection.name`, `OTU.name`.

For `fuzzyPerson`, the system SHALL accept `surname: String`, `given: String`, and `middle: String` arguments. When any of these are non-empty, the system SHALL fuzzy-match using the existing composite `fuzzyPersonNameIndex` (over `Person.given`, `Person.middle`, `Person.surname`).

#### Scenario: Fuzzy match returns near-spelling candidates

- **GIVEN** a `Reference` exists with `title: "On the Origin of Species"`
- **WHEN** a client calls `fuzzyReference(searchString: "Origin Speceis")`
- **THEN** the response includes that Reference

#### Scenario: Empty search string for non-Person entities

- **WHEN** a client calls `fuzzyReference(searchString: "")` (or omits a required field)
- **THEN** the system MAY return an empty list or all candidates up to `fuzzyLimit` — behavior is unspecified for empty input but MUST NOT error

#### Scenario: Person fuzzy with multiple name fields

- **GIVEN** a `Person` exists with `given: "Charles"`, `surname: "Darwin"`
- **WHEN** a client calls `fuzzyPerson(surname: "Darwen", given: "Charls")`
- **THEN** the response includes that Person

### Requirement: Standard filters apply on top of fuzzy match

After the fuzzy match step produces a candidate set of node IDs, the system SHALL apply any `filter` argument as if the client had called the standard auto-generated query for that node type.

The full filter capability of the auto-generated `_<TypeName>Filter` input MUST be available, including scalar comparisons, `_in`/`_not_in`, regex matches (`_regexp`), nested relationship filters (`_some`/`_every`/`_none`), and combinators (`AND`/`OR`).

#### Scenario: Filter narrows fuzzy candidates

- **GIVEN** ten References fuzzy-match `searchString: "lyll"` and three of them have `year: "1830"`
- **WHEN** a client calls `fuzzyReference(searchString: "lyll", filter: { year: "1830" })`
- **THEN** the response contains only those three References

#### Scenario: Nested relationship filter applies

- **GIVEN** a `Reference` has `AUTHORED_BY` relationship to a `Person` with `pbotID: "p123"`
- **WHEN** a client calls `fuzzyReference(searchString: "<title>", filter: { authors_some: { pbotID: "p123" } })`
- **THEN** that Reference appears in the response if and only if both the fuzzy match and the author filter are satisfied

### Requirement: Group scoping is enforced via `cypherParams`

Every fuzzy query SHALL respect the same group-scoping semantics as the corresponding auto-generated node query. A node MUST NOT be returned to a caller whose `cypherParams` do not authorize access to that node's group(s).

This includes Person (`MEMBER_OF`) and Schema/Reference/Collection/OTU (`ELEMENT_OF`) relationships.

#### Scenario: Cross-group results are filtered out

- **GIVEN** a `Reference` belongs to group `private-A` (via `ELEMENT_OF`)
- **AND** the calling user is not a member of `private-A`
- **WHEN** the user calls `fuzzyReference(searchString: <a string that fuzzy-matches that Reference's title>)`
- **THEN** the response does NOT include that Reference

#### Scenario: In-group results are returned

- **GIVEN** the same Reference and the same user is a member of `private-A`
- **WHEN** the user calls the same query
- **THEN** the response DOES include that Reference

### Requirement: Results are score-ordered by default; explicit `orderBy` overrides

When the client does NOT supply an `orderBy` argument, the system SHALL return results ordered by descending fuzzy-match score (best matches first).

When the client DOES supply an `orderBy` argument, the system SHALL apply that ordering and ignore fuzzy score.

Fuzzy score itself is NOT exposed in the GraphQL response.

#### Scenario: Default order is by fuzzy score

- **GIVEN** three References fuzzy-match a search and have known descending scores R1 > R2 > R3
- **WHEN** a client calls `fuzzyReference(searchString: <s>)` without `orderBy`
- **THEN** the response is `[R1, R2, R3]`

#### Scenario: Explicit orderBy wins

- **GIVEN** the same References, and `R3.title` < `R1.title` < `R2.title` lexicographically
- **WHEN** a client calls `fuzzyReference(searchString: <s>, orderBy: [title_asc])`
- **THEN** the response is `[R3, R1, R2]`

### Requirement: Candidate set is bounded by `fuzzyLimit`

Each fuzzy query SHALL accept a `fuzzyLimit: Int` argument (default 200) that bounds the number of candidate nodes the fulltext index returns BEFORE filters are applied.

This limit applies to the candidate set, not to the final result. The final result is further bounded by `first` (if supplied).

#### Scenario: Default candidate limit applied

- **GIVEN** the fulltext index would naturally match 5,000 nodes for a given searchString
- **WHEN** a client calls a fuzzy query without `fuzzyLimit`
- **THEN** the system passes at most 200 candidate IDs into the downstream filter step

#### Scenario: Override candidate limit

- **WHEN** a client calls a fuzzy query with `fuzzyLimit: 1000`
- **THEN** the system passes up to 1000 candidate IDs into the downstream filter step

### Requirement: Pagination applies after filtering

The `first` and `offset` arguments SHALL bound the FINAL result set (after fuzzy match and filter application), not the candidate set.

#### Scenario: First applies to filtered results

- **GIVEN** a fuzzy + filter combination produces 50 results in score order
- **WHEN** a client calls the query with `first: 10`
- **THEN** the response contains the top 10 results

### Requirement: Auto-generated node queries remain unchanged

The system SHALL NOT modify the behavior of the existing auto-generated `Person`, `Schema`, `Reference`, `Collection`, or `OTU` queries.

#### Scenario: Standard query unaffected

- **WHEN** a client calls the standard auto-generated `Reference(filter: { title_regexp: "...something..." })` query
- **THEN** the response is identical to the response that would have been produced before this change

### Requirement: `fuzzyPersonSearch` is preserved but deprecated

The system SHALL continue to support `fuzzyPersonSearch` with its existing argument signature and return type. The schema documentation SHALL mark it as deprecated and reference `fuzzyPerson` as the replacement.

#### Scenario: Existing clients keep working

- **WHEN** a client calls `fuzzyPersonSearch(surname: "Darwen", given: "Charls", ...)` with any supported argument combination
- **THEN** the response is the same as it was before this change

#### Scenario: Deprecation is visible

- **WHEN** a developer reads the `fuzzyPersonSearch` doc-comment in `schema.graphql`
- **THEN** the doc-comment indicates the field is deprecated and points to `fuzzyPerson`

### Requirement: Operational setup is documented

The system SHALL include a Cypher script at `cypher/setup-fuzzy-indexes.cypher` that creates all fulltext indexes required by the fuzzy queries. The script MUST be idempotent — safe to run repeatedly without error or duplicate effect.

Each fuzzy query field's doc-comment in `schema.graphql` SHALL include the exact Cypher invocation that creates its required index.

#### Scenario: Setup script creates all required indexes

- **GIVEN** a fresh Neo4j database with none of the fuzzy indexes
- **WHEN** an operator runs `cypher/setup-fuzzy-indexes.cypher`
- **THEN** all five indexes (`fuzzyPersonNameIndex`, `fuzzySchemaTitleIndex`, `fuzzyReferenceTitleIndex`, `fuzzyCollectionNameIndex`, `fuzzyOTUNameIndex`) exist

#### Scenario: Setup script is idempotent

- **GIVEN** a Neo4j database where all five indexes already exist
- **WHEN** an operator re-runs `cypher/setup-fuzzy-indexes.cypher`
- **THEN** the script completes without error and the indexes are unchanged
