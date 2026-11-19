// Exportar resaltados a Markdown e imprimir / guardar como PDF el documento del lector.
import './export-tools.css'
import { askConfirm } from './confirm-dialog.js'
import { buildHighlightsMarkdown, collectExportEntries, exportFileStem } from './highlights-export.js'

function joinPath(folder, name) {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`
}

function parentOf(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : index === 0 ? path.slice(0, 1) : ''
}

/**
 * Exporta los resaltados y notas del documento actual a `<nombre> - resaltados.md` junto a él.
 * Las dependencias vienen de main.js para no duplicar estado.
 */
export function createHighlightsExporter({ panel, controller, invoke, getState, documentExists, refreshLibrary, openDocument, showMessage, text, language }) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ghost-button annotations-export'
  const closeButton = panel.querySelector('#annotationsClose')
  closeButton?.before(button)
  button.addEventListener('click', () => void run())
  let busy = false

  // applyLanguage traduce los atributos data-i18n al cambiar de idioma.
  button.dataset.i18n = 'exportHighlights'
  button.dataset.i18nTooltip = 'exportHighlightsHint'
  button.textContent = text('exportHighlights')
  button.dataset.tooltip = text('exportHighlightsHint')

  // Primera ruta libre con sufijo ` (n)`; el índice puede estar desfasado, así que se reintenta.
  async function createUnique(folder, stem) {
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${stem} (${index})`
      if (documentExists(joinPath(folder, `${candidate}.md`))) continue
      try {
        return await invoke('create_markdown_file', { folder, title: candidate })
      } catch (error) {
        if (!/existe|exists/i.test(String(error))) throw error
      }
    }
    throw text('exportHighlightsFailed')
  }

  async function run() {
    if (busy) return
    const state = getState()
    if (state.kind !== 'markdown' || !state.path) { showMessage(text('exportHighlightsMarkdownOnly')); return }
    if (state.dirty) { showMessage(text('exportHighlightsUnsaved')); return }
    controller.refresh()
    if (controller.loadStatus === 'corrupt') { showMessage(controller.statusMessage()); return }
    const { items, orphans } = collectExportEntries({ text: controller.text, groups: controller.groups, annotations: controller.data?.annotations || [] })
    if (!items.length && !orphans.length) { showMessage(text('exportHighlightsEmpty')); return }
    const markdown = buildHighlightsMarkdown({ fileName: state.fileName, items, orphans, language: language() })
    const folder = parentOf(state.path)
    const stem = exportFileStem(state.fileName, language())
    const target = joinPath(folder, `${stem}.md`)
    busy = true
    button.disabled = true
    try {
      let path = ''
      if (documentExists(target)) {
        path = (await askConfirm(text('exportHighlightsOverwrite').replace('{name}', `${stem}.md`))) ? target : (await createUnique(folder, stem)).path
      } else {
        try {
          path = (await invoke('create_markdown_file', { folder, title: stem })).path
        } catch (error) {
          if (!/existe|exists/i.test(String(error))) throw error
          path = (await askConfirm(text('exportHighlightsOverwrite').replace('{name}', `${stem}.md`))) ? target : (await createUnique(folder, stem)).path
        }
      }
      await invoke('save_markdown_file', { path, contents: markdown })
      await refreshLibrary()
      await openDocument(path)
      showMessage(`${text('exportHighlightsDone')}: ${path.split(/[\\/]/).pop()}`)
    } catch (error) {
      showMessage(`${text('exportHighlightsFailed')}: ${error?.message || error}`)
    } finally {
      busy = false
      button.disabled = false
    }
  }

  return { run }
}

// Copia el contenido del lector a un contenedor propio que es lo único visible al imprimir.
function buildPrintRoot(reader, { showUrls }) {
  let root = document.querySelector('.pliego-print-root')
  if (!root) {
    root = document.createElement('div')
    root.setAttribute('aria-hidden', 'true')
    document.body.append(root)
  }
  const classes = Array.from(reader.classList).filter((name) => !['editing', 'empty'].includes(name))
  root.className = ['pliego-print-root', ...classes, showUrls ? 'print-show-urls' : ''].filter(Boolean).join(' ')
  root.replaceChildren(...Array.from(reader.childNodes, (node) => node.cloneNode(true)))
  // Los lienzos (PDF) no se clonan con su contenido: se sustituyen por imágenes.
  const sourceCanvases = reader.querySelectorAll('canvas')
  root.querySelectorAll('canvas').forEach((canvas, index) => {
    try {
      const image = document.createElement('img')
      image.src = sourceCanvases[index].toDataURL('image/png')
      image.className = canvas.className
      canvas.replaceWith(image)
    } catch (_) { canvas.remove() }
  })
  // Fuera: marcas de búsqueda, edición y elementos interactivos que no tienen sentido en papel.
  root.querySelectorAll('mark[data-pliego-search]').forEach((mark) => mark.replaceWith(...mark.childNodes))
  root.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'))
  root.querySelectorAll('.annotation-target').forEach((element) => element.classList.remove('annotation-target'))
  root.querySelectorAll('button, input, select, textarea').forEach((element) => element.remove())
  return root
}

// Los diagramas Mermaid llevan los colores del tema con el que se pintaron: en
// tema oscuro salían como cajas negras sobre el papel. Se repintan en claro.
async function renderDiagramsForPaper(root) {
  const shells = Array.from(root?.querySelectorAll?.('.inline-diagram[data-mermaid-source]') || [])
  if (!shells.length || document.documentElement.dataset.theme !== 'dark') return
  try {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
    for (let index = 0; index < shells.length; index += 1) {
      const { svg } = await mermaid.render(`mermaid-print-${Date.now()}-${index}`, shells[index].dataset.mermaidSource)
      shells[index].innerHTML = svg
    }
  } catch (_) {
    // Si no se puede repintar, se imprime tal cual.
  }
}

export async function printReader({ reader, fileName, showUrls = false, showMessage, text }) {
  if (!reader || reader.classList.contains('empty') || !reader.textContent.trim() && !reader.querySelector('img, svg, canvas')) {
    showMessage(text('printEmpty'))
    return
  }
  if (typeof window.print !== 'function') {
    showMessage(text('printUnsupported'))
    return
  }
  const root = buildPrintRoot(reader, { showUrls })
  await renderDiagramsForPaper(root)
  // El título del documento es el nombre que proponen los diálogos «Guardar como PDF».
  const previousTitle = document.title
  document.title = String(fileName || previousTitle).replace(/\.[^.]+$/, '') || previousTitle
  const restore = () => { document.title = previousTitle }
  window.addEventListener('afterprint', restore, { once: true })
  try {
    // En macOS Tauri sustituye window.print por una llamada asíncrona al webview.
    await window.print()
  } catch (error) {
    showMessage(`${text('printUnsupported')} ${error?.message || error || ''}`.trim())
  } finally {
    window.setTimeout(restore, 1500)
  }
}
