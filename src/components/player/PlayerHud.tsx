type HudKind = 'seek-forward' | 'seek-back' | 'volume' | 'rate' | 'play' | 'pause' | null

type PlayerHudProps = {
  kind: HudKind
  value?: string
  flashKey: number
}

export function PlayerHud({ kind, value, flashKey }: PlayerHudProps) {
  if (!kind) return null

  return (
    <div key={flashKey} className={`player-hud player-hud-${kind}`} aria-live="polite">
      <div className="player-hud-pill">
        {kind === 'seek-forward' ? (
          <span>+{value || '10'}s</span>
        ) : kind === 'seek-back' ? (
          <span>−{value || '10'}s</span>
        ) : kind === 'volume' ? (
          <span>{value || '0'}%</span>
        ) : kind === 'rate' ? (
          <span>{value || '1'}×</span>
        ) : kind === 'play' ? (
          <span className="player-hud-glyph">▶</span>
        ) : (
          <span className="player-hud-glyph">❚❚</span>
        )}
      </div>
    </div>
  )
}

export type { HudKind }
