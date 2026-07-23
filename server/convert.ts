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
  type PlaybackMode,
} from './playback.ts'

const cancelRequested = new Set<number>()
let ticking = false
let timer: ReturnType<typeof setInterval> | null = null

function parseTimeToSeconds(time: string): number | null {
  const m = time.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
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
          streams?: Array<{ codec_type?: string; codec_name?: string }>
        }
        const video = raw.streams?.find((s) => s.codec_type === 'video')
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

      const tm = /time=(\d+:\d+:\d+(?:\.\d+)?)/.exec(chunk)
      if (tm && durationHint && durationHint > 0) {
        const t = parseTimeToSeconds(tm[1]!)
        if (t != null) {
          const pct = Math.min(99, Math.round((t / durationHint) * 1000) / 10)
          updateConvertJob(jobId, { progress: pct })
        }
      }
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

async function processJob(job: ConvertJobRow): Promise<void> {
  const started = new Date().toISOString()
  updateConvertJob(job.id, { status: 'running', startedAt: started, progress: 1, error: null })

  const local = resolveLocalPath(job.path)
  if (!local) {
    throw new Error(
      'File not found on local disk. Set LOCAL_MEDIA_ROOT to your media mount (e.g. /media).',
    )
  }

  const info = await getStreamInfo(job.path)
  updateMediaProbe(job.path, {
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    playbackMode: info.mode,
    canDirect: info.canDirect,
    duration: info.duration,
  })

  const mode: 'remux' | 'transcode' =
    job.mode === 'remux' || job.mode === 'transcode'
      ? job.mode
      : info.mode === 'transcode'
        ? 'transcode'
        : 'remux'

  if (info.canDirect && job.mode === 'auto') {
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

  updateConvertJob(job.id, {
    mode,
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
  })

  const { tempPath, finalLocal } = planConvertOutput(local)
  safeUnlink(tempPath)

  const args = buildConvertFileArgs(local, tempPath, mode, info.audioCodec)
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
    updateMediaProbe(newLibraryPath, {
      container: newInfo.container,
      videoCodec: newInfo.videoCodec,
      audioCodec: newInfo.audioCodec,
      playbackMode: newInfo.mode,
      canDirect: newInfo.canDirect,
      duration: newInfo.duration,
    })

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
      updateMediaProbe(newLibraryPath, {
        container: newInfo.container,
        videoCodec: newInfo.videoCodec,
        audioCodec: newInfo.audioCodec,
        playbackMode: newInfo.mode,
        canDirect: newInfo.canDirect,
        duration: newInfo.duration,
      })
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
  }, 2000)
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
  const info = await getStreamInfo(path)
  updateMediaProbe(path, {
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    playbackMode: info.mode,
    canDirect: info.canDirect,
    duration: info.duration,
  })

  const { enqueueConvertJob } = await import('./db.ts')
  const job = enqueueConvertJob({
    path,
    titleId: media.title_id,
    titleName: title?.title ?? null,
    mode: opts?.mode ?? 'auto',
    replaceOriginal: opts?.replaceOriginal,
    deleteOriginal: opts?.deleteOriginal ?? getConfig().convertDeleteOriginalDefault,
    container: info.container,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
  })
  void tick()
  return { job, info }
}

export type { PlaybackMode }
