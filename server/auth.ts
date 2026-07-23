import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig } from './config.ts'

const COOKIE = 'wtf_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 30

export function sessionCookieName(): string {
  return COOKIE
}

export function createSessionToken(): string {
  const { sessionSecret } = getConfig()
  const payload = `ok:${Date.now()}`
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const { sessionSecret } = getConfig()
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('hex')
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b) && payload.startsWith('ok:')
  } catch {
    return false
  }
}

export function checkPassword(password: string): boolean {
  const { appPassword } = getConfig()
  const a = Buffer.from(password)
  const b = Buffer.from(appPassword)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function sessionCookieOptions() {
  const { isProd } = getConfig()
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: MAX_AGE_SEC,
    secure: isProd,
  }
}
