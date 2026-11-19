import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyNote, dailyTemplatePath, fillTemplate, templatesInLibrary } from '../src/note-templates.js'
import { imageExtension, pastedImageName, pastedImageTarget, relativeImageSource } from '../src/pasted-images.js'
import { createWebBackend, subfolderParts } from '../src/platform/web-backend.js'
import { LIBRARY_ROOT, createMemoryStore, createWebFs } from '../src/platform/web-fs.js'

const date = new Date(2026, 10, 3, 9, 5, 7)

test('rellena las variables de plantilla en español e inglés', () => {
  const text = '# {{titulo}}\n{{ title }} · {{fecha}} {{date}} {{hora}} {{time}} {{TÍTULO}} {{otra}}'
  assert.equal(fillTemplate(text, { title: 'Plan', date }), '# Plan\nPlan · 2026-11-03 2026-11-03 09:05 09:05 Plan {{otra}}')
  assert.deepEqual(dailyNote(date), { title: '2026-11-03', subfolder: 'Diario' })
})

test('las plantillas son los .md directos de Plantillas/', () => {
  const index = [
    { name: 'Reunión.md', path: '/lib/Plantillas/Reunión.md', kind: 'markdown' },
    { name: 'Diario.md', path: '/lib/Plantillas/Diario.md', kind: 'markdown' },
    { name: 'otra.md', path: '/lib/Plantillas/sub/otra.md', kind: 'markdown' },
    { name: 'datos.csv', path: '/lib/Plantillas/datos.csv', kind: 'table' },
    { name: 'nota.md', path: '/lib/nota.md', kind: 'markdown' },
    { name: 'x.md', path: '/lib/PlantillasX/x.md', kind: 'markdown' },
  ]
  assert.deepEqual(templatesInLibrary(index, '/lib/').map((item) => item.name), ['Diario', 'Reunión'])
  assert.equal(dailyTemplatePath(index, '/lib'), '/lib/Plantillas/Diario.md')
  assert.equal(dailyTemplatePath(index.slice(0, 1), '/lib'), null)
  const windows = [{ name: 'A.md', path: 'C:\\lib\\Plantillas\\A.md', kind: 'markdown' }]
  assert.deepEqual(templatesInLibrary(windows, 'C:\\lib'), [{ name: 'A', path: 'C:\\lib\\Plantillas\\A.md' }])
})

test('nombra y ubica las imágenes pegadas junto al documento', () => {
  assert.equal(pastedImageName(date, 'png'), 'pegado-20261103-090507.png')
  assert.equal(pastedImageTarget('/lib/notas/a.md', 'x.png'), '/lib/notas/assets/x.png')
  assert.equal(pastedImageTarget('C:\\lib\\a.md', 'x.png'), 'C:\\lib\\assets\\x.png')
  assert.equal(relativeImageSource('/lib/notas/a.md', '/lib/notas/assets/x-1.png'), 'assets/x-1.png')
  assert.equal(relativeImageSource('C:\\lib\\a.md', 'C:\\lib\\assets\\x.png'), 'assets/x.png')
  assert.equal(imageExtension({ type: 'image/jpeg' }), 'jpg')
  assert.equal(imageExtension({ type: '', name: 'foto.WEBP' }), 'webp')
  assert.equal(imageExtension({ type: 'image/svg+xml', name: 'a.svg' }), '')
})

function setup() {
  const fs = createWebFs(createMemoryStore(), { now: () => 1000 })
  const renderer = { pageName: (title) => ({ heading: title, fileName: `${title}.md` }) }
  const backend = createWebBackend({ fs, renderer, settings: { get: () => undefined, set: () => {} } })
  return { fs, invoke: backend.invoke }
}

test('web: create_markdown_file admite contenido, subcarpeta y existingOk', async () => {
  const { fs, invoke } = setup()
  await fs.mkdir(LIBRARY_ROOT)
  const options = { folder: LIBRARY_ROOT, title: '2026-11-03', subfolder: 'Diario', contents: 'hoy', existingOk: true }
  const created = await invoke('create_markdown_file', options)
  assert.deepEqual(created, { fileName: '2026-11-03.md', path: `${LIBRARY_ROOT}/Diario/2026-11-03.md`, created: true })
  await fs.writeBytes(created.path, 'editada')
  assert.equal((await invoke('create_markdown_file', options)).created, false)
  assert.equal(new TextDecoder().decode(await fs.readBytes(created.path)), 'editada')
  await assert.rejects(invoke('create_markdown_file', { ...options, existingOk: false }), /Ya existe/)
  for (const bad of ['../fuera', '/abs', '.oculta', 'a/../../b', 'a:b']) {
    await assert.rejects(invoke('create_markdown_file', { ...options, subfolder: bad }), /subcarpeta/, bad)
  }
  assert.deepEqual(subfolderParts('Diario/2026'), ['Diario', '2026'])
})

test('web: save_binary_file guarda imágenes sin pisar y solo dentro de la raíz', async () => {
  const { fs, invoke } = setup()
  const root = `${LIBRARY_ROOT}/Notas`
  await fs.mkdir(root)
  const args = { path: `${root}/assets/pegado.png`, base64: btoa('png'), root }
  assert.equal(await invoke('save_binary_file', args), `${root}/assets/pegado.png`)
  assert.equal(await invoke('save_binary_file', args), `${root}/assets/pegado-1.png`)
  assert.equal(new TextDecoder().decode(await fs.readBytes(`${root}/assets/pegado.png`)), 'png')
  await assert.rejects(invoke('save_binary_file', { ...args, path: `${root}/../../fuera.png` }), /no es válida/)
  await assert.rejects(invoke('save_binary_file', { ...args, path: `${LIBRARY_ROOT}/Otra/x.png` }), /no es válida/)
  await assert.rejects(invoke('save_binary_file', { ...args, path: `${root}/x.svg` }), /Solo se pueden/)
  await assert.rejects(invoke('save_binary_file', { ...args, base64: '%%%' }), /formato/)
})
