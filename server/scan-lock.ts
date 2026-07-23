/** Shared lock so manual + scheduled scans never overlap. */
let scanning = false

export function isScanRunning(): boolean {
  return scanning
}

export async function withScanLock<T>(fn: () => Promise<T>): Promise<T> {
  if (scanning) {
    throw new Error('A library scan is already running')
  }
  scanning = true
  try {
    return await fn()
  } finally {
    scanning = false
  }
}
