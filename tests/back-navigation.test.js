import test from 'node:test'
import assert from 'node:assert/strict'

// Historial simulado: back/go disparan popstate de forma asíncrona, como el navegador.
function setup() {
  const listeners = []
  const target = { addEventListener: (_, listener) => listeners.push(listener) }
  const stack = [null]
  let position = 0
  const pop = () => setTimeout(() => listeners.forEach((listener) => listener({ state: stack[position] })))
  const history = {
    replaceState: (state) => { stack[position] = state },
    pushState: (state) => { stack.length = position + 1; stack.push(state); position += 1 },
    back: () => { if (position > 0) { position -= 1; pop() } },
    go: (delta) => { position = Math.max(0, Math.min(stack.length - 1, position + delta)); pop() },
  }
  let observerCallback = () => {}
  globalThis.MutationObserver = class {
    constructor(callback) { observerCallback = callback }
    observe() {}
  }
  globalThis.document = { body: {} }
  return { history, target, classesChanged: () => observerCallback() }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

async function createNavigation() {
  const env = setup()
  const { createBackNavigation } = await import('../src/back-navigation.js')
  const opened = []
  const panel = { open: false }
  const navigation = createBackNavigation({
    layers: [{ isOpen: () => panel.open, close: () => { panel.open = false } }],
    openDocument: (path) => { opened.push(path); navigation.documentOpened(path) },
    history: env.history,
    target: env.target,
  })
  const setPanel = (open) => { panel.open = open; env.classesChanged() }
  return { ...env, navigation, opened, panel, setPanel }
}

test('atrás cierra la capa abierta y después vuelve al documento anterior', async () => {
  const { history, navigation, opened, panel, setPanel } = await createNavigation()
  navigation.documentOpened('/a.md')
  navigation.documentOpened('/b.md')
  setPanel(true)

  history.back()
  await settle()
  assert.equal(panel.open, false)
  assert.deepEqual(opened, [])

  history.back()
  await settle()
  assert.deepEqual(opened, ['/a.md'])

  history.back()
  await settle()
  assert.deepEqual(opened, ['/a.md', null])
})

test('una capa cerrada con su propio botón no deja un atrás vacío', async () => {
  const { history, navigation, opened, setPanel } = await createNavigation()
  navigation.documentOpened('/a.md')
  navigation.documentOpened('/b.md')
  setPanel(true)
  setPanel(false)

  history.back()
  await settle()
  assert.deepEqual(opened, ['/a.md'])
})

test('abrir otra vez el mismo documento no añade entradas', async () => {
  const { history, navigation, opened } = await createNavigation()
  navigation.documentOpened('/a.md')
  navigation.documentOpened('/a.md')
  history.back()
  await settle()
  assert.deepEqual(opened, [null])
})
