import { spawn } from 'node:child_process'
import { resolveLocalPath } from '../mediafs.ts'
import { binFfprobe, ffmpegAvailable, resolveHwEncoder, webdavHttpUrl } from './bins.ts'
import { COVER_CODECS, decideMode } from './mode.ts'
import type { AudioTrack, PlaybackMode, ProbeResult, ProbeStream, StreamInfo, SubtitleTrack } from './types.ts'

const probeCache = new Map<string, { at: number; info: StreamInfo; raw: ProbeResult }>()
const CACHE_MS = 10 * 60 * 1000

export function normalizeCodec(name?: string | null, tag?: string | null): string | null {
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

export async function runFfprobe(path: string): Promise<ProbeResult> {
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

export function tagLang(tags?: Record<string, string>): string | null {
  if (!tags) return null
  return tags.language || tags.LANGUAGE || tags.lang || null
}

export function tagTitle(tags?: Record<string, string>): string | null {
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
