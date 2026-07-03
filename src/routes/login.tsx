import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import AuthShell from '#/components/AuthShell'

export const Route = createFileRoute('/login')({ component: Login })

const fieldLabel = 'mb-1.5 block text-xs font-bold text-[var(--ink2)]'

function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await getBrowserSupabase().auth.signInWithPassword({
      email,
      password,
    })
    setLoading(false)
    if (error) return setError(error.message)
    navigate({ to: '/' })
  }

  async function onGoogle() {
    setError(null)
    const { error } = await getBrowserSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setError(error.message)
  }

  return (
    <AuthShell heading="Welcome back" subtitle="Track your work. Share the progress.">
      <button type="button" onClick={onGoogle} className="btn btn-ghost btn-square mb-4 w-full">
        Continue with Google
      </button>
      <div className="mb-4 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-[var(--ink3)]">
        <span className="h-px flex-1 bg-[var(--line)]" /> or <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
      <form onSubmit={onSubmit}>
        <label htmlFor="login-email" className={fieldLabel}>
          Email
        </label>
        <input
          id="login-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field mb-4"
        />
        <label htmlFor="login-password" className={fieldLabel}>
          Password
        </label>
        <input
          id="login-password"
          type="password"
          required
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
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-[18px] text-center text-[13px] text-[var(--ink2)]">
        New here?{' '}
        <Link
          to="/signup"
          search={{ invite: undefined }}
          className="font-bold text-[var(--accent-ink)] no-underline"
        >
          Create an account
        </Link>
      </p>
      <p className="mt-[18px] rounded-[12px] bg-[var(--col)] px-3 py-2.5 text-center text-xs text-[var(--ink2)]">
        Demo login: <b className="text-[var(--ink)]">demo@gmail.com</b>
      </p>
    </AuthShell>
  )
}
