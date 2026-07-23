import { db } from './connection.ts'
import type { ConvertJobRow } from './types.ts'

export function enqueueConvertJob(input: {
  path: string
  titleId?: number | null
  titleName?: string | null
  mode?: string
  replaceOriginal?: boolean
  deleteOriginal?: boolean
  container?: string | null
  videoCodec?: string | null
  audioCodec?: string | null
}): ConvertJobRow {
  const active = db
    .prepare(
      `SELECT id FROM convert_jobs WHERE path = ? AND status IN ('queued', 'running') LIMIT 1`,
    )
    .get(input.path) as { id: number } | undefined
  if (active) {
    throw new Error(`Convert job already active for this file (id ${active.id})`)
  }

  const created = new Date().toISOString()
  const result = db
    .prepare(
      `
      INSERT INTO convert_jobs (
        path, title_id, title_name, status, mode, replace_original, delete_original,
        progress, container, video_codec, audio_codec, created_at
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?)
    `,
    )
    .run(
      input.path,
      input.titleId ?? null,
      input.titleName ?? null,
      input.mode ?? 'auto',
      input.replaceOriginal === false ? 0 : 1,
      input.deleteOriginal ? 1 : 0,
      input.container ?? null,
      input.videoCodec ?? null,
      input.audioCodec ?? null,
      created,
    )

  return getConvertJob(Number(result.lastInsertRowid))!
}

export function getConvertJob(id: number): ConvertJobRow | undefined {
  return db.prepare(`SELECT * FROM convert_jobs WHERE id = ?`).get(id) as ConvertJobRow | undefined
}

export function listConvertJobs(limit = 100): ConvertJobRow[] {
  return db
    .prepare(`SELECT * FROM convert_jobs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ConvertJobRow[]
}

export function listQueuedConvertJobs(limit = 10): ConvertJobRow[] {
  return db
    .prepare(
      `SELECT * FROM convert_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as ConvertJobRow[]
}

export function countRunningConvertJobs(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM convert_jobs WHERE status = 'running'`).get() as {
      c: number
    }
  ).c
}

export function updateConvertJob(
  id: number,
  patch: Partial<{
    status: string
    mode: string
    progress: number
    outputPath: string | null
    quarantinedPath: string | null
    error: string | null
    startedAt: string | null
    finishedAt: string | null
    container: string | null
    videoCodec: string | null
    audioCodec: string | null
  }>,
): void {
  const cur = getConvertJob(id)
  if (!cur) return
  db.prepare(`
    UPDATE convert_jobs SET
      status = ?,
      mode = ?,
      progress = ?,
      output_path = ?,
      quarantined_path = ?,
      error = ?,
      started_at = ?,
      finished_at = ?,
      container = ?,
      video_codec = ?,
      audio_codec = ?
    WHERE id = ?
  `).run(
    patch.status ?? cur.status,
    patch.mode ?? cur.mode,
    patch.progress ?? cur.progress,
    patch.outputPath !== undefined ? patch.outputPath : cur.output_path,
    patch.quarantinedPath !== undefined ? patch.quarantinedPath : cur.quarantined_path,
    patch.error !== undefined ? patch.error : cur.error,
    patch.startedAt !== undefined ? patch.startedAt : cur.started_at,
    patch.finishedAt !== undefined ? patch.finishedAt : cur.finished_at,
    patch.container !== undefined ? patch.container : cur.container,
    patch.videoCodec !== undefined ? patch.videoCodec : cur.video_codec,
    patch.audioCodec !== undefined ? patch.audioCodec : cur.audio_codec,
    id,
  )
}

export function cancelConvertJob(id: number): ConvertJobRow | undefined {
  const job = getConvertJob(id)
  if (!job) return undefined
  if (job.status === 'queued') {
    updateConvertJob(id, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      error: 'Cancelled',
    })
  } else if (job.status === 'running') {
    updateConvertJob(id, { status: 'cancelling', error: 'Cancel requested' })
  }
  return getConvertJob(id)
}

export function convertJobStats(): {
  queued: number
  running: number
  done: number
  failed: number
} {
  const row = (status: string) =>
    (
      db.prepare(`SELECT COUNT(*) AS c FROM convert_jobs WHERE status = ?`).get(status) as {
        c: number
      }
    ).c
  return {
    queued: row('queued'),
    running: row('running') + row('cancelling'),
    done: row('done') + row('skipped'),
    failed: row('failed'),
  }
}
