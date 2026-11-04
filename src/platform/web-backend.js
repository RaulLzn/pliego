// Equivalentes web de los comandos Tauri de src-tauri/src/lib.rs e inbox.rs.
// Devuelven las mismas formas para que main.js no distinga la plataforma.
import { LIBRARY_ROOT, baseName, isInside, joinPath, normalizePath, parentPath, splitName } from './web-fs.js'

export const INBOX_ROOT = `${LIBRARY_ROOT}/Inbox`
export const IMPORT_ROOT = `${LIBRARY_ROOT}/Importados`
const ARCHIVE_DIR = '.archive'
const MAX_VISUAL_FILE_BYTES = 128 * 1024 * 1024
const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024
const INDEX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_BYTES = 256 * 1024
const PREVIEW_EXTENSIONS = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'toml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'rs', 'py'])
const KINDS = {
  md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown', txt: 'text', csv: 'table', tsv: 'table',
  pdf: 'pdf', docx: 'docx', epub: 'epub', mmd: 'mermaid', mermaid: 'mermaid',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image',
}

export const documentKind = (path) => KINDS[splitName(baseName(path))[1].toLowerCase()] || null
const isMarkdownPath = (path) => ['markdown', 'text'].includes(documentKind(path))
const decode = (bytes, limit = bytes.length) => new TextDecoder().decode(bytes.subarray(0, limit))
const megabytes = (size) => (size / 1048576).toFixed(1)

export function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

// Misma regla que sanitize_stem en inbox.rs.
export function sanitizeStem(value) {
  let output = ''
  let lastWasSeparator = false
  for (const ch of String(value || '').trim()) {
    if (/[\p{L}\p{N}_-]/u.test(ch)) {
      output += ch
      lastWasSeparator = false
    } else if (!lastWasSeparator && output) {
      output += '-'
      lastWasSeparator = true
    }
    if (Array.from(output).length >= 80) break
  }
  return output.replace(/^-+|-+$/g, '') || 'captura'
}

function timestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function safeItemName(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') throw 'Nombre de elemento inválido'
  if (/[\\/]/.test(trimmed)) throw 'El nombre no puede contener rutas'
  return trimmed
}

export function createWebBackend({ fs, renderer, settings, picked = new Map(), clipboard = () => navigator.clipboard.readText(), now = () => new Date() }) {
  async function readText(path, limit) {
    const bytes = picked.has(path) ? picked.get(path).bytes : await fs.readBytes(path)
    return decode(bytes, limit)
  }

  async function readSource(path) {
    if (picked.has(path)) return picked.get(path)
    return { name: baseName(path), bytes: await fs.readBytes(path) }
  }

  async function markdownTitles() {
    const titles = new Map()
    for (const entry of await fs.all()) {
      if (entry.dir || !isMarkdownPath(entry.path)) continue
      titles.set(entry.path, renderer.title(entry.path, decode(entry.data, INDEX_TEXT_BYTES)))
    }
    return titles
  }

  async function buildTree(dir) {
    const items = (await fs.list(dir)).sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    const nodes = []
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      if (item.dir) {
        const children = await buildTree(item.path)
        if (children.length) nodes.push({ name: item.name, path: item.path, isDir: true, children })
      } else if (documentKind(item.path)) {
        nodes.push({ name: item.name, path: item.path, isDir: false, children: [] })
      }
    }
    return nodes
  }

  async function documentIndex(dir) {
    const root = normalizePath(dir)
    if (!(await fs.stat(root))?.dir) throw `No se puede indexar la carpeta '${root}'`
    const entries = []
    for (const entry of await fs.all()) {
      const relative = entry.path.slice(root.length)
      if (entry.dir || !isInside(entry.path, root) || relative.split('/').some((part) => part.startsWith('.'))) continue
      const kind = documentKind(entry.path)
      if (!kind) continue
      const searchableText = ['markdown', 'text', 'table', 'mermaid'].includes(kind) ? decode(entry.data, INDEX_TEXT_BYTES) : ''
      entries.push({ name: baseName(entry.path), path: entry.path, kind, searchableText, references: kind === 'markdown' ? renderer.references(searchableText) : [] })
    }
    return entries.sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()))
  }

  function inboxRoot() {
    return settings.get('inboxFolder') || INBOX_ROOT
  }

  async function inboxItem(path) {
    const entry = await fs.stat(path)
    return { name: baseName(path), path, isDir: Boolean(entry?.dir), size: entry?.data?.length || 0, modifiedMs: entry?.modified || 0 }
  }

  async function existingInboxItem(name) {
    const path = joinPath(inboxRoot(), safeItemName(name))
    if (!(await fs.stat(path))) throw 'El elemento del Inbox no existe'
    return path
  }

  async function writeCapture(title, contents) {
    if (!String(contents || '').trim()) throw 'La captura está vacía'
    const stamp = timestamp(now())
    const stem = title && title.trim() ? `${stamp} ${sanitizeStem(title)}` : stamp
    const path = await fs.uniquePath(inboxRoot(), sanitizeStem(stem), 'md')
    await fs.writeBytes(path, contents)
    return inboxItem(path)
  }

  async function moveUnique(source, folder) {
    const [stem, extension] = splitName(baseName(source))
    const destination = await fs.uniquePath(folder, sanitizeStem(stem || 'archivo'), extension)
    await fs.rename(source, destination)
    return inboxItem(destination)
  }

  const commands = {
    get_launch_paths: () => [],
    list_markdown_tree: ({ dir }) => buildTree(normalizePath(dir)),
    list_document_index: ({ dir }) => documentIndex(dir),
    render_markdown_text: ({ contents }) => renderer.render(contents),

    async read_markdown_file({ path, folder }) {
      const { name, bytes } = await readSource(path)
      if (bytes.length > MAX_TEXT_FILE_BYTES) throw `El documento ocupa ${megabytes(bytes.length)} MB; el límite seguro para texto es 32 MB`
      const contents = decode(bytes)
      const html = renderer.renderWithContext(contents, { path, folder, titles: await markdownTitles() })
      return { fileName: name, contents, html }
    },

    async read_binary_document({ path }) {
      const kind = documentKind(path)
      if (!kind) throw 'Formato no soportado'
      const { name, bytes } = await readSource(path)
      if (bytes.length > MAX_VISUAL_FILE_BYTES) throw `El archivo ocupa ${megabytes(bytes.length)} MB; el límite seguro de visualización es 128 MB`
      return { fileName: name, kind, base64: bytesToBase64(bytes) }
    },

    async save_markdown_file({ path, contents }) {
      await fs.writeBytes(path, contents)
    },

    async create_markdown_file({ folder, title }) {
      if (!(await fs.stat(folder))?.dir) throw 'Abre una carpeta válida antes de crear una página'
      const { heading, fileName } = renderer.pageName(title)
      const path = joinPath(folder, fileName)
      await fs.writeBytes(path, `# ${heading}\n\n`, { createNew: true }).catch(() => {
        throw `Ya existe una página llamada ${fileName}`
      })
      return { fileName, path }
    },

    open_file_in_folder: () => {
      throw 'La versión web no puede abrir el explorador de archivos'
    },

    async inbox_get_config() {
      await fs.mkdir(inboxRoot())
      return { folder: inboxRoot(), shortcut: '' }
    },
    async inbox_set_folder({ folder }) {
      const target = await fs.mkdir(folder)
      settings.set('inboxFolder', target)
      return { folder: target, shortcut: '' }
    },
    inbox_set_shortcut: () => {
      throw 'La versión web no admite atajos globales'
    },
    inbox_capture_text: ({ contents, title }) => writeCapture(title, contents),
    inbox_capture_url({ url, title }) {
      const link = String(url || '').trim()
      if (!/^https?:\/\//.test(link)) throw 'La URL debe comenzar por http:// o https://'
      const label = title && title.trim() ? title : link
      return writeCapture(title || 'enlace', `# ${label}\n\nFuente: [${link}](${link})\n`)
    },
    async inbox_capture_clipboard({ title }) {
      return writeCapture(title, await clipboard())
    },
    async inbox_import_files({ paths }) {
      const imported = []
      for (const path of paths || []) {
        const { name, bytes } = await readSource(path)
        const [stem, extension] = splitName(name)
        const destination = await fs.uniquePath(inboxRoot(), sanitizeStem(stem || 'archivo'), extension)
        await fs.writeBytes(destination, bytes)
        imported.push(await inboxItem(destination))
      }
      return imported
    },
    async inbox_list() {
      const root = await fs.mkdir(inboxRoot())
      const items = []
      for (const entry of await fs.list(root)) if (entry.name !== ARCHIVE_DIR) items.push(await inboxItem(entry.path))
      return items.sort((a, b) => b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name))
    },
    async inbox_read_preview({ name }) {
      const path = await existingInboxItem(name)
      const entry = await fs.stat(path)
      if (entry.dir || !PREVIEW_EXTENSIONS.has(splitName(baseName(path))[1].toLowerCase())) return { contents: null, truncated: false }
      return { contents: await readText(path, MAX_PREVIEW_BYTES), truncated: entry.data.length > MAX_PREVIEW_BYTES }
    },
    async inbox_rename({ name, newName }) {
      const source = await existingInboxItem(name)
      const destination = joinPath(inboxRoot(), safeItemName(newName))
      if (await fs.stat(destination)) throw 'Ya existe un elemento con ese nombre'
      await fs.rename(source, destination)
      return inboxItem(destination)
    },
    async inbox_archive({ name }) {
      return moveUnique(await existingInboxItem(name), joinPath(inboxRoot(), ARCHIVE_DIR))
    },
    async inbox_move({ name, destinationFolder }) {
      const source = await existingInboxItem(name)
      if (!(await fs.stat(destinationFolder))?.dir) throw 'La carpeta de destino no es válida'
      return moveUnique(source, normalizePath(destinationFolder))
    },
    async inbox_delete({ name }) {
      const path = await existingInboxItem(name)
      if ((await fs.stat(path)).dir) throw 'El Inbox no elimina carpetas'
      await fs.remove(path)
    },
  }

  async function invoke(command, args = {}) {
    const handler = commands[command]
    if (!handler) throw `Función no disponible en la versión web: ${command}`
    return handler(args)
  }

  // Copia a la biblioteca un archivo elegido en el selector del sistema.
  async function importPicked(path, folder = IMPORT_ROOT) {
    if (!picked.has(path)) return path
    const { name, bytes } = picked.get(path)
    const [stem, extension] = splitName(name)
    const destination = await fs.uniquePath(folder, stem || 'archivo', extension)
    await fs.writeBytes(destination, bytes)
    picked.delete(path)
    return destination
  }

  return { invoke, importPicked, parentPath }
}
