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
    <main className="page-wrap mx-auto max-w-sm px-4 pt-20">
      <h1 className="mb-6 text-2xl font-bold text-[var(--sea-ink)]">Sign up</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          required
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-[var(--lagoon-deep)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">
        Have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  )
}
