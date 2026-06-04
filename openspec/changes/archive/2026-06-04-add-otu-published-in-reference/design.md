## Rejected: First-class `Authority` node

The original framing proposed promoting `OTU.authority` from a String to a `HAS_AUTHORITY` relationship pointing to a new `Authority` node:

```
type Authority {
    pbotID: ID!
    citation: String!
    descriptors: [String]
    year: String
    publishedInReference: Boolean
}
```

Existing string values would be copied to `Authority.citation`; `descriptors` would be derived by splitting on `/[,;:&]/`; `year` extracted by regex.

This was abandoned because it raised more questions than the simpler edge-property approach answers:

- **Cardinality / sharing**: 1:1 with OTU, or shared across OTUs that cite the same publication? Each branch has different migration and delete-cascade semantics.
- **Migration audit trail**: `ENTERED_BY` for the new node — original author or synthetic migration user?
- **Group scoping**: shared Authorities across groups create a scoping ambiguity that doesn't exist anywhere else in the model.
- **Cutover ordering**: a shape change to `OTU.authority` breaks every existing consumer at deploy time.
- **Parsing in production**: the descriptors/year regexes will produce messy results on heterogeneous historical citation strings; better to do that parsing once, with rigor, during the planned pbdb2 migration.

The `Reference` node already carries `year`, `authoredBy`, `title`, `journal`, etc. — everything the `Authority` node would have parsed out of the citation string. The information was already in the graph; what was missing was a way to point at *which* `Reference` corresponded to the authority.

## Chosen design

A single optional Boolean on the existing `(:Reference)-[:CITED_BY]->(:OTU)` edge. The `authority` String on OTU is left untouched.

```
(OTU)←[:CITED_BY {order, publishedInReference: true}]――(Reference)   ← the one publication-of-authority edge
(OTU)←[:CITED_BY {order}]――(Reference)                                ← any number of other citations
(OTU)←[:CITED_BY {order}]――(Reference)
```

## Decision rationale

### 1. Cardinality enforcement — server-side JS validation

Neo4j's constraint language has no native form for "at most one relationship of type X from a given node where property Y is true." The only ways to enforce it at the DB layer are APOC triggers (operational complexity, invisible to version control, lost on DB restore without re-install) or app-layer validation in `mutateNode`.

We chose app-layer validation because:

- `mutateNode` is the only write path for OTUs. Both the GraphQL client and direct-API users go through it.
- `data.references` is the full replacement set on both create and update — see the existing duplicate-references check at `Resolvers.js:764-772` for the same pattern. No DB roundtrip is needed; the check is `data.references.filter(r => r.publishedInReference === true).length > 1`.
- A pre-existing OTU-specific validation block already exists at `Resolvers.js:778-795`. The new check slots in there.

The validation does not protect against direct Cypher writes that bypass GraphQL entirely (Neo4j Browser, ad-hoc migration scripts). That gap is acceptable — those writers are not anonymous users, and pbdb2 migration scripts would disable triggers anyway.

### 2. Reuse `CitedByInput` (do not introduce `OTUCitedByInput`)

`CitedByInput` is referenced by `OTUInput` and by every other input type that carries `references: [CitedByInput!]!` — Schema, Description, Specimen, Collection, Synonym, Comment. Adding `publishedInReference` to the shared input makes it accepted on every one of those mutations.

For non-OTU node types, the `properties` list in `SchemaMaps.js` does not include `"publishedInReference"`, so `mutateNode` silently drops the field when materializing the `CITED_BY` edge. The data does not reach Neo4j. Two-sentence summary: the type signature is slightly lax (the field is *advertised* on non-OTU citation inputs even though it is meaningless there), but no junk lands in the graph.

The alternative — `OTUCitedByInput extends CitedByInput` — was rejected because:

- It requires modifying `OTUInput.references` to point at the new type.
- Several places downstream that consume `CitedByInput` would need to be checked for type compatibility.
- The leak is invisible to API consumers (the field is just ignored) and the cost-of-being-wrong is zero (no data corruption).

This is a small, deliberate piece of API laxness in exchange for keeping the change surface tight.

### 3. Field name: `publishedInReference`

Reads slightly oddly on a relationship — the relationship *is* the reference. Alternatives considered: `isAuthoritySource`, `establishesAuthority`, `originalDescription`. We kept `publishedInReference` because:

- It maps directly onto the term the eventual pbdb2 migration will use.
- It mirrors the field name from the rejected `Authority`-node design, preserving traceability across design history.
- It is unambiguous: an OTU's references that have this flag true are the references the taxon's authority was published in.

### 4. Null vs false

Existing `CITED_BY` edges have no `publishedInReference` property. New writes from the future client will set it explicitly to `true` or `false`. Consumers (filters, display logic) treat `null` and `false` identically. No backfill is needed; no migration is performed. The cardinality check uses strict equality `=== true`, so absent/false/null all bypass the count without ambiguity.

## Concrete edits

### `schema.graphql`

Line 554-558 (`OTUCitedBy`):

```graphql
type OTUCitedBy @relation(name: "CITED_BY") {
  from: Reference
  to: OTU
  order: String
  publishedInReference: Boolean
}
```

Line 858-861 (`CitedByInput`):

```graphql
input CitedByInput {
    pbotID: String
    order: String
    publishedInReference: Boolean
}
```

### `SchemaMaps.js`

Line 600-603 (OTU's CITED_BY entry):

```js
properties: [
    "pbotID",
    "order",
    "publishedInReference",
]
```

### `Resolvers.js`

Inside the existing `if ("OTU" === nodeType)` block (around line 778-795), append:

```js
if (data.references) {
    const flagged = data.references.filter(
        ref => ref.publishedInReference === true
    ).length;
    if (flagged > 1) {
        throw new ValidationError(
            `At most one reference may be flagged as publishedInReference`
        );
    }
}
```

## Discovered during verification: relationship-property persistence bug

The first round of verification surfaced a latent bug in `mutateNode`'s relationship-property writer that the OTU change was the first to expose. Documenting here because (a) the fix is part of this change, and (b) the fix has known limitations that future work needs to be aware of.

### The bug

Both `handleCreate` (around `Resolvers.js:609-613`) and `handleUpdate` (around `Resolvers.js:515-519`) built the Cypher fragment for relationship properties like this:

```js
relProps = relationship.properties.reduce((str, prop) => {
    return (prop !== "pbotID" && relInstance[prop]) ?
        `${str}${prop}: "${relInstance[prop]}",` :
        `${str}`;
}, '');
```

Two problems converged:

1. **Hard-coded string quoting**: every value was wrapped in double quotes in the emitted Cypher. For Boolean `true`, this wrote `publishedInReference: "true"` — the property landed in Neo4j as a String, not a Boolean. On read, the GraphQL `Boolean` serializer rejected it (`Boolean cannot represent a non boolean value: "true"`).
2. **JS truthy guard skipped legitimate `false`**: `&& relInstance[prop]` short-circuited on any falsy value. Boolean `false` was silently dropped — round-tripped as `null`.

Why this never surfaced before: until this change, every relationship in `SchemaMaps.js` with a `properties` field listed only `pbotID` and `order` (always a non-empty string). Quoting them was wrong-but-equivalent; the truthy guard was wrong-but-never-triggered.

### The fix

A type-aware emitter, applied identically at both call sites:

```js
relProps = relationship.properties.reduce((str, prop) => {
    if (prop === "pbotID") return str;
    const val = relInstance[prop];
    if (val === undefined || val === null) return str;
    // Emit Boolean and Number as native Cypher literals; everything else stays string-quoted.
    // Long-term: replace this string interpolation with parameterized Cypher.
    const literal = (typeof val === "boolean" || typeof val === "number")
        ? String(val)
        : `"${val}"`;
    return `${str}${prop}: ${literal},`;
}, '');
```

### Behavior change matrix

| Value type | Before | After |
|---|---|---|
| String (e.g. `order: "1"`) | quoted (`order: "1"`) | quoted (`order: "1"`) — unchanged |
| Empty string `""` | silently dropped (truthy guard) | persisted as `""` (no current consumer) |
| Boolean `true` (new with this change) | persisted as String `"true"` (broken) | persisted as Boolean `true` |
| Boolean `false` (new with this change) | silently dropped | persisted as Boolean `false` |
| `null` / `undefined` | skipped | skipped — unchanged |
| Number (no current consumer) | would have quoted | unquoted Cypher literal |

The only pre-existing-consumer regression risk is the empty-string case, and no code path currently writes `""` for `order`.

### Limitations remaining after this fix

The fix is type-aware for the value types that go through the relationship-property emitter **today**. It does NOT solve relationship-property persistence in general:

- **`DateTime` on a relationship property**: if a future change adds a `DateTime` field to a `properties` list in `SchemaMaps.js`, the value will arrive at this code as a JavaScript string (an ISO 8601 timestamp, since the GraphQL `DateTime` scalar serializes that way). The fix will fall through to the string-quoted branch, so Neo4j will store a String, not a native temporal. This is the **same as today's behavior** — the fix doesn't make `DateTime`-on-relationships worse, but also doesn't fix it.
- **`ID` on a relationship property**: serializes as a String at the GraphQL layer, so it would be quoted by the fix — that happens to be correct for the storage shape, but it isn't a deliberate type-aware path. Future work that requires distinguishing `ID` from `String` cannot rely on this code.
- **No string-escaping**: like the original, the fix does not escape embedded quotes or backslashes in string values. Direct injection is gated by GraphQL admin auth and inputs flowing through validated schema types, so the realistic risk is data-shape weirdness for strings containing literal `"` rather than security.

The proper long-term fix is **parameterized Cypher** in `handleCreate` / `handleUpdate` so the driver handles all type coercion. That is a much larger refactor (every interpolation in `mutateNode` would need replacing) and is explicitly out of scope here. When DateTime-on-relationships becomes a real requirement, that refactor is the right time to do it. Until then, the codebase relies on the fact that every relationship-property in `SchemaMaps.js` today is one of: String (`order`), or Boolean (`publishedInReference` after this change).

### Reaffirming what is NOT touched by the fix

- **`ENTERED_BY` audit edges** (`timestamp`, `type`): set by hard-coded Cypher at `Resolvers.js:249, 314, 578` using the `datetime()` Cypher function and string literals. They bypass the emitter entirely.
- **`HAS_STATE` on `CharacterInstance`**: set via auto-generated mutations defined inline in `schema.graphql @cypher` directives — also bypasses the emitter (per the comment at `Resolvers.js:697`).
- **`IDENTIFIED_AS` / `TYPE_OF` / `HOLOTYPE_OF` / `DESCRIBED_BY`** edges and their declared `entered_by: ID!` / `timestamp: DateTime` payload fields: these have no `properties` list in `SchemaMaps.js`, so `mutateNode` writes bare edges with no properties. The declared fields in the schema are read-only views over pre-existing data; this change does not change how they are written.

## Verification

No automated test suite exists in this repo (per `CLAUDE.md`). Verification is manual:

1. Mutation with two references, both `publishedInReference: true` → `ValidationError`.
2. Mutation with two references, one flagged → succeeds; query returns the flag on the flagged edge only.
3. Mutation with zero flagged references → succeeds; behavior unchanged from today.
4. Update of an existing OTU (no `publishedInReference` in input) → succeeds; existing edges remain unflagged.
5. Direct Cypher inspection: confirm the property lands on the `CITED_BY` edge and not on the Reference or OTU node.

## Out of scope

- Client form, display, and PDF rendering — tracked separately in `pbot-client`.
- Backfill of `publishedInReference` on existing edges from parsed `authority` strings — deferred to pbdb2 migration.
- Linking `Authority` to a first-class node — explicitly rejected (see above).
