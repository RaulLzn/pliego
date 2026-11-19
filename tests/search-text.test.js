import test from 'node:test'
import assert from 'node:assert/strict'
import { findMatches, foldWithMap, normalizeQuery, quickFold, searchSnippet } from '../src/search-text.js'

const slices = (text, term) => findMatches(text, term).map(({ start, end }) => text.slice(start, end))

test('ignores accents and case in both directions', () => {
  assert.deepEqual(slices('Cómputo y cómputo; COMPUTO', 'computo'), ['Cómputo', 'cómputo', 'COMPUTO'])
  assert.deepEqual(slices('el computo final', 'CÓMPUTO'), ['computo'])
  assert.deepEqual(slices('Año nuevo', 'ano'), ['Año'])
})

test('maps decomposed accents back to the full original fragment', () => {
  const decomposed = 'el cómputo'
  assert.deepEqual(slices(decomposed, 'cómputo'), ['cómputo'])
  // Una coincidencia que termina antes del acento combinado no parte el grafema.
  assert.deepEqual(slices('café solo', 'cafe'), ['café'])
})

test('handles characters whose lowercase form changes length', () => {
  assert.deepEqual(slices('İstanbul', 'istanbul'), ['İstanbul'])
  assert.deepEqual(slices('x 😀 Ñu', 'nu'), ['Ñu'])
})

test('collapses whitespace so line breaks match spaces', () => {
  assert.deepEqual(slices('foo\n  bar', 'foo bar'), ['foo\n  bar'])
  assert.equal(normalizeQuery('  Foo   Bár '), 'foo bar')
})

test('returns non overlapping matches and respects the limit', () => {
  assert.equal(findMatches('aaaa', 'aa').length, 2)
  assert.equal(findMatches('a a a', 'a', { limit: 2 }).length, 2)
  assert.deepEqual(findMatches('texto', '   '), [])
})

test('fold map keeps one start and end per folded unit', () => {
  const { folded, starts, ends } = foldWithMap('Á b')
  assert.equal(folded, 'a b')
  assert.deepEqual(starts, [0, 1, 2])
  assert.deepEqual(ends, [1, 2, 3])
})

test('quick fold matches the mapped fold for ordinary text', () => {
  const text = 'Investigación  de\tCÓMPUTO'
  assert.equal(quickFold(text), foldWithMap(text).folded)
})

test('snippet is built around the accent-insensitive match', () => {
  const text = `${'x '.repeat(40)}el cómputo distribuido ${'y '.repeat(80)}`
  const snippet = searchSnippet(text, 'computo')
  assert.match(snippet, /^…/)
  assert.match(snippet, /cómputo distribuido/)
  assert.equal(searchSnippet('sin nada', 'zzz'), 'sin nada')
})
