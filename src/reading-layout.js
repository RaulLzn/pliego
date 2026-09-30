export const READING_LAYOUT_KEY = 'pliego-reading-layout'

export const DEFAULT_READING_LAYOUT = Object.freeze({
  width: 0,
  lineHeight: 180,
  margin: 100,
})

const WIDTHS = new Set([0, 720, 840, 960, 1080, 1200, 1320, 1440])

function boundedNumber(value, fallback, min, max) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

export function normalizeReadingLayout(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const requestedWidth = (typeof input.width === 'number' || typeof input.width === 'string') && String(input.width).trim() !== '' ? Number(input.width) : -1
  const width = WIDTHS.has(requestedWidth) ? requestedWidth : DEFAULT_READING_LAYOUT.width
  return {
    width,
    lineHeight: Math.round(boundedNumber(input.lineHeight, DEFAULT_READING_LAYOUT.lineHeight, 140, 220) / 5) * 5,
    margin: Math.round(boundedNumber(input.margin, DEFAULT_READING_LAYOUT.margin, 50, 150) / 10) * 10,
  }
}

export function loadReadingLayout(storage) {
  try {
    const serialized = storage?.getItem(READING_LAYOUT_KEY)
    return serialized ? normalizeReadingLayout(JSON.parse(serialized)) : { ...DEFAULT_READING_LAYOUT }
  } catch (_) {
    return { ...DEFAULT_READING_LAYOUT }
  }
}

export function persistReadingLayout(storage, value) {
  const normalized = normalizeReadingLayout(value)
  try {
    storage?.setItem(READING_LAYOUT_KEY, JSON.stringify(normalized))
  } catch (_) {
    // Private mode, quota exhaustion, or a disabled storage backend must not break reading.
  }
  return normalized
}

export function createReadingLayout({ storage, reader, getKind, translate, onChange = () => {} }) {
  const controls = {
    width: document.querySelector('#readingWidth'),
    lineHeight: document.querySelector('#readingLineHeight'),
    margin: document.querySelector('#readingMargin'),
    reset: document.querySelector('#readingLayoutReset'),
  }
  let preferences = loadReadingLayout(storage)

  const valueText = (key, value) => {
    if (key === 'width') return value === 0 ? translate('readingWidthAuto') : `${value} px`
    if (key === 'lineHeight') return `${(value / 100).toFixed(2)}${translate('readingMultiplier')}`
    return `${value}%`
  }

  const renderControls = () => {
    for (const key of ['width', 'lineHeight', 'margin']) {
      if (controls[key]) controls[key].value = String(preferences[key])
      const output = document.querySelector(`#reading${key[0].toUpperCase()}${key.slice(1)}Value`)
      if (output) output.textContent = valueText(key, preferences[key])
    }
    if (controls.reset) controls.reset.disabled = Object.keys(DEFAULT_READING_LAYOUT).every((key) => preferences[key] === DEFAULT_READING_LAYOUT[key])
  }

  const setVariable = (name, value) => reader.style.setProperty(name, value)
  const clearVariables = () => {
    for (const name of ['--reading-column-width', '--reading-line-height', '--reading-margin-block', '--reading-margin-inline']) {
      reader.style.removeProperty(name)
    }
  }

  const setMargins = (kind) => {
    if (preferences.margin === DEFAULT_READING_LAYOUT.margin) return
    const factor = preferences.margin / 100
    const viewport = window.innerWidth
    const clamp = (min, preferred, max) => Math.min(max, Math.max(min, preferred))
    const htmlDocument = kind === 'docx' || kind === 'epub'
    const block = htmlDocument ? clamp(34, viewport * 0.07, 78) : (viewport <= 720 ? 22 : clamp(28, viewport * 0.04, 64))
    const inline = htmlDocument ? clamp(34, viewport * 0.07, 78) : (viewport <= 720 ? 16 : clamp(28, viewport * 0.04, 64))
    setVariable('--reading-margin-block', `${block * factor}px`)
    setVariable('--reading-margin-inline', `${inline * factor}px`)
  }

  const apply = () => {
    const kind = getKind()
    const markdown = kind === 'markdown' || kind === 'text'
    const htmlDocument = kind === 'docx' || kind === 'epub'
    reader.classList.toggle('reading-layout-custom-line-height', (markdown || htmlDocument) && preferences.lineHeight !== DEFAULT_READING_LAYOUT.lineHeight)
    reader.classList.toggle('reading-layout-markdown', markdown)
    reader.classList.toggle('reading-layout-html', htmlDocument)
    clearVariables()
    if (markdown || htmlDocument) {
      if (preferences.width && (markdown || htmlDocument)) setVariable('--reading-column-width', `${preferences.width}px`)
      if (preferences.lineHeight !== DEFAULT_READING_LAYOUT.lineHeight) setVariable('--reading-line-height', String(preferences.lineHeight / 100))
      setMargins(kind)
    }
  }

  const update = (patch) => {
    preferences = persistReadingLayout(storage, { ...preferences, ...patch })
    renderControls()
    apply()
    onChange(preferences)
  }

  for (const key of ['width', 'lineHeight', 'margin']) {
    controls[key]?.addEventListener('input', () => update({ [key]: Number(controls[key].value) }))
  }
  controls.reset?.addEventListener('click', () => update({ ...DEFAULT_READING_LAYOUT }))
  window.addEventListener('resize', apply, { passive: true })
  renderControls()
  apply()

  return { apply, getPreferences: () => ({ ...preferences }), refreshLabels: renderControls }
}
