// After the build: writes the four legal pages as plain HTML files into dist/.
// The app is a single-page app, so a visitor that does not run JavaScript (Google's checker,
// search engines, link previews) would otherwise see an empty page. These files hold the full text.
// The in-app pages stay as they are; only a direct visit or a refresh gets the static file.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { transform } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = await readFile(path.join(root, 'src/i18n/legal.ts'), 'utf8')
const { code } = await transform(src, { loader: 'ts', format: 'esm' })
const { legal } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

const PAGES = [
  { key: 'privacy', dir: 'confidentialite' },
  { key: 'terms', dir: 'conditions' },
  { key: 'rules', dir: 'regles' },
  { key: 'jobs', dir: 'regles-offres' },
]
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function article(lang, doc, set) {
  return `<article lang="${lang}" id="${lang}">
<h1>${esc(doc.title)}</h1>
<p class="muted">${esc(set.updated)}</p>
<p>${esc(doc.intro)}</p>
${doc.sections.map((s) => `<h2>${esc(s.h)}</h2>\n${s.p.map((t) => `<p>${esc(t)}</p>`).join('\n')}`).join('\n')}
</article>`
}

function page(page) {
  const fr = legal.fr.docs[page.key]
  const en = legal.en.docs[page.key]
  const nav = PAGES.map((p) => `<a href="/${p.dir}/"${p.key === page.key ? ' aria-current="page"' : ''}>${esc(legal.fr.docs[p.key].title)} / ${esc(legal.en.docs[p.key].title)}</a>`).join('\n')
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fr.title)} / ${esc(en.title)} - jaajef.tech</title>
<meta name="description" content="${esc(fr.intro)}">
<style>
body{margin:0;background:#0d1530;color:#e8ecf7;font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
a{color:#5bb6f0}
nav{display:flex;flex-wrap:wrap;gap:8px 18px;margin:12px 0 28px}
h1{font-size:1.8rem;margin:24px 0 8px}
h2{font-size:1.15rem;margin:28px 0 6px}
.muted{opacity:.7;font-size:.9rem}
article+article{margin-top:56px;padding-top:24px;border-top:1px solid #2a3558}
</style>
</head>
<body>
<main>
<p><a href="/">jaajef.tech</a> - <a href="#fr">Français</a> | <a href="#en">English</a></p>
<nav aria-label="Legal">
${nav}
</nav>
${article('fr', fr, legal.fr)}
${article('en', en, legal.en)}
</main>
</body>
</html>
`
}

for (const p of PAGES) {
  const html = page(p)
  const fr = legal.fr.docs[p.key]
  if (fr.sections.length === 0 || !html.includes(esc(fr.sections[0].h))) throw new Error('empty legal page: ' + p.key)
  const dir = path.join(root, 'dist', p.dir)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), html)
  console.log('wrote dist/' + p.dir + '/index.html')
}
