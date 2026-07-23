/** Guess a short quality/version label from a media filename. */
export function versionLabel(filename: string): string {
  const f = filename.toLowerCase()
  if (/\b(2160p|4k|uhd)\b/.test(f)) return '4K'
  if (/\b1440p\b/.test(f)) return '1440p'
  if (/\b1080p\b/.test(f)) return '1080p'
  if (/\b720p\b/.test(f)) return '720p'
  if (/\b480p\b/.test(f)) return '480p'
  if (/\bremux\b/.test(f)) return 'Remux'
  if (/\bweb-?dl\b/.test(f)) return 'WEB-DL'
  if (/\bbluray|blu-ray|bdrip\b/.test(f)) return 'BluRay'
  if (/\bh\.?265|hevc|x265\b/.test(f)) return 'HEVC'
  if (/\bh\.?264|x264|avc\b/.test(f)) return 'H.264'
  if (/\bbrowser\b/.test(f) || /\.browser\.mp4$/i.test(filename)) return 'Web'
  const ext = filename.split('.').pop()?.toUpperCase()
  return ext || 'File'
}

export function qualityRank(filename: string): number {
  const label = versionLabel(filename)
  const order = ['4K', '1440p', '1080p', 'Remux', 'BluRay', 'WEB-DL', '720p', 'HEVC', 'H.264', 'Web', '480p']
  const i = order.indexOf(label)
  return i >= 0 ? order.length - i : 0
}
