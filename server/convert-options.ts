import { getConfig } from './config.ts'
import { getScanMeta, setScanMeta } from './db.ts'

export type ConvertQueueMode = 'auto' | 'remux' | 'transcode'

export type ConvertQueueOptions = {
  mode: ConvertQueueMode
  replaceOriginal: boolean
  deleteOriginal: boolean
}

const META_KEY = 'convert_queue_options'

const MODES = new Set<ConvertQueueMode>(['auto', 'remux', 'transcode'])

export function defaultConvertQueueOptions(): ConvertQueueOptions {
  return {
    mode: 'auto',
    replaceOriginal: true,
    deleteOriginal: getConfig().convertDeleteOriginalDefault,
  }
}

export function normalizeConvertQueueOptions(
  input: Partial<ConvertQueueOptions> | null | undefined,
  fallback: ConvertQueueOptions = defaultConvertQueueOptions(),
): ConvertQueueOptions {
  const mode =
    typeof input?.mode === 'string' && MODES.has(input.mode as ConvertQueueMode)
      ? (input.mode as ConvertQueueMode)
      : fallback.mode
  const replaceOriginal =
    typeof input?.replaceOriginal === 'boolean' ? input.replaceOriginal : fallback.replaceOriginal
  // Delete only makes sense when we replace the library file with the convert output.
  const deleteOriginal = replaceOriginal
    ? typeof input?.deleteOriginal === 'boolean'
      ? input.deleteOriginal
      : fallback.deleteOriginal
    : false
  return { mode, replaceOriginal, deleteOriginal }
}

export function getConvertQueueOptions(): ConvertQueueOptions {
  const defaults = defaultConvertQueueOptions()
  const raw = getScanMeta(META_KEY)
  if (!raw) return defaults
  try {
    const parsed = JSON.parse(raw) as Partial<ConvertQueueOptions>
    return normalizeConvertQueueOptions(parsed, defaults)
  } catch {
    return defaults
  }
}

export function setConvertQueueOptions(
  input: Partial<ConvertQueueOptions> | null | undefined,
): ConvertQueueOptions {
  const next = normalizeConvertQueueOptions(input, getConvertQueueOptions())
  setScanMeta(META_KEY, JSON.stringify(next))
  return next
}
