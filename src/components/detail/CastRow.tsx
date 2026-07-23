type CastMember = {
  name: string
  character: string
  profile: string | null
}

type Props = {
  cast: CastMember[]
}

export function CastRow({ cast }: Props) {
  if (cast.length === 0) return null
  return (
    <section className="section">
      <div className="section-head">
        <h2>Cast</h2>
      </div>
      <div className="cast-row">
        {cast.map((m) => (
          <div key={m.name + m.character} className="cast-card">
            {m.profile ? <img src={m.profile} alt="" /> : <div className="cast-fallback" />}
            <strong>{m.name}</strong>
            <span className="muted">{m.character}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
