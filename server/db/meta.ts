import { db } from './connection.ts'

export function setScanMeta(key: string, value: string): void {
  db.prepare(`
    INSERT INTO scan_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function getScanMeta(key: string): string | null {
  const row = db.prepare(`SELECT value FROM scan_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}
