import { createClient, type FileStat, type WebDAVClient } from 'webdav'
import { assertWebdavConfig, getConfig } from './config.ts'

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.avi', '.m4v', '.mov'])

let client: WebDAVClient | null = null
let clientKey = ''

function getClient(): WebDAVClient {
  const c = getConfig()
  assertWebdavConfig(c)
  const key = `${c.webdavUrl}|${c.webdavUser}|${c.webdavPassword}`
  if (!client || clientKey !== key) {
    client = createClient(c.webdavUrl, {
      username: c.webdavUser,
      password: c.webdavPassword,
    })
    clientKey = key
  }
  return client
}

export type RemoteVideo = {
  path: string
  filename: string
  size: number
  lastmod?: string
}

export type ListVideosResult = {
  videos: RemoteVideo[]
  mediaRoot: string
  dirsScanned: number
  errors: string[]
}

export class WebdavError extends Error {
  status?: number
  path?: string

  constructor(message: string, opts?: { status?: number; path?: string; cause?: unknown }) {
    super(message)
    this.name = 'WebdavError'
    this.status = opts?.status
    this.path = opts?.path
    if (opts?.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = opts.cause
    }
  }
}

function joinPath(base: string, name: string): string {
  if (base === '/' || base === '') return `/${name}`
  return `${base.replace(/\/$/, '')}/${name}`
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i).toLowerCase() : ''
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function errStatus(err: unknown): number | undefined {
  const anyErr = err as { status?: number; response?: { status?: number } }
  return anyErr.status ?? anyErr.response?.status
}

export async function probeWebdav(): Promise<{
  ok: boolean
  mediaRoot: string
  rootEntries: Array<{ type: string; name: string }>
  mediaEntries: Array<{ type: string; name: string }>
  error?: string
}> {
  const c = getConfig()
  try {
    assertWebdavConfig(c)
    const dav = getClient()

    const rootRaw = (await dav.getDirectoryContents('/')) as FileStat[] | FileStat
    const rootList = Array.isArray(rootRaw) ? rootRaw : [rootRaw]
    const rootEntries = rootList.slice(0, 20).map((e) => ({
      type: e.type,
      name: e.basename || e.filename,
    }))

    const mediaRaw = (await dav.getDirectoryContents(c.mediaRoot)) as FileStat[] | FileStat
    const mediaList = Array.isArray(mediaRaw) ? mediaRaw : [mediaRaw]
    const mediaEntries = mediaList.slice(0, 20).map((e) => ({
      type: e.type,
      name: e.basename || e.filename,
    }))

    return {
      ok: true,
      mediaRoot: c.mediaRoot,
      rootEntries,
      mediaEntries,
    }
  } catch (err) {
    const status = errStatus(err)
    const hint =
      status === 401 || status === 403
        ? 'Check SFTPGO_USER / SFTPGO_PASSWORD.'
        : status === 404
          ? 'Check MEDIA_ROOT — path not found on the WebDAV server.'
          : 'Check SFTPGO_WEBDAV_URL is reachable from this machine.'
    return {
      ok: false,
      mediaRoot: c.mediaRoot,
      rootEntries: [],
      mediaEntries: [],
      error: `${errMessage(err)}${status ? ` (HTTP ${status})` : ''}. ${hint}`,
    }
  }
}

export async function listAllVideos(root?: string): Promise<ListVideosResult> {
  const cfg = getConfig()
  const roots = root ? [root] : cfg.mediaRoots.length ? cfg.mediaRoots : [cfg.mediaRoot]
  const dav = getClient()
  const videos: RemoteVideo[] = []
  const errors: string[] = []
  let dirsScanned = 0
  const ignore = cfg.scanIgnore

  async function walk(dir: string, isRoot: boolean): Promise<void> {
    let entries: FileStat[] | FileStat
    try {
      entries = (await dav.getDirectoryContents(dir)) as FileStat[] | FileStat
    } catch (err) {
      const status = errStatus(err)
      const msg = `${dir}: ${errMessage(err)}${status ? ` (HTTP ${status})` : ''}`
      if (isRoot) {
        throw new WebdavError(
          `Cannot list MEDIA_ROOT "${dir}". ${errMessage(err)}${status ? ` (HTTP ${status})` : ''}. ` +
            'Verify SFTPGO_WEBDAV_URL, credentials, and MEDIA_ROOT.',
          { status, path: dir, cause: err },
        )
      }
      errors.push(msg)
      console.warn('WebDAV list failed:', msg)
      return
    }

    dirsScanned += 1
    const list = Array.isArray(entries) ? entries : [entries]
    for (const entry of list) {
      const filename = entry.basename || entry.filename.split('/').filter(Boolean).pop() || ''
      const path = entry.filename.startsWith('/')
        ? entry.filename
        : joinPath(dir, filename)

      const pathLower = path.toLowerCase()
      if (ignore.some((frag) => pathLower.includes(frag))) continue

      if (entry.type === 'directory') {
        await walk(path, false)
        continue
      }

      if (VIDEO_EXT.has(extOf(filename))) {
        videos.push({
          path,
          filename,
          size: typeof entry.size === 'number' ? entry.size : 0,
          lastmod: entry.lastmod,
        })
      }
    }
  }

  for (const r of roots) {
    const startRoot = r === '' ? '/' : r
    try {
      await walk(startRoot, true)
    } catch (err) {
      if (roots.length === 1) throw err
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  return { videos, mediaRoot: roots.join(', '), dirsScanned, errors }
}

export async function streamFile(
  path: string,
  rangeHeader?: string | null,
): Promise<Response> {
  const c = getConfig()
  assertWebdavConfig(c)

  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const encoded = cleanPath
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(seg) : ''))
    .join('/')
  const target = `${c.webdavUrl}${encoded}`

  const headers: Record<string, string> = {
    Authorization:
      'Basic ' + Buffer.from(`${c.webdavUser}:${c.webdavPassword}`).toString('base64'),
  }
  if (rangeHeader) {
    headers.Range = rangeHeader
  }

  const upstream = await fetch(target, { headers })
  if (!upstream.ok && upstream.status !== 206) {
    throw new WebdavError(
      `Stream failed for ${path}: HTTP ${upstream.status} ${upstream.statusText}`,
      { status: upstream.status, path },
    )
  }
  return upstream
}

export function contentTypeFor(filename: string): string {
  const ext = extOf(filename)
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mkv':
      return 'video/x-matroska'
    case '.avi':
      return 'video/x-msvideo'
    case '.mov':
      return 'video/quicktime'
    default:
      return 'application/octet-stream'
  }
}
