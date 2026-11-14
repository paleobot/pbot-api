## Context

`mutateNode` (`Resolvers.js`) handles create, update and delete inside a single `session.writeTransaction`. Create and update call `assertCallerCanWriteGroups` (fetch the caller's `MEMBER_OF` set, compare it to the requested groups) for the caller-controlled group types. The `"delete"` case reads `pbotID`, `cascade` and `enteredByPersonID`, checks `schemaDeleteMap` blocking relationships via `getRelationships`, optionally recurses into cascade children with `mutateNode(context, childType, {pbotID, enteredByPersonID, cascade}, "delete")`, and then calls `handleDelete` (soft delete). There is no group check anywhere on this path.

Group membership facts:
- Every content type except Comment is `ELEMENT_OF` one or more Groups. Inherited types (Character, State, CharacterInstance, Specimen, Image) get their parent's groups at creation and are kept in sync by the update `groupCascade`.
- A Group is `ELEMENT_OF` itself, and its creator is `MEMBER_OF` it.
- Comments have no `ELEMENT_OF`. They attach through `REFERS_TO` to a Synonym, or to another Comment that eventually reaches a Synonym (`GetAllComments` walks `REFERS_TO*1..100`).
- Nearly every registered Person is `MEMBER_OF` `public` (49 of 53 people locally).

## Goals / Non-Goals

**Goals:**
- A caller can delete a record only when they share at least one group with it (policy A).
- The check runs in the same write transaction, before any read that leads to a write, and fails with no partial writes.
- It doesn't depend on any input fields beyond `pbotID`, so it works with the current full inputs and with the planned slim `DeleteInput`.

**Non-Goals:**
- Restricting public-record deletes beyond policy A (creator-only, no deletes, etc.). Those were considered and rejected for now.
- Group checks on field-only updates.
- Changing the `admin` role or `permissions.js`.
- Settling comment visibility (see `audit-comment-group-inheritance`).

## Decisions

### "At least one shared group", not "all groups"
Create and update require membership in every group being written, because they place content into those groups. Delete removes the record from all of its groups at once. Requiring every group would let any one group veto, so a record shared between lab-A and `public` could never be deleted by lab-A. "At least one" is the chosen policy A.

### The groups come from the database, not the input
The target's groups are read with a `MATCH (n {pbotID: $pbotID})-[:ELEMENT_OF]->(g:Group)` inside the transaction. `data.groups` is never trusted for delete. The client sends it today, but it's whatever the caller claims and will disappear with the slim input.

### Single query helper
Add `assertCallerCanDelete(tx, callerPbotID, pbotID, nodeType)` next to `assertCallerCanWriteGroups`. Run one parameterized query that resolves the target's groups (via the root Synonym for Comment) and tests for a shared `MEMBER_OF` group:

```
// non-Comment
MATCH (n {pbotID: $pbotID})-[:ELEMENT_OF]->(g:Group)
RETURN count(g) AS groupCount,
       count { (g)<-[:MEMBER_OF]-(:Person {pbotID: $callerPbotID}) } > 0 AS ...
```
The exact Cypher is an implementation detail. The required outcomes are:
- no groups found → reject (fail closed)
- groups found, none shared → reject, naming the node type
- at least one shared → allow

Use driver parameters only; no interpolation (consistent with the `mutation-input-safety` direction).

The node is matched by `pbotID` without a label, so labels can't be injected and the query works for every type. `pbotID` is already UUID-checked by `assertMutationIDs`.

### Comment: check the root Synonym
For `nodeType === "Comment"`, follow `(c)-[:REFERS_TO*1..100]->(root)` where `root` is not a `Comment`, and use the root's `ELEMENT_OF` groups. The 1..100 bound matches `GetAllComments`. If there's no root, or the root has no groups, fail closed.

Alternatives considered: exempting Comments (leaves a hole), or only allowing the comment author (a different policy from A, and inconsistent).

### Skip the check on internal cascades with a server-only flag
The cascade loop calls `mutateNode` with an object it builds itself. Add `deleteCascade: true` to that object and skip the check when it's set, mirroring `groupCascade` on update. This is safe because GraphQL input coercion drops fields that aren't in the input type, and neither flag is declared in any input. Without the skip, the check would still pass (children carry the parent's groups), but it would cost a query per child and could fail on legacy children whose groups have drifted.

### Placement and error type
Run it first in the `"delete"` case, before `getRelationships`, so unauthorized callers learn nothing about blocking relationships. Throw `ValidationError` with a message like `Caller is not a member of any group this Schema belongs to`, matching the error class of the create/update checks so the client displays it the same way.

### Group deletes
They go through the same check: a Group is `ELEMENT_OF` itself, so the rule becomes "caller is a member of the group". The existing `getRelationships` exception for Group (ignore the caller's own `MEMBER_OF` and the group's self `ELEMENT_OF`) is unchanged.

## Risks / Trade-offs

- [Legacy records with no `ELEMENT_OF` (pre-groups data) become undeletable] → This is the intended fail-closed behavior. Before deploying, count them with a one-off Cypher query (task 1.1). If any exist, assign them to a group (data fix) rather than weakening the rule.
- [Public data stays deletable by nearly everyone] → Accepted under policy A. The proposal records it so it can be revisited.
- [Comment root walk is wrong for comments attached to something other than a Synonym] → Today, Synonym is the only non-Comment `REFERS_TO` target (`schema.graphql`). If another commentable type is added, it will also have `ELEMENT_OF`, and the helper treats any non-Comment root the same way.
- [Cascade skip flag could be spoofed] → Only if someone adds `deleteCascade` to an input type. Leave a comment at the flag explaining why it must never appear in `schema.graphql`, as with `groupCascade`.

## Migration Plan

Server-only change, deployed manually to dev and then prod per `NODE-RUNTIME.md`. No client deploy needed. Roll back by reverting the commit; no data changes.
