import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_READING_LAYOUT,
  READING_LAYOUT_KEY,
  loadReadingLayout,
  normalizeReadingLayout,
  persistReadingLayout,
} from '../src/reading-layout.js'

function memoryStorage(initial = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next },
    value: () => value,
  }
}

test('normalizes supported widths and clamps/steps numeric controls', () => {
  assert.deepEqual(normalizeReadingLayout({ width: '1200', lineHeight: 999, margin: 53 }), {
    width: 1200,
    lineHeight: 220,
    margin: 50,
  })
  assert.deepEqual(normalizeReadingLayout({ width: 1000, lineHeight: 163, margin: 143 }), {
    width: 0,
    lineHeight: 165,
    margin: 140,
  })
})

test('corrupt or invalid persisted JSON falls back to current reading defaults', () => {
  assert.deepEqual(loadReadingLayout(memoryStorage('{broken')), DEFAULT_READING_LAYOUT)
  assert.deepEqual(normalizeReadingLayout({ width: null, lineHeight: '', margin: false }), DEFAULT_READING_LAYOUT)
  assert.deepEqual(loadReadingLayout({ getItem: () => { throw new Error('storage unavailable') } }), DEFAULT_READING_LAYOUT)
})

test('persists normalized values and safely handles unavailable storage', () => {
  const storage = memoryStorage()
  const result = persistReadingLayout(storage, { width: 1320, lineHeight: 139, margin: 151 })
  assert.deepEqual(result, { width: 1320, lineHeight: 140, margin: 150 })
  assert.equal(storage.value(), JSON.stringify(result))
  assert.equal(loadReadingLayout(storage).width, 1320)
  assert.deepEqual(persistReadingLayout({ setItem: () => { throw new Error('disabled') } }, result), result)
  assert.equal(READING_LAYOUT_KEY, 'pliego-reading-layout')
})
