## 1. API schema (`pbot-api/schema.graphql`)

- [x] 1.1 Add `input DeleteInput { pbotID: String!, cascade: Boolean, enteredByPersonID: String }`, with a comment that `enteredByPersonID` is set by the server and that `deleteCascade` must never be added
- [x] 1.2 Change `DeleteReference`, `DeleteSchema`, `DeleteCharacter`, `DeleteState`, `DeleteDescription`, `DeleteCharacterInstance`, `DeleteOTU`, `DeleteSynonym`, `DeleteComment`, `DeleteSpecimen`, `DeleteCollection`, `DeleteGroup` and `DeleteImage` to `data: DeleteInput!`
- [x] 1.3 Confirm that `DeletePerson`, `DeleteOrgan`, `DeletePreservationMode` and `DeleteFeature` are unchanged

## 2. API resolver (`pbot-api/Resolvers.js`)

- [x] 2.1 In `mutateNode`, guard the `"OTU" === nodeType` pre-check block so it runs only when `type !== "delete"`
- [x] 2.2 Confirm by reading the code that no other code before the `switch (type)` reads an entity field without a guard (`assertMutationIDs`, `isDuplicate`, the `references`/`groups` checks)
- [x] 2.3 Start the server locally (`node index.js`) and confirm the schema builds without errors

## 3. API manual verification (local or dev, against the API alone)

- [x] 3.1 `DeleteSchema(data: {pbotID})` succeeds on a Schema whose `purpose` is null
- [x] 3.2 `DeleteSchema(data: {pbotID, cascade: true})` soft-deletes the Schema and its Characters
- [x] 3.3 `DeleteOTU(data: {pbotID})` succeeds without a `TypeError`
- [x] 3.4 `DeleteCharacterInstance(data: {pbotID})` succeeds
- [x] 3.5 A delete with an extra field (`title`, `groups` or `deleteCascade`) fails GraphQL validation
- [x] 3.6 A delete outside the caller's groups still fails with the group-check `ValidationError`
- [x] 3.7 The `_ENTERED_BY {type:"DELETE"}` audit edge points to the caller even when `enteredByPersonID` is supplied

## 4. Client (`pbot-client/src/components/Mutator.js`)

- [x] 4.1 In delete mode, declare `mutation ($data: DeleteInput!)` instead of `${entity}Input!`
- [x] 4.2 In delete mode, send `variables: {data: {pbotID: props.params.pbotID, cascade: props.params.cascade ?? false}}`. Check that every `*MutateResults` component passes `pbotID` in `params` for delete. `CharacterInstanceMutateResults` maps `characterInstance` to `pbotID`, so check it in particular.
- [x] 4.3 Skipped (decided not to do it): remove the stub fields from `CharacterInstanceDeleteDialog` in `CharacterAccordion.js:65-74`. Caveat: `CharacterInstanceMutateResults.js:13` calls `queryParams.state.split("~,")` without a guard, which is why the stub `state: "x~,y"` is there. Removing `state` without changing line 13 crashes the component with a `TypeError` before `Mutator` renders. Either guard line 13 (`queryParams.state?.split("~,")[1]`) or have the delete dialog render `Mutator` directly with `{pbotID}`.

## 5. Coordinated deploy

- [x] 5.1 Commit the API and client changes on their `ddm-dev` branches and push both
- [ ] 5.2 Dev: pull the API (PM2 restarts it) and deploy the client in the same session
- [ ] 5.3 Dev smoke test: delete the null-`purpose` Schema that failed before, try a cascade delete, delete a CharacterInstance, and check that a delete outside your groups is refused
- [ ] 5.4 Prod: deploy the API and client together and repeat the smoke test
