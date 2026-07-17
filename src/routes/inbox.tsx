import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import {
  fetchThreadsFn,
  fetchMessagesFn,
  sendMessageFn,
  openDmFn,
  markThreadReadFn,
  fetchMessageableMembersFn,
  type Thread,
  type Message,
  type MessageableMember,
} from '#/lib/messages'
import { fetchNotificationsFn, type Notification } from '#/lib/notifications'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function InboxPage() {
  const [tab, setTab] = useState<'messages' | 'mentions'>('messages')
  const [mentions, setMentions] = useState<Notification[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [meId, setMeId] = useState('')
  const meIdRef = useRef('')
  const [picking, setPicking] = useState(false)
  const [members, setMembers] = useState<MessageableMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const active = threads.find((t) => t.id === activeId) ?? null

  useEffect(() => {
    getBrowserSupabase()
      .auth.getUser()
      .then((res: { data: { user: { id: string } | null } }) => {
        const id = res.data.user?.id ?? ''
        setMeId(id)
        meIdRef.current = id
      })
    fetchThreadsFn().then(setThreads).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'mentions') return
    fetchNotificationsFn()
      .then((items) => setMentions(items.filter((n) => n.kind === 'mention')))
      .catch(() => {})
  }, [tab])

  // Load messages + realtime for the active thread.
  useEffect(() => {
    if (!activeId) return
    let alive = true
    setMessages([])
    fetchMessagesFn({ data: { threadId: activeId } }).then((m) => {
      if (alive) setMessages(m)
    })
    markThreadReadFn({ data: { threadId: activeId } }).catch(() => {})
    setThreads((prev) => prev.map((t) => (t.id === activeId ? { ...t, unread: 0 } : t)))

    const otherName = active?.title ?? 'Unknown'
    const supabase = getBrowserSupabase()
    const channel = supabase
      .channel(`messages:${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${activeId}` },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as { id: string; sender_id: string; body: string; created_at: string }
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev
            return [
              ...prev,
              {
                id: row.id,
                threadId: activeId,
                senderId: row.sender_id,
                senderName: row.sender_id === meIdRef.current ? 'Me' : otherName,
                body: row.body,
                createdAt: row.created_at,
              },
            ]
          })
          if (row.sender_id !== meIdRef.current) markThreadReadFn({ data: { threadId: activeId } }).catch(() => {})
        },
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
    // meId is read via meIdRef inside the realtime handler, so it is intentionally
    // omitted from deps to avoid tearing down/re-subscribing the channel when it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close the member picker on Escape.
  useEffect(() => {
    if (!picking) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPicking(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  async function send() {
    const body = draft.trim()
    if (!body || !activeId) return
    setDraft('')
    setError(null)
    try {
      await sendMessageFn({ data: { threadId: activeId, body } })
      fetchThreadsFn().then(setThreads).catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
      setDraft(body)
    }
  }

  async function startDm(member: MessageableMember) {
    setPicking(false)
    try {
      const { threadId } = await openDmFn({ data: { otherUserId: member.id } })
      const list = await fetchThreadsFn()
      setThreads(list)
      setActiveId(threadId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open chat')
    }
  }

  function openPicker() {
    setPicking(true)
    setMembers([])
    fetchMessageableMembersFn().then(setMembers).catch(() => {})
  }

  return (
    <div className="page-wrap py-6">
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab('messages')}
          className={`btn ${tab === 'messages' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Messages
        </button>
        <button
          type="button"
          onClick={() => setTab('mentions')}
          className={`btn ${tab === 'mentions' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Mentions
        </button>
      </div>

      {tab === 'mentions' ? (
        <div className="card p-2">
          {mentions.length === 0 ? (
            <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No mentions yet.</p>
          ) : (
            mentions.map((n) => (
              <a
                key={n.id}
                href={n.boardId ? `/board/${n.boardId}` : '#'}
                className="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 no-underline hover:bg-[var(--col)]"
              >
                <span className="text-[13px] font-semibold text-[var(--ink)]">{n.message}</span>
                <span className="text-[11px] text-[var(--ink3)]">{timeAgo(n.createdAt)}</span>
              </a>
            ))
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Thread list */}
          <aside className="card p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">Messages</p>
              <Button size="sm" variant="secondary" onClick={openPicker}>New</Button>
            </div>
            {threads.length === 0 && (
              <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No conversations yet.</p>
            )}
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--col)] ${
                  t.id === activeId ? 'bg-[var(--accent-soft)]' : ''
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className={`text-[13px] ${t.unread ? 'font-extrabold text-[var(--ink)]' : 'font-semibold text-[var(--ink)]'}`}>
                    {t.title}
                  </span>
                  {t.unread > 0 && (
                    <span className="ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-bold text-white">
                      {t.unread}
                    </span>
                  )}
                </span>
                {t.lastMessage && <span className="truncate text-[11px] text-[var(--ink3)]">{t.lastMessage}</span>}
              </button>
            ))}
          </aside>

          {/* Conversation */}
          <section className="card flex min-h-[60vh] flex-col p-0">
            {!active ? (
              <div className="grid flex-1 place-items-center text-[13px] text-[var(--ink3)]">
                Pick a conversation, or start a new one.
              </div>
            ) : (
              <>
                <div className="border-b-2 border-[var(--ink)] px-4 py-2.5">
                  <p className="display-title text-lg font-extrabold text-[var(--ink)]">{active.title}</p>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex flex-col ${m.senderId === meId ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-lg border-2 border-[var(--ink)] px-3 py-1.5 text-[13px] ${
                          m.senderId === meId ? 'bg-[var(--accent-soft)]' : 'bg-[var(--card)]'
                        }`}
                      >
                        {m.body}
                      </div>
                      <span className="mt-0.5 text-[10px] text-[var(--ink3)]">{timeAgo(m.createdAt)}</span>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                {error && <p className="px-4 pb-1 text-[12px] font-semibold text-[var(--danger)]">{error}</p>}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    send()
                  }}
                  className="flex gap-2 border-t-2 border-[var(--ink)] p-3"
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a message"
                    className="flex-1"
                  />
                  <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
                    <Send size={16} />
                  </Button>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      {/* Member picker */}
      {picking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={() => setPicking(false)}>
          <div
            className="card w-full max-w-sm p-3"
            role="dialog"
            aria-modal="true"
            aria-label="New message"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--ink3)]">New message</p>
            {members.length === 0 && (
              <p className="px-2 py-4 text-center text-[12px] text-[var(--ink3)]">No members to message.</p>
            )}
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => startDm(m)}
                className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--col)]"
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
})
