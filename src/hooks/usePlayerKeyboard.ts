import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'

type UsePlayerKeyboardArgs = {
  videoRef: RefObject<HTMLVideoElement | null>
  togglePlay: () => void
  seekBy: (delta: number) => void
  toggleFullscreen: () => void
  bumpChrome: () => void
  nextFile: unknown
  goNext: () => void
  showHelp: boolean
  setShowHelp: Dispatch<SetStateAction<boolean>>
  navigate: (path: string) => void
  backPath: string
  saveProgress: (force?: boolean) => void | Promise<void>
}

export function usePlayerKeyboard({
  videoRef,
  togglePlay,
  seekBy,
  toggleFullscreen,
  bumpChrome,
  nextFile,
  goNext,
  showHelp,
  setShowHelp,
  navigate,
  backPath,
  saveProgress,
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
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekBy(10)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekBy(-10)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        video.volume = Math.min(1, video.volume + 0.05)
        bumpChrome()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        video.volume = Math.max(0, video.volume - 0.05)
        bumpChrome()
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault()
        video.muted = !video.muted
        bumpChrome()
      } else if (e.key.toLowerCase() === 'n' && nextFile) {
        e.preventDefault()
        goNext()
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
    toggleFullscreen,
    bumpChrome,
    nextFile,
    goNext,
    showHelp,
    setShowHelp,
    navigate,
    backPath,
    saveProgress,
  ])
}
