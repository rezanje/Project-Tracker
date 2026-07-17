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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase() || '?'
}

export default function Comments({ cardId, members }: CommentsProps) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const currentUserId = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  function onBodyChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    const cursor = e.target.selectionStart ?? value.length
    setBody(value)

    const upToCursor = value.slice(0, cursor)
    const at = upToCursor.lastIndexOf('@')
    if (at === -1 || /\s/.test(upToCursor.slice(at + 1))) {
      setMentionOpen(false)
      return
    }
    setMentionStart(at)
    setMentionQuery(upToCursor.slice(at + 1))
    setMentionOpen(true)
  }

  function selectMention(name: string) {
    if (mentionStart === null) return
    const cursor = inputRef.current?.selectionStart ?? body.length
    const before = body.slice(0, mentionStart)
    const after = body.slice(cursor)

    // Only add space separator if 'after' is empty or doesn't already start with whitespace
    const separator = after && /^\s/.test(after) ? '' : ' '
    const next = `${before}@${name}${separator}${after}`

    setBody(next)
    setMentionOpen(false)
    setMentionStart(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      // Cursor positioned right after the mention name
      const pos = before.length + 1 + name.length
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const mentionMatches = mentionOpen
    ? members.filter((m) => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5)
    : []

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
    <div className="flex flex-col gap-3.5">
      <p className="display-title text-[15px] font-bold text-[var(--ink)]">Comments</p>

      <div className="flex max-h-56 flex-col gap-3.5 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="text-[13px] text-[var(--ink3)]">
            No comments yet. Start the conversation.
          </p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white">
                {initials(c.authorName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-bold text-[var(--ink)]">
                    {c.authorName}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--ink3)]">
                    {shortTime(c.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ink)]">
                  {c.body}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handlePost} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={body}
            onChange={onBodyChange}
            onBlur={() => {
              setTimeout(() => setMentionOpen(false), 150)
            }}
            placeholder="Write a comment… (@ to mention)"
            className="field w-full"
          />
          {mentionOpen && mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-48 rounded-lg border border-[var(--line)] bg-[var(--card)] p-1 shadow-lg">
              {mentionMatches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => selectMention(m.name)}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={posting || !body.trim()}
          className="btn btn-primary btn-square shrink-0"
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </form>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  )
}
