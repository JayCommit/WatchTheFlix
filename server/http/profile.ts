import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AuthVariables } from '../auth-mw.ts'
import { userOwnsProfile } from '../db.ts'
import { getDefaultProfileIdForUser } from '../users.ts'

export function profileIdFrom(c: Context<{ Variables: AuthVariables }>): number {
  const user = c.get('user')
  if (!user) return 1
  const userFallback = getDefaultProfileIdForUser(user.id)
  const raw = c.req.header('x-profile-id') || getCookie(c, 'wtf_profile') || String(userFallback)
  const id = Number(raw)
  if (Number.isFinite(id) && id > 0 && userOwnsProfile(user.id, id)) return id
  return userFallback
}

export const activeProfileId = profileIdFrom
