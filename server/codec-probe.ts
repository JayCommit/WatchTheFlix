import { setScanMeta, getScanMeta, updateMediaProbe, listPathsForCodecProbe } from './db.ts'
import { clearProbeCache, getStreamInfo } from './playback.ts'

export type CodecProbeProgress = {
  phase: 'idle' | 'running' | 'done' | 'error'
  force: boolean
  total: number
  processed: number
  direct: number
  remux: number
  transcode: number
  failed: number
  currentPath: string | null
  message: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

const META_KEY = 'codec_probe_progress'

let running = false
let cancelRequested = false

function defaultProgress(): CodecProbeProgress {
  return {
    phase: 'idle',
    force: false,
    total: 0,
    processed: 0,
    direct: 0,
    remux: 0,
    transcode: 0,
    failed: 0,
    currentPath: null,
    message: 'Idle',
    startedAt: null,
    finishedAt: null,
    error: null,
  }
}

export function isCodecProbeRunning(): boolean {
  return running
}

export function getCodecProbeProgress(): CodecProbeProgress {
  const raw = getScanMeta(META_KEY)
  if (!raw) return defaultProgress()
  try {
    return { ...defaultProgress(), ...(JSON.parse(raw) as CodecProbeProgress) }
  } catch {
    return defaultProgress()
  }
}

function save(progress: CodecProbeProgress): void {
  setScanMeta(META_KEY, JSON.stringify(progress))
}

export function requestCancelCodecProbe(): void {
  if (running) cancelRequested = true
}

export function startCodecProbe(opts?: { force?: boolean }): CodecProbeProgress {
  if (running) {
    throw new Error('A codec probe is already running')
  }

  const force = Boolean(opts?.force)
  const paths = listPathsForCodecProbe({ force })
  const startedAt = new Date().toISOString()
  const progress: CodecProbeProgress = {
    ...defaultProgress(),
    phase: 'running',
    force,
    total: paths.length,
    message:
      paths.length === 0
        ? 'Nothing to probe — every visible file already has codec data'
        : `Probing ${paths.length} file${paths.length === 1 ? '' : 's'}…`,
    startedAt,
  }
  save(progress)

  if (paths.length === 0) {
    progress.phase = 'done'
    progress.finishedAt = new Date().toISOString()
    progress.message = 'All visible files already probed'
    save(progress)
    return progress
  }

  running = true
  cancelRequested = false
  void runProbe(paths, progress)
  return progress
}

async function runProbe(paths: string[], seed: CodecProbeProgress): Promise<void> {
  const progress: CodecProbeProgress = { ...seed }
  try {
    for (const path of paths) {
      if (cancelRequested) {
        progress.phase = 'done'
        progress.message = `Cancelled after ${progress.processed}/${progress.total}`
        progress.finishedAt = new Date().toISOString()
        progress.currentPath = null
        save(progress)
        return
      }

      progress.currentPath = path
      progress.message = `Probing ${progress.processed + 1}/${progress.total}`
      save(progress)

      try {
        clearProbeCache(path)
        const info = await getStreamInfo(path)
        if (info.probeFailed || !info.videoCodec) {
          updateMediaProbe(path, {
            container: info.container,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            playbackMode: info.mode,
            canDirect: false,
            probeError: info.probeError || info.reason,
            duration: info.duration,
          })
          progress.failed += 1
        } else {
          updateMediaProbe(path, {
            container: info.container,
            videoCodec: info.videoCodec,
            audioCodec: info.audioCodec,
            playbackMode: info.mode,
            canDirect: info.canDirect,
            probeError: null,
            duration: info.duration,
          })
          if (info.canDirect) progress.direct += 1
          else if (info.mode === 'remux') progress.remux += 1
          else progress.transcode += 1
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        updateMediaProbe(path, { probeError: msg, canDirect: false, errorOnly: true })
        progress.failed += 1
      }

      progress.processed += 1
      // Yield so the event loop can serve status polls / UI
      if (progress.processed % 3 === 0) {
        await new Promise((r) => setTimeout(r, 0))
      }
    }

    progress.phase = 'done'
    progress.currentPath = null
    progress.finishedAt = new Date().toISOString()
    progress.message = `Done · ${progress.direct} direct · ${progress.remux} remux · ${progress.transcode} transcode · ${progress.failed} failed`
    save(progress)
  } catch (err) {
    progress.phase = 'error'
    progress.error = err instanceof Error ? err.message : String(err)
    progress.message = progress.error
    progress.finishedAt = new Date().toISOString()
    progress.currentPath = null
    save(progress)
  } finally {
    running = false
    cancelRequested = false
  }
}
