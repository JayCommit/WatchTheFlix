import type { ConvertJob, ConvertNeedsFile } from '../../types'

export function formatProgress(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%'
  if (pct >= 100) return '100%'
  // Show one decimal while running for smoother feedback
  if (pct < 99.5 && pct % 1 !== 0) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

export function jobSortKey(job: ConvertJob): number {
  const order: Record<string, number> = {
    running: 0,
    cancelling: 1,
    queued: 2,
    failed: 3,
    cancelled: 4,
    skipped: 5,
    done: 6,
  }
  return order[job.status] ?? 9
}

export function jobFilename(path: string): string {
  const clean = (path || '').replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  return parts[parts.length - 1] || path || '—'
}

export function jobRelativeTime(job: ConvertJob): string {
  const raw = job.finishedAt || job.startedAt || job.createdAt
  if (!raw) return ''
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return ''
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 45) return 'just now'
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return `${Math.round(sec / 86400)}d ago`
}

export function plannedAction(file: ConvertNeedsFile): 'remux' | 'transcode' | 'unknown' {
  if (file.canDirect) return 'unknown'
  if (file.playbackMode === 'remux' || file.videoCodec === 'h264') return 'remux'
  if (file.playbackMode === 'transcode') return 'transcode'
  if (file.videoCodec && file.videoCodec !== 'h264') return 'transcode'
  return 'unknown'
}
