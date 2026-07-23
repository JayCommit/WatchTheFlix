# WatchTheFlix

Lightweight cinematic UI for your seedbox. Scans media from a **local disk mount** (when `LOCAL_MEDIA_ROOT` is set) or **SFTPGo WebDAV**, enriches titles with **TMDB**, and streams with direct play / remux / transcode. Admin can permanently convert incompatible files on a local disk mount.

## Features

- Per-user accounts (first user = admin; Manage → Users for invites/roles)
- Local or WebDAV scan of movies / TV (filename parsing for `Movie.Name.2023` and `Show.S01E02`)
- TMDB posters, backdrops, overviews
- Direct / remux / live-transcode streaming
- Admin convert queue: codec probe, FFmpeg jobs, verified replace, optional delete of originals
- Continue watching / resume positions
- Single-process deploy (`npm run build` + `npm start`)

## Requirements

- Node.js 22+ (SQLite via built-in `node:sqlite` — no native compile step)
- Local media mount (`LOCAL_MEDIA_ROOT`) and/or SFTPGo with WebDAV enabled
- [TMDB API key](https://www.themoviedb.org/settings/api)

## Security

- Copy `.env.example` → `.env` and fill real values locally. **Never commit `.env`.**
- `.gitignore` blocks env files, keys/certs, SQLite under `data/`, and convert temp/originals.
- Set a strong `SESSION_SECRET` before any shared/public deploy.
- **Accounts:** first signup becomes **admin**; later accounts are **users** unless an admin promotes them. Passwords use scrypt; sessions are HMAC-signed and expire.
- Admin APIs (scan, convert, rematch, user management) require the `admin` role.
- Prefer HTTPS for SFTPGo WebDAV so credentials and streams stay encrypted.

## Setup

1. Copy env file and fill in values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| `SFTPGO_WEBDAV_URL` | WebDAV base URL, e.g. `https://box.example.com/dav` |
| `SFTPGO_USER` / `SFTPGO_PASSWORD` | SFTPGo credentials |
| `MEDIA_ROOT` | Optional subfolder to scan (`/` = whole account) |
| `TMDB_API_KEY` | TMDB v3 API key |
| `SESSION_SECRET` | Long random string for signed session cookies |
| `ALLOW_PUBLIC_REGISTRATION` | Allow self-signup as `user` after first admin exists |
| `HOST` | Bind address (default `0.0.0.0`) |
| `PORT` | Server port (default `8787`) |
| `LOCAL_MEDIA_ROOT` | Local mount for convert, disk streaming, and library scan when the path exists (e.g. `/media`) |
| `MEDIA_ROOTS` | Optional comma-separated library roots (Movies/TV/Anime) |
| `SCAN_INTERVAL_MINUTES` | Auto-scan interval (`0` = manual only) |
| `SCAN_IGNORE` | Comma-separated path fragments to skip |
| `FFMPEG_HW` | `auto` / `software` / `nvenc` / `vaapi` / `qsv` |
| `CONVERT_CONCURRENCY` | Parallel convert jobs (default `1`) |
| `CONVERT_DELETE_ORIGINAL` | Default for optional delete after verified replace (`false`) |

2. Install and run in development (API on `:8787`, Vite on `:5173` with proxy):

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

3. Production:

```bash
npm run build
npm start
```

Open [http://localhost:8787](http://localhost:8787).

## Library scan

- If `LOCAL_MEDIA_ROOT` points to an existing directory, **scan uses the local filesystem only** (no WebDAV listing). Paths stored in the DB stay WebDAV-style under `MEDIA_ROOT` / `MEDIA_ROOTS` so playback and existing rows keep working.
- WebDAV remains optional for remote streaming when a file cannot be resolved on disk.
- Without a valid `LOCAL_MEDIA_ROOT`, scan falls back to listing over SFTPGo WebDAV.

## SFTPGo tips

- Enable WebDAV for the user/account that holds your media (needed when not scanning/playing from local disk).
- Prefer HTTPS so credentials and streams are encrypted.
- `MEDIA_ROOT` should match the folder layout inside WebDAV (e.g. `/media` or `/downloads`).
- Large libraries: first scan can take a while (TMDB lookups per unique title).

## Playback notes

WatchTheFlix auto-picks a playback mode after probing the file with bundled FFmpeg:

| Mode | When | What happens |
|------|------|----------------|
| **Direct** | MP4/WebM with browser-safe codecs | Byte-range stream from SFTPGo |
| **Remux** | MKV/AVI with H.264 (any audio) | On-the-fly remux to fragmented MP4 (`-c:v copy`, audio → AAC if needed) |
| **Transcode** | HEVC / MPEG-4 / other video | Live H.264 + AAC (uses CPU; seeking restarts the encoder) |

- Bundled via `ffmpeg-static` / `ffprobe-static` (no system FFmpeg install required). Prefer system FFmpeg on the seedbox via `FFMPEG_PATH` / `FFPROBE_PATH`.
- Remux keeps video quality; transcode is slower on 4K sources.
- The player shows the active mode (Direct / Remuxing / Transcoding) in the top bar.

### Permanent convert (admin)

On Ubuntu containers with media mounted locally:

1. Set `LOCAL_MEDIA_ROOT` to the mount (e.g. `/media`) so library paths under `MEDIA_ROOT` resolve on disk.
2. Open **Admin → Convert**.
3. **Probe codecs** to classify Direct / Remux / Transcode.
4. Queue jobs with **verified replace** (default): convert → ffprobe verify → quarantine original under `.wtf-originals/` → promote MP4 → update DB path.
5. Optionally enable **Delete original after success** (off by default; not a forced wipe). Without it, originals stay in `.wtf-originals/`.

Sibling `.browser.mp4` copies are created when replace is turned off.

## Docker

```bash
# Set HOST_MEDIA_PATH to your host media mount
export HOST_MEDIA_PATH=/path/to/media
docker compose up -d --build
```

See `deploy/nginx.example.conf` for a reverse-proxy snippet (Range / long timeouts).

## Usage

1. Open the app and **create the first admin account**
2. Admin: **Scan library** (or set `SCAN_INTERVAL_MINUTES`)
3. Browse, play, pick audio/subs; use watchlist / profiles
4. Admin → **Users** to add accounts or promote admins; **Convert** for permanent browser copies

## Project layout

```
server/     Hono API, WebDAV, TMDB, SQLite cache
src/        React cinematic UI
data/       Created at runtime (library.db)
```
