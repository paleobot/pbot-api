// Idempotent creation of all fulltext indexes used by the fuzzy search queries.
// Safe to re-run — IF NOT EXISTS prevents errors when indexes already exist.
//
// Run against each environment (dev, staging, prod) before deploying the
// fuzzy search queries. Can be executed statement-by-statement in Neo4j
// Browser or via cypher-shell.

CREATE FULLTEXT INDEX fuzzyPersonNameIndex IF NOT EXISTS
  FOR (n:Person) ON EACH [n.given, n.middle, n.surname];

CREATE FULLTEXT INDEX fuzzyReferenceTitleIndex IF NOT EXISTS
  FOR (n:Reference) ON EACH [n.title];

CREATE FULLTEXT INDEX fuzzySchemaTitleIndex IF NOT EXISTS
  FOR (n:Schema) ON EACH [n.title];

CREATE FULLTEXT INDEX fuzzyCollectionNameIndex IF NOT EXISTS
  FOR (n:Collection) ON EACH [n.name];

CREATE FULLTEXT INDEX fuzzyOTUNameIndex IF NOT EXISTS
  FOR (n:OTU) ON EACH [n.name];
