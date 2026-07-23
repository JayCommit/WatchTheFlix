const STORAGE_KEY = 'wtf_client_id'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Stable per-browser id for playback presence (shared-password “viewer”). */
export function getClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing?.trim()) return existing.trim()
    const id = randomId()
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    return randomId()
  }
}
