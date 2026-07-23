import type { ScanStatusResponse } from '../../api'
import type { Diagnostics } from './types'

export function ToolsSection(props: {
  scanning: boolean
  scanMsg: string
  scanStatus: ScanStatusResponse | null
  diag: Diagnostics | null
  diagError: string
  onScan: () => void
  onRefreshDiag: () => void
}) {
  const localScan =
    props.diag?.scanSource === 'local' || Boolean(props.diag?.config.localMediaEnabled)
  const progress = props.scanStatus?.status
  const scanErrors = [
    ...(progress?.errors ?? []),
    ...(props.scanStatus?.lastResult?.errors ?? []),
  ]
    .filter(Boolean)
    .slice(0, 20)
  // Dedupe while preserving order
  const uniqueErrors = [...new Set(scanErrors)].slice(0, 20)

  return (
    <div className="admin-scan">
      <section className="admin-panel">
        <div className="section-head">
          <h2>Library scan</h2>
        </div>
        <p className="muted">
          {localScan
            ? 'Scan local disk under LOCAL_MEDIA_ROOT, rematch filenames on TMDB, and rebuild the local index. Titles with a manual override keep their match across scans.'
            : 'Scan WebDAV under MEDIA_ROOT, rematch filenames on TMDB, and rebuild the local index. Titles with a manual override keep their match across scans.'}
        </p>
        <div className="admin-inline-form" style={{ marginTop: '1rem' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={props.scanning}
            onClick={props.onScan}
          >
            {props.scanning ? 'Scanning…' : 'Scan library'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={props.onRefreshDiag}>
            Refresh diagnostics
          </button>
        </div>
        {props.scanning ? (
          (() => {
            const listing = !progress || progress.phase === 'listing' || !progress.filesFound
            const pct =
              !listing && progress.filesFound > 0
                ? Math.min(100, Math.round((progress.processed / progress.filesFound) * 100))
                : 0
            return (
              <div style={{ marginTop: '1rem' }}>
                <div
                  className={`admin-progress-bar${listing ? ' indeterminate' : ''}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={listing ? undefined : pct}
                  aria-label="Library scan progress"
                >
                  <i style={{ width: `${listing ? 100 : pct}%` }} />
                </div>
                {progress ? (
                  <ul className="diag-list" style={{ marginTop: '0.75rem' }}>
                    <li>
                      Source: <code>{progress.source}</code> · phase:{' '}
                      <code>{progress.phase}</code>
                      {!listing ? ` · ${pct}%` : ''}
                    </li>
                    <li>
                      Dirs scanned: {progress.dirsScanned} · files found: {progress.filesFound} ·
                      processed: {progress.processed}
                    </li>
                    <li>
                      Matched: {progress.matched} · unmatched: {progress.unmatched}
                    </li>
                    {progress.message ? <li className="muted">{progress.message}</li> : null}
                  </ul>
                ) : null}
              </div>
            )
          })()
        ) : null}
        {props.scanMsg ? (
          <p
            className={
              /fail|missing|tmdb|0 video|error/i.test(props.scanMsg) ? 'error-text' : 'ok-text'
            }
            style={{ marginTop: '1rem' }}
          >
            {props.scanMsg}
          </p>
        ) : null}
        {progress?.phase === 'error' && progress.message && progress.message !== props.scanMsg ? (
          <p className="error-text" style={{ marginTop: '0.5rem' }}>
            {progress.message}
          </p>
        ) : null}
        {uniqueErrors.length > 0 ? (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="muted" style={{ marginBottom: '0.35rem' }}>
              Errors ({uniqueErrors.length}
              {scanErrors.length > uniqueErrors.length ? '+' : ''}):
            </p>
            <ul className="diag-list">
              {uniqueErrors.map((e) => (
                <li key={e} className="error-text" style={{ fontSize: '0.85rem' }}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="section-head">
          <h2>Diagnostics</h2>
        </div>
        {props.diagError ? <p className="error-text">{props.diagError}</p> : null}
        {props.diag ? (
          <ul className="diag-list">
            <li>
              Scan source:{' '}
              <code>{props.diag.scanSource ?? (localScan ? 'local' : 'webdav')}</code>
            </li>
            <li>
              LOCAL_MEDIA_ROOT:{' '}
              <code>{props.diag.config.localMediaRoot || '(not set)'}</code>
            </li>
            <li>
              Local probe:{' '}
              {props.diag.local?.ok ? (
                <span className="ok-text">OK</span>
              ) : props.diag.config.localMediaRoot ? (
                <span className="error-text">Failed</span>
              ) : (
                <span className="muted">n/a</span>
              )}
              {props.diag.local?.resolvedPath ? (
                <>
                  {' '}
                  (<code>{props.diag.local.resolvedPath}</code>)
                </>
              ) : null}
            </li>
            {props.diag.local?.error ? (
              <li className="error-text">{props.diag.local.error}</li>
            ) : null}
            {props.diag.local?.ok && props.diag.local.topEntries.length > 0 ? (
              <li>
                Local top-level:{' '}
                {props.diag.local.topEntries.map((e) => e.name).join(', ')}
              </li>
            ) : null}
            {props.diag.local?.mediaRootFolders?.length ? (
              <li>
                Media-root folders:{' '}
                {props.diag.local.mediaRootFolders
                  .map((f) => `${f.root}${f.exists ? '' : ' (missing)'}`)
                  .join(', ')}
              </li>
            ) : null}
            <li>
              MEDIA_ROOT: <code>{props.diag.config.mediaRoot}</code>
            </li>
            {props.diag.config.mediaRoots?.length ? (
              <li>
                MEDIA_ROOTS: <code>{props.diag.config.mediaRoots.join(', ')}</code>
              </li>
            ) : null}
            <li>
              Scan interval:{' '}
              <code>
                {props.diag.config.scanIntervalMinutes
                  ? `${props.diag.config.scanIntervalMinutes}m`
                  : 'manual only'}
              </code>
            </li>
            <li>
              TMDB key:{' '}
              {props.diag.config.tmdbKeySet ? (
                <span className="ok-text">set</span>
              ) : (
                <span className="error-text">missing — scans will fail until you set TMDB_API_KEY</span>
              )}
            </li>
            <li>
              FFmpeg:{' '}
              {props.diag.playback?.ffmpegAvailable ? (
                <span className="ok-text">available</span>
              ) : (
                <span className="error-text">missing</span>
              )}
            </li>
            {!localScan || props.diag.config.webdavUrlSet ? (
              <>
                <li>
                  WebDAV host: <code>{props.diag.config.webdavHost || '(missing)'}</code>
                  {localScan ? <span className="muted"> (playback fallback)</span> : null}
                </li>
                <li>
                  Credentials:{' '}
                  {props.diag.config.webdavUserSet && props.diag.config.webdavPasswordSet
                    ? 'set'
                    : 'missing'}
                </li>
                {!props.diag.webdav.skipped ? (
                  <>
                    <li>
                      WebDAV probe:{' '}
                      {props.diag.webdav.ok ? (
                        <span className="ok-text">OK</span>
                      ) : (
                        <span className="error-text">Failed</span>
                      )}
                    </li>
                    {props.diag.webdav.error ? (
                      <li className="error-text">{props.diag.webdav.error}</li>
                    ) : null}
                    {props.diag.webdav.ok && props.diag.webdav.mediaEntries.length > 0 ? (
                      <li>
                        Under MEDIA_ROOT:{' '}
                        {props.diag.webdav.mediaEntries.map((e) => e.name).join(', ')}
                      </li>
                    ) : null}
                  </>
                ) : (
                  <li className="muted">WebDAV probe skipped (local scan active)</li>
                )}
              </>
            ) : null}
          </ul>
        ) : (
          <p className="muted">Running diagnostics…</p>
        )}
      </section>

      <section className="admin-panel">
        <div className="section-head">
          <h2>Consolidate notes</h2>
        </div>
        <ul className="diag-list">
          <li>Prefer Rematch / Merge over deleting files — soft-hide keeps progress intact.</li>
          <li>Manual edits set an override so the next scan won’t steal the match.</li>
          <li>Bulk-hide unmatched junk from the Unmatched tab when filenames are noise.</li>
          <li>Now Playing uses per-tab client ids; each signed-in user has their own account.</li>
        </ul>
      </section>
    </div>
  )
}
