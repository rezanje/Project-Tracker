# Signup Approval Gate + Super Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Self-signup accounts (no invite link) start `pending` and can't access
anything until the app's single super admin (`rezarezanje@gmail.com`) approves
them by granting a workspace or board role. Invited accounts keep working
exactly as they do today (auto-approved on invite acceptance).

**Architecture:** Add `status`/`is_super_admin` columns to `profiles`. A pure
`assertApproved` guard, called from the existing `requireUser` server helper,
redirects pending non-admin users to a new `/pending` page — this single choke
point (already used by every protected route) closes off workspace/board
creation and access. A new `/admin/approvals` page (super-admin-only) lists
pending signups and lets the admin grant one workspace or board membership per
click, which flips the profile to `approved`.

**Tech Stack:** TanStack Start server functions, Supabase (Postgres + RLS),
vitest (Node environment, integration tests hit the real remote DB via
`.dev.vars` service-role key — no local Docker).

---

## Before you start

- Read `docs/superpowers/specs/2026-07-10-signup-approval-super-admin-design.md` — the approved design this plan implements.
- This project has **no local Supabase/Docker**. Migrations apply straight to
  the remote project (ref `tzhquesopfxevsucoapb`) via `db push` with a pooler
  connection string. You'll need the DB password (URL-encode `!` as `%21`).
- Tests that hit the DB (`*.test.ts` under `src/lib/`) read `.dev.vars` for
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and run against the real remote
  project. Run them with `npm test`.

---

### Task 1: Migration — approval columns, super-admin flag, RLS

**Files:**
- Create: `supabase/migrations/0018_signup_approval.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Signup approval gate + single super admin.

alter table profiles add column status text not null default 'pending'
  check (status in ('pending', 'approved'));
alter table profiles add column is_super_admin boolean not null default false;

-- Everyone who already has access today keeps it — only new self-signups
-- (no invite token) start pending from here on.
update profiles set status = 'approved';

-- Flag the super admin by email (auth.users holds email, not profiles).
update profiles set status = 'approved', is_super_admin = true
  where id = (select id from auth.users where email = 'rezarezanje@gmail.com');

create function is_super_admin() returns boolean language sql security definer stable as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

-- Super admin can flip any profile's status/is_super_admin; the existing
-- self-update policy (id = auth.uid()) still covers name/avatar edits.
create policy profiles_admin_write on profiles for update
  using (is_super_admin()) with check (is_super_admin());

-- Approval inserts a membership row directly (no invite token involved), so
-- the owner-only insert paths need a super-admin escape hatch.
create policy wsm_admin_write on workspace_members for insert
  with check (is_super_admin());
create policy members_admin_write on board_members for insert
  with check (is_super_admin());
```

- [ ] **Step 2: Apply the migration to the remote project**

Run (replace `<DB_PASS>` with the DB password, URL-encoded — `!` → `%21`):

```bash
npx supabase db push --db-url "postgresql://postgres.tzhquesopfxevsucoapb:<DB_PASS>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
```

Expected: migration `0018_signup_approval.sql` listed as applied. A "failed to
cache migrations catalog" Docker warning is non-fatal — ignore it.

- [ ] **Step 3: Verify the super admin row**

Run this against the same connection (`psql <url> -c "..."` or the Supabase
SQL editor):

```sql
select p.status, p.is_super_admin
from profiles p join auth.users u on u.id = p.id
where u.email = 'rezarezanje@gmail.com';
```

Expected: one row, `status = 'approved'`, `is_super_admin = true`. If it
returns zero rows, that email has no `auth.users`/`profiles` row yet on this
project — stop and confirm the correct super-admin email before continuing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_signup_approval.sql
git commit -m "feat: add signup approval columns + super admin flag"
```

---

### Task 2: Approval guard in `src/lib/auth.ts`

**Files:**
- Modify: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts` (new)

`assertApproved` is a pure function (no DB, no request) — test it directly,
no service-role client needed.

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth.test.ts`:

```typescript
import { expect, test } from 'vitest'
import { assertApproved } from './auth'

test('approved profile passes through', () => {
  expect(() => assertApproved({ status: 'approved', is_super_admin: false })).not.toThrow()
})

test('pending non-admin profile redirects', () => {
  expect(() => assertApproved({ status: 'pending', is_super_admin: false })).toThrow()
})

test('super admin passes through even if pending', () => {
  expect(() => assertApproved({ status: 'pending', is_super_admin: true })).not.toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL — `assertApproved` is not exported from `./auth`.

- [ ] **Step 3: Implement the guard**

Replace the full contents of `src/lib/auth.ts` with:

```typescript
import { redirect } from '@tanstack/react-router'
import { getServerSupabase } from './supabase/server'

export type ApprovalProfile = { status: string; is_super_admin: boolean }

/**
 * Session-only guard: throws a redirect to /login when there's no session.
 * Does NOT check approval status — use this for /pending itself, which must
 * not redirect back to /pending (that would loop).
 */
export async function getSessionUser(request: Request, headers: Headers) {
  const supabase = getServerSupabase(request, headers)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw redirect({ to: '/login' })
  return { user, supabase }
}

/**
 * Pure gate: throws a redirect to /pending unless the profile is approved or
 * belongs to the super admin. No DB/request access, so it's cheap to test.
 */
export function assertApproved(profile: ApprovalProfile): void {
  if (profile.is_super_admin) return
  if (profile.status !== 'approved') throw redirect({ to: '/pending' })
}

/**
 * Server-side guard for protected loaders/actions.
 * Throws a redirect to /login when there's no valid session, or to /pending
 * when the account hasn't been approved yet.
 */
export async function requireUser(request: Request, headers: Headers) {
  const { user, supabase } = await getSessionUser(request, headers)
  const { data } = await supabase
    .from('profiles')
    .select('status, is_super_admin')
    .eq('id', user.id)
    .single()
  const profile = (data as ApprovalProfile | null) ?? { status: 'pending', is_super_admin: false }
  assertApproved(profile)
  return { user, supabase, profile }
}

/** Guard for super-admin-only routes (the approvals dashboard). */
export async function requireSuperAdmin(request: Request, headers: Headers) {
  const { user, supabase, profile } = await requireUser(request, headers)
  if (!profile.is_super_admin) throw redirect({ to: '/' })
  return { user, supabase }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: gate requireUser on profile approval status"
```

---

### Task 3: Invite acceptance auto-approves

**Files:**
- Modify: `src/lib/invites.ts:42-57` (`acceptInvite`)
- Modify: `src/lib/workspaces.ts:121-137` (`acceptWorkspaceInvite`)
- Test: `src/lib/invites.test.ts` (extend), `src/lib/workspaces.test.ts` (new)

- [ ] **Step 1: Extend the failing test in `src/lib/invites.test.ts`**

Add this assertion inside the existing `test('acceptInvite converts a pending invite into a client membership', ...)`, right after the `expect(m?.role).toBe('client')` block:

```typescript
    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', client.id)
      .single()
    expect(prof?.status).toBe('approved')
```

- [ ] **Step 2: Write the failing test for `acceptWorkspaceInvite`**

Create `src/lib/workspaces.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { acceptWorkspaceInvite } from './workspaces'

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

async function mkUser(tag: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: tag },
  })
  if (error) throw error
  return data.user
}

test('acceptWorkspaceInvite converts a pending invite into a member and approves the profile', async () => {
  const owner = await mkUser('wsowner')
  const member = await mkUser('wsmember')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Invite Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    const { data: inv } = await admin
      .from('pending_workspace_invites')
      .insert({ workspace_id: workspaceId, email: 'someone@gmail.com' })
      .select('token')
      .single()

    const ok = await acceptWorkspaceInvite(admin, inv!.token, member.id)
    expect(ok).toBe(true)

    const { data: m } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.id)
      .single()
    expect(m?.role).toBe('member')

    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', member.id)
      .single()
    expect(prof?.status).toBe('approved')
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(member.id)
  }
}, 20000)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/invites.test.ts src/lib/workspaces.test.ts`
Expected: `invites.test.ts` FAILs on the new `prof?.status` assertion
(`undefined` !== `'approved'`, since the column now exists but isn't set yet).
`workspaces.test.ts` FAILs the same way.

- [ ] **Step 4: Implement — `src/lib/invites.ts`**

Replace the `acceptInvite` function (currently lines 42-57) with:

```typescript
/** Convert a pending invite into a board_members row with its stored role. */
export async function acceptInvite(
  svc: SupabaseClient,
  token: string,
  userId: string,
): Promise<void> {
  const { data: inv } = await svc
    .from('pending_invites')
    .select('board_id, role')
    .eq('token', token)
    .single()
  if (!inv) throw new Error('invalid invite')
  await svc
    .from('board_members')
    .insert({ board_id: inv.board_id, user_id: userId, role: inv.role ?? 'client' })
  await svc.from('pending_invites').delete().eq('token', token)
  // Invited-by-owner accounts are pre-vetted — skip the approval gate.
  await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
}
```

- [ ] **Step 5: Implement — `src/lib/workspaces.ts`**

Replace the `acceptWorkspaceInvite` function (currently lines 121-137) with:

```typescript
/** Convert a pending workspace invite into a member row. */
export async function acceptWorkspaceInvite(
  svc: SupabaseClient,
  token: string,
  userId: string,
): Promise<boolean> {
  const { data: inv } = await svc
    .from('pending_workspace_invites')
    .select('workspace_id')
    .eq('token', token)
    .maybeSingle()
  if (!inv) return false
  await svc
    .from('workspace_members')
    .insert({ workspace_id: inv.workspace_id, user_id: userId, role: 'member' })
  await svc.from('pending_workspace_invites').delete().eq('token', token)
  // Invited-by-owner accounts are pre-vetted — skip the approval gate.
  await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
  return true
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/invites.test.ts src/lib/workspaces.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/invites.ts src/lib/invites.test.ts src/lib/workspaces.ts src/lib/workspaces.test.ts
git commit -m "feat: auto-approve profiles on invite acceptance"
```

---

### Task 4: Approvals library

**Files:**
- Create: `src/lib/approvals.ts`
- Test: `src/lib/approvals.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/approvals.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from 'vitest'
import { approveToBoard, approveToWorkspace, listPendingProfiles } from './approvals'

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

async function mkUser(tag: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}.${Date.now()}@gmail.com`,
    password: 'Babikeguling1!',
    email_confirm: true,
    user_metadata: { name: tag },
  })
  if (error) throw error
  return data.user
}

test('listPendingProfiles includes a fresh self-signup', async () => {
  const user = await mkUser('pending')
  try {
    const pending = await listPendingProfiles(admin)
    expect(pending.some((p) => p.id === user.id)).toBe(true)
  } finally {
    await admin.auth.admin.deleteUser(user.id)
  }
}, 20000)

test('approveToWorkspace grants membership and approves the profile', async () => {
  const owner = await mkUser('gwsowner')
  const applicant = await mkUser('applicant')
  let workspaceId: string | undefined
  try {
    const { data: ws } = await admin
      .from('workspaces')
      .insert({ owner_id: owner.id, name: 'Grant Workspace' })
      .select('id')
      .single()
    workspaceId = ws!.id

    await approveToWorkspace(admin, applicant.id, workspaceId!, 'member')

    const { data: m } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', applicant.id)
      .single()
    expect(m?.role).toBe('member')

    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', applicant.id)
      .single()
    expect(prof?.status).toBe('approved')
  } finally {
    if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(applicant.id)
  }
}, 20000)

test('approveToBoard grants membership and approves the profile', async () => {
  const owner = await mkUser('gbowner')
  const applicant = await mkUser('bapplicant')
  let boardId: string | undefined
  try {
    const { data: board } = await admin
      .from('boards')
      .insert({ owner_id: owner.id, title: 'Grant Board' })
      .select('id')
      .single()
    boardId = board!.id

    await approveToBoard(admin, applicant.id, boardId!, 'client')

    const { data: m } = await admin
      .from('board_members')
      .select('role')
      .eq('board_id', boardId)
      .eq('user_id', applicant.id)
      .single()
    expect(m?.role).toBe('client')

    const { data: prof } = await admin
      .from('profiles')
      .select('status')
      .eq('id', applicant.id)
      .single()
    expect(prof?.status).toBe('approved')
  } finally {
    if (boardId) await admin.from('boards').delete().eq('id', boardId)
    await admin.auth.admin.deleteUser(owner.id)
    await admin.auth.admin.deleteUser(applicant.id)
  }
}, 20000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/approvals.test.ts`
Expected: FAIL — `./approvals` module doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/approvals.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export type PendingProfile = {
  id: string
  name: string | null
  email: string | null
  created_at: string
}

/** Self-signups waiting on the super admin. Needs a service-role client. */
export async function listPendingProfiles(svc: SupabaseClient): Promise<PendingProfile[]> {
  const { data: profiles } = await svc
    .from('profiles')
    .select('id, name, created_at')
    .eq('status', 'pending')
    .order('created_at')
  const { data: users } = await svc.auth.admin.listUsers()
  const emailById = new Map(users.users.map((u) => [u.id, u.email ?? null]))
  return (profiles ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string | null,
    email: emailById.get(p.id as string) ?? null,
    created_at: p.created_at as string,
  }))
}

export type WorkspaceOption = { id: string; name: string }

/** Every workspace, regardless of the caller's membership. Service-role only. */
export async function listAllWorkspaces(svc: SupabaseClient): Promise<WorkspaceOption[]> {
  const { data } = await svc.from('workspaces').select('id, name').order('name')
  return data ?? []
}

export type BoardOption = { id: string; title: string }

/** Every board, regardless of the caller's membership. Service-role only. */
export async function listAllBoards(svc: SupabaseClient): Promise<BoardOption[]> {
  const { data } = await svc.from('boards').select('id, title').order('title')
  return data ?? []
}

/** Grant a pending user a workspace role and approve their profile. */
export async function approveToWorkspace(
  svc: SupabaseClient,
  userId: string,
  workspaceId: string,
  role: 'owner' | 'member',
): Promise<void> {
  const { error: mErr } = await svc
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userId, role })
  if (mErr) throw mErr
  const { error: pErr } = await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
  if (pErr) throw pErr
}

/** Grant a pending user a board role and approve their profile. */
export async function approveToBoard(
  svc: SupabaseClient,
  userId: string,
  boardId: string,
  role: 'member' | 'client',
): Promise<void> {
  const { error: mErr } = await svc
    .from('board_members')
    .insert({ board_id: boardId, user_id: userId, role })
  if (mErr) throw mErr
  const { error: pErr } = await svc.from('profiles').update({ status: 'approved' }).eq('id', userId)
  if (pErr) throw pErr
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/approvals.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/approvals.ts src/lib/approvals.test.ts
git commit -m "feat: add approvals library for pending-signup grants"
```

---

### Task 5: `/pending` page

**Files:**
- Create: `src/routes/pending.tsx`

No test — this is a thin route wired to already-tested `getSessionUser`.

- [ ] **Step 1: Write the route**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { getSessionUser } from '#/lib/auth'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchPendingInfo = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { user, supabase } = await getSessionUser(getRequest(), headers)
  const { data: profile } = await supabase
    .from('profiles')
    .select('name, status')
    .eq('id', user.id)
    .single()
  flush(headers)
  return { name: (profile?.name as string | null) ?? null, approved: profile?.status === 'approved' }
})

export const Route = createFileRoute('/pending')({
  component: Pending,
  loader: async () => await fetchPendingInfo(),
})

function Pending() {
  const { name, approved } = Route.useLoaderData()
  // Approved while this tab was open (e.g. admin granted access moments ago)
  // — send them into the app instead of stranding them on the waiting page.
  if (approved && typeof window !== 'undefined') window.location.href = '/'

  return (
    <main className="page-wrap flex flex-1 flex-col items-center justify-center gap-3 pb-32 pt-9 text-center">
      <h1 className="display-title text-3xl font-extrabold text-[var(--ink)]">
        Hi{name ? `, ${name}` : ''} — you're almost in
      </h1>
      <p className="max-w-[420px] text-[15px] text-[var(--ink2)]">
        Your account is waiting for approval from the workspace admin. You'll
        get access as soon as they assign you to a workspace.
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run generate-routes`
Expected: `routeTree.gen.ts` now includes a `/pending` entry, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/pending.tsx routeTree.gen.ts
git commit -m "feat: add pending-approval waiting page"
```

---

### Task 6: `/admin/approvals` page

**Files:**
- Create: `src/routes/admin/approvals.tsx`

- [ ] **Step 1: Write the route**

```tsx
import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireSuperAdmin } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import {
  approveToBoard,
  approveToWorkspace,
  listAllBoards,
  listAllWorkspaces,
  listPendingProfiles,
  type BoardOption,
  type PendingProfile,
  type WorkspaceOption,
} from '#/lib/approvals'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchApprovals = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  await requireSuperAdmin(getRequest(), headers)
  const svc = getServiceSupabase()
  const [pending, workspaces, boards] = await Promise.all([
    listPendingProfiles(svc),
    listAllWorkspaces(svc),
    listAllBoards(svc),
  ])
  flush(headers)
  return { pending, workspaces, boards }
})

const approveWorkspaceFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { userId, workspaceId, role } = (d ?? {}) as {
      userId?: unknown
      workspaceId?: unknown
      role?: unknown
    }
    if (typeof userId !== 'string' || typeof workspaceId !== 'string')
      throw new Error('userId and workspaceId required')
    return { userId, workspaceId, role: role === 'owner' ? ('owner' as const) : ('member' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    await requireSuperAdmin(getRequest(), headers)
    await approveToWorkspace(getServiceSupabase(), data.userId, data.workspaceId, data.role)
    flush(headers)
  })

const approveBoardFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { userId, boardId, role } = (d ?? {}) as {
      userId?: unknown
      boardId?: unknown
      role?: unknown
    }
    if (typeof userId !== 'string' || typeof boardId !== 'string')
      throw new Error('userId and boardId required')
    return { userId, boardId, role: role === 'client' ? ('client' as const) : ('member' as const) }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    await requireSuperAdmin(getRequest(), headers)
    await approveToBoard(getServiceSupabase(), data.userId, data.boardId, data.role)
    flush(headers)
  })

export const Route = createFileRoute('/admin/approvals')({
  component: Approvals,
  loader: async () => await fetchApprovals(),
})

type Target = 'workspace' | 'board'

function ApprovalRow({
  applicant,
  workspaces,
  boards,
  onApproved,
}: {
  applicant: PendingProfile
  workspaces: WorkspaceOption[]
  boards: BoardOption[]
  onApproved: () => void
}) {
  const [target, setTarget] = useState<Target>('workspace')
  const [id, setId] = useState(workspaces[0]?.id ?? '')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)

  function onTargetChange(next: Target) {
    setTarget(next)
    setId(next === 'workspace' ? (workspaces[0]?.id ?? '') : (boards[0]?.id ?? ''))
    setRole('member')
  }

  async function onApprove() {
    if (!id) return
    setBusy(true)
    try {
      if (target === 'workspace') {
        await approveWorkspaceFn({ data: { userId: applicant.id, workspaceId: id, role } })
      } else {
        await approveBoardFn({ data: { userId: applicant.id, boardId: id, role } })
      }
      onApproved()
    } finally {
      setBusy(false)
    }
  }

  const options = target === 'workspace' ? workspaces : boards
  const roleOptions = target === 'workspace' ? ['owner', 'member'] : ['member', 'client']

  return (
    <li className="card flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-bold text-[var(--ink)]">{applicant.name ?? 'Unnamed'}</div>
        <div className="text-[12px] text-[var(--ink3)]">{applicant.email ?? '—'}</div>
      </div>
      <select
        value={target}
        onChange={(e) => onTargetChange(e.target.value as Target)}
        className="field w-auto"
      >
        <option value="workspace">Workspace</option>
        <option value="board">Board</option>
      </select>
      <select value={id} onChange={(e) => setId(e.target.value)} className="field w-auto min-w-[160px]">
        {options.length === 0 && <option value="">No {target}s yet</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {'name' in o ? o.name : o.title}
          </option>
        ))}
      </select>
      <select value={role} onChange={(e) => setRole(e.target.value)} className="field w-auto">
        {roleOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy || !id}
        className="btn btn-primary btn-square"
      >
        {busy ? 'Approving…' : 'Approve'}
      </button>
    </li>
  )
}

function Approvals() {
  const router = useRouter()
  const { pending, workspaces, boards } = Route.useLoaderData()

  return (
    <main className="page-wrap pb-32 pt-9 gt-fade">
      <h1 className="display-title mb-2 text-3xl font-extrabold text-[var(--ink)]">
        Pending approvals
      </h1>
      <p className="mb-8 text-[15px] text-[var(--ink2)]">
        {pending.length} account{pending.length === 1 ? '' : 's'} waiting for a workspace or board grant.
      </p>
      {pending.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--ink3)]">Nothing pending.</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((p) => (
            <ApprovalRow
              key={p.id}
              applicant={p}
              workspaces={workspaces}
              boards={boards}
              onApproved={() => router.invalidate()}
            />
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run generate-routes`
Expected: `routeTree.gen.ts` now includes a `/admin/approvals` entry.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/approvals.tsx routeTree.gen.ts
git commit -m "feat: add super-admin approvals dashboard"
```

---

### Task 7: Entry point on the home page

**Files:**
- Modify: `src/routes/index.tsx:17-31` (`fetchWorkspaces`), `src/routes/index.tsx:149-210` (`Workspaces` component header)

- [ ] **Step 1: Extend `fetchWorkspaces` to report super-admin + pending count**

In `src/routes/index.tsx`, change the `me` query and add a conditional pending
count. Replace:

```typescript
      supabase.from('profiles').select('name').eq('id', user.id).single(),
```

with:

```typescript
      supabase.from('profiles').select('name, is_super_admin').eq('id', user.id).single(),
```

Then, still inside `fetchWorkspaces`, after the existing `Promise.all` block
(right after the closing `])` and before `const today = ...`), add:

```typescript
  const isSuperAdmin = me?.is_super_admin === true
  const pendingCount = isSuperAdmin
    ? ((await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count ?? 0)
    : 0
```

Finally, add `isSuperAdmin` and `pendingCount` to the function's `return`
object (alongside the existing `name: me?.name ?? null,` line):

```typescript
    isSuperAdmin,
    pendingCount,
```

- [ ] **Step 2: Show the entry point in the `Workspaces` component**

In `src/routes/index.tsx`, update the destructuring line:

```typescript
  const { name, workspaces, agg, todayTasks, overdue, notes, announcements, urgent } =
    Route.useLoaderData()
```

to:

```typescript
  const { name, workspaces, agg, todayTasks, overdue, notes, announcements, urgent, isSuperAdmin, pendingCount } =
    Route.useLoaderData()
```

Then, in the header block, right before the `<button ... New workspace ...>`
element, add:

```tsx
          {isSuperAdmin && (
            <Link to="/admin/approvals" className="btn btn-ghost px-4 py-3 text-sm no-underline">
              Approvals{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Link>
          )}
```

- [ ] **Step 3: Manual check**

Run `npm run dev`, log in as the super-admin account, load `/`. Expect an
"Approvals" button in the header (with a count if any pending accounts
exist), linking to `/admin/approvals`. Log in as a non-admin, approved
account and confirm the button does not appear.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: surface pending-approvals entry point for super admin"
```

---

### Task 8: End-to-end manual verification

No new files — this is a walkthrough to confirm the whole gate works together
before calling the feature done.

- [ ] **Step 1: Self-signup lands on `/pending`**

`npm run dev` → open `/signup` in an incognito window → sign up with a brand
new Google account (or email/password) with **no** invite link in the URL.
Expected: redirected to `/` briefly, then immediately to `/pending` showing
the waiting message. Confirm you can't reach `/` or `/workspace/<id>` by
typing the URL directly — both should also redirect to `/pending`.

- [ ] **Step 2: Super admin approves via the dashboard**

Log in as `rezarezanje@gmail.com` in a separate (non-incognito) session → `/`
→ click **Approvals** → find the new signup → pick an existing workspace +
role `member` → **Approve**. Expected: the row disappears from the list (or
`router.invalidate()` refetches an empty list) and the pending count drops.

- [ ] **Step 3: Approved user gets in**

Back in the incognito window, reload `/pending` (or navigate to `/`).
Expected: lands on `/` and sees the workspace just granted.

- [ ] **Step 4: Invited users still skip the gate**

From an existing workspace (as its owner), invite a brand-new email to the
workspace, sign up via that invite link. Expected: the new account lands on
`/` directly — never sees `/pending` — because `acceptWorkspaceInvite` set
`status = 'approved'` (Task 3).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including `auth.test.ts`, `invites.test.ts`,
`workspaces.test.ts`, `approvals.test.ts`.

---

## Out of scope (from the design doc)

Multiple super admins, a `signup_requests` audit/history table, a reject (vs.
approve) flow, email notifications on approval, multi-grant-per-approval UI.
