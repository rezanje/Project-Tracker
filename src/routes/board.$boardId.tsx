import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from '#/lib/auth'
import { getServiceSupabase } from '#/lib/supabase/server'
import { loadBoard } from '#/lib/board-data'
import { inviteClient } from '#/lib/invites'
import Column from '#/components/Column'

function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchBoard = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const id = (d as { boardId?: unknown })?.boardId
    if (typeof id !== 'string') throw new Error('boardId required')
    return { boardId: id }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { supabase } = await requireUser(getRequest(), headers)
    const board = await loadBoard(supabase, data.boardId)
    flush(headers)
    return board
  })

const inviteFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const { boardId, email } = (d ?? {}) as { boardId?: unknown; email?: unknown }
    if (typeof boardId !== 'string' || typeof email !== 'string' || !email.trim())
      throw new Error('boardId and email required')
    return { boardId, email: email.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    // service client bypasses RLS, so gate ownership here explicitly
    const { data: m } = await supabase
      .from('board_members')
      .select('role')
      .eq('board_id', data.boardId)
      .eq('user_id', user.id)
      .single()
    if (m?.role !== 'owner') throw new Error('forbidden')
    const res = await inviteClient(getServiceSupabase(), data.boardId, data.email)
    flush(headers)
    return res
  })

export const Route = createFileRoute('/board/$boardId')({
  component: BoardView,
  loader: async ({ params }) => await fetchBoard({ data: { boardId: params.boardId } }),
})

function BoardView() {
  const board = Route.useLoaderData()
  const isOwner = board.role === 'owner'
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<string | null>(null)

  async function onInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setResult(null)
    try {
      const r = await inviteFn({ data: { boardId: board.id, email } })
      setResult(r.status === 'added' ? 'Added existing user as client.' : 'Invite sent.')
      setEmail('')
    } catch {
      setResult('Failed to invite.')
    }
  }

  return (
    <main className="page-wrap mx-auto max-w-6xl px-4 pb-12 pt-14">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link to="/" className="text-sm text-[var(--sea-ink-soft)]">
            ← Boards
          </Link>
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">{board.title}</h1>
        </div>
        <span className="rounded-full bg-[rgba(79,184,178,0.18)] px-3 py-1 text-xs font-semibold text-[var(--lagoon-deep)]">
          {board.role}
        </span>
      </div>

      {isOwner && (
        <form onSubmit={onInvite} className="mb-6 flex max-w-md gap-2">
          <input
            type="email"
            placeholder="Invite client by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-full bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white"
          >
            Invite
          </button>
        </form>
      )}
      {result && <p className="mb-4 text-sm text-[var(--sea-ink-soft)]">{result}</p>}

      {board.columns.length === 0 ? (
        <p className="text-[var(--sea-ink-soft)]">No columns yet.</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {board.columns.map((col) => (
            <Column key={col.id} column={col} />
          ))}
        </div>
      )}
    </main>
  )
}
