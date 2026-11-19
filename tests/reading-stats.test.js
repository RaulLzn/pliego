import test from 'node:test'
import assert from 'node:assert/strict'
import { countWords, fillTemplate, formatPdfPage, formatPercent, formatReadingSummary, pdfProgress, progressFromPosition, readingMinutes, scrollProgress } from '../src/reading-stats.js'

test('reading time uses about 220 words per minute and never shows 0 min for text', () => {
  assert.equal(readingMinutes(0), 0)
  assert.equal(readingMinutes(10), 1)
  assert.equal(readingMinutes(2200), 10)
  assert.equal(countWords('  uno dos\n tres  '), 3)
  assert.equal(countWords(''), 0)
})

test('scroll progress is clamped and short documents count as read', () => {
  assert.equal(scrollProgress(0, 500, 800), 1)
  assert.equal(scrollProgress(0, 2000, 1000), 0)
  assert.equal(scrollProgress(500, 2000, 1000), 0.5)
  assert.equal(scrollProgress(5000, 2000, 1000), 1)
  assert.equal(scrollProgress(Number.NaN, 2000, 1000), null)
})

test('pdf progress combines page and offset', () => {
  assert.equal(pdfProgress(1, 0, 4), 0)
  assert.equal(pdfProgress(3, 0.5, 4), 0.625)
  assert.equal(pdfProgress(4, 1, 4), 1)
  assert.equal(pdfProgress(0, 0, 4), null)
})

test('formats percent per language and reads progress from saved positions', () => {
  assert.equal(formatPercent(0.424, 'es'), '42 %')
  assert.equal(formatPercent(0.424, 'en'), '42%')
  assert.equal(formatPercent(null), '')
  assert.equal(progressFromPosition({ top: 10, progress: 0.3 }), 0.3)
  assert.equal(progressFromPosition({ top: 10 }), null)
})

test('builds the reading summary and pdf page labels', () => {
  assert.equal(formatReadingSummary({ words: 660, progress: 0.5, language: 'es' }), '3 min · 50 % leído')
  assert.equal(formatReadingSummary({ words: 660, progress: 0.5, language: 'en' }), '3 min · 50% read')
  assert.equal(formatReadingSummary({ words: 0, progress: null }), '')
  assert.equal(formatPdfPage(2, 10, { language: 'es' }), 'Página 2 de 10')
  assert.equal(formatPdfPage(2, 10, { labels: { page: 'P. {page}/{total}' } }), 'P. 2/10')
  assert.equal(fillTemplate('{a} {b}', { a: 1 }), '1 {b}')
})
