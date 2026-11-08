import { lazy, Suspense } from 'react'

// Monaco is the editor that powers VS Code. It is large, so it loads only when the editor page opens.
const Monaco = lazy(() => import('@monaco-editor/react'))

const LANGUAGES: Record<string, string> = {
  py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown',
  html: 'html', css: 'css', dart: 'dart', java: 'java', c: 'c', cpp: 'cpp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
  sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql', xml: 'xml', kt: 'kotlin', swift: 'swift', txt: 'plaintext',
}
export const languageOf = (path: string) => LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'

export function CodeEditor({ path, value, onChange, readOnly = false }: { path: string; value: string; onChange: (value: string) => void; readOnly?: boolean }) {
  return (
    <Suspense fallback={<p className="muted">…</p>}>
      <Monaco
        height="max(460px, calc(100vh - 320px))"
        path={path}
        language={languageOf(path)}
        value={value}
        theme="vs-dark"
        onChange={(v) => onChange(v ?? '')}
        options={{ readOnly, minimap: { enabled: false }, fontSize: 14, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true }}
      />
    </Suspense>
  )
}
