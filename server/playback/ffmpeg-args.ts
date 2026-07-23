import { resolveLocalPath } from '../mediafs.ts'
import { resolveHwEncoder, webdavHttpUrl } from './bins.ts'
import { COPY_AUDIO } from './mode.ts'

/** Args that must appear before `-i` (VAAPI device init). */
export function preInputHwArgs(mode: 'remux' | 'transcode'): string[] {
  if (mode !== 'transcode') return []
  if (resolveHwEncoder() === 'h264_vaapi') {
    return ['-vaapi_device', '/dev/dri/renderD128']
  }
  return []
}

export function videoEncodeArgs(mode: 'remux' | 'transcode'): string[] {
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

export function addInputArgs(args: string[], path: string): void {
  const local = resolveLocalPath(path)
  if (local) {
    args.push('-i', local)
    return
  }
  const { url, authHeader } = webdavHttpUrl(path)
  args.push('-headers', `Authorization: ${authHeader}\r\n`, '-i', url)
}

export function codecArgs(
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

export function buildFfmpegArgs(
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
    // Keep stats on stderr so the convert worker can parse time= progress
    '-loglevel',
    'info',
    '-stats_period',
    '0.5',
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
