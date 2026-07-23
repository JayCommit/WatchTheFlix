import {
  getFilesForTitle,
  getTitleById,
  getTitleByTmdb,
  mergeTitles,
  patchTitle,
  updateEpisodeName,
} from './db.ts'
import { getEpisodeName, type TmdbMatch } from './tmdb.ts'

export async function applyTmdbMatch(
  titleId: number,
  kind: 'movie' | 'tv',
  meta: TmdbMatch,
): Promise<{ title: NonNullable<ReturnType<typeof getTitleById>>; mergedIntoId?: number }> {
  const current = getTitleById(titleId)
  if (!current) throw new Error('Title not found')

  const fields = {
    title: meta.title,
    kind,
    tmdbId: meta.tmdbId,
    overview: meta.overview,
    year: meta.year,
    posterPath: meta.posterPath,
    backdropPath: meta.backdropPath,
    voteAverage: meta.voteAverage,
    genres: meta.genres,
    hidden: false,
    manualOverride: true,
  } as const

  const clash = getTitleByTmdb(kind, meta.tmdbId)
  if (clash && clash.id !== titleId) {
    // Prefer consolidating into the existing TMDB title
    mergeTitles(titleId, clash.id)
    const merged = patchTitle(clash.id, fields)
    if (!merged) throw new Error('Title not found after merge')
    return { title: merged, mergedIntoId: clash.id }
  }

  const updated = patchTitle(titleId, fields)
  if (!updated) throw new Error('Title not found')
  return { title: updated }
}

export async function fillMissingEpisodeNames(titleId: number, tmdbId: number): Promise<void> {
  if (tmdbId <= 0) return
  const files = getFilesForTitle(titleId)
  const missing = files.filter(
    (f) => f.season != null && f.episode != null && !f.episode_name,
  )
  if (!missing.length) return

  let i = 0
  const concurrency = 4
  const workers = Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
    while (i < missing.length) {
      const idx = i++
      const f = missing[idx]!
      const name = await getEpisodeName(tmdbId, f.season!, f.episode!)
      if (name) updateEpisodeName(f.path, name)
    }
  })
  await Promise.all(workers)
}
