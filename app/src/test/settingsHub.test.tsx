import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const startKopekPurchase = vi.fn()
const confirmKopekPurchase = vi.fn()
vi.mock('../lib/api', () => ({ startKopekPurchase: (...a: unknown[]) => startKopekPurchase(...a), confirmKopekPurchase: (...a: unknown[]) => confirmKopekPurchase(...a) }))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 2450, profile: { id: 'me', display_name: 'Moussa Diop' } }, signOut: vi.fn(), refreshMember: vi.fn() }),
}))
vi.mock('../components/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))

import { SettingsHub } from '../pages/SettingsHub'
import { LanguageSettings } from '../pages/LanguageSettings'
import { BuyKopeks } from '../pages/BuyKopeks'
import { KopeksReturn } from '../pages/KopeksReturn'

beforeEach(() => { startKopekPurchase.mockReset(); confirmKopekPurchase.mockReset() })

describe('Settings hub', () => {
  it('has a back link to La Cité, and the language page goes back to settings', () => {
    const first = render(<MemoryRouter><SettingsHub /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Retour/ })).toHaveAttribute('href', '/la-cite')
    first.unmount()
    render(<MemoryRouter><LanguageSettings /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Retour aux paramètres/ })).toHaveAttribute('href', '/parametres')
  })

  it('lists the five areas with their links', () => {
    render(<MemoryRouter><SettingsHub /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Paramètres' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Profil/ })).toHaveAttribute('href', '/parametres/profil')
    expect(screen.getByRole('link', { name: /Mon compte/ })).toHaveAttribute('href', '/parametres/compte')
    expect(screen.getByRole('link', { name: /Langue/ })).toHaveAttribute('href', '/parametres/langue')
    expect(screen.getByRole('link', { name: /Notifications/ })).toHaveAttribute('href', '/parametres/compte#notifications')
    expect(screen.getByRole('link', { name: /Supprimer mon compte/ })).toHaveAttribute('href', '/parametres/compte#suppression')
  })
})

describe('Buy Kopeks', () => {
  it('starts on the 500 pack with the new balance worked out', () => {
    render(<MemoryRouter><BuyKopeks /></MemoryRouter>)
    expect(screen.getByRole('radio', { name: /500/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText('5 000 F CFA').length).toBeGreaterThan(1)
    expect(screen.getByText('2 950 Kopeks')).toBeInTheDocument()
  })

  it('updates the summary when another pack is chosen', async () => {
    render(<MemoryRouter><BuyKopeks /></MemoryRouter>)
    await userEvent.click(screen.getByRole('radio', { name: /1 000 Kopeks 10 000/ }))
    expect(screen.getByRole('button', { name: 'Payer 10 000 F CFA' })).toBeInTheDocument()
    expect(screen.getByText('3 450 Kopeks')).toBeInTheDocument()
  })

  it('needs a 9-digit number for Wave and none for a card, then starts the payment with the chosen pack', async () => {
    startKopekPurchase.mockRejectedValue(new Error('payment_unavailable'))
    render(<MemoryRouter><BuyKopeks /></MemoryRouter>)
    const pay = screen.getByRole('button', { name: /^Payer/ })
    expect(pay).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Numéro de téléphone Wave'), '77 123 45 67')
    expect(pay).toBeEnabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Carte bancaire' }))
    expect(screen.queryByLabelText('Numéro de téléphone Wave')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Payer/ }))
    expect(startKopekPurchase).toHaveBeenCalledWith(500, 'card', '77 123 45 67')
    expect(await screen.findByRole('alert')).toHaveTextContent("Le paiement n'a pas pu démarrer")
  })
})

describe('Return from the payment page', () => {
  const at = (q: string) => render(<MemoryRouter initialEntries={[`/kopeks/retour${q}`]}><KopeksReturn /></MemoryRouter>)

  it('says the Kopeks were added once the server confirms', async () => {
    confirmKopekPurchase.mockResolvedValue({ outcome: 'credited', kopeks: 500 })
    at('?token=test_abc')
    expect(await screen.findByRole('status')).toHaveTextContent('500 Kopeks ont été ajoutés')
    expect(confirmKopekPurchase).toHaveBeenCalledWith('test_abc')
  })

  it('offers to check again while the payment is pending', async () => {
    confirmKopekPurchase.mockResolvedValueOnce({ outcome: 'pending', kopeks: 500 }).mockResolvedValueOnce({ outcome: 'credited', kopeks: 500 })
    at('?token=test_abc')
    await userEvent.click(await screen.findByRole('button', { name: 'Vérifier à nouveau' }))
    expect(await screen.findByRole('status')).toHaveTextContent('500 Kopeks')
  })

  it('says nothing was charged when the payment was cancelled, and handles a missing token', async () => {
    confirmKopekPurchase.mockResolvedValue({ outcome: 'cancelled', kopeks: 100 })
    const first = at('?token=test_abc')
    expect(await screen.findByRole('alert')).toHaveTextContent("n'a pas abouti")
    first.unmount()
    at('')
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de vérifier')
  })
})
