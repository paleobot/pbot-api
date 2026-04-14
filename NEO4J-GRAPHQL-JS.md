# neo4j-graphql-js Dependency

This project uses a fork of `neo4j-graphql-js` at
[paleobot/neo4j-graphql-js](https://github.com/paleobot/neo4j-graphql-js) (`ddm-dev` branch).

## Why a fork?
We needed a lot of custom code in the graphql to cypher conversion, particular around the use of groups in pbot. neo4j-graphql-js was the best option to build from at the time (it has since been deprecated).

## Why is it a problem (two of many reasons)
We want to run pbot-api on later versions of node. neo4j-graphql-js won't let us use anything later than v16.
This is because it depends on the monolithic
`graphql-tools` package, which transitively pulls in `@graphql-tools/links` →
`apollo-upload-client` → `extract-files`. The `extract-files` package has a
strict `exports` map that breaks on Node 17+, preventing the app from starting.

The fork replaces the `graphql-tools` dependency with only the scoped packages
actually used (`@graphql-tools/schema` and `@graphql-tools/utils`), eliminating
the problematic transitive chain.

Also, neo4j-graphql-js installs its own version of graphql, which causes problems in pbot-api if not installed properly. 

## Installing from GitHub (default)

This is the normal configuration for both local development and deployment:

```json
"neo4j-graphql-js": "git+https://github.com/paleobot/neo4j-graphql-js.git#ddm-dev"
```

npm clones the repo, builds it, and copies the result into `node_modules/`.
The `overrides` entry in `package.json` ensures a single `graphql` version
across the dependency tree.

## Installing from a local tarball (for iterating on the fork)

If you need to make and test changes to the fork locally:

1. Make your changes in `~/repos/neo4j-graphql-js`
2. Build and pack:
   ```bash
   cd ~/repos/neo4j-graphql-js
   npm run build
   npm pack
   ```
3. Update `package.json` in this project:
   ```json
   "neo4j-graphql-js": "file:../neo4j-graphql-js/neo4j-graphql-js-2.19.4.tgz"
   ```
4. Reinstall:
   ```bash
   npm install
   ```

The tarball approach copies the package into `node_modules/` (no symlink), which
avoids the duplicate `graphql` module issue that occurs with `file:` directory
references.

> **Note:** Do not use `"file:../neo4j-graphql-js"` (pointing at the directory).
> This creates a symlink, and Node resolves `graphql` from the clone's own
> `node_modules/`, resulting in two instances of `graphql` at runtime and a
> "Cannot use GraphQLObjectType from another module or realm" error.

Once your changes are verified, push the fork and switch back to the GitHub URL.
