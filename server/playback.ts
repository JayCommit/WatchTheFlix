import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { assertWebdavConfig, getConfig } from './config.ts'
import { resolveLocalPath } from './mediafs.ts'

export type PlaybackMode = 'direct' | 'remux' | 'transcode'

export type AudioTrack = {
  index: number
  codec: string | null
  language: string | null
  title: string | null
  channels: number | null
}

export type SubtitleTrack = {
  index: number
  codec: string | null
  language: string | null
  title: string | null
  kind: 'embedded' | 'external'
  /** For external tracks: library-relative or absolute path to sidecar */
  path?: string
}

export type StreamInfo = {
  mode: PlaybackMode
  ffmpegAvailable: boolean
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  duration: number | null
  width: number | null
  height: number | null
  reason: string
  canDirect: boolean
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  hwEncoder: string | null
}

type ProbeStream = {
  index?: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  channels?: number
  duration?: string
  tags?: Record<string, string>
}

type ProbeResult = {
  format?: {
    format_name?: string
    duration?: string
  }
  streams?: ProbeStream[]
}

const probeCache = new Map<string, { at: number; info: StreamInfo; raw: ProbeResult }>()
const CACHE_MS = 10 * 60 * 1000

const DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm'])
const DIRECT_VIDEO = new Set(['h264', 'avc', 'vp8', 'vp9', 'av1'])
const DIRECT_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const COPY_VIDEO = new Set(['h264', 'avc', 'mpeg4'])
const COPY_AUDIO = new Set(['aac', 'mp3'])

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

function normalizeCodec(name?: string | null): string | null {
  if (!name) return null
  const n = name.toLowerCase()
  if (n === 'avc1' || n === 'avc') return 'h264'
  if (n === 'hev1' || n === 'h265') return 'hevc'
  return n
}

function containerFromFormat(formatName?: string, filename?: string): string | null {
  if (formatName) {
    const parts = formatName.split(',').map((s) => s.trim().toLowerCase())
    if (parts.some((p) => p.includes('matroska') || p === 'mkv')) return 'mkv'
    if (parts.some((p) => p === 'mp4' || p === 'mov' || p === 'isom')) return 'mp4'
    if (parts.some((p) => p === 'webm')) return 'webm'
    if (parts.some((p) => p === 'avi')) return 'avi'
    if (parts.some((p) => p === 'mpegts' || p === 'mpeg')) return 'mpegts'
    return parts[0] ?? null
  }
  const ext = filename?.split('.').pop()?.toLowerCase()
  return ext ?? null
}

function decideMode(
  container: string | null,
  video: string | null,
  audio: string | null,
): { mode: PlaybackMode; reason: string; canDirect: boolean } {
  const c = container ?? ''
  const v = video ?? ''
  const a = audio ?? ''

  const containerOk = DIRECT_CONTAINERS.has(c) || c === 'mov'
  const videoOk = DIRECT_VIDEO.has(v)
  const audioOk = !a || DIRECT_AUDIO.has(a)
  const canDirect = containerOk && videoOk && audioOk

  if (canDirect) {
    return { mode: 'direct', reason: 'Browser-native container and codecs', canDirect: true }
  }

  if (!ffmpegAvailable()) {
    return {
      mode: 'direct',
      reason: 'FFmpeg unavailable — attempting direct play (may fail for MKV/AVI)',
      canDirect: false,
    }
  }

  if (COPY_VIDEO.has(v)) {
    if (COPY_AUDIO.has(a) || !a) {
      return {
        mode: 'remux',
        reason: `${c || 'container'} to MP4 remux (copy, no quality loss)`,
        canDirect: false,
      }
    }
    return {
      mode: 'remux',
      reason: `${c || 'container'} to MP4 (video copy, audio to AAC)`,
      canDirect: false,
    }
  }

  return {
    mode: 'transcode',
    reason: `${v || 'video'}/${a || 'audio'} to H.264 + AAC for browser playback`,
    canDirect: false,
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

/** Args that must appear before `-i` (VAAPI device init). */
function preInputHwArgs(mode: 'remux' | 'transcode'): string[] {
  if (mode !== 'transcode') return []
  if (resolveHwEncoder() === 'h264_vaapi') {
    return ['-vaapi_device', '/dev/dri/renderD128']
  }
  return []
}

function videoEncodeArgs(mode: 'remux' | 'transcode'): string[] {
  if (mode === 'remux') return ['-c:v', 'copy']
  const enc = resolveHwEncoder()
  if (enc === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p']
  }
  if (enc === 'h264_vaapi') {
    return ['-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-qp', '23']
  }
  if (enc === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23']
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p']
}

async function runFfprobe(path: string): Promise<ProbeResult> {
  const local = resolveLocalPath(path)
  const args = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json']

  if (local) {
    args.push(local)
  } else {
    const { url, authHeader } = webdavHttpUrl(path)
    args.splice(2, 0, '-headers', `Authorization: ${authHeader}\r\n`)
    args.push(url)
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(binFfprobe(), args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as ProbeResult)
      } catch (err) {
        reject(err)
      }
    })
  })
}

export function clearProbeCache(path?: string): void {
  if (path) probeCache.delete(path)
  else probeCache.clear()
}

function tagLang(tags?: Record<string, string>): string | null {
  if (!tags) return null
  return tags.language || tags.LANGUAGE || tags.lang || null
}

function tagTitle(tags?: Record<string, string>): string | null {
  if (!tags) return null
  return tags.title || tags.TITLE || null
}

export async function getStreamInfo(path: string): Promise<StreamInfo> {
  const cached = probeCache.get(path)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.info

  const filename = path.split('/').pop() || path
  const hasFf = ffmpegAvailable()

  try {
    const raw = await runFfprobe(path)
    const streams = raw.streams ?? []
    const video = streams.find((s) => s.codec_type === 'video')
    const audioStreams = streams.filter((s) => s.codec_type === 'audio')
    const subStreams = streams.filter((s) => s.codec_type === 'subtitle')

    const audioTracks: AudioTrack[] = audioStreams.map((s, i) => ({
      index: i,
      codec: normalizeCodec(s.codec_name),
      language: tagLang(s.tags),
      title: tagTitle(s.tags),
      channels: s.channels ?? null,
    }))

    const subtitleTracks: SubtitleTrack[] = subStreams.map((s, i) => ({
      index: i,
      codec: normalizeCodec(s.codec_name),
      language: tagLang(s.tags),
      title: tagTitle(s.tags),
      kind: 'embedded' as const,
    }))

    const videoCodec = normalizeCodec(video?.codec_name)
    const audioCodec = audioTracks[0]?.codec ?? null
    const container = containerFromFormat(raw.format?.format_name, filename)
    const duration = Number(raw.format?.duration || video?.duration || 0) || null
    const decided = decideMode(container, videoCodec, audioCodec)
    const hw = resolveHwEncoder()

    const info: StreamInfo = {
      mode: decided.mode,
      ffmpegAvailable: hasFf,
      container,
      videoCodec,
      audioCodec,
      duration,
      width: video?.width ?? null,
      height: video?.height ?? null,
      reason: decided.reason,
      canDirect: decided.canDirect,
      audioTracks,
      subtitleTracks,
      hwEncoder: decided.mode === 'transcode' ? hw : null,
    }
    probeCache.set(path, { at: Date.now(), info, raw })
    return info
  } catch (err) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const likelyNeedsRemux = ['mkv', 'avi', 'ts', 'm2ts', 'wmv', 'flv'].includes(ext)
    const info: StreamInfo = {
      mode: hasFf && likelyNeedsRemux ? 'remux' : 'direct',
      ffmpegAvailable: hasFf,
      container: ext || null,
      videoCodec: null,
      audioCodec: null,
      duration: null,
      width: null,
      height: null,
      reason:
        err instanceof Error
          ? `Probe failed (${err.message}); falling back to ${hasFf && likelyNeedsRemux ? 'remux' : 'direct'}`
          : 'Probe failed',
      canDirect: !likelyNeedsRemux,
      audioTracks: [],
      subtitleTracks: [],
      hwEncoder: null,
    }
    return info
  }
}

function addInputArgs(args: string[], path: string): void {
  const local = resolveLocalPath(path)
  if (local) {
    args.push('-i', local)
    return
  }
  const { url, authHeader } = webdavHttpUrl(path)
  args.push('-headers', `Authorization: ${authHeader}\r\n`, '-i', url)
}

function codecArgs(
  mode: 'remux' | 'transcode',
  audioCodec: string | null,
  audioIndex: number,
): string[] {
  const idx = Math.max(0, audioIndex)
  const map = ['-map', '0:v:0', '-map', `0:a:${idx}`]
  const audio =
    mode === 'remux' && audioCodec && COPY_AUDIO.has(audioCodec)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']
  return [...map, ...videoEncodeArgs(mode), ...audio]
}

function buildFfmpegArgs(
  path: string,
  mode: 'remux' | 'transcode',
  startSeconds: number,
  audioCodec: string | null,
  audioIndex: number,
): string[] {
  const args: string[] = ['-hide_banner', '-loglevel', 'error']

  if (startSeconds > 0.5) {
    args.push('-ss', String(startSeconds))
  }

  args.push(...preInputHwArgs(mode))
  addInputArgs(args, path)
  args.push(...codecArgs(mode, audioCodec, audioIndex))
  args.push(
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  )
  return args
}

/** Offline convert to a local MP4 file (for admin queue). */
export function buildConvertFileArgs(
  sourceLocal: string,
  outputLocal: string,
  mode: 'remux' | 'transcode',
  audioCodec: string | null,
  audioIndex = 0,
): string[] {
  return [
    '-hide_banner',
    '-y',
    ...preInputHwArgs(mode),
    '-i',
    sourceLocal,
    ...codecArgs(mode, audioCodec, audioIndex),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outputLocal,
  ]
}

export function startCompatStream(
  path: string,
  mode: 'remux' | 'transcode',
  opts: {
    startSeconds?: number
    audioCodec?: string | null
    audioIndex?: number
    signal?: AbortSignal
  },
): { response: Response; proc: ChildProcess } {
  const startSeconds = opts.startSeconds ?? 0
  const args = buildFfmpegArgs(
    path,
    mode,
    startSeconds,
    opts.audioCodec ?? null,
    opts.audioIndex ?? 0,
  )
  const proc = spawn(binFfmpeg(), args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  proc.stderr.on('data', (d: Buffer) => {
    stderr += d.toString()
    if (stderr.length > 4000) stderr = stderr.slice(-2000)
  })

  const kill = () => {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* already dead */
    }
  }

  if (opts.signal) {
    if (opts.signal.aborted) kill()
    else opts.signal.addEventListener('abort', kill, { once: true })
  }

  proc.on('close', (code) => {
    if (code && code !== 0 && code !== 255) {
      console.warn(`ffmpeg exited ${code} for ${path}: ${stderr.trim()}`)
    }
  })

  const webStream = Readable.toWeb(proc.stdout) as ReadableStream
  const response = new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      'X-Playback-Mode': mode,
    },
  })

  return { response, proc }
}

/** Extract one embedded subtitle stream to WebVTT text. */
export function extractSubtitleVtt(
  path: string,
  subtitleIndex: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args: string[] = ['-hide_banner', '-loglevel', 'error']
    addInputArgs(args, path)
    args.push('-map', `0:s:${subtitleIndex}`, '-f', 'webvtt', 'pipe:1')
    const proc = spawn(binFfmpeg(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(stderr.trim() || `Subtitle extract failed (${code})`))
        return
      }
      resolve(stdout.startsWith('WEBVTT') ? stdout : `WEBVTT\n\n${stdout}`)
    })
  })
}

export async function resolvePlaybackMode(
  path: string,
  requested?: string | null,
  opts?: { audioIndex?: number },
): Promise<StreamInfo> {
  const info = await getStreamInfo(path)
  const audioIndex = opts?.audioIndex ?? 0
  // Non-default audio on a direct-playable file still needs remux to pick the track.
  if (
    audioIndex > 0 &&
    info.canDirect &&
    info.ffmpegAvailable &&
    (!requested || requested === 'auto' || requested === 'direct')
  ) {
    return {
      ...info,
      mode: 'remux',
      reason: 'Remux to select alternate audio track',
      canDirect: false,
    }
  }
  if (requested === 'direct' || requested === 'remux' || requested === 'transcode') {
    return { ...info, mode: requested }
  }
  if (info.canDirect) return { ...info, mode: 'direct' }
  if (!info.ffmpegAvailable) return { ...info, mode: 'direct' }
  return info
}

export function streamLocalFile(libraryPath: string, rangeHeader?: string | null): Response | null {
  const local = resolveLocalPath(libraryPath)
  if (!local) return null
  const stat = statSync(local)
  const size = stat.size
  const contentType = (() => {
    const ext = local.split('.').pop()?.toLowerCase()
    if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
    if (ext === 'webm') return 'video/webm'
    if (ext === 'mkv') return 'video/x-matroska'
    if (ext === 'avi') return 'video/x-msvideo'
    return 'application/octet-stream'
  })()

  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    if (m) {
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Number(m[2]) : size - 1
      if (start <= end && start < size) {
        const chunk = createReadStream(local, { start, end })
        return new Response(Readable.toWeb(chunk) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'X-Playback-Mode': 'direct',
            'X-Media-Source': 'local',
          },
        })
      }
    }
  }

  const stream = createReadStream(local)
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'X-Playback-Mode': 'direct',
      'X-Media-Source': 'local',
    },
  })
}
