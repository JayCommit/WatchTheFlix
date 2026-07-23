import {
  countLibrary,
  listMediaFilesWithTitles,
  pruneMissingFiles,
  setScanMeta,
  updateEpisodeName,
  upsertMediaFile,
  upsertTitle,
} from './db.ts'
import { getConfig } from './config.ts'
import { normalizeTitleKey, parseMediaPath } from './parse.ts'
import { getEpisodeName, searchMovie, searchTv } from './tmdb.ts'
import { listAllVideos } from './webdav.ts'

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
  warning?: string
}

type CachedTitle = {
  titleId: number
  tmdbId: number
  matched: boolean
}

export async function scanLibrary(): Promise<ScanResult> {
  const cfg = getConfig()
  if (!cfg.tmdbApiKey) {
    throw new Error('TMDB_API_KEY is missing in .env')
  }

  const listed = await listAllVideos()
  const { videos, dirsScanned, mediaRoot, errors: listErrors } = listed

  if (videos.length === 0) {
    return {
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
      warning:
        `WebDAV connected but found 0 video files under "${mediaRoot}" ` +
        `(scanned ${dirsScanned} folders). Check MEDIA_ROOT and that files are mp4/mkv/webm/avi/m4v/mov.`,
    }
  }

  const existingByPath = new Map(
    listMediaFilesWithTitles().map((f) => [f.path, f] as const),
  )

  const titleCache = new Map<string, CachedTitle>()
  const errors: string[] = [...listErrors]
  const seenPaths = new Set<string>()
  const episodeJobs: Array<{ path: string; tmdbId: number; season: number; episode: number }> = []
  let matched = 0
  let unmatched = 0
  let preservedOverrides = 0

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
  }

  // Drops missing files AND orphan season-split titles left from old scans
  pruneMissingFiles(seenPaths)

  if (episodeJobs.length) {
    const batch = episodeJobs.slice(0, 120)
    await mapPool(batch, 5, async (job) => {
      const name = await getEpisodeName(job.tmdbId, job.season, job.episode)
      if (name) updateEpisodeName(job.path, name)
    })
  }

  setScanMeta('last_scan', new Date().toISOString())
  const counts = countLibrary()
  const tvShows = [...titleCache.keys()].filter((k) => k.startsWith('tv:')).length

  return {
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
