import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 5, profile: { id: 'me', username: 'moussa_dev', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))
vi.mock('../lib/api', () => ({
  getMyStaffAccess: vi.fn().mockResolvedValue({ role: null, shopManager: false, shopOwner: false, questWriter: false }),
  unreadNotificationCount: vi.fn().mockResolvedValue(0),
}))
import { AppShell } from '../components/AppShell'
import { LangProvider } from '../i18n/LangContext'
import { setLangValue, readStoredLang, dateLocale } from '../i18n/lang'
import { fr, frMessages } from '../i18n/fr'
import { en } from '../i18n/en'

afterEach(() => {
  setLangValue('fr')
  window.localStorage.clear()
})

function mount() {
  return render(<MemoryRouter><LangProvider><AppShell><p>contenu</p></AppShell></LangProvider></MemoryRouter>)
}

describe('French and English', () => {
  it('starts in French and switches the whole screen to English, then back', async () => {
    mount()
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(nav).toHaveTextContent('Quêtes')
    await userEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveTextContent('Quests')
    expect(screen.getByRole('link', { name: 'My profile' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')
    await userEvent.click(screen.getByRole('button', { name: 'Français' }))
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toHaveTextContent('Quêtes')
  })

  it('remembers the choice on this device and uses it for dates', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(readStoredLang()).toBe('en')
    expect(dateLocale()).toBe('en-GB')
    expect(fr.nav.quests).toBe('Quests')
    await userEvent.click(screen.getByRole('button', { name: 'Français' }))
    expect(readStoredLang()).toBe('fr')
    expect(dateLocale()).toBe('fr-FR')
  })

  it('marks which language is selected', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('has an English text for every French text, with the same placeholders', () => {
    const problems: string[] = []
    const walk = (f: unknown, e: unknown, path: string) => {
      if (typeof f === 'string') {
        if (typeof e !== 'string') { problems.push(`${path}: not a string`); return }
        const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',')
        if (ph(f) !== ph(e)) problems.push(`${path}: placeholders differ`)
        // Proper names are the same in both languages.
        const properNames = ['fr.clans.saltigue.name']
        if (f === e && /[éèêàùçô]/.test(f) && !properNames.includes(path)) problems.push(`${path}: still French`)
      } else if (typeof f === 'function') {
        if (typeof e !== 'function') problems.push(`${path}: not a function`)
      } else if (Array.isArray(f)) {
        if (!Array.isArray(e) || e.length !== f.length) { problems.push(`${path}: array length differs`); return }
        f.forEach((x, i) => walk(x, (e as unknown[])[i], `${path}[${i}]`))
      } else if (f && typeof f === 'object') {
        for (const k of Object.keys(f)) walk((f as Record<string, unknown>)[k], (e as Record<string, unknown> | undefined)?.[k], `${path}.${k}`)
      }
    }
    walk(frMessages, en, 'fr')
    expect(problems).toEqual([])
  })
})
