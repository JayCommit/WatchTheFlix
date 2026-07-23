import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, '..', '..', 'data')
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(join(dataDir, 'library.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS titles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('movie', 'tv')),
    tmdb_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    overview TEXT,
    year INTEGER,
    poster_path TEXT,
    backdrop_path TEXT,
    vote_average REAL,
    genres TEXT,
    UNIQUE(kind, tmdb_id)
  );

  CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    size INTEGER,
    title_id INTEGER NOT NULL,
    season INTEGER,
    episode INTEGER,
    episode_name TEXT,
    scanned_at TEXT NOT NULL,
    FOREIGN KEY(title_id) REFERENCES titles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS progress (
    path TEXT PRIMARY KEY,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playback_sessions (
    client_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    title_id INTEGER,
    title_name TEXT,
    season INTEGER,
    episode INTEGER,
    position REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    playback_mode TEXT,
    state TEXT NOT NULL DEFAULT 'playing',
    user_agent TEXT,
    ip TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT,
    path TEXT,
    title_id INTEGER,
    title_name TEXT,
    season INTEGER,
    episode INTEGER,
    position REAL,
    duration REAL,
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS convert_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    title_id INTEGER,
    title_name TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    mode TEXT NOT NULL DEFAULT 'auto',
    replace_original INTEGER NOT NULL DEFAULT 1,
    delete_original INTEGER NOT NULL DEFAULT 0,
    progress REAL NOT NULL DEFAULT 0,
    container TEXT,
    video_codec TEXT,
    audio_codec TEXT,
    output_path TEXT,
    quarantined_path TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
`)
