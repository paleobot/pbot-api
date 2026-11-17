## Context

Delete mutations are declared in `schema.graphql` with the entity's full input type, for example `DeleteSchema(data: SchemaInput!)`. Each resolver forwards `args.data` to `mutateNode(context, nodeType, data, "delete")`. On the delete path, `mutateNode` reads only:

- `pbotID`, the target,
- `cascade`, which chooses between blocking and cascade relationships,
- `enteredByPersonID`, which `addUserID` (`index.js:110`) writes into `args.data` after the admin gate.

Internal cascade deletes already call `mutateNode` with the slim object `{pbotID, enteredByPersonID, cascade, deleteCascade: true}` (`Resolvers.js:1144`). The delete branch therefore already works without the entity fields. Only the GraphQL input type, plus one unguarded pre-check, requires them.

Shared code that runs before the `switch (type)` in `mutateNode`:

- `assertMutationIDs`: validates ID fields only when they are present. Fine with a slim payload.
- `isDuplicate`: returns early for `"delete"`.
- `references` and `groups` checks: guarded by `if (data.references)` and `data.groups &&`.
- OTU block (`Resolvers.js:899`): calls `data.typeSpecimens.forEach` without a guard, so it throws a `TypeError` on a slim payload.

On the client, every delete goes through `pbot-client/src/components/Mutator.js`, which builds `mutation ($data: ${entity}Input!) { Delete${entity}(data: $data) ... }` and sends `props.params` unchanged.

## Goals / Non-Goals

**Goals:**
- A delete succeeds or fails based only on the target ID, the caller's group membership and the node's relationships. The record's other field values play no part.
- The client sends only what the delete needs.

**Non-Goals:**
- Changing delete semantics, which stay soft delete, blocking/cascade relationships, and the group check.
- Making `DeletePerson`, `DeleteOrgan` or `DeletePreservationMode` deletable.
- Fixing `DeleteFeature`, which has no resolver.
- Backward compatibility with the current client (see Decision 5).
- Cleaning up the delete-mode UI in client forms beyond what `Mutator.js` needs. The stub data in `CharacterAccordion.js` becomes unnecessary but stays harmless, because `Mutator` drops it.

## Decisions

### 1. One shared `DeleteInput` instead of one per entity

```graphql
input DeleteInput {
    pbotID: String!
    cascade: Boolean
    enteredByPersonID: String
}
```

All 13 deletes need the same three fields. One type keeps the client simple: `Mutator` can hard-code `DeleteInput` instead of building `Delete${entity}Input`.

*Alternative:* per-entity types such as `DeleteSchemaInput`. That would leave room for entity-specific delete options later. We rejected it because no entity needs extra options now, and adding a per-entity type later would be a small change.

### 2. Keep the `data:` wrapper

`addUserID` sets `args.data.enteredByPersonID`, and every resolver passes `args.data` to `mutateNode`. Flat arguments (`DeleteSchema(pbotID: String!, cascade: Boolean)`) would be neater, but they would need changes to the middleware and every resolver. That isn't worth it for this fix.

### 3. `enteredByPersonID` is declared but always overwritten

`enteredByPersonID` is declared, matching the existing entity inputs. `addUserID` overwrites it unconditionally, so a value the client sends has no effect. Leaving it out would also work. Declaring it keeps the type consistent with the other inputs and avoids a validation error from older call sites that still pass it.

`deleteCascade` MUST NOT be added to `DeleteInput`. It is server-only, as the comment at `Resolvers.js:1142` says. If a caller could set it, they could skip the group delete check.

### 4. Guard only the OTU pre-check block on delete

Wrap the `"OTU" === nodeType` block in a `type !== "delete"` condition, which is the smallest change that removes the crash.

*Alternative:* skip every create/update pre-check, plus the public-group lookup, when `type === "delete"`. That would be cleaner and would save one query per delete. We rejected it for now because it touches more lines in a function that the `parameterize-cypher-values` change is also editing. We can revisit it there.

### 5. Coordinated cutover rather than a transition period

A GraphQL client declares its variable types, so `$data: SchemaInput!` sent to a field typed `DeleteInput!` fails validation, and the reverse fails too. No single schema accepts both clients unless parallel mutations are added (for example `DeleteSchemaByID`). Those would double the delete surface and need a later cleanup change. Dev and prod deploys are already manual and done by one person, so the API and client will go out together, as in the Node 26 cutover.

## Risks / Trade-offs

- **[Risk] The API and client deploys get out of step, and deletes fail with a GraphQL validation error.** → Mitigation: deploy both in the same session and test one delete right after. Creates and updates are unaffected either way.
- **[Risk] Another caller, such as a script or Neo4j-adjacent tool, uses the old delete signature.** → Mitigation: within these repos, only `Mutator.js` sends deletes (checked in `pbot-client/src`). Any outside script would get a clear validation error rather than a wrong delete.
- **[Trade-off] Client-side delete validation (for example the Yup delete schema in `SchemaMutateForm.js`) stays as it is.** It doesn't block anything server-side, so it can be cleaned up separately.

## Migration Plan

1. Merge the API and client changes on their `ddm-dev` branches.
2. Dev: pull the API (PM2 restarts it) and deploy the client in the same session.
3. Smoke test on dev: delete the Schema with a null `purpose` that failed before, try a cascade delete (for example a Schema with Characters), delete a CharacterInstance, and check that a delete outside your groups is still refused.
4. Prod: repeat steps 2–3 together.

**Rollback:** revert both commits and redeploy both. No data changes, so nothing else needs undoing.
