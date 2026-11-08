const PATHS: Record<string, string> = {
  blog: 'M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4Zm3 4h7M8 12h7M8 16h4',
  messages: 'M4 5h16v11H9l-5 4V5Z',
  communities: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 1a2.5 2.5 0 1 0 0-5M3 19c0-3 3-5 6-5s6 2 6 5M16 14c3 0 5 1.6 5 4',
  arena: 'M7 4h10v4a5 5 0 0 1-10 0V4Zm5 9v4m-4 3h8M4 5h3m10 0h3',
  jobs: 'M4 8h16v11H4V8Zm5 0V5h6v3M4 13h16',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 4 4',
}

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
