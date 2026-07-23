import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { assertWebdavConfig, getConfig } from './config.ts'
import { resolveLocalPath } from './mediafs.ts'

export type PlaybackMode = 'direct' | 'remux' | 'transcode'

export type AudioTrack = {
  /** Relative index among audio tracks (0-based) — used by the UI. */
  index: number
  /** Absolute ffmpeg stream index in the file. */
  streamIndex: number
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
  /** Absolute ffmpeg stream index for the primary video (skips cover art). */
  videoStreamIndex: number | null
  /** Absolute ffmpeg stream index for default/first audio track. */
  audioStreamIndex: number | null
  audioTracks: AudioTrack[]
  subtitleTracks: SubtitleTrack[]
  hwEncoder: string | null
  /** True when ffprobe failed and mode is an extension-based guess. */
  probeFailed?: boolean
  probeError?: string | null
}

type ProbeStream = {
  index?: number
  codec_type?: string
  codec_name?: string
  codec_tag_string?: string
  width?: number
  height?: number
  channels?: number
  duration?: string
  disposition?: {
    attached_pic?: number
    still_image?: number
  }
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
/** Codecs browsers can usually decode when the container is also direct-friendly. */
const DIRECT_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const DIRECT_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis'])
/** Video codecs safe to remux (stream-copy) into MP4 for browsers. */
const COPY_VIDEO = new Set(['h264'])
const COPY_AUDIO = new Set(['aac', 'mp3'])
/** Image / cover codecs that must never be treated as the main video track. */
const COVER_CODECS = new Set(['mjpeg', 'jpeg', 'png', 'bmp', 'gif', 'webp'])

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

function normalizeCodec(name?: string | null, tag?: string | null): string | null {
  if (!name && !tag) return null
  const n = (name || tag || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!n) return null

  // H.264 family
  if (n === 'h264' || n === 'avc' || n === 'avc1' || n === 'avc3' || n === 'x264') return 'h264'
  // HEVC / H.265
  if (n === 'hevc' || n === 'h265' || n === 'hev1' || n === 'hvc1' || n === 'x265') return 'hevc'
  // MPEG-4 Part 2 (XviD / DivX) — not the same as H.264
  if (n === 'mpeg4' || n === 'mp4v' || n === 'xvid' || n === 'divx') return 'mpeg4'
  // Audio aliases
  if (n === 'aac' || n === 'mp4a') return 'aac'
  if (n === 'mp3' || n === 'mp3float') return 'mp3'
  if (n === 'ac3') return 'ac3'
  if (n === 'eac3' || n === 'ec3') return 'eac3'
  if (n === 'dts' || n === 'dca') return 'dts'
  if (n === 'truehd' || n === 'mlp') return 'truehd'
  if (n === 'pcm' || n.startsWith('pcm')) return 'pcm'
  if (n === 'flac') return 'flac'
  if (n === 'opus') return 'opus'
  if (n === 'vorbis') return 'vorbis'
  if (n === 'vp8' || n === 'vp9' || n === 'av1') return n
  if (COVER_CODECS.has(n)) return n
  return (name || tag || '').toLowerCase()
}

function containerFromFormat(formatName?: string, filename?: string): string | null {
  if (formatName) {
    const parts = formatName.split(',').map((s) => s.trim().toLowerCase())
    if (parts.some((p) => p.includes('matroska') || p === 'mkv')) return 'mkv'
    if (parts.some((p) => p === 'mp4' || p === 'mov' || p === 'isom' || p === 'm4v' || p === '3gp')) {
      return 'mp4'
    }
    if (parts.some((p) => p === 'webm')) return 'webm'
    if (parts.some((p) => p === 'avi')) return 'avi'
    if (parts.some((p) => p === 'mpegts' || p === 'mpeg' || p === 'm2ts' || p === 'mts')) {
      return 'mpegts'
    }
    if (parts.some((p) => p === 'flv')) return 'flv'
    if (parts.some((p) => p === 'asf' || p === 'wmv')) return 'wmv'
    return parts[0] ?? null
  }
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext === 'm4v' || ext === 'mov') return 'mp4'
  if (ext === 'm2ts' || ext === 'mts' || ext === 'ts') return 'mpegts'
  return ext ?? null
}

function isCoverStream(s: ProbeStream): boolean {
  if (s.disposition?.attached_pic === 1 || s.disposition?.still_image === 1) return true
  const codec = normalizeCodec(s.codec_name, s.codec_tag_string)
  if (!codec || !COVER_CODECS.has(codec)) return false
  // Tiny or missing dimensions = cover / thumbnail, not the film
  const w = s.width ?? 0
  const h = s.height ?? 0
  if (w > 0 && h > 0 && w * h >= 320 * 240) return false
  return true
}

/** Prefer the real movie/episode video track over embedded cover art. */
function pickPrimaryVideo(streams: ProbeStream[]): ProbeStream | undefined {
  const videos = streams.filter((s) => s.codec_type === 'video' && !isCoverStream(s))
  if (!videos.length) {
    // Last resort: any video that isn't explicitly attached_pic
    return streams.find(
      (s) =>
        s.codec_type === 'video' &&
        s.disposition?.attached_pic !== 1 &&
        s.disposition?.still_image !== 1,
    )
  }
  return [...videos].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0]
}

function decideMode(
  container: string | null,
  video: string | null,
  audio: string | null,
): { mode: PlaybackMode; reason: string; canDirect: boolean } {
  const c = container ?? ''
  const v = video ?? ''
  const a = audio ?? ''

  if (!v) {
    return {
      mode: 'transcode',
      reason: 'No primary video stream detected — needs re-encode or re-probe',
      canDirect: false,
    }
  }

  if (COVER_CODECS.has(v)) {
    return {
      mode: 'transcode',
      reason: `Detected ${v} as video (likely cover art) — re-probe or convert required`,
      canDirect: false,
    }
  }

  const containerOk = DIRECT_CONTAINERS.has(c)
  const videoOk = DIRECT_VIDEO.has(v)
  // FLAC/PCM inside MP4 is rarely browser-safe even when tagged "direct"
  const audioOk = !a || DIRECT_AUDIO.has(a)
  const canDirect = containerOk && videoOk && audioOk

  if (canDirect) {
    return { mode: 'direct', reason: 'Browser-native container and codecs', canDirect: true }
  }

  if (!ffmpegAvailable()) {
    return {
      mode: 'direct',
      reason: 'FFmpeg unavailable — attempting direct play (may fail)',
      canDirect: false,
    }
  }

  // Remux only when video can be stream-copied into MP4 (H.264). HEVC/AV1/MPEG-4/etc → transcode.
  if (COPY_VIDEO.has(v)) {
    if (COPY_AUDIO.has(a) || !a) {
      return {
        mode: 'remux',
        reason: `${c || 'container'} → MP4 remux (H.264 copy${a ? `, ${a} copy` : ''})`,
        canDirect: false,
      }
    }
    return {
      mode: 'remux',
      reason: `${c || 'container'} → MP4 (H.264 copy, ${a || 'audio'} → AAC)`,
      canDirect: false,
    }
  }

  return {
    mode: 'transcode',
    reason: `${v || 'video'}/${a || 'audio'} in ${c || 'unknown'} → H.264 + AAC`,
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
  // Larger probe window helps Matroska / MPEG-TS where codecs aren't in the first packets
  const args = [
    '-v',
    'error',
    '-probesize',
    '50M',
    '-analyzeduration',
    '50M',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
  ]

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
    const video = pickPrimaryVideo(streams)
    const audioStreams = streams.filter((s) => s.codec_type === 'audio')
    const subStreams = streams.filter((s) => s.codec_type === 'subtitle')

    const audioTracks: AudioTrack[] = audioStreams.map((s, i) => ({
      index: i,
      streamIndex: typeof s.index === 'number' ? s.index : i,
      codec: normalizeCodec(s.codec_name, s.codec_tag_string),
      language: tagLang(s.tags),
      title: tagTitle(s.tags),
      channels: s.channels ?? null,
    }))

    const subtitleTracks: SubtitleTrack[] = subStreams.map((s, i) => ({
      index: i,
      codec: normalizeCodec(s.codec_name, s.codec_tag_string),
      language: tagLang(s.tags),
      title: tagTitle(s.tags),
      kind: 'embedded' as const,
    }))

    const videoCodec = normalizeCodec(video?.codec_name, video?.codec_tag_string)
    const audioCodec = audioTracks[0]?.codec ?? null
    const container = containerFromFormat(raw.format?.format_name, filename)
    const duration = Number(raw.format?.duration || video?.duration || 0) || null
    const decided = decideMode(container, videoCodec, audioCodec)
    const hw = resolveHwEncoder()
    const videoStreamIndex =
      typeof video?.index === 'number' && Number.isFinite(video.index) ? video.index : null
    const firstAudio = audioStreams[0]
    const audioStreamIndex =
      typeof firstAudio?.index === 'number' && Number.isFinite(firstAudio.index)
        ? firstAudio.index
        : null

    if (!videoCodec) {
      const info: StreamInfo = {
        mode: 'transcode',
        ffmpegAvailable: hasFf,
        container,
        videoCodec: null,
        audioCodec,
        duration,
        width: video?.width ?? null,
        height: video?.height ?? null,
        reason: 'ffprobe returned no usable video codec — file may be corrupt or need a deeper probe',
        canDirect: false,
        videoStreamIndex,
        audioStreamIndex,
        audioTracks,
        subtitleTracks,
        hwEncoder: hasFf ? hw : null,
        probeFailed: true,
        probeError: 'No video codec in probe result',
      }
      // Don't cache soft-failures for long — allow retry after disk/path fixes
      probeCache.set(path, { at: Date.now() - CACHE_MS + 30_000, info, raw })
      return info
    }

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
      videoStreamIndex,
      audioStreamIndex,
      audioTracks,
      subtitleTracks,
      hwEncoder: decided.mode === 'transcode' ? hw : null,
      probeFailed: false,
      probeError: null,
    }
    probeCache.set(path, { at: Date.now(), info, raw })
    return info
  } catch (err) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const container = containerFromFormat(undefined, filename)
    const msg = err instanceof Error ? err.message : 'Probe failed'
    // Guess conservatively for convert UI — never claim Direct without a real probe
    const guessMode: PlaybackMode =
      hasFf && ['mkv', 'avi', 'ts', 'm2ts', 'mts', 'wmv', 'flv', 'mpegts'].includes(ext)
        ? 'transcode'
        : hasFf
          ? 'transcode'
          : 'direct'
    const info: StreamInfo = {
      mode: guessMode,
      ffmpegAvailable: hasFf,
      container,
      videoCodec: null,
      audioCodec: null,
      duration: null,
      width: null,
      height: null,
      reason: `Probe failed (${msg}) — codecs unknown; treating as needs convert`,
      canDirect: false,
      videoStreamIndex: null,
      audioStreamIndex: null,
      audioTracks: [],
      subtitleTracks: [],
      hwEncoder: null,
      probeFailed: true,
      probeError: msg,
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
  opts: {
    /** Absolute stream index of primary video (preferred). */
    videoStreamIndex?: number | null
    /** Relative audio track index among audio streams (0-based). */
    audioIndex?: number
    /** Absolute stream index of chosen audio (preferred when known). */
    audioStreamIndex?: number | null
  },
): string[] {
  const audioRel = Math.max(0, opts.audioIndex ?? 0)
  const vMap =
    opts.videoStreamIndex != null && opts.videoStreamIndex >= 0
      ? ['-map', `0:${opts.videoStreamIndex}`]
      : ['-map', '0:v:0']
  const aMap =
    opts.audioStreamIndex != null && opts.audioStreamIndex >= 0
      ? ['-map', `0:${opts.audioStreamIndex}`]
      : ['-map', `0:a:${audioRel}`]
  const audio =
    mode === 'remux' && audioCodec && COPY_AUDIO.has(audioCodec)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']
  return [...vMap, ...aMap, ...videoEncodeArgs(mode), ...audio]
}

function buildFfmpegArgs(
  path: string,
  mode: 'remux' | 'transcode',
  startSeconds: number,
  audioCodec: string | null,
  audioIndex: number,
  videoStreamIndex: number | null,
  audioStreamIndex: number | null,
): string[] {
  const args: string[] = ['-hide_banner', '-loglevel', 'error']

  if (startSeconds > 0.5) {
    args.push('-ss', String(startSeconds))
  }

  args.push(...preInputHwArgs(mode))
  addInputArgs(args, path)
  args.push(
    ...codecArgs(mode, audioCodec, {
      videoStreamIndex,
      audioIndex,
      audioStreamIndex: audioIndex === 0 ? audioStreamIndex : null,
    }),
  )
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
  videoStreamIndex: number | null = null,
  audioStreamIndex: number | null = null,
): string[] {
  return [
    '-hide_banner',
    '-y',
    ...preInputHwArgs(mode),
    '-i',
    sourceLocal,
    ...codecArgs(mode, audioCodec, {
      videoStreamIndex,
      audioIndex,
      audioStreamIndex: audioIndex === 0 ? audioStreamIndex : null,
    }),
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
    videoStreamIndex?: number | null
    audioStreamIndex?: number | null
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
    opts.videoStreamIndex ?? null,
    opts.audioStreamIndex ?? null,
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
