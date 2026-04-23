# Tasks

**Status: OPEN — not scheduled.** Band-aid in place (`_CommentReferences` in `pbot-api/index.js` `skipPrefixNodeTypes`). Revisit when the band-aid list grows, or when we have appetite for fork work.

## Fork work (`neo4j-graphql-js`)

- [ ] In `src/translate/translate.js` `relationTypeFieldOnNodeType` (non-reflexive branch), compute `endpointTypeName` from `selectsOutgoingField || isFromField ? toTypeName : fromTypeName`.
- [ ] Introduce `endpointVar = ``${nestedVariable}_endpoint``` and bind it in the emitted list-comprehension pattern in place of the anonymous `(:Label)` node on the far side.
- [ ] Rewrite the `additionalWhereClause` call to pass `safeLabel([endpointTypeName, ...getAdditionalLabels(...)])` as `typeName` and `safeVar(endpointVar)` as `variableName`.
- [ ] Add a test case: relation-payload field on a parent type whose schema does NOT include `[:ELEMENT_OF]`, under a top-level query whose type is NOT in `skipPrefixNodeTypes`. Assert the generated Cypher filters the endpoint node (not the parent).
- [ ] Add a reflexive-relation smoke test (`Comment.comments` self-reference) to confirm the reflexive branch is untouched.
- [ ] Run the full fork test suite; verify no regressions.
- [ ] `npm run build && npm pack`, publish to the `ddm-dev` branch, or cut a new SHA pin.

## `pbot-api` consumption

- [ ] Bump `"neo4j-graphql-js"` in `package.json` to the new fork SHA.
- [ ] `npm install` and verify no duplicate-`graphql` errors.
- [ ] Remove `"_CommentReferences"` from `cypherParams.skipPrefixNodeTypes` in `index.js:173`.
- [ ] Remove any other `_<Parent><FieldName>` band-aid entries added in the interim.
- [ ] Manually verify the two queries from the proposal (top-level `Comment`, nested `Synonym → comments → references`) return the same `references` payload.
- [ ] Manually verify `Comment.enteredBy` and `Comment.comments` still return correctly under nested selection.

## Documentation

- [ ] Update `NEO4J-GRAPHQL-JS.md` with a note on the fix and which commit landed it.
- [ ] Leave a short comment near `skipPrefixNodeTypes` in `index.js` explaining the list is now purely for node-type skips (no synthesized relation-payload names should need to appear there post-fix).
