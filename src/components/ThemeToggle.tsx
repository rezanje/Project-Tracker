import { useEffect, useState } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'

type ThemeMode = 'light' | 'dark' | 'auto'

// Default to light: the meadow design is a light palette, so a fresh visitor
// should see it even on a dark-mode OS. Dark stays reachable via the toggle.
function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const stored = window.localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }

  return 'light'
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(resolved)

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', mode)
  }

  document.documentElement.style.colorScheme = resolved
}

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const initialMode = getInitialMode()
    setMode(initialMode)
    applyThemeMode(initialMode)
  }, [])

  useEffect(() => {
    if (mode !== 'auto') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyThemeMode('auto')

    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [mode])

  function toggleMode() {
    const nextMode: ThemeMode =
      mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light'
    setMode(nextMode)
    applyThemeMode(nextMode)
    window.localStorage.setItem('theme', nextMode)
  }

  const label =
    mode === 'auto'
      ? 'Theme mode: auto (system). Click to switch to light mode.'
      : `Theme mode: ${mode}. Click to switch mode.`

  const Icon = mode === 'auto' ? SunMoon : mode === 'dark' ? Moon : Sun
  const size = compact ? 15 : 16

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={label}
      title={label}
      className={`flex items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] text-[var(--ink2)] transition hover:border-[var(--accent)] hover:text-[var(--ink)] ${
        compact ? 'h-8 w-8' : 'h-9 w-9'
      }`}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  )
}
