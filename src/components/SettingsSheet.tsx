import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, LogOut, Sparkles, UserCheck } from 'lucide-react'
import { Sheet } from '#/components/WorkspaceSwitcher'
import { toast } from '#/components/Toast'
import { accentFor } from '#/lib/accent'
import { disconnectGoogleCalendarFn, googleCalendarStatusFn, startGoogleCalendarConnectFn } from '#/lib/google-calendar-actions'
import { fetchProfileFn, updateProfileFn } from '#/lib/profile'
import { getBrowserSupabase } from '#/lib/supabase/browser'

function initials(name: string, email: string | null): string {
  const base = name.trim() || email?.split('@')[0] || ''
  const parts = base.split(/[.\-_\s]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)
  return chars.toUpperCase() || '?'
}

/** Row with a label, a hint and a switch. The switch is a real (visually
 *  hidden) checkbox so keyboard and screen-reader behaviour comes for free; the
 *  pill on top is painted from `checked` rather than Tailwind's `peer-*`,
 *  because the knob is a grandchild of the input and `peer-*` only reaches
 *  siblings. */
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[18px] bg-[var(--col)] px-4 py-3.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-[var(--ink)]">{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--ink3)]">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--bg)] ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--sunk)]'
        }`}
      >
        <span
          className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-[var(--card)] shadow-[var(--shadow-sm)] transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </span>
    </label>
  )
}

export default function SettingsSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void
  /** Lets the header repaint the greeting and initials without a reload. */
  onSaved?: (name: string | null) => void
}) {
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState<string | null>(null)
  const [emailReminders, setEmailReminders] = useState(true)
  const [approvals, setApprovals] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gcalConnected, setGcalConnected] = useState<boolean | null>(null)
  const [gcalBusy, setGcalBusy] = useState(false)
  const navigate = useNavigate()

  async function logout() {
    await getBrowserSupabase().auth.signOut()
    navigate({ to: '/login' })
  }

  useEffect(() => {
    fetchProfileFn()
      .then((p) => {
        setName(p.name ?? '')
        setEmail(p.email)
        setEmailReminders(p.emailReminders)
        setApprovals(p.approvals)
      })
      .catch(() => setError('Gagal memuat pengaturan'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    googleCalendarStatusFn()
      .then((r) => setGcalConnected(r.connected))
      .catch(() => setGcalConnected(false))
  }, [])

  async function connectGoogleCalendar() {
    setGcalBusy(true)
    try {
      const { url } = await startGoogleCalendarConnectFn()
      window.location.assign(url)
    } catch {
      toast('Gagal menyambungkan')
      setGcalBusy(false)
    }
  }

  async function disconnectGoogleCalendar() {
    setGcalBusy(true)
    try {
      await disconnectGoogleCalendarFn()
      setGcalConnected(false)
      toast('Google Calendar diputus')
    } catch {
      toast('Gagal memutus koneksi')
    } finally {
      setGcalBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await updateProfileFn({ data: { name, emailReminders } })
      onSaved?.(saved.name)
      toast('Pengaturan disimpan')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      label="Pengaturan"
      className="max-h-[86%]"
      header={
        // Log out lives here rather than as its own round button in the
        // mobile header — it is a once-in-a-while action, not one of the
        // three things worth a permanent slot next to the bell. Living in
        // the sheet's header (not the scrolling body) also means dragging
        // down from this row, not just the grab handle, closes the sheet.
        <div className="mb-4 flex items-center gap-3">
          <h2 className="flex-1 text-[22px] font-extrabold tracking-[-0.03em] text-[var(--ink)]">Pengaturan</h2>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-full bg-[var(--danger-soft)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--danger-ink)]"
          >
            <LogOut size={14} aria-hidden="true" />
            Keluar
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-[13px] text-[var(--ink3)]">Memuat…</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-5">
          <div className="flex items-center gap-3.5">
            {/* No upload: the avatar is the name's initials on a colour derived
                from the email, same as everywhere else in the app. */}
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-[var(--card)]"
              style={{ background: accentFor(email ?? name ?? '?') }}
            >
              {initials(name, email)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-bold text-[var(--ink)]">{email}</p>
              <p className="mt-0.5 text-[12.5px] text-[var(--ink3)]">
                Foto profil pakai inisial nama otomatis.
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="settings-name"
              className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]"
            >
              Nama tampil
            </label>
            <input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder={email?.split('@')[0] ?? 'Nama kamu'}
              className="field"
            />
          </div>

          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">Email</p>
            <Toggle
              checked={emailReminders}
              onChange={setEmailReminders}
              label="Email pengingat"
              hint="Kirimi saya email saat ada pengingat atau tugas jatuh tempo."
            />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
              Kalender
            </p>
            <div className="flex items-center gap-3 rounded-[18px] bg-[var(--col)] px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-[var(--ink)]">Google Calendar</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--ink3)]">
                  {gcalConnected ? 'Terhubung — jadwal masuk ke Schedule.' : 'Belum terhubung.'}
                </span>
              </span>
              {gcalConnected === null ? null : gcalConnected ? (
                <button
                  type="button"
                  onClick={disconnectGoogleCalendar}
                  disabled={gcalBusy}
                  className="shrink-0 rounded-full bg-[var(--card)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--ink2)]"
                >
                  Putuskan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={connectGoogleCalendar}
                  disabled={gcalBusy}
                  className="shrink-0 rounded-full bg-[var(--btn)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--btn-ink)]"
                >
                  Hubungkan
                </button>
              )}
            </div>
          </div>

          {/* Super admin only. Unsaved edits above are deliberately dropped on
              navigate — this is a link out, not a form field, and pretending
              otherwise would mean saving on someone's behalf. */}
          {approvals !== null && (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">Admin</p>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  navigate({ to: '/admin/approvals' })
                }}
                className="flex w-full items-center gap-3 rounded-[18px] bg-[var(--col)] px-4 py-3.5 text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink2)] shadow-[var(--shadow-sm)]">
                  <UserCheck size={16} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-[var(--ink)]">Approval akun</span>
                  <span className="mt-0.5 block text-[12.5px] text-[var(--ink3)]">
                    {approvals === 0 ? 'Tidak ada yang menunggu.' : `${approvals} orang menunggu disetujui.`}
                  </span>
                </span>
                {approvals > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[12px] font-bold text-white">
                    {approvals}
                  </span>
                )}
                <ChevronRight size={16} className="shrink-0 text-[var(--ink3)]" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Placeholder only — no waiting list, no pricing. It exists so the
              paid tier has a visible home when there is something to sell. */}
          <div className="flex items-center gap-3 rounded-[18px] bg-[var(--col)] px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-[var(--ink2)] shadow-[var(--shadow-sm)]">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-[var(--ink)]">Paket berbayar</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--ink3)]">
                Segera hadir. Semua fitur Rakit masih gratis untuk sekarang.
              </span>
            </span>
          </div>

          {error && <p className="text-[12.5px] font-semibold text-[var(--danger)]">{error}</p>}

          <div className="flex gap-2.5">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">
              Batal
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-[1.4]">
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      )}
    </Sheet>
  )
}
