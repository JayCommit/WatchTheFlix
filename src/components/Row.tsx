import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
  action?: ReactNode
}

export function Row({ title, children, action }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanLeft(scrollLeft > 8)
    setCanRight(scrollLeft + clientWidth < scrollWidth - 8)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update, children])

  function scrollBy(dir: -1 | 1) {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.75), behavior: 'smooth' })
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        <div className="section-head-right">
          {action}
          <div className="row-nav">
            <button
              className="row-nav-btn"
              type="button"
              aria-label={`Scroll ${title} left`}
              disabled={!canLeft}
              onClick={() => scrollBy(-1)}
            >
              ‹
            </button>
            <button
              className="row-nav-btn"
              type="button"
              aria-label={`Scroll ${title} right`}
              disabled={!canRight}
              onClick={() => scrollBy(1)}
            >
              ›
            </button>
          </div>
        </div>
      </div>
      <div className="row-wrap">
        {canLeft ? <div className="row-fade row-fade-left" aria-hidden /> : null}
        {canRight ? <div className="row-fade row-fade-right" aria-hidden /> : null}
        <div className="row-scroller" ref={scrollerRef}>
          {children}
        </div>
      </div>
    </section>
  )
}
