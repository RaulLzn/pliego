import './document-search.css'
import { findMatches, foldWithMap, normalizeQuery } from './search-text.js'

// Un término puede cruzar etiquetas en línea (<strong>, <mark class="hl">…) pero
// no saltar de un párrafo a otro: el texto se concatena por bloque.
const BLOCK_SELECTOR = 'p, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, figcaption, caption, summary, section, article, aside, header, footer, div'
const SKIPPED_SELECTOR = 'script, style, noscript, textarea, svg'
const YIELD_EVERY_PAGES = 12

function textSegments(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const segments = []
  let current = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || !node.nodeValue || parent.closest(SKIPPED_SELECTOR)) continue
    const block = parent.closest(BLOCK_SELECTOR) || root
    if (!current || current.block !== block) {
      current = { block, nodes: [], text: '' }
      segments.push(current)
    }
    current.nodes.push(node)
    current.text += node.nodeValue
  }
  return segments
}

function wrapNode(node, pieces, groups) {
  const text = node.nodeValue
  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const piece of pieces) {
    if (piece.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, piece.start)))
    const mark = document.createElement('mark')
    mark.setAttribute('data-pliego-search', '1')
    mark.textContent = text.slice(piece.start, piece.end)
    fragment.appendChild(mark)
    groups[piece.group].push(mark)
    cursor = piece.end
  }
  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
  node.parentNode?.replaceChild(fragment, node)
}

// Envuelve cada coincidencia en uno o varios <mark> (uno por nodo de texto que
// toca) y devuelve una lista de grupos: cada grupo es UNA coincidencia.
export function highlightMatches(root, term) {
  const query = normalizeQuery(term)
  if (!query) return []
  const groups = []
  for (const segment of textSegments(root)) {
    const matches = findMatches(segment.text, query)
    if (!matches.length) continue
    const firstGroup = groups.length
    matches.forEach(() => groups.push([]))
    let nodeStart = 0
    let matchIndex = 0
    for (const node of segment.nodes) {
      const nodeEnd = nodeStart + node.nodeValue.length
      const pieces = []
      while (matchIndex < matches.length && matches[matchIndex].end <= nodeStart) matchIndex += 1
      for (let index = matchIndex; index < matches.length && matches[index].start < nodeEnd; index += 1) {
        const start = Math.max(matches[index].start, nodeStart) - nodeStart
        const end = Math.min(matches[index].end, nodeEnd) - nodeStart
        if (end > start) pieces.push({ start, end, group: firstGroup + index })
      }
      if (pieces.length) wrapNode(node, pieces, groups)
      nodeStart = nodeEnd
    }
  }
  return groups.filter((group) => group.length)
}

// ---------- PDF: texto extraído con getTextContent (no hay capa de texto) ----------

const pdfTextCache = new WeakMap()

function pdfPageText(source, pageNumber) {
  let cache = pdfTextCache.get(source)
  if (!cache) {
    cache = new Map()
    pdfTextCache.set(source, cache)
  }
  if (!cache.has(pageNumber)) {
    const promise = source.getPage(pageNumber).getTextContent().then((content) => {
      let text = ''
      const items = []
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        const start = text.length
        text += item.str
        if (item.str) items.push({ start, end: text.length, str: item.str, font: content.styles?.[item.fontName]?.fontFamily || 'sans-serif', transform: item.transform, width: item.width, height: item.height })
        if (item.hasEOL) text += '\n'
      }
      return { mapped: foldWithMap(text), items }
    })
    // Si falla (documento destruido), que el siguiente intento lo repita.
    promise.catch(() => cache.delete(pageNumber))
    cache.set(pageNumber, promise)
  }
  return cache.get(pageNumber)
}

let measureContext = null

// Fracción del ancho del fragmento que ocupan sus primeros `count` caracteres,
// medida con una fuente parecida; sin canvas, en proporción a los caracteres.
function widthFraction(item, count) {
  const length = item.end - item.start
  if (count <= 0) return 0
  if (count >= length) return 1
  measureContext ??= document.createElement('canvas').getContext('2d')
  if (!measureContext) return count / length
  measureContext.font = `100px ${item.font}`
  const total = measureContext.measureText(item.str).width
  return total > 0 ? measureContext.measureText(item.str.slice(0, count)).width / total : count / length
}

// Rectángulos aproximados (en % de la página) de una coincidencia: pdf.js da
// la posición y el ancho de cada fragmento, no de cada carácter.
function pdfMatchRects(source, match, items) {
  const viewport = source.getPage(match.page).getViewport({ scale: 1 })
  const rects = []
  for (const item of items) {
    if (item.end <= match.start || item.start >= match.end || !item.transform) continue
    const length = item.end - item.start
    const from = widthFraction(item, Math.max(match.start, item.start) - item.start)
    const to = widthFraction(item, Math.min(match.end, item.end) - item.start)
    const [, , c, d, e, f] = item.transform
    const size = Math.hypot(c, d) || item.height || 10
    const width = item.width || size * length * 0.5
    // convertToViewportRectangle ya no existe en pdf.js 6: se convierten las dos esquinas.
    const [x1, y1] = viewport.convertToViewportPoint(e + width * from, f - size * 0.22)
    const [x2, y2] = viewport.convertToViewportPoint(e + width * to, f + size * 0.9)
    rects.push({
      left: (Math.min(x1, x2) / viewport.width) * 100,
      top: (Math.min(y1, y2) / viewport.height) * 100,
      width: (Math.abs(x2 - x1) / viewport.width) * 100,
      height: (Math.abs(y2 - y1) / viewport.height) * 100,
    })
  }
  return rects
}

// ---------- Controlador del cuadro de búsqueda ----------

export function createDocumentSearch({ reader, stats, clearHighlights, onChange = () => {} }) {
  let matches = []
  let active = -1
  let runId = 0
  let mode = 'dom'
  let pending = false

  function setStats() {
    const suffix = pending ? '…' : ''
    if (!matches.length) stats.textContent = pending ? '…' : '0'
    else stats.textContent = active >= 0 ? `${active + 1}/${matches.length}${suffix}` : `${matches.length}${suffix}`
  }

  function clearPdfHits() {
    reader.querySelectorAll('.pdf-search-hit').forEach((hit) => hit.remove())
  }

  function reset() {
    runId += 1
    pending = false
    matches = []
    active = -1
    mode = 'dom'
    clearPdfHits()
    setStats()
  }

  function run(term, { scroll = true } = {}) {
    const id = ++runId
    pending = false
    clearHighlights()
    clearPdfHits()
    matches = []
    active = -1
    const query = String(term ?? '').trim()
    const source = reader._searchSource
    mode = source?.type === 'pdf' ? 'pdf' : 'dom'
    if (!query) {
      setStats()
      onChange()
      return
    }
    if (mode === 'pdf') {
      void runPdf(source, query, id, scroll)
      return
    }
    if (source?.prepare && !source.isComplete()) {
      // EPUB con capítulos pendientes: se cargan todos antes de buscar.
      pending = true
      setStats()
      onChange()
      source.prepare().catch(() => {}).finally(() => {
        if (id !== runId || reader._searchSource !== source) return
        pending = false
        clearHighlights()
        runDom(query, scroll)
      })
      return
    }
    runDom(query, scroll)
  }

  function runDom(query, scroll) {
    matches = highlightMatches(reader, query)
    if (matches.length) activate(0, { scroll })
    else setStats()
    onChange()
  }

  async function runPdf(source, query, id, scroll) {
    pending = true
    setStats()
    const cancelled = () => id !== runId || source.isDisposed() || reader._searchSource !== source
    for (let page = 1; page <= source.numPages; page += 1) {
      let text
      try {
        text = await pdfPageText(source, page)
      } catch (_) {
        if (cancelled()) return
        continue
      }
      if (cancelled()) return
      for (const match of findMatches('', query, { mapped: text.mapped })) matches.push({ page, start: match.start, end: match.end })
      if (active === -1 && matches.length) activate(0, { scroll })
      else setStats()
      // Ceder el hilo de vez en cuando: con todo en caché el bucle no espera al worker.
      if (page % YIELD_EVERY_PAGES === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelled()) return
    }
    pending = false
    setStats()
  }

  async function showPdfMatch(source, index, scroll) {
    clearPdfHits()
    const match = matches[index]
    const slot = source.slot(match.page)
    if (!slot) return
    let text
    try { text = await pdfPageText(source, match.page) } catch (_) { return }
    if (matches[active] !== match || source.isDisposed()) return
    let first = null
    matches.forEach((candidate, position) => {
      if (candidate.page !== match.page) return
      let rects = []
      // Si la geometría falla, al menos se salta a la página correcta.
      try { rects = pdfMatchRects(source, candidate, text.items) } catch (_) {}
      for (const rect of rects) {
        const hit = document.createElement('div')
        hit.className = position === index ? 'pdf-search-hit active-match' : 'pdf-search-hit'
        hit.style.left = `${rect.left}%`
        hit.style.top = `${rect.top}%`
        hit.style.width = `${rect.width}%`
        hit.style.height = `${rect.height}%`
        slot.appendChild(hit)
        if (position === index && !first) first = hit
      }
    })
    // Salto instantáneo: el scroll suave se corta cuando las páginas que cruza
    // se pintan por el camino y en PDF largos se quedaba a medias.
    if (scroll) (first || slot).scrollIntoView({ behavior: 'auto', block: first ? 'center' : 'start' })
  }

  function activate(index, { scroll = true } = {}) {
    if (mode === 'pdf') {
      active = index
      setStats()
      const source = reader._searchSource
      if (source?.type === 'pdf') void showPdfMatch(source, index, scroll)
      return
    }
    matches[active]?.forEach((mark) => mark.classList.remove('active-match'))
    active = index
    const group = matches[index]
    group.forEach((mark) => mark.classList.add('active-match'))
    if (scroll) group[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
    setStats()
  }

  function step(direction, term) {
    if (mode === 'dom' && matches.some((group) => group.some((mark) => !mark.isConnected))) run(term, { scroll: false })
    if (!matches.length) return
    activate((active + direction + matches.length) % matches.length)
  }

  return { run, step, reset }
}
