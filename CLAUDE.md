# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`pbot-api` is the GraphQL API backend for PBOT (Paleobotany), a paleobotany data management platform. It serves a Neo4j graph database via Apollo Server using the `neo4j-graphql-js` library (a custom fork).

## Running the Server

```bash
node index.js
```

For full debug output:

```bash
DEBUG=pbot-api,neo4j-graphql-js node index.js
```

The server defaults to port `4001` and path `/graphql`. All configuration is via a `.env` file — copy `env.template` and fill in values:

```
NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE
JWT_SECRET, SALT_COUNT
EMAIL_ACCOUNT, EMAIL_PASSWORD
SITE_URL, GRAPHQL_SERVER_PORT, GRAPHQL_SERVER_HOST, GRAPHQL_SERVER_PATH
IMAGE_DIR, IMAGE_LINK_PRE
```

In production, PM2 is used (`ecosystem.config.cjs`) in watch mode — pushes to `master` deploy automatically via GitHub Actions SSH.

## Architecture

### Request Flow

1. **Express** handles HTTP, static file serving (`/files`), and REST endpoints
2. **Apollo Server** handles all GraphQL at `/graphql`
3. **`neo4j-graphql-js`** translates GraphQL operations to Cypher queries against Neo4j
4. **`graphql-shield`** enforces permissions (all queries are public; all mutations require authenticated admin)
5. **`graphql-middleware`** injects the authenticated user's `pbotID` into mutation `args.data.enteredByPersonID`

### Key Files

| File | Purpose |
|------|---------|
| `index.js` | Server entry point: wires Express, Apollo, Neo4j driver, auth, and all middleware |
| `schema.graphql` | Source of truth for all GraphQL types, queries, and mutations |
| `Resolvers.js` | Custom resolver logic — create/update/delete operations with Cypher, image upload |
| `SchemaMaps.js` | Defines `schemaMap` (field mappings for create/update) and `schemaDeleteMap` (blocking/cascade/nonblocking relationships per node type) |
| `permissions.js` | `graphql-shield` rules: queries are open, mutations require `isAuthenticated && isAdmin` |
| `UserManagement.js` | Login, registration, and password-reset flows via REST endpoints |
| `ImageManagement.js` | Image upload/serve via `/images` REST endpoints, auth-gated by group membership |

### Data Model (Neo4j Graph)

Core node types: `Person`, `Group`, `Reference`, `Schema`, `Character`, `State`, `Description`, `CharacterInstance`, `Specimen`, `Collection`, `OTU`, `Synonym`.

All data is scoped by **Groups** — a user's `cypherParams` inject a group membership prefix so queries only return data from groups the user belongs to.

Soft-delete pattern: deleted nodes have their label changed from `NodeType` to `_NodeType`, and relationships archived as `_RELATIONSHIP_TYPE` with an `ENTERED_BY {type:"DELETE"}` audit edge.

Every node tracks authorship via `ENTERED_BY` relationships to `Person`.

### Authentication

- REST: `POST /user/login` returns a JWT; clients send it as `Authorization: Bearer <token>`
- GraphQL context: JWT is decoded per-request to load the `Person` node (including roles) from Neo4j
- Roles stored as `(:Person)-[:HAS_ROLE]->(:Role {name})` nodes; `admin` role is required for all mutations

## `neo4j-graphql-js` Fork

This project uses a custom fork at `paleobot/neo4j-graphql-js` (`ddm-dev` branch), installed from GitHub:

```json
"neo4j-graphql-js": "git+https://github.com/paleobot/neo4j-graphql-js.git#ddm-dev"
```

The `overrides` field in `package.json` pins a single `graphql` version to prevent the "Cannot use GraphQLObjectType from another module" error.

**To iterate on the fork locally**, build a tarball (not a directory symlink — symlinks cause duplicate `graphql` module errors):

```bash
cd ~/repos/neo4j-graphql-js && npm run build && npm pack
# Then in pbot-api package.json:
"neo4j-graphql-js": "file:../neo4j-graphql-js/neo4j-graphql-js-2.19.4.tgz"
npm install
```

See `NEO4J-GRAPHQL-JS.md` for full details.

## Fuzzy Search

The `fuzzySurname` query uses a Neo4j fulltext index (`fuzzySurnameIndex` on `Person.surname`) with Lucene `~` fuzzy matching. The index must exist in the database. See `FUZZY_SEARCH.md` for architecture details and future improvement ideas.

## Tests

No automated test suite exists. The `test/` directory contains only a `mutation-params.cypher` file for manual Cypher testing.
