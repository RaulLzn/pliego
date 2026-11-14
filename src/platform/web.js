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

// iOS traduce cada extensión de `accept` a un tipo propio y deja en gris
// los archivos cuya extensión no reconoce (.md, .mmd…). Allí no se filtra en
// el selector y se valida la extensión al importar.
const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
// Safari en iOS no deja elegir carpetas; en el resto se usa webkitdirectory.
export const canPickFolder = !isIOS && typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype

let activeInput = null
let pickWarnings = []

// Archivos que no se pudieron traer en la última selección (p. ej. de iCloud
// sin descargar o de un tipo no admitido). Se vacía al leerla.
export function takePickWarnings() {
  const warnings = pickWarnings
  pickWarnings = []
  return warnings
}

const extensionOf = (name) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// Debe llamarse dentro del gesto del usuario: input.click() se ejecuta sin
// ningún await previo. Devuelve los File elegidos, o null si se cancela.
function chooseFiles({ multiple = false, directory = false, extensions = [] }) {
  activeInput?.remove()
  const input = document.createElement('input')
  activeInput = input
  input.type = 'file'
  input.multiple = multiple || directory
  if (directory) input.webkitdirectory = true
  if (extensions.length && !isIOS && !directory) input.accept = extensions.map((extension) => `.${extension}`).join(',')
  // WebKit puede descartar un input que no está en la página antes de
  // disparar `change`; se mantiene en el DOM, oculto, mientras se elige.
  input.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;inset-inline-start:-100px'
  document.body.append(input)
  return new Promise((resolve) => {
    const finish = (files) => {
      input.remove()
      if (activeInput === input) activeInput = null
      resolve(files)
    }
    input.addEventListener('change', () => finish(Array.from(input.files || [])), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    input.click()
  })
}

async function readFiles(files, extensions = []) {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()))
  const read = []
  for (const file of files) {
    if (allowed.size && !allowed.has(extensionOf(file.name))) {
      pickWarnings.push({ name: file.name, reason: 'type' })
      continue
    }
    try {
      read.push({ file, bytes: new Uint8Array(await file.arrayBuffer()) })
    } catch (_) {
      // Típico de iCloud Drive cuando el archivo aún no está descargado.
      pickWarnings.push({ name: file.name, reason: 'read' })
    }
  }
  return read
}

async function pickFiles({ multiple = false, filters = [] }) {
  pickWarnings = []
  const extensions = filters.flatMap((filter) => filter.extensions || [])
  const files = await chooseFiles({ multiple, extensions })
  if (!files) return null
  const paths = []
  for (const { file, bytes } of await readFiles(files, extensions)) {
    const path = `/.picked/${(pickCounter += 1)}/${file.name}`
    picked.set(path, { name: file.name, bytes })
    paths.push(path)
  }
  if (!paths.length) return multiple ? [] : null
  return multiple ? paths : paths[0]
}

// Importa a la biblioteca una carpeta del dispositivo y devuelve su ruta.
async function importDeviceFolder() {
  pickWarnings = []
  const files = await chooseFiles({ directory: true })
  if (!files || !files.length) return null
  const entries = (await readFiles(files)).map(({ file, bytes }) => ({ relativePath: file.webkitRelativePath || file.name, bytes }))
  if (!entries.length) throw 'No pude leer ningún archivo de la carpeta'
  return (await ready()).importFolder(entries)
}

export async function openDialog(options = {}) {
  if (options.directory) {
    const folders = (await fs.all()).filter((entry) => entry.dir && entry.path.startsWith(LIBRARY_ROOT)).map((entry) => entry.path)
    return chooseFolder({
      title: options.title,
      folders: [LIBRARY_ROOT, ...new Set(folders)],
      mkdir: (path) => fs.mkdir(path),
      importFolder: options.allowImport && canPickFolder ? importDeviceFolder : null,
      zipHint: Boolean(options.allowImport && !canPickFolder),
    })
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
