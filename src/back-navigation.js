// Gesto "atrás" del sistema (deslizar desde el borde en iOS, botón atrás en
// Android): cada panel o documento que se abre añade una entrada al historial,
// y al volver se cierra lo que está encima o se abre el documento anterior.

/**
 * @param {object} options
 * @param {{ isOpen: () => boolean, close: () => void }[]} options.layers Capas de arriba a abajo.
 * @param {(path: string | null) => void} options.openDocument Abre el documento anterior (null: ninguno).
 */
export function createBackNavigation({ layers, openDocument, history = window.history, target = window }) {
  // entries[i] describe la entrada i del historial: la 0 es la página inicial.
  const entries = [{ kind: 'start' }]
  let index = 0
  let ignoredPops = 0
  let restoring = false
  let currentPath = null
  const openLayers = () => layers.filter((layer) => layer.isOpen()).length
  let lastOpen = openLayers()
  // Las entradas de una carga anterior de la página no son nuestras.
  const session = `${Date.now()}-${Math.random()}`
  const state = (position) => ({ pliegoBack: position, pliegoSession: session })

  history.replaceState(state(0), '')

  function push(entry) {
    entries.length = index + 1
    entries.push(entry)
    index += 1
    history.pushState(state(index), '')
  }

  function syncLayers() {
    const open = openLayers()
    for (let count = lastOpen; count < open; count += 1) push({ kind: 'layer' })
    lastOpen = open
  }

  function goBack(entry) {
    if (entry.kind === 'layer') {
      const layer = layers.find((item) => item.isOpen())
      // Una capa cerrada con su propio botón deja una entrada vacía: se salta.
      if (!layer) return false
      layer.close()
      lastOpen = openLayers()
      return true
    }
    if (entry.kind === 'document') {
      restoring = true
      currentPath = entry.previous
      Promise.resolve(openDocument(entry.previous)).finally(() => { restoring = false })
      return true
    }
    return false
  }

  target.addEventListener('popstate', (event) => {
    if (ignoredPops) {
      ignoredPops -= 1
      return
    }
    if (event.state?.pliegoSession !== session) return
    const destination = event.state.pliegoBack
    if (destination >= index) {
      // Gesto adelante: volver a donde estábamos.
      if (destination > index) {
        ignoredPops += 1
        history.go(index - destination)
      }
      return
    }
    let handled = false
    while (index > destination) {
      handled = goBack(entries[index]) || handled
      index -= 1
    }
    entries.length = index + 1
    if (!handled && index > 0) history.back()
  })

  // Las capas se abren y cierran cambiando clases (hidden, focus-mode).
  new MutationObserver(syncLayers).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true })

  return {
    goBack: () => {
      if (index > 0) history.back()
    },
    documentOpened(path) {
      if (!path || path === currentPath) return
      const previous = currentPath
      currentPath = path
      if (!restoring) push({ kind: 'document', previous })
    },
  }
}

const EDGE_PX = 28
const TRIGGER_PX = 72

/**
 * En una PWA instalada iOS no ofrece el gesto de atrás del borde: lo imitamos.
 * Deslizar desde el borde izquierdo muestra una flecha y, al pasar el umbral, va atrás.
 */
export function installEdgeSwipe({ onBack, root = document.body }) {
  const indicator = document.createElement('div')
  indicator.className = 'edge-back-indicator'
  indicator.setAttribute('aria-hidden', 'true')
  indicator.textContent = '‹'
  root.append(indicator)
  let start = null

  const reset = () => {
    start = null
    indicator.classList.remove('visible', 'ready')
    indicator.style.removeProperty('--edge-progress')
  }

  root.addEventListener('touchstart', (event) => {
    const touch = event.touches[0]
    start = event.touches.length === 1 && touch.clientX <= EDGE_PX ? { x: touch.clientX, y: touch.clientY } : null
  }, { passive: true })

  root.addEventListener('touchmove', (event) => {
    if (!start) return
    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = Math.abs(touch.clientY - start.y)
    if (dy > 40 && dy > dx) return reset()
    if (dx <= 0) return
    event.preventDefault()
    const progress = Math.min(1, dx / TRIGGER_PX)
    indicator.style.setProperty('--edge-progress', String(progress))
    indicator.style.top = `${start.y}px`
    indicator.classList.add('visible')
    indicator.classList.toggle('ready', progress >= 1)
  }, { passive: false })

  root.addEventListener('touchend', () => {
    const ready = indicator.classList.contains('ready')
    reset()
    if (ready) onBack()
  })
  root.addEventListener('touchcancel', reset)
}
