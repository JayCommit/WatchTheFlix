import { config as loadDotenv } from 'dotenv'

export type AppConfig = {
  port: number
  /** Bind address for the HTTP server (default 0.0.0.0). */
  host: string
  appPassword: string
  sessionSecret: string
  webdavUrl: string
  webdavUser: string
  webdavPassword: string
  /** Primary root (compat). Prefer mediaRoots. */
  mediaRoot: string
  /** One or more WebDAV roots to scan (comma-separated MEDIA_ROOTS or MEDIA_ROOT). */
  mediaRoots: string[]
  localMediaRoot: string
  tmdbApiKey: string
  convertConcurrency: number
  convertDeleteOriginalDefault: boolean
  /** none | software | auto | nvenc | vaapi | qsv */
  ffmpegHw: string
  /** Auto-scan interval in minutes; 0 = disabled */
  scanIntervalMinutes: number
  /** Comma-separated path substrings to skip during scan */
  scanIgnore: string[]
  /** After the first admin exists, allow open self-registration as role=user */
  allowPublicRegistration: boolean
  isProd: boolean
}

function normalizeRoot(root: string): string {
  if (!root || root === '/') return '/'
  const withSlash = root.startsWith('/') ? root : `/${root}`
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
}

function normalizeWebdavUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function parseRoots(): string[] {
  const multi = (process.env.MEDIA_ROOTS ?? '').trim()
  if (multi) {
    return multi
      .split(',')
      .map((s) => normalizeRoot(s.trim()))
      .filter(Boolean)
  }
  return [normalizeRoot(process.env.MEDIA_ROOT ?? '/')]
}

function readConfig(): AppConfig {
  const mediaRoots = parseRoots()
  return {
    port: Number(process.env.PORT ?? 8787),
    host: (process.env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
    appPassword: process.env.APP_PASSWORD ?? 'changeme',
    sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-change-me',
    webdavUrl: normalizeWebdavUrl(process.env.SFTPGO_WEBDAV_URL ?? ''),
    webdavUser: process.env.SFTPGO_USER ?? '',
    webdavPassword: process.env.SFTPGO_PASSWORD ?? '',
    mediaRoot: mediaRoots[0] ?? '/',
    mediaRoots,
    localMediaRoot: (process.env.LOCAL_MEDIA_ROOT ?? '').trim(),
    tmdbApiKey: process.env.TMDB_API_KEY ?? '',
    convertConcurrency: Math.max(1, Number(process.env.CONVERT_CONCURRENCY ?? 1)),
    convertDeleteOriginalDefault: ['1', 'true', 'yes'].includes(
      (process.env.CONVERT_DELETE_ORIGINAL ?? '').toLowerCase(),
    ),
    ffmpegHw: (process.env.FFMPEG_HW ?? 'auto').toLowerCase().trim() || 'auto',
    scanIntervalMinutes: Math.max(0, Number(process.env.SCAN_INTERVAL_MINUTES ?? 0) || 0),
    scanIgnore: (process.env.SCAN_IGNORE ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    allowPublicRegistration: ['1', 'true', 'yes'].includes(
      (process.env.ALLOW_PUBLIC_REGISTRATION ?? '').toLowerCase(),
    ),
    isProd: process.env.NODE_ENV === 'production',
  }
}

let cached: AppConfig | null = null
let loadedAt = 0
const RELOAD_MS = 2000

export function getConfig(): AppConfig {
  const now = Date.now()
  if (!cached || now - loadedAt > RELOAD_MS) {
    loadDotenv({ override: true, quiet: true })
    cached = readConfig()
    loadedAt = now
  }
  return cached
}

export function reloadConfig(): AppConfig {
  loadDotenv({ override: true, quiet: true })
  cached = readConfig()
  loadedAt = Date.now()
  return cached
}

export const config = reloadConfig()

export function publicConfigSummary() {
  const c = getConfig()
  let host = ''
  try {
    host = c.webdavUrl ? new URL(c.webdavUrl).host : ''
  } catch {
    host = '(invalid URL)'
  }
  return {
    webdavHost: host,
    webdavUrlSet: Boolean(c.webdavUrl),
    webdavUserSet: Boolean(c.webdavUser),
    webdavPasswordSet: Boolean(c.webdavPassword),
    mediaRoot: c.mediaRoot,
    mediaRoots: c.mediaRoots,
    localMediaRoot: c.localMediaRoot || null,
    localMediaEnabled: Boolean(c.localMediaRoot),
    tmdbKeySet: Boolean(c.tmdbApiKey),
    appPasswordSet: Boolean(c.appPassword),
    convertConcurrency: c.convertConcurrency,
    convertDeleteOriginalDefault: c.convertDeleteOriginalDefault,
    ffmpegHw: c.ffmpegHw,
    scanIntervalMinutes: c.scanIntervalMinutes,
    scanIgnore: c.scanIgnore,
    allowPublicRegistration: c.allowPublicRegistration,
    hasUsers: null as boolean | null, // filled by caller if needed
  }
}

export function assertWebdavConfig(c = getConfig()): void {
  const missing: string[] = []
  if (!c.webdavUrl) missing.push('SFTPGO_WEBDAV_URL')
  if (!c.webdavUser) missing.push('SFTPGO_USER')
  if (!c.webdavPassword) missing.push('SFTPGO_PASSWORD')
  if (missing.length) {
    throw new Error(`Missing WebDAV config: ${missing.join(', ')}. Check your .env file.`)
  }
  try {
    new URL(c.webdavUrl)
  } catch {
    throw new Error(`SFTPGO_WEBDAV_URL is not a valid URL: ${c.webdavUrl}`)
  }
}
