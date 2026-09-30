import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createReadingSession,
  filterKnownMissingTabs,
  normalizeReadingSession,
  READING_SESSION_KEY,
  READING_SESSION_VERSION,
  selectStartupPlan,
} from '../src/reading-session.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  }
}

test('round trips ordered tabs, active document, scroll offset, and PDF page anchor', () => {
  const storage = memoryStorage()
  const session = createReadingSession({ storage, scheduleTimeout: null })
  session.load()
  session.setTabs([
    { path: '/library/book.pdf', name: 'book.pdf', kind: 'pdf' },
    { path: '/library/notes.md', name: 'notes.md', kind: 'markdown' },
  ], '/library/notes.md')
  session.rememberPosition('/library/book.pdf', { page: 3, offset: 0.42 })
  session.rememberPosition('/library/notes.md', { top: 734 })
  assert.equal(session.flush(), true)

  const restored = createReadingSession({ storage, scheduleTimeout: null })
  const snapshot = restored.load()
  assert.equal(snapshot.version, READING_SESSION_VERSION)
  assert.deepEqual(snapshot.tabs.map(({ path }) => path), ['/library/book.pdf', '/library/notes.md'])
  assert.equal(snapshot.activePath, '/library/notes.md')
  assert.deepEqual(restored.getPosition('/library/book.pdf'), { page: 3, offset: 0.42 })
  assert.deepEqual(restored.getPosition('/library/notes.md'), { top: 734 })
})

test('corrupt and unsupported stored data restore as an empty session', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 99, tabs: [{ path: '/old.md' }] })]) {
    const session = createReadingSession({ storage: memoryStorage({ [READING_SESSION_KEY]: raw }), scheduleTimeout: null })
    assert.deepEqual(session.load(), { version: READING_SESSION_VERSION, tabs: [], activePath: '', positions: {} })
  }
})

test('normalization drops invalid records and clamps stored offsets', () => {
  const result = normalizeReadingSession({
    version: READING_SESSION_VERSION,
    tabs: [{ path: '/a.md' }, { path: '/a.md', name: 'duplicate' }, { path: '' }, null],
    activePath: '/missing.md',
    positions: { '/a.md': { page: 3, offset: 1.7 }, '/bad': { top: -1 }, '/b.md': { top: 50 } },
  })
  assert.deepEqual(result.tabs.map((tab) => tab.path), ['/a.md'])
  assert.equal(result.activePath, '/a.md')
  assert.deepEqual(result.positions, { '/a.md': { page: 3, offset: 1 } , '/b.md': { top: 50 } })
})

test('arbitrary stored paths remain own position keys', () => {
  const storage = memoryStorage()
  const session = createReadingSession({ storage, scheduleTimeout: null })
  session.load()
  session.rememberPosition('__proto__', { top: 17 })
  session.rememberPosition('constructor', { top: 23 })
  assert.deepEqual(session.getPosition('__proto__'), { top: 17 })
  assert.deepEqual(session.getPosition('constructor'), { top: 23 })
})

test('quota failure retries a compact session and otherwise remains non-throwing', () => {
  const storage = {
    value: null,
    setItem(_key, value) {
      if (Object.keys(JSON.parse(value).positions || {}).length) throw new Error('quota')
      this.value = value
    },
  }
  const session = createReadingSession({ storage, scheduleTimeout: null })
  session.load()
  session.setTabs([{ path: '/doc.pdf', name: 'doc.pdf', kind: 'pdf' }], '/doc.pdf')
  session.rememberPosition('/doc.pdf', { page: 3, offset: 0.5 })
  assert.equal(session.flush(), true)
  assert.equal(JSON.parse(storage.value).positions && Object.keys(JSON.parse(storage.value).positions).length, 0)

  const full = createReadingSession({ storage: { getItem: () => null, setItem: () => { throw new Error('quota') } }, scheduleTimeout: null })
  full.load()
  full.setTabs([{ path: '/doc.pdf' }], '/doc.pdf')
  assert.doesNotThrow(() => full.dispose())
})

test('debounced writes flush on dispose', () => {
  const storage = memoryStorage()
  let callback
  const session = createReadingSession({
    storage,
    scheduleTimeout: (fn) => { callback = fn; return 1 },
    cancelTimeout: () => {},
  })
  session.load()
  session.setTabs([{ path: '/a.md' }], '/a.md')
  assert.equal(storage.getItem(READING_SESSION_KEY), null)
  session.dispose()
  assert.equal(JSON.parse(storage.getItem(READING_SESSION_KEY)).activePath, '/a.md')
  assert.equal(typeof callback, 'function')
})

test('startup opens OS launched files first and only restores session when none are launched', () => {
  const session = { version: READING_SESSION_VERSION, tabs: [{ path: '/old/session.md' }], activePath: '/old/session.md', positions: {} }
  assert.deepEqual(selectStartupPlan({ launchPaths: ['/os/open.pdf'], pendingPaths: ['/os/open.pdf'], session }), {
    type: 'system-files', paths: ['/os/open.pdf'],
  })
  assert.equal(selectStartupPlan({ session }).type, 'reading-session')
  assert.equal(selectStartupPlan({ session: { version: READING_SESSION_VERSION, tabs: [] } }).type, 'saved-folder')
})

test('removes only confirmed missing paths while retaining external tabs and saved order', () => {
  const session = {
    version: READING_SESSION_VERSION,
    tabs: [
      { path: '/library/a.md', name: 'a.md' },
      { path: '/external/b.pdf', name: 'b.pdf' },
      { path: '/library/gone.md', name: 'gone.md' },
    ],
    activePath: '/library/gone.md',
    positions: {},
  }
  const filtered = filterKnownMissingTabs(session, (path) => path === '/library/gone.md')
  assert.deepEqual(filtered.tabs.map((tab) => tab.path), ['/library/a.md', '/external/b.pdf'])
  assert.equal(filtered.activePath, '/external/b.pdf')
})
