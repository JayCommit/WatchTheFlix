import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'wtf-player-prefs'

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

export type PlayerPrefs = {
  volume: number
  muted: boolean
  rate: PlaybackRate
  showRemaining: boolean
}

const DEFAULTS: PlayerPrefs = {
  volume: 1,
  muted: false,
  rate: 1,
  showRemaining: false,
}

function clampVolume(v: number) {
  return Math.min(1, Math.max(0, v))
}

function isRate(v: unknown): v is PlaybackRate {
  return typeof v === 'number' && (PLAYBACK_RATES as readonly number[]).includes(v)
}

function readPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>
    return {
      volume: typeof parsed.volume === 'number' ? clampVolume(parsed.volume) : DEFAULTS.volume,
      muted: Boolean(parsed.muted),
      rate: isRate(parsed.rate) ? parsed.rate : DEFAULTS.rate,
      showRemaining: Boolean(parsed.showRemaining),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function usePlayerPrefs() {
  const [prefs, setPrefs] = useState<PlayerPrefs>(() =>
    typeof window === 'undefined' ? DEFAULTS : readPrefs(),
  )

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      /* ignore quota / private mode */
    }
  }, [prefs])

  const setVolume = useCallback((volume: number) => {
    setPrefs((p) => {
      const v = clampVolume(volume)
      return { ...p, volume: v, muted: v === 0 ? true : p.muted }
    })
  }, [])

  const setMuted = useCallback((muted: boolean) => {
    setPrefs((p) => ({ ...p, muted }))
  }, [])

  const setRate = useCallback((rate: PlaybackRate) => {
    setPrefs((p) => ({ ...p, rate }))
  }, [])

  const cycleRate = useCallback((dir: 1 | -1): PlaybackRate => {
    const idx = PLAYBACK_RATES.indexOf(prefs.rate)
    const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, idx + dir))] ?? 1
    setPrefs((p) => ({ ...p, rate: next }))
    return next
  }, [prefs.rate])

  const toggleRemaining = useCallback(() => {
    setPrefs((p) => ({ ...p, showRemaining: !p.showRemaining }))
  }, [])

  return { prefs, setVolume, setMuted, setRate, cycleRate, toggleRemaining }
}
