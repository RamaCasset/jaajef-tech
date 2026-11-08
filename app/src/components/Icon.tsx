const PATHS: Record<string, string> = {
  blog: 'M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4Zm3 4h7M8 12h7M8 16h4',
  messages: 'M4 5h16v11H9l-5 4V5Z',
  communities: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 1a2.5 2.5 0 1 0 0-5M3 19c0-3 3-5 6-5s6 2 6 5M16 14c3 0 5 1.6 5 4',
  arena: 'M7 4h10v4a5 5 0 0 1-10 0V4Zm5 9v4m-4 3h8M4 5h3m10 0h3',
  jobs: 'M4 8h16v11H4V8Zm5 0V5h6v3M4 13h16',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4',
  quest: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2',
  repo: 'M5 5a2 2 0 0 1 2-2h11v15H7a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h11M9 7h5',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4m-6-10-2 12',
  note: 'M10 18V6l8-2v12M10 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm8-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  anvil: 'M4 6h13a3 3 0 0 1-3 4h-2l1 3h3v3H7v-3h3l1-3H8a4 4 0 0 1-4-4Z',
  pen: 'm4 20 1-4L16 5l3 3L8 19l-4 1Zm9-12 3 3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  chart: 'M4 20V9m6 11V4m6 16v-8m5 8H3',
  shield: 'M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z',
  terminal: 'M4 5h16v14H4V5Zm4 4 3 3-3 3m5 0h4',
  back: 'M19 12H5m6-6-6 6 6 6',
  forward: 'M5 12h14m-6-6 6 6-6 6',
  save: 'M5 4h11l3 3v13H5V4Zm3 0v5h7V4M8 20v-6h8v6',
  trash: 'M5 7h14M10 11v6m4-6v6M9 7l1-3h4l1 3M7 7l1 13h8l1-13',
  panel: 'M4 6h16M4 12h16M4 18h16',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
  file: 'M7 3h7l5 5v13H7V3Zm7 0v5h5',
  souk: 'M4 9 5.5 4h13L20 9M4 9h16M4 9v1a2.5 2.5 0 0 0 4 2 2.5 2.5 0 0 0 4 0 2.5 2.5 0 0 0 4 0 2.5 2.5 0 0 0 4-2V9M5 13v7h14v-7M10 20v-4h4v4',
  plus: 'M12 5v14M5 12h14',
  play: 'M8 5v14l11-7L8 5Z',
  fork: 'M7 5.5a1.5 1.5 0 1 0 0 .01M17 5.5a1.5 1.5 0 1 0 0 .01M12 18.5a1.5 1.5 0 1 0 0 .01M7 7v1a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7M12 11v6',
  star: 'm12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3Z',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm5-2 4 4',
}

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
