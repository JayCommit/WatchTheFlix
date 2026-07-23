import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { resolveLocalPath } from './mediafs.ts'
import type { SubtitleTrack } from './playback.ts'

const SIDECAR_EXT = new Set(['.vtt', '.srt'])

/** Very small SRT → WebVTT converter (good enough for common dumps). */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r\n/g, '\n')
    .replace(/^\uFEFF/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return body.startsWith('WEBVTT') ? body : `WEBVTT\n\n${body}`
}

export function listExternalSubtitles(libraryPath: string): SubtitleTrack[] {
  const local = resolveLocalPath(libraryPath)
  if (!local) return []
  const dir = dirname(local)
  const base = basename(local, extname(local))
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const tracks: SubtitleTrack[] = []
  let i = 0
  for (const name of entries) {
    const ext = extname(name).toLowerCase()
    if (!SIDECAR_EXT.has(ext)) continue
    const stem = basename(name, ext)
    if (stem !== base && !stem.startsWith(`${base}.`) && !stem.startsWith(`${base}-`)) continue
    if (!existsSync(join(dir, name))) continue
    const langMatch = stem.slice(base.length).replace(/^[-.]/, '')
    tracks.push({
      index: 10_000 + i,
      codec: ext.slice(1),
      language: langMatch || null,
      title: name,
      kind: 'external',
      path: join(dir, name).replace(/\\/g, '/'),
    })
    i += 1
  }
  return tracks
}

export function readExternalSubtitleVtt(sidecarPath: string): string {
  const raw = readFileSync(sidecarPath, 'utf8')
  const ext = extname(sidecarPath).toLowerCase()
  if (ext === '.vtt') return raw.startsWith('WEBVTT') ? raw : `WEBVTT\n\n${raw}`
  return srtToVtt(raw)
}
