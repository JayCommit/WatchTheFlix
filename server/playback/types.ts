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

export type ProbeStream = {
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

export type ProbeResult = {
  format?: {
    format_name?: string
    duration?: string
  }
  streams?: ProbeStream[]
}
