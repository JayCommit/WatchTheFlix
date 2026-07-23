import type { Title } from '../types'

export function matchesQuery(title: Title, q: string): boolean {
  if (!q) return true
  const hay =
    `${title.title} ${title.year ?? ''} ${title.genres.join(' ')} ${title.overview ?? ''}`.toLowerCase()
  return hay.includes(q)
}
