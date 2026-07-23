export type ScanSource = 'local' | 'webdav'

export type ScanProgress = {
  phase: 'listing' | 'matching' | 'episodes' | 'done' | 'error'
  source: ScanSource
  filesFound: number
  processed: number
  dirsScanned: number
  matched: number
  unmatched: number
  errors: string[]
  message: string
  mediaRoot?: string
  startedAt: string
  finishedAt?: string
}

export type ScanResult = {
  filesFound: number
  matched: number
  unmatched: number
  titles: number
  files: number
  dirsScanned?: number
  mediaRoot?: string
  errors?: string[]
  preservedOverrides?: number
  tvShows?: number
  source?: ScanSource
  warning?: string
}

export type ScanStatusResponse = {
  running: boolean
  status: ScanProgress | null
  lastResult: ScanResult | null
}
