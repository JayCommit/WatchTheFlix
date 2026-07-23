type Mode = 'auto' | 'remux' | 'transcode'

type Props = {
  mode: Mode
  replaceOriginal: boolean
  deleteOriginal: boolean
  onModeChange: (mode: Mode) => void
  onReplaceOriginalChange: (value: boolean) => void
  onDeleteOriginalChange: (value: boolean) => void
}

export function ConvertOptions({
  mode,
  replaceOriginal,
  deleteOriginal,
  onModeChange,
  onReplaceOriginalChange,
  onDeleteOriginalChange,
}: Props) {
  return (
    <section className="admin-card">
      <div className="section-head">
        <h2>Queue options</h2>
      </div>
      <div className="admin-convert-opts">
        <label className="admin-convert-field">
          Mode
          <select value={mode} onChange={(e) => onModeChange(e.target.value as Mode)}>
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
      </div>
      <p className="muted">
        Flow: convert to temp → ffprobe verify → swap into place → optional purge of quarantined
        original. Never deletes without a successful verify.
      </p>
    </section>
  )
}
