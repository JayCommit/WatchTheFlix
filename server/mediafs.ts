import { existsSync, mkdirSync, renameSync, unlinkSync, statSync, copyFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { getConfig } from './config.ts'

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
  const mediaRoot = c.mediaRoot === '/' ? '' : c.mediaRoot

  let rel = normalized
  if (mediaRoot && (normalized === mediaRoot || normalized.startsWith(`${mediaRoot}/`))) {
    rel = normalized.slice(mediaRoot.length)
  }
  rel = rel.replace(/^\/+/, '')

  const candidate = resolve(join(root, rel))
  if (isInsideRoot(candidate, root) && existsSync(candidate)) return candidate

  const alt = resolve(join(root, normalized.replace(/^\/+/, '')))
  if (isInsideRoot(alt, root) && existsSync(alt)) return alt

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
