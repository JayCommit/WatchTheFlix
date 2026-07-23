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

export function plannedAction(file: ConvertNeedsFile): 'remux' | 'transcode' | 'unknown' {
  if (file.canDirect) return 'unknown'
  if (file.playbackMode === 'remux' || file.videoCodec === 'h264') return 'remux'
  if (file.playbackMode === 'transcode') return 'transcode'
  if (file.videoCodec && file.videoCodec !== 'h264') return 'transcode'
  return 'unknown'
}
