import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listMyPortfolio: vi.fn(),
  addPortfolioItem: vi.fn(),
  updatePortfolioItem: vi.fn(),
  deletePortfolioItem: vi.fn(),
  getMyCv: vi.fn(),
  uploadCv: vi.fn(),
  removeMyCv: vi.fn(),
  cvLink: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { CvPortfolio } from '../pages/CvPortfolio'

const item = (n: number) => ({ id: `i${n}`, title: `Projet ${n}`, description: null, url: `https://x.sn/${n}`, project_id: null })
const noCv = { cv_path: null, cv_name: null, cv_size: null }
const hasCv = { cv_path: 'me/a.pdf', cv_name: 'mon-cv.pdf', cv_size: 1000 }
const mount = () => render(<MemoryRouter><CvPortfolio /></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  api.listMyPortfolio.mockResolvedValue([])
  api.getMyCv.mockResolvedValue(noCv)
  api.addPortfolioItem.mockResolvedValue('new')
  api.updatePortfolioItem.mockResolvedValue(undefined)
  api.deletePortfolioItem.mockResolvedValue(undefined)
  api.uploadCv.mockResolvedValue(undefined)
  api.removeMyCv.mockResolvedValue(undefined)
})

describe('CvPortfolio', () => {
  it('adds a portfolio item', async () => {
    mount()
    await userEvent.type(await screen.findByLabelText('Titre'), 'Mon site')
    await userEvent.type(screen.getByLabelText('Lien (https)'), 'https://moi.sn')
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    await waitFor(() => expect(api.addPortfolioItem).toHaveBeenCalledWith('Mon site', '', 'https://moi.sn'))
  })

  it('does not allow adding without a title and a link', async () => {
    mount()
    await screen.findByLabelText('Titre')
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled()
  })

  it('shows a friendly message when the backend refuses', async () => {
    api.addPortfolioItem.mockRejectedValue(new Error('The link must be a secure (https) address'))
    mount()
    await userEvent.type(await screen.findByLabelText('Titre'), 'Mon site')
    await userEvent.type(screen.getByLabelText('Lien (https)'), 'http://moi.sn')
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(await screen.findByText(/commencer par https/)).toBeInTheDocument()
  })

  it('hides the add form when the portfolio is full', async () => {
    api.listMyPortfolio.mockResolvedValue(Array.from({ length: 10 }, (_, i) => item(i + 1)))
    mount()
    expect(await screen.findByText(/portfolio est plein/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ajouter' })).not.toBeInTheDocument()
  })

  it('edits the right item', async () => {
    api.listMyPortfolio.mockResolvedValue([item(1), item(2)])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier : Projet 2' }))
    const box = screen.getByDisplayValue('Projet 2')
    await userEvent.clear(box)
    await userEvent.type(box, 'Projet deux')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(api.updatePortfolioItem).toHaveBeenCalledWith('i2', 'Projet deux', '', 'https://x.sn/2'))
  })

  it('removes the right item', async () => {
    api.listMyPortfolio.mockResolvedValue([item(1), item(2)])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer : Projet 1' }))
    await waitFor(() => expect(api.deletePortfolioItem).toHaveBeenCalledWith('i1'))
  })

  it('uploads a PDF CV', async () => {
    mount()
    await screen.findByText(/pas encore ajouté de CV/)
    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Choisir un fichier PDF', { selector: 'input' }), file)
    await waitFor(() => expect(api.uploadCv).toHaveBeenCalledWith('me', file))
  })

  it('refuses a file that is not a PDF', async () => {
    mount()
    await screen.findByText(/pas encore ajouté de CV/)
    const file = new File(['x'], 'cv.docx', { type: 'application/msword' })
    await userEvent.upload(screen.getByLabelText('Choisir un fichier PDF', { selector: 'input' }), file, { applyAccept: false })
    expect(await screen.findByText('Le fichier doit être un PDF.')).toBeInTheDocument()
    expect(api.uploadCv).not.toHaveBeenCalled()
  })

  it('refuses a CV over 5 MB', async () => {
    mount()
    await screen.findByText(/pas encore ajouté de CV/)
    const file = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 })
    await userEvent.upload(screen.getByLabelText('Choisir un fichier PDF', { selector: 'input' }), file)
    expect(await screen.findByText('Le fichier dépasse 5 Mo.')).toBeInTheDocument()
    expect(api.uploadCv).not.toHaveBeenCalled()
  })

  it('opens and removes an existing CV', async () => {
    api.getMyCv.mockResolvedValue(hasCv)
    api.cvLink.mockResolvedValue('https://signed.example/cv')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mount()
    expect(await screen.findByText('mon-cv.pdf')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir mon CV' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/cv', '_blank', 'noopener,noreferrer'))
    expect(api.cvLink).toHaveBeenCalledWith('me/a.pdf')
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer mon CV' }))
    await waitFor(() => expect(api.removeMyCv).toHaveBeenCalled())
    open.mockRestore()
  })

  it('shows a retry when loading fails', async () => {
    api.listMyPortfolio.mockRejectedValueOnce(new Error('boom'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Mon portfolio')).toBeInTheDocument()
    void within
  })
})
