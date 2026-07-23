import { existsSync } from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { assertWebdavConfig, getConfig } from '../config.ts'

export function binFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH
  }
  const p = ffmpegStatic as unknown as string | null
  if (!p) throw new Error('ffmpeg binary missing — install ffmpeg or ffmpeg-static')
  return p
}

export function binFfprobe(): string {
  if (process.env.FFPROBE_PATH && existsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH
  }
  const mod = ffprobeStatic as unknown as { path?: string }
  const p = mod?.path
  if (!p) throw new Error('ffprobe binary missing — install ffmpeg or ffprobe-static')
  return p
}

export function ffmpegAvailable(): boolean {
  try {
    return Boolean(binFfmpeg() && binFfprobe())
  } catch {
    return false
  }
}

/** Resolve preferred H.264 encoder (software or hardware). */
export function resolveHwEncoder(): string {
  const pref = getConfig().ffmpegHw
  if (pref === 'none' || pref === 'software') return 'libx264'
  if (pref === 'nvenc') return 'h264_nvenc'
  if (pref === 'vaapi') return 'h264_vaapi'
  if (pref === 'qsv') return 'h264_qsv'
  // auto: prefer env hint, else libx264 (safe default — NVENC fails hard if missing)
  return 'libx264'
}

/** Build an authenticated HTTP URL for a WebDAV library path (used by probe/ffmpeg). */
export function webdavHttpUrl(path: string): { url: string; authHeader: string } {
  const c = getConfig()
  assertWebdavConfig(c)
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const encoded = cleanPath
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(seg) : ''))
    .join('/')
  return {
    url: `${c.webdavUrl}${encoded}`,
    authHeader: 'Basic ' + Buffer.from(`${c.webdavUser}:${c.webdavPassword}`).toString('base64'),
  }
}
