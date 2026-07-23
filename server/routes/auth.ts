import type { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { sessionCookieName } from '../auth.ts'
import { issueSession, requireAdmin, type AuthVariables } from '../auth-mw.ts'
import { getConfig } from '../config.ts'
import { loginAllowed, recordLoginFailure, recordLoginSuccess } from '../rate-limit.ts'
import {
  authenticateUser,
  countUsers,
  createUser,
  deleteUser,
  listUsers,
  toPublicUser,
  updateUser,
} from '../users.ts'

type Vars = { Variables: AuthVariables }

export function registerAuthRoutes(app: Hono<Vars>): void {
  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/auth/status', (c) => {
    const hasUsers = countUsers() > 0
    const allowRegister = !hasUsers || getConfig().allowPublicRegistration
    return c.json({
      hasUsers,
      allowRegister,
      setupRequired: !hasUsers,
    })
  })

  app.get('/api/me', (c) => {
    const user = c.get('user')
    return c.json({
      authed: Boolean(user),
      user: user ?? null,
      setupRequired: countUsers() === 0,
    })
  })

  app.post('/api/auth/register', async (c) => {
    const ip =
      c.req.header('x-real-ip')?.trim() ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      'local'
    const gate = loginAllowed(ip)
    if (!gate.ok) {
      return c.json(
        { error: `Too many failed attempts. Try again in ${gate.retryAfterSec}s.` },
        429,
      )
    }

    const hasUsers = countUsers() > 0
    if (hasUsers && !getConfig().allowPublicRegistration) {
      return c.json({ error: 'Public registration is disabled. Ask an admin for an account.' }, 403)
    }

    const body = await c.req
      .json<{ username?: string; password?: string }>()
      .catch(() => null)
    if (!body?.username || !body.password) {
      return c.json({ error: 'username and password required' }, 400)
    }

    try {
      const role = hasUsers ? 'user' : 'admin'
      const user = createUser(body.username, body.password, role)
      issueSession(c, user.id)
      recordLoginSuccess(ip)
      return c.json({
        ok: true,
        user: toPublicUser(user),
        createdAdmin: role === 'admin',
      })
    } catch (err) {
      recordLoginFailure(ip)
      return c.json({ error: err instanceof Error ? err.message : 'Registration failed' }, 400)
    }
  })

  app.post('/api/login', async (c) => {
    const ip =
      c.req.header('x-real-ip')?.trim() ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      'local'
    const gate = loginAllowed(ip)
    if (!gate.ok) {
      return c.json(
        { error: `Too many failed attempts. Try again in ${gate.retryAfterSec}s.` },
        429,
      )
    }

    if (countUsers() === 0) {
      return c.json(
        { error: 'No accounts yet. Create the first admin account to continue.', setupRequired: true },
        400,
      )
    }

    const body = await c.req
      .json<{ username?: string; password?: string }>()
      .catch(() => null)
    if (!body?.username || !body.password) {
      return c.json({ error: 'username and password required' }, 400)
    }

    const user = authenticateUser(body.username, body.password)
    if (!user) {
      recordLoginFailure(ip)
      return c.json({ error: 'Invalid username or password' }, 401)
    }
    recordLoginSuccess(ip)
    issueSession(c, user.id)
    return c.json({ ok: true, user: toPublicUser(user) })
  })

  app.post('/api/logout', (c) => {
    deleteCookie(c, sessionCookieName(), { path: '/' })
    deleteCookie(c, 'wtf_profile', { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/admin/users', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    return c.json({ users: listUsers() })
  })

  app.post('/api/admin/users', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const body = await c.req
      .json<{ username?: string; password?: string; role?: 'admin' | 'user' }>()
      .catch(() => null)
    if (!body?.username || !body.password) {
      return c.json({ error: 'username and password required' }, 400)
    }
    try {
      const user = createUser(body.username, body.password, body.role === 'admin' ? 'admin' : 'user')
      return c.json({ user: toPublicUser(user) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Create failed' }, 400)
    }
  })

  app.patch('/api/admin/users/:id', async (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    const body = await c.req
      .json<{ role?: 'admin' | 'user'; disabled?: boolean; password?: string }>()
      .catch(() => null)
    if (!body) return c.json({ error: 'Invalid JSON' }, 400)
    try {
      const user = updateUser(id, body)
      return c.json({ user: toPublicUser(user) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Update failed' }, 400)
    }
  })

  app.delete('/api/admin/users/:id', (c) => {
    const denied = requireAdmin(c)
    if (denied) return denied
    const id = Number(c.req.param('id'))
    const actor = c.get('user')!
    try {
      deleteUser(id, actor.id)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Delete failed' }, 400)
    }
  })
}
