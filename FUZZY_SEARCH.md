# Fuzzy Person Search

## Overview

Fuzzy search for Person records allows users to find people by approximate surname matching, using Neo4j's fulltext index capabilities. This is useful when the exact spelling of a surname is unknown.

## Architecture

### Server Side

The fuzzy search relies on a Neo4j fulltext index and a `@cypher` directive query defined in `schema.graphql`:

```graphql
fuzzySurname(searchString: String): [Person]
  @cypher(
    statement: """
      CALL db.index.fulltext.queryNodes('fuzzySurnameIndex', $searchString+'~')
      YIELD node RETURN node;
    """
  )
```

This calls Neo4j's built-in fulltext search with the `~` (tilde) operator, which enables Lucene fuzzy matching based on edit distance (Damerau-Levenshtein). The `fuzzySurnameIndex` must exist in the database as a fulltext index on the `Person.surname` property.

### Client Side

#### PersonQueryForm.js

- Added a `fuzzy` boolean (default `false`) to `initialValues`
- Added a "Fuzzy search" checkbox (`CheckboxWithLabel` with `disabled={false}` to prevent Formik's `isSubmitting` from disabling it after submit)

#### PersonQueryResults.js

- `PersonQueryResults` passes `fuzzy` and raw (non-regex-wrapped) filter values when fuzzy is enabled
- The `Persons` component selects between two GraphQL queries based on the `fuzzy` prop:
  - **Fuzzy mode**: Uses `fuzzySurname` query, passing the raw surname as `searchString`. Also requests `memberOf { pbotID }` for client-side group filtering.
  - **Normal mode**: Uses the standard `Person` query with `surname_regexp`, `given_regexp`, `memberOf_some`, and `pbotID_not_in` filters (unchanged from original)

#### Client-Side Post-Filtering (Fuzzy Mode Only)

Since `fuzzySurname` only accepts a single `searchString` parameter, additional filtering is applied client-side after the query returns:

| Filter        | Method                                          |
|---------------|-------------------------------------------------|
| Given name    | Case-insensitive regex match                    |
| Email         | Case-insensitive exact match                    |
| ORCID         | Exact match                                     |
| PBot ID       | Exact match                                     |
| Exclude list  | Filter out IDs already in an author list, etc.  |
| Groups        | Match against `memberOf` pbotIDs                |

## Limitations

- **Fuzzy matching is surname-only.** The `fuzzySurnameIndex` fulltext index is built on the `surname` property. Given name, email, etc. are not fuzzy-matched.
- **Non-surname filters are applied client-side.** This means the server returns more data than strictly needed, violating the GraphQL principle of requesting only what you need. For the Person dataset this is unlikely to be a performance concern.

## Future Improvement: Server-Side Filtering

To move all filtering back to the server, the `fuzzySurname` query (or a new `fuzzyPerson` query) could be extended with additional parameters and `WHERE` clauses in the Cypher:

```graphql
fuzzyPerson(
    searchString: String,
    given: String,
    email: String,
    orcid: String,
    groups: [ID!],
    excludeList: [ID!]
): [Person]
  @cypher(
    statement: """
      CALL db.index.fulltext.queryNodes('fuzzySurnameIndex', $searchString+'~')
      YIELD node
      WHERE
        ($given IS NULL OR node.given =~ $given) AND
        ($email IS NULL OR node.email = $email) AND
        ($orcid IS NULL OR node.orcid = $orcid) AND
        ($excludeList IS NULL OR NOT node.pbotID IN $excludeList) AND
        ($groups IS NULL OR EXISTS {
          MATCH (node)-[:MEMBER_OF]->(g:Group)
          WHERE g.pbotID IN $groups
        })
      RETURN node
    """
  )
```

### Considerations

- **Neo4j version compatibility**: `IS NULL` parameter checks and `EXISTS {}` subqueries require Neo4j 5+. For Neo4j 4.x, workarounds using `apoc.when` or `CASE` would be needed.
- **Fulltext index expansion**: To support fuzzy matching on given name as well, a composite fulltext index could be created:
  ```cypher
  CALL db.index.fulltext.createNodeIndex('fuzzyPersonIndex', ['Person'], ['given', 'surname'])
  ```
  This would allow fuzzy matching across both fields simultaneously, but would lose the ability to distinguish which field the match came from.
- **Client-side changes**: Switching to the server-side approach would require updating the GraphQL query in `PersonQueryResults.js` to pass additional variables and removing the client-side post-filter block. The `PersonQueryResults` component would pass filters as query variables instead of post-processing.

## Files Modified

- `schema.graphql` — `fuzzySurname` query (pre-existing, unchanged)
- `client/src/components/Person/PersonQueryForm.js` — Added `fuzzy` field and checkbox
- `client/src/components/Person/PersonQueryResults.js` — Dual query selection, client-side post-filtering, group filtering via `memberOf`
