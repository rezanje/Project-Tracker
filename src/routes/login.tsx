import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ChevronRight } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import AuthShell from '#/components/AuthShell'

export const Route = createFileRoute('/login')({ component: Login })

const fieldLabel = 'mb-1.5 block text-xs font-bold text-[var(--ink)]'

function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
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
    navigate({ to: '/home' })
  }

  return (
    <AuthShell
      heading="Welcome back!"
      subtitle="Track your work. Share the progress."
      mascot="Let's get things done!"
    >
      <form onSubmit={onSubmit}>
        <label htmlFor="login-email" className={fieldLabel}>
          Email
        </label>
        <div className="auth-field mb-4">
          <Mail size={17} className="auth-ic" />
          <input
            id="login-email"
            type="email"
            required
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <label htmlFor="login-password" className={fieldLabel}>
          Password
        </label>
        <div className="auth-field mb-3">
          <Lock size={17} className="auth-ic" />
          <input
            id="login-password"
            type={showPw ? 'text' : 'password'}
            required
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Hide password' : 'Show password'}
            className="auth-ic flex items-center"
          >
            {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <div className="mb-4 flex items-center justify-between text-[13px]">
          <label className="flex cursor-pointer items-center gap-2 font-semibold text-[var(--ink2)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Remember me
          </label>
          <Link to="/forgot" className="font-bold text-[var(--accent-ink)] no-underline">
            Forgot password?
          </Link>
        </div>
        {error && (
          <p className="mb-2 text-[13px] font-semibold text-[var(--danger)]">{error}</p>
        )}
        <button type="submit" disabled={loading} className="btn-pixel flex items-center justify-center gap-1.5">
          {loading ? 'Logging in…' : 'Log in'}
          {!loading && <ChevronRight size={20} strokeWidth={3} />}
        </button>
      </form>
      <p className="mt-4 text-center text-[13px] text-[var(--ink2)]">
        New here?{' '}
        <Link
          to="/signup"
          search={{ invite: undefined, winvite: undefined }}
          className="font-bold text-[var(--accent-ink)] no-underline"
        >
          Create an account
        </Link>
      </p>
      <p className="mt-4 flex items-center justify-center gap-1.5 rounded-[12px] border-2 border-[var(--ink)] bg-[var(--col)] px-3 py-2.5 text-center text-xs text-[var(--ink2)]">
        <ShieldCheck size={15} className="text-[var(--accent-ink)]" />
        Demo login: <b className="text-[var(--accent-ink)]">demo@gmail.com</b>
      </p>
    </AuthShell>
  )
}
