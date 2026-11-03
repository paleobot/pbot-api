## ADDED Requirements

### Requirement: The API SHALL declare a minimum Node.js version patched against CVE-2026-111497

`package.json` SHALL declare `engines.node` as `>=26.12.1`, and the repository SHALL contain an `.nvmrc` selecting Node 26.

#### Scenario: Engines field present
- **WHEN** `package.json` is inspected
- **THEN** `engines.node` is `>=26.12.1`

#### Scenario: nvm selects Node 26
- **WHEN** a developer runs `nvm use` in the repository root
- **THEN** a Node 26.x runtime is selected

### Requirement: The API SHALL boot and serve on the declared runtime

The API SHALL start without errors on Node ≥ 26.12.1 and SHALL emit no Node.js deprecation warnings at startup when run with `--trace-deprecation`.

#### Scenario: Clean boot on Node 26
- **WHEN** `node --trace-deprecation index.js` runs on Node 26.12.1 or later
- **THEN** the server logs that it is ready on the configured GraphQL path
- **AND** no `DeprecationWarning` or `ERR_*` errors appear in its output

### Requirement: Deployment SHALL refuse to proceed on an unpatched runtime

The deploy workflow SHALL check the Node.js version the API will run under on the target server and SHALL fail the deployment if it is below 26.12.1. The check SHALL compare the output of `node -v` and SHALL NOT rely on `process.versions.brotli`.

#### Scenario: Old runtime blocks deploy
- **WHEN** the deploy workflow runs and the target server's API runtime reports `v16.17.0`
- **THEN** the workflow step fails with a message naming the required minimum version

#### Scenario: Patched runtime passes
- **WHEN** the target server's API runtime reports `v26.13.0`
- **THEN** the version check step succeeds
