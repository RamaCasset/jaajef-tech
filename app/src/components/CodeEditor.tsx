import { lazy, Suspense } from 'react'

// Monaco is the editor that powers VS Code. It is large, so it loads only when the editor page opens,
// and it comes from this site (see monacoSetup), never from an outside server.
const Monaco = lazy(async () => { await import('./monacoSetup'); return import('@monaco-editor/react') })

const LANGUAGES: Record<string, string> = {
  py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown',
  html: 'html', css: 'css', dart: 'dart', java: 'java', c: 'c', cpp: 'cpp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
  sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', xml: 'xml', kt: 'kotlin', swift: 'swift', txt: 'plaintext',
}
export const languageOf = (path: string) => LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'

// The editor follows the app colours, so a Souk theme changes it too. Monaco needs plain #rrggbb colours.
const THEME = 'jaajef'
function appColour(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback
  } catch { return fallback }
}
/** Mixes a #rrggbb colour with black (amount 0 to 1 of black). */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount)).toString(16).padStart(2, '0')
  return `#${f(16)}${f(8)}${f(0)}`
}
const defineTheme = (monaco: { editor: { defineTheme: (name: string, theme: unknown) => void } }) => {
  const bg = appColour('--bg', '#080e1c')
  const panel = appColour('--panel', '#0c1730')
  const raised = appColour('--panel-raised', '#10203f')
  const deep = darken(bg, 0.38)
  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': deep,
      'editorGutter.background': deep,
      'editor.lineHighlightBackground': raised,
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#4b5a78',
      'editorLineNumber.activeForeground': '#9fb0cf',
      'editorWidget.background': panel,
      'scrollbarSlider.background': '#ffffff18',
      'scrollbarSlider.hoverBackground': '#ffffff28',
    },
  })
}

export function CodeEditor({ path, value, onChange, readOnly = false, height = 'max(460px, calc(100vh - 320px))', onCursor }: { path: string; value: string; onChange: (value: string) => void; readOnly?: boolean; height?: string; onCursor?: (line: number, column: number) => void }) {
  return (
    <Suspense fallback={<p className="muted">…</p>}>
      <Monaco
        height={height}
        path={path}
        language={languageOf(path)}
        value={value}
        theme={THEME}
        beforeMount={defineTheme}
        onMount={(editor) => { if (onCursor) editor.onDidChangeCursorPosition((e) => onCursor(e.position.lineNumber, e.position.column)) }}
        onChange={(v) => onChange(v ?? '')}
        options={{ readOnly, minimap: { enabled: false }, fontSize: 14, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true }}
      />
    </Suspense>
  )
}
