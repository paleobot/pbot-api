## Why

Every delete mutation takes the same input type as create and update (for example `DeleteSchema(data: SchemaInput!)`). GraphQL validates that input's required fields before any resolver runs. A record that is missing one of them therefore can't be deleted. On dev, deleting a Schema with no `purpose` fails with:

```
Variable "$data" got invalid value null at "data.purpose";
Expected non-nullable type "String!" not to be null.
```

We found this because of dirty test data on dev: a Schema with no `purpose`. The same failure could happen in production whenever entity fields change. Any time a field is made required, or a new required field is added, every existing record without a value for it can no longer be deleted, until someone backfills the data or deletes the record by hand in Neo4j.

The delete path only reads `pbotID`, `cascade` and the server-injected `enteredByPersonID`. Requiring the full entity input blocks valid deletes and forces the client to send stub data (for example `CharacterAccordion.js` fills in `character: "x"`, `state: "x~,y"`).

## What Changes

- Add a `DeleteInput` input type to `schema.graphql` with `pbotID: String!`, `cascade: Boolean` and `enteredByPersonID: String`, which the server sets.
- **BREAKING**: Switch the 13 deletes that go through `mutateNode` from their entity input to `data: DeleteInput!`: `DeleteReference`, `DeleteSchema`, `DeleteCharacter`, `DeleteState`, `DeleteDescription`, `DeleteCharacterInstance`, `DeleteOTU`, `DeleteSynonym`, `DeleteComment`, `DeleteSpecimen`, `DeleteCollection`, `DeleteGroup` and `DeleteImage`. Clients that declare `$data: <Entity>Input!` for these mutations will fail validation.
- Keep the `data:` argument wrapper, because `addUserID` writes `args.data.enteredByPersonID`.
- In `mutateNode`, skip the OTU create/update pre-checks for deletes. They read `data.typeSpecimens` unguarded and would throw on a slim delete payload.
- Leave `DeletePerson`, `DeleteOrgan` and `DeletePreservationMode` unchanged. They always refuse deletes.
- Client (`pbot-client`, sibling repo): `Mutator.js` declares `$data: DeleteInput!` for delete mode and sends only `{pbotID, cascade}`.

## Capabilities

### New Capabilities
- `delete-mutation-input`: The input contract for delete mutations. Deletes accept only an identifier, a cascade flag and the server-set author. A record's other field values don't affect whether it can be deleted.

### Modified Capabilities
- `mutation-group-authorization`: The delete group check itself is unchanged. The "caller-supplied groups are ignored" scenario now fails earlier, at GraphQL validation, because `DeleteInput` has no `groups` field.

## Impact

- **API**: `schema.graphql` (new input, 13 mutation signatures), `Resolvers.js` (`mutateNode` OTU pre-check guard).
- **Client**: `pbot-client/src/components/Mutator.js`. Optionally, the stub fields in `CharacterAccordion.js` can then be removed.
- **Deploy**: breaking in both directions. The old client fails against the new API and the new client fails against the old API. The API and client must go to dev together, then to prod together.
- **Unchanged**: the group delete check (`assertCallerCanDelete`, from `586de26`), the UUID validation in `assertMutationIDs`, and internal cascade deletes, which already pass a slim object.
- **Noted gap, out of scope**: `DeleteFeature` (`schema.graphql:1220`) is declared `@neo4j_ignore` but has no resolver in `Resolvers.js`.
