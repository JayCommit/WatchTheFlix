export function playUrl(
  detail: { id: number; kind: 'movie' | 'tv' },
  file: { path: string },
  opts?: { fromStart?: boolean },
): string {
  const base = `/play?path=${encodeURIComponent(file.path)}&titleId=${detail.id}&kind=${detail.kind}`
  return opts?.fromStart ? `${base}&t=0` : base
}

export function hasResume(
  file: { progress?: { position: number } | null } | undefined,
): boolean {
  return !!file?.progress && file.progress.position > 30
}
