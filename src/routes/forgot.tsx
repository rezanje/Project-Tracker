import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Mail } from 'lucide-react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import AuthShell from '#/components/AuthShell'

export const Route = createFileRoute('/forgot')({ component: Forgot })

const fieldLabel = 'mb-1.5 block text-xs font-bold text-[var(--ink)]'

function Forgot() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await getBrowserSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset`,
    })
    setLoading(false)
    if (error) return setError(error.message)
    setSent(true)
  }

  if (sent) {
    return (
      <AuthShell heading="Check your email" subtitle={`We sent a reset link to ${email}.`}>
        <p className="text-center text-[13px] text-[var(--ink2)]">
          Click the link in that email to set a new password. Don&apos;t see it? Check your spam folder.
        </p>
        <Link to="/login" className="btn-pixel mt-4 block text-center no-underline">
          Back to log in
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell heading="Forgot password?" subtitle="We'll email you a link to reset it.">
      <form onSubmit={onSubmit}>
        <label htmlFor="forgot-email" className={fieldLabel}>
          Email
        </label>
        <div className="auth-field mb-4">
          <Mail size={17} className="auth-ic" />
          <input
            id="forgot-email"
            type="email"
            required
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="mb-2 text-[13px] font-semibold text-[var(--danger)]">{error}</p>}
        <button type="submit" disabled={loading} className="btn-pixel">
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="mt-4 text-center text-[13px] text-[var(--ink2)]">
        Remembered it?{' '}
        <Link to="/login" className="font-bold text-[var(--accent-ink)] no-underline">
          Back to log in
        </Link>
      </p>
    </AuthShell>
  )
}
