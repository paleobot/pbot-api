# runtime-baseline Specification

## Purpose
Declare and enforce a minimum Node.js runtime (26.12.1) patched against CVE-2026-111497, so the API refuses to run on an unpatched Node.
## Requirements
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

### Requirement: The API SHALL refuse to start on an unpatched runtime

On startup, before loading the rest of the application, the API SHALL compare `process.versions.node` against 26.12.1. If the running version is older, it SHALL log an error naming both the required minimum and the running version, and SHALL exit with a non-zero status without listening on any port. The check SHALL NOT rely on `process.versions.brotli`.

#### Scenario: Old runtime refuses to start
- **WHEN** `node index.js` is run with Node `v16.17.0`
- **THEN** the process logs an error containing `26.12.1` and `16.17.0`
- **AND** exits with a non-zero status
- **AND** the GraphQL port is not opened

#### Scenario: Patched runtime starts
- **WHEN** `node index.js` is run with Node `v26.13.0`
- **THEN** the version guard passes and the server starts normally

