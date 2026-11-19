// Cálculos puros de tiempo de lectura y progreso (sin DOM, probados con node --test).

export const WORDS_PER_MINUTE = 220

export function countWords(text) {
  const source = String(text ?? '').trim()
  return source ? source.split(/\s+/).length : 0
}

export function readingMinutes(words, wordsPerMinute = WORDS_PER_MINUTE) {
  if (!Number.isFinite(words) || words <= 0) return 0
  return Math.max(1, Math.round(words / wordsPerMinute))
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

// Un documento que cabe entero en pantalla está leído; si no, la fracción
// recorrida del scroll.
export function scrollProgress(scrollTop, scrollHeight, clientHeight) {
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite)) return null
  const range = scrollHeight - clientHeight
  if (range <= 1) return 1
  return clamp01(scrollTop / range)
}

export function pdfProgress(page, offset, numPages) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(numPages) || numPages < 1) return null
  if (page >= numPages && offset >= 0.999) return 1
  return clamp01((Math.min(page, numPages) - 1 + clamp01(Number(offset) || 0)) / numPages)
}

// La posición guardada por reading-session puede traer `progress` (0..1).
export function progressFromPosition(position) {
  const value = position?.progress
  return Number.isFinite(value) ? clamp01(value) : null
}

export function percent(progress) {
  if (!Number.isFinite(progress)) return null
  return Math.round(clamp01(progress) * 100)
}

export function formatPercent(progress, language = 'es') {
  const value = percent(progress)
  if (value === null) return ''
  // La RAE separa el signo % con espacio (fino, para que no se parta la línea).
  return language === 'en' ? `${value}%` : `${value}\u202f%`
}

const DEFAULT_LABELS = {
  es: { minutes: '{n} min', read: '{percent} leído', page: 'Página {page} de {total}' },
  en: { minutes: '{n} min', read: '{percent} read', page: 'Page {page} of {total}' },
}

export function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (Object.hasOwn(values, key) ? String(values[key]) : whole))
}

function labelsFor(language, labels) {
  return { ...(DEFAULT_LABELS[language] || DEFAULT_LABELS.es), ...(labels || {}) }
}

export function formatReadingSummary({ words = 0, progress = null, language = 'es', labels } = {}) {
  const text = labelsFor(language, labels)
  const parts = []
  const minutes = readingMinutes(words)
  if (minutes) parts.push(fillTemplate(text.minutes, { n: minutes }))
  const share = formatPercent(progress, language)
  if (share) parts.push(fillTemplate(text.read, { percent: share }))
  return parts.join(' · ')
}

export function formatPdfPage(page, numPages, { language = 'es', labels } = {}) {
  if (!Number.isInteger(page) || !Number.isInteger(numPages) || page < 1 || numPages < 1) return ''
  return fillTemplate(labelsFor(language, labels).page, { page: Math.min(page, numPages), total: numPages })
}
