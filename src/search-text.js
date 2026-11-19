// Búsqueda insensible a mayúsculas y acentos ("computo" encuentra "Cómputo").
// Es lógica pura (sin DOM) para poder probarla con node --test.

const COMBINING_MARKS = /[̀-ͯ]/g
const WHITESPACE = /\s/

function foldChar(char) {
  // Primero minúsculas: "İ" se convierte en "i" + punto combinado, que también se quita.
  return char.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
}

// Pliega el texto y guarda, para cada unidad del resultado, dónde empieza y
// termina en el original: así el <mark> envuelve exactamente el fragmento
// original aunque la normalización cambie longitudes ("ó" precompuesta vs.
// "o" + acento combinado). Los espacios consecutivos se reducen a uno para que
// un salto de línea del PDF o del HTML coincida con un espacio de la búsqueda.
export function foldWithMap(text) {
  const source = String(text ?? '')
  let folded = ''
  const starts = []
  const ends = []
  let index = 0
  for (const char of source) {
    const length = char.length
    if (WHITESPACE.test(char)) {
      if (!folded.endsWith(' ')) {
        folded += ' '
        starts.push(index)
        ends.push(index + length)
      }
    } else {
      const piece = foldChar(char)
      if (piece) {
        for (let unit = 0; unit < piece.length; unit += 1) {
          folded += piece[unit]
          starts.push(index)
          ends.push(index + length)
        }
      } else if (ends.length) {
        // Un acento suelto se pega al carácter anterior para no partir el grafema.
        for (let back = ends.length - 1; back >= 0 && ends[back] === index; back -= 1) ends[back] = index + length
      }
    }
    index += length
  }
  return { folded, starts, ends }
}

export function foldSearchText(text) {
  return foldWithMap(text).folded
}

// Versión rápida para filtrar listas grandes: mismo resultado que foldSearchText
// salvo la conservación de índices, que aquí no hace falta.
export function quickFold(text) {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '').replace(/\s+/g, ' ')
}

export function normalizeQuery(term) {
  return foldSearchText(String(term ?? '').trim())
}

// Devuelve rangos [start, end) en el texto ORIGINAL, sin solapamientos.
export function findMatches(text, term, { mapped = null, limit = Infinity } = {}) {
  const query = typeof term === 'string' ? normalizeQuery(term) : ''
  if (!query) return []
  const { folded, starts, ends } = mapped || foldWithMap(text)
  const matches = []
  let at = folded.indexOf(query)
  while (at !== -1 && matches.length < limit) {
    matches.push({ start: starts[at], end: ends[at + query.length - 1] })
    at = folded.indexOf(query, at + query.length)
  }
  return matches
}

export function countMatches(text, term) {
  return findMatches(text, term).length
}

// Fragmento alrededor de la primera coincidencia (para la búsqueda global).
export function searchSnippet(text, query, { before = 45, after = 90 } = {}) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  const [match] = findMatches(clean, query, { limit: 1 })
  if (!match) return clean.slice(0, 140)
  const from = Math.max(0, match.start - before)
  const to = match.end + after
  return `${from > 0 ? '…' : ''}${clean.slice(from, to)}${to < clean.length ? '…' : ''}`
}
