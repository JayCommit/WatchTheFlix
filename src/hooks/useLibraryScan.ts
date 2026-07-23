import { useState } from 'react'
import { api } from '../api'

type Options = {
  /** When false, onScan is a no-op. Defaults to true. */
  enabled?: boolean
  onComplete?: () => void | Promise<void>
}

export function useLibraryScan(options: Options = {}) {
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const enabled = options.enabled !== false

  async function onScan() {
    if (!enabled) return
    setScanning(true)
    setScanMsg('Starting library scan…')
    try {
      const result = await api.runScan((status) => {
        const p = status.status
        if (!p) return
        const src = p.source === 'local' ? 'Local disk' : 'WebDAV'
        if (p.phase === 'listing') {
          setScanMsg(`${src}: listing folders… (${p.dirsScanned} scanned)`)
        } else if (p.phase === 'matching') {
          setScanMsg(
            `${src}: matching ${p.processed}/${p.filesFound} · ${p.matched} matched`,
          )
        } else if (p.message) {
          setScanMsg(p.message)
        }
      })
      const errN = result.errors?.length ?? 0
      if (result.warning) {
        setScanMsg(result.warning + (errN ? ` (${errN} errors)` : ''))
      } else if (errN) {
        setScanMsg(
          `Found ${result.filesFound} files · ${result.titles} titles · ${errN} errors`,
        )
      } else {
        setScanMsg(
          `Found ${result.filesFound} files under ${result.mediaRoot ?? 'media root'} · ${result.titles} titles` +
            (result.source ? ` (${result.source})` : ''),
        )
      }
      await options.onComplete?.()
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  return { scanning, scanMsg, onScan }
}
