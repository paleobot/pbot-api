# Follow-up work (out of scope for this change)

This change fixes the *active* Specimen↔Description severance and hardens the Description
side. It does **not** address the structural root cause or repair existing damage. Two
follow-ups are recommended:

## 1. Non-destructive relationship updates (new proposed change)

`Resolvers.js` `handleUpdate` uses a destructive "replace" pattern: for every *updatable*
relationship type it unconditionally deletes all existing edges (Phase 1) and recreates
only those whose field is present and non-empty in the payload (Phase 2). The only guard
is `required: true`, which throws when a required field is absent/empty.

Consequences not solved here:
- **Partial severance** still occurs: a caller that submits an *incomplete* `specimenIDs`
  list silently drops the omitted edges; `required: true` only enforces `length > 0`,
  not completeness.
- The **Specimen side has no backstop**. By design the relationship is asymmetric
  (`required: false` — a Specimen may have zero Descriptions), so `required: true` is not
  available there. The field-name fix in this change protects the normal client flow, but
  any caller issuing an `UpdateSpecimen` that omits `descriptionIDs` can still sever.

Proposed direction: only touch a relationship when its field is *explicitly present* in
the mutation payload (distinguish "absent" from "empty"), so partial/unrelated updates
stop wiping edges. This is a cross-cutting change affecting all node types and warrants its
own proposal + design.

## 2. Audit / remediation of already-severed links

The Specimen-side bug has been latent since `SchemaMaps.js` was introduced, so an unknown
number of Specimen→Description links may already be severed. This change does **not**
restore them. Recommend a read-only audit (e.g. Specimens that were edited after their
Description was created but now have no `DESCRIBED_BY` edge, cross-referenced with archived
`_DESCRIBED_BY` / `ENTERED_BY` audit edges) to scope whether a data remediation is needed.
