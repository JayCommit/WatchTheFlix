import { getConfig } from './config.ts'

const TMDB = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p'

type TmdbMovie = {
  id: number
  title: string
  overview: string
  release_date?: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  genre_ids?: number[]
  genres?: Array<{ id: number; name: string }>
}

type TmdbTv = {
  id: number
  name: string
  overview: string
  first_air_date?: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  genre_ids?: number[]
  genres?: Array<{ id: number; name: string }>
}

type SearchResponse<T> = { results: T[] }

export type TmdbMatch = {
  tmdbId: number
  title: string
  overview: string
  year: number | null
  posterPath: string | null
  backdropPath: string | null
  voteAverage: number
  genres: string[]
}

const genreCache = new Map<string, Map<number, string>>()

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = getConfig().tmdbApiKey
  if (!apiKey) {
    throw new Error('TMDB_API_KEY is not configured')
  }
  const url = new URL(`${TMDB}${path}`)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`TMDB ${path} failed: ${res.status}`)
  }
  return (await res.json()) as T
}

async function loadGenres(kind: 'movie' | 'tv'): Promise<Map<number, string>> {
  const cached = genreCache.get(kind)
  if (cached) return cached
  const data = await tmdbFetch<{ genres: Array<{ id: number; name: string }> }>(
    `/genre/${kind}/list`,
  )
  const map = new Map(data.genres.map((g) => [g.id, g.name]))
  genreCache.set(kind, map)
  return map
}

function yearFromDate(date?: string): number | null {
  if (!date) return null
  const y = Number(date.slice(0, 4))
  return Number.isFinite(y) ? y : null
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[:'"!?.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreMatch(query: string, candidate: string, year: number | null, candYear: number | null): number {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  let score = 0
  if (c === q) score += 100
  else if (c.startsWith(q) || q.startsWith(c)) score += 60
  else if (c.includes(q) || q.includes(c)) score += 30
  else {
    const qWords = new Set(q.split(' ').filter(Boolean))
    const cWords = c.split(' ').filter(Boolean)
    const overlap = cWords.filter((w) => qWords.has(w)).length
    score += overlap * 8
  }
  if (year && candYear) {
    if (year === candYear) score += 25
    else if (Math.abs(year - candYear) <= 1) score += 10
    else score -= 15
  }
  return score
}

export function posterUrl(path: string | null | undefined, size: 'w342' | 'w500' | 'original' = 'w500'): string | null {
  return path ? `${IMAGE}/${size}${path}` : null
}

export function backdropUrl(
  path: string | null | undefined,
  size: 'w780' | 'w1280' | 'original' = 'w1280',
): string | null {
  return path ? `${IMAGE}/${size}${path}` : null
}

async function movieToMatch(hit: TmdbMovie): Promise<TmdbMatch> {
  const genres = await loadGenres('movie')
  return {
    tmdbId: hit.id,
    title: hit.title,
    overview: hit.overview,
    year: yearFromDate(hit.release_date),
    posterPath: hit.poster_path,
    backdropPath: hit.backdrop_path,
    voteAverage: hit.vote_average,
    genres: (hit.genre_ids ?? hit.genres?.map((g) => g.id) ?? [])
      .map((id) => (typeof id === 'number' ? genres.get(id) : undefined))
      .filter(Boolean) as string[],
  }
}

async function tvToMatch(hit: TmdbTv): Promise<TmdbMatch> {
  const genres = await loadGenres('tv')
  return {
    tmdbId: hit.id,
    title: hit.name,
    overview: hit.overview,
    year: yearFromDate(hit.first_air_date),
    posterPath: hit.poster_path,
    backdropPath: hit.backdrop_path,
    voteAverage: hit.vote_average,
    genres: (hit.genre_ids ?? hit.genres?.map((g) => g.id) ?? [])
      .map((id) => (typeof id === 'number' ? genres.get(id) : undefined))
      .filter(Boolean) as string[],
  }
}

function pickBestMovie(results: TmdbMovie[], query: string, year?: number | null): TmdbMovie | null {
  if (!results.length) return null
  const ranked = [...results].sort(
    (a, b) =>
      scoreMatch(query, b.title, year ?? null, yearFromDate(b.release_date)) -
      scoreMatch(query, a.title, year ?? null, yearFromDate(a.release_date)),
  )
  return ranked[0] ?? null
}

function pickBestTv(results: TmdbTv[], query: string, year?: number | null): TmdbTv | null {
  if (!results.length) return null
  const ranked = [...results].sort(
    (a, b) =>
      scoreMatch(query, b.name, year ?? null, yearFromDate(b.first_air_date)) -
      scoreMatch(query, a.name, year ?? null, yearFromDate(a.first_air_date)),
  )
  return ranked[0] ?? null
}

/** Clean release-name noise before hitting TMDB search. */
function prepareSearchQuery(query: string): { query: string; year: number | null } {
  let q = query.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  let year: number | null = null
  const yearMatch = q.match(/[\(\[]?(19\d{2}|20\d{2})[\)\]]?\s*$/)
  if (yearMatch) {
    year = Number(yearMatch[1])
    q = q.slice(0, yearMatch.index).replace(/[-\s]+$/, '').trim()
  }
  q = q
    .replace(/\b(?:season|series)\s*\d{1,2}\b/gi, ' ')
    .replace(/\bs\d{1,2}\s*e\d{1,3}\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { query: q || query.trim(), year }
}

export async function searchMovie(query: string, year?: number | null): Promise<TmdbMatch | null> {
  const prepared = prepareSearchQuery(query)
  const q = prepared.query
  const y = year ?? prepared.year
  const params: Record<string, string> = { query: q, include_adult: 'false' }
  if (y) params.year = String(y)
  let data = await tmdbFetch<SearchResponse<TmdbMovie>>('/search/movie', params)
  let hit = pickBestMovie(data.results, q, y)
  // Retry without year if year-filtered search missed
  if (!hit && y) {
    data = await tmdbFetch<SearchResponse<TmdbMovie>>('/search/movie', {
      query: q,
      include_adult: 'false',
    })
    hit = pickBestMovie(data.results, q, y)
  }
  return hit ? movieToMatch(hit) : null
}

export async function searchTv(query: string, year?: number | null): Promise<TmdbMatch | null> {
  const prepared = prepareSearchQuery(query)
  const q = prepared.query
  const y = year ?? prepared.year
  const params: Record<string, string> = { query: q, include_adult: 'false' }
  if (y) params.first_air_date_year = String(y)
  let data = await tmdbFetch<SearchResponse<TmdbTv>>('/search/tv', params)
  let hit = pickBestTv(data.results, q, y)
  if (!hit && y) {
    data = await tmdbFetch<SearchResponse<TmdbTv>>('/search/tv', {
      query: q,
      include_adult: 'false',
    })
    hit = pickBestTv(data.results, q, y)
  }
  return hit ? tvToMatch(hit) : null
}

export async function searchTmdb(
  kind: 'movie' | 'tv',
  query: string,
  year?: number | null,
  limit = 10,
): Promise<TmdbMatch[]> {
  const prepared = prepareSearchQuery(query)
  const q = prepared.query
  const y = year ?? prepared.year
  if (kind === 'movie') {
    const params: Record<string, string> = { query: q, include_adult: 'false' }
    if (y) params.year = String(y)
    const data = await tmdbFetch<SearchResponse<TmdbMovie>>('/search/movie', params)
    const ranked = [...data.results].sort(
      (a, b) =>
        scoreMatch(q, b.title, y ?? null, yearFromDate(b.release_date)) -
        scoreMatch(q, a.title, y ?? null, yearFromDate(a.release_date)),
    )
    return Promise.all(ranked.slice(0, limit).map(movieToMatch))
  }
  const params: Record<string, string> = { query: q, include_adult: 'false' }
  if (y) params.first_air_date_year = String(y)
  const data = await tmdbFetch<SearchResponse<TmdbTv>>('/search/tv', params)
  const ranked = [...data.results].sort(
    (a, b) =>
      scoreMatch(q, b.name, y ?? null, yearFromDate(b.first_air_date)) -
      scoreMatch(q, a.name, y ?? null, yearFromDate(a.first_air_date)),
  )
  return Promise.all(ranked.slice(0, limit).map(tvToMatch))
}

export async function getMovieById(tmdbId: number): Promise<TmdbMatch | null> {
  try {
    const hit = await tmdbFetch<TmdbMovie>(`/movie/${tmdbId}`)
    const genreNames = (hit.genres ?? []).map((g) => g.name).filter(Boolean)
    if (!genreNames.length && hit.genre_ids?.length) {
      const genres = await loadGenres('movie')
      for (const id of hit.genre_ids) {
        const name = genres.get(id)
        if (name) genreNames.push(name)
      }
    }
    return {
      tmdbId: hit.id,
      title: hit.title,
      overview: hit.overview,
      year: yearFromDate(hit.release_date),
      posterPath: hit.poster_path,
      backdropPath: hit.backdrop_path,
      voteAverage: hit.vote_average,
      genres: genreNames,
    }
  } catch {
    return null
  }
}

export async function getTvById(tmdbId: number): Promise<TmdbMatch | null> {
  try {
    const hit = await tmdbFetch<TmdbTv>(`/tv/${tmdbId}`)
    return {
      tmdbId: hit.id,
      title: hit.name,
      overview: hit.overview,
      year: yearFromDate(hit.first_air_date),
      posterPath: hit.poster_path,
      backdropPath: hit.backdrop_path,
      voteAverage: hit.vote_average,
      genres: (hit.genres ?? []).map((g) => g.name).filter(Boolean),
    }
  } catch {
    return null
  }
}

export async function getByTmdbId(kind: 'movie' | 'tv', tmdbId: number): Promise<TmdbMatch | null> {
  return kind === 'movie' ? getMovieById(tmdbId) : getTvById(tmdbId)
}

export async function getEpisodeName(
  tmdbId: number,
  season: number,
  episode: number,
): Promise<string | null> {
  try {
    const data = await tmdbFetch<{ name?: string }>(
      `/tv/${tmdbId}/season/${season}/episode/${episode}`,
    )
    return data.name ?? null
  } catch {
    return null
  }
}

export type TmdbSeasonEpisode = {
  season: number
  episode: number
  name: string
  airDate: string | null
}

export async function getTvSeasonEpisodes(
  tmdbId: number,
  season: number,
): Promise<TmdbSeasonEpisode[]> {
  const data = await tmdbFetch<{
    episodes?: Array<{ episode_number: number; name: string; air_date?: string }>
  }>(`/tv/${tmdbId}/season/${season}`)
  return (data.episodes ?? []).map((e) => ({
    season,
    episode: e.episode_number,
    name: e.name,
    airDate: e.air_date ?? null,
  }))
}

export async function getTvSeasonCount(tmdbId: number): Promise<number> {
  const data = await tmdbFetch<{ number_of_seasons?: number }>(`/tv/${tmdbId}`)
  return data.number_of_seasons ?? 0
}

export type TmdbTrailer = {
  key: string
  name: string
  site: string
  type: string
  url: string
}

export async function getTrailers(kind: 'movie' | 'tv', tmdbId: number): Promise<TmdbTrailer[]> {
  try {
    const data = await tmdbFetch<{
      results?: Array<{ key: string; name: string; site: string; type: string; official?: boolean }>
    }>(`/${kind}/${tmdbId}/videos`)
    return (data.results ?? [])
      .filter((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
      .slice(0, 6)
      .map((v) => ({
        key: v.key,
        name: v.name,
        site: v.site,
        type: v.type,
        url: `https://www.youtube.com/watch?v=${v.key}`,
      }))
  } catch {
    return []
  }
}

export type TmdbCastMember = {
  id: number
  name: string
  character: string
  profilePath: string | null
}

export async function getCredits(
  kind: 'movie' | 'tv',
  tmdbId: number,
): Promise<TmdbCastMember[]> {
  try {
    const data = await tmdbFetch<{
      cast?: Array<{ id: number; name: string; character?: string; profile_path?: string | null }>
    }>(`/${kind}/${tmdbId}/credits`)
    return (data.cast ?? []).slice(0, 12).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character ?? '',
      profilePath: c.profile_path ?? null,
    }))
  } catch {
    return []
  }
}
