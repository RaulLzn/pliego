// Borradores de recuperación: mientras se edita se guarda cada pocos segundos
// una copia del Markdown en localStorage. Si la app se cierra o se cuelga sin
// guardar, al volver a abrir el documento se ofrece recuperarla.

export const DRAFT_PREFIX = 'pliego-draft:'
export const MAX_DRAFTS = 20
// ~2 MB en UTF-16: localStorage suele dar 5 MB por origen y lo comparten los ajustes.
export const MAX_DRAFT_CHARS = 1_000_000
export const DRAFT_DELAY_MS = 2000

const isQuotaError = (error) => error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014

/**
 * Almacén de borradores sobre una API tipo Storage (inyectable para los tests).
 * Cada borrador va en su propia clave para no reescribir todos al guardar uno.
 */
export function createDraftStore({ storage = globalThis.localStorage, now = () => Date.now(), maxDrafts = MAX_DRAFTS, maxChars = MAX_DRAFT_CHARS } = {}) {
  const keyFor = (path) => `${DRAFT_PREFIX}${path}`

  function read(key) {
    try {
      const value = JSON.parse(storage.getItem(key) || 'null')
      return value && typeof value.markdown === 'string' && typeof value.path === 'string' ? value : null
    } catch (_) {
      return null
    }
  }

  function keys() {
    const found = []
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith(DRAFT_PREFIX)) found.push(key)
      }
    } catch (_) {
      // Almacenamiento bloqueado (modo privado): no hay borradores.
    }
    return found
  }

  function remove(path) {
    try { storage.removeItem(keyFor(path)) } catch (_) { /* sin almacenamiento */ }
  }

  function list() {
    return keys()
      .map((key) => {
        const draft = read(key)
        // Una entrada corrupta solo ocupa sitio.
        if (!draft) try { storage.removeItem(key) } catch (_) { /* nada */ }
        return draft && { path: draft.path, savedAt: draft.savedAt || 0, key }
      })
      .filter(Boolean)
      .sort((a, b) => b.savedAt - a.savedAt)
  }

  // Deja como mucho `limit` borradores, quitando los más antiguos.
  function prune(limit, keep) {
    const drafts = list().filter((draft) => draft.path !== keep)
    for (const draft of drafts.slice(Math.max(0, limit))) {
      try { storage.removeItem(draft.key) } catch (_) { /* nada */ }
    }
  }

  function save(path, markdown) {
    if (!path || typeof markdown !== 'string' || markdown.length > maxChars) return false
    const value = JSON.stringify({ path, markdown, savedAt: now() })
    const attempt = () => storage.setItem(keyFor(path), value)
    try {
      attempt()
      prune(maxDrafts - 1, path)
      return true
    } catch (error) {
      if (!isQuotaError(error)) return false
    }
    // Sin cuota: se sacrifican los borradores de otros documentos y se reintenta una vez.
    prune(0, path)
    try {
      attempt()
      return true
    } catch (_) {
      return false
    }
  }

  function load(path) {
    return path ? read(keyFor(path)) : null
  }

  // Borrador que conviene ofrecer al abrir: existe y difiere del disco. Uno
  // idéntico al disco ya no aporta nada y se borra.
  function pendingFor(path, diskMarkdown) {
    const draft = load(path)
    if (!draft) return null
    if (draft.markdown === diskMarkdown) {
      remove(path)
      return null
    }
    return draft
  }

  return { save, load, remove, list, pendingFor }
}
