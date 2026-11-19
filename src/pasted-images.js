// Pegar o soltar imágenes en el editor: se guardan en assets/ junto al .md y
// se insertan con ruta relativa para que el Markdown guardado sea portable.

export const ASSETS_FOLDER = 'assets'

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' }
const FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

// Extensión admitida para un archivo de imagen, o '' si no se puede guardar (SVG, TIFF…).
export function imageExtension(file) {
  const byType = EXTENSIONS[String(file?.type || '').toLowerCase()]
  if (byType) return byType
  const fromName = String(file?.name || '').split('.').pop().toLowerCase()
  return FILE_EXTENSIONS.has(fromName) ? fromName : ''
}

export function isImageFile(file) {
  return String(file?.type || '').startsWith('image/') || Boolean(imageExtension(file))
}

const pad = (value) => String(value).padStart(2, '0')

// pegado-AAAAMMDD-HHMMSS.<ext>; el backend añade -1, -2… si ya existe.
export function pastedImageName(date, extension) {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `pegado-${stamp}.${extension}`
}

const documentFolder = (filePath) => filePath.replace(/[\\/][^\\/]*$/, '')
const separatorOf = (filePath) => (filePath.includes('\\') && !filePath.includes('/') ? '\\' : '/')

// Ruta absoluta donde guardar la imagen pegada en el documento `filePath`.
export function pastedImageTarget(filePath, fileName) {
  const separator = separatorOf(filePath)
  return `${documentFolder(filePath)}${separator}${ASSETS_FOLDER}${separator}${fileName}`
}

// Ruta relativa (siempre con /) que se escribe en el Markdown para `savedPath`.
export function relativeImageSource(filePath, savedPath) {
  const folder = documentFolder(filePath).replaceAll('\\', '/')
  const saved = savedPath.replaceAll('\\', '/')
  return saved.startsWith(`${folder}/`) ? saved.slice(folder.length + 1) : `${ASSETS_FOLDER}/${saved.split('/').pop()}`
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/**
 * Conecta pegar/soltar en el lector con el backend. Solo actúa en modo
 * Edición y con un documento que tenga ruta en disco.
 */
export function installImagePaste({ reader, dropzone, getState, getRoot, invoke, notify, text, formatError = String, mimeType, now = () => new Date() }) {
  function canInsert() {
    const state = getState()
    if (state.mode !== 'edit') return false
    if (!state.filePath) {
      notify(text('pasteImageNoPath'))
      return false
    }
    return true
  }

  // Rango del cursor dentro del lector (o el final del documento).
  function insertionRange() {
    const selection = document.getSelection()
    if (selection?.rangeCount && reader.contains(selection.getRangeAt(0).commonAncestorContainer)) return selection.getRangeAt(0).cloneRange()
    const range = document.createRange()
    range.selectNodeContents(reader)
    range.collapse(false)
    return range
  }

  async function saveImage(bytes, extension, filePath) {
    const target = pastedImageTarget(filePath, pastedImageName(now(), extension))
    const root = getRoot() || documentFolder(filePath)
    return invoke('save_binary_file', { path: target, base64: bytesToBase64(bytes), root })
  }

  function insertImage(range, { savedPath, bytes, filePath }) {
    const image = document.createElement('img')
    const source = relativeImageSource(filePath, savedPath)
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType(savedPath) }))
    // Igual que hydrateMarkdownImages: blob: para verlo, data-markdown-src para guardarlo.
    if (Array.isArray(reader._markdownImageUrls)) reader._markdownImageUrls.push(url)
    image.src = url
    image.alt = savedPath.replaceAll('\\', '/').split('/').pop().replace(/\.[^.]+$/, '')
    image.dataset.markdownSrc = source
    image.dataset.sourcePath = savedPath
    range.deleteContents()
    range.insertNode(image)
    range.setStartAfter(image)
    range.collapse(true)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // Marca el documento como modificado y programa el borrador.
    reader.dispatchEvent(new Event('input', { bubbles: true }))
  }

  async function insertFiles(files, range) {
    const filePath = getState().filePath
    for (const file of files) {
      const extension = imageExtension(file)
      if (!extension) {
        notify(text('pasteImageUnsupported'))
        continue
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const savedPath = await saveImage(bytes, extension, filePath)
        // Si mientras se guardaba se cambió de documento o de modo, no se inserta en otro.
        if (getState().filePath !== filePath || getState().mode !== 'edit') return
        insertImage(range, { savedPath, bytes, filePath })
      } catch (error) {
        notify(`${text('pasteImageFailed')}: ${formatError(error)}`)
        return
      }
    }
  }

  function imageFiles(dataTransfer) {
    const files = Array.from(dataTransfer?.files || [])
    if (!files.length) {
      for (const item of Array.from(dataTransfer?.items || [])) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
    }
    return files.filter(isImageFile)
  }

  reader.addEventListener('paste', (event) => {
    if (getState().mode !== 'edit') return
    const files = imageFiles(event.clipboardData)
    if (!files.length) return
    // Sin esto el navegador insertaría la imagen como data: dentro del Markdown.
    event.preventDefault()
    if (!canInsert()) return
    void insertFiles(files, insertionRange())
  })

  // La zona de soltar tapa el lector al arrastrar; se intercepta en captura
  // para que el manejador general no abra la imagen como documento.
  window.addEventListener('drop', (event) => {
    if (getState().mode !== 'edit') return
    const files = imageFiles(event.dataTransfer)
    if (!files.length) return
    event.preventDefault()
    event.stopImmediatePropagation()
    dropzone?.classList.remove('visible')
    if (!canInsert()) return
    void insertFiles(files, insertionRange())
  }, true)

  // Escritorio: Tauri entrega rutas al soltar, no File. Devuelve true si las gestionó.
  function dropPaths(paths) {
    if (getState().mode !== 'edit') return false
    const images = (paths || []).filter((path) => imageExtension({ name: path }))
    if (!images.length || images.length !== paths.length) return false
    if (!canInsert()) return true
    const range = insertionRange()
    void (async () => {
      const files = []
      for (const path of images) {
        try {
          const payload = await invoke('read_binary_document', { path })
          const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0))
          files.push({ name: path, type: '', arrayBuffer: async () => bytes.buffer })
        } catch (error) {
          notify(`${text('pasteImageFailed')}: ${formatError(error)}`)
        }
      }
      await insertFiles(files, range)
    })()
    return true
  }

  return { dropPaths }
}
