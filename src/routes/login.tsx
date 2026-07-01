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
    <main className="page-wrap flex min-h-[calc(100vh-8rem)] max-w-md items-center">
      <div className="card w-full p-7">
        <h1 className="display-title mb-1 text-2xl font-bold text-[var(--sea-ink)]">
          Welcome back
        </h1>
        <p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
          Log in to your GenTrack boards.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
          {error && <p className="text-sm text-[#b23b3b]">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-1">
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="mt-5 text-sm text-[var(--sea-ink-soft)]">
          No account?{' '}
          <Link to="/signup" search={{ invite: undefined }} className="font-semibold">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  )
}
