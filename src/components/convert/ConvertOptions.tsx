import { useState } from 'react'
import type { ConvertQueueMode } from '../../types'

type Props = {
  mode: ConvertQueueMode
  replaceOriginal: boolean
  deleteOriginal: boolean
  dirty: boolean
  saving: boolean
  saved: boolean
  onModeChange: (mode: ConvertQueueMode) => void
  onReplaceOriginalChange: (value: boolean) => void
  onDeleteOriginalChange: (value: boolean) => void
  onSave: () => void
  onReset: () => void
}

function modeSummary(mode: ConvertQueueMode): string {
  if (mode === 'auto') return 'Auto — remux H.264, transcode the rest'
  if (mode === 'remux') return 'Remux only'
  return 'Force transcode'
}

export function ConvertOptions({
  mode,
  replaceOriginal,
  deleteOriginal,
  dirty,
  saving,
  saved,
  onModeChange,
  onReplaceOriginalChange,
  onDeleteOriginalChange,
  onSave,
  onReset,
}: Props) {
  const [open, setOpen] = useState(false)
  const expanded = open || dirty

  return (
    <section className={`admin-card convert-options-card${expanded ? ' is-open' : ''}`}>
      <div className="section-head">
        <button
          className="convert-options-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="convert-options-toggle-main">
            <h2>Queue defaults</h2>
            {!expanded ? (
              <span className="muted convert-options-summary">
                {modeSummary(mode)}
                {replaceOriginal ? ' · replace original' : ' · keep beside original'}
                {replaceOriginal && deleteOriginal ? ' · delete after success' : ''}
              </span>
            ) : null}
          </span>
          <span className="muted convert-options-chevron">{expanded ? 'Hide' : 'Edit'}</span>
        </button>
        <div className="admin-convert-opts-actions">
          {dirty ? (
            <button className="btn btn-ghost btn-sm" type="button" disabled={saving} onClick={onReset}>
              Reset
            </button>
          ) : null}
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? 'Saving…' : saved && !dirty ? 'Saved' : 'Save defaults'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="admin-convert-opts">
          <label className="admin-convert-field">
            Mode
            <select value={mode} onChange={(e) => onModeChange(e.target.value as ConvertQueueMode)}>
              <option value="auto">Auto — remux H.264, transcode the rest</option>
              <option value="remux">Remux only (fail if re-encode needed)</option>
              <option value="transcode">Force transcode (re-encode everything)</option>
            </select>
          </label>
          <p className="muted convert-mode-hint">
            {mode === 'auto'
              ? 'Each file is classified on queue: H.264 → fast remux; HEVC / MPEG-4 / other → transcode.'
              : mode === 'remux'
                ? 'Stream-copy video only. Files that need a full re-encode will fail instead of transcoding.'
                : 'Re-encodes every queued file to H.264 + AAC — slower, use when you want a fresh encode.'}
          </p>
          <div className="admin-convert-opts-row">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={replaceOriginal}
                onChange={(e) => onReplaceOriginalChange(e.target.checked)}
              />
              <span>Verified replace — update library to the new MP4</span>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={deleteOriginal}
                onChange={(e) => onDeleteOriginalChange(e.target.checked)}
                disabled={!replaceOriginal}
              />
              <span>
                Delete original after success — otherwise keep in <code>.wtf-originals/</code>
              </span>
            </label>
          </div>
          <p className="muted convert-options-footnote">
            Saved defaults apply to this queue and the Convert button in the library drawer.
          </p>
        </div>
      ) : null}
    </section>
  )
}
