// Sistema de archivos virtual de la versión web. Las rutas son absolutas y
// viven bajo LIBRARY_ROOT; el almacén (IndexedDB o un Map en pruebas) guarda
// una entrada por archivo o carpeta: { path, dir, data, modified }.

export const LIBRARY_ROOT = '/Pliego'

export function normalizePath(path) {
  const parts = []
  for (const part of String(path || '').replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

export const joinPath = (...parts) => normalizePath(parts.join('/'))
export const parentPath = (path) => normalizePath(`${normalizePath(path)}/..`)
export const baseName = (path) => normalizePath(path).split('/').pop() || ''
export function splitName(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name, '']
}

export function isInside(path, folder) {
  const target = normalizePath(path)
  const root = normalizePath(folder)
  return target === root || target.startsWith(`${root}/`)
}

function ownedPath(path) {
  const target = normalizePath(path)
  if (!isInside(target, LIBRARY_ROOT)) throw `La ruta está fuera de la biblioteca: ${path}`
  return target
}

export function createIndexedDbStore(name = 'pliego-library') {
  let database = null
  const open = () => database || (database = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'path' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
  async function run(mode, action) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('entries', mode)
      const request = action(transaction.objectStore('entries'))
      transaction.oncomplete = () => resolve(request?.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error('Operación cancelada'))
    })
  }
  return {
    get: (path) => run('readonly', (store) => store.get(path)),
    all: () => run('readonly', (store) => store.getAll()),
    put: (entry) => run('readwrite', (store) => store.put(entry)),
    delete: (path) => run('readwrite', (store) => store.delete(path)),
  }
}

export function createMemoryStore() {
  const entries = new Map()
  return {
    get: async (path) => entries.get(path),
    all: async () => Array.from(entries.values()),
    put: async (entry) => void entries.set(entry.path, entry),
    delete: async (path) => void entries.delete(path),
  }
}

export function createWebFs(store, { now = () => Date.now() } = {}) {
  const encoder = new TextEncoder()

  async function stat(path) {
    const target = normalizePath(path)
    const entry = await store.get(target)
    if (entry) return entry
    // Las carpetas también existen implícitamente si contienen archivos.
    const prefix = `${target}/`
    return (await store.all()).some((item) => item.path.startsWith(prefix)) ? { path: target, dir: true, modified: 0 } : null
  }

  async function mkdir(path) {
    const target = ownedPath(path)
    for (let current = target; current !== '/'; current = parentPath(current)) {
      const entry = await store.get(current)
      if (entry && !entry.dir) throw `Ya existe un archivo llamado ${baseName(current)}`
      if (!entry) await store.put({ path: current, dir: true, modified: now() })
      if (current === LIBRARY_ROOT) break
    }
    return target
  }

  async function readBytes(path) {
    const entry = await store.get(normalizePath(path))
    if (!entry || entry.dir) throw `No existe el archivo ${baseName(path) || path}`
    return entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data)
  }

  async function writeBytes(path, data, { createNew = false } = {}) {
    const target = ownedPath(path)
    const existing = await store.get(target)
    if (existing?.dir) throw `${baseName(target)} es una carpeta`
    if (createNew && existing) throw `Ya existe ${baseName(target)}`
    await mkdir(parentPath(target))
    const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data)
    await store.put({ path: target, dir: false, data: bytes, modified: now() })
    return target
  }

  async function list(folder) {
    const root = normalizePath(folder)
    if (!(await stat(root))?.dir) throw `No se puede leer la carpeta '${root}'`
    const prefix = root === '/' ? '/' : `${root}/`
    const children = new Map()
    for (const entry of await store.all()) {
      if (!entry.path.startsWith(prefix)) continue
      const rest = entry.path.slice(prefix.length)
      const name = rest.split('/')[0]
      if (!name) continue
      const isDirect = rest === name
      const path = `${prefix}${name}`
      if (!children.has(path) || (isDirect && !entry.dir)) children.set(path, isDirect ? entry : { path, dir: true, modified: 0 })
    }
    return Array.from(children.values()).map((entry) => ({ ...entry, name: baseName(entry.path) }))
  }

  async function remove(path) {
    const target = ownedPath(path)
    const prefix = `${target}/`
    for (const entry of await store.all()) {
      if (entry.path === target || entry.path.startsWith(prefix)) await store.delete(entry.path)
    }
  }

  async function rename(source, destination) {
    const from = ownedPath(source)
    const to = ownedPath(destination)
    if (await stat(to)) throw `Ya existe ${baseName(to)}`
    const prefix = `${from}/`
    for (const entry of await store.all()) {
      if (entry.path !== from && !entry.path.startsWith(prefix)) continue
      await store.put({ ...entry, path: to + entry.path.slice(from.length), modified: now() })
      await store.delete(entry.path)
    }
    await mkdir(parentPath(to))
    return to
  }

  async function uniquePath(folder, stem, extension) {
    for (let index = 0; index < 10000; index += 1) {
      const suffix = index ? `-${index}` : ''
      const candidate = joinPath(folder, extension ? `${stem}${suffix}.${extension}` : `${stem}${suffix}`)
      if (!(await stat(candidate))) return candidate
    }
    return joinPath(folder, `${stem}-${now()}${extension ? `.${extension}` : ''}`)
  }

  return { stat, mkdir, readBytes, writeBytes, list, remove, rename, uniquePath, all: () => store.all() }
}
