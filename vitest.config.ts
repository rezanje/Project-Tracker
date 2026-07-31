import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the Cloudflare plugin forces a
// worker runner that vitest can't drive. Tests run plain Node.
// fileParallelism off: every test file hits the SAME remote Supabase and signs
// in a throwaway user per test. Run in parallel, the auth API rate-limits, and
// signInWithPassword fails silently — leaving anonymous clients whose writes
// then fail as confusing "violates row-level security policy" errors across
// unrelated files. Sequential is ~2min vs ~20s, but it doesn't lie.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    // Sweeps test users left behind by a timed-out or disconnected run — each
    // test cleans up in a `finally`, but that doesn't run when the process is
    // killed mid-test, and the orphans surface as pending sign-ups forever.
    globalSetup: ['./src/test/sweep-test-users.ts'],
  },
})
