const STORAGE_KEY = 'pliego-onboarding-v1'

const STEPS = [
  {
    es: { title: 'Bienvenido a Pliego', body: 'Un espacio local para leer, editar y organizar documentos. Este recorrido dura menos de dos minutos y no modifica ninguno de tus archivos.', label: 'Introducción' },
    en: { title: 'Welcome to Pliego', body: 'A local space to read, edit and organize documents. This tour takes less than two minutes and does not modify your files.', label: 'Introduction' },
  },
  {
    target: '#openButton',
    es: { title: 'Abre casi cualquier documento', body: 'Usa este botón o arrastra un archivo. Pliego puede mostrar Markdown, texto, PDF, DOCX, EPUB, imágenes, CSV y diagramas Mermaid.', label: 'Abrir' },
    en: { title: 'Open almost any document', body: 'Use this button or drop a file. Pliego can display Markdown, text, PDF, DOCX, EPUB, images, CSV and Mermaid diagrams.', label: 'Open' },
  },
  {
    target: '#openFolderButton',
    es: { title: 'Crea una biblioteca local', body: 'Abre una carpeta para explorar sus documentos desde el panel lateral. Los archivos permanecen en tu equipo: Pliego no los sube a ningún servidor.', label: 'Bibliotecas' },
    en: { title: 'Create a local library', body: 'Open a folder to explore its documents from the sidebar. Files stay on your computer: Pliego does not upload them to a server.', label: 'Libraries' },
  },
  {
    target: '.search',
    es: { title: 'Encuentra contenido al instante', body: 'Esta búsqueda recorre el documento abierto. Para buscar en toda una biblioteca usa el icono de carpeta con lupa o Ctrl/⌘ + Shift + F.', label: 'Búsqueda' },
    en: { title: 'Find content instantly', body: 'This search scans the open document. To search an entire library, use the folder-and-search icon or Ctrl/⌘ + Shift + F.', label: 'Search' },
  },
  {
    target: '.mode-group',
    es: { title: 'Edita Markdown visualmente', body: 'En un archivo Markdown, cambia a Edición, modifica el contenido y pulsa Guardar. PDF, DOCX, EPUB e imágenes se mantienen en modo lectura para preservar el original.', label: 'Edición' },
    en: { title: 'Edit Markdown visually', body: 'In a Markdown file, switch to Edit, change the content and press Save. PDF, DOCX, EPUB and images stay read-only to preserve the original.', label: 'Editing' },
  },
  {
    target: '#documentTabs',
    es: { title: 'Trabaja con varios archivos', body: 'Cada documento abierto aparece como una pestaña. Puedes alternar entre ellos o cerrar los que ya no necesites.', label: 'Pestañas' },
    en: { title: 'Work with multiple files', body: 'Each open document appears as a tab. Switch between them or close the ones you no longer need.', label: 'Tabs' },
  },
  {
    target: '#sidebar',
    es: { title: 'Navega y conecta ideas', body: 'El panel reúne la carpeta, recientes, enlaces y backlinks de Markdown. Puedes ocultarlo con el botón superior izquierdo para ganar espacio.', label: 'Navegación' },
    en: { title: 'Navigate and connect ideas', body: 'The sidebar brings together the folder, recent files, links and Markdown backlinks. Hide it with the top-left button for more space.', label: 'Navigation' },
  },
  {
    target: '#favoriteToggle',
    es: { title: 'Guarda accesos importantes', body: 'Marca documentos como favoritos y encuéntralos después en la pantalla de Bibliotecas.', label: 'Favoritos' },
    en: { title: 'Save important shortcuts', body: 'Mark documents as favorites and find them later on the Libraries screen.', label: 'Favorites' },
  },
  {
    target: '#tocToggle',
    es: { title: 'Salta entre secciones', body: 'El Índice detecta los encabezados del documento y te lleva directamente a la sección elegida.', label: 'Índice' },
    en: { title: 'Jump between sections', body: 'The table of contents detects document headings and takes you directly to the selected section.', label: 'Contents' },
  },
  {
    target: '#settingsButton',
    es: { title: 'Haz cómoda la lectura', body: 'Personaliza tema, tamaño, color de acento y tipografía. Tus preferencias se guardan únicamente en este dispositivo.', label: 'Apariencia' },
    en: { title: 'Make reading comfortable', body: 'Customize the theme, size, accent color and typeface. Your preferences are stored only on this device.', label: 'Appearance' },
  },
  {
    target: '#codexToggle',
    es: { title: 'Codex es opcional', body: 'Si tienes Codex CLI, puedes conversar sobre un documento o una carpeta y autorizar edición cuando lo necesites. Todo el lector funciona sin Codex.', label: 'Asistente' },
    en: { title: 'Codex is optional', body: 'If you have Codex CLI, you can discuss a document or folder and authorize editing when needed. The reader works without Codex.', label: 'Assistant' },
  },
  {
    es: { title: 'Ya conoces Pliego', body: 'Prueba abriendo un Markdown o un PDF. Puedes repetir este recorrido cuando quieras desde Configuración → Ver tutorial.', label: 'Listo' },
    en: { title: 'You know Pliego now', body: 'Try opening a Markdown file or PDF. You can repeat this tour anytime from Settings → View tutorial.', label: 'Done' },
  },
]

const BUTTON_TEXT = {
  es: { skip: 'Omitir', back: 'Anterior', next: 'Siguiente', finish: 'Empezar a usar Pliego' },
  en: { skip: 'Skip', back: 'Back', next: 'Next', finish: 'Start using Pliego' },
}

export function onboardingCompleted() {
  return localStorage.getItem(STORAGE_KEY) === 'completed'
}

export function createOnboarding() {
  const root = document.createElement('div')
  root.className = 'onboarding hidden'
  root.innerHTML = `
    <div class="onboarding-shade" aria-hidden="true"></div>
    <div class="onboarding-spotlight" aria-hidden="true"></div>
    <section class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle" tabindex="-1">
      <div class="onboarding-meta"><span id="onboardingLabel"></span><span id="onboardingProgress"></span></div>
      <h2 id="onboardingTitle"></h2>
      <p id="onboardingBody"></p>
      <div class="onboarding-dots" aria-hidden="true"></div>
      <div class="onboarding-actions">
        <button class="ghost-button" data-onboarding-skip type="button">Omitir</button>
        <div>
          <button class="ghost-button" data-onboarding-back type="button">Anterior</button>
          <button class="primary-button" data-onboarding-next type="button">Siguiente</button>
        </div>
      </div>
    </section>
  `
  document.body.append(root)

  const card = root.querySelector('.onboarding-card')
  const spotlight = root.querySelector('.onboarding-spotlight')
  const nextButton = root.querySelector('[data-onboarding-next]')
  const backButton = root.querySelector('[data-onboarding-back]')
  let index = 0
  let previousFocus = null
  let language = document.documentElement.lang === 'en' ? 'en' : 'es'

  function finish(completed = true) {
    root.classList.add('hidden')
    document.documentElement.classList.remove('onboarding-active')
    if (completed) localStorage.setItem(STORAGE_KEY, 'completed')
    previousFocus?.focus?.()
  }

  function position() {
    const step = STEPS[index]
    const target = step.target ? document.querySelector(step.target) : null
    const visible = target && target.getClientRects().length > 0

    spotlight.classList.toggle('hidden', !visible)
    root.classList.toggle('onboarding-centered', !visible)
    if (!visible) return

    const rect = target.getBoundingClientRect()
    const padding = 8
    spotlight.style.setProperty('--spotlight-top', `${Math.max(8, rect.top - padding)}px`)
    spotlight.style.setProperty('--spotlight-left', `${Math.max(8, rect.left - padding)}px`)
    spotlight.style.setProperty('--spotlight-width', `${Math.min(innerWidth - 16, rect.width + padding * 2)}px`)
    spotlight.style.setProperty('--spotlight-height', `${Math.min(innerHeight - 16, rect.height + padding * 2)}px`)

    const cardRect = card.getBoundingClientRect()
    const gap = 18
    let top = rect.bottom + gap
    if (top + cardRect.height > innerHeight - 16) top = rect.top - cardRect.height - gap
    top = Math.max(16, Math.min(top, innerHeight - cardRect.height - 16))
    let left = rect.left + rect.width / 2 - cardRect.width / 2
    left = Math.max(16, Math.min(left, innerWidth - cardRect.width - 16))
    card.style.setProperty('--onboarding-top', `${top}px`)
    card.style.setProperty('--onboarding-left', `${left}px`)
  }

  function render() {
    const step = STEPS[index]
    const copy = step[language]
    const buttons = BUTTON_TEXT[language]
    root.querySelector('#onboardingLabel').textContent = copy.label
    root.querySelector('#onboardingProgress').textContent = language === 'en' ? `${index + 1} of ${STEPS.length}` : `${index + 1} de ${STEPS.length}`
    root.querySelector('#onboardingTitle').textContent = copy.title
    root.querySelector('#onboardingBody').textContent = copy.body
    root.querySelector('.onboarding-dots').innerHTML = STEPS.map((_, dot) => `<i class="${dot === index ? 'active' : ''}"></i>`).join('')
    backButton.disabled = index === 0
    root.querySelector('[data-onboarding-skip]').textContent = buttons.skip
    backButton.textContent = buttons.back
    nextButton.textContent = index === STEPS.length - 1 ? buttons.finish : buttons.next
    requestAnimationFrame(position)
  }

  function setLanguage(nextLanguage) {
    language = nextLanguage === 'en' ? 'en' : 'es'
    if (!root.classList.contains('hidden')) render()
  }

  function start() {
    previousFocus = document.activeElement
    index = 0
    document.querySelectorAll('.modal-backdrop, .palette-backdrop').forEach((element) => element.classList.add('hidden'))
    root.classList.remove('hidden')
    document.documentElement.classList.add('onboarding-active')
    render()
    card.focus()
  }

  nextButton.addEventListener('click', () => {
    if (index === STEPS.length - 1) finish(true)
    else { index += 1; render() }
  })
  backButton.addEventListener('click', () => { if (index > 0) { index -= 1; render() } })
  root.querySelector('[data-onboarding-skip]').addEventListener('click', () => finish(true))
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') finish(true)
    if (event.key === 'ArrowRight') nextButton.click()
    if (event.key === 'ArrowLeft') backButton.click()
    if (event.key === 'Tab') {
      const focusable = [...card.querySelectorAll('button:not(:disabled)')]
      const next = focusable.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1)
      if (next < 0 || next >= focusable.length) {
        event.preventDefault()
        focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus()
      }
    }
  })
  window.addEventListener('resize', position)

  return { start, setLanguage }
}
