## 1. Harden GraphQL input types

- [x] 1.1 In `schema.graphql`, change `DescriptionInput.references` from `[CitedByInput]` to `[CitedByInput!]!`
- [x] 1.2 In `schema.graphql`, change `SynonymInput.references` from `[CitedByInput]` to `[CitedByInput!]!`
- [x] 1.3 In `schema.graphql`, change `CollectionInput.references` from `[CitedByInput]` to `[CitedByInput!]!`
- [x] 1.4 Confirm `SchemaInput.references` and `OTUInput.references` are already `[CitedByInput!]!` (no edit expected)

## 2. Harden resolver mappings

- [x] 2.1 In `SchemaMaps.js`, set `required: true` on the Schema `CITED_BY` (`graphqlName: "references"`) mapping
- [x] 2.2 In `SchemaMaps.js`, set `required: true` on the Description `CITED_BY` mapping
- [x] 2.3 In `SchemaMaps.js`, set `required: true` on the OTU `CITED_BY` mapping
- [x] 2.4 In `SchemaMaps.js`, set `required: true` on the Synonym `CITED_BY` mapping
- [x] 2.5 In `SchemaMaps.js`, set `required: true` on the Collection `CITED_BY` mapping
- [x] 2.6 Confirm the Comment and Specimen `CITED_BY` mappings remain `required: false`

## 3. Verify (citation-required types)

- [x] 3.1 For each of Schema, Description, OTU, Synonym, Collection: submit a create/update with `references` omitted and confirm rejection at the GraphQL layer
- [x] 3.2 Submit a create/update with `references: null` and confirm rejection at the GraphQL layer
- [x] 3.3 Submit a create/update with `references: []` and confirm rejection at the resolver layer (`Missing required relationship references`), with no existing links deleted
- [x] 3.4 Submit a create/update with a non-empty `references` list and confirm the node links to exactly those references

## 4. Verify (exempt types)

- [x] 4.1 Create/update a Specimen with no references and confirm it succeeds with no `CITED_BY` edge
- [x] 4.2 Create/update a Comment with no references and confirm it succeeds with no `CITED_BY` edge

## 5. Client confirmation (no change expected)

- [x] 5.1 Confirm the five targeted forms (Schema, Description, OTU, Synonym, Collection) already enforce ≥1 reference via `ReferenceManager` (un-removable first row + blank-title shape message), and that Comment/Specimen pass `optional={true}` — i.e. no `pbot-client` change is needed
