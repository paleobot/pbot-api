## Context

`pbot-api` mutates Neo4j relationships through a destructive "replace" pattern in `Resolvers.js` `handleUpdate`: for every *updatable* relationship type on a node, it unconditionally deletes all existing edges (Phase 1, archiving them into `ENTERED_BY`), then recreates only the edges whose field is present and non-empty in the payload (Phase 2). Phase 2's only guard against leaving a relationship deleted is `relationship.required` — if the field is absent/empty and the relationship is required, it throws *before* any Cypher runs; otherwise it silently leaves the edges deleted.

The `DESCRIBED_BY` relationship (`Specimen → Description`) is configured asymmetrically and intentionally:
- `Description.DESCRIBED_BY` (incoming): a Description must have specimens.
- `Specimen.DESCRIBED_BY` (outgoing): a Specimen may have zero descriptions, because Specimens are created first and attached to a Description later. This avoids a chicken-and-egg creation order.

Two defects let the relationship be severed:
1. **Specimen side (active bug):** `SchemaMaps.js` maps the relationship to `graphqlName: "descriptionID"` (singular), but `schema.graphql` `SpecimenInput` and the client both use `descriptionIDs` (plural). The resolver reads `data["descriptionID"]` → always `undefined` → Phase 1 deletes the edge, Phase 2 skips recreation. Every `UpdateSpecimen` silently orphans the Specimen.
2. **Description side (latent hole):** `DescriptionInput.specimenIDs` is `[String]` and the `DESCRIBED_BY` map has `required: false`, so a direct API caller (not the client, which enforces `.min(1)`) could create/update a Description with no specimens, or pass `[]` to wipe all links.

## Goals / Non-Goals

**Goals:**
- Stop `UpdateSpecimen` from severing the Specimen↔Description link under the normal client flow.
- Enforce, at both the GraphQL and resolver layers, that a Description always has ≥1 Specimen.
- Preserve the intentional asymmetry: a Specimen may have zero Descriptions.

**Non-Goals:**
- Redesigning the destructive update pattern (only-touch-fields-present-in-payload). Recommended as a follow-up; out of scope here.
- Restoring already-severed links via data migration.
- Any `pbot-client` changes — the client already sends `descriptionIDs` and enforces the Description minimum.

## Decisions

**Decision 1: Fix the Specimen mapping by renaming the key, not by adding a remap.**
Change `SchemaMaps.js` `Specimen.relationships` `DESCRIBED_BY.graphqlName` from `"descriptionID"` to `"descriptionIDs"`. Alternatives considered: (a) rename the schema/client field to the singular — rejected, it touches more surfaces and the plural is already the de-facto contract; (b) add a compatibility alias in the resolver — rejected as unnecessary indirection. Keep `required: false` on this side per the intended asymmetry.

**Decision 2: Guard the Description side at both layers.**
Set `Description.relationships` `DESCRIBED_BY.required = true` in `SchemaMaps.js` and change `DescriptionInput.specimenIDs` to `[String!]!` in `schema.graphql`. Rationale: the GraphQL `[String!]!` rejects omitted/null early with a clear schema error, but an empty array `[]` still validates `[String!]!`; the resolver-level `required: true` is what rejects the empty-array case (Phase 2 checks `length > 0`) and does so before any delete Cypher executes. Together they are belt-and-suspenders.

**Decision 3: Do not make the Specimen side required.**
By design, `required: true` is unavailable as a Specimen-side guard. This means the Specimen path has no resolver-level backstop; its only protections are the field-name fix and (eventually) the non-destructive-update redesign. We accept this and document it.

## Risks / Trade-offs

- **[Partial severance persists]** → The destructive-replace pattern still drops any edge omitted from a *partial* `specimenIDs` list; `required: true` only enforces `length > 0`, not completeness. Mitigation: documented as a known limitation; addressed by the non-destructive-update follow-up.
- **[`[String!]!` is a breaking schema change]** → Any direct API caller omitting `specimenIDs` on a Description mutation now errors. Mitigation: the client already sends it with ≥1 entry; impact is limited to out-of-band callers, which is the intended tightening.
- **[Specimen create path was also affected]** → The same name mismatch meant `CreateSpecimen` never linked a Description either; the rename fixes create and update together. Verify a Specimen created with a `descriptionIDs` value now links correctly.
- **[Already-orphaned data]** → Existing severed links are not repaired by this change. Mitigation: flag for a separate remediation/audit if needed.

## Migration Plan

1. Apply the three edits (`SchemaMaps.js` ×2, `schema.graphql` ×1).
2. Restart the server (PM2 watch mode in production redeploys on push to `master`).
3. Manually verify: edit a Specimen that has a Description → link survives; create/update a Description with empty specimens → rejected.
4. Rollback: revert the commit; no schema migration or data change to undo.
