import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import {
  createSessionToken,
  sessionCookieName,
  sessionCookieOptions,
  verifySessionToken,
  type SessionUser,
} from './auth.ts'
import { getDefaultProfileIdForUser } from './users.ts'

export type AuthVariables = {
  authed: boolean
  user: SessionUser | null
}

export function attachSession(c: Context<{ Variables: AuthVariables }>): void {
  const token = getCookie(c, sessionCookieName())
  const user = verifySessionToken(token)
  c.set('user', user)
  c.set('authed', Boolean(user))
}

export function requireAuth(c: Context<{ Variables: AuthVariables }>) {
  if (!c.get('user')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return null
}

export function requireAdmin(c: Context<{ Variables: AuthVariables }>) {
  const denied = requireAuth(c)
  if (denied) return denied
  if (c.get('user')!.role !== 'admin') {
    return c.json({ error: 'Admin only' }, 403)
  }
  return null
}

export function issueSession(c: Context, userId: number): void {
  const token = createSessionToken(userId)
  setCookie(c, sessionCookieName(), token, sessionCookieOptions())
  const profileId = getDefaultProfileIdForUser(userId)
  setCookie(c, 'wtf_profile', String(profileId), {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'Lax',
  })
}
