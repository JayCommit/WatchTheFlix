import { getFilesForTitle, getTitleById } from './db.ts'
import { getTvSeasonCount, getTvSeasonEpisodes } from './tmdb.ts'

export type MissingEpisode = {
  season: number
  episode: number
  name: string
  airDate: string | null
}

const GRACE_MS = 24 * 60 * 60 * 1000

function isAired(airDate: string | null): boolean {
  if (!airDate) return false
  const t = Date.parse(airDate)
  if (!Number.isFinite(t)) return false
  return t <= Date.now() + GRACE_MS
}

export async function getTitleHealth(titleId: number): Promise<{
  titleId: number
  kind: string
  missing: MissingEpisode[]
  present: number
  expected: number
  seasonsChecked: number
}> {
  const title = getTitleById(titleId)
  if (!title || title.kind !== 'tv' || title.tmdb_id < 0) {
    return {
      titleId,
      kind: title?.kind ?? 'unknown',
      missing: [],
      present: 0,
      expected: 0,
      seasonsChecked: 0,
    }
  }

  const files = getFilesForTitle(titleId)
  const have = new Set(
    files
      .filter((f) => f.season != null && f.episode != null)
      .map((f) => `${f.season}x${f.episode}`),
  )

  const seasonCount = await getTvSeasonCount(title.tmdb_id)
  const missing: MissingEpisode[] = []
  let expected = 0
  let presentAired = 0
  const maxSeasons = Math.min(seasonCount, 30)

  for (let s = 1; s <= maxSeasons; s++) {
    try {
      const eps = await getTvSeasonEpisodes(title.tmdb_id, s)
      for (const ep of eps) {
        if (!isAired(ep.airDate)) continue
        expected += 1
        if (have.has(`${ep.season}x${ep.episode}`)) {
          presentAired += 1
        } else {
          missing.push(ep)
        }
      }
    } catch {
      /* season may not exist */
    }
  }

  return {
    titleId,
    kind: 'tv',
    missing: missing.slice(0, 200),
    present: presentAired,
    expected,
    seasonsChecked: maxSeasons,
  }
}
