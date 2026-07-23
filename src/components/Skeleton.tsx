export function HomeSkeleton() {
  return (
    <div className="app-shell page-enter" aria-busy="true" aria-label="Loading library">
      <div className="topbar">
        <div className="brand">
          Watch<span>The</span>Flix
        </div>
        <div className="skel skel-search" />
        <div className="skel skel-btn" />
      </div>
      <div className="skel-hero" />
      <div className="section">
        <div className="skel skel-heading" />
        <div className="skel-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel skel-poster" />
          ))}
        </div>
      </div>
      <div className="section">
        <div className="skel skel-heading" />
        <div className="skel-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel skel-poster" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function DetailSkeleton() {
  return (
    <div className="app-shell page-enter" aria-busy="true" aria-label="Loading title">
      <div className="topbar">
        <div className="brand">
          Watch<span>The</span>Flix
        </div>
      </div>
      <div className="skel-detail">
        <div className="skel skel-detail-poster" />
        <div className="skel-detail-copy">
          <div className="skel skel-title" />
          <div className="skel skel-line" />
          <div className="skel skel-line short" />
          <div className="skel skel-btn" />
        </div>
      </div>
    </div>
  )
}
