import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })

// Use the same DB file as db.ts — import helpers after tables exist via migrateUsers called from db
// To avoid circular imports, this module opens the same sqlite file.
const db = new DatabaseSync(join(dataDir, 'library.db'))

export type UserRole = 'admin' | 'user'

export type UserRow = {
  id: number
  username: string
  password_hash: string
  role: UserRole
  disabled: number
  created_at: string
  updated_at: string
}

export type PublicUser = {
  id: number
  username: string
  role: UserRole
  disabled: boolean
  createdAt: string
  updatedAt: string
}

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

export function migrateUsers(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'`)
    .get() as { name: string } | undefined
  if (tables) {
    const cols = db.prepare(`PRAGMA table_info(profiles)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'user_id')) {
      db.exec(`ALTER TABLE profiles ADD COLUMN user_id INTEGER`)
    }
  }
}

migrateUsers()

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

export function validateUsername(username: string): string | null {
  const u = username.trim()
  if (u.length < 3 || u.length > 32) return 'Username must be 3–32 characters'
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) {
    return 'Username may only use letters, numbers, dots, underscores, and hyphens'
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (password.length > 128) return 'Password is too long'
  return null
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex')
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$')
    if (parts[0] !== 'scrypt' || parts.length !== 6) return false
    const N = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    const salt = parts[4]!
    const expectedHex = parts[5]!
    const actual = scryptSync(password, salt, KEYLEN, { N, r, p })
    const expected = Buffer.from(expectedHex, 'hex')
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function countUsers(): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c
}

export function countAdmins(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0`).get() as {
      c: number
    }
  ).c
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined
}

export function getUserByUsername(username: string): UserRow | undefined {
  return db
    .prepare(`SELECT * FROM users WHERE lower(username) = ?`)
    .get(normalizeUsername(username)) as UserRow | undefined
}

export function listUsers(): PublicUser[] {
  const rows = db
    .prepare(`SELECT * FROM users ORDER BY created_at ASC`)
    .all() as UserRow[]
  return rows.map(toPublicUser)
}

export function createUser(
  username: string,
  password: string,
  role: UserRole,
): UserRow {
  const nameErr = validateUsername(username)
  if (nameErr) throw new Error(nameErr)
  const passErr = validatePassword(password)
  if (passErr) throw new Error(passErr)
  if (getUserByUsername(username)) throw new Error('Username already taken')

  const firstUser = countUsers() === 0
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, disabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(username.trim(), hashPassword(password), role, now, now)

  const user = getUserById(Number(result.lastInsertRowid))
  if (!user) throw new Error('Failed to create user')

  // Personal profile for this account (first admin inherits any pre-auth Default profile)
  ensureUserProfile(user.id, user.username, { claimOrphans: firstUser })
  return user
}

export function ensureUserProfile(
  userId: number,
  username: string,
  opts?: { claimOrphans?: boolean },
): number {
  if (opts?.claimOrphans) {
    db.prepare(`UPDATE profiles SET user_id = ? WHERE user_id IS NULL`).run(userId)
  }

  const existing = db
    .prepare(`SELECT id FROM profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1`)
    .get(userId) as { id: number } | undefined
  if (existing) return existing.id

  const label = (username.trim() || `User ${userId}`).slice(0, 32)
  const name = `${label} (#${userId})`
  const result = db
    .prepare(`INSERT INTO profiles (name, created_at, user_id) VALUES (?, ?, ?)`)
    .run(name, new Date().toISOString(), userId)
  return Number(result.lastInsertRowid)
}

export function getDefaultProfileIdForUser(userId: number): number {
  const user = getUserById(userId)
  if (!user) return 1
  return ensureUserProfile(userId, user.username)
}

export function updateUser(
  id: number,
  patch: { role?: UserRole; disabled?: boolean; password?: string },
): UserRow {
  const cur = getUserById(id)
  if (!cur) throw new Error('User not found')

  let role = cur.role
  let disabled = cur.disabled
  let passwordHash = cur.password_hash

  if (patch.role && patch.role !== cur.role) {
    if (cur.role === 'admin' && patch.role === 'user' && countAdmins() <= 1) {
      throw new Error('Cannot demote the last admin')
    }
    role = patch.role
  }
  if (patch.disabled != null) {
    if (patch.disabled && cur.role === 'admin' && !cur.disabled && countAdmins() <= 1) {
      throw new Error('Cannot disable the last admin')
    }
    disabled = patch.disabled ? 1 : 0
  }
  if (patch.password != null) {
    const passErr = validatePassword(patch.password)
    if (passErr) throw new Error(passErr)
    passwordHash = hashPassword(patch.password)
  }

  db.prepare(
    `UPDATE users SET role = ?, disabled = ?, password_hash = ?, updated_at = ? WHERE id = ?`,
  ).run(role, disabled, passwordHash, new Date().toISOString(), id)

  return getUserById(id)!
}

export function deleteUser(id: number, actorId: number): void {
  if (id === actorId) throw new Error('Cannot delete your own account')
  const cur = getUserById(id)
  if (!cur) throw new Error('User not found')
  if (cur.role === 'admin' && countAdmins() <= 1) {
    throw new Error('Cannot delete the last admin')
  }
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id)
}

export function authenticateUser(username: string, password: string): UserRow | null {
  const user = getUserByUsername(username)
  if (!user || user.disabled) return null
  if (!verifyPassword(password, user.password_hash)) return null
  return user
}
