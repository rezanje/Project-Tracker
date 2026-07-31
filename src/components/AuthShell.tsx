/** Full-screen auth layout: warm flat background, the Rakit mark, a big display
 *  heading and subtitle, then the form. `footer` pins a note to the bottom of
 *  the screen (approval notice / demo hint). Shared by /login, /signup,
 *  /forgot and /reset so the scene lives in one place. */
export default function AuthShell({
  heading,
  subtitle,
  footer,
  children,
}: {
  heading: string
  subtitle: string
  /** Optional note pinned below the form, at the bottom of the screen. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-[var(--bg)] px-7">
      <div className="gt-fade mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
        <img src="/logo192.png" alt="" width={52} height={52} className="mb-7 rounded-[16px]" />
        <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] text-[var(--ink)]">
          {heading}
        </h1>
        <p className="mb-8 mt-2 text-[15px] leading-[1.5] text-[var(--ink2)]">{subtitle}</p>
        {children}
      </div>
      {footer && <div className="mx-auto w-full max-w-[420px] pb-9">{footer}</div>}
    </main>
  )
}
