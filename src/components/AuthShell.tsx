import { Bot, Sparkles } from 'lucide-react'

/** Full-screen pixel-game auth layout: pixel sky + meadow at the bottom, a
 *  centered parchment card with a chunky pixel border, the Rakit mark, a
 *  robot mascot with a speech bubble, a heading and subtitle. Children are the
 *  form. Shared by /login and /signup so the scene lives in one place.
 *  ponytail: scene sprites (castle/house/chest/trophy) still pending from the
 *  user — the mascot + meadow carry the retro vibe until those land. */
export default function AuthShell({
  heading,
  subtitle,
  mascot,
  children,
}: {
  heading: string
  subtitle: string
  /** Speech-bubble line for the robot mascot. Omit to hide the mascot. */
  mascot?: string
  children: React.ReactNode
}) {
  return (
    <main className="auth-scene relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* pixel sky + rolling meadow */}
      <div aria-hidden="true" className="absolute inset-0 z-0 bg-[linear-gradient(180deg,#8ec7f0_0%,#bfe0f5_42%,#e9f3ec_62%)]" />
      <svg
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-0 h-[46vh] w-full"
      >
        <path d="M0,190 C280,130 520,225 760,185 C1000,145 1240,215 1440,165 L1440,320 L0,320 Z" fill="#8fd6a3" />
        <path d="M0,235 C320,185 560,262 880,222 C1120,192 1320,252 1440,222 L1440,320 L0,320 Z" fill="#5cbe7b" />
      </svg>

      <div className="auth-card relative z-10 w-full max-w-[420px] gt-fade">
        {mascot && (
          <div className="mb-4 flex items-start justify-end gap-2">
            <div className="auth-bubble">{mascot}</div>
            <div className="auth-mascot" aria-hidden="true">
              <Bot size={22} strokeWidth={2.5} />
            </div>
          </div>
        )}
        <div className="mb-5 flex items-center gap-2.5">
          <img src="/logo192.png" alt="" width={38} height={38} className="rounded-[10px] border-2 border-[var(--ink)]" style={{ imageRendering: 'pixelated' }} />
          <span className="display-title text-2xl font-extrabold text-[var(--ink)]">Rakit</span>
          <Sparkles size={20} className="text-[var(--pop)]" fill="currentColor" />
        </div>
        <h1 className="display-title mb-1.5 text-[32px] font-extrabold text-[var(--accent-ink)]">{heading}</h1>
        <p className="mb-6 text-sm text-[var(--ink2)]">{subtitle}</p>
        {children}
      </div>
    </main>
  )
}
