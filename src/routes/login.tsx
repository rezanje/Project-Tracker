import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import AuthShell from '#/components/AuthShell'

export const Route = createFileRoute('/login')({ component: Login })

const fieldLabel = 'mb-2 block text-[12.5px] font-semibold text-[var(--ink2)]'

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
      heading="Welcome back"
      subtitle="Track your work. Share the progress."
      footer={
        <p className="flex items-center justify-center gap-2.5 rounded-[18px] bg-[var(--col)] px-4 py-3.5 text-center text-[12.5px] leading-[1.45] text-[var(--ink2)]">
          <ShieldCheck size={17} className="shrink-0 text-[var(--ink2)]" />
          Demo login: <b className="font-bold text-[var(--ink)]">demo@gmail.com</b>
        </p>
      }
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
        <div className="mb-7 flex items-center justify-between text-[13.5px]">
          <label className="flex cursor-pointer items-center gap-2.5 font-medium text-[var(--ink2)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-5 w-5 rounded-[7px] accent-[var(--ink)]"
            />
            Remember me
          </label>
          <Link to="/forgot" className="font-semibold text-[var(--ink2)] no-underline">
            Forgot password?
          </Link>
        </div>
        {error && (
          <p className="mb-3 text-[13px] font-semibold text-[var(--danger)]">{error}</p>
        )}
        <button type="submit" disabled={loading} className="btn-auth flex items-center justify-center gap-1.5">
          {loading ? 'Logging in…' : 'Log in'}
          {!loading && <ChevronRight size={18} strokeWidth={2.5} />}
        </button>
      </form>
      <p className="mt-6 text-center text-[14px] text-[var(--ink2)]">
        New here?{' '}
        <Link
          to="/signup"
          search={{ invite: undefined, winvite: undefined }}
          className="font-bold text-[var(--ink)] no-underline"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  )
}
