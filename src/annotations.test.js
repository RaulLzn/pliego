import test from 'node:test'
import assert from 'node:assert/strict'
import {
  annotationDocumentKey,
  annotationDraftKey,
  annotationStorageKey,
  annotationText,
  createTextAnchor,
  decodeAnnotationDocument,
  emptyAnnotationDocument,
  makeAnnotation,
  readAnnotationDocument,
  resolveTextAnchor,
  writeAnnotationDocument,
} from './annotations.js'

test('repeated quotes resolve by exact context and saved position', () => {
  const source = 'Contexto A antes. La misma cita. Contexto A después.\n\nContexto B antes. La misma cita. Contexto B después.'
  const quote = 'La misma cita.'
  const first = source.indexOf(quote)
  const second = source.indexOf(quote, first + quote.length)
  const firstAnchor = createTextAnchor(source, first, first + quote.length)
  const secondAnchor = createTextAnchor(source, second, second + quote.length)

  assert.deepEqual(resolveTextAnchor(source, firstAnchor), { status: 'resolved', start: first, end: first + quote.length })
  assert.deepEqual(resolveTextAnchor(source, secondAnchor), { status: 'resolved', start: second, end: second + quote.length })
})

test('changed quote or changed anchor context remains orphaned instead of fuzzy reassignment', () => {
  const original = 'Contexto A antes. La misma cita. Contexto A después.\n\nContexto B antes. La misma cita. Contexto B después.'
  const quote = 'La misma cita.'
  const first = original.indexOf(quote)
  const anchor = createTextAnchor(original, first, first + quote.length)
  const oneCopyChanged = original.replace(quote, 'La cita cambió.')
  const surroundingChanged = original.replace('Contexto A antes.', 'Nuevo contexto A.')

  assert.equal(resolveTextAnchor(oneCopyChanged, anchor).status, 'orphan')
  assert.equal(resolveTextAnchor(surroundingChanged, anchor).status, 'orphan')
})

test('identical quote and context uses the original position or stays ambiguous', () => {
  const source = 'xQy xQy'
  const start = source.indexOf('Q')
  const anchor = { quote: 'Q', prefix: 'x', suffix: 'y', position: start }

  assert.equal(resolveTextAnchor(source, anchor).start, start)
  assert.equal(resolveTextAnchor(source, { ...anchor, position: -1 }).reason, 'ambiguous')
})

test('document-scoped storage validates schema and preserves a corrupt value', () => {
  const key = annotationDocumentKey('/docs/lectura.md', 'lectura.md')
  const storageKey = annotationStorageKey(key)
  const values = new Map([[storageKey, '{incompleto']])
  const storage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, value),
  }
  const loaded = readAnnotationDocument(storage, key)

  assert.equal(loaded.status, 'corrupt')
  assert.equal(values.get(storageKey), '{incompleto')
  assert.deepEqual(decodeAnnotationDocument(null, key), { status: 'ok', value: emptyAnnotationDocument(key) })
  assert.equal(annotationStorageKey(key), storageKey)
  assert.notEqual(annotationStorageKey(key), annotationStorageKey(annotationDocumentKey('/docs/otra.md')))
  assert.equal(decodeAnnotationDocument(JSON.stringify({ ...emptyAnnotationDocument(key), version: 2 }), key).status, 'corrupt')
  assert.equal(decodeAnnotationDocument(JSON.stringify(emptyAnnotationDocument('path:/another.md')), key).status, 'corrupt')
  assert.deepEqual(writeAnnotationDocument(storage, emptyAnnotationDocument('')), { status: 'invalid' })
})

test('annotation writes round-trip and quota errors leave stored comments intact', () => {
  const key = annotationDocumentKey('/docs/lectura.md')
  const storageKey = annotationStorageKey(key)
  const values = new Map()
  let failWrites = false
  const storage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      if (failWrites) throw new Error('quota')
      values.set(name, value)
    },
  }
  const source = 'Contexto previo. Fragmento para comentar. Contexto posterior.'
  const start = source.indexOf('Fragmento para comentar.')
  const anchor = createTextAnchor(source, start, start + 'Fragmento para comentar.'.length)
  const note = makeAnnotation(anchor, 'Idea útil', 10, 'note-1')
  const document = { ...emptyAnnotationDocument(key), annotations: [note] }

  assert.deepEqual(writeAnnotationDocument(storage, document), { status: 'ok' })
  assert.equal(readAnnotationDocument(storage, key).value.annotations[0].text, 'Idea útil')
  failWrites = true
  const edited = { ...document, annotations: [{ ...note, text: 'Nuevo comentario' }] }
  assert.deepEqual(writeAnnotationDocument(storage, edited), { status: 'unavailable' })
  assert.equal(JSON.parse(values.get(storageKey)).annotations[0].text, 'Idea útil')
})

test('i18n labels cover Spanish and English and fall back safely', () => {
  assert.equal(annotationText('es', 'title'), 'Resaltados y notas')
  assert.equal(annotationText('en', 'title'), 'Highlights and notes')
  assert.equal(annotationText('fr', 'delete'), 'Borrar')
})

test('draft identities are scoped to the current document', () => {
  assert.notEqual(annotationDraftKey('path:/one/doc.md', 'new:10:20:abcd'), annotationDraftKey('path:/two/doc.md', 'new:10:20:abcd'))
  assert.notEqual(annotationDraftKey('path:/one/doc.md', 'note:n-1'), annotationDraftKey('path:/two/doc.md', 'note:n-1'))
})
