import { config as loadDotenv } from 'dotenv'

export type AppConfig = {
  port: number
  appPassword: string
  sessionSecret: string
  webdavUrl: string
  webdavUser: string
  webdavPassword: string
  mediaRoot: string
  /** Absolute local path where media is mounted (Ubuntu container). Empty = WebDAV-only. */
  localMediaRoot: string
  tmdbApiKey: string
  convertConcurrency: number
  /** Default for new convert jobs: quarantine then optionally delete originals */
  convertDeleteOriginalDefault: boolean
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

function readConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 8787),
    appPassword: process.env.APP_PASSWORD ?? 'changeme',
    sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-change-me',
    webdavUrl: normalizeWebdavUrl(process.env.SFTPGO_WEBDAV_URL ?? ''),
    webdavUser: process.env.SFTPGO_USER ?? '',
    webdavPassword: process.env.SFTPGO_PASSWORD ?? '',
    mediaRoot: normalizeRoot(process.env.MEDIA_ROOT ?? '/'),
    localMediaRoot: (process.env.LOCAL_MEDIA_ROOT ?? '').trim(),
    tmdbApiKey: process.env.TMDB_API_KEY ?? '',
    convertConcurrency: Math.max(1, Number(process.env.CONVERT_CONCURRENCY ?? 1)),
    convertDeleteOriginalDefault: ['1', 'true', 'yes'].includes(
      (process.env.CONVERT_DELETE_ORIGINAL ?? '').toLowerCase(),
    ),
    isProd: process.env.NODE_ENV === 'production',
  }
}

let cached: AppConfig | null = null
let loadedAt = 0
const RELOAD_MS = 2000

/** Cached config; re-reads .env at most every few seconds. */
export function getConfig(): AppConfig {
  const now = Date.now()
  if (!cached || now - loadedAt > RELOAD_MS) {
    loadDotenv({ override: true, quiet: true })
    cached = readConfig()
    loadedAt = now
  }
  return cached
}

/** Force a fresh .env read (scan / diagnostics). */
export function reloadConfig(): AppConfig {
  loadDotenv({ override: true, quiet: true })
  cached = readConfig()
  loadedAt = Date.now()
  return cached
}

/** Snapshot for startup. Prefer getConfig() in request paths. */
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
    localMediaRoot: c.localMediaRoot || null,
    localMediaEnabled: Boolean(c.localMediaRoot),
    tmdbKeySet: Boolean(c.tmdbApiKey),
    appPasswordSet: Boolean(c.appPassword),
    convertConcurrency: c.convertConcurrency,
    convertDeleteOriginalDefault: c.convertDeleteOriginalDefault,
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
