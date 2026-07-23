export function modeBadge(
  mode: string | null | undefined,
  canDirect: boolean | null | undefined,
  probeError?: string | null,
) {
  if (probeError && !mode) return <span className="codec-badge bad">Probe failed</span>
  if (canDirect) return <span className="codec-badge ok">Direct</span>
  if (mode === 'remux') return <span className="codec-badge warn">Remux</span>
  if (mode === 'transcode') return <span className="codec-badge bad">Transcode</span>
  if (!mode) return <span className="codec-badge muted">Unknown</span>
  return <span className="codec-badge muted">{mode}</span>
}

export function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return <span className="codec-badge warn">Running</span>
  if (s === 'queued') return <span className="codec-badge muted">Queued</span>
  if (s === 'done') return <span className="codec-badge ok">Done</span>
  if (s === 'failed') return <span className="codec-badge bad">Failed</span>
  if (s === 'cancelled' || s === 'cancelling') return <span className="codec-badge muted">Cancelled</span>
  if (s === 'skipped') return <span className="codec-badge ok">Skipped</span>
  return <span className="codec-badge muted">{status}</span>
}
