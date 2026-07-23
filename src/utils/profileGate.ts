const GATE_KEY = 'wtf_profile_ready'

export function isProfileReady(): boolean {
  try {
    return sessionStorage.getItem(GATE_KEY) === '1'
  } catch {
    return false
  }
}

export function markProfileReady(): void {
  try {
    sessionStorage.setItem(GATE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function clearProfileReady(): void {
  try {
    sessionStorage.removeItem(GATE_KEY)
  } catch {
    /* ignore */
  }
}

const AVATAR_PALETTE = [
  ['#ff2d55', '#ff6b6b'],
  ['#5eead4', '#2dd4bf'],
  ['#60a5fa', '#3b82f6'],
  ['#fbbf24', '#f59e0b'],
  ['#a78bfa', '#8b5cf6'],
  ['#fb7185', '#e11d48'],
  ['#34d399', '#10b981'],
  ['#f472b6', '#db2777'],
]

export function profileAvatarColors(id: number): [string, string] {
  return AVATAR_PALETTE[Math.abs(id) % AVATAR_PALETTE.length] as [string, string]
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
