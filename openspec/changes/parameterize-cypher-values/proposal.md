## Why

`Resolvers.js` builds mutation Cypher by placing request values into the query text. Most of its `session.run`/`tx.run` calls interpolate values into the text: 5 of 13 pass no parameters, and the builders behind `mutateNode` assemble large query strings. `harden-image-upload-and-cypher` contains the injection risk with a stopgap: ID inputs must be UUIDs, the small lookup helpers are parameterized, and relationship property values are escaped with `JSON.stringify`. That holds only as long as every future field is added to the ID list and every new interpolation remembers to escape. Driver parameters are the supported mechanism and remove that dependency.

Building queries this way also causes real bugs: omitting an optional field produces `baseNode.firstPage = undefined`, which is invalid Cypher (seen on 2026-11-03).

## What Changes

- Pass every request-derived value through driver parameters (`$name`) in `Resolvers.js` and `ImageManagement.js`.
- Labels, relationship types and property names, which Cypher cannot parameterize, are still interpolated, but only after checking them against allow-lists derived from `SchemaMaps.js`.
- `location` becomes `point({latitude: $lat, longitude: $lon})`.
- Omitted optional fields no longer produce invalid Cypher.
- Build a before/after regression harness first, because the repo has no automated tests.

## Capabilities

### New Capabilities
- `cypher-parameterized-values`: no request-derived value appears in Cypher text; identifiers come only from server allow-lists.

### Modified Capabilities
<!-- None. Once archived, this supersedes the free-text escaping requirement of `mutation-input-safety` in practice; the UUID-ID requirement stays as input validation. -->

## Impact

- **Code:** `Resolvers.js` (`mutateNode`, `handleCreate`, `handleUpdate`, `handleDelete`, `getRelationships`, `getGroups`, `isDuplicate`, `isSynonym`, `isPublic`, `getPerson`, `fetchCallerGroupIDs`, `fetchCurrentGroupIDs`), possibly `SchemaMaps.js`.
- **Behaviour:** mutation results should be identical, except that omitted optional fields stop erroring. The harness diff is the acceptance gate.
- **Depends on:** nothing. It can run before or after `upgrade-api-node-26`.
