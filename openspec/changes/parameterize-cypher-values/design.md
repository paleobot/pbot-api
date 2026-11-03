## Context

Values reach Cypher text in `Resolvers.js` in three ways:
- raw inside quotes (`"${pbotID}"`, `"${data.title}"`, …), now restricted to UUIDs or escaped by the `harden-image-upload-and-cypher` stopgap;
- `${JSON.stringify(value)}` (the main property `SET` path and `UNWIND` lists);
- unquoted (`Point({latitude: ${lat}, …})`), which is safe only because the `Latitude`/`Longitude` scalars reject anything that isn't a number.

Labels (`${nodeType}`) and property names (`baseNode.${property}`) come from `schemaMap`/`schemaDeleteMap` keys chosen by the resolvers. The audit-history logic builds `SET eb.${property} = baseNode.${property}` fragments inside `apoc.do.when` strings.

There is no automated test suite. `test/mutation-params.cypher` is manual.

## Goals / Non-Goals

**Goals:** every value travels as a parameter; every interpolated identifier is checked against an allow-list; mutation semantics stay the same.

**Non-Goals:** rewriting `mutateNode`'s structure, changing the audit-history format, or any schema changes.

## Decisions

### D1. Regression harness before any refactor

A script runs a fixed set of create/update/delete mutations through the GraphQL API against a restored DB snapshot, covering every node type in `schemaMap`, relationship properties, cascades, blocking deletes, and group moves. After each run it dumps the affected nodes and edges, with `ENTERED_BY` audit properties, to JSON. The pre-refactor dump is the baseline, and every refactor step must produce an identical dump, timestamps and generated UUIDs aside.

### D2. Parameterize every value, allow-list every identifier

- Each builder accumulates a `params` object next to the query string, using generated names (`$p0`, `$p1`, …) or structured maps (`$props`, `$rels`), and passes it to `run`.
- Property sets use `SET baseNode += $props`, where `$props` is filtered to `schemaMap[nodeType].properties` keys the caller actually sent. Omitted fields are left out on update. On create, keep today's semantics, decided per path.
- `location`: `point({latitude: $lat, longitude: $lon})`.
- Identifiers: `assertLabel(nodeType)`, `assertRelType(type)` and `assertProperty(nodeType, prop)` check against `schemaMap`/`schemaDeleteMap` and throw before interpolation.
- Audit-history `apoc.do.when` fragments: the property *name* stays interpolated (allow-listed); comparison *values* are passed through the outer query's parameters, which `apoc.do.when` accepts as its params map.

*Alternative considered:* a single escaping helper for all values. Rejected because it's fragile, and parameters are the driver's supported mechanism.

### D3. Order of work

Read-only helpers first (`isPublic`, `isSynonym`, `getPerson`, the group lookups, `isDuplicate`), then delete, update and create, which is the riskiest. Run the harness after each step.

## Risks / Trade-offs

- [Subtle semantic change in the update/audit path] → Do it in harness-gated steps, update path last but one.
- [`apoc.do.when` parameter passing differs between APOC versions] → Spike on the deployed APOC version before converting the audit fragments.
- [Large diff that's hard to review] → One PR per builder, each with its harness diff attached.

## Migration Plan

No data migration. Deploy each step to dev, then prod. Revert per step.

## Open Questions

- Which APOC version runs on dev and prod?
- Should the create path set omitted optional properties to `null` explicitly, or leave them unset? Check what the client and the queries rely on.
