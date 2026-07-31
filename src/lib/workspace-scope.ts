import { useSyncExternalStore } from 'react'

/** `'all'` is the Command Center (every workspace the user owns); anything else
 *  is a workspace id and scopes Home, Board, My tasks, Schedule and Reports. */
export type Scope = 'all' | (string & {})

const KEY = 'workspace-scope'

// localStorage rather than a `?ws=` search param: scope is a personal, sticky
// preference rather than a shareable address, and keeping it out of the URL
// means the five scoped routes don't each need a validated search schema.
let current: Scope = 'all'
const listeners = new Set<() => void>()

function read(): Scope {
  try {
    return (window.localStorage.getItem(KEY) as Scope | null) ?? 'all'
  } catch {
    return 'all'
  }
}

export function setScope(next: Scope) {
  if (next === current) return
  current = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    // private mode / storage disabled — scope still works for this session
  }
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  // Hydrate on first subscribe: the server render has no localStorage, so the
  // initial snapshot must be 'all' on both sides and only then settle.
  if (listeners.size === 0) {
    const stored = read()
    if (stored !== current) current = stored
  }
  listeners.add(onChange)
  function onStorage(e: StorageEvent) {
    if (e.key === KEY) {
      current = read()
      onChange()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** Current scope, shared across every component that reads it. */
export function useScope(): Scope {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'all' as Scope,
  )
}

/** True when `workspaceId` should be visible under the current scope. */
export function inScope(scope: Scope, workspaceId: string | null): boolean {
  return scope === 'all' || scope === workspaceId
}
