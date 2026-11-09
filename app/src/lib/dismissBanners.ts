/**
 * Every message box (div/p with class "alert" or "notice") shows a small x at its right edge.
 * Clicking the x hides the box; a new message in the same box shows it again.
 * One listener for the whole app, so each page does not need to know about it.
 */
const BOX = 'div.alert, p.alert, div.notice, p.notice'
const X_WIDTH = 36

export function installBannerDismiss(root: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const box = t.closest(BOX)
    if (!(box instanceof HTMLElement) || t !== box) return
    const r = box.getBoundingClientRect()
    if (e.clientX < r.right - X_WIDTH) return
    box.setAttribute('data-dismissed', box.textContent ?? '')
  }
  const watcher = new MutationObserver(() => {
    root.querySelectorAll<HTMLElement>('[data-dismissed]').forEach((box) => {
      if (box.getAttribute('data-dismissed') !== (box.textContent ?? '')) box.removeAttribute('data-dismissed')
    })
  })
  root.addEventListener('click', onClick)
  watcher.observe(root.body, { subtree: true, childList: true, characterData: true })
  return () => { root.removeEventListener('click', onClick); watcher.disconnect() }
}
