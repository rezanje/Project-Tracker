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
    <main className="page-wrap max-w-5xl pb-16 pt-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
            Boards
          </h1>
          <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
            {boards.length === 0
              ? 'No boards yet — create your first below.'
              : `${boards.length} board${boards.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <form onSubmit={onCreate} className="flex gap-2">
          <input
            placeholder="New board title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="field w-48 sm:w-64"
          />
          <button type="submit" disabled={busy} className="btn btn-primary shrink-0">
            {busy ? 'Adding…' : 'New board'}
          </button>
        </form>
      </div>

      {boards.length === 0 ? (
        <div className="card grid place-items-center px-6 py-16 text-center">
          <p className="text-[var(--sea-ink-soft)]">
            Your boards will appear here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <li key={b.id}>
              <a href={`/board/${b.id}`} className="card card-hover block p-5 no-underline">
                <span
                  aria-hidden="true"
                  className="mb-3 block h-1 w-10 rounded-full bg-[var(--lagoon-deep)]"
                />
                <h2 className="text-base font-semibold text-[var(--sea-ink)]">
                  {b.title}
                </h2>
                <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">Open board →</p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
