## 1. Fix the Specimen-side mapping

- [x] 1.1 In `SchemaMaps.js`, change the `Specimen.relationships` `DESCRIBED_BY` entry's `graphqlName` from `"descriptionID"` to `"descriptionIDs"` (keep `direction: "out"`, `required: false`, `updatable: true`)

## 2. Harden the Description side

- [x] 2.1 In `SchemaMaps.js`, set the `Description.relationships` `DESCRIBED_BY` entry's `required` to `true`
- [x] 2.2 In `schema.graphql`, change `DescriptionInput.specimenIDs` from `[String]` to `[String!]!`

## 3. Verify

- [x] 3.1 Edit a Specimen that has a Description (change only `name`/`notes`, submitting current `descriptionIDs`) and confirm the `DESCRIBED_BY` link survives _(verified via client)_
- [x] 3.2 Create a Specimen with no Description and confirm the mutation succeeds with no `DESCRIBED_BY` edge _(verified via client)_
- [x] 3.3 Create a Specimen with a `descriptionIDs` value and confirm the `DESCRIBED_BY` edge is created (create-path regression) _(verified via GraphQL: CreateSpecimen produced the DESCRIBED_BY edge; test specimen cleaned up)_
- [x] 3.4 Submit a `CreateDescription`/`UpdateDescription` with omitted, null, and empty `specimenIDs` and confirm each is rejected with no existing links deleted _(verified via GraphQL: omitted/null rejected at schema layer, empty rejected by resolver on both create and update; real description's link left intact)_
- [x] 3.5 Submit a `CreateDescription`/`UpdateDescription` with a non-empty `specimenIDs` and confirm the Description links to exactly those Specimens _(verified via client)_
- [x] 3.6 Confirm the normal client flow (Specimen edit and Description edit) behaves correctly end-to-end _(verified via client)_

## 4. Follow-up (out of scope — document only)

- [x] 4.1 Note the non-destructive-update redesign (only touch relationships whose field is explicitly present in the payload) as a separate proposed change, and flag whether an audit/remediation is needed for already-severed links — see `follow-up.md`
