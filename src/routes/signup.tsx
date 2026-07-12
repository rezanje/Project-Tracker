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
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('Passwords do not match.')
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
          className="field mb-4"
        />
        <label htmlFor="signup-confirm" className={fieldLabel}>
          Confirm password
        </label>
        <input
          id="signup-confirm"
          type="password"
          required
          minLength={6}
          placeholder="Re-enter your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="field mb-2.5"
          aria-invalid={confirm.length > 0 && confirm !== password}
        />
        {confirm.length > 0 && confirm !== password && (
          <p className="mb-2 text-[13px] font-semibold text-[var(--danger)]">Passwords do not match.</p>
        )}
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
