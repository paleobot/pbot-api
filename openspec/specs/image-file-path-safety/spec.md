# image-file-path-safety Specification

## Purpose
Keep every image filesystem path built from request or stored data inside `IMAGE_DIR`, and require group access to the target specimen before any image file is written or renamed.
## Requirements
### Requirement: Image GET SHALL only serve files inside IMAGE_DIR

`GET /images/:pbotID/:image` SHALL serve a file only if the resolved path is inside the configured `IMAGE_DIR`, after URL decoding of both route parameters. Any request whose parameters resolve outside `IMAGE_DIR`, or whose `:image` is not a plain file name (contains `/`, `\`, NUL, or equals `.` / `..`), SHALL receive HTTP 404 and SHALL NOT cause a file read.

#### Scenario: Encoded traversal rejected
- **WHEN** an authenticated user with access to specimen `S` requests `/images/S/..%2F..%2F.env`
- **THEN** the response status is 404
- **AND** the response body does not contain the contents of any file outside `IMAGE_DIR`

#### Scenario: Backslash and dot names rejected
- **WHEN** a request is made for `/images/S/..` or `/images/S/..%5C..%5Cx`
- **THEN** the response status is 404

#### Scenario: Legitimate image still served
- **WHEN** an authenticated user with access to specimen `S` requests `/images/S/photo.png` and `IMAGE_DIR/S/photo.png` exists
- **THEN** the file is returned with status 200

#### Scenario: Group authorization still enforced
- **WHEN** a user without access to specimen `S` requests `/images/S/photo.png`
- **THEN** the response status is 401, as it is today

### Requirement: Uploads SHALL only write inside IMAGE_DIR

Image uploads (`UploadImage`, `CreateImage`, `UpdateImage`) SHALL validate the target ID (`specimenID` / `imageOf`) and SHALL NOT use the client-supplied filename as a path component. The resolved target directory and file SHALL be inside `IMAGE_DIR`. On failure, the mutation SHALL raise a `ValidationError`, and no directory or file SHALL be created.

#### Scenario: Traversal in target ID rejected
- **WHEN** an admin calls `UploadImage` with `specimenID: "../../tmp/x"`
- **THEN** the mutation fails with a `ValidationError`
- **AND** no directory outside `IMAGE_DIR` is created

#### Scenario: Traversal in filename neutralized
- **WHEN** an admin uploads a file whose multipart filename is `../../index.js`
- **THEN** the file is stored only under `IMAGE_DIR/<specimenID>/`, either as its base name (the multipart parser strips directory components) or rejected with a `ValidationError`
- **AND** no file outside that directory is created or overwritten

#### Scenario: Normal upload works
- **WHEN** an admin uploads `leaf.png` (`image/png`) for a valid specimen ID
- **THEN** the mutation returns a `link` that, fetched through the image GET route by an authorized user, returns the uploaded bytes

### Requirement: Image file writes SHALL require group access to the target specimen

Before writing, renaming or deleting any image file, `UploadImage`, `CreateImage` and `UpdateImage` SHALL verify that the caller is `MEMBER_OF` at least one `Group` that the target `Specimen` is `ELEMENT_OF`. For `UpdateImage`, this applies to the image's current specimen and to any new `imageOf` specimen. If the check fails, the mutation SHALL raise a `ForbiddenError`, and no file SHALL be created, overwritten, renamed or deleted.

#### Scenario: Upload to another group's specimen rejected
- **WHEN** an admin who is not a member of any group containing specimen `S` invokes `UploadImage` with `specimenID: S`
- **THEN** the mutation fails with a `ForbiddenError`
- **AND** no file under `IMAGE_DIR/S/` is created or overwritten

#### Scenario: CreateImage rejected before the file is written
- **WHEN** a non-member of `S`'s groups invokes `CreateImage` with an uploaded file and `imageOf: S`
- **THEN** the mutation fails with a `ForbiddenError`
- **AND** no file is written

#### Scenario: UpdateImage rejected before the old file is renamed
- **WHEN** a non-member of `S`'s groups invokes `UpdateImage` with an uploaded file for an Image of `S`
- **THEN** the mutation fails with a `ForbiddenError`
- **AND** the existing image file keeps its name and contents

#### Scenario: Member upload allowed
- **WHEN** a member of a group containing `S` invokes `UploadImage` with `specimenID: S`
- **THEN** the file is written under `IMAGE_DIR/S/`

#### Scenario: Uploaded file removed when CreateImage's mutation fails
- **WHEN** a member invokes `CreateImage` with an uploaded file and the subsequent node creation fails
- **THEN** the uploaded file is deleted

### Requirement: Image rename and delete SHALL only touch files inside IMAGE_DIR

`renameFile` and `deleteFile` SHALL resolve every path through the same containment check, and SHALL refuse (throwing an error, with no filesystem change) any path that resolves outside `IMAGE_DIR`, including a path derived from a stored `link` value.

#### Scenario: Malicious stored link cannot delete outside IMAGE_DIR
- **WHEN** an `Image` node's `link` is `http://host/images/x/..%2F..%2F..%2Fimportant` and an update that triggers rename/delete runs
- **THEN** the operation fails with an error
- **AND** no file outside `IMAGE_DIR` is renamed or deleted

