import { useCallback, useRef, useState, type RefObject } from 'react'

type UsePlayerChromeArgs = {
  videoRef: RefObject<HTMLVideoElement | null>
  stageRef: RefObject<HTMLDivElement | null>
}

export function usePlayerChrome({ videoRef, stageRef }: UsePlayerChromeArgs) {
  const hideTimer = useRef<number | null>(null)
  const [showChrome, setShowChrome] = useState(true)

  const bumpChrome = useCallback(() => {
    setShowChrome(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    const video = videoRef.current
    if (video && !video.paused) {
      hideTimer.current = window.setTimeout(() => setShowChrome(false), 2800)
    }
  }, [videoRef])

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen()
    bumpChrome()
  }, [stageRef, bumpChrome])

  return { showChrome, bumpChrome, toggleFullscreen }
}
