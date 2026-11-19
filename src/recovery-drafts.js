import './recovery-drafts.css'
import { DRAFT_DELAY_MS, createDraftStore } from './draft-store.js'

// Aviso y autoguardado del borrador de recuperación (lógica de almacenamiento en draft-store.js).

/**
 * Conecta el almacén con el editor: guarda con retardo mientras hay cambios,
 * vuelca al ocultar la página y muestra el aviso de recuperación.
 */
export function createRecoveryDrafts({ reader, store = createDraftStore(), getState, snapshot, recover, text, formatDate, delay = DRAFT_DELAY_MS }) {
  let timer = 0
  let scheduledPath = ''
  // Ruta cuyo borrador se está ofreciendo; mientras el aviso siga abierto no se
  // sobrescribe ese borrador, para no perder lo que se quería recuperar.
  let offeredPath = ''

  const banner = document.createElement('div')
  banner.className = 'draft-banner'
  banner.hidden = true
  banner.setAttribute('role', 'status')
  const message = document.createElement('span')
  const recoverButton = document.createElement('button')
  recoverButton.type = 'button'
  recoverButton.className = 'primary-button'
  const discardButton = document.createElement('button')
  discardButton.type = 'button'
  discardButton.className = 'ghost-button'
  banner.append(message, recoverButton, discardButton)
  reader.before(banner)

  function currentMarkdown() {
    const state = getState()
    if (state.mode === 'edit') return snapshot()
    return state.dirty ? state.markdown : null
  }

  function flush() {
    window.clearTimeout(timer)
    timer = 0
    const state = getState()
    if (!scheduledPath || state.filePath !== scheduledPath || !state.dirty || offeredPath === scheduledPath) return
    const markdown = currentMarkdown()
    if (typeof markdown === 'string') store.save(scheduledPath, markdown)
  }

  function schedule() {
    const state = getState()
    // No se exige state.dirty aquí: este listener puede correr antes del que lo activa; flush lo comprueba.
    if (!state.filePath || !['markdown', 'text'].includes(state.documentKind)) return
    scheduledPath = state.filePath
    window.clearTimeout(timer)
    timer = window.setTimeout(flush, delay)
  }

  function hideBanner() {
    banner.hidden = true
    offeredPath = ''
  }

  // Al guardar o descartar: el borrador ya no hace falta.
  function clear(path = getState().filePath) {
    if (!path) return
    if (path === scheduledPath) {
      window.clearTimeout(timer)
      timer = 0
    }
    store.remove(path)
    if (path === offeredPath) hideBanner()
  }

  function offer(path, diskMarkdown) {
    hideBanner()
    const draft = store.pendingFor(path, diskMarkdown)
    if (!draft) return
    offeredPath = path
    message.textContent = text('draftFound').replace('{date}', formatDate(new Date(draft.savedAt)))
    recoverButton.textContent = text('draftRecover')
    discardButton.textContent = text('draftDiscard')
    banner.hidden = false
  }

  recoverButton.addEventListener('click', async () => {
    const path = offeredPath
    const draft = store.load(path)
    hideBanner()
    if (!draft || getState().filePath !== path) return
    await recover(draft.markdown)
  })
  discardButton.addEventListener('click', () => clear(offeredPath))

  reader.addEventListener('input', () => {
    if (getState().mode === 'edit') schedule()
  })
  // En móviles la app puede morir en segundo plano sin más avisos.
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })

  return { schedule, flush, clear, offer, hideBanner, store }
}
