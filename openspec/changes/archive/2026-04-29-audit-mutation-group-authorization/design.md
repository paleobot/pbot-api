# Design

## Confirmed via re-read of `Resolvers.js`

A second pass through `mutateNode` (Resolvers.js:698-977) and `handleUpdate` (Resolvers.js:241-519) confirms both gaps. Summary of what the code actually does:

### Create path — `data.groups` source by node type

| nodeType | source of `data.groups` | caller-controlled? |
|---|---|---|
| `Person` | forced `[publicGroupID]` (Resolvers.js:768) | no |
| `Character`, `State`, `CharacterInstance`, `Specimen`, `Image` | `getGroups(tx, data)` from parent (Resolvers.js:803-806) | no |
| `Group` | new group is `ELEMENT_OF` itself; creator is `MEMBER_OF` it via special cypher (Resolvers.js:600-606) | no — caller automatically becomes a member |
| `OTU`, `Description`, `Reference`, `Schema`, `Collection`, `Synonym`, `Comment` | caller-supplied `data.groups` flows into `handleCreate` and `schemaMap[nodeType].relationships` writes one `ELEMENT_OF` per supplied ID | **yes — Gap 1** |

### Update path — `groupCascade` and the rewrite branch

```
mutateNode(type="update")
  ├─ Person                 → server forces public into data.groups
  ├─ Character/State/
  │   Specimen/Image
  │   (and !groupCascade)   → server overrides data.groups from parent;
  │                           doGroupCascade = false
  ├─ everything else        → caller-supplied data.groups stands  ← Gap 2
  │
  ├─ if isPublic && !public → block (privatization guard, NOT membership)
  ├─ if doGroupCascade      → recursive mutateNode(child, "update")
  │                           with node.groupCascade = true
  └─ handleUpdate(...)        → if data.groupCascade: properties=[],
                                relationships=[ELEMENT_OF only] —
                                pure ELEMENT_OF rewrite from data.groups
```

The cascade machinery is server-driven (children inherit the parent's just-set group set), so the fix only needs to validate caller intent at the **caller-driven entry**, not on each recursive call.

### What is NOT a gap

- `CharacterInstance` create inherits its parent Description's full group set unconditionally. Per the proposal, this is correct — CIs are components of a Description and the Description's group authorization implies authorization over its components. No fix needed here.
- `Person` create/update force public groups; immune.
- `Group` create makes the caller a member; immune.

## Where the check belongs

`permissions.js` (graphql-shield) is the wrong layer: shield rules don't have ergonomic access to the Neo4j driver, and the existing rules (`isAuthenticated && isAdmin`) operate purely on `context.user`. Adding a per-mutation group-membership cypher inside a shield rule would either duplicate the call or require running a separate session outside the write transaction, defeating the point of running the check inside the same tx as the write.

`mutateNode` already has `context.user.pbotID`, opens a session, and runs everything inside `session.writeTransaction`. The check goes there, in-tx, before `handleCreate`/`handleUpdate`.

## Decision: fail loudly, not silently filter

The proposal flags this as a design call. We choose **fail loudly** with a `ValidationError` listing the offending group IDs:

- Silent filtering changes the caller's stated intent — a request to put an entity in groups `[A, B, C]` could land it in only `[A]`, and the response gives no indication. Worse for `update`, where silent filtering would *remove* the entity from groups whose membership we couldn't verify.
- A loud failure surfaces the misconfiguration to the client, which can either correct the input or escalate to a group admin.
- The `enteredBy` audit trail already exists; loud failures keep the audit clean rather than recording successful writes that quietly diverged from intent.

## Decision: check both addition and removal on update

The proposal raises but doesn't decide whether removing groups also requires membership. We require **the caller is a member of every group in the symmetric difference between the entity's current `ELEMENT_OF` set and the requested `data.groups`**. Rationale:

- Asymmetric enforcement (only check additions) lets a non-member "rescue" content out of a group they have no relationship to. That's the same class of unauthorized cross-group write the addition check is preventing, just in the other direction.
- Symmetric difference is the minimum viable check that closes both directions and is cheap (one membership fetch + one set-diff).
- The privatization guard at Resolvers.js:878 stays — it's a separate invariant about public content and isn't superseded by membership checks.

## Decision: skip the check on server-driven recursive calls

`mutateNode` recursively invokes itself via the cascade loop (Resolvers.js:896-906) with `node.groupCascade = true`. These calls are not caller-driven — the group set was already validated one frame up on the parent update. Re-validating each cascaded child would either:

- Spuriously fail when a cascaded child currently lives in groups the caller is not a member of (legitimate when the parent's old group set was wider than the caller's membership but the new set is within it), or
- Force every cascaded write to re-fetch the same membership set redundantly.

The check therefore short-circuits when `data.groupCascade === true`. The `groupCascade` flag is only set by the recursive cascade loop in `mutateNode` itself — it is not part of the public mutation input — so this short-circuit cannot be exploited by a caller. (Confirm during implementation: verify `groupCascade` is not declared as an input field in `schema.graphql` for any mutation.)

## Sketch

```js
// helper, in Resolvers.js or a new auth.js
async function assertCallerCanWriteGroups(tx, callerPbotID, requestedGroupIDs) {
    const result = await tx.run(
        `MATCH (p:Person {pbotID: $callerPbotID})-[:MEMBER_OF]->(g:Group)
         RETURN collect(g.pbotID) AS memberGroupIDs`,
        { callerPbotID }
    );
    const memberSet = new Set(result.records[0].get('memberGroupIDs'));
    const unauthorized = requestedGroupIDs.filter(id => !memberSet.has(id));
    if (unauthorized.length > 0) {
        throw new ValidationError(
            `Caller is not a member of group(s): ${unauthorized.join(', ')}`
        );
    }
}

// inside mutateNode, after the existing nodeType-specific group-source logic
// and before handleCreate/handleUpdate:

const CALLER_CONTROLLED_GROUP_TYPES = new Set([
    'OTU', 'Description', 'Reference', 'Schema',
    'Collection', 'Synonym', 'Comment'
]);

if (!data.groupCascade && CALLER_CONTROLLED_GROUP_TYPES.has(nodeType)) {
    if (type === 'create') {
        await assertCallerCanWriteGroups(tx, context.user.pbotID, data.groups || []);
    } else if (type === 'update') {
        const existing = await fetchCurrentGroupIDs(tx, data.pbotID);  // small new helper
        const requested = data.groups || [];
        const symmetricDiff = [
            ...existing.filter(id => !requested.includes(id)),
            ...requested.filter(id => !existing.includes(id)),
        ];
        await assertCallerCanWriteGroups(tx, context.user.pbotID, symmetricDiff);
    }
}
```

The check runs inside the existing `session.writeTransaction`, so membership read and `ELEMENT_OF` write are atomic — no TOCTOU window where the caller's membership could change between check and write.

## Deferred / out of scope

- **`CreateImage`**: image create currently runs through `mutateNode` for `Image` with server-overridden groups (Resolvers.js:800), so it's not in the caller-controlled set. The proposal's enumeration listed it among Gap 1 candidates, but the code path inherits from parent. No change needed; document this in the spec to prevent future drift.
- **Tightening `permissions.js`**: not changed. The shield layer continues to enforce `isAuthenticated && isAdmin`; group-level authorization is an in-resolver concern.
- **Per-group admin roles**: out of scope. The current model is "global admin can do anything in any group they're a member of"; we are not introducing a per-group admin/editor distinction here.
