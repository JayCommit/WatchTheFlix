# WatchTheFlix

Lightweight cinematic UI for your seedbox. Scans media over **SFTPGo WebDAV**, enriches titles with **TMDB**, and streams with direct play / remux / transcode. Admin can permanently convert incompatible files on a local disk mount.

## Features

- Password-gated library UI
- WebDAV scan of movies / TV (filename parsing for `Movie.Name.2023` and `Show.S01E02`)
- TMDB posters, backdrops, overviews
- Direct / remux / live-transcode streaming
- Admin convert queue: codec probe, FFmpeg jobs, verified replace, optional delete of originals
- Continue watching / resume positions
- Single-process deploy (`npm run build` + `npm start`)

## Requirements

- Node.js 22+ (SQLite via built-in `node:sqlite` — no native compile step)
- SFTPGo with WebDAV enabled
- [TMDB API key](https://www.themoviedb.org/settings/api)

## Security

- Copy `.env.example` → `.env` and fill real values locally. **Never commit `.env`.**
- `.gitignore` blocks env files, keys/certs, SQLite under `data/`, and convert temp/originals.
- Change `APP_PASSWORD` and `SESSION_SECRET` before any shared/public deploy.
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
| `APP_PASSWORD` | Password to open the UI |
| `SESSION_SECRET` | Long random string for session cookies |
| `PORT` | Server port (default `8787`) |
| `LOCAL_MEDIA_ROOT` | Local mount for convert + disk streaming (e.g. `/media`) |
| `MEDIA_ROOTS` | Optional comma-separated WebDAV roots (Movies/TV/Anime) |
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

## SFTPGo tips

- Enable WebDAV for the user/account that holds your media.
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

1. Log in with `APP_PASSWORD`
2. Click **Scan library** (or set `SCAN_INTERVAL_MINUTES`)
3. Browse rows, open a title, hit Play — pick audio/subs in the player
4. Use profiles + watchlist on the home screen; Admin Convert for permanent browser copies

## Project layout

```
server/     Hono API, WebDAV, TMDB, SQLite cache
src/        React cinematic UI
data/       Created at runtime (library.db)
```
