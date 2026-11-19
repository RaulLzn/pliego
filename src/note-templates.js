// Plantillas de página y nota diaria: lógica pura (sin DOM) para poder probarla.

export const TEMPLATES_FOLDER = 'Plantillas'
export const DAILY_FOLDER = 'Diario'
export const DAILY_TEMPLATE = 'Diario.md'

const pad = (value) => String(value).padStart(2, '0')

export const formatDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const formatTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

// Admite los nombres en español y en inglés, con o sin tilde y espacios: {{ fecha }}.
const VARIABLE = /\{\{\s*(t[ií]tulo|title|fecha|date|hora|time)\s*\}\}/gi

export function fillTemplate(text, { title = '', date = new Date() } = {}) {
  const values = { titulo: title, título: title, title, fecha: formatDate(date), date: formatDate(date), hora: formatTime(date), time: formatTime(date) }
  return String(text || '').replace(VARIABLE, (_, name) => values[name.toLowerCase()])
}

const slashes = (path) => String(path || '').replaceAll('\\', '/').replace(/\/+$/, '')

// Plantillas = Markdown directamente dentro de <biblioteca>/Plantillas (sin subcarpetas).
export function templatesInLibrary(index, folder) {
  const prefix = `${slashes(folder)}/${TEMPLATES_FOLDER}/`.toLowerCase()
  return (Array.isArray(index) ? index : [])
    .filter((entry) => {
      const path = slashes(entry.path)
      const rest = path.slice(prefix.length)
      return entry.kind === 'markdown' && path.toLowerCase().startsWith(prefix) && rest && !rest.includes('/') && /\.md$/i.test(rest)
    })
    .map((entry) => ({ name: entry.name.replace(/\.md$/i, ''), path: entry.path }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function dailyTemplatePath(index, folder) {
  return templatesInLibrary(index, folder).find((template) => `${template.name}.md`.toLowerCase() === DAILY_TEMPLATE.toLowerCase())?.path || null
}

// La nota diaria se llama como la fecha; `title` es lo que recibe create_markdown_file.
export function dailyNote(date = new Date()) {
  return { title: formatDate(date), subfolder: DAILY_FOLDER }
}
