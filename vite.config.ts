import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Vite's default host resolution can bind IPv6-only ([::1]) on some
  // machines, refusing 127.0.0.1 connections. `host: true` binds all
  // interfaces (IPv4 + IPv6) so `localhost` resolves either way.
  // `PORT` is set by the harness's launch.json autoPort mechanism — without
  // reading it, vite falls back to its own default (5173) and the preview
  // proxy ends up pointed at a port nothing is listening on.
  server: { host: true, port: Number(process.env.PORT) || 4321 },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
