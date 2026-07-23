import { useEffect, useRef, useState } from 'react'
import type { StreamInfo } from '../../hooks/usePlayerMedia'
import { PLAYBACK_RATES, type PlaybackRate } from '../../hooks/usePlayerPrefs'
import { IconCaptions, IconSettings } from './PlayerIcons'

type PlayerSettingsMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  rate: PlaybackRate
  onRateChange: (rate: PlaybackRate) => void
  streamInfo: StreamInfo | null
  audioIndex: number
  subtitleKey: string
  onAudioChange: (next: number) => void
  onSubtitleChange: (key: string) => void
  onInteract: () => void
}

type Panel = 'root' | 'speed' | 'audio' | 'subs'

export function PlayerSettingsMenu({
  open,
  onOpenChange,
  rate,
  onRateChange,
  streamInfo,
  audioIndex,
  subtitleKey,
  onAudioChange,
  onSubtitleChange,
  onInteract,
}: PlayerSettingsMenuProps) {
  const [panel, setPanel] = useState<Panel>('root')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) setPanel('root')
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onOpenChange])

  const audioLabel =
    streamInfo?.audioTracks.find((t) => t.index === audioIndex)?.language ||
    streamInfo?.audioTracks.find((t) => t.index === audioIndex)?.title ||
    (streamInfo && streamInfo.audioTracks.length ? `Track ${audioIndex + 1}` : 'Default')

  const subLabel =
    subtitleKey === 'off'
      ? 'Off'
      : streamInfo?.subtitleTracks.find((t) => `${t.kind}:${t.index}:${t.path ?? ''}` === subtitleKey)
          ?.language ||
        streamInfo?.subtitleTracks.find((t) => `${t.kind}:${t.index}:${t.path ?? ''}` === subtitleKey)
          ?.title ||
        'On'

  return (
    <div className="player-settings" ref={rootRef}>
      <button
        className={`ctrl-btn ctrl-icon ${open ? 'active' : ''}`}
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => {
          onOpenChange(!open)
          onInteract()
        }}
      >
        <IconSettings size={20} />
      </button>
      {open ? (
        <div className="player-settings-menu" role="menu">
          {panel === 'root' ? (
            <>
              <button
                type="button"
                className="player-settings-row"
                role="menuitem"
                onClick={() => setPanel('speed')}
              >
                <span>Speed</span>
                <span className="player-settings-value">{rate === 1 ? 'Normal' : `${rate}×`}</span>
              </button>
              {streamInfo && streamInfo.audioTracks.length > 1 ? (
                <button
                  type="button"
                  className="player-settings-row"
                  role="menuitem"
                  onClick={() => setPanel('audio')}
                >
                  <span>Audio</span>
                  <span className="player-settings-value">{audioLabel}</span>
                </button>
              ) : null}
              {streamInfo && streamInfo.subtitleTracks.length > 0 ? (
                <button
                  type="button"
                  className="player-settings-row"
                  role="menuitem"
                  onClick={() => setPanel('subs')}
                >
                  <span className="player-settings-row-label">
                    <IconCaptions size={16} /> Subtitles
                  </span>
                  <span className="player-settings-value">{subLabel}</span>
                </button>
              ) : null}
            </>
          ) : null}

          {panel === 'speed' ? (
            <>
              <button type="button" className="player-settings-back" onClick={() => setPanel('root')}>
                ← Speed
              </button>
              {PLAYBACK_RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`player-settings-option ${rate === r ? 'active' : ''}`}
                  role="menuitemradio"
                  aria-checked={rate === r}
                  onClick={() => {
                    onRateChange(r)
                    onOpenChange(false)
                    onInteract()
                  }}
                >
                  {r === 1 ? 'Normal' : `${r}×`}
                </button>
              ))}
            </>
          ) : null}

          {panel === 'audio' && streamInfo ? (
            <>
              <button type="button" className="player-settings-back" onClick={() => setPanel('root')}>
                ← Audio
              </button>
              {streamInfo.audioTracks.map((t) => (
                <button
                  key={t.index}
                  type="button"
                  className={`player-settings-option ${audioIndex === t.index ? 'active' : ''}`}
                  role="menuitemradio"
                  aria-checked={audioIndex === t.index}
                  onClick={() => {
                    onAudioChange(t.index)
                    onOpenChange(false)
                    onInteract()
                  }}
                >
                  {t.language || t.title || `Audio ${t.index + 1}`}
                  {t.codec ? ` · ${t.codec}` : ''}
                </button>
              ))}
            </>
          ) : null}

          {panel === 'subs' && streamInfo ? (
            <>
              <button type="button" className="player-settings-back" onClick={() => setPanel('root')}>
                ← Subtitles
              </button>
              <button
                type="button"
                className={`player-settings-option ${subtitleKey === 'off' ? 'active' : ''}`}
                role="menuitemradio"
                aria-checked={subtitleKey === 'off'}
                onClick={() => {
                  onSubtitleChange('off')
                  onOpenChange(false)
                  onInteract()
                }}
              >
                Off
              </button>
              {streamInfo.subtitleTracks.map((t) => {
                const key = `${t.kind}:${t.index}:${t.path ?? ''}`
                return (
                  <button
                    key={key}
                    type="button"
                    className={`player-settings-option ${subtitleKey === key ? 'active' : ''}`}
                    role="menuitemradio"
                    aria-checked={subtitleKey === key}
                    onClick={() => {
                      onSubtitleChange(key)
                      onOpenChange(false)
                      onInteract()
                    }}
                  >
                    {t.kind === 'external' ? 'File · ' : ''}
                    {t.language || t.title || `Sub ${t.index + 1}`}
                  </button>
                )
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
