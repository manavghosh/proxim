import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'

describe('Button isLoading', () => {
  it('renders a spinner when isLoading is true', () => {
    const { getByTestId } = render(<Button isLoading>Save</Button>)
    const spinner = getByTestId('loading-spinner')
    expect(spinner).toBeInTheDocument()
    expect(spinner.classList.toString()).toContain('animate-spin')
  })

  it('is disabled when isLoading is true', () => {
    render(<Button isLoading>Save</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is not disabled and has no spinner when isLoading is false', () => {
    const { queryByTestId } = render(<Button isLoading={false}>Save</Button>)
    expect(screen.getByRole('button')).not.toBeDisabled()
    expect(queryByTestId('loading-spinner')).not.toBeInTheDocument()
  })

  it('still renders the label text beside the spinner', () => {
    render(<Button isLoading>Save CV</Button>)
    expect(screen.getByText('Save CV')).toBeInTheDocument()
  })
})
