import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import { getConfig } from './config.ts'
import {
  cancelConvertJob,
  countRunningConvertJobs,
  getConvertJob,
  getMediaFileByPath,
  getTitleById,
  listQueuedConvertJobs,
  replaceMediaPath,
  updateConvertJob,
  updateMediaProbe,
  type ConvertJobRow,
} from './db.ts'
import {
  fileSize,
  libraryPathFromLocal,
  planConvertOutput,
  promoteTemp,
  quarantineOriginal,
  resolveLocalPath,
  safeUnlink,
} from './mediafs.ts'
import {
  binFfmpeg,
  binFfprobe,
  buildConvertFileArgs,
  clearProbeCache,
  getStreamInfo,
  pickConvertMode,
  type PlaybackMode,
  type StreamInfo,
} from './playback.ts'

const cancelRequested = new Set<number>()
let ticking = false
let timer: ReturnType<typeof setInterval> | null = null

function parseTimeToSeconds(time: string): number | null {
  const m = time.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function progressFromFfmpegChunk(chunk: string, durationHint: number | null): number | null {
  // Prefer out_time_ms / out_time_us from -progress style lines when present
  const ms = /out_time_ms=(\d+)/.exec(chunk)
  if (ms && durationHint && durationHint > 0) {
    const t = Number(ms[1]) / 1_000_000
    if (Number.isFinite(t)) return Math.min(99, Math.round((t / durationHint) * 1000) / 10)
  }
  const us = /out_time_us=(\d+)/.exec(chunk)
  if (us && durationHint && durationHint > 0) {
    const t = Number(us[1]) / 1_000_000
    if (Number.isFinite(t)) return Math.min(99, Math.round((t / durationHint) * 1000) / 10)
  }
  const tm = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(chunk)
  if (tm && durationHint && durationHint > 0) {
    const t = parseTimeToSeconds(tm[1]!)
    if (t != null) return Math.min(99, Math.round((t / durationHint) * 1000) / 10)
  }
  return null
}

async function probeLocalFile(localPath: string): Promise<{
  duration: number | null
  hasVideo: boolean
  videoCodec: string | null
  audioCodec: string | null
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      binFfprobe(),
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', localPath],
      { windowsHide: true },
    )
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
        reject(new Error(stderr.trim() || `ffprobe failed (${code})`))
        return
      }
      try {
        const raw = JSON.parse(stdout) as {
          format?: { duration?: string }
          streams?: Array<{
            codec_type?: string
            codec_name?: string
            width?: number
            height?: number
            disposition?: { attached_pic?: number }
          }>
        }
        const videos = (raw.streams ?? []).filter(
          (s) =>
            s.codec_type === 'video' &&
            s.disposition?.attached_pic !== 1 &&
            !['mjpeg', 'png', 'bmp'].includes((s.codec_name || '').toLowerCase()),
        )
        const video =
          [...videos].sort(
            (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
          )[0] ?? raw.streams?.find((s) => s.codec_type === 'video')
        const audio = raw.streams?.find((s) => s.codec_type === 'audio')
        resolve({
          duration: Number(raw.format?.duration || 0) || null,
          hasVideo: Boolean(video),
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
        })
      } catch (err) {
        reject(err)
      }
    })
  })
}

function runFfmpegConvert(
  jobId: number,
  args: string[],
  durationHint: number | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binFfmpeg(), args, { windowsHide: true })
    let stderr = ''
    let lastPct = -1
    let lastWrite = 0

    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
      if (stderr.length > 8000) stderr = stderr.slice(-4000)

      if (cancelRequested.has(jobId) || getConvertJob(jobId)?.status === 'cancelling') {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        return
      }

      const pct = progressFromFfmpegChunk(chunk, durationHint)
      if (pct == null) return
      const now = Date.now()
      // Throttle DB writes; always allow first tick and jumps of ≥0.5%
      if (pct < lastPct + 0.5 && now - lastWrite < 400) return
      lastPct = pct
      lastWrite = now
      updateConvertJob(jobId, { progress: pct })
    })

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (cancelRequested.has(jobId) || getConvertJob(jobId)?.status === 'cancelling') {
        reject(new Error('Cancelled'))
        return
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited ${code}`))
        return
      }
      resolve()
    })
  })
}

function applyProbeToDb(path: string, info: StreamInfo): void {
  updateMediaProbe(path, {
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    playbackMode: info.mode,
    canDirect: info.canDirect,
    probeError: info.probeFailed ? info.probeError || info.reason : null,
    duration: info.duration,
  })
}

async function processJob(job: ConvertJobRow): Promise<void> {
  const started = new Date().toISOString()
  updateConvertJob(job.id, { status: 'running', startedAt: started, progress: 1, error: null })

  const local = resolveLocalPath(job.path)
  if (!local) {
    throw new Error(
      'File not found on local disk. Set LOCAL_MEDIA_ROOT to your media mount (e.g. /media).',
    )
  }

  clearProbeCache(job.path)
  const info = await getStreamInfo(job.path)
  applyProbeToDb(job.path, info)

  if (info.probeFailed || !info.videoCodec) {
    throw new Error(
      info.probeError ||
        'Could not detect video codec — check LOCAL_MEDIA_ROOT / file path, then Probe again',
    )
  }

  const picked = pickConvertMode(job.mode, info)

  if (picked === 'skip') {
    updateConvertJob(job.id, {
      status: 'skipped',
      progress: 100,
      finishedAt: new Date().toISOString(),
      mode: 'direct',
      error: 'Already browser-compatible — nothing to convert',
      container: info.container,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
    })
    return
  }

  const mode = picked
  updateConvertJob(job.id, {
    mode,
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    progress: 2,
  })

  console.log(
    `Convert #${job.id}: ${mode} · ${info.videoCodec}/${info.audioCodec || '?'} · ${job.path}`,
  )

  const { tempPath, finalLocal } = planConvertOutput(local)
  safeUnlink(tempPath)

  const args = buildConvertFileArgs(
    local,
    tempPath,
    mode,
    info.audioCodec,
    0,
    info.videoStreamIndex,
    info.audioStreamIndex,
  )
  await runFfmpegConvert(job.id, args, info.duration)

  if (cancelRequested.has(job.id)) throw new Error('Cancelled')

  updateConvertJob(job.id, { progress: 99 })

  // Verify output
  const outProbe = await probeLocalFile(tempPath)
  if (!outProbe.hasVideo) throw new Error('Converted file has no video stream')
  if (info.duration && outProbe.duration) {
    const drift = Math.abs(outProbe.duration - info.duration) / info.duration
    if (drift > 0.05) {
      throw new Error(
        `Duration mismatch after convert (${outProbe.duration.toFixed(1)}s vs ${info.duration.toFixed(1)}s)`,
      )
    }
  }

  let quarantined: string | null = null
  const replace = Boolean(job.replace_original)
  const deleteOriginal = Boolean(job.delete_original)

  if (replace) {
    if (existsSync(local) && local.toLowerCase() !== finalLocal.toLowerCase()) {
      quarantined = quarantineOriginal(local)
    }
    promoteTemp(tempPath, finalLocal, local)
    if (deleteOriginal && quarantined) {
      safeUnlink(quarantined)
      quarantined = null
    }

    const newLibraryPath = libraryPathFromLocal(finalLocal, job.path)
    replaceMediaPath(job.path, newLibraryPath, basename(finalLocal), fileSize(finalLocal))
    clearProbeCache(job.path)
    clearProbeCache(newLibraryPath)

    const newInfo = await getStreamInfo(newLibraryPath)
    applyProbeToDb(newLibraryPath, newInfo)

    updateConvertJob(job.id, {
      status: 'done',
      progress: 100,
      outputPath: newLibraryPath,
      quarantinedPath: quarantined,
      finishedAt: new Date().toISOString(),
      error: null,
    })
  } else {
    // Keep original; write a sibling browser-friendly MP4 and register it.
    const out =
      finalLocal.toLowerCase() === local.toLowerCase()
        ? local.replace(/\.[^.]+$/, '') + '.browser.mp4'
        : finalLocal
    promoteTemp(tempPath, out, local)
    const newLibraryPath = libraryPathFromLocal(out, job.path)
    const media = getMediaFileByPath(job.path)
    if (media) {
      const { upsertMediaFile } = await import('./db.ts')
      upsertMediaFile({
        path: newLibraryPath,
        filename: basename(out),
        size: fileSize(out),
        titleId: media.title_id,
        season: media.season,
        episode: media.episode,
        episodeName: media.episode_name,
      })
      const newInfo = await getStreamInfo(newLibraryPath)
      applyProbeToDb(newLibraryPath, newInfo)
    }
    updateConvertJob(job.id, {
      status: 'done',
      progress: 100,
      outputPath: newLibraryPath,
      finishedAt: new Date().toISOString(),
      error: null,
    })
  }
}

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const concurrency = getConfig().convertConcurrency
    const running = countRunningConvertJobs()
    const slots = Math.max(0, concurrency - running)
    if (slots === 0) return

    const queued = listQueuedConvertJobs(slots)
    for (const job of queued) {
      void processJob(job).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        const status = msg === 'Cancelled' ? 'cancelled' : 'failed'
        updateConvertJob(job.id, {
          status,
          error: msg,
          finishedAt: new Date().toISOString(),
        })
        cancelRequested.delete(job.id)
      })
    }
  } finally {
    ticking = false
  }
}

export function startConvertWorker(): void {
  if (timer) return
  console.log('Convert worker started')
  timer = setInterval(() => {
    void tick()
  }, 1500)
  void tick()
}

export function requestCancelConvert(id: number): ConvertJobRow | undefined {
  cancelRequested.add(id)
  return cancelConvertJob(id)
}

export async function enqueueConvertForPath(
  path: string,
  opts?: {
    mode?: 'auto' | 'remux' | 'transcode'
    replaceOriginal?: boolean
    deleteOriginal?: boolean
  },
) {
  const media = getMediaFileByPath(path)
  if (!media) throw new Error('Unknown media path — scan the library first')
  const title = getTitleById(media.title_id)
  clearProbeCache(path)
  const info = await getStreamInfo(path)
  applyProbeToDb(path, info)

  if (info.probeFailed || !info.videoCodec) {
    throw new Error(
      info.probeError ||
        'Could not detect codecs for this file — run Scan codecs, then try again',
    )
  }

  const requested = opts?.mode ?? 'auto'
  const resolved = pickConvertMode(requested, info)

  if (resolved === 'skip') {
    throw new Error('Already browser-compatible (direct play) — nothing to convert')
  }

  // Persist the concrete mode (remux/transcode) so the queue never sits on opaque "auto"
  const { enqueueConvertJob } = await import('./db.ts')
  const job = enqueueConvertJob({
    path,
    titleId: media.title_id,
    titleName: title?.title ?? null,
    mode: resolved,
    replaceOriginal: opts?.replaceOriginal,
    deleteOriginal: opts?.deleteOriginal ?? getConfig().convertDeleteOriginalDefault,
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
  })
  void tick()
  return { job, info, resolvedMode: resolved as 'remux' | 'transcode' }
}

export type { PlaybackMode }
