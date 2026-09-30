export const READING_SESSION_KEY = 'pliego-reading-session'
export const READING_SESSION_VERSION = 1

const MAX_TABS = 80
const MAX_POSITIONS = 120
const MAX_PATH_LENGTH = 8192

function emptySession() {
  return { version: READING_SESSION_VERSION, tabs: [], activePath: '', positions: {} }
}

function setOwn(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true })
}

function validPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH
}

function normalizeTab(value) {
  if (!value || typeof value !== 'object' || !validPath(value.path)) return null
  return {
    path: value.path,
    name: typeof value.name === 'string' ? value.name.slice(0, 512) : value.path.split(/[\\/]/).pop(),
    kind: typeof value.kind === 'string' ? value.kind.slice(0, 32) : '',
  }
}

function normalizePosition(value) {
  if (!value || typeof value !== 'object') return null
  if (Number.isInteger(value.page) && value.page > 0 && Number.isFinite(value.offset)) {
    return { page: value.page, offset: Math.max(0, Math.min(1, value.offset)) }
  }
  if (Number.isFinite(value.top) && value.top >= 0) return { top: Math.min(value.top, 1_000_000_000) }
  return null
}

export function normalizeReadingSession(value) {
  if (!value || typeof value !== 'object' || value.version !== READING_SESSION_VERSION) return emptySession()

  const tabs = []
  const seen = new Set()
  if (Array.isArray(value.tabs)) {
    for (const candidate of value.tabs) {
      const tab = normalizeTab(candidate)
      if (!tab || seen.has(tab.path)) continue
      seen.add(tab.path)
      tabs.push(tab)
      if (tabs.length >= MAX_TABS) break
    }
  }

  const positions = {}
  if (value.positions && typeof value.positions === 'object' && !Array.isArray(value.positions)) {
    for (const [path, rawPosition] of Object.entries(value.positions)) {
      const position = validPath(path) ? normalizePosition(rawPosition) : null
      if (!position) continue
      setOwn(positions, path, position)
      if (Object.keys(positions).length >= MAX_POSITIONS) break
    }
  }

  const activePath = tabs.some((tab) => tab.path === value.activePath)
    ? value.activePath
    : tabs.at(-1)?.path || ''

  return { version: READING_SESSION_VERSION, tabs, activePath, positions }
}

export function filterKnownMissingTabs(session, isConfirmedMissing) {
  const normalized = normalizeReadingSession(session)
  const tabs = normalized.tabs.filter((tab) => !isConfirmedMissing?.(tab.path))
  const activePath = tabs.some((tab) => tab.path === normalized.activePath)
    ? normalized.activePath
    : tabs.at(-1)?.path || ''
  return { ...normalized, tabs, activePath }
}

export function selectStartupPlan({ launchPaths = [], pendingPaths = [], session } = {}) {
  const paths = []
  const seen = new Set()
  for (const path of [...launchPaths, ...pendingPaths]) {
    if (!validPath(path) || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  if (paths.length) return { type: 'system-files', paths }

  const saved = normalizeReadingSession(session)
  if (saved.tabs.length) return { type: 'reading-session', session: saved }
  return { type: 'saved-folder' }
}

function cloneSession(session) {
  return {
    version: session.version,
    tabs: session.tabs.map((tab) => ({ ...tab })),
    activePath: session.activePath,
    positions: Object.fromEntries(Object.entries(session.positions).map(([path, position]) => [path, { ...position }])),
  }
}

export function createReadingSession({
  storage,
  key = READING_SESSION_KEY,
  debounceMs = 350,
  scheduleTimeout = globalThis.setTimeout?.bind(globalThis),
  cancelTimeout = globalThis.clearTimeout?.bind(globalThis),
} = {}) {
  let snapshot = emptySession()
  let timer = null
  let loaded = false
  let disposed = false

  const resolveStorage = () => {
    try { return storage === undefined ? globalThis.localStorage : storage } catch (_) { return null }
  }

  function load() {
    if (loaded) return cloneSession(snapshot)
    loaded = true
    try {
      const raw = resolveStorage()?.getItem(key)
      if (raw) snapshot = normalizeReadingSession(JSON.parse(raw))
    } catch (_) {
      snapshot = emptySession()
    }
    return cloneSession(snapshot)
  }

  function cancelScheduledWrite() {
    if (timer !== null) cancelTimeout?.(timer)
    timer = null
  }

  function flush() {
    if (!loaded) load()
    cancelScheduledWrite()
    const target = resolveStorage()
    if (!target?.setItem) return false
    let serialized
    try {
      serialized = JSON.stringify(snapshot)
      target.setItem(key, serialized)
      return true
    } catch (_) {
      // If storage is nearly full, retain the session and retry without positions.
      try {
        target.setItem(key, JSON.stringify({ ...snapshot, positions: {} }))
        return true
      } catch (_) {
        return false
      }
    }
  }

  function scheduleWrite() {
    if (disposed || typeof scheduleTimeout !== 'function') return
    cancelScheduledWrite()
    timer = scheduleTimeout(() => {
      timer = null
      flush()
    }, debounceMs)
  }

  function setTabs(tabs, activePath) {
    if (!loaded) load()
    const normalized = normalizeReadingSession({ ...snapshot, tabs, activePath })
    snapshot = { ...normalized, positions: snapshot.positions }
    scheduleWrite()
    return cloneSession(snapshot)
  }

  function rememberPosition(path, value) {
    if (!loaded) load()
    const position = normalizePosition(value)
    if (!validPath(path) || !position) return false
    const positions = { ...snapshot.positions }
    delete positions[path]
    setOwn(positions, path, position)
    while (Object.keys(positions).length > MAX_POSITIONS) delete positions[Object.keys(positions)[0]]
    snapshot = { ...snapshot, positions }
    scheduleWrite()
    return true
  }

  function removePosition(path) {
    if (!loaded || !Object.hasOwn(snapshot.positions, path)) return
    const positions = { ...snapshot.positions }
    delete positions[path]
    snapshot = { ...snapshot, positions }
    scheduleWrite()
  }

  function getPosition(path) {
    if (!loaded) load()
    if (!Object.hasOwn(snapshot.positions, path)) return null
    const position = snapshot.positions[path]
    return position ? { ...position } : null
  }

  function getSnapshot() {
    if (!loaded) load()
    return cloneSession(snapshot)
  }

  function dispose() {
    disposed = true
    flush()
  }

  return { load, getSnapshot, getPosition, setTabs, rememberPosition, removePosition, flush, dispose }
}
