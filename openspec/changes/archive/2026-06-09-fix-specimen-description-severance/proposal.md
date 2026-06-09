## Why

Specimens are being silently separated from their Descriptions during routine edits. The root cause is a field-name mismatch in `SchemaMaps.js`: the Specimen `DESCRIBED_BY` relationship is mapped to `descriptionID` (singular), but the schema and client both send `descriptionIDs` (plural). Because mutation updates use a destructive delete-then-recreate pattern, every `UpdateSpecimen` deletes the existing `DESCRIBED_BY` edge and never recreates it — the resolver looks for a key that is never present. This has been latent since `SchemaMaps.js` was first introduced.

## What Changes

- Fix the Specimen `DESCRIBED_BY` mapping in `SchemaMaps.js` from `descriptionID` to `descriptionIDs` so the resolver reads the field the schema and client actually send. The Specimen side stays `required: false` (a Specimen may legitimately exist with no Description; the relationship requirement is intentionally asymmetric to avoid a chicken-and-egg creation order).
- Harden the Description side against direct API callers and the empty-array case: set `DESCRIBED_BY` to `required: true` in `SchemaMaps.js` and change `specimenIDs` to `[String!]!` in `DescriptionInput` so a Description cannot be legally created or updated without at least one Specimen.
- Document the destructive update semantics and the non-destructive-update redesign as a recommended follow-up (out of scope for this change). With the asymmetry, `required: true` is not available as a guard on the Specimen side, so the structural fix is the only durable protection there.

## Capabilities

### New Capabilities
- `specimen-description-integrity`: Guarantees that the `DESCRIBED_BY` relationship between Specimen and Description is preserved across mutations, enforces the asymmetric requirement (every Description has ≥1 Specimen; a Specimen may have zero Descriptions), and prevents accidental severance through the API.

### Modified Capabilities
<!-- No existing spec's requirements change. -->

## Impact

- `SchemaMaps.js`: `Specimen.relationships` `DESCRIBED_BY` `graphqlName` corrected; `Description.relationships` `DESCRIBED_BY` `required` set to `true`.
- `schema.graphql`: `DescriptionInput.specimenIDs` changed from `[String]` to `[String!]!` (**BREAKING** for any API caller that omits specimens on a Description mutation; the client already enforces ≥1 specimen).
- No data migration in scope. Already-severed Specimen↔Description links are not restored by this change (a separate remediation may be needed).
- No changes required in `pbot-client` for the fix to take effect; the client already sends `descriptionIDs` and enforces the Description-side minimum.
