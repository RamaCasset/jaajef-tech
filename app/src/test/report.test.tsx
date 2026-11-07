import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reportContent = vi.fn()
vi.mock('../lib/api', () => ({ reportContent: (...a: unknown[]) => reportContent(...a) }))

import { ReportButton } from '../components/ReportButton'

beforeEach(() => {
  reportContent.mockReset()
  reportContent.mockResolvedValue('r1')
})

describe('Report button', () => {
  it('opens a form, cannot be sent without a reason', async () => {
    const user = userEvent.setup()
    render(<ReportButton type="message" id={42} />)
    await user.click(screen.getByText('Signaler'))
    expect(screen.getByText('Envoyer le signalement')).toBeDisabled()
    await user.click(screen.getByLabelText('Spam'))
    expect(screen.getByText('Envoyer le signalement')).toBeEnabled()
  })

  it('sends the target, the reason and the note, then thanks the member', async () => {
    const user = userEvent.setup()
    render(<ReportButton type="direct_message" id={7} />)
    await user.click(screen.getByText('Signaler'))
    await user.click(screen.getByLabelText('Harcèlement'))
    await user.type(screen.getByLabelText(/Précisions/), 'Il insiste')
    await user.click(screen.getByText('Envoyer le signalement'))
    await waitFor(() => expect(reportContent).toHaveBeenCalledWith('direct_message', '7', 'harassment', 'Il insiste'))
    expect(await screen.findByText('Merci, votre signalement a été envoyé.')).toBeInTheDocument()
    expect(screen.queryByText('Signaler')).not.toBeInTheDocument()
  })

  it('turns the target id into text for the database', async () => {
    const user = userEvent.setup()
    render(<ReportButton type="member" id="0b1c-uuid" />)
    await user.click(screen.getByText('Signaler'))
    await user.click(screen.getByLabelText('Arnaque'))
    await user.click(screen.getByText('Envoyer le signalement'))
    await waitFor(() => expect(reportContent).toHaveBeenCalledWith('member', '0b1c-uuid', 'scam', ''))
  })

  it('cancel closes the form and sends nothing', async () => {
    const user = userEvent.setup()
    render(<ReportButton type="project" id="p1" />)
    await user.click(screen.getByText('Signaler'))
    await user.click(screen.getByText('Annuler'))
    expect(screen.getByText('Signaler')).toBeInTheDocument()
    expect(reportContent).not.toHaveBeenCalled()
  })

  it('shows a friendly message and keeps the form when the database refuses', async () => {
    reportContent.mockRejectedValue(new Error('You already reported this'))
    const user = userEvent.setup()
    render(<ReportButton type="message" id={1} />)
    await user.click(screen.getByText('Signaler'))
    await user.click(screen.getByLabelText('Spam'))
    await user.click(screen.getByText('Envoyer le signalement'))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà signalé')
    expect(screen.getByText('Envoyer le signalement')).toBeInTheDocument()
  })

  it('does not say thank you when sending failed', async () => {
    reportContent.mockRejectedValue(new Error('Slow down: too many reports today'))
    const user = userEvent.setup()
    render(<ReportButton type="message" id={1} />)
    await user.click(screen.getByText('Signaler'))
    await user.click(screen.getByLabelText('Spam'))
    await user.click(screen.getByText('Envoyer le signalement'))
    await screen.findByRole('alert')
    expect(screen.queryByText('Merci, votre signalement a été envoyé.')).not.toBeInTheDocument()
  })
})
