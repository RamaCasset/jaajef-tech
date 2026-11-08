import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getProjectFull: vi.fn(), getRepoTree: vi.fn(), getRepoFile: vi.fn(), getLastCommits: vi.fn(),
  editorStatus: vi.fn(), editorTree: vi.fn(), editorCommit: vi.fn(),
}))
vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...real, ...api }
})
const auth = vi.hoisted(() => ({ id: 'me' }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: auth.id, display_name: 'Moussa' } }, signOut: vi.fn() }),
}))
// Monaco needs a real browser, so a plain text box stands in for it.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, path, options }: { value: string; onChange: (v: string) => void; path: string; options?: { readOnly?: boolean } }) => (
    <textarea aria-label={`code ${path}`} value={value} readOnly={options?.readOnly} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { RepoBrowser } from '../pages/RepoBrowser'
const { EditorError } = await vi.importActual<typeof import('../lib/api')>('../lib/api')

const HEAD = 'a'.repeat(40)
const NEW_HEAD = 'b'.repeat(40)
const project = { id: 'p1', title: 'Mon appli', github_owner: 'awa', github_repo: 'appli', owner_id: 'me' }
const publicTree = {
  branch: 'main', truncated: false,
  entries: [
    { path: 'README.md', type: 'blob', size: 20 },
    { path: 'src', type: 'tree', size: 0 },
    { path: 'main.py', type: 'blob', size: 20 },
    { path: 'src/util.py', type: 'blob', size: 10 },
    { path: 'logo.png', type: 'blob', size: 900 },
  ],
}
function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}{l.search}</p>
}
const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/projets/:id/code" element={<><RepoBrowser /><Where /></>} /><Route path="/projets/:id" element={<Where />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  auth.id = 'me'
  api.getProjectFull.mockResolvedValue(project)
  api.getRepoTree.mockResolvedValue(publicTree)
  api.getRepoFile.mockImplementation(async (_o: string, _r: string, _b: string, path: string) => `contenu de ${path}`)
  api.getLastCommits.mockResolvedValue({})
  api.editorStatus.mockResolvedValue({ installed: true, install_url: 'https://github.com/apps/x/installations/new', github_name: 'awa' })
  api.editorTree.mockResolvedValue({ branch: 'main', head: HEAD, truncated: false, entries: [] })
  api.editorCommit.mockResolvedValue({ commit_sha: NEW_HEAD, html_url: 'https://github.com/awa/appli/commit/' + NEW_HEAD })
})

describe('Repository: the list of files', () => {
  it('shows folders first, then files, and links folders and files', async () => {
    mount('/projets/p1/code?dossier=')
    const table = await screen.findByRole('table')
    const names = within(table).getAllByRole('link').map((a) => a.textContent?.trim())
    expect(names).toEqual(['src', 'logo.png', 'main.py', 'README.md'])
    expect(within(table).getByRole('link', { name: 'src' })).toHaveAttribute('href', '/projets/p1/code?dossier=src')
    expect(within(table).getByRole('link', { name: 'main.py' })).toHaveAttribute('href', '/projets/p1/code?fichier=main.py')
  })

  it('goes into a folder and offers a way back', async () => {
    mount('/projets/p1/code?dossier=src')
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'util.py' })).toHaveAttribute('href', '/projets/p1/code?fichier=src%2Futil.py')
    await userEvent.click(within(table).getByRole('link', { name: 'Dossier parent' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/projets/p1')
  })

  it('shows the last message and date of each file when they can be loaded', async () => {
    api.getLastCommits.mockResolvedValue({ 'main.py': { message: 'Corrige la boucle', date: '2026-11-03T10:00:00Z' } })
    mount('/projets/p1/code?dossier=')
    expect(await screen.findByText('Corrige la boucle')).toBeInTheDocument()
    expect(screen.getByText('03/11/2026')).toBeInTheDocument()
  })

  it('still shows the files when the last messages cannot be loaded', async () => {
    api.getLastCommits.mockRejectedValue(new Error('down'))
    mount('/projets/p1/code?dossier=')
    expect(await screen.findByRole('link', { name: 'main.py' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('only the owner can start a new file', async () => {
    auth.id = 'someone-else'
    mount('/projets/p1/code?dossier=')
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Nouveau fichier' })).toBeNull()
  })

  it('refuses bad or existing names for a new file, and opens a valid one', async () => {
    mount('/projets/p1/code?dossier=src')
    await userEvent.click(await screen.findByRole('button', { name: 'Nouveau fichier' }))
    const input = screen.getByLabelText(/Chemin du fichier/)
    await userEvent.type(input, '../x.py')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("n'est pas valide")
    await userEvent.clear(input)
    await userEvent.type(input, 'util.py')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('existe déjà')
  })
})

describe('Repository: viewing a file', () => {
  it('shows the path, the code and the list of all files, without edit buttons for a visitor', async () => {
    auth.id = 'someone-else'
    mount('/projets/p1/code?fichier=main.py')
    const code = await screen.findByLabelText('code main.py')
    expect(code).toHaveValue('contenu de main.py')
    expect(code).toHaveAttribute('readonly')
    expect(screen.getAllByText('main.py').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Modifier ce fichier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Supprimer ce fichier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    const panel = screen.getByRole('complementary', { name: 'Tous les fichiers' })
    expect(within(panel).getAllByRole('link').map((a) => a.textContent)).toEqual(['logo.png', 'main.py', 'README.md', 'src/util.py'])
  })

  it('hides and shows the list of files', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByLabelText('code main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Afficher ou masquer la liste des fichiers' }))
    expect(screen.queryByRole('complementary', { name: 'Tous les fichiers' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Afficher ou masquer la liste des fichiers' }))
    expect(screen.getByRole('complementary', { name: 'Tous les fichiers' })).toBeInTheDocument()
  })

  it('says so when a file cannot be shown', async () => {
    mount('/projets/p1/code?fichier=logo.png')
    expect(await screen.findByRole('alert')).toHaveTextContent('ne peut pas être affiché')
  })
})

describe('Repository: editing, saving and deleting', () => {
  it('edits a file, asks for a description, and saves one commit', async () => {
    mount('/projets/p1/code?fichier=main.py')
    const save = await screen.findByRole('button', { name: 'Enregistrer' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Modifier ce fichier' }))
    const code = await screen.findByLabelText('code main.py')
    await waitFor(() => expect(code).not.toHaveAttribute('readonly'))
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    await userEvent.type(code, ' !')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    const send = screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Ajoute un point')
    await userEvent.click(send)
    await waitFor(() => expect(api.editorCommit).toHaveBeenCalledTimes(1))
    expect(api.editorCommit).toHaveBeenCalledWith('appli', 'main', HEAD, 'Ajoute un point', [{ path: 'main.py', content: 'contenu de main.py !' }])
    expect(await screen.findByRole('status')).toHaveTextContent('enregistrées sur GitHub')
    expect(screen.getByRole('link', { name: 'Voir sur GitHub' })).toHaveAttribute('href', expect.stringContaining(NEW_HEAD))
    expect(screen.getByLabelText('code main.py')).toHaveAttribute('readonly')
  })

  it('shows a clear message when the branch moved, and keeps the text', async () => {
    api.editorCommit.mockRejectedValue(new EditorError('branch_moved'))
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    const code = await screen.findByLabelText('code main.py')
    await userEvent.type(code, 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'm')
    await userEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement)
    expect(await screen.findByRole('alert')).toHaveTextContent('Le dépôt a changé sur GitHub')
    expect(screen.getByLabelText('code main.py')).toHaveValue('contenu de main.pyx')
  })

  it('deletes a file after a description, then returns to its folder', async () => {
    mount('/projets/p1/code?fichier=src%2Futil.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer ce fichier' }))
    expect(await screen.findByText('Supprimer ce fichier ?')).toBeInTheDocument()
    expect(screen.getByText(/src\/util\.py sera supprimé/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Retire util')
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(api.editorCommit).toHaveBeenCalledWith('appli', 'main', HEAD, 'Retire util', [{ path: 'src/util.py', delete: true }]))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('dossier=src')
  })

  it('creates a new file from the "new file" link', async () => {
    mount('/projets/p1/code?fichier=src%2Fnew.py&nouveau=1')
    const code = await screen.findByLabelText('code src/new.py')
    await waitFor(() => expect(code).not.toHaveAttribute('readonly'))
    await userEvent.type(code, 'print(1)')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Nouveau fichier')
    await userEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement)
    await waitFor(() => expect(api.editorCommit).toHaveBeenCalledWith('appli', 'main', HEAD, 'Nouveau fichier', [{ path: 'src/new.py', content: 'print(1)' }]))
  })

  it('asks the owner to install the GitHub app when it is not installed', async () => {
    api.editorStatus.mockResolvedValue({ installed: false, install_url: 'https://github.com/apps/x/installations/new', github_name: 'awa' })
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    expect(await screen.findByRole('link', { name: "Installer l'application GitHub" })).toHaveAttribute('href', expect.stringContaining('installations/new'))
    expect(screen.getByLabelText('code main.py')).toHaveAttribute('readonly')
  })

  it('tells the owner when the app has no access to this repository', async () => {
    api.editorTree.mockRejectedValue(new EditorError('repo_not_allowed'))
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    expect(await screen.findByText("Ce dépôt n'est pas autorisé")).toBeInTheDocument()
  })
})
