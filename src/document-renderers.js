export function decodeBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function renderVisualDocument(reader, payload, path) {
  reader._visualCleanup?.()
  reader._visualCleanup = null
  const bytes = decodeBase64(payload.base64)
  reader.classList.remove('empty')
  reader.classList.add('visual-document')
  if (payload.kind === 'pdf') return renderPdf(reader, bytes)
  if (payload.kind === 'docx') return renderDocx(reader, bytes)
  if (payload.kind === 'epub') return renderEpub(reader, bytes)
  if (payload.kind === 'image') return renderImage(reader, bytes, path)
  throw new Error(`El formato ${payload.kind} todavía no tiene renderizador visual`)
}

async function renderPdf(reader, bytes) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  reader.innerHTML = '<div class="visual-loading">Preparando páginas…</div>'
  const loadingTask = pdfjs.getDocument({ data: bytes })
  let pdf
  let disposed = false
  const pages = []
  let resizeTimer
  let observer
  reader._visualCleanup = () => {
    if (disposed) return
    disposed = true
    observer?.disconnect()
    clearTimeout(resizeTimer)
    for (const item of pages) {
      item.task?.cancel()
      item.page?.cleanup()
      item.canvas.width = 0
      item.canvas.height = 0
    }
    void (pdf ? pdf.destroy() : loadingTask.destroy()).catch(() => {})
  }
  pdf = await loadingTask.promise
  if (disposed) throw new DOMException('Carga cancelada', 'AbortError')
  const shell = document.createElement('div')
  shell.className = 'pdf-document'
  reader.innerHTML = ''
  reader.appendChild(shell)
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (disposed) throw new DOMException('Carga cancelada', 'AbortError')
    const page = await pdf.getPage(pageNumber)
    const canvas = document.createElement('canvas')
    canvas.className = 'pdf-page'
    shell.appendChild(canvas)
    pages.push({ page, canvas, task: null })
  }
  let drawing = false
  let redrawRequested = false
  const redraw = async () => {
    if (disposed) return
    if (drawing) { redrawRequested = true; return }
    drawing = true
    const available = Math.max(280, shell.clientWidth || reader.clientWidth - 32)
    for (const item of pages) {
      if (disposed) break
      item.task?.cancel()
      const base = item.page.getViewport({ scale: 1 })
      const cssWidth = Math.min(980, available)
      const viewport = item.page.getViewport({ scale: cssWidth / base.width })
      const ratio = Math.min(2, devicePixelRatio || 1)
      item.canvas.width = Math.ceil(viewport.width * ratio)
      item.canvas.height = Math.ceil(viewport.height * ratio)
      item.canvas.style.width = `${Math.floor(viewport.width)}px`
      item.canvas.style.height = `${Math.floor(viewport.height)}px`
      item.task = item.page.render({ canvasContext: item.canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
      try { await item.task.promise } catch (error) { if (error?.name !== 'RenderingCancelledException') throw error }
    }
    drawing = false
    if (disposed) return
    if (redrawRequested) { redrawRequested = false; void redraw() }
  }
  await redraw()
  observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => void redraw(), 120)
  })
  observer.observe(shell)
  return { words: 0, detail: `${pdf.numPages} páginas` }
}

async function renderDocx(reader, bytes) {
  const { default: mammoth } = await import('mammoth/mammoth.browser')
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer })
  reader.innerHTML = `<div class="office-document">${sanitizeHtml(result.value)}</div>`
  return { words: textWords(reader.textContent), detail: 'Documento Word' }
}

async function renderEpub(reader, bytes) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const container = await zip.file('META-INF/container.xml')?.async('text')
  if (!container) throw new Error('EPUB inválido: falta container.xml')
  const containerXml = new DOMParser().parseFromString(container, 'application/xml')
  const opfPath = containerXml.querySelector('rootfile')?.getAttribute('full-path')
  const opfText = opfPath ? await zip.file(opfPath)?.async('text') : ''
  if (!opfText) throw new Error('EPUB inválido: no se encontró el paquete')
  const opf = new DOMParser().parseFromString(opfText, 'application/xml')
  const manifest = new Map(Array.from(opf.querySelectorAll('manifest item')).map((item) => [item.getAttribute('id'), item.getAttribute('href')]))
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const chapters = []
  for (const item of opf.querySelectorAll('spine itemref')) {
    const href = manifest.get(item.getAttribute('idref'))
    if (!href) continue
    const html = await zip.file(base + decodeURIComponent(href))?.async('text')
    if (!html) continue
    const doc = new DOMParser().parseFromString(html, 'text/html')
    chapters.push(doc.body?.innerHTML || '')
  }
  reader.innerHTML = `<div class="ebook-document">${sanitizeHtml(chapters.join('<hr>'))}</div>`
  return { words: textWords(reader.textContent), detail: `${chapters.length} capítulos` }
}

function renderImage(reader, bytes, path) {
  const extension = path.split('.').pop().toLowerCase()
  const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' })[extension] || 'image/png'
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  reader.innerHTML = '<div class="image-document"></div>'
  const image = new Image()
  image.alt = path.split('/').pop()
  let revoked = false
  const revoke = () => {
    if (revoked) return
    revoked = true
    URL.revokeObjectURL(url)
  }
  image.onload = revoke
  image.onerror = revoke
  reader._visualCleanup = () => {
    image.onload = null
    image.onerror = null
    image.src = ''
    revoke()
  }
  image.src = url
  reader.firstElementChild.appendChild(image)
  return { words: 0, detail: 'Imagen' }
}

export async function renderTableDocument(reader, text, delimiter) {
  const { default: Papa } = await import('papaparse')
  const parsed = Papa.parse(text, { delimiter, skipEmptyLines: true })
  const rows = parsed.data
  const head = rows[0] || []
  reader.classList.remove('empty')
  reader.classList.add('visual-document')
  reader.innerHTML = `<div class="table-document"><table><thead><tr>${head.map((cell) => `<th>${escapeHtml(String(cell))}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  return { words: rows.flat().length, detail: `${Math.max(0, rows.length - 1)} filas · ${head.length} columnas` }
}

export async function renderMermaidDocument(reader, source) {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
  reader.classList.remove('empty')
  reader.classList.add('visual-document')
  const id = `mermaid-${Date.now()}`
  const { svg } = await mermaid.render(id, source)
  reader.innerHTML = `<div class="diagram-document">${svg}</div>`
  return { words: textWords(source), detail: 'Diagrama Mermaid' }
}

export async function renderMermaidBlocks(root) {
  const blocks = Array.from(root.querySelectorAll('pre code.language-mermaid'))
  if (!blocks.length) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    try {
      const { svg } = await mermaid.render(`mermaid-inline-${Date.now()}-${index}`, block.textContent)
      const shell = document.createElement('div')
      shell.className = 'diagram-document inline-diagram'
      shell.innerHTML = svg
      block.closest('pre').replaceWith(shell)
    } catch (error) {
      block.closest('pre').classList.add('diagram-error')
      block.closest('pre').title = error instanceof Error ? error.message : 'Diagrama Mermaid inválido'
    }
  }
}

function sanitizeHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script, style, iframe, object, embed, form').forEach((node) => node.remove())
  template.content.querySelectorAll('*').forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.toLowerCase().startsWith('on') || attr.name.toLowerCase() === 'style') node.removeAttribute(attr.name)
    }
  })
  return template.innerHTML
}

function textWords(text) { return text.trim().split(/\s+/).filter(Boolean).length }
function escapeHtml(value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
