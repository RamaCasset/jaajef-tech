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

// Same dark blue as the rest of the app instead of the default grey of the editor.
const THEME = 'jaajef'
const defineTheme = (monaco: { editor: { defineTheme: (name: string, theme: unknown) => void } }) => monaco.editor.defineTheme(THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0b1120',
    'editorGutter.background': '#0b1120',
    'editor.lineHighlightBackground': '#111a30',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#4b5a78',
    'editorLineNumber.activeForeground': '#9fb0cf',
    'editorWidget.background': '#0e1526',
    'scrollbarSlider.background': '#ffffff18',
    'scrollbarSlider.hoverBackground': '#ffffff28',
  },
})

export function CodeEditor({ path, value, onChange, readOnly = false, height = 'max(460px, calc(100vh - 320px))' }: { path: string; value: string; onChange: (value: string) => void; readOnly?: boolean; height?: string }) {
  return (
    <Suspense fallback={<p className="muted">…</p>}>
      <Monaco
        height={height}
        path={path}
        language={languageOf(path)}
        value={value}
        theme={THEME}
        beforeMount={defineTheme}
        onChange={(v) => onChange(v ?? '')}
        options={{ readOnly, minimap: { enabled: false }, fontSize: 14, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true }}
      />
    </Suspense>
  )
}
