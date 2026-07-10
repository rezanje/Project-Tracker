/** Full-screen auth layout: meadow hills at the bottom, a centered card with the
 *  Rakit mark, a heading and subtitle. Children are the form. Shared by
 *  /login and /signup so the hill SVG lives in one place. */
export default function AuthShell({
  heading,
  subtitle,
  children,
}: {
  heading: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <svg
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-0 h-[46vh] w-full"
      >
        <path
          d="M0,190 C280,130 520,225 760,185 C1000,145 1240,215 1440,165 L1440,320 L0,320 Z"
          fill="#d8efdf"
        />
        <path
          d="M0,235 C320,185 560,262 880,222 C1120,192 1320,252 1440,222 L1440,320 L0,320 Z"
          fill="#bfe6cc"
        />
      </svg>

      <div className="relative z-10 w-full max-w-[404px] rounded-[28px] border border-[var(--line)] bg-[var(--card)] p-[34px] shadow-[0_30px_70px_-30px_rgba(16,28,22,0.35)] gt-fade">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/logo192.png" alt="" width={36} height={36} className="rounded-[12px]" />
          <span className="display-title text-xl font-extrabold text-[var(--ink)]">
            Rakit
          </span>
        </div>
        <h1 className="display-title mb-1.5 text-[28px] font-extrabold text-[var(--ink)]">
          {heading}
        </h1>
        <p className="mb-6 text-sm text-[var(--ink2)]">{subtitle}</p>
        {children}
      </div>
    </main>
  )
}
