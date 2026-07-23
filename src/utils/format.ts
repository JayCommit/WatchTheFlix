export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatBytes(size: number | null | undefined): string {
  if (!size) return 'Direct stream'
  const mb = size / (1024 * 1024)
  if (mb > 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

export function episodeLabel(season?: number | null, episode?: number | null): string {
  if (season != null && episode != null) {
    return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
  }
  return 'Episode'
}

export function isLikelyUnsupported(filename: string): boolean {
  return /\.(mkv|avi|wmv|flv|ts|m2ts)$/i.test(filename)
}
