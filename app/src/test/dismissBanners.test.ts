import { describe, expect, it } from 'vitest'
import { installBannerDismiss } from '../lib/dismissBanners'

function box(): HTMLElement {
  document.body.innerHTML = '<div class="alert" role="alert">Oups</div>'
  const el = document.querySelector('.alert') as HTMLElement
  el.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 40, width: 300, height: 40, x: 0, y: 0, toJSON: () => ({}) })
  return el
}

describe('banner dismiss', () => {
  it('hides the box when its right edge is clicked, not when its text is', () => {
    const stop = installBannerDismiss()
    const el = box()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50 }))
    expect(el).not.toHaveAttribute('data-dismissed')
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 290 }))
    expect(el).toHaveAttribute('data-dismissed')
    stop()
  })

  it('shows the box again when its message changes', async () => {
    const stop = installBannerDismiss()
    const el = box()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 290 }))
    el.textContent = 'Autre erreur'
    await new Promise((r) => setTimeout(r, 0))
    expect(el).not.toHaveAttribute('data-dismissed')
    stop()
  })
})
