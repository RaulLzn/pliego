// Genera el resumen Markdown de resaltados y notas de un documento. Puro y testeable.
import { resolveTextAnchor } from './annotations.js'

const COLOR_NAMES = {
  es: { yellow: 'amarillo', green: 'verde', pink: 'rosa', blue: 'azul' },
  en: { yellow: 'yellow', green: 'green', pink: 'pink', blue: 'blue' },
}

const LABELS = {
  es: {
    heading: 'Resaltados', document: 'Documento', exported: 'Exportado', summary: (h, n) => `${h} ${h === 1 ? 'resaltado' : 'resaltados'} · ${n} ${n === 1 ? 'nota' : 'notas'}`,
    item: 'Resaltado', color: 'Color', note: 'Nota', source: 'Fuente', orphans: 'Notas sin fragmento',
    orphanHint: 'El texto original cambió o el resaltado se quitó; se conserva la cita guardada.',
  },
  en: {
    heading: 'Highlights', document: 'Document', exported: 'Exported', summary: (h, n) => `${h} ${h === 1 ? 'highlight' : 'highlights'} · ${n} ${n === 1 ? 'note' : 'notes'}`,
    item: 'Highlight', color: 'Color', note: 'Note', source: 'Source', orphans: 'Notes without a passage',
    orphanHint: 'The original text changed or the highlight was removed; the saved quote is kept.',
  },
}

// Nombre válido para create_markdown_file: sin caracteres prohibidos y con margen para el sufijo ` (n)`.
export function exportFileStem(fileName, language = 'es') {
  const stem = Array.from(String(fileName || '').replace(/\.(md|markdown|mdown|mkd)$/i, '').replace(/[\u0000-\u001f/\\<>:"|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '')).slice(0, 90).join('').trim() || 'documento'
  return `${stem} - ${language === 'en' ? 'highlights' : 'resaltados'}`
}

export function wikiTarget(fileName) {
  // Los wiki-links no admiten `[]|#`; se sustituyen para que el enlace siga resolviendo por nombre.
  return String(fileName || '').replace(/\.(md|markdown|mdown|mkd)$/i, '').replace(/[[\]|#^]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function formatExportDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// La cita es texto plano del lector: se escapa para que no se convierta en formato o HTML.
export function escapeMarkdownText(text) {
  return String(text ?? '')
    .replace(/[\\`*_[\]<>~|]/g, '\\$&')
    .split('\n')
    .map((line) => line.replace(/^(\s*)([#+=-]|\d+[.)])(?=\s|$)/, (_, space, marker) => `${space}\\${marker}`))
    .join('\n')
}

function blockquote(text) {
  return String(text).replace(/\r\n?/g, '\n').trim().split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n')
}

/**
 * Empareja grupos de resaltado (en orden del documento) con sus notas, igual que el panel.
 * Devuelve { items: [{ quote, color, notes: [texto] }], orphans: [{ quote, notes }] }.
 */
export function collectExportEntries({ text = '', groups = [], annotations = [] }) {
  const items = groups.map((group) => ({ quote: group.quote, color: group.color || 'yellow', start: group.start, end: group.end, notes: [] }))
  const orphans = []
  for (const annotation of annotations || []) {
    const resolved = resolveTextAnchor(text, annotation.anchor)
    const item = resolved.status === 'resolved' ? items.find((entry) => entry.start === resolved.start && entry.end === resolved.end) : null
    if (item) item.notes.push(annotation.text)
    else orphans.push({ quote: annotation.anchor?.quote || '', notes: [annotation.text] })
  }
  return { items: items.map(({ quote, color, notes }) => ({ quote, color, notes })), orphans }
}

export function buildHighlightsMarkdown({ fileName, items = [], orphans = [], date = new Date(), language = 'es' }) {
  const lang = language === 'en' ? 'en' : 'es'
  const labels = LABELS[lang]
  const target = wikiTarget(fileName) || 'documento'
  const link = `[[${target}]]`
  const noteCount = items.reduce((total, item) => total + item.notes.length, 0) + orphans.reduce((total, item) => total + item.notes.length, 0)
  const lines = [
    `# ${labels.heading}: ${escapeMarkdownText(target)}`,
    '',
    `- **${labels.document}:** ${link}`,
    `- **${labels.exported}:** ${formatExportDate(date)}`,
    `- ${labels.summary(items.length, noteCount)}`,
  ]
  items.forEach((item, index) => {
    lines.push('', `## ${labels.item} ${index + 1}`, '', blockquote(escapeMarkdownText(item.quote)), '')
    lines.push(`- **${labels.color}:** ${COLOR_NAMES[lang][item.color] || item.color}`)
    for (const note of item.notes) lines.push(`- **${labels.note}:** ${indentContinuation(note)}`)
    lines.push(`- **${labels.source}:** ${link}`)
  })
  if (orphans.length) {
    lines.push('', `## ${labels.orphans}`, '', `_${labels.orphanHint}_`)
    for (const orphan of orphans) {
      lines.push('')
      if (orphan.quote.trim()) lines.push(blockquote(escapeMarkdownText(orphan.quote)), '')
      for (const note of orphan.notes) lines.push(`- **${labels.note}:** ${indentContinuation(note)}`)
      lines.push(`- **${labels.source}:** ${link}`)
    }
  }
  return `${lines.join('\n')}\n`
}

// Una nota de varias líneas sigue dentro del mismo elemento de lista.
function indentContinuation(text) {
  return String(text).replace(/\r\n?/g, '\n').trim().split('\n').map((line, index) => (index === 0 || !line.trim() ? line : `  ${line}`)).join('\n')
}
