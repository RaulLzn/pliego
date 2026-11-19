// Etiquetas de documentos: `tags:` del frontmatter YAML y `#etiquetas` en línea.
// Todo es puro salvo el pequeño componente de la ficha del documento.

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
const TAG_KEY = /^(tags?|Tags?|TAGS?)[ \t]*:[ \t]*(.*)$/
// Una etiqueta empieza por letra (con acentos) y sigue con letras, números, _, - o / (anidadas).
const TAG_BODY = /^[\p{L}][\p{L}\p{M}\p{N}_\-/]*/u
const MAX_TAG_LENGTH = 80

function unquote(value) {
  const text = value.trim()
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))) return text.slice(1, -1)
  return text
}

export function normalizeTag(value) {
  const tag = unquote(String(value ?? '')).normalize('NFC').trim().replace(/^#+/, '').replace(/[/-]+$/, '').trim()
  return tag && tag.length <= MAX_TAG_LENGTH ? tag : ''
}

export function tagKey(tag) {
  return normalizeTag(tag).toLocaleLowerCase()
}

function splitInlineList(value) {
  return value.split(',').map(normalizeTag).filter(Boolean)
}

// Lee `tags:` como lista `[a, b]`, lista en bloque `- a` o cadena separada por comas.
export function frontmatterTags(markdown) {
  const match = String(markdown ?? '').match(FRONTMATTER)
  if (!match) return []
  const lines = match[1].split(/\r?\n/)
  const tags = []
  for (let index = 0; index < lines.length; index += 1) {
    const key = lines[index].match(TAG_KEY)
    if (!key) continue
    const value = key[2].replace(/\s+#.*$/, '').trim()
    if (value.startsWith('[')) {
      tags.push(...splitInlineList(value.replace(/^\[/, '').replace(/\].*$/, '')))
    } else if (value) {
      tags.push(...splitInlineList(value))
    } else {
      // Lista en bloque: líneas siguientes con `- valor` (indentadas o no).
      while (index + 1 < lines.length) {
        const item = lines[index + 1].match(/^[ \t]*-[ \t]+(.*)$/)
        if (!item) {
          if (!lines[index + 1].trim()) { index += 1; continue }
          break
        }
        const tag = normalizeTag(item[1].replace(/\s+#.*$/, ''))
        if (tag) tags.push(tag)
        index += 1
      }
    }
  }
  return tags
}

function bodyWithoutFrontmatter(markdown) {
  const text = String(markdown ?? '')
  const match = text.match(FRONTMATTER)
  return match ? text.slice(match[0].length) : text
}

// Quita lo que nunca debe aportar etiquetas: bloques y spans de código, HTML y destinos de enlaces.
function stripNonProse(body) {
  const lines = body.split(/\r?\n/)
  const kept = []
  let fence = ''
  for (const line of lines) {
    const opener = line.match(/^[ ]{0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length && !line.slice(line.indexOf(opener[1]) + opener[1].length).trim()) fence = ''
      kept.push('')
      continue
    }
    if (opener) { fence = opener[1]; kept.push(''); continue }
    kept.push(line)
  }
  return kept.join('\n')
    .replace(/(`+)[\s\S]*?\1/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>\n]*>/g, ' ')
    .replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '] ')
    .replace(/\[\[[^\]\n]*\]\]/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
}

// `#etiqueta` en línea: solo al inicio o tras espacio/puntuación de apertura, nunca `# Título`.
export function inlineTags(markdown) {
  const text = stripNonProse(bodyWithoutFrontmatter(markdown))
  const tags = []
  const pattern = /(^|[\s(¡¿"'«])#(?=[\p{L}])/gu
  let match
  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].length
    const body = text.slice(start).match(TAG_BODY)
    const tag = body ? normalizeTag(body[0]) : ''
    if (tag) tags.push(tag)
  }
  return tags
}

// Etiquetas únicas (sin distinguir mayúsculas) conservando la primera forma escrita.
export function extractTags(markdown) {
  const seen = new Map()
  for (const tag of [...frontmatterTags(markdown), ...inlineTags(markdown)]) {
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) seen.set(key, tag)
  }
  return [...seen.values()]
}

const entryCache = new WeakMap()

export function tagsForEntry(entry) {
  if (!entry || entry.kind !== 'markdown') return []
  const cached = entryCache.get(entry)
  if (cached && cached.text === entry.searchableText) return cached.tags
  const tags = extractTags(entry.searchableText || '')
  entryCache.set(entry, { text: entry.searchableText, tags })
  return tags
}

// `#eti` lista los documentos con una etiqueta que empieza así; las exactas o anidadas primero.
export function parseTagQuery(query) {
  const match = String(query ?? '').trim().match(/^#(\S.*)$/u)
  return match ? tagKey(match[1]) : null
}

export function filterByTag(entries, query, limit = 100) {
  const wanted = typeof query === 'string' && query.startsWith('#') ? parseTagQuery(query) : tagKey(query)
  if (!wanted) return []
  const scored = []
  for (const entry of entries || []) {
    const keys = tagsForEntry(entry).map((tag) => tag.toLocaleLowerCase())
    let score = 0
    for (const key of keys) {
      if (key === wanted || key.startsWith(`${wanted}/`)) score = Math.max(score, 2)
      else if (key.startsWith(wanted)) score = Math.max(score, 1)
    }
    if (score) scored.push({ entry, score })
  }
  return scored.sort((left, right) => right.score - left.score).slice(0, limit).map((item) => item.entry)
}

// Ficha clicable bajo el nombre del documento; clic → filtra la paleta por esa etiqueta.
export function createFileTags({ anchor, onSelect, label = () => 'Etiquetas' }) {
  const box = document.createElement('div')
  box.className = 'file-tags hidden'
  box.setAttribute('role', 'list')
  anchor.after(box)
  box.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tag]')
    if (button) onSelect(button.dataset.tag)
  })
  return {
    update(markdown, isMarkdown) {
      const tags = isMarkdown ? extractTags(markdown) : []
      box.replaceChildren(...tags.map((tag) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'file-tag'
        button.dataset.tag = tag
        button.setAttribute('role', 'listitem')
        button.textContent = `#${tag}`
        return button
      }))
      box.setAttribute('aria-label', label())
      box.classList.toggle('hidden', tags.length === 0)
    },
  }
}
