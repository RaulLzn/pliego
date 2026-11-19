import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAFT_PREFIX, createDraftStore } from '../src/draft-store.js'

// Storage mínimo compatible con localStorage; `quota` limita el total de caracteres.
function memoryStorage({ quota = Infinity } = {}) {
  const values = new Map()
  const used = () => Array.from(values, ([key, value]) => key.length + value.length).reduce((a, b) => a + b, 0)
  return {
    get length() { return values.size },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      const previous = values.get(key)
      values.set(key, String(value))
      if (used() > quota) {
        if (previous === undefined) values.delete(key)
        else values.set(key, previous)
        const error = new Error('quota')
        error.name = 'QuotaExceededError'
        throw error
      }
    },
    removeItem: (key) => values.delete(key),
    values,
  }
}

function setup(options = {}) {
  let clock = 1000
  const storage = options.storage || memoryStorage()
  const store = createDraftStore({ storage, now: () => clock, ...options })
  return { store, storage, tick: (ms = 1) => { clock += ms } }
}

test('guarda, carga y borra un borrador por ruta con su fecha', () => {
  const { store } = setup()
  assert.equal(store.save('/lib/a.md', '# A editado'), true)
  assert.deepEqual(store.load('/lib/a.md'), { path: '/lib/a.md', markdown: '# A editado', savedAt: 1000 })
  assert.equal(store.load('/lib/b.md'), null)
  store.remove('/lib/a.md')
  assert.equal(store.load('/lib/a.md'), null)
})

test('solo ofrece borradores distintos del disco y limpia los idénticos', () => {
  const { store } = setup()
  store.save('/lib/a.md', 'borrador')
  assert.equal(store.pendingFor('/lib/a.md', 'disco').markdown, 'borrador')
  assert.equal(store.pendingFor('/lib/a.md', 'borrador'), null)
  assert.equal(store.load('/lib/a.md'), null)
})

test('conserva como mucho N borradores y descarta los más antiguos', () => {
  const { store, tick } = setup({ maxDrafts: 3 })
  for (const name of ['a', 'b', 'c', 'd']) {
    store.save(`/lib/${name}.md`, name)
    tick()
  }
  assert.deepEqual(store.list().map((draft) => draft.path), ['/lib/d.md', '/lib/c.md', '/lib/b.md'])
  // Reescribir uno existente lo vuelve el más reciente sin expulsar a nadie.
  store.save('/lib/b.md', 'b2')
  assert.deepEqual(store.list().map((draft) => draft.path), ['/lib/b.md', '/lib/d.md', '/lib/c.md'])
})

test('rechaza borradores demasiado grandes', () => {
  const { store } = setup({ maxChars: 10 })
  assert.equal(store.save('/lib/a.md', 'x'.repeat(11)), false)
  assert.equal(store.load('/lib/a.md'), null)
})

test('sin cuota sacrifica otros borradores y, si aún no cabe, no falla', () => {
  const storage = memoryStorage({ quota: 200 })
  storage.setItem('ajuste', 'valor')
  const { store, tick } = setup({ storage })
  store.save('/lib/viejo.md', 'v'.repeat(60))
  tick()
  assert.equal(store.save('/lib/nuevo.md', 'n'.repeat(80)), true)
  assert.equal(store.load('/lib/viejo.md'), null)
  assert.equal(store.load('/lib/nuevo.md').markdown.length, 80)
  assert.equal(storage.getItem('ajuste'), 'valor')
  assert.equal(store.save('/lib/enorme.md', 'e'.repeat(500)), false)
})

test('ignora entradas corruptas y un almacenamiento bloqueado', () => {
  const { store, storage } = setup()
  storage.setItem(`${DRAFT_PREFIX}/lib/roto.md`, '{no es json')
  assert.deepEqual(store.list(), [])
  assert.equal(storage.getItem(`${DRAFT_PREFIX}/lib/roto.md`), null)
  const blocked = createDraftStore({
    storage: { get length() { throw new Error('bloqueado') }, getItem() { throw new Error('bloqueado') }, setItem() { throw new Error('bloqueado') }, removeItem() { throw new Error('bloqueado') } },
  })
  assert.equal(blocked.save('/lib/a.md', 'x'), false)
  assert.equal(blocked.load('/lib/a.md'), null)
  assert.deepEqual(blocked.list(), [])
})
