## Context

`pbot-api` enforces group-scoped visibility primarily through an auto-injected `WHERE` predicate that `neo4j-graphql-js` weaves into every standard `_<Type>Filter` MATCH path. The injection is configured in `index.js:172`:

```js
whereClause: ` exists(($<>)-[:ELEMENT_OF|:MEMBER_OF]->(:Group)<-[:MEMBER_OF]-(p))`
```

The `$<>` placeholder is rewritten to the matched node's variable for each MATCH the library emits. This works for the generated query path: any `Specimen`, `Description`, `OTU`, etc. fetched via `neo4jgraphql()` is filtered to those `ELEMENT_OF` a `Group` the calling user is `MEMBER_OF`.

Hand-written `@cypher` directive bodies bypass this machinery entirely. They are wrapped by the library in `apoc.cypher.runFirstColumn("<body>", { this, cypherParams }, false)` (per `node_modules/neo4j-graphql-js/dist/selections.js:516`), and the body's MATCH/EXISTS clauses run as written. No predicate is injected.

Two `@cypher` fields in `schema.graphql` traverse from `this` (already group-scoped by the upstream parent query) into other independently-group-scoped entities without filtering: `OTU.mergedDescription` and `Person.entered`. These are the HIGH-severity content-exposure leaks this change addresses. The shared characteristic is that every traversed node type they reach has its own `ELEMENT_OF` edges — so the simple per-node predicate is sufficient and correct.

A pre-implementation spike (documented in the proposal's Impact section) verified two preconditions:

1. **Parameter binding.** `cypherParams` set in `index.js:170` is forwarded by the library to every `@cypher` invocation as a single bound parameter `$cypherParams`. The user pbotID is reachable inside `@cypher` bodies as `$cypherParams.user.pbotID`.
2. **Public-user behavior.** `UserManagement.js:15` falls back to `email = "guest"`, and the existing `cypherMatchPrefix` requires a `Person {email: "guest"}` to exist (otherwise unauthenticated requests would already throw on `${user.pbotID}` at `index.js:171`). The new filter inherits this contract — for unauthenticated callers, the predicate naturally scopes to whatever groups the guest Person belongs to.

A third concern emerged from review and reshaped the scope: **Comments are not directly group-scoped.** `type Comment` (`schema.graphql:296-305`) has no `elementOf` field, `CommentInput` has no `groups`, and `index.js:174` lists `Comment` in `skipPrefixNodeTypes`. The same per-node predicate would always return false for a Comment node, breaking rather than fixing the field. The originally-bundled `Comment.subject` and `Query.GetAllComments` have therefore been pulled out into a separate change (`audit-comment-group-inheritance`) which can address Comment visibility as its own design problem — likely involving traversal to a root Synonym or a different mechanism altogether.

## Goals / Non-Goals

**Goals:**

- Eliminate cross-group content exposure via the two HIGH-severity `@cypher` paths whose traversed nodes have native `ELEMENT_OF` scoping.
- Use a uniform filter shape so the pattern is reviewable and copyable to MEDIUM-severity fields later.
- Validate end-to-end that `$cypherParams.user.pbotID` is correctly bound on this fork before patching at scale, by smoke-testing the simpler of the two paths first.
- Preserve the existing public/anon-user contract — no new code paths for unauthenticated callers.
- Keep response shapes identical at the GraphQL contract level; only the result *content* shrinks.

**Non-Goals:**

- MEDIUM and LOW severity hierarchy-traversal leaks → companion change.
- Comment-visibility inheritance → `audit-comment-group-inheritance`.
- Write-path authorization issues → `audit-mutation-group-authorization`.
- The deprecated `fuzzyPersonSearch` and the global-aggregate `GetNodeCount` — out of scope by deliberate decision in the proposal.
- Refactoring the auto-injection mechanism in `neo4j-graphql-js` to penetrate `@cypher` bodies. That would be a library fork change with much wider blast radius; this design adds explicit predicates instead.
- Performance optimization beyond the natural short-circuiting of `EXISTS { ... }`.

## Decisions

### Decision: Uniform filter shape — `EXISTS { (n)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }`

Apply this predicate at every traversed scoped node inside each affected `@cypher` body. For `OTU.mergedDescription` that means filtering both `specimen` and `d` (Description). For `Person.entered` it's a single-node filter on `n`.

**Why:** Mirrors the shape the auto-injected `whereClause` already uses (`(.) -[:ELEMENT_OF|:MEMBER_OF]-> (:Group) <-[:MEMBER_OF]- (p)`), so the predicate semantics match the rest of the system. Using `EXISTS { ... }` (Neo4j 5+ subquery form) instead of pattern-`exists()` (deprecated in 5) gives short-circuiting and readability. A single canonical shape across the affected sites makes review and the MEDIUM follow-up straightforward.

**Alternatives considered:**

- *Pattern-`exists()` predicate (`exists((n)-[...]->(...))`)* — matches the existing `whereClause` syntax exactly. Rejected because Neo4j 5+ deprecates this form and EXISTS-subquery is the recommended replacement.
- *Use the `cypherMatchPrefix` string from `cypherParams`* — `index.js:171` already builds a reusable prefix string. Rejected because it's currently only consumed via the auto-injection placeholder substitution and isn't designed for direct interpolation into `@cypher` bodies; threading it in would couple the two systems unnecessarily.
- *Add a Cypher helper procedure (e.g., `pbot.userCanSee(node, userID)`)* — most reusable. Rejected for this change as overkill for two sites; revisit if the MEDIUM change plus future audits push the count toward double digits.

### Decision: Filter the Specimen step in `OTU.mergedDescription`, not just the Description

The traversal is `OTU ←[TYPE_OF|HOLOTYPE_OF]— Specimen —[DESCRIBED_BY]→ Description`. The audit identified both Specimen and Description as independently group-scoped. Filter both, not just the Description.

**Why:** A Specimen `ELEMENT_OF` only other groups can still be `TYPE_OF` an in-scope OTU. Filtering only the Description would let traversal continue through an out-of-scope Specimen, and even though the Description would then be filtered, an attacker who controlled the data could still influence merge-result behavior via Specimen-side joins. Belt-and-suspenders: filter every scoped hop.

**Alternative considered:** *Filter only the Description.* Cheaper but leaves the Specimen-step blind. Rejected as inconsistent with the audit's classification.

### Decision: `Person.entered` will silently exclude Comments after this fix; document but accept

`Person.entered` walks `match (n)-[:ENTERED_BY]->(this) return n`. The applied predicate `EXISTS { (n)-[:ELEMENT_OF]->...` evaluates to false for any node type that has no `ELEMENT_OF` edges — Comments, in particular. So entries that point to Comments will no longer appear in `entered` results.

**Why accept:** Comments are reachable via their root Synonym anyway (through `Synonym.comments`), so a contributor's authorship of a Comment is still discoverable via the thread. `Person.entered`'s primary use case is auditing contributions to scoped entities, where this fix is a strict correctness improvement. The alternative — special-casing Comment exclusion to preserve them in the result — would mean (a) writing a UNION-style Cypher that distinguishes scoped from unscoped target types and (b) leaving Comment authorship visible across groups when the rest of the world's Comment-inheritance model is still unverified (see `audit-comment-group-inheritance`). That's worse.

**Disclosure:** Note the Comment-exclusion behavior in the changelog so consumers of `Person.entered` aren't surprised.

### Decision: Smoke-test on `Person.entered` first, before patching `OTU.mergedDescription`

Patch `Person.entered` on a dev branch first. Run a query for a Person known to have entered both in-scope and cross-group entities, verify only in-scope ones come back. Only after that passes do we patch `OTU.mergedDescription`.

**Why:** The spike confirmed `$cypherParams.user.pbotID` should work via static analysis of `neo4j-graphql-js` source, but no existing `@cypher` field in pbot-api references `$cypherParams`. This is a first-time use on this fork. `Person.entered` is structurally simpler than `OTU.mergedDescription` (one MATCH, one WHERE, single-hop traversal) and it directly exercises the `$cypherParams` binding. A 30-minute smoke test catches any library/runtime-version surprise before we ship the larger edit.

This replaces the originally-planned `Comment.subject` smoke test, which was dropped when Comments were pulled out of scope.

**Alternative considered:** *Patch both fields together.* Faster if the parameter binding works on first try; more expensive rollback if it doesn't. Smoke test is cheap insurance.

### Decision: No release-note "behavior change" disclosure beyond the changelog entry

The change tightens an existing implicit contract ("group scoping is enforced everywhere"). Users who relied on the leak were relying on a bug. We document the fix in the changelog but don't issue a separate behavior-change advisory.

**Why:** Issuing a "your previous results may have included unauthorized data" advisory could itself be sensitive (it tells viewers what they used to be able to see). The fix-and-document path is the standard handling for a security-bug fix.

**Alternative considered:** *Send a heads-up to known administrators of multi-group deployments.* Worth doing out-of-band if such administrators exist — but that's a deployment/communication step, not a design-doc decision.

## Risks / Trade-offs

- **[Risk] `apoc.cypher.runFirstColumn` does not actually surface `$cypherParams` on this neo4j-graphql-js fork at runtime, despite the source reading.** → **Mitigation:** smoke test on `Person.entered` first. If it fails, escalate before the larger edit lands.

- **[Risk] A `Person {email: "guest"}` row is missing in some target environment, breaking unauthenticated requests.** → **Mitigation:** This is already the case today — the existing `cypherMatchPrefix` would throw without it. The new filter does not raise the bar; it reuses the same precondition. No new mitigation needed; document the precondition in the spec so future deployments know to seed it.

- **[Risk] A user who previously saw cross-group rows in `OTU.mergedDescription` notices the merged content shrinking and reports it as a regression.** → **Mitigation:** Hold a regression check on a known-multi-group OTU before/after the change. If the rows that disappear are cross-group as expected, the regression report is the bug fix working. Document in changelog.

- **[Risk] `Person.entered` performance regresses on Persons with very high entry counts because every result row now runs the EXISTS subquery.** → **Mitigation:** EXISTS short-circuits on first matching Group, and Persons with high entry counts almost by definition span few groups. Spot-check with the highest-volume contributor on a representative dataset; if a problem emerges, fall back to a pre-collected `WITH` of the user's groups inside the `@cypher` body and use list membership instead of subquery.

- **[Trade-off] `Person.entered` Comment exclusion is a behavior change.** Documented in the changelog and tested for in regression scenarios. Expected impact: minor; Comments remain reachable via Synonym threads.

- **[Trade-off] Inline-predicate approach scales linearly with the number of `@cypher` traversal sites.** Adding a Cypher helper procedure would amortize the boilerplate, but adds deployment surface. Accepted for this change; revisit before the audit reaches double-digit affected sites.

## Migration Plan

1. **Smoke test on dev:** Patch `Person.entered` on a feature branch. Verify in-scope-only result for a multi-group contributor; verify Comment exclusion as expected. If pass, proceed; if fail, halt and re-spike.
2. **Patch the second field:** `OTU.mergedDescription`. Edit the `@cypher` statement string to add the predicate at both Specimen and Description traversal points.
3. **Regression check on dev:** Pick at least one OTU known to span groups (or manufacture one) and verify `mergedDescription` shrinks correctly. Pick at least one Person with multi-group entries and verify `entered` shrinks correctly and excludes Comments.
4. **Deploy via the existing pbot-api deploy path** (no infra change). The change is server-side only; no client redeploy required, though pbot-client may want a regression check on the OTU page since `mergedDescription` content can change.
5. **Rollback:** Revert the schema.graphql diff. Pure schema-string edits — no DB migration to undo. Safe to roll back without coordination.

## Open Questions

None. Both spike preconditions are answered, and the Comment-related complexity has been carved out into its own change. Implementation is mechanical from here, gated on the smoke test in step 1.
