/** Focus the topbar search when `/` is pressed (outside editable fields). */
export function bindSlashToSearch(inputId = 'wtf-topbar-search'): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if ((e.target as HTMLElement | null)?.isContentEditable) return
    const input = document.getElementById(inputId) as HTMLInputElement | null
    if (!input) return
    e.preventDefault()
    input.focus()
    input.select()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
