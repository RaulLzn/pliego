import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTags, filterByTag, frontmatterTags, inlineTags, normalizeTag, parseTagQuery, tagsForEntry } from '../src/tags.js'

test('frontmatter tags accept inline lists, block lists and comma strings', () => {
  assert.deepEqual(frontmatterTags('---\ntags: [lectura, "Ciencia ficción", \'#pendiente\'] # comentario\n---\n# Hola'), ['lectura', 'Ciencia ficción', 'pendiente'])
  assert.deepEqual(frontmatterTags('---\ntitle: Algo\ntags:\n  - uno\n  - "dos"\n- tres\nauthor: x\n---\n'), ['uno', 'dos', 'tres'])
  assert.deepEqual(frontmatterTags('---\ntags: rojo, verde ,  azul\n---\ntexto'), ['rojo', 'verde', 'azul'])
  assert.deepEqual(frontmatterTags('---\ntag: única\n---\n'), ['única'])
  assert.deepEqual(frontmatterTags('---\r\ntags: [a, b]\r\n---\r\n'), ['a', 'b'])
  assert.deepEqual(frontmatterTags('sin frontmatter\ntags: [a]'), [])
  assert.deepEqual(frontmatterTags('---\ntags: []\n---\n'), [])
})

test('inline tags skip headings, code, URLs, links and HTML attributes', () => {
  const markdown = [
    '# Título principal',
    '## Otro #título-con-tag',
    'Texto con #canción y #Ñandú/crías, y (#paréntesis).',
    'Un enlace https://ejemplo.com/#ancla y [ir](#seccion) y [[Doc#Sección]].',
    'Código `#nocode` en línea; color <span style="color: #fff">x</span>; número #123.',
    '```',
    '#include <stdio.h>',
    '```',
    '~~~js',
    'const a = "#nope"',
    '~~~',
    'palabra#pegada y #final.',
  ].join('\n')
  assert.deepEqual(inlineTags(markdown), ['título-con-tag', 'canción', 'Ñandú/crías', 'paréntesis', 'final'])
})

test('frontmatter never yields inline tags and an unclosed fence hides the rest', () => {
  assert.deepEqual(inlineTags('---\ntitle: "#nope"\n---\nCuerpo #si'), ['si'])
  assert.deepEqual(inlineTags('Antes #a\n```\n#b\n'), ['a'])
})

test('extractTags merges sources case-insensitively and keeps first spelling', () => {
  const markdown = '---\ntags: [Proyecto, idea]\n---\nNotas #proyecto #IDEA #nueva'
  assert.deepEqual(extractTags(markdown), ['Proyecto', 'idea', 'nueva'])
})

test('accented tags normalize to NFC so composed and decomposed forms match', () => {
  const decomposed = 'canción'
  assert.equal(normalizeTag(`#${decomposed}`), 'canción')
  assert.deepEqual(extractTags(`#canción y #${decomposed}`), ['canción'])
})

test('tag queries filter index entries with exact and nested matches first', () => {
  const entries = [
    { path: '/b/uno.md', kind: 'markdown', searchableText: 'Texto #proyecto-viejo' },
    { path: '/b/dos.md', kind: 'markdown', searchableText: '---\ntags: [proyecto/pliego]\n---\n' },
    { path: '/b/tres.md', kind: 'markdown', searchableText: '#Proyecto' },
    { path: '/b/csv.csv', kind: 'table', searchableText: '#proyecto' },
  ]
  assert.equal(parseTagQuery('#Proyecto'), 'proyecto')
  assert.equal(parseTagQuery('proyecto'), null)
  assert.equal(parseTagQuery('#'), null)
  assert.deepEqual(filterByTag(entries, '#proyecto').map((entry) => entry.path), ['/b/dos.md', '/b/tres.md', '/b/uno.md'])
  assert.deepEqual(filterByTag(entries, '#PROYECTO/pli').map((entry) => entry.path), ['/b/dos.md'])
  assert.deepEqual(filterByTag(entries, '#nada'), [])
  assert.deepEqual(tagsForEntry(entries[3]), [])
})
