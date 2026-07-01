import { useEffect, useRef, useState } from 'react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import { addComment } from '#/lib/comments'

type CommentItem = {
  id: string
  body: string
  created_at: string
  author_id: string
  authorName: string
}

interface CommentsProps {
  cardId: string
  members: { id: string; name: string }[]
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Comments({ cardId, members }: CommentsProps) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentUserId = useRef<string | null>(null)

  // Resolve an author's display name from the board members list, falling back
  // to "You" for the current user or a generic label.
  function resolveName(authorId: string): string {
    const member = members.find((m) => m.id === authorId)
    if (member) return member.name
    if (authorId === currentUserId.current) return 'You'
    return 'Member'
  }

  useEffect(() => {
    const supabase = getBrowserSupabase()
    let active = true

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      currentUserId.current = user?.id ?? null

      const { data } = await supabase
        .from('comments')
        .select('id, body, created_at, author_id, profiles(name)')
        .eq('card_id', cardId)
        .order('created_at')

      if (!active) return
      const items: CommentItem[] = (data ?? []).map((row: Record<string, unknown>) => {
        const profile = (row as { profiles?: { name?: string } | null }).profiles
        return {
          id: row.id as string,
          body: row.body as string,
          created_at: row.created_at as string,
          author_id: row.author_id as string,
          authorName: profile?.name ?? resolveName(row.author_id as string),
        }
      })
      setComments(items)
    }

    load()

    // Realtime: append INSERTs for this card. Payloads carry only raw comment
    // columns (no joined profile name), so resolve the author name locally.
    const channel = supabase
      .channel(`comments:${cardId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'comments',
          filter: `card_id=eq.${cardId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as {
            id: string
            body: string
            created_at: string
            author_id: string
          }
          setComments((prev) => {
            // Dedupe: our own insert may echo back via realtime.
            if (prev.some((c) => c.id === row.id)) return prev
            return [
              ...prev,
              {
                id: row.id,
                body: row.body,
                created_at: row.created_at,
                author_id: row.author_id,
                authorName: resolveName(row.author_id),
              },
            ]
          })
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId])

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setPosting(true)
    setError(null)
    try {
      const supabase = getBrowserSupabase()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('not signed in')
      await addComment(supabase, cardId, user.id, text)
      setBody('')
    } catch {
      setError('Failed to post comment.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-[var(--sea-ink-soft)]">Comments</p>

      <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-[10px] border border-[var(--line)] bg-[var(--col-bg)] p-2">
        {comments.length === 0 ? (
          <p className="text-xs italic text-[var(--sea-ink-soft)]">No comments yet.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-[var(--sea-ink)]">{c.authorName}</span>
                <span className="shrink-0 text-[10px] text-[var(--sea-ink-soft)]">
                  {shortTime(c.created_at)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[var(--sea-ink)]">{c.body}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handlePost} className="flex items-end gap-2">
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          className="field flex-1"
        />
        <button
          type="submit"
          disabled={posting || !body.trim()}
          className="btn btn-primary shrink-0"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </form>

      {error && <p className="text-xs text-[#b23b3b]">{error}</p>}
    </div>
  )
}
