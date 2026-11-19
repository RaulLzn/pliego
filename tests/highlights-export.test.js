import test from 'node:test'
import assert from 'node:assert/strict'
import { createTextAnchor, makeAnnotation } from '../src/annotations.js'
import { buildHighlightsMarkdown, collectExportEntries, escapeMarkdownText, exportFileStem, formatExportDate, wikiTarget } from '../src/highlights-export.js'

const text = 'Primera frase importante. Relleno. Segunda *idea* <b>clave</b>. Final.'
const group = (quote, color) => {
  const start = text.indexOf(quote)
  return { start, end: start + quote.length, quote, color, anchor: createTextAnchor(text, start, start + quote.length) }
}

test('entries follow document order and attach notes to their highlight', () => {
  const first = group('Primera frase importante.', 'yellow')
  const second = group('Segunda *idea* <b>clave</b>.', 'blue')
  const annotations = [
    makeAnnotation(second.anchor, 'Nota de la segunda', 2, 'b'),
    makeAnnotation(first.anchor, 'Nota de la primera', 1, 'a'),
    makeAnnotation({ quote: 'texto borrado', prefix: '', suffix: '', position: 0 }, 'Huérfana', 3, 'c'),
  ]
  const { items, orphans } = collectExportEntries({ text, groups: [first, second], annotations })
  assert.deepEqual(items, [
    { quote: 'Primera frase importante.', color: 'yellow', notes: ['Nota de la primera'] },
    { quote: 'Segunda *idea* <b>clave</b>.', color: 'blue', notes: ['Nota de la segunda'] },
  ])
  assert.deepEqual(orphans, [{ quote: 'texto borrado', notes: ['Huérfana'] }])
})

test('markdown summary has title, date, quotes, colors, notes and wiki-links', () => {
  const markdown = buildHighlightsMarkdown({
    fileName: 'Mi libro.md',
    items: [
      { quote: 'Primera frase.', color: 'yellow', notes: [] },
      { quote: 'Segunda *idea*\ncon dos líneas', color: 'green', notes: ['Comentario\nen dos líneas'] },
    ],
    orphans: [{ quote: 'perdida', notes: ['sigue aquí'] }],
    date: new Date(2026, 10, 18),
  })
  assert.equal(markdown, [
    '# Resaltados: Mi libro',
    '',
    '- **Documento:** [[Mi libro]]',
    '- **Exportado:** 2026-11-18',
    '- 2 resaltados · 2 notas',
    '',
    '## Resaltado 1',
    '',
    '> Primera frase.',
    '',
    '- **Color:** amarillo',
    '- **Fuente:** [[Mi libro]]',
    '',
    '## Resaltado 2',
    '',
    '> Segunda \\*idea\\*',
    '> con dos líneas',
    '',
    '- **Color:** verde',
    '- **Nota:** Comentario',
    '  en dos líneas',
    '- **Fuente:** [[Mi libro]]',
    '',
    '## Notas sin fragmento',
    '',
    '_El texto original cambió o el resaltado se quitó; se conserva la cita guardada._',
    '',
    '> perdida',
    '',
    '- **Nota:** sigue aquí',
    '- **Fuente:** [[Mi libro]]',
    '',
  ].join('\n'))
})

test('english summary localizes labels and color names', () => {
  const markdown = buildHighlightsMarkdown({ fileName: 'Book.md', items: [{ quote: 'One', color: 'pink', notes: ['n'] }], language: 'en', date: new Date(2026, 0, 2) })
  assert.match(markdown, /^# Highlights: Book\n/)
  assert.match(markdown, /- \*\*Color:\*\* pink/)
  assert.match(markdown, /- 1 highlight · 1 note/)
  assert.match(markdown, /2026-01-02/)
})

test('quotes are escaped so they stay plain text', () => {
  assert.equal(escapeMarkdownText('<script>a</script> *b* [c](d) `e`'), '\\<script\\>a\\</script\\> \\*b\\* \\[c\\](d) \\`e\\`')
  assert.equal(escapeMarkdownText('# no título\n- no lista\n1. no orden'), '\\# no título\n\\- no lista\n\\1. no orden')
})

test('file names and wiki targets are safe', () => {
  assert.equal(exportFileStem('Notas: parte 1.md'), 'Notas parte 1 - resaltados')
  assert.equal(exportFileStem('Book.markdown', 'en'), 'Book - highlights')
  assert.equal(exportFileStem(''), 'documento - resaltados')
  assert.ok(exportFileStem(`${'x'.repeat(200)}.md`).length <= 120)
  assert.equal(wikiTarget('Doc [v2] #1.md'), 'Doc v2 1')
  assert.equal(formatExportDate(new Date(2026, 2, 5)), '2026-03-05')
})
