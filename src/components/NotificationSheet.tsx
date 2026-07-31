import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AtSign, Bell, Clock, MessageSquare, UserPlus } from 'lucide-react'
import { Sheet } from '#/components/WorkspaceSwitcher'
import { toast } from '#/components/Toast'
import { accentFor } from '#/lib/accent'
import { fetchThreadsFn, type Thread } from '#/lib/messages'
import {
  fetchNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
  type Notification,
} from '#/lib/notifications'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'baru saja'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}j`
  return `${Math.floor(s / 86400)}h`
}

// Notifications have no actor column, so the 34px slot carries the kind rather
// than a made-up face.
const KIND_ICON = {
  assignment: UserPlus,
  reminder: Clock,
  mention: AtSign,
  status: Bell,
  pic: UserPlus,
} as const

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase() || '?'
}

/** Row chrome from the comp: unread lifts onto `--card`, read sits flat in `--col`. */
function Row({
  onClick,
  slot,
  text,
  stamp,
  unread,
}: {
  onClick: () => void
  slot: React.ReactNode
  text: string
  stamp: string
  unread: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[18px] px-3.5 py-3 text-left transition ${
        unread ? 'bg-[var(--card)] shadow-[var(--shadow-sm)]' : 'bg-[var(--col)]'
      }`}
    >
      {slot}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-[1.4] text-[var(--ink)]">{text}</span>
        <span className="mt-0.5 block text-[12.5px] text-[var(--ink3)]">{stamp}</span>
      </span>
      {unread && (
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--accent)]" aria-label="Belum dibaca" />
      )}
    </button>
  )
}

/** The bell's bottom sheet: notifications and message threads behind two segments.
 *  Threads open the full `/inbox` page — a conversation needs more room than a sheet. */
export default function NotificationSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'notif' | 'pesan'>('notif')
  const [items, setItems] = useState<Notification[]>([])
  const [threads, setThreads] = useState<Thread[]>([])

  useEffect(() => {
    fetchNotificationsFn().then(setItems).catch(() => {})
    fetchThreadsFn().then(setThreads).catch(() => {})
  }, [])

  const unread = items.filter((n) => !n.read).length

  async function openNotification(n: Notification) {
    onClose()
    if (!n.read) {
      await markNotificationReadFn({ data: { id: n.id, kind: n.kind } }).catch(() => {})
    }
    if (n.boardId) navigate({ to: '/board/$boardId', params: { boardId: n.boardId } })
  }

  async function markAll() {
    await markAllNotificationsReadFn().catch(() => {})
    setItems((prev) => prev.map((i) => ({ ...i, read: true })))
    toast('Semua ditandai dibaca')
  }

  const list = tab === 'notif' ? items : threads

  return (
    <Sheet onClose={onClose} label="Notifikasi" className="max-h-[78%]">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="flex-1 text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">
          Notifikasi
        </h2>
        {tab === 'notif' && unread > 0 && (
          <button
            type="button"
            onClick={markAll}
            className="text-[13px] font-bold text-[var(--accent-ink)]"
          >
            Tandai dibaca
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-1.5 rounded-full bg-[var(--col)] p-1">
        {([['notif', 'Notifikasi'], ['pesan', 'Pesan']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`flex-1 rounded-full py-[9px] text-[12.5px] font-bold transition ${
              tab === id
                ? 'bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-[20px] bg-[var(--col)] px-[18px] py-7 text-center">
          <p className="text-[14.5px] font-bold text-[var(--ink)]">
            {tab === 'notif' ? 'Belum ada notifikasi' : 'Belum ada pesan'}
          </p>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            {tab === 'notif' ? 'Semua sudah kamu baca.' : 'Mulai obrolan dari halaman Pesan.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tab === 'notif'
            ? items.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell
                return (
                  <Row
                    key={`${n.kind}:${n.id}`}
                    onClick={() => openNotification(n)}
                    unread={!n.read}
                    text={n.message}
                    stamp={timeAgo(n.createdAt)}
                    slot={
                      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)]">
                        <Icon size={16} aria-hidden="true" />
                      </span>
                    }
                  />
                )
              })
            : threads.map((t) => (
                <Row
                  key={t.id}
                  onClick={() => {
                    onClose()
                    navigate({ to: '/inbox', search: { t: t.id } })
                  }}
                  unread={t.unread > 0}
                  text={t.title}
                  stamp={t.lastMessage ?? 'Belum ada pesan'}
                  slot={
                    <span
                      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: accentFor(t.id) }}
                    >
                      {initials(t.title)}
                    </span>
                  }
                />
              ))}
        </div>
      )}

      {tab === 'pesan' && (
        <button
          type="button"
          onClick={() => {
            onClose()
            navigate({ to: '/inbox' })
          }}
          className="mt-4 flex h-[50px] w-full items-center justify-center gap-2.5 rounded-full bg-[var(--col)] text-[14.5px] font-bold text-[var(--ink2)] transition hover:text-[var(--ink)] active:scale-[.99]"
        >
          <MessageSquare size={17} aria-hidden="true" />
          Buka semua pesan
        </button>
      )}
    </Sheet>
  )
}
