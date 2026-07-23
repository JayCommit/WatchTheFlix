# WatchTheFlix

Self-hosted media browser/streamer. React 19 + Vite frontend (`src/`) and a Hono API (`server/`) in one repo. Metadata/users live in embedded SQLite (`data/library.db`); media is read over SFTPGo WebDAV and enriched via TMDB; playback uses bundled FFmpeg (direct / remux / transcode).

Standard commands and env vars are documented in `README.md`, `.env.example`, and `package.json` scripts (`dev`, `dev:server`, `dev:client`, `build`, `start`, `lint`). Refer to those rather than duplicating.

## Cursor Cloud specific instructions

- Requires Node.js 22+. SQLite uses the built-in `node:sqlite`, which prints `ExperimentalWarning: SQLite is an experimental feature` on startup — this is harmless, not an error.
- A `.env` is required to run the server. Copy `.env.example` to `.env` (it is gitignored). The dev `.env` from setup uses the placeholder SFTPGo/TMDB values from `.env.example`, so the app boots and **account creation / login / UI all work**, but **library scan, TMDB metadata, and playback will not** until real `SFTPGO_WEBDAV_URL` / `SFTPGO_USER` / `SFTPGO_PASSWORD` / `TMDB_API_KEY` are provided. The server does not crash when these are placeholders — it only logs a warning.
- Dev is `npm run dev` (runs API on `:8787` and Vite on `:5173` concurrently). Open the app at **http://localhost:5173** (Vite proxies `/api` → `:8787`); do not use `:8787` in dev.
- The first account created (via the setup screen or `POST /api/auth/register`) automatically becomes the admin. Later signups are normal users unless `ALLOW_PUBLIC_REGISTRATION=true`.
- The API process holds the SQLite connection open for the whole run. To reset users/library, stop the dev server first, then delete `data/library.db*` (deleting the file while the server runs does not clear state because the open handle + WAL keep it alive).
- `dist/` (from `npm run build`) is served by the API as static files when present. For pure dev via Vite, remove `dist/` so route handling isn't ambiguous.
- `npm run lint` (oxlint) currently emits a few pre-existing `no-useless-escape` warnings in `server/parse.ts` and `server/tmdb.ts`; these are not failures.
