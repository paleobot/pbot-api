## 1. Smoke test on Person.entered

- [x] 1.1 On a feature branch, edit `schema.graphql:48` to add the canonical predicate inside `Person.entered`'s `@cypher` body: `match (n)-[:ENTERED_BY]->(this) where exists { (n)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) } return n`.
- [x] 1.2 Bring up pbot-api against a dev Neo4j instance.
- [x] 1.3 Identify or create a Person `Pcontrib` who has entered (a) at least one Specimen or Description `ELEMENT_OF` a Group the test user belongs to, and (b) at least one Specimen or Description `ELEMENT_OF` only Groups the test user does NOT belong to. Query `entered` on `Pcontrib` and confirm only the in-scope entries are returned.
- [x] 1.4 Confirm that any Comment `Pcontrib` has authored is absent from the result (expected per design — Comments lack `ELEMENT_OF`).
- [x] 1.5 Repeat 1.3 using an unauthenticated request (no token), confirming guest-Person scoping returns only public-group entries.
- [x] 1.6 If any of 1.3–1.5 fail, halt and re-spike the parameter binding before proceeding.

## 2. Patch OTU.mergedDescription

- [x] 2.1 In `schema.graphql`, edit `OTU.mergedDescription` (around line 232) to add the predicate at BOTH `specimen` and `d` (Description) traversal points. Append a `WHERE` clause to the first MATCH (or insert a separate WHERE between MATCH and `WITH DISTINCT d`) along the lines of: `WHERE exists { (specimen)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) } AND exists { (d)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }`.

## 3. Regression checks

- [x] 3.1 On a representative dev OTU known to span groups (or manufactured to do so), verify `mergedDescription` content shrinks to exactly the in-scope rows. Capture before/after row counts for the changelog note.
- [x] 3.2 On a high-volume contributor Person, verify `entered` content shrinks to in-scope entities only and confirm no in-scope content was incorrectly excluded. Note the Comment-exclusion side effect explicitly.
- [x] 3.3 Run the full pbot-client OTU page (`/otu/<id>?includeMergedDescription=true&includeHolotypeDescription=true`) against the patched server to confirm no errors and content matches expectations.
- [x] 3.4 Performance spot-check `Person.entered` on the highest-volume contributor in the dataset; confirm response time is within the previous envelope. If a regression appears, fall back to pre-collecting the user's groups inside the `@cypher` body and using list-membership.

## 4. Documentation and release

- [x] 4.1 Add a changelog/release-notes entry describing the fix as a security correction; reference the two affected fields by name without disclosing example exposure cases. Explicitly note the `Person.entered` Comment-exclusion behavior change.
- [x] 4.2 Document the `Person {email: "guest"}` precondition in the project README or a new `docs/group-scoping.md` so future deployments seed the guest Person and Group.
- [x] 4.3 If multi-group deployments exist with named admins, send an out-of-band heads-up that previously cross-group merged content will no longer appear (separate from the changelog). _(Skipped: no multi-group deployments with named admins exist.)_

## 5. Coordination

- [x] 5.1 Verify pbot-client `otu-specimen-description-indicator` capability still passes its scenarios after the server change. The "Has Descriptions" column logic depends only on `describedBy.length`, which is on the Specimen-not-Description side and is unaffected by this change; confirm by checking a known multi-group OTU.
- [x] 5.2 Open a tracking note on `fix-cypher-group-scope-leaks-medium` indicating the spike findings now apply to its design as well, and that its delta-spec wording can extend (rather than create) the `cypher-field-group-scoping` capability.
- [x] 5.3 Confirm `audit-comment-group-inheritance` is still in proposal-only state — it should remain as a reminder until someone is ready to investigate the Comment-visibility model.
