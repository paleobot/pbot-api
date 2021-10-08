//This is a collection of cypher param statements to use in Neo4J Browser for testing mutation overrides.
//NOTE!: You'll need to update all of the id values for your database. 

//for Person
:params {data: {given: "dummy", surname: "dummy", email: "dummy@fake.com", orcid: "1234", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}


//for Reference
:params {data: {title: "dummy", year: "2021", publisher: "Noisy Flowers, LLC", doi: "", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}

//for Schema
:params {data: {title: "dummy", year: "2021", referenceID: "e7c91d44-52b9-4e90-95ab-05e49583097a", doi: "", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}

//for Character
:params {data: {name: "dummy", schemaID: "91fb4ed5-8ad2-4386-8ab1-526a6094c534", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}

//for State
:params {data: {name: "dummy", definition: "dummy", characterID: "4d085ca2-f4a6-44ee-bd8e-cf3608daf29d", parentStateID: null ,enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}
//and
:params {data: {name: "dummy", definition: "dummy", characterID: null, parentStateID: "93a552c7-54a8-4e2b-853e-03a5e4b2ebcb" ,enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}


//for Description
:params {data: {name: "dummy", family: "dummy", genus: "dummy", species: "dummy", type: "OTU", schemaID: "91fb4ed5-8ad2-4386-8ab1-526a6094c534", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}

//for CharacterInstance
:params {data: {characterID: "4d085ca2-f4a6-44ee-bd8e-cf3608daf29d", stateID: "e2fb2606-a822-4ac3-9b00-dc10e3fa00e4", descriptionID: "0488fe75-1c9a-441e-848b-d03a168d99b9", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}

//for Specimen
:params {data: {name: "dummy", descriptionID: "0488fe75-1c9a-441e-848b-d03a168d99b9", otuID: "62d4a307-5cfc-4f67-872f-ce5ebbfcd69e", organID: "379deaa7-837e-4ae0-934a-f3dd37597b31", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}

//for Organ
:params {data: {type: "dummy", enteredByPersonID: "71fbcbd1-1045-4973-8ef4-e653adcca572"}}


