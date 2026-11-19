import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLinkGraph, createSimulation, fitTransform, neighborIndexes, neighborhoodGraph, zoomAt } from '../src/link-graph-layout.js'

const entries = [
  { path: '/lib/a.md', name: 'a.md', kind: 'markdown', references: ['b', 'c', 'b', 'a', 'missing'] },
  { path: '/lib/b.md', name: 'b.md', kind: 'markdown', references: ['a'] },
  { path: '/lib/c.md', name: 'c.md', kind: 'markdown', references: [] },
  { path: '/lib/d.md', name: 'd.md', kind: 'markdown', references: ['c'] },
  { path: '/lib/x.csv', name: 'x.csv', kind: 'table', references: ['a'] },
]
const resolve = (_source, reference) => entries.find((entry) => entry.kind === 'markdown' && entry.path === `/lib/${reference}.md`)

test('graph uses markdown nodes and deduplicated undirected edges without self-links', () => {
  const graph = buildLinkGraph(entries, resolve)
  assert.deepEqual(graph.nodes.map((node) => node.label), ['a', 'b', 'c', 'd'])
  assert.deepEqual(graph.edges, [{ source: 0, target: 1 }, { source: 0, target: 2 }, { source: 3, target: 2 }])
  assert.deepEqual(graph.nodes.map((node) => node.degree), [2, 1, 2, 1])
  assert.deepEqual([...neighborIndexes(graph, 2)].sort(), [0, 3])
})

test('neighborhood keeps the current document and its direct neighbors', () => {
  const graph = buildLinkGraph(entries, resolve)
  const local = neighborhoodGraph(graph, '/lib/c.md')
  assert.deepEqual(local.nodes.map((node) => node.label), ['c', 'a', 'd'])
  assert.equal(local.edges.length, 2)
  assert.deepEqual(neighborhoodGraph(graph, '/nope.md'), { nodes: [], edges: [] })
})

test('simulation stabilizes with finite positions and linked nodes closer than unlinked', () => {
  const many = Array.from({ length: 60 }, (_, index) => ({ path: `/lib/n${index}.md`, name: `n${index}.md`, kind: 'markdown', references: index ? [`n${Math.floor((index - 1) / 3)}`] : [] }))
  const graph = buildLinkGraph(many, (_source, reference) => many.find((entry) => entry.path === `/lib/${reference}.md`))
  const simulation = createSimulation(graph)
  const ticks = simulation.run(1000)
  assert.ok(ticks < 1000, 'stops before the budget')
  assert.equal(simulation.tick(), false)
  for (const node of graph.nodes) assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y))
  const distance = (a, b) => Math.hypot(graph.nodes[a].x - graph.nodes[b].x, graph.nodes[a].y - graph.nodes[b].y)
  const linked = graph.edges.reduce((total, edge) => total + distance(edge.source, edge.target), 0) / graph.edges.length
  let unlinked = 0
  let pairs = 0
  for (let a = 0; a < graph.nodes.length; a += 7) for (let b = a + 1; b < graph.nodes.length; b += 5) { unlinked += distance(a, b); pairs += 1 }
  assert.ok(linked < unlinked / pairs, `${linked} < ${unlinked / pairs}`)
  // Ningún par de nodos queda superpuesto.
  for (let a = 0; a < graph.nodes.length; a += 1) for (let b = a + 1; b < graph.nodes.length; b += 1) assert.ok(distance(a, b) > 3)
})

test('large graphs tick without quadratic blow-up and fixed nodes stay put', () => {
  const big = Array.from({ length: 2000 }, (_, index) => ({ path: `/l/${index}.md`, name: `${index}.md`, kind: 'markdown', references: [`${(index * 7) % 2000}`] }))
  const byPath = new Map(big.map((entry) => [entry.path, entry]))
  const graph = buildLinkGraph(big, (_source, reference) => byPath.get(`/l/${reference}.md`))
  graph.nodes[5].x = 123
  graph.nodes[5].y = 456
  graph.nodes[5].fixed = true
  const simulation = createSimulation(graph)
  const started = performance.now()
  for (let index = 0; index < 10; index += 1) simulation.tick()
  assert.ok(performance.now() - started < 2000)
  assert.deepEqual([graph.nodes[5].x, graph.nodes[5].y], [123, 456])
})

test('fit and zoom transforms keep the focus point stable', () => {
  const nodes = [{ x: -100, y: -50 }, { x: 100, y: 50 }]
  const fit = fitTransform(nodes, 500, 300, 50, 2.2)
  assert.equal(fit.scale, 2)
  assert.deepEqual([fit.x, fit.y], [250, 150])
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 100, 100, 2)
  assert.deepEqual(zoomed, { scale: 2, x: -100, y: -100 })
  assert.equal(zoomAt({ scale: 5, x: 0, y: 0 }, 0, 0, 10).scale, 6)
})
