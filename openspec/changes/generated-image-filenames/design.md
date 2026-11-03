## Context

`uploadFile(file, imagedID)` writes to `IMAGE_DIR/<imagedID>/<client filename>` and returns `link = IMAGE_LINK_PRE/<imagedID>/<encodeURIComponent(filename)>`. `UpdateImage` renames the old file to `<name>.sav`, uploads the new one, then deletes the `.sav` (or restores it on failure). `renameFile` derives the on-disk name from the stored `link`. The multipart parser (busboy) already strips directory components from filenames.

## Goals / Non-Goals

**Goals:** no name collisions; only image types stored; old files keep working.

**Non-Goals:** renaming or migrating existing files; image transcoding or validation of file contents (magic bytes).

## Decisions

### D1. `<uuid><ext>` with a mimetype allow-list

`crypto.randomUUID()` plus an extension looked up from `{image/jpeg: .jpg, image/png: .png, image/gif: .gif, image/webp: .webp, image/tiff: .tif}`. An unknown `mimetype` raises a `ValidationError` before any write. The client-supplied mimetype is trusted for choosing the extension only. Checking file contents (magic bytes) is a possible later step, but it's a non-goal here.

### D2. Keep the original name for display

Store the sanitized original filename (basename, with control characters stripped) as `Image.originalFilename` if the client shows it. Otherwise drop it. Decide after checking the client.

### D3. Backward compatibility

GET, `renameFile` and `deleteFile` already work with any valid basename, so old-style and new-style names coexist with no migration.

## Risks / Trade-offs

- [The client shows the filename taken from `link`] → Check `pbot-client` first and switch it to `originalFilename` if needed.
- [A legitimate image type is missing from the allow-list] → List the extensions present under the dev and prod `IMAGE_DIR` before finalizing.

## Migration Plan

Code only. Deploy to dev, then prod. Revert restores client-name storage, and files written under generated names keep working.

## Open Questions

- Which extensions exist on dev and prod today?
- Does the client display the filename anywhere?
