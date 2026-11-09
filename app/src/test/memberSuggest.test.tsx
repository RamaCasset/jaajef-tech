import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ searchEverything: vi.fn() }))
vi.mock('../lib/api', () => api)

import { MemberSuggest } from '../components/MemberSuggest'

const hit = (username: string, name: string, kind = 'member') => ({ kind, pos: 1, id: username, slug: username, title: name, subtitle: `@${username}`, image_url: null })

function Box({ exclude = [] as string[] }) {
  const [v, setV] = useState('')
  return (<><label htmlFor="who">Qui</label><MemberSuggest id="who" value={v} onChange={setV} exclude={exclude} /><p data-testid="value">{v}</p></>)
}

beforeEach(() => {
  api.searchEverything.mockReset()
  api.searchEverything.mockResolvedValue([hit('awa_dev', 'Awa Diallo'), hit('awa_k', 'Awa Kane'), hit('projet_awa', 'Projet Awa', 'project'), hit('moi', 'Moi')])
})

describe('MemberSuggest', () => {
  it('suggests members after two letters, and only members', async () => {
    render(<Box />)
    await userEvent.type(screen.getByLabelText('Qui'), 'a')
    expect(api.searchEverything).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Qui'), 'w')
    const list = await screen.findByRole('listbox', { name: 'Membres suggérés' })
    expect(await screen.findAllByRole('option')).toHaveLength(3)
    expect(list).toHaveTextContent('Awa Diallo')
    expect(screen.queryByText('Projet Awa')).toBeNull()
    expect(api.searchEverything).toHaveBeenCalledWith('aw')
  })

  it('a click fills in the username and closes the list', async () => {
    render(<Box />)
    await userEvent.type(screen.getByLabelText('Qui'), 'awa')
    await userEvent.click(await screen.findByRole('option', { name: /Awa Kane/ }))
    expect(screen.getByTestId('value')).toHaveTextContent('awa_k')
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull())
  })

  it('arrow keys and Enter choose a member', async () => {
    render(<Box />)
    await userEvent.type(screen.getByLabelText('Qui'), 'awa')
    await screen.findAllByRole('option')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('awa_k')
  })

  it('leaves out people who are already in the team', async () => {
    render(<Box exclude={['awa_dev', 'Moi']} />)
    await userEvent.type(screen.getByLabelText('Qui'), 'awa')
    expect(await screen.findAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('Awa Kane')
  })

  it('an at sign is ignored, and a failed search just shows nothing', async () => {
    api.searchEverything.mockRejectedValue(new Error('down'))
    render(<Box />)
    await userEvent.type(screen.getByLabelText('Qui'), '@aw')
    await waitFor(() => expect(api.searchEverything).toHaveBeenCalledWith('aw'))
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByTestId('value')).toHaveTextContent('@aw')
  })
})
