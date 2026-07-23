const TAB_KEY = 'wtf_tab_client_id'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Stable per-tab id so multiple tabs do not fight over one Now Playing row. */
export function getClientId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_KEY)
    if (existing?.trim()) return existing.trim()
    const id = randomId()
    sessionStorage.setItem(TAB_KEY, id)
    return id
  } catch {
    return randomId()
  }
}
