const JUNK = [
  '480p',
  '720p',
  '1080p',
  '2160p',
  '4k',
  'uhd',
  'hdr',
  'hdr10',
  'dv',
  'dolby',
  'vision',
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  'aac',
  'ac3',
  'dts',
  'truehd',
  'atmos',
  'bluray',
  'blu-ray',
  'webrip',
  'web-dl',
  'webdl',
  'hdtv',
  'dvdrip',
  'bdrip',
  'remux',
  'proper',
  'repack',
  'extended',
  'unrated',
  'directors',
  'cut',
  'multi',
  'subs',
  'dubbed',
  'internal',
  'amzn',
  'nf',
  'dsnp',
  'hulu',
  'imax',
  'webdl',
  'web',
]

const SKIP_FOLDERS = new Set([
  'movies',
  'movie',
  'tv',
  'tv shows',
  'tvshows',
  'shows',
  'series',
  'anime',
  'media',
  'storage',
  'downloads',
  'complete',
  'incomplete',
])

export type ParsedMedia = {
  kind: 'movie' | 'tv'
  title: string
  year: number | null
  season: number | null
  episode: number | null
  episodeName: string | null
  /** Absolute show folder path for TV, e.g. /storage/Media/TV Shows/Breaking Bad */
  showRoot: string | null
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

function cleanTokens(raw: string): string {
  let s = raw.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  for (const junk of JUNK) {
    const re = new RegExp(`\\b${junk.replace(/-/g, '[-]?')}\\b`, 'gi')
    s = s.replace(re, ' ')
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** Softer clean for episode titles — keep dots (e.g. "Kidnapping 2.0"). */
function cleanEpisodeName(raw: string): string {
  let s = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  for (const junk of JUNK) {
    const re = new RegExp(`\\b${junk.replace(/-/g, '[-]?')}\\b`, 'gi')
    s = s.replace(re, ' ')
  }
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
  return s.trim()
}

/** Strip season/episode noise that often leaks into show titles. */
export function cleanShowTitle(raw: string): string {
  let s = cleanTokens(raw)
  // "Season 1 Breaking Bad" / "Breaking Bad Season 1" / "S01 Show"
  s = s.replace(/^(?:season|series)\s*\d{1,2}\s+/i, '')
  s = s.replace(/\s+(?:season|series)\s*\d{1,2}$/i, '')
  s = s.replace(/^s\d{1,2}\s+/i, '')
  s = s.replace(/\bseason\s*\d{1,2}\b/gi, ' ')
  s = s.replace(/\bseries\s*\d{1,2}\b/gi, ' ')
  s = s.replace(/\bs\d{1,2}\s*e\d{1,3}\b/gi, ' ')
  s = s.replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
  s = s.replace(/\bepisode\s*\d{1,3}\b/gi, ' ')
  s = s.replace(/\b(complete\s+series|the\s+complete\s+collection|complete\s+collection)\b/gi, ' ')
  s = s.replace(/\b(season|series)\b$/i, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

function isSeasonFolder(name: string): boolean {
  const n = name.trim()
  return (
    /^season[.\s_-]*\d{1,2}$/i.test(n) ||
    /^series[.\s_-]*\d{1,2}$/i.test(n) ||
    /^s\d{1,2}$/i.test(n)
  )
}

function seasonFromFolder(name: string): number | null {
  const n = name.trim()
  const m =
    n.match(/^season[.\s_-]*(\d{1,2})$/i) ||
    n.match(/^series[.\s_-]*(\d{1,2})$/i) ||
    n.match(/^s(\d{1,2})$/i)
  return m ? Number(m[1]) : null
}

/** "Title (Year)" or "Title.Year" / "Title Year" folder names. */
export function parseTitleYearFolder(name: string): { title: string; year: number | null } {
  const cleaned = name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  const paren = cleaned.match(/^(.*?)\s*[\(\[](19\d{2}|20\d{2})[\)\]]\s*$/)
  if (paren) {
    const title = cleanTokens(paren[1] || cleaned).replace(/[-\s]+$/, '').trim()
    return { title: title || cleanTokens(cleaned), year: Number(paren[2]) }
  }
  const year = extractYear(cleaned)
  if (year != null) {
    const withoutYear = cleaned
      .replace(new RegExp(`[.\\s_(\\[-]*${year}[.\\s_)\\]]*$`), '')
      .trim()
    return { title: cleanTokens(withoutYear) || cleanTokens(cleaned), year }
  }
  return { title: cleanTokens(cleaned), year: null }
}

/**
 * Plex-style show root: …/Show Name/Season 01/file.mkv → /…/Show Name
 * Never returns a Season folder.
 */
export function showRootFromPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return null
  parts.pop() // filename
  while (parts.length) {
    const name = parts[parts.length - 1]!
    if (isSeasonFolder(name)) {
      parts.pop()
      continue
    }
    if (SKIP_FOLDERS.has(name.toLowerCase())) {
      return null
    }
    return `/${parts.join('/')}`
  }
  return null
}

/** Show/movie folder basename (skips season + library roots). */
export function titleHintFromPath(path: string): string | undefined {
  const root = showRootFromPath(path)
  if (!root) return undefined
  return root.split('/').filter(Boolean).pop()
}

export function seasonFromPath(path: string): number | null {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  for (let i = parts.length - 1; i >= 0; i--) {
    const season = seasonFromFolder(parts[i]!)
    if (season != null) return season
  }
  return null
}

export function parentFolderName(path: string): string | undefined {
  return titleHintFromPath(path)
}

/**
 * Plex / Sonarr style:
 *   Show Name - S01E02 - Episode Title Bluray-1080p.mkv
 *   Show.Name.S01E02.Episode.Title.mkv
 */
export function parseTvRelease(filename: string): {
  showFromFile: string | null
  season: number | null
  episode: number | null
  episodeName: string | null
} | null {
  const base = stripExtension(filename)

  const patterns: RegExp[] = [
    /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,3})(?:[.\s_-]+(.+))?$/i,
    /^(.*?)[.\s_-]+(\d{1,2})x(\d{1,3})(?:[.\s_-]+(.+))?$/i,
    /^(.*?)[.\s_-]+Season[.\s_-]*(\d{1,2})[.\s_-]+Episode[.\s_-]*(\d{1,3})(?:[.\s_-]+(.+))?$/i,
  ]

  for (const pattern of patterns) {
    const m = base.match(pattern)
    if (!m) continue
    const showFromFile = cleanShowTitle(m[1] || '')
    const episodeName = m[4] ? cleanEpisodeName(m[4]) || null : null
    return {
      showFromFile: showFromFile || null,
      season: Number(m[2]),
      episode: Number(m[3]),
      episodeName,
    }
  }

  const bare =
    base.match(/^[Ss](\d{1,2})[Ee](\d{1,3})(?:[.\s_-]+(.+))?$/i) ||
    base.match(/^(\d{1,2})x(\d{1,3})(?:[.\s_-]+(.+))?$/i)
  if (bare) {
    return {
      showFromFile: null,
      season: Number(bare[1]),
      episode: Number(bare[2]),
      episodeName: bare[3] ? cleanEpisodeName(bare[3]) || null : null,
    }
  }

  return null
}

function looksLikeBadShowTitle(title: string): boolean {
  if (!title) return true
  const t = title.trim()
  if (/^season\b/i.test(t)) return true
  if (/^series\s*\d/i.test(t)) return true
  if (/^s\d{1,2}\b/i.test(t)) return true
  if (/^episode\b/i.test(t)) return true
  if (/^\d{1,3}$/.test(t)) return true
  if (/^(?:season|series|s)\s*\d{1,2}$/i.test(t)) return true
  return false
}

/**
 * Plex rule: the show folder wins. Never use a season folder.
 * Filename show segment is fallback only.
 */
function resolveShowTitle(showFolder: string | undefined, showFromFile: string | null): string {
  const folder = showFolder ? cleanShowTitle(showFolder) : ''
  const fromFile = showFromFile ? cleanShowTitle(showFromFile) : ''

  if (folder && !looksLikeBadShowTitle(folder)) return folder
  if (fromFile && !looksLikeBadShowTitle(fromFile)) return fromFile
  return folder || fromFile || 'Unknown'
}

export function parseMediaPath(path: string): ParsedMedia {
  const filename = path.split('/').filter(Boolean).pop() || path
  const showRoot = showRootFromPath(path)
  const showFolder = titleHintFromPath(path)
  const folderSeason = seasonFromPath(path)
  const tv = parseTvRelease(filename)

  if (tv) {
    return {
      kind: 'tv',
      title: resolveShowTitle(showFolder, tv.showFromFile),
      year: showFolder ? parseTitleYearFolder(showFolder).year : null,
      season: tv.season ?? folderSeason,
      episode: tv.episode,
      episodeName: tv.episodeName,
      showRoot,
    }
  }

  // Episode-only under a Season folder (Plex sometimes uses E01.mkv)
  const epOnly = stripExtension(filename).match(/^(?:[Ee]|[Ee]p(?:isode)?[.\s_-]*)(\d{1,3})\b/i)
  if (folderSeason != null && epOnly && showFolder) {
    return {
      kind: 'tv',
      title: resolveShowTitle(showFolder, null),
      year: parseTitleYearFolder(showFolder).year,
      season: folderSeason,
      episode: Number(epOnly[1]),
      episodeName: null,
      showRoot,
    }
  }

  // Path has Season folder but weird filename — still TV under show root
  if (folderSeason != null && showFolder) {
    return {
      kind: 'tv',
      title: resolveShowTitle(showFolder, null),
      year: parseTitleYearFolder(showFolder).year,
      season: folderSeason,
      episode: null,
      episodeName: null,
      showRoot,
    }
  }

  // Movies: prefer Title (Year) folder
  if (showFolder) {
    const folder = parseTitleYearFolder(showFolder)
    if (folder.year != null && folder.title) {
      return {
        kind: 'movie',
        title: folder.title,
        year: folder.year,
        season: null,
        episode: null,
        episodeName: null,
        showRoot: null,
      }
    }
  }

  const base = stripExtension(filename)
  const yearMatch =
    base.match(/[.(\s_-](19\d{2}|20\d{2})[.)\s_-]/) || base.match(/\((19\d{2}|20\d{2})\)/)
  let titlePart = base
  if (yearMatch?.index != null) {
    titlePart = base.slice(0, yearMatch.index)
  }

  const yearFromFile = yearMatch ? Number(yearMatch[1]) : extractYear(base)
  const fileTitle = cleanTokens(titlePart)
  const folderTitle = showFolder ? parseTitleYearFolder(showFolder).title : ''
  const genericFile =
    !fileTitle ||
    /^(?:movie|video|sample|cd\d+|disc\d+|featurette)$/i.test(fileTitle) ||
    fileTitle.length <= 2

  return {
    kind: 'movie',
    title: (genericFile && folderTitle ? folderTitle : fileTitle || folderTitle) || 'Unknown',
    year: yearFromFile ?? (showFolder ? extractYear(showFolder) : null),
    season: null,
    episode: null,
    episodeName: null,
    showRoot: null,
  }
}

/** @deprecated Prefer parseMediaPath — kept for call sites that only have a filename. */
export function parseFilename(
  filename: string,
  parentHint?: string,
  seasonHint?: number | null,
): ParsedMedia {
  // Synthesize a fake path so shared logic applies
  const seasonSeg =
    seasonHint != null ? `Season ${seasonHint}` : parentHint && isSeasonFolder(parentHint) ? parentHint : null
  const showSeg = parentHint && !isSeasonFolder(parentHint) ? parentHint : 'Unknown'
  const path = seasonSeg
    ? `/tv/${showSeg}/${seasonSeg}/${filename}`
    : `/movies/${showSeg}/${filename}`
  return parseMediaPath(path)
}

function extractYear(text: string): number | null {
  const m = text.match(/(?:^|[.\s_(-])(19\d{2}|20\d{2})(?:$|[.\s_)-])/)
  return m ? Number(m[1]) : null
}

/** Group key: TV uses show root path so all seasons merge; movies use title+year. */
export function normalizeTitleKey(parsed: ParsedMedia): string {
  if (parsed.kind === 'tv' && parsed.showRoot) {
    return `tv:root:${parsed.showRoot.toLowerCase()}`
  }
  const cleaned = (parsed.kind === 'tv' ? cleanShowTitle(parsed.title) : cleanTokens(parsed.title)).toLowerCase()
  return `${parsed.kind}:${cleaned}:${parsed.year ?? ''}`
}
