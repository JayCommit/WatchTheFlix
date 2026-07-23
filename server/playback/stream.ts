import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { resolveLocalPath } from '../mediafs.ts'
import { binFfmpeg } from './bins.ts'
import { addInputArgs, buildFfmpegArgs } from './ffmpeg-args.ts'

export { webdavHttpUrl } from './bins.ts'

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
