import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { getBrowserSupabase } from '#/lib/supabase/browser'

export const Route = createFileRoute('/login')({ component: Login })

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

  return (
    <main className="page-wrap mx-auto max-w-sm px-4 pt-20">
      <h1 className="mb-6 text-2xl font-bold text-[var(--sea-ink)]">Log in</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">
        No account? <Link to="/signup" search={{ invite: undefined }}>Sign up</Link>
      </p>
    </main>
  )
}
