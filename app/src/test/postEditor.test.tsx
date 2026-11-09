import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

vi.mock('../components/CodeEditor', () => ({
  languageOf: (p: string) => ({ py: 'python', js: 'javascript', txt: 'plaintext' } as Record<string, string>)[p.split('.').pop() ?? ''] ?? 'plaintext',
  CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <textarea aria-label="code" value={value} onChange={(e) => onChange(e.target.value)} />,
}))

import { PostEditor, composePost } from '../components/PostEditor'

function Harness() {
  const [md, setMd] = useState('')
  return <><PostEditor id="x" onChange={setMd} /><pre data-testid="out">{md}</pre></>
}

describe('composePost', () => {
  it('puts each code block after the text, fenced with more backticks than the code contains', () => {
    expect(composePost('Bonjour', [{ id: 1, name: '', ext: 'py', code: 'print(1)\n' }])).toBe('Bonjour\n\n```python\nprint(1)\n```')
    expect(composePost('', [{ id: 1, name: 'a.js', ext: 'js', code: 'x = "```"' }])).toBe('**a.js**\n\n````javascript\nx = "```"\n````')
  })
  it('skips an empty code block', () => {
    expect(composePost('Salut', [{ id: 1, name: '', ext: 'py', code: '  \n' }])).toBe('Salut')
  })
})

describe('PostEditor', () => {
  it('formats the selected text with the buttons', async () => {
    render(<Harness />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    await userEvent.type(box, 'hello')
    box.setSelectionRange(0, 5)
    await userEvent.click(screen.getByRole('button', { name: 'Gras' }))
    expect(screen.getByTestId('out')).toHaveTextContent('**hello**')
  })

  it('adds a code block with the editor and removes it again', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('textbox'), 'Mon souci')
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter du code' }))
    await userEvent.type(screen.getByLabelText('code'), 'print(1)')
    expect(screen.getByTestId('out').textContent).toBe('Mon souci\n\n```python\nprint(1)\n```')
    await userEvent.click(screen.getByRole('button', { name: 'Retirer ce code' }))
    expect(screen.getByTestId('out').textContent).toBe('Mon souci')
    expect(screen.queryByLabelText('code')).toBeNull()
  })

  it('turns an uploaded code file into a code block, and refuses a file that is too big', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('Téléverser un fichier de code', { selector: 'input' })
    await userEvent.upload(input, new File(['print(2)'], 'main.py', { type: 'text/plain' }))
    expect(await screen.findByTestId('out')).toHaveTextContent('**main.py**')
    expect(screen.getByTestId('out').textContent).toContain('```python\nprint(2)\n```')
    const big = new File(['x'], 'big.py')
    Object.defineProperty(big, 'size', { value: 200_000 })
    await userEvent.upload(input, big)
    expect(await screen.findByText('Ce fichier est trop gros (100 Ko au plus).')).toBeInTheDocument()
  })

  it('shows a preview and warns when the text is too long', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByRole('textbox'), 'a **b**')
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }))
    expect(screen.getByText('b').tagName).toBe('STRONG')
  })
})
