import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import AuthShell from '#/components/AuthShell'

export const Route = createFileRoute('/signup')({
  validateSearch: (s: Record<string, unknown>) => ({
    invite: typeof s.invite === 'string' ? s.invite : undefined,
    winvite: typeof s.winvite === 'string' ? s.winvite : undefined,
  }),
  component: Signup,
})

const fieldLabel = 'mb-1.5 block text-xs font-bold text-[var(--ink2)]'

function Signup() {
  const navigate = useNavigate()
  const { invite, winvite } = Route.useSearch()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error } = await getBrowserSupabase().auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    setLoading(false)
    if (error) return setError(error.message)
    // No session back means email confirmation is required before login works.
    if (!data.session) return setConfirmSent(true)
    // Accept a pending board (invite) and/or workspace (winvite) invite.
    if (invite || winvite) await fetch('/api/accept-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite, wtoken: winvite }),
    }).catch(() => {})
    navigate({ to: '/' })
  }

  async function onGoogle() {
    setError(null)
    // ponytail: invite+Google not wired — the token is dropped on OAuth redirect.
    // Owner sign-in (the current need) doesn't use invites; wire via redirectTo
    // query + callback accept-invite if client OAuth onboarding is needed later.
    const { error } = await getBrowserSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setError(error.message)
  }

  if (confirmSent) {
    return (
      <AuthShell heading="Check your email" subtitle={`We sent a confirmation link to ${email}.`}>
        <p className="text-center text-[13px] text-[var(--ink2)]">
          Click the link in that email to activate your account, then come back and log in.
          Don&apos;t see it? Check your spam folder.
        </p>
        <Link to="/login" className="btn btn-primary btn-square mt-4 block w-full text-center no-underline">
          Back to log in
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      heading="Create your account"
      subtitle="Start tracking projects in minutes."
    >
      <button type="button" onClick={onGoogle} className="btn btn-ghost btn-square mb-4 w-full">
        Continue with Google
      </button>
      <div className="mb-4 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
        <span className="h-px flex-1 bg-[var(--line)]" /> or <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
      <form onSubmit={onSubmit}>
        <label htmlFor="signup-name" className={fieldLabel}>
          Name
        </label>
        <input
          id="signup-name"
          required
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field mb-4"
        />
        <label htmlFor="signup-email" className={fieldLabel}>
          Email
        </label>
        <input
          id="signup-email"
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field mb-4"
        />
        <label htmlFor="signup-password" className={fieldLabel}>
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          required
          minLength={6}
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field mb-2.5"
        />
        {error && (
          <p className="mb-2 text-[13px] font-semibold text-[var(--danger)]">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary btn-square mt-2 w-full"
        >
          {loading ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="mt-[18px] text-center text-[13px] text-[var(--ink2)]">
        Already have an account?{' '}
        <Link to="/login" className="font-bold text-[var(--accent-ink)] no-underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  )
}
