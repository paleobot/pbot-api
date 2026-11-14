## Why

Delete mutations have no group check. `permissions.js` requires only an authenticated admin, and registration grants admin, so any registered user can delete any record of any type in any group. The `mutation-group-authorization` capability (from `audit-mutation-group-authorization`, April 2026) protects create and group changes on update, but its audit never covered the `"delete"` branch of `mutateNode`. That leaves the most destructive write as the least protected. Deletes are soft (relabel to `_<Type>`, archive edges), but they still make a record disappear from every query.

This came up while fixing silent delete failures in the client (`pbot-client` change `fix-silent-delete-validation`). It needs to land before the planned delete-input change, which will make deletes easier to issue.

## What Changes

- `mutateNode`'s delete path verifies that the caller is `MEMBER_OF` **at least one** `Group` the target record is `ELEMENT_OF`, before checking blocking relationships and before any write. Otherwise it fails with a `ValidationError` and writes nothing.
- Policy for public records (decided): no special case. A record in `public` can be deleted by any member of `public`, which is nearly every registered user, as today. Private-group records become deletable only by members of their groups.
- Comments have no `ELEMENT_OF`, so they are checked against the groups of the Synonym at the root of their `REFERS_TO` thread.
- Records with no group to check against fail closed.
- Cascaded child deletes (server-internal recursion) skip the check, using a server-only flag on the same model as `groupCascade`. The children inherit their groups from the parent that was already checked.
- Person, Organ and PreservationMode deletes already always throw. No change.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mutation-group-authorization`: adds a requirement covering delete mutations (caller must share at least one group with the target; Comment resolved through its root Synonym; fail closed; skipped for internal cascades).

## Impact

- `Resolvers.js`: the `"delete"` case of `mutateNode`, plus a new helper next to `assertCallerCanWriteGroups`, and the cascade call site that recurses with `{pbotID, enteredByPersonID, cascade}`.
- No schema, input-type or client changes. The check reads only `data.pbotID` and the caller from `context.user`, so it works unchanged with the planned slim `DeleteInput`.
- Users get a new error when deleting outside their groups. `pbot-client`'s `Mutator` already displays mutation errors.
- Not in scope: field edits on public records (also open to everyone), the meaning of the `admin` role, and the comment-visibility audit in `audit-comment-group-inheritance`.
