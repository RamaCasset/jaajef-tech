import '@testing-library/jest-dom/vitest'

// Monaco needs a real browser; screens that use the editor mock it, and its setup file is never loaded in tests.
import { vi } from 'vitest'
vi.mock('../components/monacoSetup', () => ({}))
