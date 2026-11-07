import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchEverything = vi.fn()
vi.mock('../lib/api', () => ({ searchEverything: (...a: unknown[]) => searchEverything(...a) }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Search } from '../pages/Search'

const hit = (kind: string, id: string, slug: string, title: string, subtitle: string | null = null) => ({ kind, pos: 1, id, slug, title, subtitle, image_url: null })
const mount = (url = '/recherche') => render(<MemoryRouter initialEntries={[url]}><Search /></MemoryRouter>)

beforeEach(() => {
  searchEverything.mockReset()
  searchEverything.mockResolvedValue([
    hit('quest', 'q1', 'fizzbuzz', 'FizzBuzz', 'Facile'),
    hit('member', 'm1', 'awa', 'Awa Diallo', '@awa'),
    hit('project', 'p1', 'ndar/teranga', 'Teranga', 'Une appli'),
    hit('community', 'c1', 'dev-dakar', 'Dev Dakar'),
  ])
})

describe('Search', () => {
  it('waits for two letters and for typing to pause before asking', async () => {
    mount()
    await userEvent.type(screen.getByLabelText('Que cherchez-vous ?'), 'a')
    expect(screen.getByText('Tapez au moins 2 lettres.')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 450))
    expect(searchEverything).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Que cherchez-vous ?'), 'bc')
    await waitFor(() => expect(searchEverything).toHaveBeenCalledTimes(1))
    expect(searchEverything).toHaveBeenCalledWith('abc')
  })

  it('groups results in a fixed order and links each kind to the right place', async () => {
    mount('/recherche?q=te')
    expect(await screen.findByRole('link', { name: 'Awa Diallo' })).toHaveAttribute('href', '/profil/awa')
    expect(screen.getByRole('link', { name: 'FizzBuzz' })).toHaveAttribute('href', '/quetes/fizzbuzz')
    expect(screen.getByRole('link', { name: 'Dev Dakar' })).toHaveAttribute('href', '/communautes/dev-dakar')
    const gh = screen.getByRole('link', { name: 'Teranga' })
    expect(gh).toHaveAttribute('href', 'https://github.com/ndar/teranga')
    expect(gh).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Projets', 'Membres', 'Communautés', 'Quêtes'])
  })

  it('starts from the address of the page', async () => {
    mount('/recherche?q=teranga')
    expect(screen.getByLabelText('Que cherchez-vous ?')).toHaveValue('teranga')
    await waitFor(() => expect(searchEverything).toHaveBeenCalledWith('teranga'))
  })

  it('says when nothing matches, and offers a retry when the search fails', async () => {
    searchEverything.mockResolvedValueOnce([])
    const first = mount('/recherche?q=zzz')
    expect(await screen.findByText('Aucun résultat pour « zzz ».')).toBeInTheDocument()
    first.unmount()
    searchEverything.mockRejectedValueOnce(new Error('x'))
    mount('/recherche?q=abc')
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('link', { name: 'Awa Diallo' })).toBeInTheDocument()
  })
})
