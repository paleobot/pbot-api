## 1. Pre-deploy data check

- [x] 1.1 On dev and prod Neo4j, count live (non-`_`-prefixed) content nodes with no `ELEMENT_OF` edge, by label (excluding Person and Comment), plus Comments with no group-bearing root. Record the counts in this change. If any are non-zero, decide whether to assign them to a group before deploying (they become undeletable)
  - 2026-11-13: local, dev and prod all returned **0** ungrouped records and **0** orphaned Comments, so no data fix is needed. Queries used:
    ```cypher
    // ungrouped live records by type (no rows = none)
    MATCH (n)
    WHERE any(l IN labels(n) WHERE l IN [
            'Reference', 'Schema', 'Character', 'State', 'Description',
            'CharacterInstance', 'OTU', 'Synonym', 'Specimen', 'Image',
            'Collection', 'Group'])
      AND NOT (n)-[:ELEMENT_OF]->(:Group)
    RETURN labels(n)[0] AS type, count(*) AS ungrouped ORDER BY type;

    // live Comments whose REFERS_TO thread doesn't reach a grouped root
    MATCH (c:Comment)
    WHERE NOT EXISTS {
      MATCH (c)-[:REFERS_TO*1..100]->(root)
      WHERE NOT root:Comment AND (root)-[:ELEMENT_OF]->(:Group)
    }
    RETURN count(c) AS orphanedComments;
    ```

## 2. Implementation (`Resolvers.js`)

- [x] 2.1 Add `assertCallerCanDelete(tx, callerPbotID, pbotID, nodeType)` next to `assertCallerCanWriteGroups`. Use one parameterized query: resolve target groups (root of `REFERS_TO*1..100` for Comment), fail closed when none, otherwise require at least one shared `MEMBER_OF`. Throw a `ValidationError` naming the node type
- [x] 2.2 In `mutateNode`'s `"delete"` case, call it first (before `getRelationships`) unless `data.deleteCascade` is set
- [x] 2.3 In the cascade loop, add `deleteCascade: true` to the object passed to the recursive `mutateNode` call, with a comment that the flag is server-only and must never be added to `schema.graphql`

## 3. Verify (manual, no automated suite)

- [x] 3.1 Delete a private record in a group you belong to → succeeds
- [x] 3.2 As a user outside a private record's groups, delete it → `ValidationError`, and the record is still visible to its group members with no `DELETE` history entry
- [x] 3.3 Delete a public record as an ordinary public member → succeeds
- [x] 3.4 Cascade-delete a Collection that has Specimens → all soft-deleted, server log shows one group check
- [x] 3.5 Delete a Comment on a Synonym in a group you're not in → `ValidationError`
- [x] 3.6 Send `deleteCascade: true` in a delete input → GraphQL rejects the unknown field
- [x] 3.7 In `pbot-client`, confirm the delete-denied message appears in the mutate results view
