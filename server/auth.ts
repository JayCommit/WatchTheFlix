import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig } from './config.ts'
import { getUserById, type PublicUser, type UserRow, toPublicUser } from './users.ts'

const COOKIE = 'wtf_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 30

export type SessionUser = PublicUser

export function sessionCookieName(): string {
  return COOKIE
}

export function sessionMaxAgeSec(): number {
  return MAX_AGE_SEC
}

/** Signed session: userId:issuedAt.hmac */
export function createSessionToken(userId: number): string {
  const { sessionSecret } = getConfig()
  const payload = `${userId}:${Date.now()}`
  const sig = createHmac('sha256', sessionSecret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifySessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const { sessionSecret } = getConfig()
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('hex')
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    const [idRaw, issuedRaw] = payload.split(':')
    const userId = Number(idRaw)
    const issued = Number(issuedRaw)
    if (!Number.isFinite(userId) || !Number.isFinite(issued)) return null
    const ageSec = (Date.now() - issued) / 1000
    if (ageSec < 0 || ageSec > MAX_AGE_SEC) return null

    const user = getUserById(userId)
    if (!user || user.disabled) return null
    return toPublicUser(user)
  } catch {
    return null
  }
}

/** @deprecated Shared APP_PASSWORD — only for emergency bootstrap messaging */
export function legacyAppPasswordConfigured(): boolean {
  const { appPassword } = getConfig()
  return Boolean(appPassword && appPassword !== 'changeme')
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

export function isAdmin(user: SessionUser | UserRow | null | undefined): boolean {
  return user?.role === 'admin' && !(user as { disabled?: boolean | number }).disabled
}
