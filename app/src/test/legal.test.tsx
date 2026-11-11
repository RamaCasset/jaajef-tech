import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Legal } from '../pages/Legal'
import { legal } from '../i18n/legal'

describe('Legal pages', () => {
  it('shows the privacy policy to a visitor, with the draft notice and the other texts', () => {
    render(<MemoryRouter><Legal doc="privacy" /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Politique de confidentialité' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('Version provisoire')
    expect(screen.getByRole('link', { name: "Conditions d'utilisation" })).toHaveAttribute('href', '/conditions')
    expect(screen.getByRole('link', { name: 'Règles des offres' })).toHaveAttribute('href', '/regles-offres')
  })

  it('has the same texts and sections in French and English', () => {
    for (const k of ['privacy', 'terms', 'rules', 'jobs'] as const) {
      const a = legal.fr.docs[k]
      const b = legal.en.docs[k]
      expect(b.sections.length).toBe(a.sections.length)
      a.sections.forEach((s, i) => expect(b.sections[i].p.length).toBe(s.p.length))
    }
  })

  it('keeps the promises the app really keeps: 14 days to change your mind, no card numbers', () => {
    const text = JSON.stringify(legal.fr.docs.privacy)
    expect(text).toContain('14 jours')
    expect(text).toContain('numéro de carte')
  })
})
