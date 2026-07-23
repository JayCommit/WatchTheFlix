import type { api } from '../../api'

export type Section =
  | 'overview'
  | 'now'
  | 'library'
  | 'unmatched'
  | 'activity'
  | 'convert'
  | 'users'
  | 'tools'

export const SECTIONS: Section[] = [
  'overview',
  'now',
  'library',
  'unmatched',
  'activity',
  'convert',
  'users',
  'tools',
]

export function isSection(value: string | null): value is Section {
  return Boolean(value && (SECTIONS as string[]).includes(value))
}

export type Diagnostics = Awaited<ReturnType<typeof api.diagnostics>>

export type DrawerHealth = {
  present: number
  expected: number
  missing: Array<{ season: number; episode: number; name: string }>
}
