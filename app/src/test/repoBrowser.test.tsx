import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getProjectFull: vi.fn(), loadRepoTree: vi.fn(), loadRepoFile: vi.fn(), getLastCommits: vi.fn(),
  editorStatus: vi.fn(), editorSearch: vi.fn(), editorBlob: vi.fn(), editorTreeOf: vi.fn(), editorCommitTo: vi.fn(), listCollaborators: vi.fn(), loadBranches: vi.fn(), editorPropose: vi.fn(),
}))
vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...real, ...api }
})
const auth = vi.hoisted(() => ({ id: 'me', username: 'moussa_dev' }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: auth.id, username: auth.username, display_name: 'Moussa' } }, signOut: vi.fn() }),
}))
// Monaco needs a real browser, so a plain text box stands in for it.
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, path, options }: { value: string; onChange: (v: string) => void; path: string; options?: { readOnly?: boolean } }) => (
    <textarea aria-label={`code ${path}`} value={value} readOnly={options?.readOnly} onChange={(e) => onChange(e.target.value)} />
  ),
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => <div data-testid="diff">{`${original} => ${modified}`}</div>,
}))

import { RepoBrowser, slugBranch } from '../pages/RepoBrowser'
const { EditorError } = await vi.importActual<typeof import('../lib/api')>('../lib/api')

const HEAD = 'a'.repeat(40)
const NEW_HEAD = 'b'.repeat(40)
const project = { id: 'p1', title: 'Mon appli', github_owner: 'awa', github_repo: 'appli', owner_id: 'me', repo_private: false }
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
  auth.username = 'moussa_dev'
  api.getProjectFull.mockResolvedValue(project)
  api.loadRepoTree.mockResolvedValue(publicTree)
  api.loadRepoFile.mockImplementation(async (_p: unknown, _b: string, path: string) => `contenu de ${path}`)
  api.getLastCommits.mockResolvedValue({})
  api.editorStatus.mockResolvedValue({ installed: true, install_url: 'https://github.com/apps/x/installations/new', github_name: 'awa' })
  api.listCollaborators.mockResolvedValue([])
  api.loadBranches.mockResolvedValue({ default_branch: 'main', branches: ['main'] })
  api.editorTreeOf.mockResolvedValue({ branch: 'main', default_branch: 'main', head: HEAD, truncated: false, entries: [] })
  api.editorCommitTo.mockResolvedValue({ commit_sha: NEW_HEAD, html_url: 'https://github.com/awa/appli/commit/' + NEW_HEAD })
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

  it('only the owner or a collaborator can start a new file', async () => {
    auth.id = 'someone-else'
    mount('/projets/p1/code?dossier=')
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: 'Nouveau fichier' })).toBeNull()
  })

  it('refuses bad or existing names for a new file, and opens a valid one', async () => {
    mount('/projets/p1/code?dossier=src')
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nouveau fichier' }))
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

describe('Repository: the + menu on the project page', () => {
  it('lists the three actions, and a new folder opens a .gitkeep file to add', async () => {
    mount('/projets/p1/code?dossier=src')
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter' }))
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual(['Nouveau fichier', 'Nouveau dossier', 'Téléverser un fichier'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nouveau dossier' }))
    await userEvent.type(screen.getByLabelText(/Chemin du dossier/), 'docs')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByLabelText('code src/docs/.gitkeep')).toBeInTheDocument()
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
    expect(within(panel).getAllByRole('link').map((a) => a.textContent)).toEqual(['logo.png', 'main.py', 'README.md'])
    const folder = within(panel).getByRole('button', { name: 'src' })
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByRole('link', { name: 'util.py' })).toHaveAttribute('href', '/projets/p1/code?fichier=src%2Futil.py')
  })

  it('hides the file list with the button in its own header', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Masquer la liste des fichiers' }))
    expect(screen.queryByRole('complementary', { name: 'Tous les fichiers' })).toBeNull()
  })

  it('opens the folder of the current file in the file list', async () => {
    mount('/projets/p1/code?fichier=src%2Futil.py')
    const panel = await screen.findByRole('complementary', { name: 'Tous les fichiers' })
    expect(within(panel).getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByRole('link', { name: 'util.py' })).toHaveAttribute('aria-current', 'page')
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
    api.loadRepoTree.mockResolvedValue({ ...publicTree, entries: [...publicTree.entries, { path: 'data.zip', type: 'blob', size: 900 }] })
    mount('/projets/p1/code?fichier=data.zip')
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
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledTimes(1))
    expect(api.editorCommitTo).toHaveBeenCalledWith('p1', { branch: 'main', createFrom: undefined, baseSha: HEAD, message: 'Ajoute un point', files: [{ path: 'main.py', content: 'contenu de main.py !' }] })
    expect(await screen.findByRole('status')).toHaveTextContent('enregistrées sur GitHub')
    expect(screen.getByRole('link', { name: 'Voir sur GitHub' })).toHaveAttribute('href', expect.stringContaining(NEW_HEAD))
    expect(screen.getByLabelText('code main.py')).toHaveAttribute('readonly')
  })

  it('shows a clear message when the branch moved, and keeps the text', async () => {
    api.editorCommitTo.mockRejectedValue(new EditorError('branch_moved'))
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
    expect(await screen.findByText(/Ce fichier sera supprimé quand vous enregistrerez/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(screen.getByText('src/util.py', { selector: 'code' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Retire util')
    await userEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement)
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledWith('p1', { branch: 'main', createFrom: undefined, baseSha: HEAD, message: 'Retire util', files: [{ path: 'src/util.py', delete: true }] }))
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
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledWith('p1', { branch: 'main', createFrom: undefined, baseSha: HEAD, message: 'Nouveau fichier', files: [{ path: 'src/new.py', content: 'print(1)' }] }))
  })

  it('asks the owner to install the GitHub app when it is not installed', async () => {
    api.editorStatus.mockResolvedValue({ installed: false, install_url: 'https://github.com/apps/x/installations/new', github_name: 'awa' })
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    expect(await screen.findByRole('link', { name: "Installer l'application GitHub" })).toHaveAttribute('href', expect.stringContaining('installations/new'))
    expect(screen.getByLabelText('code main.py')).toHaveAttribute('readonly')
  })

  it('tells the owner when the app has no access to this repository', async () => {
    api.editorTreeOf.mockRejectedValue(new EditorError('repo_not_allowed'))
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    expect(await screen.findByText("Ce dépôt n'est pas autorisé")).toBeInTheDocument()
  })
})

describe('Repository: private code for members', () => {
  it('a collaborator reads the files and a file of a private project, read-only, with no edit buttons', async () => {
    auth.id = 'collab'
    api.getProjectFull.mockResolvedValue({ ...project, owner_id: 'owner', repo_private: true })
    mount('/projets/p1/code?fichier=main.py')
    expect(await screen.findByLabelText('code main.py')).toHaveValue('contenu de main.py')
    expect(api.loadRepoTree).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', repo_private: true }), null)
    expect(api.loadRepoFile).toHaveBeenCalledWith(expect.objectContaining({ repo_private: true }), 'main', 'main.py')
    expect(screen.getByLabelText('code main.py')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /Modifier|Enregistrer|Supprimer/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Historique du fichier' })).toHaveAttribute('href', '/projets/p1/historique?fichier=main.py')
  })

  it('the file list of a private project does not ask for last-commit messages from the public side', async () => {
    api.getProjectFull.mockResolvedValue({ ...project, repo_private: true })
    mount('/projets/p1/code?dossier=')
    await screen.findByRole('table')
    expect(api.getLastCommits).not.toHaveBeenCalled()
  })

  it('shows the app error when the owner has not allowed the app on that repository', async () => {
    api.getProjectFull.mockResolvedValue({ ...project, repo_private: true })
    api.loadRepoTree.mockRejectedValue(new EditorError('not_installed'))
    mount('/projets/p1/code?dossier=')
    expect(await screen.findByRole('alert')).toHaveTextContent("L'application GitHub n'est pas encore installée.")
  })
})

const sideTree = { ...publicTree, branch: 'ndeye_k/fix', default_branch: 'main' }
const asCollaborator = () => {
  auth.id = 'collab'
  auth.username = 'ndeye_k'
  api.getProjectFull.mockResolvedValue({ ...project, owner_id: 'owner' })
  api.listCollaborators.mockResolvedValue([{ user_id: 'collab' }])
}
async function typeAndSave(message: string, edit = 'x') {
  await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
  await userEvent.type(await screen.findByLabelText('code main.py'), edit)
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
  await userEvent.type(screen.getByLabelText('Décrivez votre modification'), message)
}
const submit = () => screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement

describe('Repository: branches', () => {
  it('turns a sentence into a safe branch name', () => {
    expect(slugBranch('Corrige le titre du README !')).toBe('corrige-le-titre-du-readme')
    expect(slugBranch('Été à Dakar')).toBe('ete-a-dakar')
    expect(slugBranch('  --..  ')).toBe('')
  })

  it('lists the branches with the main one first, and opens the one chosen', async () => {
    api.loadBranches.mockResolvedValue({ default_branch: 'main', branches: ['zeta', 'main', 'ndeye_k/fix'] })
    mount('/projets/p1/code?fichier=main.py')
    const picker = await screen.findByRole('combobox', { name: 'Branche' })
    await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(3))
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['main (principale)', 'ndeye_k/fix', 'zeta'])
    api.loadRepoTree.mockResolvedValue({ ...sideTree, branch: 'ndeye_k/fix' })
    await userEvent.selectOptions(picker, 'ndeye_k/fix')
    expect(screen.getByTestId('where')).toHaveTextContent('/projets/p1/code?fichier=main.py&branche=ndeye_k%2Ffix')
    await waitFor(() => expect(api.loadRepoTree).toHaveBeenLastCalledWith(expect.anything(), 'ndeye_k/fix'))
  })

  it('offers the pull request link only away from the main branch, and keeps the branch in the file links', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByRole('combobox', { name: 'Branche' })
    expect(screen.queryByRole('button', { name: 'Proposer mes changements' })).toBeNull()
    document.body.innerHTML = ''
    api.loadRepoTree.mockResolvedValue(sideTree)
    mount('/projets/p1/code?fichier=main.py&branche=ndeye_k%2Ffix')
    // a member proposes from the site; someone who is not a member is sent to GitHub's own page
    expect(await screen.findByRole('button', { name: 'Proposer mes changements' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ouvrir une pull request sur GitHub' })).toBeNull()
    const panel = screen.getByRole('complementary', { name: 'Tous les fichiers' })
    expect(within(panel).getByRole('link', { name: 'README.md' })).toHaveAttribute('href', '/projets/p1/code?fichier=README.md&branche=ndeye_k%2Ffix')
  })

  it('a visitor who is not a collaborator cannot edit', async () => {
    auth.id = 'stranger'
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByLabelText('code main.py')
    expect(screen.queryByRole('button', { name: 'Modifier ce fichier' })).toBeNull()
  })

  it('a collaborator saves on a new branch of their own, never on main, and gets the pull request link', async () => {
    asCollaborator()
    mount('/projets/p1/code?fichier=main.py')
    await typeAndSave('Corrige le titre')
    expect(screen.queryByRole('radio', { name: /Sur la branche/ })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Dans une nouvelle branche' })).toBeChecked()
    expect(screen.getByText('ndeye_k/')).toBeInTheDocument()
    expect(screen.getByLabelText('Nom de la nouvelle branche')).toHaveValue('corrige-le-titre')
    expect(screen.getByText(/Le code principal n'est pas touché/)).toBeInTheDocument()
    api.loadRepoTree.mockResolvedValue(sideTree)
    await userEvent.click(submit())
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledWith('p1', {
      branch: 'ndeye_k/corrige-le-titre', createFrom: 'main', baseSha: HEAD, message: 'Corrige le titre', files: [{ path: 'main.py', content: 'contenu de main.pyx' }],
    }))
    expect(api.editorStatus).not.toHaveBeenCalled()
    expect(await screen.findByTestId('where')).toHaveTextContent('branche=ndeye_k%2Fcorrige-le-titre')
    // one in the saved notice and one in the bar above the code
    expect(await screen.findAllByRole('button', { name: 'Proposer mes changements' })).toHaveLength(2)
  })

  it('a collaborator on their own branch saves there; on someone else\'s branch they must make a new one', async () => {
    asCollaborator()
    api.loadRepoTree.mockResolvedValue(sideTree)
    api.editorTreeOf.mockResolvedValue({ branch: 'ndeye_k/fix', default_branch: 'main', head: NEW_HEAD, truncated: false, entries: [] })
    mount('/projets/p1/code?fichier=main.py&branche=ndeye_k%2Ffix')
    await typeAndSave('Encore')
    expect(screen.getByRole('radio', { name: 'Sur la branche ndeye_k/fix' })).toBeChecked()
    await userEvent.click(submit())
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledWith('p1', expect.objectContaining({ branch: 'ndeye_k/fix', createFrom: undefined, baseSha: NEW_HEAD })))
    expect(api.editorTreeOf).toHaveBeenCalledWith('p1', 'ndeye_k/fix')

    document.body.innerHTML = ''
    vi.clearAllMocks()
    asCollaborator()
    api.loadRepoTree.mockResolvedValue({ ...sideTree, branch: 'awa/other' })
    api.loadRepoFile.mockResolvedValue('x')
    api.editorTreeOf.mockResolvedValue({ branch: 'awa/other', default_branch: 'main', head: NEW_HEAD, truncated: false, entries: [] })
    api.loadBranches.mockResolvedValue({ default_branch: 'main', branches: ['main', 'awa/other'] })
    mount('/projets/p1/code?fichier=main.py&branche=awa%2Fother')
    await typeAndSave('Autre')
    expect(screen.queryByRole('radio', { name: /Sur la branche/ })).toBeNull()
    expect(screen.getByLabelText('Nom de la nouvelle branche')).toHaveValue('autre')
  })

  it('the owner may save on the branch they look at, or in a new branch named freely', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await typeAndSave('Idée')
    expect(screen.getByRole('radio', { name: 'Sur la branche main' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Dans une nouvelle branche' }))
    const name = screen.getByLabelText('Nom de la nouvelle branche')
    await userEvent.clear(name)
    await userEvent.type(name, 'Essai Rapide')
    expect(name).toHaveValue('essai-rapide')
    expect(screen.queryByText('moussa_dev/')).toBeNull()
    api.loadRepoTree.mockResolvedValue({ ...sideTree, branch: 'essai-rapide' })
    await userEvent.click(submit())
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledWith('p1', expect.objectContaining({ branch: 'essai-rapide', createFrom: 'main' })))
    expect(api.editorStatus).toHaveBeenCalled()
  })

  it('says why a collaborator cannot save when the owner has not installed the app, and when the name is taken', async () => {
    asCollaborator()
    api.editorTreeOf.mockRejectedValueOnce(new EditorError('not_installed'))
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Le propriétaire doit d'abord installer l'application GitHub")

    api.editorCommitTo.mockRejectedValueOnce(new EditorError('branch_exists'))
    await userEvent.click(screen.getByRole('button', { name: 'Modifier ce fichier' }))
    await userEvent.type(await screen.findByLabelText('code main.py'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Pareil')
    await userEvent.click(submit())
    expect(await screen.findByText('Une branche porte déjà ce nom. Choisissez un autre nom.')).toBeInTheDocument()
  })
})

describe('Repository: proposing changes from the site', () => {
  beforeEach(() => {
    asCollaborator()
    api.loadRepoTree.mockResolvedValue(sideTree)
  })

  it('sends a proposal for the branch being viewed, and links to the proposals', async () => {
    api.editorPropose.mockResolvedValue({ number: 4, url: 'https://github.com/awa/appli/pull/4', existed: false })
    mount('/projets/p1/code?fichier=main.py&branche=ndeye_k%2Ffix')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Proposer mes changements' }))[0])
    const send = screen.getByRole('button', { name: 'Envoyer la proposition' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Titre de la proposition'), 'Corrige le titre')
    await userEvent.type(screen.getByLabelText('Explication (facultatif)'), 'Le titre était faux')
    await userEvent.click(send)
    await waitFor(() => expect(api.editorPropose).toHaveBeenCalledWith('p1', { branch: 'ndeye_k/fix', title: 'Corrige le titre', body: 'Le titre était faux' }))
    expect(await screen.findByText(/Proposition envoyée au propriétaire/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /propositions/i }).some((a) => a.getAttribute('href') === '/projets/p1/propositions')).toBe(true)
  })

  it('says when a proposal already exists, and explains a refusal', async () => {
    api.editorPropose.mockResolvedValueOnce({ number: 4, url: 'u', existed: true }).mockRejectedValueOnce(new EditorError('nothing_to_propose'))
    mount('/projets/p1/code?fichier=main.py&branche=ndeye_k%2Ffix')
    const open = async () => userEvent.click((await screen.findAllByRole('button', { name: 'Proposer mes changements' }))[0])
    await open()
    await userEvent.type(screen.getByLabelText('Titre de la proposition'), 'T')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la proposition' }))
    expect(await screen.findByText(/Une proposition existe déjà/)).toBeInTheDocument()
    await open()
    await userEvent.type(screen.getByLabelText('Titre de la proposition'), 'T')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la proposition' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Cette branche n'a aucun changement à proposer.")
  })
})

describe('Repository: several files in one save', () => {
  it('keeps edits across tabs, marks unsaved tabs, and saves all files with one description', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    const code = await screen.findByLabelText('code main.py')
    await waitFor(() => expect(code).not.toHaveAttribute('readonly'))
    await userEvent.type(code, 'A')
    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getByRole('tab', { name: /main\.py/ })).toBeInTheDocument()
    expect(within(tabs).getAllByRole('img', { name: 'modifié' })).toHaveLength(1)
    // go to another file through the file list: the first edit is kept
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: /src/ }))
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('link', { name: /util\.py/ }))
    const other = await screen.findByLabelText('code src/util.py')
    await userEvent.type(other, 'B')
    expect(within(screen.getByRole('tablist')).getAllByRole('img', { name: 'modifié' })).toHaveLength(2)
    await userEvent.click(within(screen.getByRole('tablist')).getByRole('tab', { name: /main\.py/ }))
    expect(await screen.findByLabelText('code main.py')).toHaveValue('contenu de main.pyA')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Deux fichiers')
    await userEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement)
    await waitFor(() => expect(api.editorCommitTo).toHaveBeenCalledTimes(1))
    expect(api.editorCommitTo.mock.calls[0][1].files).toEqual([
      { path: 'main.py', content: 'contenu de main.pyA' },
      { path: 'src/util.py', content: 'contenu de src/util.pyB' },
    ])
    expect(api.editorCommitTo.mock.calls[0][1].message).toBe('Deux fichiers')
    await waitFor(() => expect(within(screen.getByRole('tablist')).queryAllByRole('img', { name: 'modifié' })).toHaveLength(0))
  })

  it('Ctrl+S opens the save box only when there is something to save', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    const code = await screen.findByLabelText('code main.py')
    await waitFor(() => expect(code).not.toHaveAttribute('readonly'))
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(screen.queryByLabelText('Décrivez votre modification')).toBeNull()
    await userEvent.type(code, 'A')
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(await screen.findByLabelText('Décrivez votre modification')).toBeInTheDocument()
  })

  it('deleting a file keeps it listed as deleted and can be undone', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer ce fichier' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Annuler la suppression' }))
    expect(await screen.findByLabelText('code main.py')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })
})

describe('Repository: review, rename, folder and upload', () => {
  async function startEditing(url: string) {
    mount(url)
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier ce fichier' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Modifier ce fichier' })).toBeDisabled())
  }
  const submitBtn = () => screen.getAllByRole('button', { name: 'Enregistrer' }).find((b) => (b as HTMLButtonElement).type === 'submit') as HTMLElement

  it('shows before and after for each changed file before saving', async () => {
    await startEditing('/projets/p1/code?fichier=main.py')
    await userEvent.type(await screen.findByLabelText('code main.py'), 'Z')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Voir mes changements' }))
    expect(await screen.findByTestId('diff')).toHaveTextContent('contenu de main.py => contenu de main.pyZ')
    await userEvent.click(screen.getByRole('button', { name: 'Masquer mes changements' }))
    expect(screen.queryByTestId('diff')).toBeNull()
  })

  it('renames a file and saves it as a move', async () => {
    await startEditing('/projets/p1/code?fichier=main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Renommer ou déplacer' }))
    const input = screen.getByLabelText('Nouveau chemin du fichier')
    await userEvent.clear(input)
    await userEvent.type(input, 'src/app.py')
    await userEvent.click(screen.getByRole('button', { name: 'Renommer' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('fichier=src%2Fapp.py')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Déplace')
    await userEvent.click(submitBtn())
    await waitFor(() => expect(api.editorCommitTo.mock.calls[0]?.[1].files).toEqual([{ path: 'src/app.py', move_from: 'main.py' }]))
  })

  it('refuses a name that already exists', async () => {
    await startEditing('/projets/p1/code?fichier=main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Renommer ou déplacer' }))
    const input = screen.getByLabelText('Nouveau chemin du fichier')
    await userEvent.clear(input)
    await userEvent.type(input, 'README.md')
    await userEvent.click(screen.getByRole('button', { name: 'Renommer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('existe déjà')
    expect(api.editorCommitTo).not.toHaveBeenCalled()
  })

  it('creates a folder with a placeholder file', async () => {
    await startEditing('/projets/p1/code?fichier=main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nouveau dossier' }))
    await userEvent.type(screen.getByLabelText('Chemin du dossier'), 'docs')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Dossier')
    await userEvent.click(submitBtn())
    await waitFor(() => expect(api.editorCommitTo.mock.calls[0]?.[1].files).toEqual([{ path: 'docs/.gitkeep', content: '' }]))
  })

  it('the + menu lists new file, new folder and upload; a new file asks for a name and refuses one that exists', async () => {
    await startEditing('/projets/p1/code?fichier=main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }))
    expect(screen.getAllByRole('menuitem').map((x) => x.textContent)).toEqual(['Nouveau fichier', 'Nouveau dossier', 'Téléverser un fichier'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nouveau fichier' }))
    await userEvent.type(screen.getByLabelText(/Chemin du fichier/), 'main.py')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('existe déjà')
  })

  it('uploads a small file as base64 and refuses a file over 1 MB', async () => {
    await startEditing('/projets/p1/code?fichier=src%2Futil.py')
    const input = screen.getByLabelText('Téléverser un fichier', { selector: 'input' })
    await userEvent.upload(input, new File(['hello'], 'logo.txt', { type: 'text/plain' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))
    await userEvent.type(screen.getByLabelText('Décrivez votre modification'), 'Logo')
    await userEvent.click(submitBtn())
    await waitFor(() => expect(api.editorCommitTo.mock.calls[0]?.[1].files).toEqual([{ path: 'src/logo.txt', content_base64: 'aGVsbG8=' }]))
  })

  it('refuses an upload over 1 MB', async () => {
    await startEditing('/projets/p1/code?fichier=main.py')
    const big = new File(['x'], 'big.bin')
    Object.defineProperty(big, 'size', { value: 1_000_001 })
    await userEvent.upload(screen.getByLabelText('Téléverser un fichier', { selector: 'input' }), big)
    expect(await screen.findByRole('alert')).toHaveTextContent('1 Mo')
  })
})

describe('Repository: previews and search', () => {
  it('shows a README as formatted text and goes back to the code', async () => {
    api.loadRepoFile.mockResolvedValue('# Titre du projet\n\nUn **texte**.')
    mount('/projets/p1/code?fichier=README.md')
    await screen.findByLabelText('code README.md')
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }))
    expect(await screen.findByRole('heading', { name: 'Titre du projet' })).toBeInTheDocument()
    expect(screen.queryByLabelText('code README.md')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Code' }))
    expect(await screen.findByLabelText('code README.md')).toBeInTheDocument()
  })

  it('shows an image of a public repository straight from GitHub', async () => {
    mount('/projets/p1/code?fichier=logo.png')
    const img = await screen.findByRole('img', { name: 'Image logo.png' })
    expect(img).toHaveAttribute('src', 'https://raw.githubusercontent.com/awa/appli/main/logo.png')
    expect(api.loadRepoFile).not.toHaveBeenCalled()
  })

  it('reads an image of a private repository through the editor function', async () => {
    api.getProjectFull.mockResolvedValue({ ...project, repo_private: true })
    api.editorBlob.mockResolvedValue({ path: 'logo.png', size: 3, content_base64: 'AAEC' })
    mount('/projets/p1/code?fichier=logo.png')
    expect(await screen.findByRole('img', { name: 'Image logo.png' })).toHaveAttribute('src', 'data:image/png;base64,AAEC')
    expect(api.editorBlob).toHaveBeenCalledWith('p1', 'logo.png', 'main')
  })

  it('finds files by name as you type', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByLabelText('code main.py')
    await userEvent.type(screen.getByLabelText('Chercher un fichier (Ctrl+P)'), 'util')
    const list = screen.getByRole('list', { name: 'Fichiers trouvés' })
    expect(within(list).getByRole('link', { name: 'src/util.py' })).toHaveAttribute('href', '/projets/p1/code?fichier=src%2Futil.py')
    await userEvent.type(screen.getByLabelText('Chercher un fichier (Ctrl+P)'), 'zzz')
    expect(await screen.findByText('Aucun fichier trouvé.')).toBeInTheDocument()
  })

  it('Ctrl+P puts the cursor in the search box', async () => {
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByLabelText('code main.py')
    await userEvent.keyboard('{Control>}p{/Control}')
    await waitFor(() => expect(screen.getByLabelText('Chercher un fichier (Ctrl+P)')).toHaveFocus())
  })

  it('members can search the text inside the files', async () => {
    api.editorSearch.mockResolvedValue({ matches: [{ path: 'src/util.py', line: 3, text: 'def bonjour():' }], scanned: 4, skipped: 0, more: false })
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByLabelText('code main.py')
    await userEvent.type(screen.getByLabelText('Chercher un fichier (Ctrl+P)'), 'bonjour')
    await userEvent.click(screen.getByRole('button', { name: 'Chercher dans le texte des fichiers' }))
    expect(await screen.findByText('def bonjour():')).toBeInTheDocument()
    expect(api.editorSearch).toHaveBeenCalledWith('p1', 'bonjour', null)
  })

  it('visitors only get the file name search', async () => {
    auth.id = 'someone-else'
    mount('/projets/p1/code?fichier=main.py')
    await screen.findByLabelText('code main.py')
    await userEvent.type(screen.getByLabelText('Chercher un fichier (Ctrl+P)'), 'util')
    expect(screen.queryByRole('button', { name: 'Chercher dans le texte des fichiers' })).toBeNull()
  })
})
