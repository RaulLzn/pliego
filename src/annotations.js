export const ANNOTATIONS_VERSION = 1
export const ANNOTATIONS_KEY_PREFIX = 'pliego-annotations-v1:'

const CONTEXT_LENGTH = 64
const MAX_COMMENT_LENGTH = 20_000
const MAX_QUOTE_LENGTH = 250_000
const MAX_ANNOTATIONS = 2_000

const LABELS = {
  es: {
    title: 'Resaltados y notas', close: 'Cerrar notas', count: 'notas', unavailable: 'Los resaltados y las notas están disponibles en documentos Markdown.',
    openDocument: 'Abre un documento Markdown para ver sus resaltados y notas.', noHighlights: 'Aún no hay resaltados. Selecciona texto y usa el marcador para resaltar.',
    noNotes: 'Sin nota. Escribe un comentario junto al fragmento.', addPlaceholder: 'Escribe una nota sobre este fragmento…', editPlaceholder: 'Comentario sobre el fragmento',
    add: 'Añadir nota', save: 'Guardar', delete: 'Borrar', jump: 'Ir al fragmento resaltado', orphan: 'Fragmento no disponible',
    orphanHint: 'El texto original cambió, el resaltado se quitó o ya no se puede identificar con seguridad. La nota se conserva aquí.',
    saved: 'Nota guardada.', saveFailed: 'No se pudo guardar la nota. El borrador sigue disponible en este panel.',
    corrupt: 'El almacén de notas no se puede leer. Se conserva intacto y no se escribirán cambios para evitar perder datos.',
    storageUnavailable: 'El almacenamiento local no está disponible. No cierres este panel hasta copiar tu borrador.',
    emptyComment: 'Escribe un comentario antes de guardarlo.', deleteConfirm: '¿Borrar esta nota? Esta acción no se puede deshacer.',
  },
  en: {
    title: 'Highlights and notes', close: 'Close notes', count: 'notes', unavailable: 'Highlights and notes are available for Markdown documents.',
    openDocument: 'Open a Markdown document to view its highlights and notes.', noHighlights: 'No highlights yet. Select text and use the marker to highlight it.',
    noNotes: 'No note yet. Write a comment beside this passage.', addPlaceholder: 'Write a note about this passage…', editPlaceholder: 'Comment on this passage',
    add: 'Add note', save: 'Save', delete: 'Delete', jump: 'Go to highlighted passage', orphan: 'Passage unavailable',
    orphanHint: 'The original text changed, the highlight was removed, or it can no longer be identified safely. The note is preserved here.',
    saved: 'Note saved.', saveFailed: 'The note could not be saved. Its draft is still available in this panel.',
    corrupt: 'The notes store cannot be read. It is preserved unchanged, and writes are disabled to prevent data loss.',
    storageUnavailable: 'Local storage is unavailable. Copy your draft before closing this panel.',
    emptyComment: 'Write a comment before saving it.', deleteConfirm: 'Delete this note? This action cannot be undone.',
  },
}

export function annotationText(language, key) {
  return LABELS[language === 'en' ? 'en' : 'es'][key] || LABELS.es[key] || key
}

export function annotationDocumentKey(path, fileName = '') {
  const normalizedPath = String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  return normalizedPath ? `path:${normalizedPath}` : `name:${String(fileName || 'untitled').trim() || 'untitled'}`
}

function hashKey(value) {
  let hash = 0x811c9dc5
  for (const character of String(value)) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function annotationStorageKey(documentKey) {
  return `${ANNOTATIONS_KEY_PREFIX}${hashKey(documentKey)}`
}

export function annotationDraftKey(documentKey, itemKey) {
  return `${String(documentKey || '')}:${String(itemKey || '')}`
}

export function createTextAnchor(text, start, end) {
  const source = String(text ?? '')
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > source.length) return null
  const quote = source.slice(start, end)
  if (!quote.trim() || quote.length > MAX_QUOTE_LENGTH) return null
  return {
    quote,
    prefix: source.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: source.slice(end, Math.min(source.length, end + CONTEXT_LENGTH)),
    position: start,
  }
}

function allOccurrences(text, quote) {
  const starts = []
  let cursor = 0
  while (cursor <= text.length - quote.length) {
    const start = text.indexOf(quote, cursor)
    if (start < 0) break
    starts.push(start)
    cursor = start + Math.max(quote.length, 1)
  }
  return starts
}

export function resolveTextAnchor(text, anchor) {
  const source = String(text ?? '')
  if (!anchor || typeof anchor.quote !== 'string' || !anchor.quote || anchor.quote.length > MAX_QUOTE_LENGTH) {
    return { status: 'orphan', reason: 'invalid' }
  }
  const starts = allOccurrences(source, anchor.quote)
  if (starts.length === 0) return { status: 'orphan', reason: 'missing' }

  const prefix = typeof anchor.prefix === 'string' ? anchor.prefix : ''
  const suffix = typeof anchor.suffix === 'string' ? anchor.suffix : ''
  const contextual = starts.filter((start) => {
    const end = start + anchor.quote.length
    return source.slice(Math.max(0, start - prefix.length), start) === prefix
      && source.slice(end, end + suffix.length) === suffix
  })

  if (contextual.length === 1) return { status: 'resolved', start: contextual[0], end: contextual[0] + anchor.quote.length }
  if (contextual.length > 1 && Number.isSafeInteger(anchor.position)) {
    const exactPosition = contextual.filter((start) => start === anchor.position)
    if (exactPosition.length === 1) return { status: 'resolved', start: exactPosition[0], end: exactPosition[0] + anchor.quote.length }
  }
  return { status: 'orphan', reason: contextual.length > 1 ? 'ambiguous' : 'context-changed' }
}

function validAnchor(anchor) {
  return Boolean(anchor
    && typeof anchor.quote === 'string'
    && anchor.quote.length > 0
    && anchor.quote.length <= MAX_QUOTE_LENGTH
    && typeof anchor.prefix === 'string'
    && anchor.prefix.length <= CONTEXT_LENGTH
    && typeof anchor.suffix === 'string'
    && anchor.suffix.length <= CONTEXT_LENGTH
    && Number.isSafeInteger(anchor.position)
    && anchor.position >= 0)
}

function validAnnotation(annotation) {
  return Boolean(annotation
    && typeof annotation.id === 'string'
    && annotation.id.length > 0
    && annotation.id.length <= 100
    && validAnchor(annotation.anchor)
    && typeof annotation.text === 'string'
    && annotation.text.length > 0
    && annotation.text.length <= MAX_COMMENT_LENGTH
    && Number.isFinite(annotation.createdAt)
    && Number.isFinite(annotation.updatedAt))
}

export function emptyAnnotationDocument(documentKey) {
  return { version: ANNOTATIONS_VERSION, documentKey, annotations: [] }
}

export function decodeAnnotationDocument(raw, expectedDocumentKey) {
  if (raw == null) return { status: 'ok', value: emptyAnnotationDocument(expectedDocumentKey) }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_) {
    return { status: 'corrupt', value: null }
  }
  if (!parsed || parsed.version !== ANNOTATIONS_VERSION || parsed.documentKey !== expectedDocumentKey || !Array.isArray(parsed.annotations) || parsed.annotations.length > MAX_ANNOTATIONS) {
    return { status: 'corrupt', value: null }
  }
  const ids = new Set()
  for (const annotation of parsed.annotations) {
    if (!validAnnotation(annotation) || ids.has(annotation.id)) return { status: 'corrupt', value: null }
    ids.add(annotation.id)
  }
  return { status: 'ok', value: parsed }
}

export function readAnnotationDocument(storage, documentKey) {
  try {
    return decodeAnnotationDocument(storage.getItem(annotationStorageKey(documentKey)), documentKey)
  } catch (_) {
    return { status: 'unavailable', value: null }
  }
}

export function writeAnnotationDocument(storage, document) {
  if (!document
    || document.version !== ANNOTATIONS_VERSION
    || typeof document.documentKey !== 'string'
    || document.documentKey.length === 0
    || document.documentKey.length > 16_384
    || !Array.isArray(document.annotations)
    || document.annotations.length > MAX_ANNOTATIONS) {
    return { status: 'invalid' }
  }
  const ids = new Set()
  for (const annotation of document.annotations) {
    if (!validAnnotation(annotation) || ids.has(annotation.id)) return { status: 'invalid' }
    ids.add(annotation.id)
  }
  try {
    storage.setItem(annotationStorageKey(document.documentKey), JSON.stringify(document))
    return { status: 'ok' }
  } catch (_) {
    return { status: 'unavailable' }
  }
}

export function makeAnnotation(anchor, text, now = Date.now(), id = createId()) {
  const comment = String(text ?? '')
  if (!validAnchor(anchor) || !comment.trim() || comment.length > MAX_COMMENT_LENGTH) return null
  return { id, anchor: { ...anchor }, text: comment, createdAt: now, updatedAt: now }
}

function createId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch (_) { /* Use a local fallback when Web Crypto is unavailable. */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function indexReaderText(reader) {
  const documentRef = reader.ownerDocument || document
  const walker = documentRef.createTreeWalker(reader, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentName = node.parentElement?.tagName?.toLowerCase()
      return parentName === 'script' || parentName === 'style' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  const positions = new Map()
  const chunks = []
  let length = 0
  let node = walker.nextNode()
  while (node) {
    const value = node.nodeValue || ''
    positions.set(node, { start: length, end: length + value.length })
    chunks.push(value)
    length += value.length
    node = walker.nextNode()
  }
  return { text: chunks.join(''), positions }
}

function markTextBounds(mark, positions) {
  const documentRef = mark.ownerDocument
  const walker = documentRef.createTreeWalker(mark, NodeFilter.SHOW_TEXT)
  let start = Infinity
  let end = -Infinity
  let node = walker.nextNode()
  while (node) {
    const position = positions.get(node)
    if (position) {
      start = Math.min(start, position.start)
      end = Math.max(end, position.end)
    }
    node = walker.nextNode()
  }
  return Number.isFinite(start) && end > start ? { start, end } : null
}

function blockForMark(mark) {
  return mark.closest('p, li, blockquote, td, th, pre, h1, h2, h3, h4, h5, h6, div, section') || mark.parentElement
}

export function collectHighlightGroups(reader) {
  if (!reader?.querySelectorAll) return { text: '', groups: [] }
  const indexed = indexReaderText(reader)
  const marks = Array.from(reader.querySelectorAll('mark.hl:not([data-pliego-search])'))
  const fragments = marks.map((element) => {
    const bounds = markTextBounds(element, indexed.positions)
    const color = Array.from(element.classList).find((name) => /^hl-(yellow|green|pink|blue)$/.test(name))?.slice(3) || 'yellow'
    return bounds ? { ...bounds, color, element, block: blockForMark(element) } : null
  }).filter(Boolean).sort((left, right) => left.start - right.start || left.end - right.end)

  const groups = []
  for (const fragment of fragments) {
    const previous = groups[groups.length - 1]
    const gap = previous ? indexed.text.slice(previous.end, fragment.start) : ''
    const canJoin = previous
      && previous.color === fragment.color
      && previous.block === fragment.block
      && fragment.start >= previous.end
      && gap.length <= 16
      && /^\s*$/.test(gap)
    if (canJoin) {
      previous.end = fragment.end
      previous.elements.push(fragment.element)
    } else {
      groups.push({ start: fragment.start, end: fragment.end, color: fragment.color, block: fragment.block, elements: [fragment.element] })
    }
  }
  return {
    text: indexed.text,
    groups: groups.map((group) => ({
      ...group,
      quote: indexed.text.slice(group.start, group.end),
      anchor: createTextAnchor(indexed.text, group.start, group.end),
    })).filter((group) => group.anchor),
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class AnnotationsPanel {
  constructor({ panel, list, status, title, count, reader, language = () => 'es', storage = globalThis.localStorage }) {
    this.panel = panel
    this.list = list
    this.status = status
    this.title = title
    this.count = count
    this.reader = reader
    this.language = language
    this.storage = storage
    this.documentKey = ''
    this.documentKind = ''
    this.data = emptyAnnotationDocument('')
    this.loadStatus = 'ok'
    this.lastSaveStatus = 'ok'
    this.text = ''
    this.groups = []
    this.drafts = new Map()

    this.panel.addEventListener('input', (event) => {
      const field = event.target.closest('[data-annotation-draft]')
      if (field) this.drafts.set(field.dataset.annotationDraft, field.value)
    })
    this.panel.addEventListener('click', (event) => void this.handleClick(event))
  }

  t(key) { return annotationText(this.language(), key) }

  setDocument({ key, kind, name = '' }) {
    const nextKey = String(key || '')
    const nextKind = String(kind || '')
    if (nextKey !== this.documentKey) {
      this.documentKey = nextKey
      const loaded = this.documentKey ? readAnnotationDocument(this.storage, this.documentKey) : { status: 'ok', value: emptyAnnotationDocument('') }
      this.loadStatus = loaded.status
      this.data = loaded.value || emptyAnnotationDocument(this.documentKey)
      this.lastSaveStatus = 'ok'
    }
    this.documentKind = nextKind
    this.refresh()
  }

  refresh() {
    const extracted = collectHighlightGroups(this.reader)
    this.text = extracted.text
    this.groups = extracted.groups
    this.render()
  }

  statusMessage() {
    if (this.documentKind !== 'markdown') return this.t('unavailable')
    if (!this.documentKey) return this.t('openDocument')
    if (this.loadStatus === 'corrupt') return this.t('corrupt')
    if (this.loadStatus === 'unavailable' || this.lastSaveStatus === 'unavailable') return this.t('storageUnavailable')
    if (this.lastSaveStatus === 'invalid') return this.t('saveFailed')
    return ''
  }

  get readOnly() {
    return this.documentKind !== 'markdown' || !this.documentKey || this.loadStatus !== 'ok'
  }

  render() {
    this.title.textContent = this.t('title')
    const annotations = this.data?.annotations || []
    this.count.textContent = `${annotations.length} ${this.t('count')}`
    this.status.textContent = this.statusMessage()
    this.status.classList.toggle('hidden', !this.status.textContent)
    this.list.replaceChildren()

    if (this.documentKind !== 'markdown' || !this.documentKey) {
      this.list.append(element('p', 'muted annotations-empty', this.documentKind ? this.t('unavailable') : this.t('openDocument')))
      return
    }
    if (this.loadStatus === 'corrupt' || this.loadStatus === 'unavailable') {
      this.list.append(element('p', 'muted annotations-empty', this.status.textContent))
      return
    }

    const attachedByGroup = new Map()
    const orphans = []
    for (const annotation of annotations) {
      const resolved = resolveTextAnchor(this.text, annotation.anchor)
      const groupIndex = resolved.status === 'resolved'
        ? this.groups.findIndex((group) => group.start === resolved.start && group.end === resolved.end)
        : -1
      if (groupIndex < 0) {
        orphans.push(annotation)
      } else {
        const entries = attachedByGroup.get(groupIndex) || []
        entries.push(annotation)
        attachedByGroup.set(groupIndex, entries)
      }
    }

    if (this.groups.length === 0 && annotations.length === 0) {
      this.list.append(element('p', 'muted annotations-empty', this.t('noHighlights')))
      return
    }

    this.groups.forEach((group, index) => {
      const card = element('section', `annotation-group annotation-${group.color}`)
      const jump = element('button', 'annotation-quote', group.quote)
      jump.type = 'button'
      jump.setAttribute('aria-label', this.t('jump'))
      jump.addEventListener('click', () => this.jump(group))
      card.append(jump)
      const notes = attachedByGroup.get(index) || []
      if (notes.length) notes.forEach((annotation) => card.append(this.renderAnnotation(annotation)))
      else card.append(this.renderDraft(group, index))
      this.list.append(card)
    })

    if (orphans.length) {
      const section = element('section', 'annotation-orphans')
      section.append(element('h3', 'annotation-orphans-title', `${this.t('orphan')} (${orphans.length})`))
      section.append(element('p', 'annotation-orphans-hint', this.t('orphanHint')))
      for (const annotation of orphans) section.append(this.renderAnnotation(annotation, true))
      this.list.append(section)
    }
  }

  renderAnnotation(annotation, orphan = false) {
    const wrapper = element('div', `annotation-note${orphan ? ' is-orphan' : ''}`)
    if (orphan) {
      wrapper.append(element('strong', 'annotation-orphan-label', this.t('orphan')))
      wrapper.append(element('blockquote', 'annotation-orphan-quote', annotation.anchor.quote))
    }
    const field = element('textarea', 'annotation-text')
    field.rows = 3
    field.maxLength = MAX_COMMENT_LENGTH
    field.placeholder = this.t('editPlaceholder')
    const draftKey = annotationDraftKey(this.documentKey, `note:${annotation.id}`)
    field.dataset.annotationDraft = draftKey
    field.value = this.drafts.has(draftKey) ? this.drafts.get(draftKey) : annotation.text
    field.setAttribute('aria-label', `${this.t('editPlaceholder')}: ${annotation.anchor.quote.slice(0, 80)}`)
    wrapper.append(field)
    const actions = element('div', 'annotation-actions')
    actions.append(this.actionButton('save', this.t('save'), { noteId: annotation.id, draft: draftKey }))
    actions.append(this.actionButton('delete', this.t('delete'), { noteId: annotation.id }))
    wrapper.append(actions)
    return wrapper
  }

  renderDraft(group, index) {
    const wrapper = element('div', 'annotation-note annotation-new-note')
    wrapper.append(element('p', 'annotation-new-label', this.t('noNotes')))
    const field = element('textarea', 'annotation-text')
    field.rows = 2
    field.maxLength = MAX_COMMENT_LENGTH
    field.placeholder = this.t('addPlaceholder')
    const draftKey = this.groupDraftKey(group)
    field.dataset.annotationDraft = draftKey
    field.value = this.drafts.get(draftKey) || ''
    field.setAttribute('aria-label', `${this.t('addPlaceholder')}: ${group.quote.slice(0, 80)}`)
    wrapper.append(field)
    wrapper.append(this.actionButton('add', this.t('add'), { groupIndex: String(index), draft: draftKey }))
    return wrapper
  }

  actionButton(action, label, data = {}) {
    const button = element('button', action === 'delete' ? 'ghost-button annotation-delete' : action === 'add' ? 'primary-button annotation-add' : 'ghost-button annotation-save', label)
    button.type = 'button'
    button.dataset.annotationAction = action
    for (const [key, value] of Object.entries(data)) button.dataset[key] = value
    return button
  }

  groupDraftKey(group) { return annotationDraftKey(this.documentKey, `new:${group.start}:${group.end}:${hashKey(group.quote)}`) }

  async handleClick(event) {
    const button = event.target.closest('[data-annotation-action]')
    if (!button) return
    const action = button.dataset.annotationAction
    if (action === 'add') {
      const group = this.groups[Number(button.dataset.groupIndex)]
      const input = button.parentElement.querySelector('[data-annotation-draft]')
      const text = input?.value ?? ''
      if (!text.trim()) { this.showTransientStatus(this.t('emptyComment')); return }
      const annotation = makeAnnotation(group?.anchor, text)
      if (!annotation) { this.showTransientStatus(this.t('saveFailed')); return }
      const next = { ...this.data, annotations: [...this.data.annotations, annotation] }
      if (await this.persist(next)) {
        this.drafts.delete(this.groupDraftKey(group))
        this.refresh()
        this.showTransientStatus(this.t('saved'))
      }
      return
    }
    if (action === 'save') {
      const annotation = this.data.annotations.find((item) => item.id === button.dataset.noteId)
      const text = button.parentElement.parentElement.querySelector('[data-annotation-draft]')?.value ?? ''
      if (!annotation || !text.trim()) { this.showTransientStatus(this.t('emptyComment')); return }
      const updated = { ...annotation, text, updatedAt: Date.now() }
      const next = { ...this.data, annotations: this.data.annotations.map((item) => item.id === updated.id ? updated : item) }
      if (await this.persist(next)) {
        this.drafts.delete(annotationDraftKey(this.documentKey, `note:${updated.id}`))
        this.refresh()
        this.showTransientStatus(this.t('saved'))
      }
      return
    }
    if (action === 'delete') {
      if (typeof globalThis.confirm === 'function' && !globalThis.confirm(this.t('deleteConfirm'))) return
      const next = { ...this.data, annotations: this.data.annotations.filter((item) => item.id !== button.dataset.noteId) }
      if (await this.persist(next)) {
        this.drafts.delete(annotationDraftKey(this.documentKey, `note:${button.dataset.noteId}`))
        this.refresh()
        this.showTransientStatus(this.t('saved'))
      }
    }
  }

  async persist(next) {
    if (this.readOnly) return false
    const result = writeAnnotationDocument(this.storage, next)
    this.lastSaveStatus = result.status
    if (result.status !== 'ok') {
      this.status.textContent = this.statusMessage()
      this.status.classList.remove('hidden')
      return false
    }
    this.data = next
    this.lastSaveStatus = 'ok'
    return true
  }

  showTransientStatus(message) {
    this.status.textContent = message
    this.status.classList.remove('hidden')
  }

  jump(group) {
    const element = group.elements.find((mark) => mark.isConnected) || group.elements[0]
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.add('annotation-target')
    window.setTimeout(() => element.classList.remove('annotation-target'), 1300)
  }
}
