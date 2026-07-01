import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { getBrowserSupabase } from '#/lib/supabase/browser'

export const Route = createFileRoute('/signup')({
  validateSearch: (s: Record<string, unknown>) => ({
    invite: typeof s.invite === 'string' ? s.invite : undefined,
  }),
  component: Signup,
})

function Signup() {
  const navigate = useNavigate()
  const { invite } = Route.useSearch()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await getBrowserSupabase().auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    setLoading(false)
    if (error) return setError(error.message)
    // ponytail: invite acceptance wired in Task 7 (POST /api/accept-invite with `invite`)
    if (invite) await fetch('/api/accept-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invite }),
    }).catch(() => {})
    navigate({ to: '/' })
  }

  return (
    <main className="page-wrap flex min-h-[calc(100vh-8rem)] max-w-md items-center">
      <div className="card w-full p-7">
        <h1 className="display-title mb-1 text-2xl font-bold text-[var(--sea-ink)]">
          Create your account
        </h1>
        <p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
          Start tracking projects in GenTrack.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            required
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password (min 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
          {error && <p className="text-sm text-[#b23b3b]">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-1">
            {loading ? 'Creating…' : 'Sign up'}
          </button>
        </form>
        <p className="mt-5 text-sm text-[var(--sea-ink-soft)]">
          Have an account?{' '}
          <Link to="/login" className="font-semibold">
            Log in
          </Link>
        </p>
      </div>
    </main>
  )
}
