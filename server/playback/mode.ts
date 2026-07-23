import { ffmpegAvailable } from './bins.ts'
import type { PlaybackMode, StreamInfo } from './types.ts'

export const DIRECT_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm'])
/** Codecs browsers can usually decode when the container is also direct-friendly. */
export const DIRECT_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
export const DIRECT_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis'])
/** Video codecs safe to remux (stream-copy) into MP4 for browsers. */
export const COPY_VIDEO = new Set(['h264'])
export const COPY_AUDIO = new Set(['aac', 'mp3'])
/** Image / cover codecs that must never be treated as the main video track. */
export const COVER_CODECS = new Set(['mjpeg', 'jpeg', 'png', 'bmp', 'gif', 'webp'])

export function decideMode(
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

/**
 * Pick the offline convert strategy for a probed file.
 * Auto prefers remux (stream-copy H.264) whenever possible — never force a
 * full re-encode unless the video codec cannot be copied into MP4.
 */
export function pickConvertMode(
  requested: 'auto' | 'remux' | 'transcode' | string | null | undefined,
  info: Pick<StreamInfo, 'mode' | 'canDirect' | 'videoCodec' | 'probeFailed'>,
): 'remux' | 'transcode' | 'skip' {
  const req = (requested || 'auto').toLowerCase()
  if (req === 'remux' || req === 'transcode') return req

  // auto
  if (info.canDirect || info.mode === 'direct') return 'skip'
  if (info.probeFailed || !info.videoCodec) {
    // Caller should treat this as an error; default conservatively
    return 'transcode'
  }
  // H.264 can always be remuxed (audio may still be re-encoded to AAC)
  if (info.videoCodec === 'h264' || info.mode === 'remux') return 'remux'
  return 'transcode'
}

export async function resolvePlaybackMode(
  path: string,
  requested?: string | null,
  opts?: { audioIndex?: number },
): Promise<StreamInfo> {
  // Dynamic import keeps mode.ts below probe in the static DAG (probe → mode for decideMode).
  const { getStreamInfo } = await import('./probe.ts')
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
