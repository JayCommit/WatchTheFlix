import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { assertWebdavConfig, getConfig } from './config.ts'
import { resolveLocalPath } from './mediafs.ts'

export type PlaybackMode = 'direct' | 'remux' | 'transcode'

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
}

type ProbeStream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
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
/** Video we can stream with -c:v copy into MP4 */
const COPY_VIDEO = new Set(['h264', 'avc', 'mpeg4'])
/** Audio already fine in MP4 */
const COPY_AUDIO = new Set(['aac', 'mp3'])

export function binFfmpeg(): string {
  // Prefer system ffmpeg (Ubuntu container) then bundled binary
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

  // Remux: copy video, maybe re-encode audio only
  if (COPY_VIDEO.has(v) && (COPY_AUDIO.has(a) || !a || !COPY_AUDIO.has(a))) {
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

export async function getStreamInfo(path: string): Promise<StreamInfo> {
  const cached = probeCache.get(path)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.info

  const filename = path.split('/').pop() || path
  const hasFf = ffmpegAvailable()

  try {
    const raw = await runFfprobe(path)
    const video = raw.streams?.find((s) => s.codec_type === 'video')
    const audio = raw.streams?.find((s) => s.codec_type === 'audio')
    const videoCodec = normalizeCodec(video?.codec_name)
    const audioCodec = normalizeCodec(audio?.codec_name)
    const container = containerFromFormat(raw.format?.format_name, filename)
    const duration = Number(raw.format?.duration || video?.duration || 0) || null
    const decided = decideMode(container, videoCodec, audioCodec)

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

function codecArgs(mode: 'remux' | 'transcode', audioCodec: string | null): string[] {
  if (mode === 'remux') {
    const a =
      audioCodec && COPY_AUDIO.has(audioCodec)
        ? ['-c:a', 'copy']
        : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']
    return ['-c:v', 'copy', ...a]
  }
  return [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '192k',
  ]
}

function buildFfmpegArgs(
  path: string,
  mode: 'remux' | 'transcode',
  startSeconds: number,
  audioCodec: string | null,
): string[] {
  const args: string[] = ['-hide_banner', '-loglevel', 'error']

  if (startSeconds > 0.5) {
    args.push('-ss', String(startSeconds))
  }

  addInputArgs(args, path)
  args.push(...codecArgs(mode, audioCodec))
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
): string[] {
  return [
    '-hide_banner',
    '-y',
    '-i',
    sourceLocal,
    ...codecArgs(mode, audioCodec),
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
  opts: { startSeconds?: number; audioCodec?: string | null; signal?: AbortSignal },
): { response: Response; proc: ChildProcess } {
  const startSeconds = opts.startSeconds ?? 0
  const args = buildFfmpegArgs(path, mode, startSeconds, opts.audioCodec ?? null)
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

export async function resolvePlaybackMode(
  path: string,
  requested?: string | null,
): Promise<StreamInfo> {
  const info = await getStreamInfo(path)
  if (requested === 'direct' || requested === 'remux' || requested === 'transcode') {
    return { ...info, mode: requested }
  }
  // auto
  if (info.canDirect) return { ...info, mode: 'direct' }
  if (!info.ffmpegAvailable) return { ...info, mode: 'direct' }
  return info
}

/** Serve a local file with Range support when LOCAL_MEDIA_ROOT is available. */
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
