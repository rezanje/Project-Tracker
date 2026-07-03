import { X } from 'lucide-react'
import type { TeamMember } from '#/lib/workspaces'

interface Props {
  members: TeamMember[]
  meId: string
  busy: boolean
  onSetRole: (userId: string, role: 'owner' | 'member') => void
  onRemove: (userId: string) => void
  onClose: () => void
}

function initials(name: string | null, email: string | null): string {
  const s = name?.trim() || email || '?'
  const parts = s.split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || s.slice(0, 2).toUpperCase()
}

export default function TeamPanel({ members, meId, busy, onSetRole, onRemove, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(16,28,22,0.42)] px-5 py-10 backdrop-blur-[3px] gt-back"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[24px] bg-[var(--card)] p-6 shadow-[0_30px_80px_-20px_rgba(16,28,22,0.5)] gt-pop">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="display-title text-2xl font-extrabold text-[var(--ink)]">
            Team · {members.length}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[var(--col)] text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {members.map((m) => {
            const isMe = m.user_id === meId
            return (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-bold text-white">
                  {initials(m.name, m.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[var(--ink)]">
                    {m.name ?? m.email ?? 'Unknown'} {isMe && <span className="text-[var(--ink3)]">(you)</span>}
                  </div>
                  {m.email && (
                    <div className="truncate text-[12px] text-[var(--ink3)]">{m.email}</div>
                  )}
                </div>
                <select
                  value={m.role}
                  disabled={isMe || busy}
                  onChange={(e) => onSetRole(m.user_id, e.target.value as 'owner' | 'member')}
                  className="field w-auto rounded-full px-3 py-1.5 text-[13px] disabled:opacity-60"
                >
                  <option value="owner">Owner</option>
                  <option value="member">Member</option>
                </select>
                <button
                  type="button"
                  disabled={isMe || busy}
                  onClick={() => onRemove(m.user_id)}
                  className="btn btn-danger btn-square shrink-0 px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            )
          })}
          {members.length === 0 && (
            <li className="py-6 text-center text-sm text-[var(--ink3)]">No members yet.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
