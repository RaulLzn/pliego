import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRenderer } from '../src/platform/render-wasm.js'
import { INBOX_ROOT, createWebBackend, sanitizeStem } from '../src/platform/web-backend.js'
import { LIBRARY_ROOT, createMemoryStore, createWebFs, normalizePath } from '../src/platform/web-fs.js'

const WASM = 'src/platform/generated/pliego-render.wasm'
const decode = (bytes) => new TextDecoder().decode(bytes)

// Renderizador mínimo para probar el backend sin depender del WASM compilado.
const fakeRenderer = {
  render: (markdown) => `<p>${markdown}</p>`,
  renderWithContext: (markdown) => `<p>${markdown}</p>`,
  title: (path) => path,
  references: (markdown) => Array.from(markdown.matchAll(/\[\[([^\]|#]+)/g), (match) => match[1]),
  pageName: (title) => ({ heading: title, fileName: `${title}.md` }),
}

function setup(renderer = fakeRenderer) {
  const values = new Map()
  const fs = createWebFs(createMemoryStore(), { now: () => 1000 })
  const settings = { get: (key) => values.get(key), set: (key, value) => values.set(key, value) }
  const picked = new Map()
  const backend = createWebBackend({ fs, renderer, settings, picked, clipboard: async () => 'del portapapeles', now: () => new Date(2026, 10, 3, 9, 5, 7) })
  return { fs, backend, picked, invoke: backend.invoke }
}

test('normaliza rutas y no deja escribir fuera de la biblioteca', async () => {
  const { fs } = setup()
  assert.equal(normalizePath('/Pliego/a/../b//c.md'), '/Pliego/b/c.md')
  await assert.rejects(fs.writeBytes('/Pliego/../otra/x.md', 'x'), /fuera de la biblioteca/)
})

test('el árbol imita a list_markdown_tree: carpetas primero y sin vacías ni ocultas', async () => {
  const { fs, invoke } = setup()
  await fs.writeBytes(`${LIBRARY_ROOT}/b.md`, '# B')
  await fs.writeBytes(`${LIBRARY_ROOT}/a.zip`, 'x')
  await fs.writeBytes(`${LIBRARY_ROOT}/Notas/c.pdf`, 'pdf')
  await fs.writeBytes(`${LIBRARY_ROOT}/.oculta/d.md`, 'd')
  await fs.mkdir(`${LIBRARY_ROOT}/Vacia`)
  const tree = await invoke('list_markdown_tree', { dir: LIBRARY_ROOT })
  assert.deepEqual(tree.map((node) => [node.name, node.isDir]), [['Notas', true], ['b.md', false]])
  assert.equal(tree[0].children[0].path, `${LIBRARY_ROOT}/Notas/c.pdf`)
  await assert.rejects(invoke('list_markdown_tree', { dir: '/Pliego/no-existe' }))
})

test('el índice incluye texto buscable y referencias de Markdown', async () => {
  const { fs, invoke } = setup()
  await fs.writeBytes(`${LIBRARY_ROOT}/home.md`, '# Inicio\n[[notas/destino]]')
  await fs.writeBytes(`${LIBRARY_ROOT}/datos.csv`, 'a,b')
  const index = await invoke('list_document_index', { dir: LIBRARY_ROOT })
  assert.deepEqual(index.map((entry) => entry.kind), ['table', 'markdown'])
  assert.deepEqual(index[1].references, ['notas/destino'])
  assert.equal(index[0].searchableText, 'a,b')
})

test('crear, guardar y leer páginas', async () => {
  const { fs, invoke } = setup()
  await fs.mkdir(LIBRARY_ROOT)
  const created = await invoke('create_markdown_file', { folder: LIBRARY_ROOT, title: 'Ideas' })
  assert.deepEqual(created, { fileName: 'Ideas.md', path: `${LIBRARY_ROOT}/Ideas.md` })
  await assert.rejects(invoke('create_markdown_file', { folder: LIBRARY_ROOT, title: 'Ideas' }), /Ya existe/)
  await invoke('save_markdown_file', { path: created.path, contents: 'hola' })
  const payload = await invoke('read_markdown_file', { path: created.path, folder: LIBRARY_ROOT })
  assert.equal(payload.contents, 'hola')
  const binary = await invoke('read_binary_document', { path: created.path })
  assert.equal(atob(binary.base64), 'hola')
})

test('los archivos elegidos se importan a la biblioteca sin pisar otros', async () => {
  const { fs, backend, picked } = setup()
  await fs.writeBytes(`${LIBRARY_ROOT}/Importados/doc.md`, 'viejo')
  picked.set('/.picked/1/doc.md', { name: 'doc.md', bytes: new TextEncoder().encode('nuevo') })
  const path = await backend.importPicked('/.picked/1/doc.md')
  assert.equal(path, `${LIBRARY_ROOT}/Importados/doc-1.md`)
  assert.equal(decode(await fs.readBytes(path)), 'nuevo')
  assert.equal(picked.size, 0)
})

test('el Inbox captura, renombra, archiva, mueve y borra como inbox.rs', async () => {
  const { fs, invoke, picked } = setup()
  assert.equal((await invoke('inbox_get_config')).folder, INBOX_ROOT)
  const url = await invoke('inbox_capture_url', { url: 'https://example.com', title: null })
  assert.equal(url.name, '2026-11-03-090507-enlace.md')
  await assert.rejects(invoke('inbox_capture_url', { url: 'ftp://x' }), /http/)
  await invoke('inbox_capture_clipboard', { title: 'Idea' })
  picked.set('/.picked/2/foto.png', { name: 'foto.png', bytes: new Uint8Array([1, 2]) })
  await invoke('inbox_import_files', { paths: ['/.picked/2/foto.png'] })
  assert.equal((await invoke('inbox_list')).length, 3)

  const preview = await invoke('inbox_read_preview', { name: url.name })
  assert.match(preview.contents, /Fuente: \[https:\/\/example.com\]/)
  assert.equal((await invoke('inbox_read_preview', { name: 'foto.png' })).contents, null)

  await assert.rejects(invoke('inbox_rename', { name: url.name, newName: '../fuera.md' }), /rutas/)
  const renamed = await invoke('inbox_rename', { name: url.name, newName: 'enlace.md' })
  await invoke('inbox_archive', { name: renamed.name })
  assert.ok(await fs.stat(`${INBOX_ROOT}/.archive/enlace.md`))
  await fs.mkdir(`${LIBRARY_ROOT}/Fotos`)
  const moved = await invoke('inbox_move', { name: 'foto.png', destinationFolder: `${LIBRARY_ROOT}/Fotos` })
  assert.equal(moved.path, `${LIBRARY_ROOT}/Fotos/foto.png`)
  const [remaining] = await invoke('inbox_list')
  await invoke('inbox_delete', { name: remaining.name })
  assert.deepEqual(await invoke('inbox_list'), [])
})

test('sanitizeStem sigue la regla de inbox.rs', () => {
  assert.equal(sanitizeStem('  Hola, mundo!! ñ '), 'Hola-mundo-ñ')
  assert.equal(sanitizeStem('***'), 'captura')
})

test('los comandos de escritorio fallan con un mensaje claro', async () => {
  const { invoke } = setup()
  await assert.rejects(invoke('codex_status'), /no disponible en la versión web/)
  await assert.rejects(invoke('inbox_set_shortcut', { shortcut: 'x' }), /atajos/)
})

test('el WASM renderiza igual que el escritorio y resuelve [[enlaces]]', { skip: !existsSync(WASM) && 'ejecuta npm run build:wasm' }, async () => {
  const renderer = await createRenderer(readFileSync(WASM))
  assert.equal(renderer.render('---\na: 1\n---\n~~x~~'), '<p><del>x</del></p>\n')
  assert.deepEqual(renderer.references('[[a]] [b](c.md) [[a|otra]]'), ['a', 'c'])
  assert.deepEqual(renderer.pageName('Plan.md'), { heading: 'Plan', fileName: 'Plan.md' })
  assert.throws(() => renderer.pageName('a/b'), /no permitidos/)

  const { fs, invoke } = setup(renderer)
  await fs.writeBytes(`${LIBRARY_ROOT}/notas/actual.md`, 'Ver [[destino]] y [[falta]]')
  await fs.writeBytes(`${LIBRARY_ROOT}/notas/destino.md`, '# Destino real')
  const payload = await invoke('read_markdown_file', { path: `${LIBRARY_ROOT}/notas/actual.md`, folder: LIBRARY_ROOT })
  assert.match(payload.html, /<a href="\/Pliego\/notas\/destino.md">Destino real<\/a>/)
  assert.match(payload.html, /\[\[falta\]\]/)
})

test('un .zip se importa con su estructura y se abre su primer Markdown', async () => {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('Articulo/articulo.md', '# Artículo\n\n![Figura](figs/uno.png)')
  zip.file('Articulo/figs/uno.png', new Uint8Array([137, 80]))
  zip.file('__MACOSX/Articulo/._articulo.md', 'basura')
  const { fs, backend, picked } = setup()
  picked.set('/.picked/1/Articulo.zip', { name: 'Articulo.zip', bytes: await zip.generateAsync({ type: 'uint8array' }) })
  const path = await backend.importPicked('/.picked/1/Articulo.zip')
  assert.equal(path, `${LIBRARY_ROOT}/Importados/Articulo/Articulo/articulo.md`)
  assert.ok(await fs.stat(`${LIBRARY_ROOT}/Importados/Articulo/Articulo/figs/uno.png`))
  assert.equal(await fs.stat(`${LIBRARY_ROOT}/Importados/Articulo/__MACOSX`), null)
})

test('una imagen que falta en su ruta se busca por nombre en la biblioteca', async () => {
  const { fs, invoke } = setup()
  await fs.writeBytes(`${LIBRARY_ROOT}/Importados/articulo.md`, '![x](figs/fig-marco.png)')
  await fs.writeBytes(`${LIBRARY_ROOT}/Otros/fig-marco.png`, new Uint8Array([1]))
  await fs.writeBytes(`${LIBRARY_ROOT}/Importados/figs/fig-marco.png`.replace('/figs', '/fotos/figs'), new Uint8Array([2]))
  const payload = await invoke('read_binary_document', { path: `${LIBRARY_ROOT}/Importados/figs/fig-marco.png` })
  assert.equal(payload.fileName, 'fig-marco.png')
  assert.equal(payload.base64, btoa(String.fromCharCode(2)))
  await assert.rejects(invoke('read_binary_document', { path: `${LIBRARY_ROOT}/no-existe.png` }))
})
