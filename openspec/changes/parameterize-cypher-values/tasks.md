## 1. Regression harness

- [ ] 1.1 Script a fixed set of create/update/delete mutations covering every `schemaMap` node type, relationship properties, cascades, blocking deletes and group moves
- [ ] 1.2 Dump affected nodes and edges (with `ENTERED_BY` audit properties) to JSON, normalizing timestamps and generated UUIDs
- [ ] 1.3 Capture the baseline from the current code against a restored DB snapshot

## 2. Identifier allow-lists

- [ ] 2.1 Add `assertLabel`, `assertRelType` and `assertProperty`, derived from `SchemaMaps.js`
- [ ] 2.2 Apply them at every `${nodeType}`, `${relationship.type}` and `${property}` interpolation

## 3. Parameterize read-only helpers

- [ ] 3.1 `getGroups` (`isPublic`, `fetchCallerGroupIDs` and `fetchCurrentGroupIDs` were already parameterized; `isSynonym`, `getPerson` and `isDuplicate` were parameterized by the `harden-image-upload-and-cypher` stopgap; just confirm them)
- [ ] 3.2 Harness diff empty

## 4. Parameterize write paths

- [ ] 4.1 Delete path (`getRelationships`, `handleDelete`: blocking/cascade/nonblocking checks, soft-delete relabeling); harness diff empty
- [ ] 4.2 Spike `apoc.do.when` parameter passing on the deployed APOC version
- [ ] 4.3 Update path (`handleUpdate`, including audit-history comparisons); harness diff empty
- [ ] 4.4 Create path (`handleCreate`: `SET baseNode += $props`, `location` via `point($lat,$lon)`, relationship properties as parameters); handle omitted optional fields; harness diff empty apart from the intended fix

## 5. Close out

- [ ] 5.1 Confirm with grep that every `.run(` call passes a params argument and no `"${` or unescaped value remains in Cypher text
- [ ] 5.2 Run the `cypher-parameterized-values` spec scenarios
- [ ] 5.3 Deploy to dev, then prod
