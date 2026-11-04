// Adaptador de navegador: biblioteca en IndexedDB y selectores del sistema.
import { createRenderer } from './render-wasm.js'
import { IMPORT_ROOT, createWebBackend } from './web-backend.js'
import { LIBRARY_ROOT, baseName, createIndexedDbStore, createWebFs, joinPath } from './web-fs.js'
import { chooseFolder } from './web-folder-dialog.js'

const wasmUrls = import.meta.glob('./generated/pliego-render.wasm', { query: '?url', import: 'default', eager: true })
const SETTINGS_KEY = 'pliego-web-settings'
const WELCOME = `# Bienvenido a Pliego

Esta es tu biblioteca en este dispositivo. Los documentos se guardan en el navegador y funcionan sin conexión.

- Usa **Abrir documento** para traer archivos desde Archivos o iCloud Drive. Se copian a la carpeta *Importados*.
- Crea páginas nuevas con **Nueva página**.
- Exporta una copia de seguridad desde **Configuración** de vez en cuando: si borras los datos de Safari, la biblioteca se pierde.
`

const settings = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    } catch (_) {
      return {}
    }
  },
  get(key) {
    return this.read()[key]
  },
  set(key, value) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...this.read(), [key]: value }))
    } catch (_) {
      // Sin localStorage se usa el valor por defecto.
    }
  },
}

const fs = createWebFs(createIndexedDbStore())
const picked = new Map()
let backend = null
let pickCounter = 0

async function loadBackend() {
  const url = Object.values(wasmUrls)[0]
  if (!url) throw new Error('Falta pliego-render.wasm: ejecuta npm run build:wasm')
  const response = await fetch(url)
  const renderer = await createRenderer(await response.arrayBuffer())
  if (!(await fs.stat(LIBRARY_ROOT))) {
    await fs.mkdir(LIBRARY_ROOT)
    await fs.writeBytes(joinPath(LIBRARY_ROOT, 'Bienvenido.md'), WELCOME)
  }
  // Pide a Safari que no borre la biblioteca por falta de espacio.
  void navigator.storage?.persist?.().catch(() => {})
  return createWebBackend({ fs, renderer, settings, picked })
}

const ready = () => backend || (backend = loadBackend().catch((error) => {
  backend = null
  throw error
}))

export const isNative = false
export const defaultLibrary = LIBRARY_ROOT
export const invoke = async (command, args) => (await ready()).invoke(command, args)
export const importPicked = async (path) => (await ready()).importPicked(path)

function pickFiles({ multiple = false, filters = [] }) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.accept = filters.flatMap((filter) => filter.extensions || []).map((extension) => `.${extension}`).join(',')
    input.addEventListener('change', async () => {
      const paths = []
      for (const file of Array.from(input.files || [])) {
        const path = `/.picked/${(pickCounter += 1)}/${file.name}`
        picked.set(path, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
        paths.push(path)
      }
      resolve(paths.length ? (multiple ? paths : paths[0]) : null)
    }, { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

export async function openDialog(options = {}) {
  if (options.directory) {
    const folders = (await fs.all()).filter((entry) => entry.dir && entry.path.startsWith(LIBRARY_ROOT)).map((entry) => entry.path)
    return chooseFolder({ title: options.title, folders: [LIBRARY_ROOT, ...new Set(folders)], mkdir: (path) => fs.mkdir(path) })
  }
  return pickFiles(options)
}

export const listen = async () => () => {}

export function getCurrentWindow() {
  const noop = async () => {}
  return { minimize: noop, toggleMaximize: noop, close: noop, onCloseRequested: noop }
}

export async function exportLibrary() {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const entry of await fs.all()) {
    if (!entry.dir && entry.path.startsWith(`${LIBRARY_ROOT}/`)) zip.file(entry.path.slice(LIBRARY_ROOT.length + 1), entry.data)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const date = new Date().toISOString().slice(0, 10)
  return { blob, fileName: `Pliego-${date}.zip` }
}

export async function importLibrary(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  let count = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const path = joinPath(LIBRARY_ROOT, entry.name)
    if (!path.startsWith(`${LIBRARY_ROOT}/`) || baseName(path).startsWith('.')) continue
    await fs.writeBytes(path, await entry.async('uint8array'))
    count += 1
  }
  return count
}

export { IMPORT_ROOT }
