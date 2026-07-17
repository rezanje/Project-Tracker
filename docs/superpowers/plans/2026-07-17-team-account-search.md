# Team Panel Account Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner find and add an existing approved account by live name/email search, right in the same "Invite member" box that already handles exact-email invites.

**Architecture:** Two new pure helpers in `src/lib/workspaces.ts` (service-role client, matching `inviteWorkspaceMember`'s style), wrapped by two owner-gated `createServerFn`s in `src/routes/workspace.$workspaceId.tsx` (matching `inviteTeamFn`'s exact owner-check shape). `TeamPanel.tsx` stays 100% prop-driven (no server-fn imports) — it gets two new callback props (`onSearchAccounts`, `onAddMember`) and owns the debounce + dropdown UI itself.

**Tech Stack:** TanStack Start (React) + Supabase (Postgres + RLS), Vitest integration tests against the real remote DB.

**Spec:** `docs/superpowers/specs/2026-07-17-team-account-search-design.md`

---

## File Structure

- **Modify** `src/lib/workspaces.ts` — add `AddableAccount` type + `searchAddableAccounts` + `addExistingWorkspaceMember` pure helpers.
- **Create** `src/lib/workspaces.test.ts` — integration tests for the two new helpers (no test file exists for this lib yet).
- **Modify** `src/routes/workspace.$workspaceId.tsx` — add `searchAccountsFn`/`addMemberFn` server-fn wrappers, an `onAddMember`/`onSearchAccounts` handler pair in the `Home` component, and thread both into the existing `<TeamPanel>` invocation.
- **Modify** `src/components/TeamPanel.tsx` — add `onSearchAccounts`/`onAddMember` props, debounced search state, and a results dropdown under the invite input.

---

## Task 1: Core helpers in `workspaces.ts` (TDD)

**Files:**
- Modify: `src/lib/workspaces.ts`
- Test: `src/lib/workspaces.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workspaces.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { searchAddableAccounts, addExistingWorkspaceMember } from './workspaces'

const env = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function makeApprovedUser(prefix: string, name: string) {
  const email = `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name },
  })
  const uid = u.user!.id
  await admin.from('profiles').update({ status: 'approved', name }).eq('id', uid)
  return { uid, email }
}

async function makeWorkspace(ownerId: string) {
  const { data: ws } = await admin
    .from('workspaces')
    .insert({ name: `ws-${Date.now()}`, owner_id: ownerId })
    .select('id')
    .single()
  return ws!.id as string
}

async function cleanup(wsId: string, ...uids: string[]) {
  await admin.from('workspaces').delete().eq('id', wsId)
  for (const uid of uids) await admin.auth.admin.deleteUser(uid)
}

test('searchAddableAccounts finds an approved user by partial name match', async () => {
  const owner = await makeApprovedUser('search-owner', 'Search Owner')
  const target = await makeApprovedUser('search-target', 'ZzzSearchTarget Testerson')
  const wsId = await makeWorkspace(owner.uid)
  try {
    const results = await searchAddableAccounts(admin, wsId, 'zzzsearchtarget')
    expect(results.some((r) => r.id === target.uid)).toBe(true)
    expect(results.some((r) => r.id === target.uid && r.name === 'ZzzSearchTarget Testerson')).toBe(true)
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)

test('searchAddableAccounts excludes a user already a member of the workspace', async () => {
  const owner = await makeApprovedUser('search-owner2', 'Search Owner2')
  const target = await makeApprovedUser('search-member', 'ZzzAlreadyMember Testerson')
  const wsId = await makeWorkspace(owner.uid)
  try {
    await admin.from('workspace_members').insert({ workspace_id: wsId, user_id: target.uid, role: 'member' })
    const results = await searchAddableAccounts(admin, wsId, 'zzzalreadymember')
    expect(results.some((r) => r.id === target.uid)).toBe(false)
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)

test('searchAddableAccounts returns [] for a 1-character query', async () => {
  const owner = await makeApprovedUser('search-owner3', 'Search Owner3')
  const wsId = await makeWorkspace(owner.uid)
  try {
    const results = await searchAddableAccounts(admin, wsId, 'z')
    expect(results).toEqual([])
  } finally {
    await cleanup(wsId, owner.uid)
  }
}, 30000)

test('addExistingWorkspaceMember inserts a workspace_members row with role member', async () => {
  const owner = await makeApprovedUser('add-owner', 'Add Owner')
  const target = await makeApprovedUser('add-target', 'Add Target')
  const wsId = await makeWorkspace(owner.uid)
  try {
    await addExistingWorkspaceMember(admin, wsId, target.uid)
    const { data: row } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', wsId)
      .eq('user_id', target.uid)
      .single()
    expect(row?.role).toBe('member')
  } finally {
    await cleanup(wsId, owner.uid, target.uid)
  }
}, 30000)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- workspaces`
Expected: FAIL — `searchAddableAccounts`/`addExistingWorkspaceMember` don't exist yet (import error).

- [ ] **Step 3: Implement the helpers**

In `src/lib/workspaces.ts`, add after the `TeamMember` type and before `listWorkspaceMembers` (or anywhere after the imports — exact position doesn't matter, just keep it with the other exported helpers):

```ts
export type AddableAccount = { id: string; name: string; avatar_url: string | null }

/**
 * Approved accounts matching `query` by name or email, excluding anyone already
 * a member of `workspaceId`. Needs a service-role client (email lives in Auth,
 * not `profiles`, same as `inviteWorkspaceMember`/`listWorkspaceMembers`).
 * ponytail: auth.admin.listUsers() scans every account for the email match —
 * fine at this app's user count; paginate or add a server-side email index if
 * it ever gets slow.
 */
export async function searchAddableAccounts(
  svc: SupabaseClient,
  workspaceId: string,
  query: string,
): Promise<AddableAccount[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const { data: memberRows } = await svc
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
  const existingIds = new Set((memberRows ?? []).map((m) => m.user_id as string))

  const { data: byName } = await svc
    .from('profiles')
    .select('id,name,avatar_url')
    .eq('status', 'approved')
    .ilike('name', `%${q}%`)
    .limit(8)

  const { data: users } = await svc.auth.admin.listUsers()
  const emailMatchIds = users.users
    .filter((u) => u.email?.toLowerCase().includes(q.toLowerCase()))
    .map((u) => u.id)
  const { data: byEmail } = emailMatchIds.length
    ? await svc
        .from('profiles')
        .select('id,name,avatar_url')
        .eq('status', 'approved')
        .in('id', emailMatchIds)
        .limit(8)
    : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> }

  const merged = new Map<string, AddableAccount>()
  for (const p of [...(byName ?? []), ...(byEmail ?? [])]) {
    if (existingIds.has(p.id as string)) continue
    if (!merged.has(p.id as string)) {
      merged.set(p.id as string, { id: p.id as string, name: (p.name as string | null) ?? 'Unknown', avatar_url: (p.avatar_url as string | null) ?? null })
    }
  }
  return [...merged.values()].slice(0, 8)
}

/** Add an existing account straight into a workspace (no token/email round-trip). */
export async function addExistingWorkspaceMember(
  svc: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await svc
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userId, role: 'member' })
  if (error) throw error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- workspaces`
Expected: `Tests 4 passed (4)`. If a test fails on logic (not a missing-table/import error), fix the helper — do not weaken the test.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspaces.ts src/lib/workspaces.test.ts
git commit -m "feat(workspaces): add account search + direct-add helpers"
```

---

## Task 2: Server-fn wrappers + parent wiring

**Files:**
- Modify: `src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Add the import**

In `src/routes/workspace.$workspaceId.tsx`, extend the existing `#/lib/workspaces` import block (currently at line 8-14):

```ts
import {
  inviteWorkspaceMember,
  listWorkspaceMembers,
  setWorkspaceMemberRole,
  removeWorkspaceMember,
  searchAddableAccounts,
  addExistingWorkspaceMember,
  type TeamMember,
  type AddableAccount,
} from '#/lib/workspaces'
```

- [ ] **Step 2: Add the two server fns**

Add these directly after the existing `inviteTeamFn` definition (so they sit with the other team-management server fns in this file):

```ts
const searchAccountsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { workspaceId, query } = (d ?? {}) as { workspaceId?: unknown; query?: unknown }
    if (typeof workspaceId !== 'string' || typeof query !== 'string')
      throw new Error('workspaceId and query required')
    return { workspaceId, query }
  })
  .handler(async ({ data }): Promise<AddableAccount[]> => {
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

- [ ] **Step 3: Add the parent handlers**

In the `Home` component, directly after the existing `onRemoveMember` function (which sits right after `refreshTeam`), add:

```ts
  async function onAddMember(userId: string) {
    setTeamBusy(true)
    try {
      await addMemberFn({ data: { workspaceId, userId } })
      await refreshTeam()
    } finally {
      setTeamBusy(false)
    }
  }
  async function onSearchAccounts(query: string): Promise<AddableAccount[]> {
    return searchAccountsFn({ data: { workspaceId, query } })
  }
```

- [ ] **Step 4: Wire the props into `<TeamPanel>`**

In the `<TeamPanel>` invocation (currently ending with `inviteLink={invLink}` around line 506), add two more props before the closing `/>`:

```tsx
          inviteLink={invLink}
          onSearchAccounts={onSearchAccounts}
          onAddMember={onAddMember}
        />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: errors referencing `TeamPanel` missing props `onSearchAccounts`/`onAddMember` — this is expected until Task 3 adds them. Confirm the errors are ONLY about `TeamPanel`'s prop types (nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add "src/routes/workspace.\$workspaceId.tsx"
git commit -m "feat(workspace): add search/add-member server fns and wiring"
```

(Task 3 makes the build green again — committing here is fine since this is an internal WIP checkpoint, not a shipped state.)

---

## Task 3: `TeamPanel.tsx` search UI

**Files:**
- Modify: `src/components/TeamPanel.tsx`

- [ ] **Step 1: Add the new props to the `Props` interface**

In `src/components/TeamPanel.tsx`, extend the `import type` line and `Props` interface:

```ts
import type { TeamMember, AddableAccount } from '#/lib/workspaces'
```

```ts
interface Props {
  members: TeamMember[]
  meId: string
  busy: boolean
  onSetRole: (userId: string, role: 'owner' | 'member') => void
  onRemove: (userId: string) => void
  onClose: () => void
  assignedKpis: AssignedKpi[]
  assignedObjectives: AssignedObjective[]
  onAssignKpi: (assigneeId: string, name: string, target: number, unit: string, startDate: string, endDate: string) => void
  onReviewKpi: (checkinId: string, approve: boolean) => void
  onReviewKr: (checkinId: string, approve: boolean) => void
  onDeleteKpi: (id: string) => void
  onDeleteObjective: (id: string) => void
  onAssignObjective: (assigneeId: string, title: string, startDate: string, endDate: string) => void
  onAddKeyResult: (objectiveId: string, title: string, target: number) => void
  inviteEmail: string
  onInviteEmailChange: (email: string) => void
  onInvite: () => void
  inviteMessage: string | null
  inviteLink: string | null
  onSearchAccounts: (query: string) => Promise<AddableAccount[]>
  onAddMember: (userId: string) => Promise<void>
}
```

- [ ] **Step 2: Destructure the new props and add debounced-search state**

Change the function signature and add state right after `const isOwner = ...`:

```tsx
export default function TeamPanel({
  members, meId, busy, onSetRole, onRemove, onClose,
  assignedKpis, assignedObjectives, onAssignKpi, onReviewKpi, onReviewKr, onDeleteKpi, onDeleteObjective,
  onAssignObjective, onAddKeyResult,
  inviteEmail, onInviteEmailChange, onInvite, inviteMessage, inviteLink,
  onSearchAccounts, onAddMember,
}: Props) {
  const isOwner = members.find((m) => m.user_id === meId)?.role === 'owner'
  const [searchResults, setSearchResults] = useState<AddableAccount[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = inviteEmail.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const results = await onSearchAccounts(q)
      setSearchResults(results)
      setSearching(false)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteEmail])

  async function handleAdd(userId: string) {
    await onAddMember(userId)
    onInviteEmailChange('')
    setSearchResults([])
  }

  return (
```

- [ ] **Step 3: Update the imports for `useState`/`useEffect`/`useRef`**

Change the top import line from:

```ts
import { useState } from 'react'
```

to:

```ts
import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 4: Render the dropdown under the invite input**

Replace the existing invite block (the `{isOwner && (...)}` section) with:

```tsx
        {isOwner && (
          <div className="mb-4 border-t border-[var(--line)] pt-4">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
              Invite member
            </p>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="name or email…"
                  value={inviteEmail}
                  onChange={(e) => onInviteEmailChange(e.target.value)}
                  className="field flex-1 text-[13px]"
                />
                <button type="button" onClick={onInvite} className="btn btn-ghost btn-square px-3 text-xs">
                  Invite
                </button>
              </div>
              {(searching || searchResults.length > 0) && (
                <div className="absolute left-0 right-[86px] top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-[12px] border border-[var(--line)] bg-[var(--card)] shadow-[0_12px_30px_-10px_rgba(16,28,22,0.35)]">
                  {searching && (
                    <p className="px-3 py-2 text-xs text-[var(--ink3)]">Searching…</p>
                  )}
                  {!searching && searchResults.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleAdd(a.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-white">
                        {initials(a.name, null)}
                      </span>
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {inviteMessage && <p className="mt-1 text-xs font-semibold text-[var(--accent-ink)]">{inviteMessage}</p>}
            {inviteLink && (
              <input
                readOnly
                value={inviteLink}
                onFocus={(e) => e.target.select()}
                className="field mt-1 w-full text-[11px]"
              />
            )}
          </div>
        )}
```

- [ ] **Step 5: Update the `<TeamPanel>` invocation's caller — nothing else to do**

Task 2 already added `onSearchAccounts`/`onAddMember` to the invocation. No further change needed here.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no output (clean) — this closes out the type errors from Task 2 Step 5.

- [ ] **Step 7: Commit**

```bash
git add src/components/TeamPanel.tsx
git commit -m "feat(team-panel): live account search dropdown alongside email invite"
```

---

## Task 4: Browser verification

**Files:** none (verification only)

- [ ] **Step 1: Open the app and the Team panel**

Ensure the dev preview is running (`preview_start` with `{ name: "rakit-dev" }` if not already). Navigate to a workspace you own, click **Manage** to open the Team panel.

- [ ] **Step 2: Verify search-and-add**

- Type 1 character in the invite input → confirm no dropdown appears (below the 2-char threshold).
- Type 2+ characters matching an existing approved user's name (not yet a member of this workspace) → confirm a "Searching…" flash then a dropdown row with their name appears.
- Click the row → confirm it disappears, the input clears, and the member list above now includes that person with role "Member".
- Type a name with no matches → confirm the dropdown does not render (not stuck on "Searching…").

- [ ] **Step 3: Verify the exact-email invite path still works unchanged**

- Type a full email of a non-member (or a fresh one) and click **Invite** (not a dropdown row) → confirm the existing "Added to workspace as member." or "Invite created. Share the link." message still appears exactly as before.

- [ ] **Step 4: Check for console/server errors**

`read_console_messages` (onlyErrors) and `preview_logs` (error) → expect no new errors introduced by this change (ignore the pre-existing unrelated "uncontrolled input" warning on this route, noted separately).

- [ ] **Step 5: Screenshot for proof**

Take a `computer{action:"screenshot"}` of the Team panel with the dropdown open, showing a real matched account.

---

## Self-review notes

- **Spec coverage:** `AddableAccount` type + both pure helpers + owner-gated server fns + dropdown UI + exact-email fallback preserved + 4 helper tests — all present across Tasks 1–3. The spec's "results expose only name + avatar_url, never email" requirement is satisfied — `AddableAccount` has no `email` field, and neither helper nor the dropdown ever surfaces one.
- **Deviation from spec (intentional, noted in Architecture):** the spec sketched `searchAccountsFn`/`addMemberFn` as directly callable and `workspaceId` threaded into `TeamPanel` as a prop. This plan instead keeps `TeamPanel` fully prop/callback-driven (`onSearchAccounts`, `onAddMember`) with `workspaceId` staying only in the parent — matching `TeamPanel`'s existing 100%-callback design (it has zero server-fn imports today) and the codebase's established route-owns-server-fns / component-owns-callbacks split.
- **Type consistency:** `AddableAccount` defined once in Task 1 (`src/lib/workspaces.ts`), imported unchanged in Task 2 (route) and Task 3 (`TeamPanel`). `onAddMember(userId: string): Promise<void>` and `onSearchAccounts(query: string): Promise<AddableAccount[]>` signatures match between the Task 2 parent implementation (both `async function`s) and the Task 3 prop declarations exactly.
