import './notes-ui.css'
import { dailyNote, dailyTemplatePath, fillTemplate, templatesInLibrary } from './note-templates.js'

/**
 * Selector de plantilla del diálogo «Nueva página». Se oculta si la biblioteca
 * no tiene carpeta Plantillas/ con Markdown dentro.
 */
export function createTemplatePicker({ anchor, getIndex, getFolder, text, readTemplate, now = () => new Date() }) {
  const field = document.createElement('label')
  field.className = 'new-note-field new-note-template'
  field.hidden = true
  const caption = document.createElement('span')
  caption.dataset.i18n = 'noteTemplate'
  const select = document.createElement('select')
  select.id = 'newNoteTemplate'
  field.append(caption, select)
  anchor.after(field)

  function refresh() {
    const templates = templatesInLibrary(getIndex(), getFolder())
    caption.textContent = text('noteTemplate')
    const blank = new Option(text('blankTemplate'), '')
    select.replaceChildren(blank, ...templates.map((template) => new Option(template.name, template.path)))
    select.value = ''
    field.hidden = !templates.length
  }

  // Contenido inicial para create_markdown_file, o undefined para la página en blanco.
  async function contentsFor(title) {
    if (!select.value) return undefined
    return fillTemplate(await readTemplate(select.value), { title, date: now() })
  }

  return { refresh, contentsFor }
}

/**
 * «Nota diaria»: abre Diario/AAAA-MM-DD.md de la biblioteca actual o la crea
 * (con Plantillas/Diario.md si existe). Las dependencias llegan de main.js.
 */
export function createDailyNote({ invoke, getFolder, getIndex, isDirty, readTemplate, refreshLibrary, openPath, afterCreate, notify, formatError = String, text, now = () => new Date() }) {
  let busy = false

  return async function openDailyNote() {
    const folder = getFolder()
    if (!folder) {
      notify(text('dailyNeedsFolder'))
      return
    }
    if (isDirty()) {
      notify(text('dailyUnsaved'))
      return
    }
    if (busy) return
    busy = true
    try {
      const date = now()
      const { title, subfolder } = dailyNote(date)
      const templatePath = dailyTemplatePath(getIndex(), folder)
      const contents = templatePath ? fillTemplate(await readTemplate(templatePath), { title, date }) : undefined
      const result = await invoke('create_markdown_file', { folder, title, subfolder, existingOk: true, ...(contents === undefined ? {} : { contents }) })
      if (result.created) await refreshLibrary(folder)
      if (await openPath(result.path) && result.created) afterCreate?.(result)
    } catch (error) {
      notify(`${text('dailyFailed')}: ${formatError(error)}`)
    } finally {
      busy = false
    }
  }
}
