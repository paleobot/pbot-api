## ADDED Requirements

### Requirement: @cypher fields SHALL filter traversed scoped nodes by caller group membership

Every `@cypher` directive body in `schema.graphql` that traverses from its anchor node (`this` or a parameter-supplied root) into other nodes that have their own `ELEMENT_OF` relationships SHALL apply a group-membership predicate at each such traversed node. The predicate SHALL test that an `ELEMENT_OF`→`Group` ←`MEMBER_OF`-`Person` path exists where the `Person`'s `pbotID` matches `$cypherParams.user.pbotID`. The predicate's canonical form is `EXISTS { (n)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }`.

This requirement applies to the two HIGH-severity surfaces covered by this change. The companion change `fix-cypher-group-scope-leaks-medium` extends the same predicate to additional fields. Comment-related fields are carved out to `audit-comment-group-inheritance` because Comments do not have `ELEMENT_OF` and therefore require a different fix shape.

#### Scenario: OTU.mergedDescription excludes cross-group Descriptions and Specimens

- **GIVEN** an OTU `O` visible to user `U`, a Specimen `S` `TYPE_OF` `O` that is `ELEMENT_OF` only groups `U` is not a member of, and a Description `D` `DESCRIBED_BY` `S`
- **WHEN** `U` queries `mergedDescription` on `O`
- **THEN** the result set MUST NOT include any character/state row derived from `D` or `S`
- **AND** Descriptions and Specimens that are `ELEMENT_OF` at least one group `U` is a member of MUST still contribute their character/state rows

#### Scenario: Person.entered excludes scoped nodes the caller cannot see

- **GIVEN** a Person `P` and a directly-group-scoped entity `E` (Specimen, Description, Schema, Reference, OTU, Synonym, Character, State, etc. — any type with `ELEMENT_OF`) that `P` is the `ENTERED_BY` of, where `E` is `ELEMENT_OF` only groups the calling user is not a member of
- **WHEN** the calling user queries `entered` on `P`
- **THEN** `E` MUST NOT appear in the result list
- **AND** entries that are `ELEMENT_OF` at least one group the calling user is a member of MUST still appear

### Requirement: Person.entered SHALL exclude entries to non-scoped node types

The `Person.entered` field returns `[Enterable]`. After this change, entries pointing to nodes that have no `ELEMENT_OF` edges (notably `Comment`) SHALL be excluded from the result. This is a deliberate behavior change resulting from the uniform predicate applied to the field; it is acceptable because non-scoped types remain reachable via their natural parent paths (e.g., Comments via `Synonym.comments`).

#### Scenario: Comment entries excluded from Person.entered

- **GIVEN** a Person `P` who has authored both a Specimen `S` (in a group the caller can see) and a Comment `C` (any thread)
- **WHEN** the caller queries `entered` on `P`
- **THEN** the result MUST include `S`
- **AND** the result MUST NOT include `C`

#### Scenario: Comment authorship still discoverable via Synonym

- **GIVEN** the same Comment `C` from the previous scenario, attached via REFERS_TO to a thread rooted at Synonym `Y` that the caller can see
- **WHEN** the caller traverses `Y.comments` and reads `enteredBy` on each
- **THEN** the caller MAY still observe `P` as the author of `C`

### Requirement: Filter SHALL inherit the existing public/anonymous user contract

The group-membership predicate SHALL rely on the same `Person {email: "guest"}` row that the existing `cypherMatchPrefix` mechanism in `index.js` already requires. Unauthenticated requests MUST be scoped to whatever groups the guest Person is `MEMBER_OF` (typically the `public` group), with no additional special-casing inside `@cypher` bodies.

#### Scenario: Unauthenticated caller scoped to guest user's groups

- **GIVEN** a request with no auth token, a Person `Pguest` with `email: "guest"` who is `MEMBER_OF` the `public` Group, and an OTU `O` reachable via the public Group
- **WHEN** the request queries `mergedDescription` on `O`
- **THEN** the result set MUST include rows from Descriptions and Specimens `ELEMENT_OF` the `public` Group
- **AND** the result set MUST NOT include rows from Descriptions or Specimens `ELEMENT_OF` only non-public Groups

#### Scenario: Unauthenticated caller behaves identically to authenticated guest

- **WHEN** the same query is run with no auth token vs. with an auth token resolving to the guest Person
- **THEN** both responses MUST return the same result set

### Requirement: Smoke test on Person.entered SHALL pass before the second field is patched

The implementation order MUST patch `Person.entered` first and verify the predicate behaves as specified before patching `OTU.mergedDescription`. This verifies that `$cypherParams.user.pbotID` is correctly bound inside `apoc.cypher.runFirstColumn` invocations on this fork — a first-time use of `$cypherParams` in a `@cypher` body in this codebase.

#### Scenario: Patch order verified by smoke test

- **GIVEN** the patch to `Person.entered` is in place on a dev branch
- **WHEN** a Person with both in-scope and cross-group scoped entries is queried, and the result is inspected for in-scope-only content
- **THEN** the result MUST contain only the in-scope entries
- **AND** Comments authored by the Person MUST be absent from the result (per the non-scoped-type exclusion requirement above)
- **AND** only after both checks pass MAY `OTU.mergedDescription` be patched
