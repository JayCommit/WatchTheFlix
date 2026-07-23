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
    if (!timingSafeEqual(a, b) || !payload.startsWith('ok:')) return false
    const issued = Number(payload.slice(3))
    if (!Number.isFinite(issued)) return false
    const ageSec = (Date.now() - issued) / 1000
    return ageSec >= 0 && ageSec <= MAX_AGE_SEC
  } catch {
    return false
  }
}

export function checkPassword(password: string): boolean {
  const { appPassword, sessionSecret } = getConfig()
  // Hash both sides so length differences do not short-circuit.
  const a = createHmac('sha256', sessionSecret).update(password).digest()
  const b = createHmac('sha256', sessionSecret).update(appPassword).digest()
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
