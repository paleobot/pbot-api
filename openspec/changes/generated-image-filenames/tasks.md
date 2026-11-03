## 1. Investigation

- [ ] 1.1 List the file extensions present under the dev and prod `IMAGE_DIR`; finalize the mimetype allow-list
- [ ] 1.2 Check whether `pbot-client` displays the filename or depends on it appearing in `link`

## 2. Implementation

- [ ] 2.1 `uploadFile`: generate `<uuid><ext>` from the mimetype allow-list; raise `ValidationError` for other types before any write
- [ ] 2.2 If the client needs it (1.2): store a sanitized `originalFilename` on the Image node (`schema.graphql`, `SchemaMaps.js`)

## 3. Verification and rollout

- [ ] 3.1 Verify the spec scenarios: no collision, traversal filename ignored, HTML rejected, old-style image fetch/update/delete
- [ ] 3.2 Deploy to dev, then prod
