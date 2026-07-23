import { migrateUsers } from '../users.ts'
import { db } from './connection.ts'

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((r) => r.name === column)
}

export function migrate(): void {
  if (!columnExists('titles', 'hidden')) {
    db.exec(`ALTER TABLE titles ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists('titles', 'manual_override')) {
    db.exec(`ALTER TABLE titles ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists('media_files', 'container')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN container TEXT`)
  }
  if (!columnExists('media_files', 'video_codec')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN video_codec TEXT`)
  }
  if (!columnExists('media_files', 'audio_codec')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN audio_codec TEXT`)
  }
  if (!columnExists('media_files', 'playback_mode')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN playback_mode TEXT`)
  }
  if (!columnExists('media_files', 'can_direct')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN can_direct INTEGER`)
  }
  if (!columnExists('media_files', 'probe_error')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN probe_error TEXT`)
  }
  if (!columnExists('media_files', 'probed_at')) {
    db.exec(`ALTER TABLE media_files ADD COLUMN probed_at TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_progress (
      profile_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, path),
      FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      profile_id INTEGER NOT NULL,
      title_id INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (profile_id, title_id),
      FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY(title_id) REFERENCES titles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS preferred_files (
      title_id INTEGER NOT NULL,
      season INTEGER,
      episode INTEGER,
      path TEXT NOT NULL,
      PRIMARY KEY (title_id, season, episode)
    );
  `)

  const profileCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM profiles`).get() as { c: number }
  ).c
  if (profileCount === 0) {
    db.prepare(`INSERT INTO profiles (name, created_at) VALUES (?, ?)`).run(
      'Default',
      new Date().toISOString(),
    )
    // Migrate legacy progress into default profile
    db.exec(`
      INSERT OR IGNORE INTO profile_progress (profile_id, path, position, duration, updated_at)
      SELECT 1, path, position, duration, updated_at FROM progress
    `)
  }

  migrateUsers()
}

migrate()
