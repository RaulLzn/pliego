import './reading-progress.css'
import { countWords, formatPdfPage, formatPercent, formatReadingSummary, pdfProgress, progressFromPosition, scrollProgress } from './reading-stats.js'

const THROTTLE_MS = 200
// Formatos donde el texto está entero en el DOM y el scroll mide bien lo leído.
const SCROLL_KINDS = new Set(['markdown', 'text', 'docx'])

// Muestra «N min · X % leído» bajo los datos del archivo y el % en Recientes.
export function createReadingProgress({ reader, readerWrap, anchor, recentsBox, readingSession, getDocument, getLanguage, labels = () => ({}) }) {
  const line = document.createElement('p')
  line.className = 'muted reading-progress-meta hidden'
  anchor.insertAdjacentElement('afterend', line)

  let wordsSource = null
  let wordsCount = 0
  let timer = 0
  let lastRun = 0

  function words(markdown) {
    if (markdown !== wordsSource) {
      wordsSource = markdown
      wordsCount = countWords(markdown)
    }
    return wordsCount
  }

  function pdfPosition() {
    const slots = reader.querySelectorAll('.pdf-page-slot[data-page-number]')
    if (!slots.length) return null
    const rootTop = readerWrap.getBoundingClientRect().top
    let slot = slots[slots.length - 1]
    for (const candidate of slots) {
      if (candidate.getBoundingClientRect().bottom > rootTop) {
        slot = candidate
        break
      }
    }
    const page = Number(slot.dataset.pageNumber)
    const rect = slot.getBoundingClientRect()
    if (!Number.isInteger(page) || page < 1 || !(rect.height > 0)) return null
    const offset = Math.max(0, Math.min(1, (rootTop - rect.top) / rect.height))
    // Al final del documento la última página puede no llegar arriba del todo.
    const atEnd = readerWrap.scrollTop + readerWrap.clientHeight >= readerWrap.scrollHeight - 2
    const total = slots.length
    const progress = atEnd ? 1 : pdfProgress(page, offset, total)
    return { page, offset, total, progress }
  }

  // Posición actual para guardarla en la sesión de lectura (incluye el progreso).
  function currentPosition(kind) {
    if (kind === 'pdf') {
      const position = pdfPosition()
      if (position) return { page: position.page, offset: position.offset, progress: position.progress }
    }
    const top = Math.max(0, readerWrap.scrollTop)
    const progress = SCROLL_KINDS.has(kind) ? scrollProgress(top, readerWrap.scrollHeight, readerWrap.clientHeight) : null
    return progress === null ? { top } : { top, progress }
  }

  function summary(doc) {
    const language = getLanguage()
    const text = labels()
    if (doc.kind === 'pdf') {
      const position = pdfPosition()
      if (!position) return { text: '', progress: null }
      const page = formatPdfPage(position.page, position.total, { language, labels: text })
      const share = formatReadingSummary({ progress: position.progress, language, labels: text })
      return { text: [page, share].filter(Boolean).join(' · '), progress: position.progress }
    }
    if (!SCROLL_KINDS.has(doc.kind)) return { text: '', progress: null }
    const count = doc.kind === 'docx' ? Number(doc.visualInfo?.words) || 0 : words(doc.markdown || '')
    const progress = scrollProgress(readerWrap.scrollTop, readerWrap.scrollHeight, readerWrap.clientHeight)
    return { text: formatReadingSummary({ words: count, progress, language, labels: text }), progress }
  }

  function updateRecentBadge(path, progress) {
    if (!recentsBox || !path) return
    for (const button of recentsBox.querySelectorAll('[data-path]')) {
      if (button.dataset.path !== path) continue
      let badge = button.querySelector('.recent-progress')
      const value = formatPercent(progress, getLanguage())
      if (!value) {
        badge?.remove()
        continue
      }
      if (!badge) {
        badge = document.createElement('span')
        badge.className = 'recent-progress'
        button.appendChild(badge)
      }
      badge.textContent = value
    }
  }

  function refresh() {
    clearTimeout(timer)
    timer = 0
    lastRun = Date.now()
    const doc = getDocument()
    if (!doc?.path || doc.loading) {
      line.textContent = ''
      line.classList.add('hidden')
      return
    }
    const { text, progress } = summary(doc)
    line.textContent = text
    line.classList.toggle('hidden', !text)
    if (progress !== null) updateRecentBadge(doc.path, progress)
  }

  function scheduleRefresh() {
    if (timer) return
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun))
    timer = setTimeout(refresh, wait)
  }

  readerWrap.addEventListener('scroll', scheduleRefresh, { passive: true })

  // HTML de la insignia de progreso de un reciente (vacío si no hay dato).
  function recentBadge(path) {
    const value = formatPercent(progressFromPosition(readingSession.getPosition(path)), getLanguage())
    return value ? `<span class="recent-progress">${value}</span>` : ''
  }

  return { refresh, currentPosition, recentBadge }
}
