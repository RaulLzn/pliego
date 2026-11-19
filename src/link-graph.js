// Vista de grafo de enlaces a pantalla completa (SVG, zoom/pan, arrastre de nodos).
import './link-graph.css'
import { buildLinkGraph, createSimulation, fitTransform, neighborIndexes, neighborhoodGraph, zoomAt } from './link-graph-layout.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const LARGE_GRAPH = 500
const LABEL_LIMIT = 80
const CLICK_SLOP = 5

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  return node
}

/**
 * `getEntries()` devuelve el índice de la biblioteca, `resolve` es el mismo resolvedor de
 * los backlinks, `getCurrentPath()` el documento abierto y `openDocument(path)` lo abre.
 */
export function createLinkGraph({ getEntries, resolve, getCurrentPath, openDocument, text }) {
  const overlay = document.createElement('div')
  overlay.className = 'link-graph hidden'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.innerHTML = `
    <header class="link-graph-bar">
      <div class="link-graph-title"><p class="panel-label"></p><h2></h2><span class="link-graph-count muted"></span></div>
      <label class="link-graph-option"><input type="checkbox" class="link-graph-neighbors" /><span></span></label>
      <button type="button" class="ghost-button link-graph-fit"></button>
      <button type="button" class="icon-button small link-graph-close">✕</button>
    </header>
    <p class="link-graph-empty muted hidden"></p>`
  const svg = svgElement('svg', { class: 'link-graph-canvas' })
  const viewport = svgElement('g')
  const edgeLayer = svgElement('g', { class: 'link-graph-edges' })
  const nodeLayer = svgElement('g', { class: 'link-graph-nodes' })
  viewport.append(edgeLayer, nodeLayer)
  svg.append(viewport)
  overlay.append(svg)
  document.body.append(overlay)

  const neighborsToggle = overlay.querySelector('.link-graph-neighbors')
  const emptyLabel = overlay.querySelector('.link-graph-empty')
  const countLabel = overlay.querySelector('.link-graph-count')

  let graph = { nodes: [], edges: [] }
  let simulation = null
  let nodeElements = []
  let edgeElements = []
  let transform = { scale: 1, x: 0, y: 0 }
  let frame = 0
  let userMoved = false
  let previousFocus = null
  let hoverIndex = -1
  const pointers = new Map()
  let gesture = null

  function applyLabels() {
    overlay.setAttribute('aria-label', text('graphTitle'))
    overlay.querySelector('.panel-label').textContent = text('graphEyebrow')
    overlay.querySelector('h2').textContent = text('graphTitle')
    overlay.querySelector('.link-graph-option span').textContent = text('graphNeighbors')
    overlay.querySelector('.link-graph-fit').textContent = text('graphFit')
    overlay.querySelector('.link-graph-close').setAttribute('aria-label', text('graphClose'))
  }

  function isOpen() { return !overlay.classList.contains('hidden') }

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.scale})`)
    // Con zoom alto o pocos nodos se muestran todas las etiquetas.
    svg.classList.toggle('show-labels', graph.nodes.length <= LABEL_LIMIT || transform.scale >= 1.4)
  }

  function fit() {
    const box = svg.getBoundingClientRect()
    transform = fitTransform(graph.nodes, box.width || window.innerWidth, box.height || window.innerHeight)
    applyTransform()
  }

  function drawPositions() {
    graph.edges.forEach((edge, index) => {
      const line = edgeElements[index]
      const source = graph.nodes[edge.source]
      const target = graph.nodes[edge.target]
      line.setAttribute('x1', source.x.toFixed(1))
      line.setAttribute('y1', source.y.toFixed(1))
      line.setAttribute('x2', target.x.toFixed(1))
      line.setAttribute('y2', target.y.toFixed(1))
    })
    graph.nodes.forEach((node, index) => {
      nodeElements[index].setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`)
    })
  }

  function stopLoop() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  // Bucle por fotogramas: unos pasos por frame y parada al estabilizar.
  function startLoop() {
    if (frame || !simulation) return
    const ticksPerFrame = graph.nodes.length > 1500 ? 1 : graph.nodes.length > LARGE_GRAPH ? 2 : 4
    const step = () => {
      frame = 0
      let running = true
      for (let index = 0; index < ticksPerFrame && running; index += 1) running = simulation.tick()
      drawPositions()
      if (!userMoved) fit()
      if (running && isOpen()) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  function highlight() {
    const currentPath = getCurrentPath()
    const current = graph.nodes.findIndex((node) => node.id === currentPath)
    const focus = hoverIndex >= 0 ? hoverIndex : current
    const neighbors = neighborIndexes(graph, focus)
    svg.classList.toggle('has-focus', focus >= 0)
    nodeElements.forEach((element, index) => {
      element.classList.toggle('is-current', index === current)
      element.classList.toggle('is-focus', index === focus)
      element.classList.toggle('is-neighbor', neighbors.has(index))
    })
    graph.edges.forEach((edge, index) => {
      edgeElements[index].classList.toggle('is-active', edge.source === focus || edge.target === focus)
    })
  }

  function render() {
    stopLoop()
    const entries = getEntries() || []
    const full = buildLinkGraph(entries, resolve)
    const currentPath = getCurrentPath()
    const hasCurrent = full.nodes.some((node) => node.id === currentPath)
    neighborsToggle.disabled = !hasCurrent
    if (!hasCurrent) neighborsToggle.checked = false
    graph = neighborsToggle.checked ? neighborhoodGraph(full, currentPath) : full
    countLabel.textContent = text('graphCount').replace('{nodes}', String(graph.nodes.length)).replace('{edges}', String(graph.edges.length))
    emptyLabel.textContent = text('graphEmpty')
    emptyLabel.classList.toggle('hidden', graph.nodes.length > 0)

    edgeLayer.replaceChildren()
    nodeLayer.replaceChildren()
    edgeElements = graph.edges.map(() => {
      const line = svgElement('line')
      edgeLayer.append(line)
      return line
    })
    nodeElements = graph.nodes.map((node, index) => {
      const group = svgElement('g', { class: 'link-graph-node', 'data-index': String(index) })
      const radius = Math.min(16, 4.5 + Math.sqrt(node.degree) * 2)
      const circle = svgElement('circle', { r: radius.toFixed(1) })
      const label = svgElement('text', { y: (radius + 12).toFixed(1), 'text-anchor': 'middle' })
      label.textContent = node.label.length > 42 ? `${node.label.slice(0, 40)}…` : node.label
      const title = svgElement('title')
      title.textContent = node.label
      group.append(circle, label, title)
      nodeLayer.append(group)
      return group
    })

    simulation = createSimulation(graph)
    userMoved = false
    hoverIndex = -1
    highlight()
    if (graph.nodes.length <= LARGE_GRAPH) {
      // Bibliotecas pequeñas: layout síncrono y encuadre inmediato.
      simulation.run(400)
      drawPositions()
      fit()
    } else {
      drawPositions()
      fit()
      startLoop()
    }
  }

  function open() {
    if (isOpen()) return
    previousFocus = document.activeElement
    applyLabels()
    overlay.classList.remove('hidden')
    // Bibliotecas grandes: por defecto solo el vecindario del documento actual.
    const entries = getEntries() || []
    const markdownCount = entries.filter((entry) => entry.kind === 'markdown').length
    neighborsToggle.checked = markdownCount > LARGE_GRAPH && Boolean(getCurrentPath())
    render()
    overlay.querySelector('.link-graph-close').focus()
  }

  function close() {
    if (!isOpen()) return
    stopLoop()
    overlay.classList.add('hidden')
    pointers.clear()
    gesture = null
    // Libera el DOM de bibliotecas grandes mientras no se ve.
    edgeLayer.replaceChildren()
    nodeLayer.replaceChildren()
    nodeElements = []
    edgeElements = []
    graph = { nodes: [], edges: [] }
    simulation = null
    if (previousFocus?.isConnected) previousFocus.focus?.()
  }

  function localPoint(event) {
    const box = svg.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  function toGraph(point) {
    return { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale }
  }

  svg.addEventListener('wheel', (event) => {
    event.preventDefault()
    const point = localPoint(event)
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    transform = zoomAt(transform, point.x, point.y, Math.exp(-delta * 0.0015))
    userMoved = true
    applyTransform()
  }, { passive: false })

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button > 0) return
    svg.setPointerCapture?.(event.pointerId)
    const point = localPoint(event)
    pointers.set(event.pointerId, point)
    if (pointers.size === 2) {
      // Pellizco: se cancela cualquier arrastre previo.
      if (gesture?.node >= 0) graph.nodes[gesture.node].fixed = false
      const [a, b] = [...pointers.values()]
      gesture = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, moved: true }
      return
    }
    const nodeElement = event.target.closest?.('.link-graph-node')
    const index = nodeElement ? Number(nodeElement.dataset.index) : -1
    gesture = { type: index >= 0 ? 'node' : 'pan', node: index, start: point, last: point, moved: false }
    if (index >= 0) graph.nodes[index].fixed = true
  })

  svg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) {
      // Sin botón pulsado: resaltar el vecindario bajo el ratón.
      if (event.pointerType === 'mouse') {
        const nodeElement = event.target.closest?.('.link-graph-node')
        const index = nodeElement ? Number(nodeElement.dataset.index) : -1
        if (index !== hoverIndex) { hoverIndex = index; highlight() }
      }
      return
    }
    const point = localPoint(event)
    pointers.set(event.pointerId, point)
    if (!gesture) return
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1
      transform = zoomAt(transform, (a.x + b.x) / 2, (a.y + b.y) / 2, distance / gesture.distance)
      gesture.distance = distance
      userMoved = true
      applyTransform()
      return
    }
    if (!gesture.moved && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) < CLICK_SLOP) return
    gesture.moved = true
    userMoved = true
    if (gesture.type === 'pan') {
      transform = { ...transform, x: transform.x + point.x - gesture.last.x, y: transform.y + point.y - gesture.last.y }
      applyTransform()
    } else if (gesture.type === 'node') {
      const node = graph.nodes[gesture.node]
      const position = toGraph(point)
      node.x = position.x
      node.y = position.y
      simulation?.reheat(0.25)
      drawPositions()
      startLoop()
    }
    gesture.last = point
  })

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return
    pointers.delete(event.pointerId)
    const finished = gesture
    if (pointers.size > 0) {
      // Tras un pellizco, el dedo restante continúa como desplazamiento.
      const [point] = [...pointers.values()]
      gesture = { type: 'pan', node: -1, start: point, last: point, moved: true }
      return
    }
    gesture = null
    if (!finished) return
    if (finished.type === 'node') {
      const node = graph.nodes[finished.node]
      if (node) node.fixed = false
      if (!finished.moved && event.type === 'pointerup' && node) {
        close()
        openDocument(node.id)
      }
    }
  }
  svg.addEventListener('pointerup', endPointer)
  svg.addEventListener('pointercancel', endPointer)
  svg.addEventListener('pointerleave', () => {
    if (hoverIndex >= 0 && !pointers.size) { hoverIndex = -1; highlight() }
  })

  neighborsToggle.addEventListener('change', render)
  overlay.querySelector('.link-graph-fit').addEventListener('click', () => { userMoved = false; fit() })
  overlay.querySelector('.link-graph-close').addEventListener('click', close)
  window.addEventListener('resize', () => { if (isOpen() && !userMoved) fit() })
  // Escape se atiende antes que el manejador global para cerrar solo el grafo.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return
    event.preventDefault()
    event.stopImmediatePropagation()
    close()
  }, true)

  return { element: overlay, open, close, isOpen, toggle: () => (isOpen() ? close() : open()) }
}
