import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the Cloudflare plugin forces a
// worker runner that vitest can't drive. Tests run plain Node.
export default defineConfig({
  test: { environment: 'node' },
})
