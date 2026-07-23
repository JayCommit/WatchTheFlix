type Bucket = { fails: number; blockedUntil: number; windowStart: number }

const loginBuckets = new Map<string, Bucket>()

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILS = 8
const BLOCK_MS = 15 * 60 * 1000

export function loginAllowed(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const key = ip || 'unknown'
  const now = Date.now()
  const b = loginBuckets.get(key)
  if (!b) return { ok: true }
  if (b.blockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((b.blockedUntil - now) / 1000) }
  }
  if (now - b.windowStart > WINDOW_MS) {
    loginBuckets.delete(key)
  }
  return { ok: true }
}

export function recordLoginFailure(ip: string): void {
  const key = ip || 'unknown'
  const now = Date.now()
  const prev = loginBuckets.get(key)
  const windowStart =
    prev && now - prev.windowStart <= WINDOW_MS ? prev.windowStart : now
  const fails = (prev && now - prev.windowStart <= WINDOW_MS ? prev.fails : 0) + 1
  const blockedUntil = fails >= MAX_FAILS ? now + BLOCK_MS : 0
  loginBuckets.set(key, { fails, blockedUntil, windowStart })
}

export function recordLoginSuccess(ip: string): void {
  loginBuckets.delete(ip || 'unknown')
}
