import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ChatBody } from '../components/ChatBody'

const show = (text: string) => render(<MemoryRouter><ChatBody text={text} /></MemoryRouter>)

describe('ChatBody', () => {
  it('shows text as plain text and turns @names into profile links', () => {
    show('Salut @Awa_D <b>ok</b>')
    expect(screen.getByRole('link', { name: '@Awa_D' })).toHaveAttribute('href', '/profil/awa_d')
    expect(document.querySelector('b')).toBeNull()
  })

  it('puts what is between three backticks in a code box with its language', () => {
    const { container } = show('Voici :\n```python\nprint(1)\n```\nFini')
    expect(screen.getByText('python')).toBeInTheDocument()
    expect(container.querySelector('pre code')?.textContent).toBe('print(1)')
    expect(screen.getByText('Voici :')).toBeInTheDocument()
    expect(screen.getByText('Fini')).toBeInTheDocument()
  })

  it('does not run anything inside a code box', () => {
    const { container } = show('```\n<script>alert(1)</script>\n```')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('<script>alert(1)</script>')
  })
})
