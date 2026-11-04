// Selector de carpetas de la biblioteca web (sustituye al diálogo nativo).
import { LIBRARY_ROOT, joinPath } from './web-fs.js'

const english = () => document.documentElement.lang === 'en'
const text = (es, en) => (english() ? en : es)

function label(path) {
  if (path === LIBRARY_ROOT) return text('Biblioteca', 'Library')
  return path.slice(LIBRARY_ROOT.length + 1)
}

export function chooseFolder({ title, folders, mkdir }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'web-folder-dialog'
    const visible = Array.from(new Set(folders)).filter((path) => !path.split('/').some((part) => part.startsWith('.'))).sort((a, b) => a.localeCompare(b))
    dialog.innerHTML = `
      <form method="dialog">
        <h2></h2>
        <ul class="web-folder-list"></ul>
        <div class="web-folder-new">
          <input name="name" class="setting-input" autocomplete="off" />
          <button type="button" class="ghost-button" data-action="create"></button>
        </div>
        <div class="web-folder-actions"><button value="cancel" class="ghost-button"></button></div>
      </form>`
    dialog.querySelector('h2').textContent = title || text('Elegir carpeta', 'Choose folder')
    const input = dialog.querySelector('input')
    input.placeholder = text('Nueva carpeta', 'New folder')
    dialog.querySelector('[data-action="create"]').textContent = text('Crear', 'Create')
    dialog.querySelector('[value="cancel"]').textContent = text('Cancelar', 'Cancel')
    const list = dialog.querySelector('ul')
    for (const path of visible) {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'web-folder-option'
      button.textContent = label(path)
      button.style.paddingInlineStart = `${0.75 + (path.split('/').length - 2) * 0.9}rem`
      button.addEventListener('click', () => finish(path))
      item.append(button)
      list.append(item)
    }

    let settled = false
    function finish(value) {
      if (settled) return
      settled = true
      dialog.close()
      dialog.remove()
      resolve(value)
    }
    dialog.querySelector('[data-action="create"]').addEventListener('click', async () => {
      const name = input.value.trim()
      if (!name || /[\\/]/.test(name) || name.startsWith('.')) {
        input.setCustomValidity(text('Nombre de carpeta no válido', 'Invalid folder name'))
        input.reportValidity()
        return
      }
      finish(await mkdir(joinPath(LIBRARY_ROOT, name)))
    })
    input.addEventListener('input', () => input.setCustomValidity(''))
    dialog.addEventListener('close', () => finish(null))
    document.body.append(dialog)
    dialog.showModal()
  })
}
