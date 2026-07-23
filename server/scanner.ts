import {
  countLibrary,
  getScanMeta,
  listMediaFilesWithTitles,
  pruneMissingFiles,
  setScanMeta,
  updateEpisodeName,
  upsertMediaFile,
  upsertTitle,
} from './db.ts'
import { getConfig } from './config.ts'
import { listAllLocalVideos, localMediaEnabled } from './mediafs.ts'
import { normalizeTitleKey, parseMediaPath } from './parse.ts'
import { getEpisodeName, searchMovie, searchTv } from './tmdb.ts'
import { listAllVideos } from './webdav.ts'

export type ScanSource = 'local' | 'webdav'

export type ScanProgressPhase = 'listing' | 'matching' | 'episodes' | 'done' | 'error'

export type ScanProgress = {
  phase: ScanProgressPhase
  source: ScanSource
  filesFound: number
  processed: number
  dirsScanned: number
  matched: number
  unmatched: number
  errors: string[]
  message: string
  mediaRoot?: string
  startedAt: string
  finishedAt?: string
}

export type ScanResult = {
  filesFound: number
  matched: number
  unmatched: number
  titles: number
  files: number
  dirsScanned: number
  mediaRoot: string
  errors: string[]
  preservedOverrides: number
  tvShows: number
  source: ScanSource
  warning?: string
}

type CachedTitle = {
  titleId: number
  tmdbId: number
  matched: boolean
}

function writeProgress(progress: ScanProgress): void {
  setScanMeta('scan_progress', JSON.stringify(progress))
  if (progress.phase === 'done') {
    setScanMeta('scan_status', 'idle')
  } else if (progress.phase === 'error') {
    setScanMeta('scan_status', 'error')
  } else {
    setScanMeta('scan_status', 'running')
  }
}

export function readScanProgress(): ScanProgress | null {
  const raw = getScanMeta('scan_progress')
  if (!raw) return null
  try {
    return JSON.parse(raw) as ScanProgress
  } catch {
    return null
  }
}

export function readLastScanResult(): ScanResult | null {
  const raw = getScanMeta('last_scan_result')
  if (!raw) return null
  try {
    return JSON.parse(raw) as ScanResult
  } catch {
    return null
  }
}

export async function scanLibrary(): Promise<ScanResult> {
  const cfg = getConfig()
  if (!cfg.tmdbApiKey) {
    throw new Error('TMDB_API_KEY is missing in .env')
  }

  const source: ScanSource = localMediaEnabled() ? 'local' : 'webdav'
  const startedAt = new Date().toISOString()
  const progress: ScanProgress = {
    phase: 'listing',
    source,
    filesFound: 0,
    processed: 0,
    dirsScanned: 0,
    matched: 0,
    unmatched: 0,
    errors: [],
    message:
      source === 'local'
        ? 'Listing video files on local disk…'
        : 'Listing video files over WebDAV…',
    startedAt,
  }
  writeProgress(progress)

  try {
    const listed =
      source === 'local' ? await listAllLocalVideos() : await listAllVideos()
    const { videos, dirsScanned, mediaRoot, errors: listErrors } = listed

    progress.filesFound = videos.length
    progress.dirsScanned = dirsScanned
    progress.mediaRoot = mediaRoot
    progress.errors = [...listErrors]
    progress.phase = 'matching'
    progress.message =
      videos.length === 0
        ? 'No video files found'
        : `Matching ${videos.length} files on TMDB…`
    writeProgress(progress)

    if (videos.length === 0) {
      const warning =
        source === 'local'
          ? `Local disk scan found 0 video files under "${mediaRoot}" ` +
            `(scanned ${dirsScanned} folders under LOCAL_MEDIA_ROOT). ` +
            'Check LOCAL_MEDIA_ROOT, MEDIA_ROOT / MEDIA_ROOTS, and that files are mp4/mkv/webm/avi/m4v/mov.'
          : `WebDAV connected but found 0 video files under "${mediaRoot}" ` +
            `(scanned ${dirsScanned} folders). Check MEDIA_ROOT and that files are mp4/mkv/webm/avi/m4v/mov.`

      const result: ScanResult = {
        filesFound: 0,
        matched: 0,
        unmatched: 0,
        titles: countLibrary().titles,
        files: countLibrary().files,
        dirsScanned,
        mediaRoot,
        errors: listErrors,
        preservedOverrides: 0,
        tvShows: 0,
        source,
        warning,
      }
      progress.phase = 'done'
      progress.finishedAt = new Date().toISOString()
      progress.message = warning
      writeProgress(progress)
      setScanMeta('last_scan', progress.finishedAt)
      setScanMeta('last_scan_result', JSON.stringify(result))
      return result
    }

    const existingByPath = new Map(
      listMediaFilesWithTitles().map((f) => [f.path, f] as const),
    )

    const titleCache = new Map<string, CachedTitle>()
    const errors: string[] = [...listErrors]
    const seenPaths = new Set<string>()
    const episodeJobs: Array<{
      path: string
      tmdbId: number
      season: number
      episode: number
    }> = []
    let matched = 0
    let unmatched = 0
    let preservedOverrides = 0
    let processed = 0

    for (const video of videos) {
      seenPaths.add(video.path)
      try {
        const existing = existingByPath.get(video.path)
        const parsed = parseMediaPath(video.path)

        if (existing?.manual_override) {
          preservedOverrides += 1
          upsertMediaFile({
            path: video.path,
            filename: video.filename,
            size: video.size,
            titleId: existing.title_id,
            season: parsed.season ?? existing.season,
            episode: parsed.episode ?? existing.episode,
            episodeName: parsed.episodeName ?? existing.episode_name,
            keepEpisodeName: !parsed.episodeName,
          })
          processed += 1
          progress.processed = processed
          if (processed % 25 === 0 || processed === videos.length) {
            progress.message = `Matching ${processed}/${videos.length}…`
            writeProgress(progress)
          }
          continue
        }

        // Plex: one cache entry per show folder (all seasons merge)
        const cacheKey = normalizeTitleKey(parsed)

        let cached = titleCache.get(cacheKey)
        if (!cached) {
          const meta =
            parsed.kind === 'tv'
              ? await searchTv(parsed.title, parsed.year)
              : await searchMovie(parsed.title, parsed.year)

          if (!meta) {
            unmatched += 1
            const titleId = upsertTitle({
              kind: parsed.kind,
              tmdbId: -Math.abs(hashString(cacheKey)),
              title: parsed.title,
              overview: 'No TMDB match found for this release name.',
              year: parsed.year,
              posterPath: null,
              backdropPath: null,
              voteAverage: null,
              genres: [],
            })
            cached = { titleId, tmdbId: -1, matched: false }
          } else {
            matched += 1
            const titleId = upsertTitle({
              kind: parsed.kind,
              tmdbId: meta.tmdbId,
              title: meta.title,
              overview: meta.overview,
              year: meta.year,
              posterPath: meta.posterPath,
              backdropPath: meta.backdropPath,
              voteAverage: meta.voteAverage,
              genres: meta.genres,
            })
            cached = { titleId, tmdbId: meta.tmdbId, matched: true }
          }
          titleCache.set(cacheKey, cached)
        } else if (cached.matched) {
          matched += 1
        } else {
          unmatched += 1
        }

        upsertMediaFile({
          path: video.path,
          filename: video.filename,
          size: video.size,
          titleId: cached.titleId,
          season: parsed.season,
          episode: parsed.episode,
          episodeName: parsed.episodeName,
          keepEpisodeName: !parsed.episodeName,
        })

        if (
          parsed.kind === 'tv' &&
          cached.matched &&
          cached.tmdbId > 0 &&
          parsed.season != null &&
          parsed.episode != null &&
          !parsed.episodeName
        ) {
          const prior = existingByPath.get(video.path)
          if (!prior?.episode_name) {
            episodeJobs.push({
              path: video.path,
              tmdbId: cached.tmdbId,
              season: parsed.season,
              episode: parsed.episode,
            })
          }
        }
      } catch (err) {
        unmatched += 1
        errors.push(`${video.path}: ${err instanceof Error ? err.message : String(err)}`)
      }

      processed += 1
      progress.processed = processed
      progress.matched = matched
      progress.unmatched = unmatched
      progress.errors = errors.slice(0, 30)
      if (processed % 25 === 0 || processed === videos.length) {
        progress.message = `Matching ${processed}/${videos.length}…`
        writeProgress(progress)
      }
    }

    // Drops missing files AND orphan season-split titles left from old scans
    pruneMissingFiles(seenPaths)

    if (episodeJobs.length) {
      progress.phase = 'episodes'
      progress.message = `Fetching episode names (${Math.min(episodeJobs.length, 120)})…`
      writeProgress(progress)
      const batch = episodeJobs.slice(0, 120)
      await mapPool(batch, 5, async (job) => {
        const name = await getEpisodeName(job.tmdbId, job.season, job.episode)
        if (name) updateEpisodeName(job.path, name)
      })
    }

    const finishedAt = new Date().toISOString()
    setScanMeta('last_scan', finishedAt)
    const counts = countLibrary()
    const tvShows = [...titleCache.keys()].filter((k) => k.startsWith('tv:')).length

    const result: ScanResult = {
      filesFound: videos.length,
      matched,
      unmatched,
      titles: counts.titles,
      files: counts.files,
      dirsScanned,
      mediaRoot,
      errors: errors.slice(0, 30),
      preservedOverrides,
      tvShows,
      source,
    }

    progress.phase = 'done'
    progress.finishedAt = finishedAt
    progress.matched = matched
    progress.unmatched = unmatched
    progress.errors = result.errors
    progress.message = `Done — ${result.filesFound} files · ${result.matched} matched · ${result.unmatched} unmatched`
    writeProgress(progress)
    setScanMeta('last_scan_result', JSON.stringify(result))
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    progress.phase = 'error'
    progress.message = msg
    progress.finishedAt = new Date().toISOString()
    progress.errors = [...progress.errors, msg].slice(0, 30)
    writeProgress(progress)
    throw err
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx]!)
    }
  })
  await Promise.all(workers)
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h === 0 ? 1 : h
}
