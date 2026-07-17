# Team panel — search-to-add accounts (alongside email invite)

**Date:** 2026-07-17
**Status:** Approved

## Problem

`TeamPanel`'s "Invite member" box only accepts an exact email address
(`inviteTeamFn` → `inviteWorkspaceMember`): existing user with that exact email is
added immediately; otherwise a pending invite + signup link is created. There's no
way to find someone by name, or to discover an account you already collaborate with
in another workspace, without knowing their exact email.

## Scope

Add a live name/email search to the same "Invite member" input. Typing shows a
dropdown of matching approved accounts (not yet a member of this workspace);
clicking a result adds them instantly — no token, no email round-trip. The existing
exact-email "Invite" button behavior is unchanged and stays as the fallback for
inviting someone with no account yet or not found by search.

Search reach: all `status = 'approved'` accounts in the app (owner's explicit
choice — broader than "people I already share a workspace with"). Search results
expose only `name` + `avatar_url`, never email, to limit what an owner can see about
unrelated users.

Out of scope: changing the pending-invite/token flow, editing roles, anything in
Phase 2/3 of unrelated features.

## Data model

No migration needed. `profiles(id, name, avatar_url, status)` already exists; email
lives only in Supabase Auth, read via `service.auth.admin.listUsers()` — the same
mechanism `inviteWorkspaceMember`/`listWorkspaceMembers` already use.

## Server functions — `src/lib/workspaces.ts`

Two new pure helpers (service-role client, matching `inviteWorkspaceMember`'s
signature style), plus `createServerFn` wrappers in
`src/routes/workspace.$workspaceId.tsx` next to `inviteTeamFn`.

### `searchAddableAccounts(svc, workspaceId, query): Promise<{ id: string; name: string; avatar_url: string | null }[]>`

- Return `[]` immediately if `query.trim().length < 2`.
- Fetch current member ids: `workspace_members.select('user_id').eq('workspace_id', workspaceId)` →
  a `Set<string>` to exclude.
- Name match: `profiles.select('id,name,avatar_url').eq('status','approved').ilike('name', \`%${query}%\`).limit(8)`.
- Email match: `svc.auth.admin.listUsers()`, filter `u.email?.toLowerCase().includes(query.toLowerCase())`,
  map matched ids, then fetch those profiles filtered to `status = 'approved'`.
- Merge both result sets, dedupe by `id`, drop ids already in the member-id set, cap
  at 8 total.
- `// ponytail: auth.admin.listUsers() scans every account for the email match —
  fine at this app's user count; paginate or add a server-side email index if it
  ever gets slow.`

### `addExistingWorkspaceMember(svc, workspaceId, userId): Promise<void>`

- `svc.from('workspace_members').insert({ workspace_id: workspaceId, user_id: userId, role: 'member' })`.
- No dedupe check needed — `workspace_members` PK is `(workspace_id, user_id)`, so a
  double-add surfaces as a normal insert error the caller already handles as
  "failed" (matches existing `onInviteTeam` catch-and-message pattern).

## Server fn wrappers — `src/routes/workspace.$workspaceId.tsx`

Both follow `inviteTeamFn`'s exact owner-check shape (`requireUser` → look up the
caller's `workspace_members.role` for this workspace → `throw new Error('forbidden')`
if not `'owner'`) before delegating to the service-role helper.

```ts
const searchAccountsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, query } = (d ?? {}) as { workspaceId?: unknown; query?: unknown }
    if (typeof workspaceId !== 'string' || typeof query !== 'string')
      throw new Error('workspaceId and query required')
    return { workspaceId, query }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', data.workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (wm?.role !== 'owner') throw new Error('forbidden')
    const results = await searchAddableAccounts(getServiceSupabase(), data.workspaceId, data.query)
    flush(headers)
    return results
  })

const addMemberFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, userId } = (d ?? {}) as { workspaceId?: unknown; userId?: unknown }
    if (typeof workspaceId !== 'string' || typeof userId !== 'string')
      throw new Error('workspaceId and userId required')
    return { workspaceId, userId }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', data.workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (wm?.role !== 'owner') throw new Error('forbidden')
    await addExistingWorkspaceMember(getServiceSupabase(), data.workspaceId, data.userId)
    flush(headers)
    return { ok: true }
  })
```

## UI — `TeamPanel.tsx`'s existing "Invite member" block

The invite `<input>` becomes dual-purpose:

- `onChange`: update `inviteEmail` (existing prop/state, unchanged) **and** debounce
  (250ms) a call to `searchAccountsFn({ workspaceId, query: value })` when
  `value.trim().length >= 2`; otherwise clear results with no call.
- Results render as a dropdown list directly under the input (avatar + name,
  `.card`-consistent styling, matches board member row style already in
  `TeamPanel.tsx`). Clicking a row calls a new `onAddMember(userId: string)` prop —
  matching how `onSetRole`/`onRemove` are already parent-owned callbacks, not direct
  server-fn calls from inside `TeamPanel`. The parent implements it exactly like
  `onSetRole`/`onRemoveMember`: call `addMemberFn({ data: { workspaceId, userId } })`
  then `await refreshTeam()` (the existing no-arg refetch-and-set-members function),
  wrapped in the same `setTeamBusy(true/false)` pattern. `TeamPanel` clears the
  input + dropdown once the call resolves.
- The "Invite" button keeps its current behavior/handler (`onInvite`) untouched —
  exact-email path is a separate, explicit action from clicking a dropdown row.
- Dropdown shows a "Searching…" state during the debounced fetch and hides when the
  input is cleared or a row is clicked.
- `workspaceId` needs threading into `TeamPanel` as a new required prop (it isn't
  currently passed — the component only receives `members`/`meId`/invite state).

## Error handling

- `searchAccountsFn`/`addMemberFn` both throw `'forbidden'` for non-owners — the
  dropdown/add action simply won't be reachable in the UI for non-owners (the whole
  invite block is already gated by the panel's local `isOwner` check), but the
  server-side check is the real boundary, matching `inviteTeamFn`'s existing pattern.
- A failed `addMemberFn` (e.g. race where the target was already added by another
  action) shows the same inline error text pattern already used for failed email
  invites (`invMsg` equivalent, or a small local error state in the dropdown).

## Testing

Add `src/lib/workspaces.test.ts` (new — no existing test file for this lib) covering
the two new pure helpers against the real remote DB, following the
`makeSignedInUser`/service-role-admin harness pattern from `src/lib/notes.test.ts`:

- `searchAddableAccounts` finds an approved user by partial name match.
- `searchAddableAccounts` excludes a user who is already a member of the target
  workspace.
- `searchAddableAccounts` returns `[]` for a 1-character query.
- `addExistingWorkspaceMember` inserts a `workspace_members` row with role `'member'`.
