import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

type UsePlayerChromeArgs = {
  videoRef: RefObject<HTMLVideoElement | null>
  stageRef: RefObject<HTMLDivElement | null>
}

export function usePlayerChrome({ videoRef, stageRef }: UsePlayerChromeArgs) {
  const hideTimer = useRef<number | null>(null)
  const [showChrome, setShowChrome] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

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
    else void stage.requestFullscreen().catch(() => undefined)
    bumpChrome()
  }, [stageRef, bumpChrome])

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.style.cursor = showChrome ? '' : 'none'
  }, [showChrome, stageRef])

  return { showChrome, bumpChrome, toggleFullscreen, isFullscreen, setShowChrome }
}
