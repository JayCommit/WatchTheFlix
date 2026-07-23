import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  statSync,
  copyFileSync,
  promises as fsp,
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { getConfig } from './config.ts'
import type { ListVideosResult, RemoteVideo } from './webdav.ts'

export type { ListVideosResult, RemoteVideo }

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.avi', '.m4v', '.mov'])

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i).toLowerCase() : ''
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * List video files under LOCAL_MEDIA_ROOT, returning WebDAV-style library paths
 * (inverse of resolveLocalPath).
 *
 * Layouts:
 * - Nested: LOCAL_MEDIA_ROOT/<mediaRoot>/… (typical multi-root Movies/TV)
 * - Flat (single root only): LOCAL_MEDIA_ROOT is the media-root contents
 */
export async function listAllLocalVideos(): Promise<ListVideosResult> {
  const cfg = getConfig()
  const localRootRaw = cfg.localMediaRoot?.trim()
  if (!localRootRaw) {
    throw new Error('LOCAL_MEDIA_ROOT is not set. Set it to your media mount path.')
  }
  const localRoot = resolve(localRootRaw)
  try {
    const st = await fsp.stat(localRoot)
    if (!st.isDirectory()) {
      throw new Error(`LOCAL_MEDIA_ROOT is not a directory: ${localRoot}`)
    }
  } catch (err) {
    throw new Error(
      `LOCAL_MEDIA_ROOT is missing or unreadable: ${localRoot}. ${errMessage(err)}`,
    )
  }

  const roots = cfg.mediaRoots.length ? cfg.mediaRoots : [cfg.mediaRoot]
  const videos: RemoteVideo[] = []
  const errors: string[] = []
  let dirsScanned = 0
  const ignore = cfg.scanIgnore

  function localStartForRoot(mediaRoot: string): string {
    if (mediaRoot === '/' || mediaRoot === '') return localRoot
    const nested = resolve(join(localRoot, mediaRoot.replace(/^\/+/, '')))
    if (existsSync(nested)) return nested
    // Single-root mount: LOCAL_MEDIA_ROOT holds the media root contents
    if (roots.length === 1) return localRoot
    return nested
  }

  function toLibraryPath(mediaRoot: string, startLocal: string, absoluteLocal: string): string {
    const rel = relative(startLocal, absoluteLocal).split(sep).join('/')
    if (!rel || rel === '.') {
      return mediaRoot === '/' || mediaRoot === '' ? '/' : mediaRoot
    }
    if (rel.startsWith('..')) {
      // Should not happen when walking under startLocal
      return mediaRoot === '/' || mediaRoot === '' ? `/${basename(absoluteLocal)}` : `${mediaRoot}/${basename(absoluteLocal)}`
    }
    if (mediaRoot === '/' || mediaRoot === '') return `/${rel}`
    const rootNorm = mediaRoot.endsWith('/') ? mediaRoot.slice(0, -1) : mediaRoot
    return `${rootNorm}/${rel}`
  }

  async function walk(
    dir: string,
    mediaRoot: string,
    startLocal: string,
    isRoot: boolean,
    visited: Set<string>,
  ): Promise<void> {
    let real: string
    try {
      real = await fsp.realpath(dir)
    } catch (err) {
      const msg = `${dir}: ${errMessage(err)}`
      if (isRoot) {
        throw new Error(
          `Cannot read local media folder "${dir}". ${errMessage(err)}. ` +
            'Check LOCAL_MEDIA_ROOT and MEDIA_ROOT / MEDIA_ROOTS.',
        )
      }
      errors.push(msg)
      console.warn('Local list failed:', msg)
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (err) {
      const msg = `${dir}: ${errMessage(err)}`
      if (isRoot) {
        throw new Error(
          `Cannot list local media folder "${dir}". ${errMessage(err)}. ` +
            'Check LOCAL_MEDIA_ROOT permissions and MEDIA_ROOT / MEDIA_ROOTS.',
        )
      }
      errors.push(msg)
      console.warn('Local list failed:', msg)
      return
    }

    dirsScanned += 1
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const libPath = toLibraryPath(mediaRoot, startLocal, full)
      const pathLower = libPath.toLowerCase()
      if (ignore.some((frag) => pathLower.includes(frag))) continue

      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const st = await fsp.stat(full)
          isDir = st.isDirectory()
          isFile = st.isFile()
        } catch (err) {
          errors.push(`${full}: ${errMessage(err)}`)
          continue
        }
      }

      if (isDir) {
        await walk(full, mediaRoot, startLocal, false, visited)
        continue
      }

      if (isFile && VIDEO_EXT.has(extOf(entry.name))) {
        let size = 0
        let lastmod: string | undefined
        try {
          const st = await fsp.stat(full)
          size = st.size
          lastmod = st.mtime.toISOString()
        } catch {
          /* ignore size errors */
        }
        videos.push({
          path: libPath.replace(/\\/g, '/'),
          filename: entry.name,
          size,
          lastmod,
        })
      }
    }
  }

  for (const r of roots) {
    const startRoot = r === '' ? '/' : r
    const startLocal = localStartForRoot(startRoot)
    try {
      if (!existsSync(startLocal)) {
        const msg =
          `Local folder missing for MEDIA_ROOT "${startRoot}": ${startLocal} ` +
          `(under LOCAL_MEDIA_ROOT ${localRoot})`
        if (roots.length === 1) {
          throw new Error(
            `${msg}. Check LOCAL_MEDIA_ROOT and MEDIA_ROOT / MEDIA_ROOTS.`,
          )
        }
        errors.push(msg)
        continue
      }
      await walk(startLocal, startRoot, startLocal, true, new Set())
    } catch (err) {
      if (roots.length === 1) throw err
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  return { videos, mediaRoot: roots.join(', '), dirsScanned, errors }
}

export async function probeLocalMedia(): Promise<{
  ok: boolean
  localMediaRoot: string | null
  resolvedPath: string | null
  topEntries: Array<{ type: string; name: string }>
  mediaRootFolders: Array<{ root: string; path: string; exists: boolean }>
  error?: string
}> {
  const cfg = getConfig()
  const raw = cfg.localMediaRoot?.trim() || null
  if (!raw) {
    return {
      ok: false,
      localMediaRoot: null,
      resolvedPath: null,
      topEntries: [],
      mediaRootFolders: [],
      error: 'LOCAL_MEDIA_ROOT is not set',
    }
  }
  const resolvedPath = resolve(raw)
  const roots = cfg.mediaRoots.length ? cfg.mediaRoots : [cfg.mediaRoot]
  try {
    const st = await fsp.stat(resolvedPath)
    if (!st.isDirectory()) {
      return {
        ok: false,
        localMediaRoot: raw,
        resolvedPath,
        topEntries: [],
        mediaRootFolders: [],
        error: 'LOCAL_MEDIA_ROOT is not a directory',
      }
    }
    const entries = await fsp.readdir(resolvedPath, { withFileTypes: true })
    const topEntries = entries.slice(0, 20).map((e) => ({
      type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
      name: e.name,
    }))
    const mediaRootFolders = roots.map((root) => {
      if (root === '/' || root === '') {
        return { root, path: resolvedPath, exists: true }
      }
      const nested = resolve(join(resolvedPath, root.replace(/^\/+/, '')))
      return { root, path: nested, exists: existsSync(nested) }
    })
    return {
      ok: true,
      localMediaRoot: raw,
      resolvedPath,
      topEntries,
      mediaRootFolders,
    }
  } catch (err) {
    return {
      ok: false,
      localMediaRoot: raw,
      resolvedPath,
      topEntries: [],
      mediaRootFolders: roots.map((root) => ({
        root,
        path:
          root === '/' || root === ''
            ? resolvedPath
            : resolve(join(resolvedPath, root.replace(/^\/+/, ''))),
        exists: false,
      })),
      error: errMessage(err),
    }
  }
}

/**
 * Resolve a library path (often a WebDAV absolute path) to a real local file.
 *
 * Strategies:
 * 1. Path exists as-is (container mounts media at the same path)
 * 2. LOCAL_MEDIA_ROOT + path relative to MEDIA_ROOT
 * 3. LOCAL_MEDIA_ROOT + full library path (strip leading /)
 */
export function resolveLocalPath(libraryPath: string): string | null {
  if (!libraryPath || libraryPath.includes('..')) return null
  const normalized = libraryPath.replace(/\\/g, '/')

  if (existsSync(normalized)) return resolve(normalized)

  const c = getConfig()
  const localRoot = c.localMediaRoot?.trim()
  if (!localRoot) return null

  const root = resolve(localRoot)
  const mediaRoots = (c.mediaRoots?.length ? c.mediaRoots : [c.mediaRoot])
    .map((r) => (r === '/' ? '' : r))
    .filter(Boolean)
    // Longest prefix first so nested roots win
    .sort((a, b) => b.length - a.length)

  const relCandidates: string[] = []
  for (const mediaRoot of mediaRoots) {
    if (normalized === mediaRoot || normalized.startsWith(`${mediaRoot}/`)) {
      relCandidates.push(normalized.slice(mediaRoot.length).replace(/^\/+/, ''))
    }
  }
  relCandidates.push(normalized.replace(/^\/+/, ''))

  for (const rel of relCandidates) {
    if (!rel) continue
    const candidate = resolve(join(root, rel))
    if (isInsideRoot(candidate, root) && existsSync(candidate)) return candidate
  }

  return null
}

function isInsideRoot(path: string, root: string): boolean {
  const r = root.endsWith(sep) ? root : root + sep
  return path === root || path.startsWith(r)
}

export function localMediaEnabled(): boolean {
  const c = getConfig()
  if (c.localMediaRoot && existsSync(c.localMediaRoot)) return true
  return false
}

export function libraryPathFromLocal(localPath: string, originalLibraryPath: string): string {
  // Prefer keeping the same directory structure in the library key, only change filename/ext
  const origDir = originalLibraryPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
  const name = basename(localPath)
  if (!origDir || origDir === '') return `/${name}`
  return `${origDir}/${name}`
}

export function planConvertOutput(sourceLocal: string): {
  tempPath: string
  finalLocal: string
  finalExt: string
} {
  const dir = dirname(sourceLocal)
  const base = basename(sourceLocal, extname(sourceLocal))
  const finalLocal = join(dir, `${base}.mp4`)
  const tempPath =
    finalLocal.toLowerCase() === sourceLocal.toLowerCase()
      ? join(dir, `${base}.wtf-new.mp4`)
      : join(dir, `${base}.wtf-tmp.mp4`)
  return { tempPath, finalLocal, finalExt: '.mp4' }
}

export function quarantineOriginal(sourceLocal: string): string {
  const dir = dirname(sourceLocal)
  const trash = join(dir, '.wtf-originals')
  mkdirSync(trash, { recursive: true })
  const dest = join(trash, basename(sourceLocal))
  let target = dest
  let i = 1
  while (existsSync(target)) {
    const ext = extname(sourceLocal)
    const base = basename(sourceLocal, ext)
    target = join(trash, `${base}.${i}${ext}`)
    i += 1
  }
  renameSync(sourceLocal, target)
  return target
}

export function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* ignore */
  }
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** Atomically move temp into final (replace if needed). */
export function promoteTemp(tempPath: string, finalLocal: string, sourceLocal: string): void {
  if (finalLocal.toLowerCase() === sourceLocal.toLowerCase()) {
    // Replacing same path: move source aside first if it still exists
    if (existsSync(sourceLocal) && sourceLocal !== tempPath) {
      quarantineOriginal(sourceLocal)
    }
  } else if (existsSync(finalLocal) && finalLocal !== sourceLocal) {
    quarantineOriginal(finalLocal)
  }
  renameSync(tempPath, finalLocal)
}

export function copyProgressSidecar(_from: string, _to: string): void {
  // placeholder — progress rewritten in db
  void copyFileSync
}
