import { beforeEach, describe, expect, it } from 'vitest'
import { applyRememberedTheme, applyTheme, themeVars } from '../lib/theme'

beforeEach(() => { applyTheme(null); localStorage.clear() })

describe('themes', () => {
  it('turns a theme into colour variables and ignores anything that is not a plain colour', () => {
    expect(themeVars({ accent: '#2E7D32', bg: 'url(http://x)', panel: '#112233', other: '#ffffff' })).toEqual({
      '--accent': '#2E7D32', '--accent-soft': 'rgba(46, 125, 50, 0.12)', '--panel': '#112233',
    })
    expect(themeVars(null)).toEqual({})
  })

  it('applies, remembers and removes a theme', () => {
    applyTheme({ accent: '#C9A227' })
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#C9A227')
    applyTheme(null)
    document.documentElement.style.removeProperty('--accent')
    applyTheme({ accent: '#C9A227' })
    document.documentElement.style.removeProperty('--accent')
    applyRememberedTheme()
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#C9A227')
    applyTheme(null)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('')
    expect(localStorage.getItem('jaajef.theme')).toBeNull()
  })
})
