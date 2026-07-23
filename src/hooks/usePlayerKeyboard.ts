import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { PlaybackRate } from './usePlayerPrefs'

type UsePlayerKeyboardArgs = {
  videoRef: RefObject<HTMLVideoElement | null>
  togglePlay: () => void
  seekBy: (delta: number) => void
  seekTo: (absoluteSeconds: number) => void
  toggleFullscreen: () => void
  togglePip: () => void
  bumpChrome: () => void
  nextFile: unknown
  goNext: () => void
  showHelp: boolean
  setShowHelp: Dispatch<SetStateAction<boolean>>
  navigate: (path: string) => void
  backPath: string
  saveProgress: (force?: boolean) => void | Promise<void>
  duration: number
  cycleRate: (dir: 1 | -1) => PlaybackRate
  onVolumeHud: (pct: number) => void
  onSeekHud: (delta: number) => void
  onRateHud: (rate: PlaybackRate) => void
  cycleSubtitles: () => void
}

export function usePlayerKeyboard({
  videoRef,
  togglePlay,
  seekBy,
  seekTo,
  toggleFullscreen,
  togglePip,
  bumpChrome,
  nextFile,
  goNext,
  showHelp,
  setShowHelp,
  navigate,
  backPath,
  saveProgress,
  duration,
  cycleRate,
  onVolumeHud,
  onSeekHud,
  onRateHud,
  cycleSubtitles,
}: UsePlayerKeyboardArgs) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const video = videoRef.current
      if (!video) return

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault()
        togglePlay()
      } else if (e.key.toLowerCase() === 'j' || e.key === 'ArrowLeft') {
        e.preventDefault()
        seekBy(-10)
        onSeekHud(-10)
      } else if (e.key.toLowerCase() === 'l' || e.key === 'ArrowRight') {
        e.preventDefault()
        seekBy(10)
        onSeekHud(10)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        video.muted = false
        video.volume = Math.min(1, video.volume + 0.05)
        onVolumeHud(Math.round(video.volume * 100))
        bumpChrome()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        video.volume = Math.max(0, video.volume - 0.05)
        if (video.volume === 0) video.muted = true
        onVolumeHud(Math.round((video.muted ? 0 : video.volume) * 100))
        bumpChrome()
      } else if (e.key === '<' || (e.shiftKey && e.key === ',')) {
        e.preventDefault()
        const next = cycleRate(-1)
        video.playbackRate = next
        onRateHud(next)
        bumpChrome()
      } else if (e.key === '>' || (e.shiftKey && e.key === '.')) {
        e.preventDefault()
        const next = cycleRate(1)
        video.playbackRate = next
        onRateHud(next)
        bumpChrome()
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault()
        togglePip()
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        cycleSubtitles()
        bumpChrome()
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault()
        video.muted = !video.muted
        onVolumeHud(Math.round((video.muted ? 0 : video.volume) * 100))
        bumpChrome()
      } else if (e.key.toLowerCase() === 'n' && nextFile) {
        e.preventDefault()
        goNext()
      } else if (e.key >= '0' && e.key <= '9' && duration > 0) {
        e.preventDefault()
        seekTo(duration * (Number(e.key) / 10))
        bumpChrome()
      } else if (e.key === 'Home') {
        e.preventDefault()
        seekTo(0)
        bumpChrome()
      } else if (e.key === 'End' && duration > 0) {
        e.preventDefault()
        seekTo(Math.max(0, duration - 5))
        bumpChrome()
      } else if (e.key === 'Escape') {
        if (showHelp) {
          setShowHelp(false)
          return
        }
        if (document.fullscreenElement) {
          void document.exitFullscreen()
          return
        }
        void saveProgress(true)
        navigate(backPath)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    videoRef,
    togglePlay,
    seekBy,
    seekTo,
    toggleFullscreen,
    togglePip,
    bumpChrome,
    nextFile,
    goNext,
    showHelp,
    setShowHelp,
    navigate,
    backPath,
    saveProgress,
    duration,
    cycleRate,
    onVolumeHud,
    onSeekHud,
    onRateHud,
    cycleSubtitles,
  ])
}
