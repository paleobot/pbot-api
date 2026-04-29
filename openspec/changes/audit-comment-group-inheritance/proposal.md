## Why

This is a stub / placeholder change to track an open question that emerged during work on `fix-cypher-group-scope-leaks-high`. It is intentionally proposal-only — design, specs, and tasks are deferred until someone investigates the question described below. **It is not yet established that there is a real leak here**; the proposal exists so the question doesn't get forgotten.

While reviewing the four originally-scoped HIGH-severity `@cypher` leaks, two of them (`Comment.subject` at `schema.graphql:299` and `Query.GetAllComments(synonymID)` at `schema.graphql:776`) turned out to need a different fix shape than the other two (`OTU.mergedDescription` and `Person.entered`). The reason: **Comments are not directly group-scoped.**

Verified facts:

- `type Comment` (`schema.graphql:296-305`) has no `elementOf: [Group!]!` field. Every other content type does.
- `input CommentInput` (`schema.graphql:953`) has no `groups` field. Comments are created without group assignment.
- `index.js:174` lists `Comment` in `skipPrefixNodeTypes`, telling the auto-injected `whereClause` to skip Comment nodes entirely.

The implication is that Comments are intentionally not directly group-scoped. Their visibility is presumably *inherited* via the `REFERS_TO` chain — a Comment is visible iff its eventual root `Synonym` (or other `Commentable`) is visible.

What we don't yet know is whether that inheritance model is **enforced** under all reachable query paths.

## What Changes

This change is in two phases.

**Phase 1 — Audit (read-only).** Walk every code path through which a Comment can be reached and answer:

1. Is there an auto-generated top-level `Comment(filter: ...)` query? `neo4j-graphql-js` typically generates one for every type. With Comment in `skipPrefixNodeTypes`, does that query bypass group filtering and let any caller fetch any Comment by `pbotID`?
2. If the answer to (1) is yes, is there a `permissions.js` rule that gates the top-level `Comment` query? If so, the inheritance model is enforced at that boundary and there's no leak.
3. Is `Query.GetAllComments(synonymID)` reachable without scope-checking the supplied Synonym? The `@cypher` body matches `(:Synonym {pbotID: $synonymID})` directly with no group filter — does any upstream layer (permissions, resolver wrapper) check that the caller can see the supplied Synonym?
4. Within the REFERS_TO chain itself: when a caller traverses `Synonym.comments` or `Comment.comments`, is the chain itself implicitly scope-safe (since it starts from a scope-checked Synonym), or are there ways to inject a starting node that bypasses that?
5. Does `Comment.subject` ever return a Commentable that the caller could not reach by other means? If it always returns a node already-in-scope (because the only way to reach the parent Comment was through a visible Synonym), the field has no leak. If it can return a cross-group root Synonym because the parent Comment was fetched directly, it has a leak.

**Phase 2 — Fix (if needed).** Based on the audit findings, decide whether any code change is needed. Possible outcomes, in increasing order of work:

- **No leak found.** Archive this change as a no-op with the audit findings preserved as documentation of the inheritance model.
- **Top-level `Comment` query needs restriction.** Either remove it from the schema, mark it admin-only, or add a permissions rule that requires traversal from a scoped parent.
- **`Query.GetAllComments` needs to scope the Synonym.** Add `WHERE exists { (synonym)-[:ELEMENT_OF]->(:Group)<-[:MEMBER_OF]-(:Person {pbotID: $cypherParams.user.pbotID}) }` to the supplied Synonym. This is the most likely concrete fix and it cleanly fits the canonical predicate shape used by `fix-cypher-group-scope-leaks-high`.
- **`Comment.subject` needs an inheritance-aware predicate.** This is the trickiest case — would need to traverse the REFERS_TO chain to find the root Commentable and filter on that. May not be necessary depending on what (1)-(2) find.

## Capabilities

### New Capabilities

- `comment-group-inheritance`: An explicit, documented, and enforced model for how Comment visibility derives from the visibility of the entity the Comment chain is rooted at. May be a no-op if the audit shows existing enforcement is already complete; may be a substantive change if not.

### Modified Capabilities

Possibly `cypher-field-group-scoping` (introduced by `fix-cypher-group-scope-leaks-high`), if the audit concludes that `Query.GetAllComments` should be patched with the same canonical predicate shape applied to the synonym argument. The decision belongs in Phase 2.

## Impact

- **Out of scope until audit completes.** Concrete code paths, fix shapes, and risk assessment all depend on the Phase 1 findings.
- **Coupling to `fix-cypher-group-scope-leaks-high`:** Independent. HIGH ships without touching Comment-related code; this change picks up Comments separately.
- **Coupling to `audit-mutation-group-authorization`:** Adjacent — both are "audit before fixing" stubs about the boundary of what the existing scoping machinery covers. Could be sequenced together if both audits land on the same person at the same time, but no design dependency.
- **Pessimistic case (a real leak exists):** The likely affected fields are `Query.GetAllComments` and possibly `Comment.subject`. The fix shape would be schema-string edits in `schema.graphql` plus possibly a permissions rule — same flavor as the HIGH change.
- **Optimistic case (no leak):** The audit ends with documentation in the README or a `docs/comment-visibility.md` capturing the inheritance model so this question doesn't surface again.

## Status

**Proposal stub only.** Do not advance to design, specs, or tasks until Phase 1 begins. This document exists so the question is discoverable via `openspec list` and so future readers find the reasoning behind the carve-out from `fix-cypher-group-scope-leaks-high`.
