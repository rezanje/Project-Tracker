import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import AuthShell from '#/components/AuthShell'

export const Route = createFileRoute('/reset')({ component: Reset })

const fieldLabel = 'mb-1.5 block text-xs font-bold text-[var(--ink)]'

function Reset() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // The recovery email lands here with a PKCE `?code`. Exchange it once so
  // updateUser() runs against the recovery session.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (code) getBrowserSupabase().auth.exchangeCodeForSession(code).catch(() => {})
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('Passwords do not match.')
    setLoading(true)
    setError(null)
    const { error } = await getBrowserSupabase().auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(error.message)
    setDone(true)
  }

  if (done) {
    return (
      <AuthShell heading="Password updated" subtitle="You can log in with your new password.">
        <Link to="/login" className="btn-pixel block text-center no-underline">
          Back to log in
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell heading="Set a new password" subtitle="Choose a password you'll remember.">
      <form onSubmit={onSubmit}>
        <label htmlFor="reset-password" className={fieldLabel}>
          New password
        </label>
        <div className="auth-field mb-4">
          <Lock size={17} className="auth-ic" />
          <input
            id="reset-password"
            type={showPw ? 'text' : 'password'}
            required
            minLength={6}
            placeholder="At least 6 characters"
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
        <label htmlFor="reset-confirm" className={fieldLabel}>
          Confirm password
        </label>
        <div className="auth-field mb-3">
          <Lock size={17} className="auth-ic" />
          <input
            id="reset-confirm"
            type={showPw ? 'text' : 'password'}
            required
            minLength={6}
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <p className="mb-2 text-[13px] font-semibold text-[var(--danger)]">{error}</p>}
        <button type="submit" disabled={loading} className="btn-pixel">
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  )
}
