// Grafo de enlaces: construcción y layout force-directed propio, sin dependencias. Puro y testeable.

/**
 * Construye nodos (documentos Markdown) y aristas no dirigidas y sin duplicados.
 * `resolve(sourcePath, reference)` devuelve la entrada destino, como en los backlinks.
 */
export function buildLinkGraph(entries, resolve) {
  const nodes = []
  const byPath = new Map()
  for (const entry of entries || []) {
    if (entry?.kind !== 'markdown' || byPath.has(entry.path)) continue
    const node = { id: entry.path, label: String(entry.name || entry.path).replace(/\.(md|markdown|mdown|mkd)$/i, ''), degree: 0 }
    byPath.set(entry.path, nodes.length)
    nodes.push(node)
  }
  const edges = []
  const seen = new Set()
  for (const entry of entries || []) {
    const source = byPath.get(entry?.path)
    if (source === undefined || entry.kind !== 'markdown') continue
    for (const reference of entry.references || []) {
      const target = byPath.get(resolve(entry.path, reference)?.path)
      if (target === undefined || target === source) continue
      const key = source < target ? `${source}:${target}` : `${target}:${source}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source, target })
      nodes[source].degree += 1
      nodes[target].degree += 1
    }
  }
  return { nodes, edges }
}

export function neighborIndexes(graph, index) {
  const result = new Set()
  if (index < 0) return result
  for (const edge of graph.edges) {
    if (edge.source === index) result.add(edge.target)
    else if (edge.target === index) result.add(edge.source)
  }
  return result
}

// Subgrafo con el documento actual y sus vecinos directos; reindexa las aristas.
export function neighborhoodGraph(graph, centerId) {
  const center = graph.nodes.findIndex((node) => node.id === centerId)
  if (center < 0) return { nodes: [], edges: [] }
  const keep = [center, ...neighborIndexes(graph, center)]
  const remap = new Map(keep.map((oldIndex, newIndex) => [oldIndex, newIndex]))
  return {
    nodes: keep.map((oldIndex) => ({ ...graph.nodes[oldIndex] })),
    edges: graph.edges.filter((edge) => remap.has(edge.source) && remap.has(edge.target)).map((edge) => ({ source: remap.get(edge.source), target: remap.get(edge.target) })),
  }
}

/**
 * Simulación por pasos: muelles en las aristas, repulsión local con rejilla espacial
 * (O(n·k) en vez de O(n²)) y gravedad suave al centro. `tick()` devuelve false al estabilizar.
 */
export function createSimulation(graph, { linkDistance = 70, charge = 900, cutoff = 260, gravity = 0.035, velocityDecay = 0.55, alphaDecay = 0.025, alphaMin = 0.004 } = {}) {
  const nodes = graph.nodes
  const edges = graph.edges
  // Posición inicial determinista en espiral (filotaxis): evita solapes y facilita los tests.
  nodes.forEach((node, index) => {
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) return
    const radius = 12 * Math.sqrt(index + 0.5)
    const angle = index * Math.PI * (3 - Math.sqrt(5))
    node.x = radius * Math.cos(angle)
    node.y = radius * Math.sin(angle)
    node.vx = 0
    node.vy = 0
  })
  let alpha = 1

  function repel(strength) {
    const cell = cutoff
    const grid = new Map()
    nodes.forEach((node, index) => {
      const key = `${Math.floor(node.x / cell)},${Math.floor(node.y / cell)}`
      const bucket = grid.get(key)
      if (bucket) bucket.push(index)
      else grid.set(key, [index])
    })
    const cutoff2 = cutoff * cutoff
    nodes.forEach((node, index) => {
      const cx = Math.floor(node.x / cell)
      const cy = Math.floor(node.y / cell)
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const other of grid.get(`${cx + dx},${cy + dy}`) || []) {
            if (other <= index) continue
            const target = nodes[other]
            let x = node.x - target.x
            let y = node.y - target.y
            let d2 = x * x + y * y
            if (d2 > cutoff2) continue
            if (d2 < 1) {
              // Nodos superpuestos: separación pseudoaleatoria determinista.
              x = ((index * 7 + other * 13) % 11) - 5 || 1
              y = ((index * 3 + other * 17) % 11) - 5 || 1
              d2 = x * x + y * y
            }
            const force = (strength * charge) / d2
            node.vx += x * force
            node.vy += y * force
            target.vx -= x * force
            target.vy -= y * force
          }
        }
      }
    })
  }

  function tick() {
    if (alpha < alphaMin) return false
    repel(alpha)
    for (const edge of edges) {
      const source = nodes[edge.source]
      const target = nodes[edge.target]
      const x = target.x - source.x
      const y = target.y - source.y
      const distance = Math.sqrt(x * x + y * y) || 1
      // Los nodos muy conectados se mueven menos para que los centros no oscilen.
      const pull = ((distance - linkDistance) / distance) * alpha * 0.3
      const sourceShare = target.degree / (source.degree + target.degree || 1)
      source.vx += x * pull * sourceShare
      source.vy += y * pull * sourceShare
      target.vx -= x * pull * (1 - sourceShare)
      target.vy -= y * pull * (1 - sourceShare)
    }
    let energy = 0
    for (const node of nodes) {
      node.vx -= node.x * gravity * alpha
      node.vy -= node.y * gravity * alpha
      if (node.fixed) {
        node.vx = 0
        node.vy = 0
        continue
      }
      node.vx *= velocityDecay
      node.vy *= velocityDecay
      // Tope de velocidad: evita explosiones con nodos casi superpuestos.
      const speed = Math.hypot(node.vx, node.vy)
      if (speed > 40) { node.vx *= 40 / speed; node.vy *= 40 / speed }
      node.x += node.vx
      node.y += node.vy
      energy += node.vx * node.vx + node.vy * node.vy
    }
    alpha *= 1 - alphaDecay
    // Detención anticipada si ya casi no hay movimiento.
    if (nodes.length && energy / nodes.length < 0.0004) alpha = Math.min(alpha, alphaMin * 0.99)
    return alpha >= alphaMin
  }

  return {
    nodes,
    edges,
    tick,
    get alpha() { return alpha },
    reheat(value = 0.3) { alpha = Math.max(alpha, value) },
    // Ejecuta hasta estabilizar o hasta agotar el presupuesto de pasos.
    run(maxTicks = 400) {
      let ticks = 0
      while (ticks < maxTicks && tick()) ticks += 1
      return ticks
    },
  }
}

export function graphBounds(nodes) {
  if (!nodes.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }
  return { minX, minY, maxX, maxY }
}

// Transformación que encaja el grafo en el viewport con margen.
export function fitTransform(nodes, width, height, padding = 48, maxScale = 1.6) {
  const bounds = graphBounds(nodes)
  const graphWidth = Math.max(bounds.maxX - bounds.minX, 1)
  const graphHeight = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min(maxScale, Math.max(0.05, Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight)))
  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  }
}

// Zoom alrededor de un punto de pantalla (rueda o pellizco), acotado.
export function zoomAt(transform, pointX, pointY, factor, minScale = 0.05, maxScale = 6) {
  const scale = Math.min(maxScale, Math.max(minScale, transform.scale * factor))
  const ratio = scale / transform.scale
  return { scale, x: pointX - (pointX - transform.x) * ratio, y: pointY - (pointY - transform.y) * ratio }
}
