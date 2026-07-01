import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { requireUser } from '#/lib/auth'
import { createBoard, listMyBoards } from '#/lib/boards'

// Supabase may rotate the session cookie on any call; flush those Set-Cookie
// headers (collected on a throwaway Headers) onto the real response.
function flush(headers: Headers) {
  for (const c of headers.getSetCookie()) setResponseHeader('Set-Cookie', c)
}

const fetchBoards = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = new Headers()
  const { supabase } = await requireUser(getRequest(), headers)
  const boards = await listMyBoards(supabase)
  flush(headers)
  return boards
})

const newBoard = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    const title = (d as { title?: unknown })?.title
    if (typeof title !== 'string' || !title.trim()) throw new Error('Title required')
    return { title: title.trim() }
  })
  .handler(async ({ data }) => {
    const headers = new Headers()
    const { user, supabase } = await requireUser(getRequest(), headers)
    const board = await createBoard(supabase, user.id, data.title)
    flush(headers)
    return board
  })

export const Route = createFileRoute('/')({
  component: Boards,
  loader: async () => await fetchBoards(),
})

function Boards() {
  const router = useRouter()
  const boards = Route.useLoaderData()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    await newBoard({ data: { title } })
    setTitle('')
    setBusy(false)
    router.invalidate()
  }

  return (
    <main className="page-wrap mx-auto max-w-4xl px-4 pb-12 pt-14">
      <h1 className="mb-6 text-3xl font-bold text-[var(--sea-ink)]">Your boards</h1>

      <form onSubmit={onCreate} className="mb-8 flex gap-2">
        <input
          placeholder="New board title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-[var(--lagoon-deep)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'New board'}
        </button>
      </form>

      {boards.length === 0 ? (
        <p className="text-[var(--sea-ink-soft)]">No boards yet. Create one above.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <li key={b.id}>
              <a
                href={`/board/${b.id}`}
                className="island-shell block rounded-2xl p-5 no-underline transition hover:-translate-y-0.5"
              >
                <h2 className="text-base font-semibold text-[var(--sea-ink)]">{b.title}</h2>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
