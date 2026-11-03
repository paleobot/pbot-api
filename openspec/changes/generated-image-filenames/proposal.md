## Why

Uploaded images are stored under their client-supplied filename (`ImageManagement.js`, "Not worrying about collisions for now"). That causes two problems:
- Two images of the same specimen with the same filename overwrite each other on disk.
- Any extension can be uploaded and is then served with a matching content type, e.g. `.html` or `.js`. The risk is limited because the image GET route requires a bearer header, but it shouldn't be possible.

`harden-image-upload-and-cypher` already contains upload paths inside `IMAGE_DIR` and adds group authorization. This change fixes how files are named.

## What Changes

- Store new uploads as `<uuid><ext>`, with the extension chosen from an allow-list based on the upload's `mimetype` (jpeg, png, gif, webp, tiff). Reject other types with a `ValidationError`.
- Keep the sanitized original filename as a display property on the `Image` node.
- Leave existing files and `link`s unchanged; rename, delete and GET must keep working for old-style names.

## Capabilities

### New Capabilities
- `image-upload-storage-naming`: uploads are stored under server-generated names with allow-listed image extensions.

### Modified Capabilities
<!-- None. -->

## Impact

- **Code:** `ImageManagement.js` (`uploadFile`), possibly `schema.graphql` and `SchemaMaps.js` (`Image.originalFilename`).
- **Client:** `pbot-client` must not depend on the original filename appearing in `link`; to be checked.
- **Data:** none migrated.
