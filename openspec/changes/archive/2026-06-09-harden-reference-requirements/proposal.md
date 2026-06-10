## Why

The same destructive-update / weak-input pattern that let Specimens be separated from Descriptions also leaves citation references under-enforced on the API. For node types where a citation is conceptually mandatory, `*Input.references` is `[CitedByInput]` (omittable, nullable, emptyable) and the corresponding `CITED_BY` mapping is `required: false`, so a direct API caller can create or update these nodes with no reference even though the client expects one. Existing data confirms the intent: Schema, Description, OTU, Synonym, and Collection have ~100% reference coverage today.

## What Changes

- Require at least one reference, at both the GraphQL input layer and the resolver layer, for the five node types whose references are conceptually mandatory: **Schema, Description, OTU, Synonym, Collection**.
  - `schema.graphql`: change `references: [CitedByInput]` to `references: [CitedByInput!]!` for `DescriptionInput`, `SynonymInput`, `CollectionInput` (**BREAKING** for direct API callers that omit references). `SchemaInput` and `OTUInput` are already `[CitedByInput!]!`.
  - `SchemaMaps.js`: set `required: true` on the `CITED_BY` (`graphqlName: "references"`) mapping for Schema, Description, OTU, Synonym, and Collection. All five are currently `required: false`. For Schema and OTU this also closes a half-hardened gap (schema input already non-null, but the resolver still accepted an empty array).
- **Explicitly exclude Comment and Specimen.** References remain optional for these two: their client forms pass `optional={true}` to the shared `ReferenceManager` (start with an empty list, first row removable), and existing data shows 57% of Comments and 91% of Specimens have zero references. A Specimen may be catalogued before any publication cites it (mirroring the intentional Specimen↔Description asymmetry); requiring a citation on every Comment is semantically wrong. Hardening them would reject valid creates and block edits of most existing rows.

The client already hard-enforces ≥1 reference for exactly the five targeted types: the `ReferenceManager` component renders the first reference row as un-removable (`single` for Schema; `optional` falsy for the other four), and the per-row `pbotID` shape validation blocks submission with a blank title. This change makes the API agree with that existing client contract and adds a backstop for direct/out-of-band callers.

## Capabilities

### New Capabilities
- `reference-citation-requirement`: Defines which node types require at least one citation reference on create/update, enforced at both the GraphQL input and mutation-resolver layers, and which node types are intentionally exempt.

### Modified Capabilities
<!-- No existing spec's requirements change. -->

## Impact

- `schema.graphql`: `DescriptionInput`, `SynonymInput`, `CollectionInput` `references` → `[CitedByInput!]!` (**BREAKING** for out-of-band callers omitting references).
- `SchemaMaps.js`: `required: true` on `CITED_BY` for Schema, Description, OTU, Synonym, Collection.
- Existing data: all five targeted types have full reference coverage, so no existing node is blocked from future edits by this change. (A single zero-reference Schema seen in the local test DB was confirmed to be an aberration, not present in real data.)
- `pbot-client`: no change required. The five targeted forms already enforce ≥1 reference inline via `ReferenceManager` (un-removable first row + blank-title shape message), so a ref-less submit is blocked before it reaches the API.
- **Out of scope:** this hardening relies on the client always re-sending the full references array on update; the underlying destructive-update redesign is tracked separately (see archived `fix-specimen-description-severance` follow-up).
