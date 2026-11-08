import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getProjectFull: vi.fn(), editorStatus: vi.fn(), editorTree: vi.fn(), editorFile: vi.fn(), editorCommit: vi.fn() }))
vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...real, ...api }
})
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))
// Monaco needs a real browser, so a plain text box stands in for it.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, path }: { value: string; onChange: (v: string) => void; path: string }) => (
    <textarea aria-label={`code ${path}`} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { Editor } from '../pages/Editor'
import { languageOf } from '../components/CodeEditor'
const { EditorError } = await vi.importActual<typeof import('../lib/api')>('../lib/api')

const HEAD = 'a'.repeat(40)
const NEW_HEAD = 'b'.repeat(40)
const project = { id: 'p1', title: 'Mon appli', github_owner: 'awa', github_repo: 'appli', owner_id: 'me' }
const tree = (extra = {}) => ({
  branch: 'main', head: HEAD, truncated: false,
  entries: [
    { path: 'src', type: 'tree', size: 0 },
    { path: 'main.py', type: 'blob', size: 20 },
    { path: 'src/util.py', type: 'blob', size: 10 },
    { path: 'logo.png', type: 'blob', size: 900 },
  ],
  ...extra,
})
const mount = () => render(
  <MemoryRouter initialEntries={['/projets/p1/modifier']}>
    <Routes><Route path="/projets/:id/modifier" element={<Editor />} /></Routes>
  </MemoryRouter>,
)
const openFile = async (name: string) => userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`) }))
const box = (path: string) => screen.findByLabelText(`code ${path}`)
const saveButton = () => screen.getByRole('button', { name: 'Enregistrer sur GitHub' })

beforeEach(() => {
  vi.resetAllMocks()
  api.getProjectFull.mockResolvedValue(project)
  api.editorStatus.mockResolvedValue({ installed: true, install_url: 'https://github.com/apps/x/installations/new', github_name: 'awa' })
  api.editorTree.mockResolvedValue(tree())
  api.editorFile.mockImplementation(async (_r: string, path: string) => ({ path, content: `contenu de ${path}` }))
  api.editorCommit.mockResolvedValue({ commit_sha: NEW_HEAD, html_url: 'https://github.com/awa/appli/commit/' + NEW_HEAD })
})

describe('Editor: getting in', () => {
  it('refuses someone who does not own the project', async () => {
    api.getProjectFull.mockResolvedValue({ ...project, owner_id: 'someone-else' })
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Seul le propriétaire')
    expect(api.editorStatus).not.toHaveBeenCalled()
  })

  it('asks to connect GitHub first, without a retry button', async () => {
    api.editorStatus.mockRejectedValue(new EditorError('github_not_linked'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Connectez d\'abord votre compte GitHub')
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull()
  })

  it('offers to install the GitHub app, and checks again afterwards', async () => {
    api.editorStatus.mockResolvedValueOnce({ installed: false, install_url: 'https://github.com/apps/x/installations/new', github_name: 'awa' })
    mount()
    const link = await screen.findByRole('link', { name: "Installer l'application GitHub" })
    expect(link).toHaveAttribute('href', 'https://github.com/apps/x/installations/new')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(api.editorTree).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: "J'ai installé l'application" }))
    expect(await screen.findByRole('button', { name: /^main\.py/ })).toBeInTheDocument()
    expect(api.editorStatus).toHaveBeenCalledTimes(2)
  })

  it('explains when the app is installed but not on this repository', async () => {
    api.editorTree.mockRejectedValue(new EditorError('repo_not_allowed'))
    mount()
    expect(await screen.findByText("Ce dépôt n'est pas autorisé")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ouvrir les réglages/ })).toHaveAttribute('href', 'https://github.com/settings/installations')
  })

  it('shows a French message and a retry when GitHub fails', async () => {
    api.editorTree.mockRejectedValueOnce(new EditorError('github_failed'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub ne répond pas')
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('button', { name: /^main\.py/ })).toBeInTheDocument()
  })

  it('explains an empty repository and does not allow saving', async () => {
    api.editorTree.mockResolvedValue({ branch: 'main', head: null, truncated: false, entries: [] })
    mount()
    expect(await screen.findByText(/Ce dépôt est vide/)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })
})

describe('Editor: editing and saving', () => {
  it('lists files (not folders) and loads a file at the current head', async () => {
    mount()
    await openFile('src/util.py')
    expect((await box('src/util.py'))).toHaveValue('contenu de src/util.py')
    expect(api.editorFile).toHaveBeenCalledWith('appli', 'src/util.py', HEAD)
    expect(screen.queryByRole('button', { name: /^src$/ })).toBeNull()
  })

  it('does not load images', async () => {
    mount()
    await openFile('logo.png')
    expect(await screen.findByRole('alert')).toHaveTextContent('ne peut pas être modifié')
    expect(api.editorFile).not.toHaveBeenCalled()
  })

  it('needs a change and a message before saving', async () => {
    mount()
    await openFile('main.py')
    expect(saveButton()).toBeDisabled()
    expect(screen.getByText('Aucune modification')).toBeInTheDocument()
    await userEvent.type(await box('main.py'), '!')
    expect(screen.getByText('1 fichier modifié')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Mon changement')
    expect(saveButton()).toBeEnabled()
  })

  it('saves only what changed, then continues from the new head', async () => {
    mount()
    await openFile('main.py')
    await openFile('src/util.py')
    await userEvent.type(await box('src/util.py'), 'X')
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Mon changement')
    await userEvent.click(saveButton())
    await waitFor(() => expect(api.editorCommit).toHaveBeenCalledWith('appli', 'main', HEAD, 'Mon changement', [{ path: 'src/util.py', content: 'contenu de src/util.pyX' }]))
    expect(await screen.findByText(/Modifications enregistrées sur GitHub/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir sur GitHub' })).toHaveAttribute('href', 'https://github.com/awa/appli/commit/' + NEW_HEAD)
    expect(screen.getByText('Aucune modification')).toBeInTheDocument()
    // the next save is built on the new head
    await userEvent.type(await box('src/util.py'), 'Y')
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Encore')
    await userEvent.click(saveButton())
    await waitFor(() => expect(api.editorCommit).toHaveBeenLastCalledWith('appli', 'main', NEW_HEAD, 'Encore', [{ path: 'src/util.py', content: 'contenu de src/util.pyXY' }]))
  })

  it('keeps the work and explains when the repository changed on GitHub', async () => {
    api.editorCommit.mockRejectedValue(new EditorError('branch_moved'))
    mount()
    await openFile('main.py')
    await userEvent.type(await box('main.py'), '!')
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Mon changement')
    await userEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Le dépôt a changé sur GitHub')
    expect(screen.getByText('1 fichier modifié')).toBeInTheDocument()
    expect(await box('main.py')).toHaveValue('contenu de main.py!')
  })

  it('cancels edits on one file', async () => {
    mount()
    await openFile('main.py')
    await userEvent.type(await box('main.py'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Annuler mes modifications sur ce fichier' }))
    expect(screen.getByText('Aucune modification')).toBeInTheDocument()
    expect(await box('main.py')).toHaveValue('contenu de main.py')
  })

  it('warns before leaving with unsaved changes, and not otherwise', async () => {
    mount()
    await openFile('main.py')
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await userEvent.type(await box('main.py'), '!')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('Editor: new and deleted files', () => {
  it('creates a new file and saves it', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Nouveau fichier' }))
    await userEvent.type(screen.getByLabelText(/Chemin du fichier/), 'docs/notes.md')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    await userEvent.type(await box('docs/notes.md'), 'Bonjour')
    expect(screen.getByRole('button', { name: /^docs\/notes\.md \(nouveau\)/ })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Ajout')
    await userEvent.click(saveButton())
    await waitFor(() => expect(api.editorCommit).toHaveBeenCalledWith('appli', 'main', HEAD, 'Ajout', [{ path: 'docs/notes.md', content: 'Bonjour' }]))
    expect(api.editorFile).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: /^docs\/notes\.md$/ })).toBeInTheDocument()
  })

  it('refuses unsafe or existing file names', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Nouveau fichier' }))
    const input = screen.getByLabelText(/Chemin du fichier/)
    for (const bad of ['../x', '.git/config', '/etc/passwd', 'a//b', 'a\\b', '   ']) {
      await userEvent.clear(input)
      if (bad.trim()) await userEvent.type(input, bad)
      await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
      expect(await screen.findByText("Ce nom de fichier n'est pas valide.")).toBeInTheDocument()
    }
    await userEvent.clear(input)
    await userEvent.type(input, 'main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByText('Ce fichier existe déjà.')).toBeInTheDocument()
    expect(screen.getByText('Aucune modification')).toBeInTheDocument()
  })

  it('deletes a file on save, and can take the deletion back', async () => {
    mount()
    await openFile('main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer ce fichier' }))
    expect(screen.getByText('1 fichier modifié')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^main\.py \(supprimé\)/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Annuler la suppression' }))
    expect(screen.getByText('Aucune modification')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer ce fichier' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Nettoyage')
    await userEvent.click(saveButton())
    await waitFor(() => expect(api.editorCommit).toHaveBeenCalledWith('appli', 'main', HEAD, 'Nettoyage', [{ path: 'main.py', delete: true }]))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^main\.py/ })).toBeNull())
  })

  it('removing a file that was never saved leaves no change', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Nouveau fichier' }))
    await userEvent.type(screen.getByLabelText(/Chemin du fichier/), 'tmp.txt')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer ce fichier' }))
    expect(screen.getByText('Aucune modification')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^tmp\.txt/ })).toBeNull()
  })

  it('opens and closes tabs', async () => {
    mount()
    await openFile('main.py')
    await openFile('src/util.py')
    const tabs = within(screen.getByRole('tablist'))
    expect(tabs.getAllByRole('tab')).toHaveLength(2)
    await userEvent.click(tabs.getByRole('button', { name: 'Fermer src/util.py' }))
    expect(tabs.getAllByRole('tab')).toHaveLength(1)
    expect(await box('main.py')).toBeInTheDocument()
  })
})

describe('languageOf', () => {
  it('picks the language from the file name', () => {
    expect(languageOf('a/b/app.py')).toBe('python')
    expect(languageOf('x.TSX')).toBe('typescript')
    expect(languageOf('main.dart')).toBe('dart')
    expect(languageOf('Makefile')).toBe('plaintext')
  })
})
