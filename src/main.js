import './style.css'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import hljs from 'highlight.js/lib/common'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { decodeBase64, renderMermaidBlocks, renderMermaidDocument, renderTableDocument, renderVisualDocument } from './document-renderers.js'

const THEME_KEY = 'pliego-theme'
const RECENTS_KEY = 'pliego-recents'
const SCALE_KEY = 'pliego-scale'
const FOLDER_KEY = 'pliego-folder'
const FONT_KEY = 'pliego-reader-font'
const SIDEBAR_KEY = 'pliego-sidebar'
const CODEX_THREADS_KEY = 'pliego-codex-threads'
const LIBRARIES_KEY = 'pliego-libraries'
const LANGUAGE_KEY = 'pliego-language'
const FAVORITES_KEY = 'pliego-favorites'
const MAX_RECENTS = 5
const MIN_SCALE = 0.75
const MAX_SCALE = 1.7

for (const suffix of ['theme', 'recents', 'scale', 'folder', 'reader-font', 'sidebar', 'codex-threads', 'libraries', 'language', 'favorites', 'accent']) {
  const current = `pliego-${suffix}`
  const legacy = `md-ligero-${suffix}`
  if (localStorage.getItem(current) === null && localStorage.getItem(legacy) !== null) localStorage.setItem(current, localStorage.getItem(legacy))
}

const ICONS = {
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 2h8l4 4v16H6zM14 2v5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 6h7l2 2h9v11H3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',
  command: '<svg viewBox="0 0 24 24"><path d="M9 6h6M9 18h6M6 9v6M18 9v6"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/></svg>',
  ai: '<svg viewBox="0 0 24 24"><path d="M12 2c.8 4.9 3.1 7.2 8 8-4.9.8-7.2 3.1-8 8-.8-4.9-3.1-7.2-8-8 4.9-.8 7.2-3.1 8-8Z"/><path d="M19 16c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  toc: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  library: '<svg viewBox="0 0 24 24"><path d="M4 4h5v16H4zM10 4h5v16h-5zM16 6l4-1 2 14-4 1z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 6.5 17 10"/></svg>',
}
const icon = (name) => `<span class="animated-icon" aria-hidden="true">${ICONS[name]}</span>`

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
})
turndown.use(gfm)
turndown.keep(['mark'])

const state = {
  fileName: '',
  filePath: '',
  markdown: '',
  frontmatter: '',
  html: '',
  matches: [],
  activeMatchIndex: -1,
  mode: 'read',
  folder: '',
  scale: 1,
  dirty: false,
  codexThreadId: '',
  codexBusy: false,
  codexContext: 'document',
  codexSuppressRestore: false,
  codexModels: [],
  codexItemPhases: {},
  codexFinalMarkdown: '',
  documentIndex: [],
  documentKind: 'markdown',
  paletteMode: 'files',
  openTabs: [],
  language: localStorage.getItem(LANGUAGE_KEY) || 'es',
}

document.querySelector('#app').innerHTML = `
  <div class="shell">
    <div class="window-titlebar" data-tauri-drag-region>
      <div class="window-title" data-tauri-drag-region><img src="/pliego-icon.png" alt="" /> Pliego</div>
      <div class="window-controls">
        <button id="windowMinimize" type="button" aria-label="Minimizar">−</button>
        <button id="windowMaximize" type="button" aria-label="Maximizar">□</button>
        <button id="windowClose" class="close" type="button" aria-label="Cerrar">×</button>
      </div>
    </div>
    <header class="topbar">
      <div class="brand">
        <button id="sidebarToggle" class="tool-button" type="button" aria-label="Mostrar u ocultar panel" data-tooltip="Panel lateral">${icon('menu')}</button>
        <button id="homeButton" class="brand-mark" type="button" aria-label="Bibliotecas" data-tooltip="Bibliotecas"><img src="/pliego-icon.png" alt="" /></button>
        <div class="brand-text">
          <p class="eyebrow">Biblioteca documental</p>
          <h1>Pliego</h1>
        </div>
      </div>

      <div class="toolbar">
        <div class="tool-cluster">
          <button id="openButton" class="tool-button accent" type="button" aria-label="Abrir archivo" data-tooltip="Abrir archivo">${icon('file')}</button>
          <button id="openFolderButton" class="tool-button" type="button" aria-label="Abrir carpeta" data-tooltip="Abrir carpeta">${icon('folder')}</button>
          <button id="folderSearchButton" class="tool-button" type="button" aria-label="Buscar en carpeta" data-tooltip="Buscar en carpeta · Ctrl+Shift+F">${icon('search')}</button>
          <button id="quickOpenButton" class="tool-button" type="button" aria-label="Apertura rápida" data-tooltip="Apertura rápida · Ctrl+P">${icon('command')}</button>
        </div>
        <label class="search">
          <span class="search-label">Buscar</span>
          <input id="searchInput" type="search" placeholder="Titulos, texto, codigo..." />
          <span id="searchStats" class="search-stats">0</span>
        </label>
        <div class="btn-group mode-group">
          <button id="modeRead" class="mode-button active" type="button">Lectura</button>
          <button id="modeEdit" class="mode-button" type="button">Edicion</button>
        </div>
        <button id="saveButton" class="ghost-button hidden" type="button">Guardar</button>
        <div class="tool-cluster">
          <button id="codexToggle" class="tool-button ai-button" type="button" aria-label="Codex AI" data-tooltip="Asistente Codex">${icon('ai')}</button>
          <button id="favoriteToggle" class="tool-button" type="button" aria-label="Añadir a favoritos" data-tooltip="Añadir a favoritos">${icon('star')}</button>
          <button id="tocToggle" class="tool-button" type="button" aria-label="Indice" data-tooltip="Índice">${icon('toc')}</button>
          <button id="settingsButton" class="tool-button" type="button" aria-label="Configuraciones" data-tooltip="Configuración">${icon('settings')}</button>
        </div>
      </div>
    </header>

    <div id="documentTabs" class="document-tabs" aria-label="Archivos abiertos"></div>

    <input id="fileInput" type="file" accept=".md,.markdown,.mdown,.mkd,.txt,.csv,.tsv,.pdf,.docx,.epub,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.mmd,.mermaid" hidden />

    <main class="workspace">
      <aside class="sidebar" id="sidebar">
        <section class="panel">
          <p class="panel-label" data-i18n="fileLabel">Archivo</p>
          <h2 id="fileName" data-i18n="noFile">Ningún archivo abierto</h2>
          <p id="metaInfo" class="muted" data-i18n="openHint">Abre o arrastra un archivo para visualizarlo.</p>
        </section>

        <section class="panel tree-panel">
          <div class="panel-row">
            <p class="panel-label" data-i18n="folderLabel">Carpeta</p>
            <p id="treeCount" class="muted"></p>
          </div>
          <div id="tree" class="tree">
            <p class="muted" data-i18n="folderHint">Abre una biblioteca para explorar sus documentos.</p>
          </div>
        </section>

        <section class="panel recents-panel">
          <p class="panel-label" data-i18n="recentsLabel">Recientes</p>
          <div id="recents" class="recents">
            <p class="muted" data-i18n="noRecents">Aún no hay archivos recientes.</p>
          </div>
        </section>

        <section class="panel references-panel">
          <div class="panel-row"><p class="panel-label" data-i18n="referencesLabel">Referencias</p><span id="referenceCount" class="muted">0</span></div>
          <div id="references" class="references"><p class="muted" data-i18n="referencesHint">Abre un Markdown para ver sus enlaces.</p></div>
        </section>
      </aside>

      <section class="reader-wrap">
        <div id="messageBar" class="message-bar hidden" role="status" aria-live="polite"></div>
        <div id="dropzone" class="dropzone">
          <p>Arrastra aqui tu archivo .md o usa el boton de arriba.</p>
        </div>
        <article id="reader" class="reader empty">
          <div class="empty-state">
            <p class="eyebrow" data-i18n="clearReading">Lectura clara</p>
            <h2 data-i18n="readyTitle">Listo para abrir tus documentos</h2>
            <p data-i18n="readyLead">Visor ligero con bibliotecas, edición visual y navegación wiki.</p>
          </div>
        </article>
        <div id="formatMenu" class="format-menu hidden"></div>
        <div id="highlightMenu" class="highlight-menu hidden">
          <span class="hl-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
          </span>
          <button class="hl-dot" data-hl="yellow" type="button" aria-label="Resaltar amarillo"></button>
          <button class="hl-dot" data-hl="green" type="button" aria-label="Resaltar verde"></button>
          <button class="hl-dot" data-hl="pink" type="button" aria-label="Resaltar rosa"></button>
          <button class="hl-dot" data-hl="blue" type="button" aria-label="Resaltar azul"></button>
          <button class="hl-dot remove" data-hl="remove" type="button" aria-label="Quitar resaltado">✕</button>
        </div>
      </section>
    </main>

    <aside id="tocOverlay" class="toc-overlay hidden">
      <div class="panel-row toc-overlay-head">
        <p class="panel-label">Indice</p>
        <span id="tocCount" class="muted">0 secciones</span>
        <button id="tocClose" class="icon-button small" type="button" aria-label="Cerrar indice">✕</button>
      </div>
      <nav id="toc" class="toc">
        <p class="muted">El indice aparecera aqui.</p>
      </nav>
    </aside>

    <aside id="codexPanel" class="codex-panel hidden" aria-label="Chat con Codex">
      <div class="codex-head">
        <div><p class="panel-label">Asistente local</p><h2>Codex</h2></div>
        <span id="codexStatus" class="codex-status">Desconectado</span>
        <button id="codexClose" class="icon-button small" type="button" aria-label="Cerrar Codex">✕</button>
      </div>
      <p id="codexNotice" class="codex-notice">Abre un Markdown para iniciar la conversación.</p>
      <div id="codexMessages" class="codex-messages" aria-live="polite"></div>
      <form id="codexForm" class="codex-form">
        <textarea id="codexInput" rows="3" placeholder="Pregunta sobre el Markdown…"></textarea>
        <details id="codexOptions" class="codex-options">
          <summary><span class="codex-options-dot" aria-hidden="true"></span><span id="codexOptionsSummary">Modelo y esfuerzo</span><span class="codex-chevron">⌄</span></summary>
          <div class="codex-controls">
            <label><span>Modelo</span><select id="codexModel"><option value="">Cargando…</option></select></label>
            <label><span>Esfuerzo</span><select id="codexEffort"><option value="">Predeterminado</option></select></label>
            <label><span>Contexto</span><select id="codexContext"><option value="document">Markdown + referencias</option><option value="folder">Toda la carpeta</option></select></label>
            <label><span>Permisos</span><select id="codexPermission"><option value="read">Solo lectura</option><option value="write">Editar Markdown</option></select></label>
          </div>
        </details>
        <label class="codex-web"><input id="codexWeb" type="checkbox" /> Permitir búsqueda web en este mensaje</label>
        <div class="codex-actions">
          <button id="codexCancel" class="ghost-button hidden" type="button">Cancelar</button>
          <button id="codexSend" class="primary-button" type="submit">Enviar</button>
        </div>
      </form>
    </aside>

    <div id="settingsModal" class="modal-backdrop hidden">
      <div class="modal">
        <div class="panel-row">
          <p class="panel-label">Configuraciones</p>
          <button id="settingsClose" class="icon-button small" type="button" aria-label="Cerrar">✕</button>
        </div>

        <div class="setting-row">
          <span>Tema</span>
          <div class="btn-group mode-group">
            <button class="mode-button" data-set-theme="light" type="button">Claro</button>
            <button class="mode-button" data-set-theme="dark" type="button">Oscuro</button>
          </div>
        </div>

        <div class="setting-row">
          <span>Tamano de letra</span>
          <div class="btn-group">
            <button id="fontMinus" class="icon-button" type="button">A−</button>
            <span id="scaleLabel" class="scale-label">100%</span>
            <button id="fontPlus" class="icon-button" type="button">A+</button>
          </div>
        </div>

        <div class="setting-row">
          <span>Color de acento</span>
          <div class="accent-swatches">
            <button class="accent-dot" data-set-accent="#d4962a" style="background:#d4962a" type="button" aria-label="Dorado"></button>
            <button class="accent-dot" data-set-accent="#2ab5a8" style="background:#2ab5a8" type="button" aria-label="Teal"></button>
            <button class="accent-dot" data-set-accent="#e06452" style="background:#e06452" type="button" aria-label="Coral"></button>
            <button class="accent-dot" data-set-accent="#38b37e" style="background:#38b37e" type="button" aria-label="Verde"></button>
            <button class="accent-dot" data-set-accent="#8b7fd4" style="background:#8b7fd4" type="button" aria-label="Purpura"></button>
          </div>
        </div>

        <div class="setting-row">
          <span>Fuente de lectura</span>
          <div class="btn-group mode-group">
            <button class="mode-button" data-set-font="serif" type="button">Serif</button>
            <button class="mode-button" data-set-font="sans" type="button">Sans</button>
            <button class="mode-button" data-set-font="mono" type="button">Mono</button>
          </div>
        </div>

        <div class="setting-row">
          <span>Historial</span>
          <button id="clearRecents" class="ghost-button" type="button">Limpiar recientes</button>
        </div>
      </div>
    </div>

    <div id="commandPalette" class="palette-backdrop hidden">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <div class="palette-input-row"><span id="paletteIcon">⌘</span><input id="paletteInput" autocomplete="off" placeholder="Abrir archivo…" /><kbd>Esc</kbd></div>
        <div id="paletteHint" class="palette-hint">Escribe para filtrar los documentos de la carpeta</div>
        <div id="paletteResults" class="palette-results"></div>
      </section>
    </div>

    <div id="libraryHome" class="library-home hidden">
      <div class="library-home-shell">
        <header class="library-hero"><div class="library-logo">${icon('library')}</div><div><p class="eyebrow" data-i18n="workspace">ESPACIO DE TRABAJO</p><h2 data-i18n="libraries">Tus bibliotecas</h2><p data-i18n="librariesLead">Organiza carpetas de documentos y entra con un clic.</p></div><button id="libraryHomeClose" class="tool-button" type="button" aria-label="Cerrar">✕</button></header>
        <button id="addLibraryButton" class="add-library-card" type="button">${icon('plus')}<span><strong data-i18n="addLibrary">Añadir biblioteca</strong><small data-i18n="addLibraryHint">Selecciona una carpeta de tu equipo</small></span></button>
        <div class="home-dashboard"><main class="home-primary">
          <div class="home-section-head"><div><p class="panel-label">Colecciones</p><h3>Bibliotecas</h3></div><div class="sort-control"><span>Ordenar por</span><details id="librarySort" class="life-select"><summary><span id="librarySortLabel">Más reciente</span><i>⌄</i></summary><div class="life-select-menu"><button data-sort="recent" type="button">Más reciente</button><button data-sort="name" type="button">Nombre</button><button data-sort="color" type="button">Color</button></div></details></div></div>
          <div id="libraryGrid" class="library-grid"></div>
          <div class="home-section-head"><div><p class="panel-label">Acceso rápido</p><h3>Favoritos</h3></div></div><div id="homeFavorites" class="home-file-row"></div>
        </main><aside class="home-recent-column"><div class="home-section-head"><div><p class="panel-label">Actividad</p><h3>Recientes</h3></div></div><div id="homeRecents" class="home-file-row"></div></aside></div>
        <footer class="library-footer"><div class="sort-control"><span data-i18n="language">Idioma</span><details id="languageSelect" class="life-select"><summary><span id="languageLabel">Español</span><i>⌄</i></summary><div class="life-select-menu"><button data-language="es" type="button">Español</button><button data-language="en" type="button">English</button></div></details></div></footer>
      </div>
    </div>
    <div id="libraryEditor" class="modal-backdrop hidden"><section class="library-editor modal"><div class="panel-row"><div><p class="panel-label">Editar biblioteca</p><h2 id="libraryEditorName"></h2></div><button id="libraryEditorClose" class="icon-button small" type="button">✕</button></div><p class="editor-label">Color</p><div id="libraryColors" class="library-color-grid"></div><p class="editor-label">Icono opcional</p><div id="libraryIcons" class="library-icon-grid"></div><div class="library-editor-actions"><button id="libraryEditorSave" class="primary-button" type="button">Guardar cambios</button></div></section></div>
  </div>
`

const $ = (selector) => document.querySelector(selector)

const fileInput = $('#fileInput')
const searchInput = $('#searchInput')
const searchStats = $('#searchStats')
const fileNameLabel = $('#fileName')
const metaInfo = $('#metaInfo')
const treeBox = $('#tree')
const treeCount = $('#treeCount')
const recentsBox = $('#recents')
const toc = $('#toc')
const tocCount = $('#tocCount')
const tocOverlay = $('#tocOverlay')
const reader = $('#reader')
const readerWrap = $('.reader-wrap')
const dropzone = $('#dropzone')
const messageBar = $('#messageBar')
const formatMenu = $('#formatMenu')
const sidebar = $('#sidebar')
const workspace = document.querySelector('.workspace')
const saveButton = $('#saveButton')
const modeReadButton = $('#modeRead')
const modeEditButton = $('#modeEdit')
const settingsModal = $('#settingsModal')
const scaleLabel = $('#scaleLabel')
const codexPanel = $('#codexPanel')
const codexStatusLabel = $('#codexStatus')
const codexNotice = $('#codexNotice')
const codexMessages = $('#codexMessages')
const codexModel = $('#codexModel')
const codexEffort = $('#codexEffort')
const codexContext = $('#codexContext')
const codexPermission = $('#codexPermission')
const codexInput = $('#codexInput')
const codexSend = $('#codexSend')
const codexCancel = $('#codexCancel')
const codexOptions = $('#codexOptions')
const codexOptionsSummary = $('#codexOptionsSummary')
const commandPalette = $('#commandPalette')
const paletteInput = $('#paletteInput')
const paletteResults = $('#paletteResults')
const paletteHint = $('#paletteHint')
const referencesBox = $('#references')
const referenceCount = $('#referenceCount')
const documentTabs = $('#documentTabs')
const libraryHome = $('#libraryHome')
const libraryGrid = $('#libraryGrid')
const homeRecents = $('#homeRecents')
const homeFavorites = $('#homeFavorites')
const favoriteToggle = $('#favoriteToggle')
const libraryEditor = $('#libraryEditor')

// ---------- Preferencias ----------

applyTheme(localStorage.getItem(THEME_KEY) || 'dark')
applyScale(Number(localStorage.getItem(SCALE_KEY)) || 1)
applyReaderFont(localStorage.getItem(FONT_KEY) || 'serif')
if (localStorage.getItem(SIDEBAR_KEY) === 'hidden') {
  toggleSidebar(false)
}
renderRecents()
renderDocumentTabs()

const appWindow = getCurrentWindow()
$('#windowMinimize').addEventListener('click', () => void appWindow.minimize().catch(() => {}))
$('#windowMaximize').addEventListener('click', () => void appWindow.toggleMaximize().catch(() => {}))
$('#windowClose').addEventListener('click', () => void appWindow.close().catch(() => {}))
$('.window-titlebar').addEventListener('dblclick', (event) => {
  if (!event.target.closest('.window-controls')) void appWindow.toggleMaximize().catch(() => {})
})

$('#sidebarToggle').addEventListener('click', () => toggleSidebar())
$('#homeButton').addEventListener('click', openLibraryHome)
$('#homeButton').addEventListener('pointerdown', () => libraryHome.classList.remove('hidden'))
$('#libraryHomeClose').addEventListener('click', () => libraryHome.classList.add('hidden'))
$('#addLibraryButton').addEventListener('click', () => void openFolder())
favoriteToggle.addEventListener('click', toggleFavorite)
let librarySortValue = 'recent'
$('#libraryEditorClose').addEventListener('click', () => libraryEditor.classList.add('hidden'))
$('#librarySort').addEventListener('click', (event) => {
  const option = event.target.closest('[data-sort]')
  if (!option) return
  librarySortValue = option.dataset.sort
  $('#librarySortLabel').textContent = option.textContent
  $('#librarySort').removeAttribute('open')
  renderLibraries()
})
$('#languageSelect').addEventListener('click', (event) => {
  const option = event.target.closest('[data-language]')
  if (!option) return
  applyLanguage(option.dataset.language)
  $('#languageSelect').removeAttribute('open')
})
$('#tocToggle').addEventListener('click', () => tocOverlay.classList.toggle('hidden'))
$('#tocClose').addEventListener('click', () => tocOverlay.classList.add('hidden'))
$('#settingsButton').addEventListener('click', () => settingsModal.classList.remove('hidden'))
$('#settingsClose').addEventListener('click', () => settingsModal.classList.add('hidden'))
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) {
    settingsModal.classList.add('hidden')
  }
})
$('#fontMinus').addEventListener('click', () => stepScale(-0.1))
$('#fontPlus').addEventListener('click', () => stepScale(0.1))
$('#clearRecents').addEventListener('click', () => {
  localStorage.removeItem(RECENTS_KEY)
  renderRecents()
})

document.querySelectorAll('[data-set-theme]').forEach((button) => {
  button.addEventListener('click', () => {
    applyTheme(button.dataset.setTheme)
    localStorage.setItem(THEME_KEY, button.dataset.setTheme)
  })
})

document.querySelectorAll('[data-set-font]').forEach((button) => {
  button.addEventListener('click', () => {
    applyReaderFont(button.dataset.setFont)
    localStorage.setItem(FONT_KEY, button.dataset.setFont)
  })
})

function toggleSidebar(show) {
  const hidden = show === undefined ? !sidebar.classList.contains('hidden') : !show
  sidebar.classList.toggle('hidden', hidden)
  workspace.classList.toggle('full', hidden)
  localStorage.setItem(SIDEBAR_KEY, hidden ? 'hidden' : 'visible')
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.querySelectorAll('[data-set-theme]').forEach((button) => {
    button.classList.toggle('active', button.dataset.setTheme === theme)
  })
}

const ACCENT_KEY = 'pliego-accent'

document.querySelectorAll('[data-set-accent]').forEach((button) => {
  button.addEventListener('click', () => {
    applyAccent(button.dataset.setAccent)
    localStorage.setItem(ACCENT_KEY, button.dataset.setAccent)
  })
})

function applyAccent(hex) {
  const root = document.documentElement.style
  root.setProperty('--accent', hex)
  root.setProperty('--accent-dim', hex + '1f')
  root.setProperty('--accent-glow', hex + '40')
  document.querySelectorAll('[data-set-accent]').forEach((button) => {
    button.classList.toggle('active', button.dataset.setAccent === hex)
  })
}

const savedAccent = localStorage.getItem(ACCENT_KEY)
if (savedAccent) {
  applyAccent(savedAccent)
}

function applyReaderFont(font) {
  document.documentElement.dataset.readerFont = font
  document.querySelectorAll('[data-set-font]').forEach((button) => {
    button.classList.toggle('active', button.dataset.setFont === font)
  })
}

function applyScale(scale) {
  state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
  document.documentElement.style.setProperty('--font-scale', String(state.scale))
  localStorage.setItem(SCALE_KEY, String(state.scale))
  scaleLabel.textContent = Math.round(state.scale * 100) + '%'
}

function stepScale(delta) {
  applyScale(Math.round((state.scale + delta) * 100) / 100)
}

const TRANSLATIONS = {
  es: { workspace: 'ESPACIO DE TRABAJO', libraries: 'Tus bibliotecas', librariesLead: 'Organiza carpetas de documentos y entra con un clic.', addLibrary: 'Añadir biblioteca', addLibraryHint: 'Selecciona una carpeta de tu equipo', language: 'Idioma', emptyLibraries: 'Aún no hay bibliotecas. Añade tu primera carpeta.', openFile: 'Abrir archivo', openFolder: 'Abrir carpeta', folderSearch: 'Buscar en carpeta · Ctrl+Shift+F', quickOpen: 'Apertura rápida · Ctrl+P', assistant: 'Asistente Codex', index: 'Índice', settings: 'Configuración', searchPlaceholder: 'Títulos, texto, código…', read: 'Lectura', edit: 'Edición', save: 'Guardar', fileLabel: 'Archivo', noFile: 'Ningún archivo abierto', openHint: 'Abre o arrastra un archivo para visualizarlo.', folderLabel: 'Carpeta', folderHint: 'Abre una biblioteca para explorar sus documentos.', recentsLabel: 'Recientes', noRecents: 'Aún no hay archivos recientes.', referencesLabel: 'Referencias', referencesHint: 'Abre un Markdown para ver sus enlaces.', clearReading: 'Lectura clara', readyTitle: 'Listo para abrir tus documentos', readyLead: 'Visor ligero con bibliotecas, edición visual y navegación wiki.' },
  en: { workspace: 'WORKSPACE', libraries: 'Your libraries', librariesLead: 'Organize document folders and open them with one click.', addLibrary: 'Add library', addLibraryHint: 'Choose a folder from your computer', language: 'Language', emptyLibraries: 'No libraries yet. Add your first folder.', openFile: 'Open file', openFolder: 'Open folder', folderSearch: 'Search folder · Ctrl+Shift+F', quickOpen: 'Quick open · Ctrl+P', assistant: 'Codex assistant', index: 'Table of contents', settings: 'Settings', searchPlaceholder: 'Titles, text, code…', read: 'Read', edit: 'Edit', save: 'Save', fileLabel: 'File', noFile: 'No file open', openHint: 'Open or drop a file to view it.', folderLabel: 'Folder', folderHint: 'Open a library to explore its documents.', recentsLabel: 'Recent', noRecents: 'No recent files yet.', referencesLabel: 'References', referencesHint: 'Open a Markdown file to see its links.', clearReading: 'Clear reading', readyTitle: 'Ready to open your documents', readyLead: 'A lightweight viewer with libraries, visual editing and wiki navigation.' },
}

function applyLanguage(language) {
  state.language = language === 'en' ? 'en' : 'es'
  localStorage.setItem(LANGUAGE_KEY, state.language)
  document.documentElement.lang = state.language
  const labels = TRANSLATIONS[state.language]
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const value = labels[element.dataset.i18n]
    if (value) element.textContent = value
  })
  const tooltipMap = { openButton: labels.openFile, openFolderButton: labels.openFolder, folderSearchButton: labels.folderSearch, quickOpenButton: labels.quickOpen, codexToggle: labels.assistant, tocToggle: labels.index, settingsButton: labels.settings }
  Object.entries(tooltipMap).forEach(([id, value]) => { const button = $(`#${id}`); button.dataset.tooltip = value; button.setAttribute('aria-label', value.split(' · ')[0]) })
  searchInput.placeholder = labels.searchPlaceholder
  modeReadButton.textContent = labels.read
  modeEditButton.textContent = labels.edit
  saveButton.textContent = labels.save
  renderRecents()
  if ($('#languageLabel')) $('#languageLabel').textContent = state.language === 'en' ? 'English' : 'Español'
  renderLibraries()
}

function libraries() {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARIES_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch (_) { return [] }
}

function addLibrary(path) {
  const list = libraries().filter((item) => item.path !== path)
  const existing = libraries().find((item) => item.path === path)
  list.unshift({ ...existing, path, name: path.split('/').filter(Boolean).pop() || path, updatedAt: Date.now() })
  localStorage.setItem(LIBRARIES_KEY, JSON.stringify(list))
  renderLibraries()
}

function openLibraryHome() {
  libraryHome.classList.remove('hidden')
  renderLibraries()
  renderHomeFiles()
}

function renderLibraries() {
  if (!libraryGrid) return
  const sort = librarySortValue
  const list = [...libraries()].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'color' ? (a.color || '').localeCompare(b.color || '') : (b.updatedAt || 0) - (a.updatedAt || 0))
  if (!list.length) {
    libraryGrid.innerHTML = `<p class="library-empty">${TRANSLATIONS[state.language].emptyLibraries}</p>`
    return
  }
  libraryGrid.innerHTML = list.map((item) => `<div class="library-card" data-library-path="${escapeHtml(item.path)}" style="--library-color:${escapeHtml(item.color || '#d4962a')}"><button class="library-open" type="button"><b class="library-custom-icon">${escapeHtml(item.icon || '▥')}</b><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.path)}</small></span><i>→</i></button><button class="library-edit" type="button" data-edit-library="${escapeHtml(item.path)}" aria-label="Editar biblioteca">${icon('edit')}</button></div>`).join('')
}

libraryGrid.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit-library]')
  if (edit) { openLibraryEditor(edit.dataset.editLibrary); return }
  const card = event.target.closest('[data-library-path]')
  if (!card) return
  libraryHome.classList.add('hidden')
  void loadFolder(card.dataset.libraryPath)
})

const LIBRARY_COLORS = ['#d4962a', '#e06452', '#ed6fa5', '#a779e9', '#6e7ee8', '#3b9de1', '#2ab5a8', '#38b37e', '#8fae36', '#d17a3d']
const LIBRARY_ICONS = ['▥', '📚', '📁', '⌘', '◈', '🧠', '⚗', '🎓', '✦', '🗃']
let editingLibraryPath = ''
let editingLibraryColor = ''
let editingLibraryIcon = ''

function openLibraryEditor(path) {
  const item = libraries().find((library) => library.path === path)
  if (!item) return
  editingLibraryPath = path
  editingLibraryColor = item.color || LIBRARY_COLORS[0]
  editingLibraryIcon = item.icon || LIBRARY_ICONS[0]
  $('#libraryEditorName').textContent = item.name
  $('#libraryColors').innerHTML = LIBRARY_COLORS.map((color) => `<button class="library-color${color === editingLibraryColor ? ' active' : ''}" style="background:${color}" data-library-color="${color}" type="button" aria-label="${color}"></button>`).join('')
  $('#libraryIcons').innerHTML = LIBRARY_ICONS.map((value) => `<button class="library-icon-choice${value === editingLibraryIcon ? ' active' : ''}" data-library-icon="${escapeHtml(value)}" type="button">${escapeHtml(value)}</button>`).join('')
  libraryEditor.classList.remove('hidden')
}

$('#libraryColors').addEventListener('click', (event) => { const choice = event.target.closest('[data-library-color]'); if (!choice) return; editingLibraryColor = choice.dataset.libraryColor; $('#libraryColors').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button === choice)) })
$('#libraryIcons').addEventListener('click', (event) => { const choice = event.target.closest('[data-library-icon]'); if (!choice) return; editingLibraryIcon = choice.dataset.libraryIcon; $('#libraryIcons').querySelectorAll('button').forEach((button) => button.classList.toggle('active', button === choice)) })
$('#libraryEditorSave').addEventListener('click', () => {
  const list = libraries().map((item) => item.path === editingLibraryPath ? { ...item, color: editingLibraryColor, icon: editingLibraryIcon, updatedAt: Date.now() } : item)
  localStorage.setItem(LIBRARIES_KEY, JSON.stringify(list))
  libraryEditor.classList.add('hidden')
  renderLibraries()
})

function favorites() {
  try { const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); return Array.isArray(value) ? value : [] } catch (_) { return [] }
}

function toggleFavorite() {
  if (!state.filePath) { showMessage('Abre un archivo para añadirlo a favoritos.'); return }
  const list = favorites()
  const exists = list.some((item) => item.path === state.filePath)
  const next = exists ? list.filter((item) => item.path !== state.filePath) : [{ path: state.filePath, name: state.fileName, kind: state.documentKind, addedAt: Date.now() }, ...list]
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
  updateFavoriteButton()
  renderHomeFiles()
}

function updateFavoriteButton() {
  const active = Boolean(state.filePath && favorites().some((item) => item.path === state.filePath))
  favoriteToggle.classList.toggle('favorite-active', active)
  favoriteToggle.dataset.tooltip = active ? 'Quitar de favoritos' : 'Añadir a favoritos'
  favoriteToggle.setAttribute('aria-label', favoriteToggle.dataset.tooltip)
}

function renderHomeFiles() {
  if (!homeRecents || !homeFavorites) return
  const render = (items, empty) => items.length ? items.slice(0, 5).map((item) => `<button class="home-file-card" type="button" data-home-file="${escapeHtml(item.path)}"><span>${tabIcon(item.kind || kindFromPath(item.path))}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.path)}</small></button>`).join('') : `<p class="home-empty">${empty}</p>`
  homeRecents.innerHTML = render(getRecents(), 'No hay archivos recientes.')
  homeFavorites.innerHTML = render(favorites(), 'Aún no has añadido favoritos.')
}

;[homeRecents, homeFavorites].forEach((container) => container.addEventListener('click', (event) => { const file = event.target.closest('[data-home-file]'); if (!file) return; libraryHome.classList.add('hidden'); void loadFileFromPath(file.dataset.homeFile) }))

applyLanguage(state.language)

// ---------- Codex App Server ----------

$('#codexToggle').addEventListener('click', () => void openCodexPanel())
$('#codexClose').addEventListener('click', () => codexPanel.classList.add('hidden'))
codexContext.addEventListener('change', () => {
  state.codexContext = codexContext.value
  void restoreCodexContext()
})
codexModel.addEventListener('change', () => {
  renderCodexEfforts()
  persistCodexAssociation()
  updateCodexOptionsSummary()
})
codexEffort.addEventListener('change', () => {
  persistCodexAssociation()
  updateCodexOptionsSummary()
})
codexContext.addEventListener('change', updateCodexOptionsSummary)
codexPermission.addEventListener('change', updateCodexOptionsSummary)
document.addEventListener('click', (event) => {
  if (codexOptions.open && !codexOptions.contains(event.target)) codexOptions.removeAttribute('open')
})
codexPermission.addEventListener('change', async () => {
  if (state.codexThreadId) {
    try {
      await invoke('codex_set_writable', {
        threadId: state.codexThreadId,
        writable: codexPermission.value === 'write',
      })
    } catch (error) {
      setCodexNotice(formatError(error), true)
    }
  }
})

$('#codexForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  const message = codexInput.value.trim()
  if (!message || state.codexBusy) return
  if (!state.codexThreadId && !(await restoreCodexContext())) return
  appendCodexMessage('user', message)
  appendCodexLoading('Preparando respuesta')
  state.codexItemPhases = {}
  state.codexFinalMarkdown = ''
  codexInput.value = ''
  setCodexBusy(true)
  try {
    await invoke('codex_send_turn', {
      threadId: state.codexThreadId,
      message,
      model: codexModel.value || null,
      effort: codexEffort.value || null,
      allowWeb: $('#codexWeb').checked,
    })
    $('#codexWeb').checked = false
  } catch (error) {
    codexMessages.querySelector('.codex-loading')?.remove()
    appendCodexMessage('assistant', `Error: ${formatError(error)}`)
    setCodexBusy(false)
  }
})

codexInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    $('#codexForm').requestSubmit()
  }
})

codexCancel.addEventListener('click', async () => {
  try {
    await invoke('codex_interrupt', { threadId: state.codexThreadId })
  } catch (error) {
    setCodexNotice(formatError(error), true)
  }
})

void listen('codex-event', ({ payload }) => handleCodexEvent(payload)).catch(() => {})

async function openCodexPanel() {
  codexPanel.classList.remove('hidden')
  codexStatusLabel.textContent = 'Conectando…'
  try {
    const status = await invoke('codex_status')
    const models = await invoke('codex_models')
    codexStatusLabel.textContent = status.authenticated ? 'Conectado' : 'Sin sesión'
    codexStatusLabel.classList.toggle('error', !status.authenticated)
    setCodexNotice(status.message, !status.authenticated)
    renderCodexModels(models.data || [])
    if (status.authenticated) await restoreCodexContext()
  } catch (error) {
    codexStatusLabel.textContent = 'No disponible'
    codexStatusLabel.classList.add('error')
    setCodexNotice(`${formatError(error)}. Ejecuta codex login si falta la sesión.`, true)
  }
}

function renderCodexModels(models) {
  state.codexModels = models
  const selected = codexModel.value
  codexModel.innerHTML = models
    .map((model) => `<option value="${escapeHtml(model.model)}"${model.isDefault ? ' data-default="1"' : ''}>${escapeHtml(model.displayName)}</option>`)
    .join('')
  const preferred = models.find((model) => model.model === selected) || models.find((model) => model.isDefault) || models[0]
  if (preferred) codexModel.value = preferred.model
  renderCodexEfforts()
  updateCodexOptionsSummary()
}

function renderCodexEfforts(preferredValue = '') {
  const model = state.codexModels.find((item) => item.model === codexModel.value)
  const efforts = (model && model.supportedReasoningEfforts) || []
  codexEffort.innerHTML = efforts
    .map((option) => `<option value="${escapeHtml(option.reasoningEffort)}">${escapeHtml(effortLabel(option.reasoningEffort))}</option>`)
    .join('')
  const preferred = efforts.find((option) => option.reasoningEffort === preferredValue)
    || efforts.find((option) => option.reasoningEffort === model?.defaultReasoningEffort)
    || efforts[0]
  if (preferred) codexEffort.value = preferred.reasoningEffort
  updateCodexOptionsSummary()
}

function updateCodexOptionsSummary() {
  const model = codexModel.selectedOptions[0]?.textContent || 'Modelo'
  const effort = codexEffort.selectedOptions[0]?.textContent || 'Esfuerzo'
  codexOptionsSummary.textContent = `${model} · ${effort}`
}

function effortLabel(value) {
  return ({ minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo' })[value] || value
}

function codexScope() {
  if (state.codexContext === 'folder') {
    return state.folder ? { path: state.folder, contextType: 'folder' } : null
  }
  return state.filePath ? { path: state.filePath, contextType: 'document' } : null
}

function codexKey(scope = codexScope()) {
  return scope ? `${scope.contextType}:${scope.path}` : ''
}

function codexAssociations() {
  try {
    const value = JSON.parse(localStorage.getItem(CODEX_THREADS_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch (_) {
    return {}
  }
}

function persistCodexAssociation() {
  const key = codexKey()
  if (!key || !state.codexThreadId) return
  const associations = codexAssociations()
  associations[key] = { threadId: state.codexThreadId, model: codexModel.value, effort: codexEffort.value }
  localStorage.setItem(CODEX_THREADS_KEY, JSON.stringify(associations))
}

async function restoreCodexContext() {
  const scope = codexScope()
  if (!scope) {
    state.codexThreadId = ''
    codexMessages.innerHTML = ''
    setCodexNotice(state.codexContext === 'folder' ? 'Abre una carpeta primero.' : 'Abre un Markdown primero.', true)
    return false
  }
  const saved = codexAssociations()[codexKey(scope)] || {}
  if (saved.model && Array.from(codexModel.options).some((option) => option.value === saved.model)) {
    codexModel.value = saved.model
  }
  renderCodexEfforts(saved.effort || '')
  setCodexNotice('Cargando conversación…')
  try {
    const result = await invoke('codex_open_context', {
      request: {
        path: scope.path,
        folder: state.folder || null,
        contextType: scope.contextType,
        writable: codexPermission.value === 'write',
        threadId: saved.threadId || null,
        model: codexModel.value || null,
      },
    })
    state.codexThreadId = result.threadId
    persistCodexAssociation()
    renderCodexHistory(result.thread)
    const related = scope.contextType === 'document' ? ` Puede leer ${result.relatedCount || 0} Markdown relacionados directamente.` : ''
    setCodexNotice((result.resumed ? 'Conversación reanudada.' : saved.threadId ? 'El thread anterior no estaba disponible; se creó uno nuevo.' : 'Conversación lista.') + related)
    return true
  } catch (error) {
    state.codexThreadId = ''
    setCodexNotice(formatError(error), true)
    return false
  }
}

function renderCodexHistory(thread) {
  codexMessages.innerHTML = ''
  for (const turn of (thread && thread.turns) || []) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        const text = (item.content || []).map((entry) => entry.text || '').join('')
        if (text) appendCodexMessage('user', text.replace(/^.*?\n\n/s, ''))
      } else if (item.type === 'agentMessage' && item.text && item.phase !== 'commentary') {
        const message = appendCodexMessage('assistant', item.text)
        void renderCodexMarkdown(message, item.text)
      }
    }
  }
}

function appendCodexMessage(role, text) {
  const message = document.createElement('div')
  message.className = `codex-message ${role}`
  message.textContent = text
  codexMessages.appendChild(message)
  codexMessages.scrollTop = codexMessages.scrollHeight
  return message
}

function appendCodexLoading(label) {
  codexMessages.querySelector('.codex-loading')?.remove()
  const loading = document.createElement('div')
  loading.className = 'codex-loading'
  loading.innerHTML = `<span class="codex-orbit" aria-hidden="true"><i></i><i></i><i></i></span><span>${escapeHtml(label)}</span>`
  codexMessages.appendChild(loading)
  codexMessages.scrollTop = codexMessages.scrollHeight
}

function setCodexBusy(busy) {
  state.codexBusy = busy
  codexSend.disabled = busy
  codexCancel.classList.toggle('hidden', !busy)
  codexStatusLabel.textContent = busy ? 'Pensando…' : 'Conectado'
}

function setCodexNotice(message, isError = false) {
  codexNotice.textContent = message
  codexNotice.classList.toggle('error', isError)
}

async function handleCodexEvent(event) {
  if (!event || typeof event !== 'object') return
  if (event.type === 'delta') {
    const phase = state.codexItemPhases[event.itemId]
    if (phase !== 'final_answer') return
    let response = codexMessages.querySelector('.codex-message.assistant.streaming')
    if (!response) {
      codexMessages.querySelector('.codex-loading')?.remove()
      response = appendCodexMessage('assistant', '')
      response.classList.add('streaming')
    }
    state.codexFinalMarkdown += event.delta || ''
    response.textContent += event.delta || ''
    codexMessages.scrollTop = codexMessages.scrollHeight
  } else if (event.type === 'completed') {
    const items = event.data?.turn?.items || []
    const finalItem = [...items].reverse().find((item) => item.type === 'agentMessage' && item.phase !== 'commentary')
    const markdown = finalItem?.text || state.codexFinalMarkdown
    codexMessages.querySelector('.codex-loading')?.remove()
    let response = codexMessages.querySelector('.codex-message.assistant.streaming')
    if (!response && markdown) response = appendCodexMessage('assistant', markdown)
    if (response) {
      response.classList.remove('streaming')
      await renderCodexMarkdown(response, markdown || response.textContent)
    }
    setCodexBusy(false)
  } else if (event.type === 'toolActivity' && event.data?.item?.type === 'agentMessage') {
    state.codexItemPhases[event.data.item.id] = event.data.item.phase || 'unknown'
    if (event.data.item.phase === 'final_answer') appendCodexLoading('Escribiendo respuesta')
  } else if (event.type === 'toolActivity' && event.tool) {
    setCodexNotice(`Herramienta: ${event.tool}${event.success === false ? ' (rechazada)' : ''}`, event.success === false)
  } else if (event.type === 'toolActivity' && event.data?.item?.type === 'dynamicToolCall') {
    appendCodexLoading(event.data.item.tool === 'markdown_read' ? 'Leyendo Markdown' : 'Trabajando con Markdown')
  } else if (event.type === 'fileModified') {
    setCodexNotice('Markdown actualizado; refrescando visor.')
    if (state.filePath) void refreshCodexEditedDocument()
  } else if (event.type === 'rateLimits') {
    setCodexNotice('Límites de uso actualizados por Codex.')
  } else if (event.type === 'error' || event.type === 'connection') {
    setCodexNotice(event.message || 'Codex se desconectó.', true)
    setCodexBusy(false)
    if (event.type === 'connection' && event.connected === false && !codexPanel.classList.contains('hidden')) {
      window.setTimeout(() => void openCodexPanel(), 800)
    }
  }
}

async function renderCodexMarkdown(element, markdown) {
  if (!element || !markdown) return
  try {
    const html = await invoke('render_markdown_text', { contents: markdown })
    element.innerHTML = sanitizeCodexHtml(html)
  } catch (_) {
    element.textContent = markdown
  }
}

function sanitizeCodexHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('script, style, iframe, object, embed, form, input, button').forEach((node) => node.remove())
  template.content.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on') || name === 'style' || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
        node.removeAttribute(attribute.name)
      }
    }
  })
  return template.innerHTML
}

async function refreshCodexEditedDocument() {
  state.codexSuppressRestore = true
  try {
    await loadFileFromPath(state.filePath)
  } finally {
    state.codexSuppressRestore = false
  }
}

// ---------- Apertura de archivos ----------

$('#openButton').addEventListener('click', () => void openMarkdown())
$('#openFolderButton').addEventListener('click', () => void openFolder())
$('#folderSearchButton').addEventListener('click', () => openPalette('search'))
$('#quickOpenButton').addEventListener('click', () => openPalette('files'))

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0] ? event.target.files[0] : null
  if (file) {
    await loadBrowserFile(file)
  }
  fileInput.value = ''
})

async function openMarkdown() {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'Documentos', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt', 'csv', 'tsv', 'pdf', 'docx', 'epub', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'mmd', 'mermaid'] }],
    })
    if (typeof selected === 'string' && selected.length > 0) {
      await loadFileFromPath(selected)
      return
    }
    if (selected === null) {
      return
    }
  } catch (_) {
    // Fuera de Tauri: usar el input del navegador.
  }
  fileInput.click()
}

async function openFolder() {
  try {
    const selected = await openDialog({ directory: true, multiple: false })
    if (typeof selected === 'string' && selected.length > 0) {
      await loadFolder(selected)
    }
  } catch (error) {
    showMessage('No pude abrir la carpeta: ' + formatError(error))
  }
}

async function loadFolder(dir) {
  try {
    const [nodes, index] = await Promise.all([
      invoke('list_markdown_tree', { dir }),
      invoke('list_document_index', { dir }),
    ])
    state.folder = dir
    state.documentIndex = Array.isArray(index) ? index : []
    addLibrary(dir)
    localStorage.setItem(FOLDER_KEY, dir)
    renderTree(nodes)
    if (!codexPanel.classList.contains('hidden') && state.codexContext === 'folder') void restoreCodexContext()
  } catch (error) {
    showMessage('No pude leer la carpeta: ' + formatError(error))
  }
}

function countFiles(nodes) {
  let total = 0
  for (const node of nodes) {
    total += node.isDir ? countFiles(node.children) : 1
  }
  return total
}

function renderTree(nodes) {
  treeCount.textContent = `${countFiles(nodes)} archivos`
  if (!nodes.length) {
    treeBox.innerHTML = '<p class="muted">La carpeta no tiene documentos compatibles.</p>'
    return
  }
  treeBox.innerHTML = nodes.map((node) => renderTreeNode(node)).join('')
}

function renderTreeNode(node) {
  if (node.isDir) {
    return `
      <details class="tree-dir" open>
        <summary>${escapeHtml(node.name)}</summary>
        <div class="tree-children">${node.children.map((child) => renderTreeNode(child)).join('')}</div>
      </details>
    `
  }
  return `<button class="tree-file" type="button" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">${escapeHtml(node.name)}</button>`
}

treeBox.addEventListener('click', (event) => {
  const target = event.target.closest('.tree-file')
  if (target) {
    void loadFileFromPath(target.dataset.path)
  }
})

async function loadInitialFile() {
  try {
    const path = await invoke('get_launch_path')
    if (typeof path === 'string' && path.length > 0) {
      await loadFileFromPath(path)
    }
  } catch (_) {
    // Fuera de Tauri.
  }
  const savedFolder = localStorage.getItem(FOLDER_KEY)
  if (savedFolder) {
    void loadFolder(savedFolder)
  }
}

async function loadBrowserFile(file) {
  try {
    const markdown = await file.text()
    let html
    try {
      html = await invoke('render_markdown_text', { contents: markdown })
    } catch (_) {
      html = `<pre>${escapeHtml(markdown)}</pre>`
    }
    applyDocument(file.name, '', markdown, html)
    hideMessage()
  } catch (error) {
    showMessage(`No pude leer el archivo: ${formatError(error)}`)
  }
}

async function loadFileFromPath(path) {
  if (state.mode === 'edit' && state.dirty) {
    showMessage('Tienes cambios sin guardar. Guarda o vuelve a Lectura antes de abrir otro archivo.')
    return
  }
  try {
    const entry = state.documentIndex.find((item) => item.path === path)
    const kind = entry?.kind || kindFromPath(path)
    if (!['markdown', 'text'].includes(kind)) {
      await loadVisualFile(path, kind, entry)
      return
    }
    const payload = await invoke('read_markdown_file', {
      path,
      folder: state.folder || null,
    })
    if (!payload || typeof payload !== 'object') {
      throw new Error('respuesta invalida')
    }
    applyDocument(payload.fileName, path, payload.contents, payload.html)
    state.documentKind = kind
    renderReferences()
    addRecent(path, payload.fileName)
    hideMessage()
  } catch (error) {
    showMessage(`No pude abrir el archivo seleccionado: ${formatError(error)}`)
  }
}

async function loadVisualFile(path, kind, entry) {
  const payload = await invoke('read_binary_document', { path })
  state.fileName = payload.fileName
  state.filePath = path
  state.documentKind = kind
  state.markdown = entry?.searchableText || ''
  state.frontmatter = ''
  state.dirty = false
  state.mode = 'read'
  readerWrap.scrollTop = 0
  reader.classList.remove('editing')
  reader.contentEditable = 'false'
  modeReadButton.classList.add('active')
  modeEditButton.classList.remove('active')
  modeEditButton.disabled = true
  saveButton.classList.add('hidden')
  let info
  if (kind === 'table') {
    const text = new TextDecoder().decode(decodeBase64(payload.base64))
    state.markdown = text
    info = await renderTableDocument(reader, text, path.toLowerCase().endsWith('.tsv') ? '\t' : ',')
  } else if (kind === 'mermaid') {
    const text = new TextDecoder().decode(decodeBase64(payload.base64))
    state.markdown = text
    info = await renderMermaidDocument(reader, text)
  } else {
    info = await renderVisualDocument(reader, payload, path)
  }
  fileNameLabel.textContent = state.fileName
  metaInfo.textContent = info?.detail || kind
  toc.innerHTML = '<p class="muted">Este documento no usa encabezados Markdown.</p>'
  tocCount.textContent = 'Vista visual'
  searchInput.value = ''
  searchStats.textContent = '0'
  markActiveTreeFile()
  renderReferences()
  addRecent(path, payload.fileName)
  addDocumentTab(path, payload.fileName, kind)
  updateFavoriteButton()
  hideMessage()
}

function kindFromPath(path) {
  const extension = path.split('.').pop().toLowerCase()
  if (['md', 'markdown', 'mdown', 'mkd'].includes(extension)) return 'markdown'
  if (extension === 'txt') return 'text'
  if (['csv', 'tsv'].includes(extension)) return 'table'
  if (['mmd', 'mermaid'].includes(extension)) return 'mermaid'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extension)) return 'image'
  return extension
}

function splitFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/)
  return match ? match[0] : ''
}

function applyDocument(fileName, filePath, markdown, html) {
  reader._visualCleanup?.()
  reader._visualCleanup = null
  state.fileName = fileName
  state.filePath = filePath
  state.markdown = markdown
  state.frontmatter = splitFrontmatter(markdown)
  state.html = html
  state.dirty = false
  state.documentKind = kindFromPath(filePath || fileName)
  modeEditButton.disabled = false
  reader.classList.remove('visual-document')

  readerWrap.scrollTop = 0
  readerWrap.scrollLeft = 0

  reader.classList.remove('empty')
  reader.innerHTML = html
  decorateRenderedContent()
  updateMeta()
  renderToc()
  runSearch(searchInput.value)
  markActiveTreeFile()
  renderReferences()
  if (filePath) addDocumentTab(filePath, fileName, state.documentKind)
  updateFavoriteButton()
  if (!state.codexSuppressRestore && !codexPanel.classList.contains('hidden') && state.codexContext === 'document') void restoreCodexContext()
}

function addDocumentTab(path, name, kind) {
  if (!path) return
  if (!state.openTabs.some((tab) => tab.path === path)) state.openTabs.push({ path, name, kind })
  renderDocumentTabs()
}

function renderDocumentTabs() {
  if (!documentTabs) return
  documentTabs.classList.toggle('hidden', state.openTabs.length === 0)
  documentTabs.innerHTML = state.openTabs.map((tab) => `<button class="document-tab${tab.path === state.filePath ? ' active' : ''}" type="button" data-tab-path="${escapeHtml(tab.path)}" title="${escapeHtml(tab.path)}"><span class="tab-kind">${tabIcon(tab.kind)}</span><span>${escapeHtml(tab.name)}</span>${tab.path === state.filePath && state.dirty ? '<i class="dirty-dot"></i>' : `<i class="tab-close" data-close-tab="${escapeHtml(tab.path)}" aria-label="Cerrar">×</i>`}</button>`).join('')
  documentTabs.querySelector('.document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function tabIcon(kind) {
  return ({ pdf: 'PDF', docx: 'W', epub: 'E', table: '▦', image: '◇', mermaid: '⌁', markdown: 'M', text: 'T' })[kind] || '•'
}

documentTabs.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-tab]')
  if (close) {
    event.stopPropagation()
    void closeDocumentTab(close.dataset.closeTab)
    return
  }
  const tab = event.target.closest('[data-tab-path]')
  if (tab && tab.dataset.tabPath !== state.filePath) void loadFileFromPath(tab.dataset.tabPath)
})

async function closeDocumentTab(path) {
  if (path === state.filePath && state.dirty) {
    showMessage('Guarda los cambios antes de cerrar esta pestaña.')
    return
  }
  const index = state.openTabs.findIndex((tab) => tab.path === path)
  if (index < 0) return
  state.openTabs.splice(index, 1)
  if (path === state.filePath) {
    const next = state.openTabs[Math.min(index, state.openTabs.length - 1)]
    if (next) await loadFileFromPath(next.path)
    else clearCurrentDocument()
  }
  renderDocumentTabs()
}

function clearCurrentDocument() {
  state.fileName = ''
  state.filePath = ''
  state.markdown = ''
  state.dirty = false
  updateFavoriteButton()
  reader.className = 'reader empty'
  reader.innerHTML = '<div class="empty-state"><p class="eyebrow">Lectura clara</p><h2>Listo para abrir documentos</h2><p>Abre una biblioteca o arrastra un archivo.</p></div>'
  fileNameLabel.textContent = 'Ningún archivo abierto'
  metaInfo.textContent = 'Selecciona un documento para visualizarlo.'
  renderReferences()
}

function markActiveTreeFile() {
  const buttons = treeBox.querySelectorAll('.tree-file')
  for (const button of buttons) {
    button.classList.toggle('active', button.dataset.path === state.filePath)
  }
}

// ---------- Recientes ----------

recentsBox.addEventListener('click', (event) => {
  const target = event.target.closest('[data-path]')
  if (target) {
    void loadFileFromPath(target.dataset.path)
  }
})

function getRecents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : []
  } catch (_) {
    return []
  }
}

function addRecent(path, name) {
  const list = getRecents().filter((item) => item.path !== path)
  list.unshift({ path, name })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)))
  renderRecents()
  renderHomeFiles()
}

function renderRecents() {
  const list = getRecents()
  if (!list.length) {
    recentsBox.innerHTML = `<p class="muted">${state.language === 'en' ? 'No recent files yet.' : 'Aún no hay archivos recientes.'}</p>`
    return
  }
  recentsBox.innerHTML = list
    .map(
      (item) =>
        `<button class="recent-link" type="button" data-path="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</button>`,
    )
    .join('')
}

// ---------- Wiki: navegacion entre .md ----------

reader.addEventListener('click', (event) => {
  if (state.mode === 'edit') {
    return
  }
  const link = event.target.closest('a[href]')
  if (!link) {
    return
  }
  const href = link.getAttribute('href') || ''

  if (href.startsWith('#')) {
    return
  }

  event.preventDefault()

  if (/^[a-z]+:\/\//i.test(href) || href.startsWith('mailto:')) {
    showMessage(`Enlace externo (no se abre en el visor): ${href}`)
    return
  }

  const clean = decodeURIComponent(href.split('#')[0])
  if (!/\.(md|markdown|mdown|mkd|txt)$/i.test(clean)) {
    showMessage(`Solo puedo navegar a otros archivos Markdown: ${href}`)
    return
  }

  const base = state.filePath ? state.filePath.replace(/\/[^/]*$/, '') : state.folder
  if (!base && !clean.startsWith('/')) {
    showMessage('No conozco la ruta base para resolver este enlace.')
    return
  }
  void loadFileFromPath(resolvePath(base, clean))
})

function resolvePath(base, relative) {
  if (relative.startsWith('/')) {
    return relative
  }
  const parts = base.split('/').filter(Boolean)
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return '/' + parts.join('/')
}

// ---------- Modos lectura / edicion (WYSIWYG) ----------

modeReadButton.addEventListener('click', () => setMode('read'))
modeEditButton.addEventListener('click', () => setMode('edit'))
saveButton.addEventListener('click', () => void saveDocument())

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    if (state.mode === 'edit') {
      void saveDocument()
    }
  }
})

reader.addEventListener('input', () => {
  if (state.mode === 'edit') {
    state.dirty = true
    renderDocumentTabs()
  }
})

function setMode(mode) {
  if (mode === state.mode) {
    return
  }
  state.mode = mode
  modeReadButton.classList.toggle('active', mode === 'read')
  modeEditButton.classList.toggle('active', mode === 'edit')
  saveButton.classList.toggle('hidden', mode !== 'edit')
  reader.classList.toggle('editing', mode === 'edit')

  if (mode === 'edit') {
    if (reader.classList.contains('empty')) {
      reader.classList.remove('empty')
      reader.innerHTML = '<p></p>'
    }
    clearHighlights()
    reader.contentEditable = 'true'
    reader.focus()
  } else {
    hideFormatMenu()
    reader.contentEditable = 'false'
    if (state.dirty) {
      void rerenderFromEditor()
    }
  }
}

function editorMarkdown() {
  clearHighlights()
  const clone = reader.cloneNode(true)
  clone.querySelectorAll('pre code').forEach((block) => {
    block.textContent = block.textContent
  })
  const body = turndown.turndown(clone.innerHTML)
  return state.frontmatter + body + '\n'
}

async function rerenderFromEditor() {
  const markdown = editorMarkdown()
  let html
  try {
    html = await invoke('render_markdown_text', { contents: markdown })
  } catch (_) {
    html = reader.innerHTML
  }
  applyDocument(state.fileName || 'sin-titulo.md', state.filePath, markdown, html)
  state.dirty = true
}

async function saveDocument() {
  if (!state.filePath) {
    showMessage('Este documento no tiene ruta en disco; abrelo desde el dialogo o el arbol para poder guardar.')
    return
  }
  try {
    const markdown = editorMarkdown()
    await invoke('save_markdown_file', { path: state.filePath, contents: markdown })
    state.markdown = markdown
    state.dirty = false
    renderDocumentTabs()
    showMessage(`Guardado: ${state.fileName}`)
    setTimeout(hideMessage, 2200)
  } catch (error) {
    showMessage('No pude guardar: ' + formatError(error))
  }
}

// ---------- Menu de formato (WYSIWYG, con toggle) ----------

const FORMAT_ACTIONS = [
  { label: 'Negrita', hint: 'B', run: () => document.execCommand('bold') },
  { label: 'Cursiva', hint: 'I', run: () => document.execCommand('italic') },
  { label: 'Tachado', hint: 'S', run: () => document.execCommand('strikeThrough') },
  { label: 'Codigo inline', hint: '</>', run: toggleInlineCode },
  { label: 'Titulo 1', hint: 'H1', run: () => toggleBlock('H1') },
  { label: 'Titulo 2', hint: 'H2', run: () => toggleBlock('H2') },
  { label: 'Titulo 3', hint: 'H3', run: () => toggleBlock('H3') },
  { label: 'Parrafo normal', hint: 'P', run: () => document.execCommand('formatBlock', false, 'P') },
  { label: 'Cita', hint: '>', run: () => toggleBlock('BLOCKQUOTE') },
  { label: 'Lista', hint: '•', run: () => document.execCommand('insertUnorderedList') },
  { label: 'Lista numerada', hint: '1.', run: () => document.execCommand('insertOrderedList') },
  { label: 'Quitar formato', hint: '×', run: () => document.execCommand('removeFormat') },
]

formatMenu.innerHTML = FORMAT_ACTIONS.map(
  (action, index) =>
    `<button type="button" data-action="${index}"><span>${action.label}</span><code>${escapeHtml(action.hint)}</code></button>`,
).join('')

function toggleBlock(tag) {
  const current = document.getSelection().anchorNode
  const block = current && (current.nodeType === 1 ? current : current.parentElement).closest(tag.toLowerCase())
  document.execCommand('formatBlock', false, block ? 'P' : tag)
}

function toggleInlineCode() {
  const selection = document.getSelection()
  if (!selection.rangeCount) {
    return
  }
  const anchor = selection.anchorNode
  const element = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement)
  const existing = element && element.closest('code')

  if (existing && reader.contains(existing)) {
    const text = document.createTextNode(existing.textContent || '')
    existing.parentNode.replaceChild(text, existing)
    state.dirty = true
    return
  }

  const range = selection.getRangeAt(0)
  if (range.collapsed) {
    return
  }
  const code = document.createElement('code')
  try {
    range.surroundContents(code)
  } catch (_) {
    code.textContent = range.toString()
    range.deleteContents()
    range.insertNode(code)
  }
  state.dirty = true
}

reader.addEventListener('mouseup', () => {
  if (state.mode === 'edit') {
    setTimeout(maybeShowFormatMenu, 10)
  } else {
    setTimeout(maybeShowHighlightMenu, 10)
  }
})
reader.addEventListener('keyup', (event) => {
  if (state.mode !== 'edit') {
    return
  }
  if (event.shiftKey || event.key === 'Shift') {
    maybeShowFormatMenu()
  } else if (document.getSelection().isCollapsed) {
    hideFormatMenu()
  }
})
document.addEventListener('selectionchange', () => {
  if (document.getSelection().isCollapsed) {
    hideFormatMenu()
    hideHighlightMenu()
  }
})

function maybeShowFormatMenu() {
  const selection = document.getSelection()
  if (selection.isCollapsed || !selection.rangeCount) {
    hideFormatMenu()
    return
  }
  const range = selection.getRangeAt(0)
  if (!reader.contains(range.commonAncestorContainer)) {
    hideFormatMenu()
    return
  }
  const rect = range.getBoundingClientRect()
  const wrap = reader.parentElement.getBoundingClientRect()
  formatMenu.classList.remove('hidden')
  let x = rect.left - wrap.left + rect.width / 2 - formatMenu.offsetWidth / 2
  x = Math.max(8, Math.min(x, wrap.width - formatMenu.offsetWidth - 8))
  const y = rect.bottom - wrap.top + 10
  formatMenu.style.left = x + 'px'
  formatMenu.style.top = y + 'px'
}

function hideFormatMenu() {
  formatMenu.classList.add('hidden')
}

// ---------- Resaltador en modo lectura ----------

const highlightMenu = $('#highlightMenu')

function maybeShowHighlightMenu() {
  const selection = document.getSelection()
  if (selection.isCollapsed || !selection.rangeCount) {
    hideHighlightMenu()
    return
  }
  const range = selection.getRangeAt(0)
  if (!reader.contains(range.commonAncestorContainer) || !range.toString().trim()) {
    hideHighlightMenu()
    return
  }
  const rect = range.getBoundingClientRect()
  const wrap = reader.parentElement.getBoundingClientRect()
  highlightMenu.classList.remove('hidden')
  let x = rect.left - wrap.left + rect.width / 2 - highlightMenu.offsetWidth / 2
  x = Math.max(8, Math.min(x, wrap.width - highlightMenu.offsetWidth - 8))
  highlightMenu.style.left = x + 'px'
  highlightMenu.style.top = rect.bottom - wrap.top + 10 + 'px'
}

function hideHighlightMenu() {
  highlightMenu.classList.add('hidden')
}

highlightMenu.addEventListener('mousedown', (event) => {
  event.preventDefault()
  const button = event.target.closest('[data-hl]')
  if (!button) {
    return
  }
  if (button.dataset.hl === 'remove') {
    removeHighlight()
  } else {
    applyHighlight(button.dataset.hl)
  }
  hideHighlightMenu()
  document.getSelection().removeAllRanges()
  void persistHighlights()
})

function intersectingHighlights(range) {
  return Array.from(reader.querySelectorAll('mark.hl')).filter((mark) => range.intersectsNode(mark))
}

function unwrapMark(mark) {
  const parent = mark.parentNode
  if (!parent) {
    return
  }
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark)
  }
  parent.removeChild(mark)
}

function wrapRangeTextNodes(range, color) {
  const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT)
  const nodes = []
  let node = walker.nextNode()
  while (node) {
    if (range.intersectsNode(node)) {
      nodes.push(node)
    }
    node = walker.nextNode()
  }

  for (const textNode of nodes) {
    const length = textNode.nodeValue ? textNode.nodeValue.length : 0
    if (!length) {
      continue
    }
    let start = textNode === range.startContainer ? range.startOffset : 0
    let end = textNode === range.endContainer ? range.endOffset : length
    if (start >= end || !textNode.nodeValue.slice(start, end).trim()) {
      continue
    }
    const middle = textNode.splitText(start)
    middle.splitText(end - start)
    const mark = document.createElement('mark')
    mark.className = `hl hl-${color}`
    middle.parentNode.replaceChild(mark, middle)
    mark.appendChild(middle)
  }
}

function applyHighlight(color) {
  const selection = document.getSelection()
  if (!selection.rangeCount || selection.isCollapsed) {
    return
  }
  const range = selection.getRangeAt(0)
  const marks = intersectingHighlights(range)
  const allSameColor = marks.length > 0 && marks.every((mark) => mark.classList.contains(`hl-${color}`))

  for (const mark of marks) {
    unwrapMark(mark)
  }

  if (allSameColor) {
    return
  }

  wrapRangeTextNodes(range, color)
}

function removeHighlight() {
  const selection = document.getSelection()
  if (!selection.rangeCount) {
    return
  }
  const range = selection.getRangeAt(0)
  for (const mark of intersectingHighlights(range)) {
    unwrapMark(mark)
  }
}

async function persistHighlights() {
  if (!state.filePath) {
    showMessage('Resaltado aplicado solo en pantalla: este documento no tiene ruta en disco.')
    return
  }
  try {
    const markdown = editorMarkdown()
    await invoke('save_markdown_file', { path: state.filePath, contents: markdown })
    state.markdown = markdown
  } catch (error) {
    showMessage('No pude guardar el resaltado: ' + formatError(error))
  }
}

formatMenu.addEventListener('mousedown', (event) => {
  event.preventDefault()
  const button = event.target.closest('button[data-action]')
  if (!button) {
    return
  }
  FORMAT_ACTIONS[Number(button.dataset.action)].run()
  state.dirty = true
})

// ---------- Drag & drop ----------

void listenTauriDragDrop()

async function listenTauriDragDrop() {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'over' || event.payload.type === 'enter') {
        dropzone.classList.add('visible')
      } else if (event.payload.type === 'drop') {
        dropzone.classList.remove('visible')
        const path = event.payload.paths && event.payload.paths[0]
        if (path) {
          void loadFileFromPath(path)
        }
      } else {
        dropzone.classList.remove('visible')
      }
    })
  } catch (_) {
    // Fuera de Tauri se usan los listeners del navegador.
  }
}

;['dragenter', 'dragover'].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropzone.classList.add('visible')
  })
})

;['dragleave', 'drop'].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault()
    if (eventName === 'drop') {
      dropzone.classList.remove('visible')
      const droppedFiles = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : []
      const file = droppedFiles[0] || null
      if (file) {
        void loadBrowserFile(file)
      }
      return
    }
    if (!event.relatedTarget) {
      dropzone.classList.remove('visible')
    }
  })
})

// ---------- Render, indice y busqueda ----------

void loadInitialFile()

function decorateRenderedContent() {
  const headings = reader.querySelectorAll('h1, h2, h3, h4, h5, h6')
  for (let index = 0; index < headings.length; index += 1) {
    const node = headings[index]
    if (!node.id) {
      node.id = slugify(node.textContent + '-' + index)
    }
  }

  void renderMermaidBlocks(reader)
  const blocks = reader.querySelectorAll('pre code:not(.language-mermaid)')
  for (let index = 0; index < blocks.length; index += 1) {
    hljs.highlightElement(blocks[index])
  }
}

function updateMeta() {
  fileNameLabel.textContent = state.fileName
  const lines = state.markdown.split('\n').length
  const words = state.markdown.trim().split(/\s+/).filter(Boolean).length
  metaInfo.textContent = `${words} palabras · ${lines} lineas`
}

function renderToc() {
  const headings = Array.prototype.slice.call(reader.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  tocCount.textContent = `${headings.length} secciones`

  if (!headings.length) {
    toc.innerHTML = '<p class="muted">El documento no tiene encabezados.</p>'
    return
  }

  const items = []
  for (let index = 0; index < headings.length; index += 1) {
    const node = headings[index]
    const depth = Number(node.tagName.slice(1))
    items.push(`<a class="toc-link depth-${depth}" href="#${node.id}">${escapeHtml(node.textContent || '')}</a>`)
  }
  toc.innerHTML = items.join('')
}

searchInput.addEventListener('input', () => runSearch(searchInput.value))

function runSearch(term) {
  clearHighlights()
  state.matches = []
  state.activeMatchIndex = -1

  const normalized = term.trim()
  if (!normalized) {
    searchStats.textContent = '0'
    return
  }

  highlightMatches(reader, normalized.toLowerCase())
  searchStats.textContent = String(state.matches.length)
  if (state.matches.length > 0) {
    activateMatch(0)
  }
}

function clearHighlights() {
  const marks = reader.querySelectorAll('mark[data-pliego-search]')
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]
    const parent = mark.parentNode
    if (!parent) {
      continue
    }
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark)
    parent.normalize()
  }
}

function highlightMatches(root, term) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes = []
  let current = walker.nextNode()

  while (current) {
    const parentName = current.parentNode && current.parentNode.nodeName ? current.parentNode.nodeName.toLowerCase() : ''
    if (parentName !== 'script' && parentName !== 'style' && current.nodeValue && current.nodeValue.trim()) {
      textNodes.push(current)
    }
    current = walker.nextNode()
  }

  for (let index = 0; index < textNodes.length; index += 1) {
    highlightInTextNode(textNodes[index], term)
  }
}

function highlightInTextNode(node, term) {
  const text = node.nodeValue || ''
  const lower = text.toLowerCase()
  if (lower.indexOf(term) === -1) {
    return
  }

  const fragment = document.createDocumentFragment()
  let cursor = 0
  let matchIndex = lower.indexOf(term, cursor)

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, matchIndex)))
    }
    const mark = document.createElement('mark')
    mark.setAttribute('data-pliego-search', '1')
    mark.textContent = text.slice(matchIndex, matchIndex + term.length)
    fragment.appendChild(mark)
    state.matches.push(mark)
    cursor = matchIndex + term.length
    matchIndex = lower.indexOf(term, cursor)
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)))
  }
  if (node.parentNode) {
    node.parentNode.replaceChild(fragment, node)
  }
}

function stepMatch(direction) {
  if (!state.matches.length) {
    return
  }
  const nextIndex = (state.activeMatchIndex + direction + state.matches.length) % state.matches.length
  activateMatch(nextIndex)
}

function activateMatch(index) {
  for (let position = 0; position < state.matches.length; position += 1) {
    state.matches[position].classList.remove('active-match')
  }
  state.activeMatchIndex = index
  const active = state.matches[index]
  active.classList.add('active-match')
  active.scrollIntoView({ behavior: 'smooth', block: 'center' })
  searchStats.textContent = `${index + 1}/${state.matches.length}`
}

// ---------- Apertura rápida, búsqueda global y referencias ----------

const PALETTE_COMMANDS = [
  { label: 'Abrir archivo', hint: 'Selector del sistema', run: () => void openMarkdown() },
  { label: 'Abrir carpeta', hint: 'Cambiar biblioteca', run: () => void openFolder() },
  { label: 'Buscar en carpeta', hint: 'Ctrl+Shift+F', run: () => openPalette('search') },
  { label: 'Mostrar u ocultar panel lateral', hint: 'Navegación', run: () => toggleSidebar() },
  { label: 'Abrir Codex', hint: 'Asistente local', run: () => void openCodexPanel() },
  { label: 'Cambiar tema', hint: 'Claro / oscuro', run: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
]

function openPalette(mode = 'files') {
  if (!state.folder && mode !== 'commands') {
    showMessage('Abre una carpeta para usar esta función.')
    return
  }
  state.paletteMode = mode
  commandPalette.classList.remove('hidden')
  paletteInput.value = ''
  paletteInput.placeholder = mode === 'search' ? 'Buscar texto en toda la carpeta…' : mode === 'commands' ? 'Ejecutar comando…' : 'Abrir documento…'
  paletteHint.textContent = mode === 'search' ? 'Busca en Markdown, texto, CSV y Mermaid' : mode === 'commands' ? 'Acciones disponibles' : `${state.documentIndex.length} documentos indexados`
  renderPaletteResults('')
  window.setTimeout(() => paletteInput.focus(), 0)
}

function closePalette() { commandPalette.classList.add('hidden') }

paletteInput.addEventListener('input', () => renderPaletteResults(paletteInput.value))
commandPalette.addEventListener('click', (event) => {
  if (event.target === commandPalette) closePalette()
  const item = event.target.closest('[data-palette-index]')
  if (!item) return
  const index = Number(item.dataset.paletteIndex)
  if (state.paletteMode === 'commands') {
    const selected = paletteEntries(paletteInput.value)[index]
    closePalette()
    selected?.run()
  } else {
    const results = paletteEntries(paletteInput.value)
    const selected = results[index]
    if (selected) { closePalette(); void loadFileFromPath(selected.path) }
  }
})

paletteInput.addEventListener('keydown', (event) => {
  const items = Array.from(paletteResults.querySelectorAll('.palette-result'))
  let active = items.findIndex((item) => item.classList.contains('active'))
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items.forEach((item, index) => item.classList.toggle('active', index === active))
    items[active]?.scrollIntoView({ block: 'nearest' })
  } else if (event.key === 'Enter') {
    event.preventDefault()
    ;(items[active < 0 ? 0 : active])?.click()
  }
})

function paletteEntries(query) {
  const term = query.trim().toLowerCase()
  if (state.paletteMode === 'commands') return PALETTE_COMMANDS.filter((item) => !term || `${item.label} ${item.hint}`.toLowerCase().includes(term))
  if (state.paletteMode === 'files') return state.documentIndex.filter((item) => !term || relativePath(item.path).toLowerCase().includes(term)).slice(0, 80)
  if (!term) return []
  return state.documentIndex.filter((item) => `${item.name}\n${item.searchableText || ''}`.toLowerCase().includes(term)).slice(0, 100)
}

function renderPaletteResults(query) {
  const results = paletteEntries(query)
  if (!results.length) {
    paletteResults.innerHTML = `<p class="palette-empty">${state.paletteMode === 'search' && !query ? 'Escribe una palabra o frase.' : 'No se encontraron resultados.'}</p>`
    return
  }
  paletteResults.innerHTML = results.map((item, index) => {
    const isCommand = state.paletteMode === 'commands'
    const snippet = isCommand ? item.hint : state.paletteMode === 'search' ? searchSnippet(item.searchableText || '', query) : relativePath(item.path)
    return `<button class="palette-result${index === 0 ? ' active' : ''}" data-palette-index="${index}" type="button"><span><strong>${escapeHtml(item.label || item.name)}</strong><small>${escapeHtml(snippet)}</small></span><em>${escapeHtml(isCommand ? 'Comando' : item.kind)}</em></button>`
  }).join('')
}

function searchSnippet(text, query) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const at = clean.toLowerCase().indexOf(query.trim().toLowerCase())
  return at < 0 ? clean.slice(0, 140) : `${at > 45 ? '…' : ''}${clean.slice(Math.max(0, at - 45), at + query.length + 90)}${at + query.length + 90 < clean.length ? '…' : ''}`
}

function relativePath(path) { return state.folder && path.startsWith(state.folder) ? path.slice(state.folder.length + 1) : path }

function resolveIndexedReference(sourcePath, reference) {
  const target = reference.replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase()
  const sourceDir = sourcePath.slice(0, sourcePath.lastIndexOf('/'))
  return state.documentIndex.find((item) => {
    if (item.kind !== 'markdown') return false
    const noExt = item.path.replace(/\.md$/i, '').toLowerCase()
    return noExt === `${sourceDir}/${target}`.toLowerCase() || noExt === `${state.folder}/${target}`.toLowerCase() || noExt.endsWith(`/${target}`)
  })
}

function renderReferences() {
  if (state.documentKind !== 'markdown' || !state.filePath) {
    referenceCount.textContent = '0'
    referencesBox.innerHTML = '<p class="muted">Las referencias se calculan para Markdown.</p>'
    return
  }
  const current = state.documentIndex.find((item) => item.path === state.filePath)
  const outgoing = (current?.references || []).map((reference) => ({ reference, target: resolveIndexedReference(state.filePath, reference) }))
  const backlinks = state.documentIndex.filter((item) => item.kind === 'markdown' && item.path !== state.filePath && (item.references || []).some((reference) => resolveIndexedReference(item.path, reference)?.path === state.filePath))
  referenceCount.textContent = String(outgoing.length + backlinks.length)
  const outgoingHtml = outgoing.length ? outgoing.map(({ reference, target }) => target
    ? `<button class="reference-link" data-path="${escapeHtml(target.path)}" type="button">→ ${escapeHtml(reference)}</button>`
    : `<span class="reference-link broken" title="Enlace no resuelto">⚠ ${escapeHtml(reference)}</span>`).join('') : '<p class="muted">Sin enlaces salientes.</p>'
  const backlinksHtml = backlinks.length ? backlinks.map((item) => `<button class="reference-link" data-path="${escapeHtml(item.path)}" type="button">← ${escapeHtml(item.name)}</button>`).join('') : '<p class="muted">Sin backlinks.</p>'
  referencesBox.innerHTML = `<p class="reference-heading">Enlaces</p>${outgoingHtml}<p class="reference-heading">Backlinks</p>${backlinksHtml}`
}

referencesBox.addEventListener('click', (event) => {
  const target = event.target.closest('[data-path]')
  if (target) void loadFileFromPath(target.dataset.path)
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !commandPalette.classList.contains('hidden')) closePalette()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); openPalette('files') }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette('commands') }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); openPalette('search') }
})

// ---------- Utilidades ----------

function showMessage(message) {
  messageBar.textContent = message
  messageBar.classList.remove('hidden')
}

function hideMessage() {
  messageBar.textContent = ''
  messageBar.classList.add('hidden')
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatError(error) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'error desconocido'
}
