import type { AdminTitle } from '../types'

export class AuthError extends Error {
  constructor(message = 'Session expired') {
    super(message)
    this.name = 'AuthError'
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers,
  })
  // /api/me returns 200 with { authed: false } — only treat protected routes as session loss
  if (
    res.status === 401 &&
    !url.endsWith('/api/me') &&
    !url.includes('/api/login') &&
    !url.includes('/api/auth/')
  ) {
    window.dispatchEvent(new Event('wtf:unauthorized'))
    throw new AuthError('Session expired — please sign in again')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export function normalizeAdminTitle(
  t: AdminTitle & { fileCount?: number; unmatched?: boolean },
): AdminTitle {
  return {
    ...t,
    fileCount: t.fileCount ?? 0,
    unmatched: t.unmatched ?? t.tmdbId < 0,
    hidden: Boolean(t.hidden),
  }
}
