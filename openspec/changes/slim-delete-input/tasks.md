## 1. API schema (`pbot-api/schema.graphql`)

- [ ] 1.1 Add `input DeleteInput { pbotID: String!, cascade: Boolean, enteredByPersonID: String }`, with a comment that `enteredByPersonID` is set by the server and that `deleteCascade` must never be added
- [ ] 1.2 Change `DeleteReference`, `DeleteSchema`, `DeleteCharacter`, `DeleteState`, `DeleteDescription`, `DeleteCharacterInstance`, `DeleteOTU`, `DeleteSynonym`, `DeleteComment`, `DeleteSpecimen`, `DeleteCollection`, `DeleteGroup` and `DeleteImage` to `data: DeleteInput!`
- [ ] 1.3 Confirm that `DeletePerson`, `DeleteOrgan`, `DeletePreservationMode` and `DeleteFeature` are unchanged

## 2. API resolver (`pbot-api/Resolvers.js`)

- [ ] 2.1 In `mutateNode`, guard the `"OTU" === nodeType` pre-check block so it runs only when `type !== "delete"`
- [ ] 2.2 Confirm by reading the code that no other code before the `switch (type)` reads an entity field without a guard (`assertMutationIDs`, `isDuplicate`, the `references`/`groups` checks)
- [ ] 2.3 Start the server locally (`node index.js`) and confirm the schema builds without errors

## 3. API manual verification (local or dev, against the API alone)

- [ ] 3.1 `DeleteSchema(data: {pbotID})` succeeds on a Schema whose `purpose` is null
- [ ] 3.2 `DeleteSchema(data: {pbotID, cascade: true})` soft-deletes the Schema and its Characters
- [ ] 3.3 `DeleteOTU(data: {pbotID})` succeeds without a `TypeError`
- [ ] 3.4 `DeleteCharacterInstance(data: {pbotID})` succeeds
- [ ] 3.5 A delete with an extra field (`title`, `groups` or `deleteCascade`) fails GraphQL validation
- [ ] 3.6 A delete outside the caller's groups still fails with the group-check `ValidationError`
- [ ] 3.7 The `ENTERED_BY {type:"DELETE"}` edge points to the caller even when `enteredByPersonID` is supplied

## 4. Client (`pbot-client/src/components/Mutator.js`)

- [ ] 4.1 In delete mode, declare `mutation ($data: DeleteInput!)` instead of `${entity}Input!`
- [ ] 4.2 In delete mode, send `variables: {data: {pbotID: props.params.pbotID, cascade: props.params.cascade ?? false}}`. Check that every `*MutateResults` component passes `pbotID` in `params` for delete. `CharacterInstanceMutateResults` maps `characterInstance` to `pbotID`, so check it in particular.
- [ ] 4.3 Optional: remove the stub fields from `CharacterInstanceDeleteDialog` in `CharacterAccordion.js:65-74`. Caveat: `CharacterInstanceMutateResults.js:13` calls `queryParams.state.split("~,")` without a guard, which is why the stub `state: "x~,y"` is there. Removing `state` without changing line 13 crashes the component with a `TypeError` before `Mutator` renders. Either guard line 13 (`queryParams.state?.split("~,")[1]`) or have the delete dialog render `Mutator` directly with `{pbotID}`.

## 5. Coordinated deploy

- [ ] 5.1 Commit the API and client changes on their `ddm-dev` branches and push both
- [ ] 5.2 Dev: pull the API (PM2 restarts it) and deploy the client in the same session
- [ ] 5.3 Dev smoke test: delete the null-`purpose` Schema that failed before, try a cascade delete, delete a CharacterInstance, and check that a delete outside your groups is refused
- [ ] 5.4 Prod: deploy the API and client together and repeat the smoke test
