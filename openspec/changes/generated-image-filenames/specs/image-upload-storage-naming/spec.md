## ADDED Requirements

### Requirement: Uploads SHALL be stored under server-generated names

Image uploads (`UploadImage`, `CreateImage`, `UpdateImage`) SHALL store the file as `IMAGE_DIR/<specimenID>/<uuid><ext>`, where `<uuid>` is freshly generated and `<ext>` comes from the upload's allow-listed mimetype. The client-supplied filename SHALL NOT be used as a path component.

#### Scenario: Same filename uploaded twice does not collide
- **WHEN** two images named `leaf.png` are uploaded for the same specimen
- **THEN** both files exist on disk under different names
- **AND** each `link` returns its own bytes

#### Scenario: Traversal in client filename has no effect
- **WHEN** an upload's multipart filename is `../../index.js` with mimetype `image/png`
- **THEN** the file is stored as `<uuid>.png` inside the specimen directory

### Requirement: Only allow-listed image types SHALL be stored

An upload whose mimetype is not one of `image/jpeg`, `image/png`, `image/gif`, `image/webp` or `image/tiff` SHALL be rejected with a `ValidationError` before anything is written.

#### Scenario: HTML upload rejected
- **WHEN** a file is uploaded with mimetype `text/html`
- **THEN** the mutation fails with a `ValidationError`
- **AND** no file is written

### Requirement: Existing client-named files SHALL keep working

Images stored under client-supplied names before this change SHALL remain retrievable, updatable and deletable.

#### Scenario: Old-style image still served and updatable
- **WHEN** an Image whose `link` ends in `/mars_2.jpg` is fetched, then updated with a new upload
- **THEN** the fetch returns 200, the update succeeds, and the old file is removed
