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
  const visiblePages = new Set()
  let resizeTimer
  let intersectionObserver
  let resizeObserver
  reader._visualCleanup = () => {
    if (disposed) return
    disposed = true
    intersectionObserver?.disconnect()
    resizeObserver?.disconnect()
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
    const slot = document.createElement('div')
    slot.className = 'pdf-page-slot'
    const canvas = document.createElement('canvas')
    canvas.className = 'pdf-page'
    slot.appendChild(canvas)
    shell.appendChild(slot)
    pages.push({ page, canvas, slot, task: null })
  }
  const sizePage = (item) => {
    const available = Math.max(280, shell.clientWidth || reader.clientWidth - 32)
    const base = item.page.getViewport({ scale: 1 })
    const cssWidth = Math.min(980, available)
    const viewport = item.page.getViewport({ scale: cssWidth / base.width })
    item.canvas.style.width = `${Math.floor(viewport.width)}px`
    item.canvas.style.height = `${Math.floor(viewport.height)}px`
    item.slot.style.width = `${Math.floor(viewport.width)}px`
    item.slot.style.height = `${Math.floor(viewport.height)}px`
    return viewport
  }
  const renderPage = async (item) => {
    if (disposed || !visiblePages.has(item)) return
    item.task?.cancel()
    const viewport = sizePage(item)
    const ratio = Math.min(2, devicePixelRatio || 1)
    item.canvas.width = Math.ceil(viewport.width * ratio)
    item.canvas.height = Math.ceil(viewport.height * ratio)
    item.task = item.page.render({ canvasContext: item.canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
    try { await item.task.promise } catch (error) { if (error?.name !== 'RenderingCancelledException') throw error }
  }
  pages.forEach(sizePage)
  intersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const item = pages.find((candidate) => candidate.slot === entry.target)
      if (!item) continue
      if (entry.isIntersecting) {
        visiblePages.add(item)
        void renderPage(item)
      } else {
        visiblePages.delete(item)
        item.task?.cancel()
        item.page.cleanup()
        item.canvas.width = 0
        item.canvas.height = 0
      }
    }
  }, { root: reader.parentElement, rootMargin: '1800px 0px' })
  pages.forEach((item) => intersectionObserver.observe(item.slot))
  resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      pages.forEach(sizePage)
      visiblePages.forEach((item) => void renderPage(item))
    }, 120)
  })
  resizeObserver.observe(shell)
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
  const chapterFiles = []
  for (const item of opf.querySelectorAll('spine itemref')) {
    const href = manifest.get(item.getAttribute('idref'))
    if (!href) continue
    const file = zip.file(base + decodeURIComponent(href))
    if (file) chapterFiles.push(file)
  }
  reader.innerHTML = '<div class="ebook-document"></div><div class="visual-loading">Cargando más capítulos…</div>'
  const shell = reader.querySelector('.ebook-document')
  const sentinel = reader.querySelector('.visual-loading')
  let nextChapter = 0
  let loading = false
  let disposed = false
  let words = 0
  const appendBatch = async () => {
    if (loading || disposed || nextChapter >= chapterFiles.length) return
    loading = true
    const end = Math.min(chapterFiles.length, nextChapter + 4)
    for (; nextChapter < end && !disposed; nextChapter += 1) {
      const html = await chapterFiles[nextChapter].async('text')
      if (disposed) break
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const chapter = document.createElement('section')
      chapter.className = 'ebook-chapter'
      chapter.innerHTML = sanitizeHtml(doc.body?.innerHTML || '')
      words += textWords(chapter.textContent)
      if (shell.childElementCount) shell.appendChild(document.createElement('hr'))
      shell.appendChild(chapter)
    }
    loading = false
    sentinel.classList.toggle('hidden', nextChapter >= chapterFiles.length)
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void appendBatch()
  }, { root: reader.parentElement, rootMargin: '1200px 0px' })
  observer.observe(sentinel)
  reader._visualCleanup = () => { disposed = true; observer.disconnect() }
  await appendBatch()
  return { words, detail: `${chapterFiles.length} capítulos · carga progresiva` }
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
  const bodyRows = rows.slice(1)
  const rowHeight = 38
  const overscan = 30
  const windowSize = 160
  reader.classList.remove('empty')
  reader.classList.add('visual-document')
  reader.innerHTML = `<div class="table-document"><table><thead><tr>${head.map((cell) => `<th>${escapeHtml(String(cell))}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`
  const scrollRoot = reader.parentElement
  const table = reader.querySelector('table')
  const body = reader.querySelector('tbody')
  let frame = 0
  let renderedStart = -1
  const renderWindow = () => {
    frame = 0
    const relativeTop = Math.max(0, scrollRoot.scrollTop - table.offsetTop)
    const start = Math.max(0, Math.floor(relativeTop / rowHeight) - overscan)
    const end = Math.min(bodyRows.length, start + windowSize)
    if (start === renderedStart) return
    renderedStart = start
    const span = Math.max(1, head.length)
    const top = start ? `<tr class="virtual-spacer" aria-hidden="true"><td colspan="${span}" style="height:${start * rowHeight}px"></td></tr>` : ''
    const visible = bodyRows.slice(start, end).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')
    const bottomRows = bodyRows.length - end
    const bottom = bottomRows ? `<tr class="virtual-spacer" aria-hidden="true"><td colspan="${span}" style="height:${bottomRows * rowHeight}px"></td></tr>` : ''
    body.innerHTML = top + visible + bottom
  }
  const scheduleRender = () => {
    if (!frame) frame = requestAnimationFrame(renderWindow)
  }
  scrollRoot.addEventListener('scroll', scheduleRender, { passive: true })
  reader._visualCleanup = () => {
    scrollRoot.removeEventListener('scroll', scheduleRender)
    if (frame) cancelAnimationFrame(frame)
  }
  renderWindow()
  return { words: rows.reduce((total, row) => total + row.length, 0), detail: `${Math.max(0, rows.length - 1)} filas · ${head.length} columnas · vista optimizada` }
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
