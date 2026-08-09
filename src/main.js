import './style.css'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import hljs from 'highlight.js/lib/common'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { decodeBase64, renderMermaidBlocks, renderMermaidDocument, renderTableDocument, renderVisualDocument } from './document-renderers.js'
import { createOnboarding, onboardingCompleted } from './onboarding.js'

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
  inbox: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 14h5l2 3h2l2-3h5"/></svg>',
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
  treeNodes: [],
  documentKind: 'markdown',
  paletteMode: 'files',
  openTabs: [],
  language: localStorage.getItem(LANGUAGE_KEY) || 'es',
  visualInfo: null,
  loadGeneration: 0,
}

document.querySelector('#app').innerHTML = `
  <div class="shell">
    <div class="window-titlebar" data-tauri-drag-region>
      <div class="window-title" data-tauri-drag-region><img src="/pliego-icon.png" alt="" /> Pliego</div>
      <div class="window-controls">
        <button id="windowMinimize" type="button" data-i18n-aria="minimize" aria-label="Minimizar">−</button>
        <button id="windowMaximize" type="button" data-i18n-aria="maximize" aria-label="Maximizar">□</button>
        <button id="windowClose" class="close" type="button" data-i18n-aria="close" aria-label="Cerrar">×</button>
      </div>
    </div>
    <header class="topbar">
      <div class="brand">
        <button id="sidebarToggle" class="tool-button" type="button" data-i18n-aria="sidebarToggle" data-i18n-tooltip="sidebarTooltip" aria-label="Mostrar u ocultar panel" data-tooltip="Panel lateral">${icon('menu')}</button>
        <button id="homeButton" class="brand-mark" type="button" data-i18n-aria="libraries" data-i18n-tooltip="libraries" aria-label="Bibliotecas" data-tooltip="Bibliotecas"><img src="/pliego-icon.png" alt="" /></button>
        <div class="brand-text">
          <p class="eyebrow" data-i18n="brandEyebrow">Biblioteca documental</p>
          <h1>Pliego</h1>
        </div>
      </div>

      <div class="toolbar">
        <div class="tool-cluster">
          <button id="openButton" class="tool-button accent" type="button" data-i18n-aria="openFile" data-i18n-tooltip="openFile" aria-label="Abrir archivo" data-tooltip="Abrir archivo">${icon('file')}</button>
          <button id="openFolderButton" class="tool-button" type="button" data-i18n-aria="openFolder" data-i18n-tooltip="openFolder" aria-label="Abrir carpeta" data-tooltip="Abrir carpeta">${icon('folder')}</button>
          <button id="newNoteButton" class="tool-button" type="button" data-i18n-aria="newNote" data-i18n-tooltip="newNoteTooltip" aria-label="Nueva página Markdown" data-tooltip="Nueva página · Ctrl+N">${icon('plus')}</button>
          <button id="folderSearchButton" class="tool-button" type="button" data-i18n-aria="folderSearch" data-i18n-tooltip="folderSearch" aria-label="Buscar en carpeta" data-tooltip="Buscar en carpeta · Ctrl+Shift+F">${icon('search')}</button>
          <button id="quickOpenButton" class="tool-button" type="button" data-i18n-aria="quickOpen" data-i18n-tooltip="quickOpen" aria-label="Apertura rápida" data-tooltip="Apertura rápida · Ctrl+P">${icon('command')}</button>
          <button id="quickCaptureButton" class="tool-button inbox-tool" type="button" data-i18n-aria="quickCapture" data-i18n-tooltip="quickCaptureTooltip" aria-label="Captura rápida" data-tooltip="Captura rápida · Ctrl+Alt+Space">${icon('inbox')}<span id="inboxToolbarBadge" class="inbox-badge hidden">0</span></button>
        </div>
        <label class="search">
          <span class="search-label" data-i18n="searchLabel">Buscar</span>
          <input id="searchInput" type="search" placeholder="Titulos, texto, codigo..." />
          <span id="searchStats" class="search-stats">0</span>
        </label>
        <div class="btn-group mode-group">
          <button id="modeRead" class="mode-button active" type="button">Lectura</button>
          <button id="modeEdit" class="mode-button" type="button">Edicion</button>
        </div>
        <button id="saveButton" class="ghost-button hidden" type="button">Guardar</button>
        <div class="tool-cluster">
          <button id="codexToggle" class="tool-button ai-button" type="button" data-i18n-aria="codex" data-i18n-tooltip="assistant" aria-label="Codex AI" data-tooltip="Asistente Codex">${icon('ai')}</button>
          <button id="favoriteToggle" class="tool-button" type="button" data-i18n-aria="favoriteAdd" aria-label="Añadir a favoritos" data-tooltip="Añadir a favoritos">${icon('star')}</button>
          <button id="tocToggle" class="tool-button" type="button" data-i18n-aria="index" data-i18n-tooltip="index" aria-label="Indice" data-tooltip="Índice">${icon('toc')}</button>
          <button id="settingsButton" class="tool-button" type="button" data-i18n-aria="settings" data-i18n-tooltip="settings" aria-label="Configuraciones" data-tooltip="Configuración">${icon('settings')}</button>
        </div>
      </div>
    </header>

    <div id="documentTabs" class="document-tabs" data-i18n-aria="openTabs" aria-label="Archivos abiertos"></div>

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
          <p data-i18n="dropzone">Arrastra aqui tu archivo .md o usa el boton de arriba.</p>
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
          <button class="hl-dot" data-hl="yellow" data-i18n-aria="highlightYellow" type="button" aria-label="Resaltar amarillo"></button>
          <button class="hl-dot" data-hl="green" data-i18n-aria="highlightGreen" type="button" aria-label="Resaltar verde"></button>
          <button class="hl-dot" data-hl="pink" data-i18n-aria="highlightPink" type="button" aria-label="Resaltar rosa"></button>
          <button class="hl-dot" data-hl="blue" data-i18n-aria="highlightBlue" type="button" aria-label="Resaltar azul"></button>
          <button class="hl-dot remove" data-hl="remove" data-i18n-aria="removeHighlight" type="button" aria-label="Quitar resaltado">✕</button>
        </div>
      </section>
    </main>

    <aside id="tocOverlay" class="toc-overlay hidden">
        <div class="panel-row toc-overlay-head">
        <p class="panel-label" data-i18n="index">Indice</p>
        <span id="tocCount" class="muted" data-i18n="tocSections">0 secciones</span>
        <button id="tocClose" class="icon-button small" type="button" data-i18n-aria="closeIndex" aria-label="Cerrar indice">✕</button>
      </div>
      <nav id="toc" class="toc">
        <p class="muted" data-i18n="tocEmpty">El indice aparecera aqui.</p>
      </nav>
    </aside>

    <aside id="codexPanel" class="codex-panel hidden" data-i18n-aria="codexChat" aria-label="Chat con Codex">
      <div class="codex-head">
        <div><p class="panel-label" data-i18n="localAssistant">Asistente local</p><h2>Codex</h2></div>
        <span id="codexStatus" class="codex-status" data-i18n="disconnected">Desconectado</span>
        <button id="codexClose" class="icon-button small" type="button" data-i18n-aria="closeCodex" aria-label="Cerrar Codex">✕</button>
      </div>
      <p id="codexNotice" class="codex-notice" data-i18n="codexNotice">Abre un Markdown para iniciar la conversación.</p>
      <div id="codexMessages" class="codex-messages" aria-live="polite"></div>
      <form id="codexForm" class="codex-form">
        <textarea id="codexInput" rows="3" data-i18n-placeholder="codexInputPlaceholder" placeholder="Pregunta sobre el Markdown…"></textarea>
        <details id="codexOptions" class="codex-options">
          <summary><span class="codex-options-dot" aria-hidden="true"></span><span id="codexOptionsSummary" data-i18n="modelAndEffort">Modelo y esfuerzo</span><span class="codex-chevron">⌄</span></summary>
          <div class="codex-controls">
            <label><span data-i18n="model">Modelo</span><select id="codexModel"><option value="" data-i18n="loading">Cargando…</option></select></label>
            <label><span data-i18n="effort">Esfuerzo</span><select id="codexEffort"><option value="" data-i18n="default">Predeterminado</option></select></label>
            <label><span data-i18n="context">Contexto</span><select id="codexContext"><option value="document" data-i18n="documentContext">Markdown + referencias</option><option value="folder" data-i18n="folderContext">Toda la carpeta</option></select></label>
            <label><span data-i18n="permissions">Permisos</span><select id="codexPermission"><option value="read" data-i18n="readOnly">Solo lectura</option><option value="write" data-i18n="writeMarkdown">Editar Markdown</option></select></label>
          </div>
        </details>
        <label class="codex-web"><input id="codexWeb" type="checkbox" /> <span data-i18n="allowWeb">Permitir búsqueda web en este mensaje</span></label>
        <div class="codex-actions">
          <button id="codexCancel" class="ghost-button hidden" type="button" data-i18n="cancel">Cancelar</button>
          <button id="codexSend" class="primary-button" type="submit" data-i18n="send">Enviar</button>
        </div>
      </form>
    </aside>

    <div id="settingsModal" class="modal-backdrop hidden">
      <div class="modal">
        <div class="panel-row">
          <p class="panel-label" data-i18n="settingsTitle">Configuraciones</p>
          <button id="settingsClose" class="icon-button small" type="button" data-i18n-aria="close" aria-label="Cerrar">✕</button>
        </div>

        <div class="setting-row">
          <span data-i18n="theme">Tema</span>
          <div class="btn-group mode-group">
            <button class="mode-button" data-set-theme="light" data-i18n="light" type="button">Claro</button>
            <button class="mode-button" data-set-theme="dark" data-i18n="dark" type="button">Oscuro</button>
          </div>
        </div>

        <div class="setting-row">
          <span data-i18n="fontSize">Tamano de letra</span>
          <div class="btn-group">
            <button id="fontMinus" class="icon-button" type="button">A−</button>
            <span id="scaleLabel" class="scale-label">100%</span>
            <button id="fontPlus" class="icon-button" type="button">A+</button>
          </div>
        </div>

        <div class="setting-row">
          <span data-i18n="accentColor">Color de acento</span>
          <div class="accent-swatches">
            <button class="accent-dot" data-set-accent="#d4962a" data-i18n-aria="gold" style="background:#d4962a" type="button" aria-label="Dorado"></button>
            <button class="accent-dot" data-set-accent="#2ab5a8" data-i18n-aria="teal" style="background:#2ab5a8" type="button" aria-label="Teal"></button>
            <button class="accent-dot" data-set-accent="#e06452" data-i18n-aria="coral" style="background:#e06452" type="button" aria-label="Coral"></button>
            <button class="accent-dot" data-set-accent="#38b37e" data-i18n-aria="green" style="background:#38b37e" type="button" aria-label="Verde"></button>
            <button class="accent-dot" data-set-accent="#8b7fd4" data-i18n-aria="purple" style="background:#8b7fd4" type="button" aria-label="Purpura"></button>
          </div>
        </div>

        <div class="setting-row">
          <span data-i18n="readerFont">Fuente de lectura</span>
          <div class="btn-group mode-group">
            <button class="mode-button" data-set-font="serif" type="button">Serif</button>
            <button class="mode-button" data-set-font="sans" type="button">Sans</button>
            <button class="mode-button" data-set-font="mono" type="button">Mono</button>
          </div>
        </div>

        <div class="setting-row">
          <span data-i18n="history">Historial</span>
          <button id="clearRecents" class="ghost-button" data-i18n="clearRecents" type="button">Limpiar recientes</button>
        </div>

        <div class="setting-row inbox-setting-row">
          <span data-i18n="globalCapture">Captura global</span>
          <div class="inbox-setting-control"><input id="inboxShortcutInput" class="setting-input" value="Ctrl+Alt+Space" data-i18n-aria="inboxShortcut" aria-label="Atajo global del Inbox" /><button id="inboxShortcutSave" class="ghost-button" data-i18n="saveShortcut" type="button">Guardar atajo</button></div>
        </div>

        <div class="setting-row inbox-setting-row">
          <span data-i18n="inboxFolder">Carpeta Inbox</span>
          <div class="inbox-setting-control"><small id="inboxSettingsFolder" class="setting-path" data-i18n="notConfigured">Sin configurar</small><button id="inboxSettingsFolderChoose" class="ghost-button" data-i18n="changeFolder" type="button">Cambiar carpeta</button></div>
        </div>

        <div class="setting-row">
          <span data-i18n="gettingStarted">Primeros pasos</span>
          <button id="showOnboarding" class="ghost-button" data-i18n="showTutorial" type="button">Ver tutorial</button>
        </div>
      </div>
    </div>

    <div id="commandPalette" class="palette-backdrop hidden">
      <section class="command-palette" role="dialog" aria-modal="true" data-i18n-aria="commandPalette" aria-label="Paleta de comandos">
        <div class="palette-input-row"><span id="paletteIcon">⌘</span><input id="paletteInput" autocomplete="off" data-i18n-placeholder="paletteOpenPlaceholder" placeholder="Abrir archivo…" /><kbd>Esc</kbd></div>
        <div id="paletteHint" class="palette-hint" data-i18n="paletteHint">Escribe para filtrar los documentos de la carpeta</div>
        <div id="paletteResults" class="palette-results"></div>
      </section>
    </div>

    <div id="newNoteModal" class="modal-backdrop hidden">
      <form id="newNoteForm" class="modal new-note-modal" aria-labelledby="newNoteTitle">
        <div class="panel-row"><div><p class="panel-label" data-i18n="newPageLabel">NUEVA PÁGINA</p><h2 id="newNoteTitle" data-i18n="createMarkdown">Crear Markdown</h2></div><button id="newNoteClose" class="icon-button small" type="button" data-i18n-aria="close" aria-label="Cerrar">✕</button></div>
        <label class="new-note-field"><span data-i18n="title">Título</span><input id="newNoteInput" maxlength="120" autocomplete="off" data-i18n-placeholder="titlePlaceholder" placeholder="Idea sobre el proyecto" /></label>
        <div class="new-note-destination"><span data-i18n="createdIn">Se creará en</span><strong id="newNotePath"></strong></div>
        <p id="newNoteError" class="new-note-error hidden" role="alert"></p>
        <div class="new-note-actions"><button id="newNoteCancel" class="ghost-button" data-i18n="cancel" type="button">Cancelar</button><button id="newNoteCreate" class="primary-button" data-i18n="createAndEdit" type="submit">Crear y editar</button></div>
      </form>
    </div>

    <div id="quickCapture" class="quick-capture-backdrop hidden">
      <section class="quick-capture" role="dialog" aria-modal="true" aria-labelledby="quickCaptureTitle">
        <div class="quick-capture-head"><div>${icon('inbox')}<span><p class="panel-label" data-i18n="quickCaptureLabel">CAPTURA RÁPIDA</p><h2 id="quickCaptureTitle" data-i18n="quickCaptureTitle">Guarda lo que tienes en mente</h2></span></div><button id="quickCaptureClose" class="icon-button small" type="button" data-i18n-aria="close" aria-label="Cerrar">✕</button></div>
        <textarea id="quickCaptureInput" rows="5" data-i18n-placeholder="quickCapturePlaceholder" placeholder="Escribe o pega texto, una URL o una idea…"></textarea>
        <div class="quick-capture-secondary"><button id="quickCaptureClipboard" class="ghost-button" data-i18n="captureClipboard" type="button">Capturar portapapeles</button><button id="quickCaptureFile" class="ghost-button" data-i18n="addFile" type="button">Añadir archivo</button></div>
        <div class="quick-capture-actions"><span data-i18n="quickCaptureHint">Enter guarda · Shift+Enter crea una línea · Esc cierra</span><button id="quickCaptureSave" class="primary-button" type="button" data-i18n="capture">Capturar</button></div>
      </section>
    </div>

    <div id="inboxView" class="inbox-view hidden">
      <section class="inbox-shell" aria-labelledby="inboxTitle">
        <header class="inbox-header"><div class="inbox-title-icon">${icon('inbox')}</div><div><p class="eyebrow" data-i18n="inboxWorkspace">ESPACIO DE CAPTURA</p><h2 id="inboxTitle" data-i18n="inboxTitle">Inbox</h2><p id="inboxFolderLabel" class="muted"></p></div><div class="inbox-header-actions"><button id="inboxCapture" class="primary-button" type="button" data-i18n="newCapture">Nueva captura</button><button id="inboxClose" class="tool-button" type="button" data-i18n-aria="close" aria-label="Cerrar">✕</button></div></header>
        <div id="inboxSetup" class="inbox-setup hidden"><div>${icon('folder')}<span><strong data-i18n="chooseInbox">Elige una carpeta para tu Inbox</strong><small data-i18n="chooseInboxHint">Las capturas serán archivos locales normales, siempre bajo tu control.</small></span></div><button id="inboxChooseFolder" class="primary-button" type="button" data-i18n="chooseFolder">Elegir carpeta</button></div>
        <div id="inboxContent" class="inbox-content hidden">
          <aside class="inbox-list-pane"><div class="inbox-list-head"><span id="inboxCount" class="muted"></span><div><button id="inboxImport" class="ghost-button" type="button" data-i18n="importFiles">Importar archivos</button><button id="inboxChangeFolder" class="icon-button small" type="button" data-i18n-aria="changeFolder" data-i18n-tooltip="changeFolder" data-tooltip="Cambiar carpeta" aria-label="Cambiar carpeta">${icon('folder')}</button></div></div><div id="inboxList" class="inbox-list" role="listbox" data-i18n-aria="captures" aria-label="Capturas"></div></aside>
          <main id="inboxPreview" class="inbox-preview"><div class="inbox-empty"><span>${icon('inbox')}</span><h3 data-i18n="selectCapture">Selecciona una captura</h3><p data-i18n="selectCaptureHint">Aquí podrás revisar y procesar lo que guardaste.</p></div></main>
        </div>
      </section>
    </div>

    <div id="libraryHome" class="library-home hidden">
      <div class="library-home-shell">
        <header class="library-hero"><div class="library-logo">${icon('library')}</div><div><p class="eyebrow" data-i18n="workspace">ESPACIO DE TRABAJO</p><h2 data-i18n="libraries">Tus bibliotecas</h2><p data-i18n="librariesLead">Organiza carpetas de documentos y entra con un clic.</p></div><button id="libraryHomeClose" class="tool-button" type="button" data-i18n-aria="close" aria-label="Cerrar">✕</button></header>
        <button id="addLibraryButton" class="add-library-card" type="button">${icon('plus')}<span><strong data-i18n="addLibrary">Añadir biblioteca</strong><small data-i18n="addLibraryHint">Selecciona una carpeta de tu equipo</small></span></button>
        <button id="homeInboxCard" class="home-inbox-card" type="button">${icon('inbox')}<span><strong data-i18n="inboxTitle">Inbox</strong><small data-i18n="inboxHomeHint">Captura ahora, organiza después.</small></span><b id="homeInboxCount">0</b><i>→</i></button>
        <div class="home-dashboard"><main class="home-primary">
          <div class="home-section-head"><div><p class="panel-label" data-i18n="collections">Colecciones</p><h3 data-i18n="libraries">Bibliotecas</h3></div><div class="sort-control"><span data-i18n="sortBy">Ordenar por</span><details id="librarySort" class="life-select"><summary><span id="librarySortLabel" data-i18n="mostRecent">Más reciente</span><i>⌄</i></summary><div class="life-select-menu"><button data-sort="recent" data-i18n="mostRecent" type="button">Más reciente</button><button data-sort="name" data-i18n="name" type="button">Nombre</button><button data-sort="color" data-i18n="color" type="button">Color</button></div></details></div></div>
          <div id="libraryGrid" class="library-grid"></div>
          <div class="home-section-head"><div><p class="panel-label" data-i18n="quickAccess">Acceso rápido</p><h3 data-i18n="favorites">Favoritos</h3></div></div><div id="homeFavorites" class="home-file-row"></div>
        </main><aside class="home-recent-column"><div class="home-section-head"><div><p class="panel-label" data-i18n="activity">Actividad</p><h3 data-i18n="recent">Recientes</h3></div></div><div id="homeRecents" class="home-file-row"></div></aside></div>
        <footer class="library-footer"><div class="sort-control"><span data-i18n="language">Idioma</span><details id="languageSelect" class="life-select"><summary><span id="languageLabel">Español</span><i>⌄</i></summary><div class="life-select-menu"><button data-language="es" type="button">Español</button><button data-language="en" type="button">English</button></div></details></div></footer>
      </div>
    </div>
    <div id="libraryEditor" class="modal-backdrop hidden"><section class="library-editor modal"><div class="panel-row"><div><p class="panel-label" data-i18n="editLibrary">Editar biblioteca</p><h2 id="libraryEditorName"></h2></div><button id="libraryEditorClose" class="icon-button small" data-i18n-aria="close" type="button">✕</button></div><p class="editor-label" data-i18n="color">Color</p><div id="libraryColors" class="library-color-grid"></div><p class="editor-label" data-i18n="optionalIcon">Icono opcional</p><div id="libraryIcons" class="library-icon-grid"></div><div class="library-editor-actions"><button id="libraryEditorSave" class="primary-button" data-i18n="saveChanges" type="button">Guardar cambios</button></div></section></div>
    <div id="fileContextMenu" class="file-context-menu hidden" role="menu"><button id="openFileInFolderButton" type="button" role="menuitem" data-i18n="openInFolder">Abrir en carpeta</button></div>
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
const onboarding = createOnboarding()
const libraryGrid = $('#libraryGrid')
const homeRecents = $('#homeRecents')
const homeFavorites = $('#homeFavorites')
const favoriteToggle = $('#favoriteToggle')
const libraryEditor = $('#libraryEditor')
const newNoteModal = $('#newNoteModal')
const newNoteInput = $('#newNoteInput')
const newNotePath = $('#newNotePath')
const newNoteError = $('#newNoteError')
let newNotePreviousFocus = null
const quickCapture = $('#quickCapture')
const quickCaptureInput = $('#quickCaptureInput')
const inboxView = $('#inboxView')
const inboxList = $('#inboxList')
const inboxPreview = $('#inboxPreview')
const fileContextMenu = $('#fileContextMenu')
const openFileInFolderButton = $('#openFileInFolderButton')
let inboxConfig = { folder: '' }
let inboxItems = []
let selectedInboxPath = ''
let inboxPreviewRequest = 0
let quickCapturePreviousFocus = null
let fileContextMenuPath = ''

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
$('#showOnboarding').addEventListener('click', () => onboarding.start())
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

$('#quickCaptureButton').addEventListener('click', openQuickCapture)
$('#quickCaptureClose').addEventListener('click', closeQuickCapture)
$('#quickCaptureSave').addEventListener('click', () => void saveQuickCapture())
$('#quickCaptureClipboard').addEventListener('click', () => void captureInboxClipboard())
$('#quickCaptureFile').addEventListener('click', () => void importInboxFiles(true))
quickCapture.addEventListener('click', (event) => { if (event.target === quickCapture) closeQuickCapture() })
quickCaptureInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); closeQuickCapture() }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void saveQuickCapture() }
})
$('#homeInboxCard').addEventListener('click', () => void openInbox())
$('#inboxClose').addEventListener('click', () => inboxView.classList.add('hidden'))
$('#inboxCapture').addEventListener('click', openQuickCapture)
$('#inboxChooseFolder').addEventListener('click', () => void chooseInboxFolder())
$('#inboxChangeFolder').addEventListener('click', () => void chooseInboxFolder())
$('#inboxImport').addEventListener('click', () => void importInboxFiles())
$('#inboxSettingsFolderChoose').addEventListener('click', () => void chooseInboxFolder())
$('#inboxShortcutSave').addEventListener('click', () => void saveInboxShortcut())
inboxList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-inbox-path]')
  if (item) selectInboxItem(item.dataset.inboxPath)
})
inboxList.addEventListener('keydown', (event) => {
  if (!inboxItems.length) return
  const current = Math.max(0, inboxItems.findIndex((item) => item.path === selectedInboxPath))
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? inboxItems.length - 1 : Math.max(0, Math.min(inboxItems.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
    selectInboxItem(inboxItems[next].path, true)
  } else if (event.key === 'Enter') {
    event.preventDefault(); void runInboxAction('open')
  } else if (event.key.toLowerCase() === 'r') {
    event.preventDefault(); void runInboxAction('rename')
  } else if (event.key.toLowerCase() === 'm') {
    event.preventDefault(); void runInboxAction('move')
  } else if (event.key.toLowerCase() === 'a') {
    event.preventDefault(); void runInboxAction('archive')
  } else if (event.key === 'Delete') {
    event.preventDefault(); void runInboxAction('delete')
  }
})
inboxPreview.addEventListener('click', (event) => {
  const action = event.target.closest('[data-inbox-action]')?.dataset.inboxAction
  if (action) void runInboxAction(action)
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
  if (reader.querySelector('.inline-diagram') || state.documentKind === 'mermaid') window.setTimeout(() => void refreshMermaidTheme(), 0)
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
  es: {
    minimize: 'Minimizar', maximize: 'Maximizar', close: 'Cerrar', workspace: 'ESPACIO DE TRABAJO', libraries: 'Tus bibliotecas', librariesLead: 'Organiza carpetas de documentos y entra con un clic.', brandEyebrow: 'Biblioteca documental', language: 'Idioma', addLibrary: 'Añadir biblioteca', addLibraryHint: 'Selecciona una carpeta de tu equipo', emptyLibraries: 'Aún no hay bibliotecas. Añade tu primera carpeta.',
    sidebarToggle: 'Mostrar u ocultar panel', sidebarTooltip: 'Panel lateral', openFile: 'Abrir archivo', openFolder: 'Abrir carpeta', newNote: 'Nueva página Markdown', newNoteTooltip: 'Nueva página · Ctrl+N', folderSearch: 'Buscar en carpeta · Ctrl+Shift+F', quickOpen: 'Apertura rápida', quickOpenTooltip: 'Apertura rápida · Ctrl+P', quickCapture: 'Captura rápida', quickCaptureTooltip: 'Captura rápida · Ctrl+Alt+Space', searchLabel: 'Buscar',
    assistant: 'Asistente Codex', codex: 'Codex AI', favoriteAdd: 'Añadir a favoritos', favoriteRemove: 'Quitar de favoritos', index: 'Índice', settings: 'Configuración', openTabs: 'Archivos abiertos', searchPlaceholder: 'Títulos, texto, código…', read: 'Lectura', edit: 'Edición', save: 'Guardar', fileLabel: 'Archivo', noFile: 'Ningún archivo abierto', openHint: 'Abre o arrastra un archivo para visualizarlo.', folderLabel: 'Carpeta', folderHint: 'Abre una biblioteca para explorar sus documentos.', recentsLabel: 'Recientes', noRecents: 'Aún no hay archivos recientes.', referencesLabel: 'Referencias', referencesHint: 'Abre un Markdown para ver sus enlaces.', clearReading: 'Lectura clara', readyTitle: 'Listo para abrir tus documentos', readyLead: 'Visor ligero con bibliotecas, edición visual y navegación wiki.', dropzone: 'Arrastra aquí tu archivo .md o usa el botón de arriba.', tocSections: '0 secciones', closeIndex: 'Cerrar índice', tocEmpty: 'El índice aparecerá aquí.',
    codexChat: 'Chat con Codex', closeCodex: 'Cerrar Codex', localAssistant: 'Asistente local', disconnected: 'Desconectado', codexNotice: 'Abre un Markdown para iniciar la conversación.', codexInputPlaceholder: 'Pregunta sobre el Markdown…', modelAndEffort: 'Modelo y esfuerzo', model: 'Modelo', loading: 'Cargando…', effort: 'Esfuerzo', default: 'Predeterminado', context: 'Contexto', documentContext: 'Markdown + referencias', folderContext: 'Toda la carpeta', permissions: 'Permisos', readOnly: 'Solo lectura', writeMarkdown: 'Editar Markdown', allowWeb: 'Permitir búsqueda web en este mensaje', cancel: 'Cancelar', send: 'Enviar',
    settingsTitle: 'Configuración', theme: 'Tema', light: 'Claro', dark: 'Oscuro', fontSize: 'Tamaño de letra', accentColor: 'Color de acento', gold: 'Dorado', teal: 'Verde azulado', coral: 'Coral', green: 'Verde', purple: 'Púrpura', readerFont: 'Fuente de lectura', history: 'Historial', clearRecents: 'Limpiar recientes', globalCapture: 'Captura global', inboxShortcut: 'Atajo global del Inbox', saveShortcut: 'Guardar atajo', inboxFolder: 'Carpeta Inbox', notConfigured: 'Sin configurar', changeFolder: 'Cambiar carpeta', gettingStarted: 'Primeros pasos', showTutorial: 'Ver tutorial', highlightYellow: 'Resaltar amarillo', highlightGreen: 'Resaltar verde', highlightPink: 'Resaltar rosa', highlightBlue: 'Resaltar azul', removeHighlight: 'Quitar resaltado',
    commandPalette: 'Paleta de comandos', paletteOpenPlaceholder: 'Abrir archivo…', paletteHint: 'Escribe para filtrar los documentos de la carpeta', typeToSearch: 'Escribe una palabra o frase.', noResults: 'No se encontraron resultados.', currentLibrary: 'Biblioteca actual', quickCaptureShortcut: 'Ctrl+Alt+Space', openInbox: 'Abrir Inbox', pendingCaptures: 'Capturas pendientes', systemPicker: 'Selector del sistema', changeLibrary: 'Cambiar biblioteca', folderNavigationShortcut: 'Ctrl+Shift+F', navigation: 'Navegación', openCodex: 'Abrir Codex', themeModes: 'Claro / oscuro', newPageLabel: 'NUEVA PÁGINA', createMarkdown: 'Crear Markdown', title: 'Título', titlePlaceholder: 'Idea sobre el proyecto', createdIn: 'Se creará en', createAndEdit: 'Crear y editar', captureClipboard: 'Capturar portapapeles', addFile: 'Añadir archivo', capture: 'Capturar', captures: 'Capturas', backlinks: 'Backlinks',
    quickCaptureLabel: 'CAPTURA RÁPIDA', quickCaptureTitle: 'Guarda lo que tienes en mente', quickCapturePlaceholder: 'Escribe o pega texto, una URL o una idea…', quickCaptureHint: 'Enter guarda · Shift+Enter crea una línea · Esc cierra', inboxWorkspace: 'ESPACIO DE CAPTURA', inboxTitle: 'Inbox', inboxHomeHint: 'Captura ahora, organiza después.', newCapture: 'Nueva captura', chooseInbox: 'Elige una carpeta para tu Inbox', chooseInboxHint: 'Las capturas serán archivos locales normales, siempre bajo tu control.', chooseFolder: 'Elegir carpeta', importFiles: 'Importar archivos', selectCapture: 'Selecciona una captura', selectCaptureHint: 'Aquí podrás revisar y procesar lo que guardaste.', collections: 'Colecciones', sortBy: 'Ordenar por', mostRecent: 'Más reciente', name: 'Nombre', color: 'Color', quickAccess: 'Acceso rápido', favorites: 'Favoritos', activity: 'Actividad', recent: 'Recientes', editLibrary: 'Editar biblioteca', optionalIcon: 'Icono opcional', saveChanges: 'Guardar cambios', openInFolder: 'Abrir en carpeta',
    noRecentHome: 'No hay archivos recientes.', noFavoritesHome: 'Aún no has añadido favoritos.', fileCount: 'archivos', unknownError: 'error desconocido', folderNoDocuments: 'La carpeta no tiene documentos compatibles.', noHeadings: 'El documento no tiene encabezados.', visualNoHeadings: 'Este documento no usa encabezados Markdown.', sections: 'secciones', words: 'palabras', lines: 'líneas', referencesMarkdown: 'Las referencias se calculan para Markdown.', noOutgoing: 'Sin enlaces salientes.', noBacklinks: 'Sin backlinks.', unresolvedLink: 'Enlace no resuelto', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', bold: 'Negrita', italic: 'Cursiva', strike: 'Tachado', inlineCode: 'Código inline', headingOne: 'Título 1', headingTwo: 'Título 2', headingThree: 'Título 3', paragraph: 'Párrafo normal', quote: 'Cita', bulletList: 'Lista', numberedList: 'Lista numerada', removeFormat: 'Quitar formato',
  },
  en: {
    minimize: 'Minimize', maximize: 'Maximize', close: 'Close', workspace: 'WORKSPACE', libraries: 'Your libraries', librariesLead: 'Organize document folders and open them with one click.', brandEyebrow: 'Document library', language: 'Language', addLibrary: 'Add library', addLibraryHint: 'Choose a folder from your computer', emptyLibraries: 'No libraries yet. Add your first folder.',
    sidebarToggle: 'Show or hide sidebar', sidebarTooltip: 'Sidebar', openFile: 'Open file', openFolder: 'Open folder', newNote: 'New Markdown page', newNoteTooltip: 'New page · Ctrl+N', folderSearch: 'Search folder · Ctrl+Shift+F', quickOpen: 'Quick open', quickOpenTooltip: 'Quick open · Ctrl+P', quickCapture: 'Quick capture', quickCaptureTooltip: 'Quick capture · Ctrl+Alt+Space', searchLabel: 'Search',
    assistant: 'Codex assistant', codex: 'Codex AI', favoriteAdd: 'Add to favorites', favoriteRemove: 'Remove from favorites', index: 'Table of contents', settings: 'Settings', openTabs: 'Open files', searchPlaceholder: 'Titles, text, code…', read: 'Read', edit: 'Edit', save: 'Save', fileLabel: 'File', noFile: 'No file open', openHint: 'Open or drop a file to view it.', folderLabel: 'Folder', folderHint: 'Open a library to explore its documents.', recentsLabel: 'Recent', noRecents: 'No recent files yet.', referencesLabel: 'References', referencesHint: 'Open a Markdown file to see its links.', clearReading: 'Clear reading', readyTitle: 'Ready to open your documents', readyLead: 'A lightweight viewer with libraries, visual editing and wiki navigation.', dropzone: 'Drop your .md file here or use the button above.', tocSections: '0 sections', closeIndex: 'Close table of contents', tocEmpty: 'The table of contents will appear here.',
    codexChat: 'Codex chat', closeCodex: 'Close Codex', localAssistant: 'Local assistant', disconnected: 'Disconnected', codexNotice: 'Open a Markdown file to start the conversation.', codexInputPlaceholder: 'Ask about the Markdown…', modelAndEffort: 'Model and effort', model: 'Model', loading: 'Loading…', effort: 'Effort', default: 'Default', context: 'Context', documentContext: 'Markdown + references', folderContext: 'Entire folder', permissions: 'Permissions', readOnly: 'Read only', writeMarkdown: 'Edit Markdown', allowWeb: 'Allow web search in this message', cancel: 'Cancel', send: 'Send',
    settingsTitle: 'Settings', theme: 'Theme', light: 'Light', dark: 'Dark', fontSize: 'Font size', accentColor: 'Accent color', gold: 'Gold', teal: 'Teal', coral: 'Coral', green: 'Green', purple: 'Purple', readerFont: 'Reading font', history: 'History', clearRecents: 'Clear recent files', globalCapture: 'Global capture', inboxShortcut: 'Inbox global shortcut', saveShortcut: 'Save shortcut', inboxFolder: 'Inbox folder', notConfigured: 'Not configured', changeFolder: 'Change folder', gettingStarted: 'Getting started', showTutorial: 'View tutorial', highlightYellow: 'Highlight yellow', highlightGreen: 'Highlight green', highlightPink: 'Highlight pink', highlightBlue: 'Highlight blue', removeHighlight: 'Remove highlight',
    commandPalette: 'Command palette', paletteOpenPlaceholder: 'Open file…', paletteHint: 'Type to filter the folder documents', typeToSearch: 'Type a word or phrase.', noResults: 'No results found.', currentLibrary: 'Current library', quickCaptureShortcut: 'Ctrl+Alt+Space', openInbox: 'Open Inbox', pendingCaptures: 'Pending captures', systemPicker: 'System picker', changeLibrary: 'Change library', folderNavigationShortcut: 'Ctrl+Shift+F', navigation: 'Navigation', openCodex: 'Open Codex', themeModes: 'Light / dark', newPageLabel: 'NEW PAGE', createMarkdown: 'Create Markdown', title: 'Title', titlePlaceholder: 'Idea about the project', createdIn: 'Created in', createAndEdit: 'Create and edit', captureClipboard: 'Capture clipboard', addFile: 'Add file', capture: 'Capture', captures: 'Captures', backlinks: 'Backlinks',
    quickCaptureLabel: 'QUICK CAPTURE', quickCaptureTitle: 'Save what is on your mind', quickCapturePlaceholder: 'Type or paste text, a URL or an idea…', quickCaptureHint: 'Enter saves · Shift+Enter adds a line · Esc closes', inboxWorkspace: 'CAPTURE SPACE', inboxTitle: 'Inbox', inboxHomeHint: 'Capture now, organize later.', newCapture: 'New capture', chooseInbox: 'Choose a folder for your Inbox', chooseInboxHint: 'Captures are regular local files, always under your control.', chooseFolder: 'Choose folder', importFiles: 'Import files', selectCapture: 'Select a capture', selectCaptureHint: 'Review and process what you saved here.', collections: 'Collections', sortBy: 'Sort by', mostRecent: 'Most recent', name: 'Name', color: 'Color', quickAccess: 'Quick access', favorites: 'Favorites', activity: 'Activity', recent: 'Recent', editLibrary: 'Edit library', optionalIcon: 'Optional icon', saveChanges: 'Save changes', openInFolder: 'Open in folder',
    noRecentHome: 'No recent files.', noFavoritesHome: 'You have not added favorites yet.', fileCount: 'files', unknownError: 'unknown error', folderNoDocuments: 'The folder has no supported documents.', noHeadings: 'This document has no headings.', visualNoHeadings: 'This document does not use Markdown headings.', sections: 'sections', words: 'words', lines: 'lines', referencesMarkdown: 'References are calculated for Markdown.', noOutgoing: 'No outgoing links.', noBacklinks: 'No backlinks.', unresolvedLink: 'Unresolved link', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Very high', max: 'Maximum', bold: 'Bold', italic: 'Italic', strike: 'Strikethrough', inlineCode: 'Inline code', headingOne: 'Heading 1', headingTwo: 'Heading 2', headingThree: 'Heading 3', paragraph: 'Normal paragraph', quote: 'Quote', bulletList: 'Bullet list', numberedList: 'Numbered list', removeFormat: 'Remove formatting',
  },
}

function t(key, fallback = key) {
  return TRANSLATIONS[state.language]?.[key] || TRANSLATIONS.es[key] || fallback
}

function uiText(es, en) {
  return state.language === 'en' ? en : es
}

function countText(count, singularEs, pluralEs, singularEn, pluralEn) {
  if (state.language === 'en') return `${count} ${count === 1 ? singularEn : pluralEn}`
  return `${count} ${count === 1 ? singularEs : pluralEs}`
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => { const value = labels[element.dataset.i18nPlaceholder]; if (value) element.placeholder = value })
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    const value = labels[element.dataset.i18nAria]
    if (value) element.setAttribute('aria-label', value)
  })
  document.querySelectorAll('[data-i18n-tooltip]').forEach((element) => {
    const value = labels[element.dataset.i18nTooltip]
    if (value) element.dataset.tooltip = value
  })
  const tooltipMap = { openButton: labels.openFile, openFolderButton: labels.openFolder, folderSearchButton: labels.folderSearch, quickOpenButton: labels.quickOpen, codexToggle: labels.assistant, tocToggle: labels.index, settingsButton: labels.settings }
  Object.entries(tooltipMap).forEach(([id, value]) => { const button = $(`#${id}`); button.dataset.tooltip = value; button.setAttribute('aria-label', value.split(' · ')[0]) })
  searchInput.placeholder = labels.searchPlaceholder
  modeReadButton.textContent = labels.read
  modeEditButton.textContent = labels.edit
  saveButton.textContent = labels.save
  renderRecents()
  renderDocumentTabs()
  if ($('#languageLabel')) $('#languageLabel').textContent = state.language === 'en' ? 'English' : 'Español'
  if ($('#librarySortLabel')) $('#librarySortLabel').textContent = librarySortValue === 'name' ? labels.name : librarySortValue === 'color' ? labels.color : labels.mostRecent
  if ($('#inboxChangeFolder')) $('#inboxChangeFolder').dataset.tooltip = labels.changeFolder
  if (formatMenu.children.length) renderFormatMenu()
  if (state.codexModels.length) renderCodexEfforts(codexEffort.value)
  onboarding.setLanguage?.(state.language)
  renderLibraries()
  renderHomeFiles()
  if (state.folder) renderTree(state.treeNodes)
  renderInbox()
  if (state.filePath) {
    if (state.visualInfo) metaInfo.textContent = visualDetail(state.visualInfo)
    else updateMeta()
    renderToc()
    renderReferences()
  } else if (reader.classList.contains('empty')) {
    renderEmptyDocument()
  }
  if (!commandPalette.classList.contains('hidden')) {
    paletteInput.placeholder = state.paletteMode === 'search' ? uiText('Buscar texto en toda la carpeta…', 'Search text across the folder…') : state.paletteMode === 'commands' ? uiText('Ejecutar comando…', 'Run command…') : labels.paletteOpenPlaceholder
    paletteHint.textContent = paletteHintText()
    renderPaletteResults(paletteInput.value)
  }
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
  libraryGrid.innerHTML = list.map((item) => `<div class="library-card" data-library-path="${escapeHtml(item.path)}" style="--library-color:${escapeHtml(item.color || '#d4962a')}"><button class="library-open" type="button"><b class="library-custom-icon">${escapeHtml(item.icon || '▥')}</b><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.path)}</small></span><i>→</i></button><button class="library-edit" type="button" data-edit-library="${escapeHtml(item.path)}" data-i18n-aria="editLibrary" aria-label="${escapeHtml(t('editLibrary'))}">${icon('edit')}</button></div>`).join('')
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
  if (!state.filePath) { showMessage(uiText('Abre un archivo para añadirlo a favoritos.', 'Open a file to add it to favorites.')); return }
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
  favoriteToggle.dataset.tooltip = active ? t('favoriteRemove') : t('favoriteAdd')
  favoriteToggle.setAttribute('aria-label', favoriteToggle.dataset.tooltip)
}

function renderHomeFiles() {
  if (!homeRecents || !homeFavorites) return
  const render = (items, empty) => items.length ? items.slice(0, 5).map((item) => `<button class="home-file-card" type="button" data-home-file="${escapeHtml(item.path)}" data-file-path="${escapeHtml(item.path)}"><span>${tabIcon(item.kind || kindFromPath(item.path))}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.path)}</small></button>`).join('') : `<p class="home-empty">${empty}</p>`
  homeRecents.innerHTML = render(getRecents(), t('noRecentHome'))
  homeFavorites.innerHTML = render(favorites(), t('noFavoritesHome'))
}

// ---------- Inbox y captura rápida ----------

function inboxText(key, es, en) { return state.language === 'en' ? en : es }

function normalizeInboxConfig(value) {
  if (typeof value === 'string') return { folder: value, shortcut: 'Ctrl+Alt+Space' }
  return { folder: value?.folder || value?.path || '', shortcut: value?.shortcut || 'Ctrl+Alt+Space' }
}

function normalizeInboxItems(value) {
  const list = Array.isArray(value) ? value : value?.items
  return (Array.isArray(list) ? list : []).map((item) => typeof item === 'string'
    ? { path: item, name: item.split(/[\\/]/).pop(), kind: kindFromPath(item) }
    : { ...item, path: item.path || '', name: item.name || (item.path || '').split(/[\\/]/).pop() || uiText('Captura', 'Capture'), kind: item.kind || kindFromPath(item.path || '') })
}

async function refreshInbox() {
  try {
    inboxConfig = normalizeInboxConfig(await invoke('inbox_get_config'))
    inboxItems = inboxConfig.folder ? normalizeInboxItems(await invoke('inbox_list')) : []
  } catch (_) {
    inboxConfig = { folder: '', shortcut: 'Ctrl+Alt+Space' }
    inboxItems = []
  }
  renderInbox()
}

function updateInboxBadges() {
  const count = inboxItems.length
  const badge = $('#inboxToolbarBadge')
  badge.textContent = count > 99 ? '99+' : String(count)
  badge.classList.toggle('hidden', count === 0)
  $('#homeInboxCount').textContent = String(count)
  $('#homeInboxCount').classList.toggle('empty', count === 0)
}

function renderInbox() {
  const configured = Boolean(inboxConfig.folder)
  $('#inboxSetup').classList.toggle('hidden', configured)
  $('#inboxContent').classList.toggle('hidden', !configured)
  $('#inboxFolderLabel').textContent = configured ? inboxConfig.folder : inboxText('', 'Configura una carpeta para empezar.', 'Choose a folder to get started.')
  $('#inboxSettingsFolder').textContent = configured ? inboxConfig.folder : inboxText('', 'Sin configurar', 'Not configured')
  $('#inboxShortcutInput').value = inboxConfig.shortcut || 'Ctrl+Alt+Space'
  $('#inboxCount').textContent = countText(inboxItems.length, 'pendiente', 'pendientes', 'pending', 'pending')
  updateInboxBadges()
  if (!configured) return
  if (!inboxItems.length) {
    inboxList.innerHTML = `<div class="inbox-list-empty"><strong>${inboxText('', 'Todo procesado', 'All caught up')}</strong><small>${inboxText('', 'Tu Inbox está vacío.', 'Your Inbox is empty.')}</small></div>`
    selectedInboxPath = ''
    renderInboxPreview()
    return
  }
  if (!inboxItems.some((item) => item.path === selectedInboxPath)) selectedInboxPath = inboxItems[0].path
  inboxList.innerHTML = inboxItems.map((item) => `<button class="inbox-list-item${item.path === selectedInboxPath ? ' active' : ''}" type="button" role="option" tabindex="${item.path === selectedInboxPath ? '0' : '-1'}" aria-selected="${item.path === selectedInboxPath}" data-inbox-path="${escapeHtml(String(item.path))}" data-file-path="${escapeHtml(String(item.path))}"><b>${tabIcon(item.kind)}</b><span><strong>${escapeHtml(String(item.name))}</strong><small>${escapeHtml(String(item.modifiedMs || item.path))}</small></span></button>`).join('')
  renderInboxPreview()
}

function renderInboxPreview() {
  const item = inboxItems.find((entry) => entry.path === selectedInboxPath)
  if (!item) {
    inboxPreview.innerHTML = `<div class="inbox-empty"><span>${icon('inbox')}</span><h3>${inboxText('', 'Tu Inbox está despejado', 'Your Inbox is clear')}</h3><p>${inboxText('', 'Usa Captura rápida para guardar una idea.', 'Use Quick Capture to save an idea.')}</p></div>`
    return
  }
  const preview = item.previewLoading
    ? inboxText('', 'Cargando vista previa…', 'Loading preview…')
    : item.preview ?? inboxText('', 'Vista previa no disponible para este tipo de archivo.', 'Preview is not available for this file type.')
  const truncated = item.previewTruncated ? `<small class="preview-truncated">${inboxText('', 'Vista previa recortada a 256 KB', 'Preview limited to 256 KB')}</small>` : ''
  inboxPreview.innerHTML = `<article class="inbox-preview-card"><div class="inbox-preview-meta"><span>${escapeHtml(String(item.kind || 'file')).toUpperCase()}</span><small>${escapeHtml(String(item.path))}</small></div><h3>${escapeHtml(String(item.name))}</h3><pre>${escapeHtml(String(preview))}</pre>${truncated}<div class="inbox-item-actions"><button class="primary-button" data-inbox-action="open" type="button">${inboxText('', 'Abrir', 'Open')}</button><button class="ghost-button" data-inbox-action="rename" type="button">${inboxText('', 'Renombrar', 'Rename')}</button><button class="ghost-button" data-inbox-action="move" type="button">${inboxText('', 'Mover', 'Move')}</button><button class="ghost-button" data-inbox-action="archive" type="button">${inboxText('', 'Archivar', 'Archive')}</button><button class="ghost-button danger" data-inbox-action="delete" type="button">${inboxText('', 'Eliminar', 'Delete')}</button></div><p class="inbox-keyboard-hint">↑↓ ${inboxText('', 'navegar', 'navigate')} · Enter ${inboxText('', 'abrir', 'open')} · R ${inboxText('', 'renombrar', 'rename')} · M ${inboxText('', 'mover', 'move')} · A ${inboxText('', 'archivar', 'archive')} · Del ${inboxText('', 'eliminar', 'delete')}</p></article>`
  if (item.preview === undefined && !item.previewLoading) void loadInboxPreview(item)
}

async function loadInboxPreview(item) {
  const request = ++inboxPreviewRequest
  item.previewLoading = true
  renderInboxPreview()
  try {
    const result = await invoke('inbox_read_preview', { name: item.name })
    if (request !== inboxPreviewRequest || selectedInboxPath !== item.path) return
    item.preview = result?.contents ?? null
    item.previewTruncated = Boolean(result?.truncated)
  } catch (_) {
    item.preview = null
  } finally {
    item.previewLoading = false
    if (request === inboxPreviewRequest && selectedInboxPath === item.path) renderInboxPreview()
  }
}

function selectInboxItem(path, focus = false) {
  selectedInboxPath = path
  renderInbox()
  if (focus) window.setTimeout(() => inboxList.querySelector(`[data-inbox-path="${CSS.escape(path)}"]`)?.focus(), 0)
}

async function openInbox() {
  libraryHome.classList.add('hidden')
  inboxView.classList.remove('hidden')
  await refreshInbox()
}

function openQuickCapture(seed = '') {
  quickCapturePreviousFocus = document.activeElement
  quickCapture.classList.remove('hidden')
  quickCaptureInput.value = typeof seed === 'string' ? seed : ''
  window.setTimeout(() => quickCaptureInput.focus(), 0)
}

function closeQuickCapture() {
  quickCapture.classList.add('hidden')
  if (quickCapturePreviousFocus?.focus) quickCapturePreviousFocus.focus()
  quickCapturePreviousFocus = null
}

async function saveQuickCapture() {
  const text = quickCaptureInput.value.trim()
  if (!text) return
  try {
    if (/^https?:\/\/\S+$/i.test(text)) await invoke('inbox_capture_url', { url: text, title: null })
    else await invoke('inbox_capture_text', { contents: text, title: null })
    closeQuickCapture()
    quickCaptureInput.value = ''
    await refreshInbox()
    showMessage(inboxText('', 'Captura guardada en Inbox.', 'Capture saved to Inbox.'))
  } catch (error) {
    showMessage(formatError(error))
  }
}

async function captureInboxClipboard() {
  try {
    await invoke('inbox_capture_clipboard', { title: null })
    closeQuickCapture()
    await refreshInbox()
    showMessage(inboxText('', 'Portapapeles guardado en Inbox.', 'Clipboard saved to Inbox.'))
  } catch (error) { showMessage(formatError(error)) }
}

async function saveInboxShortcut() {
  const shortcut = $('#inboxShortcutInput').value.trim()
  if (!shortcut) return
  try {
    inboxConfig = normalizeInboxConfig(await invoke('inbox_set_shortcut', { shortcut }))
    renderInbox()
    showMessage(inboxText('', `Atajo actualizado: ${inboxConfig.shortcut}`, `Shortcut updated: ${inboxConfig.shortcut}`))
  } catch (error) { showMessage(formatError(error)) }
}

async function chooseInboxFolder() {
  const folder = await openDialog({ directory: true, multiple: false, title: inboxText('', 'Elegir carpeta Inbox', 'Choose Inbox folder') })
  if (!folder) return
  try {
    await invoke('inbox_set_folder', { folder })
    await refreshInbox()
  } catch (error) { showMessage(formatError(error)) }
}

async function importInboxFiles(closeCapture = false) {
  const paths = await openDialog({ multiple: true, directory: false, title: inboxText('', 'Importar a Inbox', 'Import to Inbox') })
  if (!paths?.length) return
  try {
    await invoke('inbox_import_files', { paths })
    if (closeCapture) closeQuickCapture()
    await refreshInbox()
    showMessage(inboxText('', 'Archivos añadidos al Inbox.', 'Files added to Inbox.'))
  } catch (error) { showMessage(formatError(error)) }
}

async function runInboxAction(action) {
  const item = inboxItems.find((entry) => entry.path === selectedInboxPath)
  if (!item) return
  try {
    if (action === 'open') {
      inboxView.classList.add('hidden')
      await loadFileFromPath(item.path)
      return
    } else if (action === 'rename') {
      const name = window.prompt(inboxText('', 'Nuevo nombre', 'New name'), item.name)
      if (!name?.trim() || name === item.name) return
      await invoke('inbox_rename', { name: item.name, newName: name.trim() })
    } else if (action === 'move') {
      const destination = await openDialog({ directory: true, multiple: false, title: inboxText('', 'Mover captura a…', 'Move capture to…') })
      if (!destination) return
      await invoke('inbox_move', { name: item.name, destinationFolder: destination })
    } else if (action === 'archive') {
      await invoke('inbox_archive', { name: item.name })
    } else if (action === 'delete') {
      if (!window.confirm(inboxText('', `¿Eliminar “${item.name}”?`, `Delete “${item.name}”?`))) return
      await invoke('inbox_delete', { name: item.name })
    }
    selectedInboxPath = ''
    await refreshInbox()
  } catch (error) { showMessage(formatError(error)) }
}

void listen('pliego://open-inbox-capture', ({ payload }) => openQuickCapture(payload?.text || payload || '')).catch(() => {})
void refreshInbox()

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
  appendCodexLoading(uiText('Preparando respuesta', 'Preparing response'))
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
  codexStatusLabel.textContent = uiText('Conectando…', 'Connecting…')
  try {
    const status = await invoke('codex_status')
    const models = await invoke('codex_models')
    codexStatusLabel.textContent = status.authenticated ? uiText('Conectado', 'Connected') : uiText('Sin sesión', 'Signed out')
    codexStatusLabel.classList.toggle('error', !status.authenticated)
    setCodexNotice(status.message, !status.authenticated)
    renderCodexModels(models.data || [])
    if (status.authenticated) await restoreCodexContext()
  } catch (error) {
    codexStatusLabel.textContent = uiText('No disponible', 'Unavailable')
    codexStatusLabel.classList.add('error')
    setCodexNotice(`${formatError(error)}. ${uiText('Ejecuta codex login si falta la sesión.', 'Run codex login if the session is missing.')}`, true)
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
  const model = codexModel.selectedOptions[0]?.textContent || t('model')
  const effort = codexEffort.selectedOptions[0]?.textContent || t('effort')
  codexOptionsSummary.textContent = `${model} · ${effort}`
}

function effortLabel(value) {
  return t(value, value)
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
    setCodexNotice(state.codexContext === 'folder' ? uiText('Abre una carpeta primero.', 'Open a folder first.') : uiText('Abre un Markdown primero.', 'Open a Markdown file first.'), true)
    return false
  }
  const saved = codexAssociations()[codexKey(scope)] || {}
  if (saved.model && Array.from(codexModel.options).some((option) => option.value === saved.model)) {
    codexModel.value = saved.model
  }
  renderCodexEfforts(saved.effort || '')
  setCodexNotice(uiText('Cargando conversación…', 'Loading conversation…'))
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
    const related = scope.contextType === 'document'
      ? uiText(` Puede leer ${result.relatedCount || 0} Markdown relacionados directamente.`, ` It can read ${result.relatedCount || 0} related Markdown files directly.`)
      : ''
    setCodexNotice((result.resumed ? uiText('Conversación reanudada.', 'Conversation resumed.') : saved.threadId ? uiText('El thread anterior no estaba disponible; se creó uno nuevo.', 'The previous thread was unavailable; a new one was created.') : uiText('Conversación lista.', 'Conversation ready.')) + related)
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
  codexStatusLabel.textContent = busy ? uiText('Pensando…', 'Thinking…') : uiText('Conectado', 'Connected')
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
    if (event.data.item.phase === 'final_answer') appendCodexLoading(uiText('Escribiendo respuesta', 'Writing response'))
  } else if (event.type === 'toolActivity' && event.tool) {
    setCodexNotice(`${uiText('Herramienta', 'Tool')}: ${event.tool}${event.success === false ? uiText(' (rechazada)', ' (rejected)') : ''}`, event.success === false)
  } else if (event.type === 'toolActivity' && event.data?.item?.type === 'dynamicToolCall') {
    appendCodexLoading(event.data.item.tool === 'markdown_read' ? uiText('Leyendo Markdown', 'Reading Markdown') : uiText('Trabajando con Markdown', 'Working with Markdown'))
  } else if (event.type === 'fileModified') {
    setCodexNotice(uiText('Markdown actualizado; refrescando visor.', 'Markdown updated; refreshing viewer.'))
    if (state.filePath) void refreshCodexEditedDocument()
  } else if (event.type === 'rateLimits') {
    setCodexNotice(uiText('Límites de uso actualizados por Codex.', 'Codex usage limits updated.'))
  } else if (event.type === 'error' || event.type === 'connection') {
    setCodexNotice(event.message || uiText('Codex se desconectó.', 'Codex disconnected.'), true)
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

function normalizedNewNote(value) {
  const raw = value.trim()
  if (!raw) return { error: uiText('Escribe un título para la página.', 'Enter a title for the page.') }
  if (Array.from(raw).length > 120) return { error: uiText('El título no puede superar 120 caracteres.', 'The title cannot exceed 120 characters.') }
  if (/[\/\\<>:"|?*\u0000-\u001f]/.test(raw)) return { error: uiText('El título contiene caracteres no permitidos.', 'The title contains invalid characters.') }
  const title = raw.replace(/\.(markdown|mdown|mkd|md)$/i, '').trim().replace(/\.+$/, '').trim()
  if (!title || title === '.' || title === '..') return { error: uiText('El título no produce un nombre válido.', 'The title does not produce a valid file name.') }
  const reserved = title.split('.')[0].toUpperCase()
  if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/.test(reserved)) return { error: uiText('Ese nombre está reservado por el sistema.', 'That name is reserved by the operating system.') }
  return { title, fileName: `${title}.md` }
}

function updateNewNotePreview() {
  const result = normalizedNewNote(newNoteInput.value)
  const folder = state.folder ? state.folder.replace(/\/$/, '') : ''
  newNotePath.textContent = result.fileName && folder ? `${folder}/${result.fileName}` : folder || uiText('Abre primero una carpeta', 'Open a folder first')
  newNoteError.textContent = result.error || ''
  newNoteError.classList.toggle('hidden', !result.error)
  $('#newNoteCreate').disabled = Boolean(result.error || !folder)
  return result
}

function openNewNoteDialog() {
  if (!newNoteModal.classList.contains('hidden')) {
    newNoteInput.focus()
    return
  }
  if (!state.folder) {
    showMessage(uiText('Abre una carpeta antes de crear una página Markdown.', 'Open a folder before creating a Markdown page.'))
    return
  }
  if (state.dirty) {
    showMessage(uiText('Guarda los cambios actuales antes de crear otra página.', 'Save the current changes before creating another page.'))
    return
  }
  newNotePreviousFocus = document.activeElement
  newNoteInput.value = ''
  newNoteError.classList.add('hidden')
  newNoteModal.classList.remove('hidden')
  updateNewNotePreview()
  window.setTimeout(() => newNoteInput.focus(), 0)
}

function closeNewNoteDialog() {
  newNoteModal.classList.add('hidden')
  if (newNotePreviousFocus?.focus) newNotePreviousFocus.focus()
  newNotePreviousFocus = null
}

async function createNewNote() {
  const result = updateNewNotePreview()
  if (result.error || !state.folder) return
  const createButton = $('#newNoteCreate')
  createButton.disabled = true
  const folder = state.folder
  try {
    const created = await invoke('create_markdown_file', { folder, title: result.title })
    await loadFolder(folder)
    closeNewNoteDialog()
    await loadFileFromPath(created.path)
    setMode('edit')
    showMessage(`${uiText('Página creada', 'Page created')}: ${created.fileName}`)
  } catch (error) {
    newNoteError.textContent = formatError(error)
    newNoteError.classList.remove('hidden')
    newNoteInput.focus()
  } finally {
    createButton.disabled = false
  }
}

$('#newNoteButton').addEventListener('click', openNewNoteDialog)
$('#newNoteClose').addEventListener('click', closeNewNoteDialog)
$('#newNoteCancel').addEventListener('click', closeNewNoteDialog)
newNoteInput.addEventListener('input', updateNewNotePreview)
$('#newNoteForm').addEventListener('submit', (event) => { event.preventDefault(); void createNewNote() })
newNoteModal.addEventListener('click', (event) => { if (event.target === newNoteModal) closeNewNoteDialog() })

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
      filters: [{ name: uiText('Documentos', 'Documents'), extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt', 'csv', 'tsv', 'pdf', 'docx', 'epub', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'mmd', 'mermaid'] }],
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
    showMessage(`${uiText('No pude abrir la carpeta: ', 'Could not open the folder: ')}${formatError(error)}`)
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
    state.treeNodes = Array.isArray(nodes) ? nodes : []
    addLibrary(dir)
    localStorage.setItem(FOLDER_KEY, dir)
    renderTree(nodes)
    if (!codexPanel.classList.contains('hidden') && state.codexContext === 'folder') void restoreCodexContext()
  } catch (error) {
    showMessage(`${uiText('No pude leer la carpeta: ', 'Could not read the folder: ')}${formatError(error)}`)
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
  treeCount.textContent = countText(countFiles(nodes), 'archivo', 'archivos', 'file', 'files')
  if (!nodes.length) {
    treeBox.innerHTML = `<p class="muted">${t('folderNoDocuments')}</p>`
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
  return `<button class="tree-file" type="button" data-path="${escapeHtml(node.path)}" data-file-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">${escapeHtml(node.name)}</button>`
}

treeBox.addEventListener('click', (event) => {
  const target = event.target.closest('.tree-file')
  if (target) {
    void loadFileFromPath(target.dataset.path)
  }
})

function hideFileContextMenu() {
  fileContextMenu.classList.add('hidden')
  fileContextMenuPath = ''
}

function showFileContextMenu(event, path) {
  fileContextMenuPath = path
  fileContextMenu.classList.remove('hidden')
  const margin = 8
  const left = Math.min(event.clientX, window.innerWidth - fileContextMenu.offsetWidth - margin)
  const top = Math.min(event.clientY, window.innerHeight - fileContextMenu.offsetHeight - margin)
  fileContextMenu.style.left = `${Math.max(margin, left)}px`
  fileContextMenu.style.top = `${Math.max(margin, top)}px`
  openFileInFolderButton.focus()
}

document.addEventListener('contextmenu', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-file-path]') : null
  if (!target) return
  event.preventDefault()
  showFileContextMenu(event, target.dataset.filePath)
})

openFileInFolderButton.addEventListener('click', async () => {
  const path = fileContextMenuPath
  hideFileContextMenu()
  if (!path) return
  try {
    await invoke('open_file_in_folder', { path })
  } catch (error) {
    showMessage(`${uiText('No se pudo abrir la carpeta: ', 'Could not open the folder: ')}${formatError(error)}`)
  }
})

document.addEventListener('click', (event) => {
  if (!fileContextMenu.contains(event.target)) hideFileContextMenu()
})
window.addEventListener('blur', hideFileContextMenu)
window.addEventListener('resize', hideFileContextMenu)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideFileContextMenu()
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
  const generation = beginDocumentLoad()
  try {
    const markdown = await file.text()
    let html
    try {
      html = await invoke('render_markdown_text', { contents: markdown })
    } catch (_) {
      html = `<pre>${escapeHtml(markdown)}</pre>`
    }
    if (!isCurrentLoad(generation)) return
    applyDocument(file.name, '', markdown, html)
    hideMessage()
  } catch (error) {
    showMessage(`${uiText('No pude leer el archivo: ', 'Could not read the file: ')}${formatError(error)}`)
  }
}

async function loadFileFromPath(path) {
  if (state.mode === 'edit' && state.dirty) {
    showMessage(uiText('Tienes cambios sin guardar. Guarda o vuelve a Lectura antes de abrir otro archivo.', 'You have unsaved changes. Save them or switch back to Read before opening another file.'))
    return
  }
  const generation = beginDocumentLoad()
  try {
    const entry = state.documentIndex.find((item) => item.path === path)
    const kind = entry?.kind || kindFromPath(path)
    if (!['markdown', 'text'].includes(kind)) {
      await loadVisualFile(path, kind, entry, generation)
      return
    }
    const payload = await invoke('read_markdown_file', {
      path,
      folder: state.folder || null,
    })
    if (!payload || typeof payload !== 'object') {
      throw new Error(uiText('Respuesta inválida', 'Invalid response'))
    }
    if (!isCurrentLoad(generation)) return
    state.documentKind = kind
    applyDocument(payload.fileName, path, payload.contents, payload.html)
    renderReferences()
    addRecent(path, payload.fileName)
    hideMessage()
  } catch (error) {
    if (!isCurrentLoad(generation) || error?.name === 'AbortError') return
    showMessage(`${uiText('No pude abrir el archivo seleccionado: ', 'Could not open the selected file: ')}${formatError(error)}`)
  }
}

function beginDocumentLoad() {
  state.loadGeneration += 1
  reader._visualCleanup?.()
  reader._visualCleanup = null
  cleanupMarkdownImages()
  return state.loadGeneration
}

function isCurrentLoad(generation) {
  return generation === state.loadGeneration
}

async function loadVisualFile(path, kind, entry, generation) {
  const payload = await invoke('read_binary_document', { path })
  if (!isCurrentLoad(generation)) return
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
  if (!isCurrentLoad(generation)) return
  state.visualInfo = info
  fileNameLabel.textContent = state.fileName
  metaInfo.textContent = visualDetail(info) || kind
  toc.innerHTML = `<p class="muted">${t('visualNoHeadings')}</p>`
  tocCount.textContent = uiText('Vista visual', 'Visual view')
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
  cleanupMarkdownImages()
  state.fileName = fileName
  state.filePath = filePath
  state.markdown = markdown
  state.frontmatter = splitFrontmatter(markdown)
  state.html = html
  state.dirty = false
  state.documentKind = kindFromPath(filePath || fileName)
  state.visualInfo = null
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
  documentTabs.innerHTML = state.openTabs.map((tab) => `<button class="document-tab${tab.path === state.filePath ? ' active' : ''}" type="button" data-tab-path="${escapeHtml(tab.path)}" data-file-path="${escapeHtml(tab.path)}" title="${escapeHtml(tab.path)}"><span class="tab-kind">${tabIcon(tab.kind)}</span><span>${escapeHtml(tab.name)}</span>${tab.path === state.filePath && state.dirty ? '<i class="dirty-dot"></i>' : `<i class="tab-close" data-close-tab="${escapeHtml(tab.path)}" aria-label="${escapeHtml(t('close'))}">×</i>`}</button>`).join('')
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
    showMessage(uiText('Guarda los cambios antes de cerrar esta pestaña.', 'Save your changes before closing this tab.'))
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
  state.visualInfo = null
  state.dirty = false
  updateFavoriteButton()
  reader.className = 'reader empty'
  cleanupMarkdownImages()
  renderEmptyDocument()
  fileNameLabel.textContent = t('noFile')
  metaInfo.textContent = uiText('Selecciona un documento para visualizarlo.', 'Select a document to view it.')
  renderReferences()
}

function renderEmptyDocument() {
  reader.innerHTML = `<div class="empty-state"><p class="eyebrow">${t('clearReading')}</p><h2>${uiText('Listo para abrir documentos', 'Ready to open documents')}</h2><p>${uiText('Abre una biblioteca o arrastra un archivo.', 'Open a library or drop a file.')}</p></div>`
}

function visualDetail(info) {
  if (!info) return ''
  if (info.detailEs && info.detailEn) return state.language === 'en' ? info.detailEn : info.detailEs
  return info.detail || ''
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
    recentsBox.innerHTML = `<p class="muted">${t('noRecents')}</p>`
    return
  }
  recentsBox.innerHTML = list
    .map(
      (item) =>
        `<button class="recent-link" type="button" data-path="${escapeHtml(item.path)}" data-file-path="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</button>`,
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
    showMessage(`${uiText('Enlace externo (no se abre en el visor)', 'External link (not opened in the viewer)')}: ${href}`)
    return
  }

  const clean = decodeURIComponent(href.split('#')[0])
  if (!/\.(md|markdown|mdown|mkd|txt)$/i.test(clean)) {
    showMessage(`${uiText('Solo puedo navegar a otros archivos Markdown', 'I can only navigate to other Markdown files')}: ${href}`)
    return
  }

  const base = state.filePath ? state.filePath.replace(/\/[^/]*$/, '') : state.folder
  if (!base && !clean.startsWith('/')) {
    showMessage(uiText('No conozco la ruta base para resolver este enlace.', 'I do not know the base path needed to resolve this link.'))
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
    showMessage(uiText('Este documento no tiene ruta en disco; ábrelo desde el diálogo o el árbol para poder guardar.', 'This document has no disk path; open it from the dialog or the tree to save it.'))
    return
  }
  try {
    const markdown = editorMarkdown()
    await invoke('save_markdown_file', { path: state.filePath, contents: markdown })
    state.markdown = markdown
    state.dirty = false
    renderDocumentTabs()
    showMessage(`${uiText('Guardado', 'Saved')}: ${state.fileName}`)
    setTimeout(hideMessage, 2200)
  } catch (error) {
    showMessage(`${uiText('No pude guardar: ', 'Could not save: ')}${formatError(error)}`)
  }
}

// ---------- Menu de formato (WYSIWYG, con toggle) ----------

const FORMAT_ACTIONS = [
  { key: 'bold', hint: 'B', run: () => document.execCommand('bold') },
  { key: 'italic', hint: 'I', run: () => document.execCommand('italic') },
  { key: 'strike', hint: 'S', run: () => document.execCommand('strikeThrough') },
  { key: 'inlineCode', hint: '</>', run: toggleInlineCode },
  { key: 'headingOne', hint: 'H1', run: () => toggleBlock('H1') },
  { key: 'headingTwo', hint: 'H2', run: () => toggleBlock('H2') },
  { key: 'headingThree', hint: 'H3', run: () => toggleBlock('H3') },
  { key: 'paragraph', hint: 'P', run: () => document.execCommand('formatBlock', false, 'P') },
  { key: 'quote', hint: '>', run: () => toggleBlock('BLOCKQUOTE') },
  { key: 'bulletList', hint: '•', run: () => document.execCommand('insertUnorderedList') },
  { key: 'numberedList', hint: '1.', run: () => document.execCommand('insertOrderedList') },
  { key: 'removeFormat', hint: '×', run: () => document.execCommand('removeFormat') },
]

function renderFormatMenu() {
  formatMenu.innerHTML = FORMAT_ACTIONS.map(
    (action, index) =>
      `<button type="button" data-action="${index}" data-action-key="${action.key}"><span>${escapeHtml(t(action.key))}</span><code>${escapeHtml(action.hint)}</code></button>`,
  ).join('')
}

renderFormatMenu()

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
    showMessage(uiText('Resaltado aplicado solo en pantalla: este documento no tiene ruta en disco.', 'Highlight applied on screen only: this document has no disk path.'))
    return
  }
  try {
    const markdown = editorMarkdown()
    await invoke('save_markdown_file', { path: state.filePath, contents: markdown })
    state.markdown = markdown
  } catch (error) {
    showMessage(`${uiText('No pude guardar el resaltado: ', 'Could not save the highlight: ')}${formatError(error)}`)
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

window.addEventListener('beforeunload', () => {
  reader._visualCleanup?.()
  reader._visualCleanup = null
  void invoke('codex_stop').catch(() => {})
})

function decorateRenderedContent() {
  const headings = reader.querySelectorAll('h1, h2, h3, h4, h5, h6')
  for (let index = 0; index < headings.length; index += 1) {
    const node = headings[index]
    if (!node.id) {
      node.id = slugify(node.textContent + '-' + index)
    }
  }

  void renderMermaidBlocks(reader)
  void hydrateMarkdownImages(reader, state.filePath, state.loadGeneration)
  const blocks = reader.querySelectorAll('pre code:not(.language-mermaid)')
  for (let index = 0; index < blocks.length; index += 1) {
    hljs.highlightElement(blocks[index])
  }
}

async function refreshMermaidTheme() {
  if (state.mode !== 'read') return
  if (state.documentKind === 'mermaid') {
    try { await renderMermaidDocument(reader, state.markdown) } catch (_) { return }
    return
  }
  if (!reader.querySelector('.inline-diagram') || !state.html) return
  cleanupMarkdownImages()
  reader.innerHTML = state.html
  decorateRenderedContent()
  renderToc()
  runSearch(searchInput.value)
}

function cleanupMarkdownImages() {
  for (const url of reader._markdownImageUrls || []) URL.revokeObjectURL(url)
  reader._markdownImageUrls = []
}

function resolveMarkdownImagePath(filePath, source) {
  const clean = source.split(/[?#]/)[0]
  if (!clean || clean.startsWith('#')) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(clean) && !/^[a-z]:[\\/]/i.test(clean)) {
    if (!clean.toLowerCase().startsWith('file://')) return ''
    try { return decodeURIComponent(new URL(clean).pathname) } catch (_) { return '' }
  }
  if (clean.startsWith('/') || /^[a-z]:[\\/]/i.test(clean)) {
    try { return decodeURIComponent(clean) } catch (_) { return '' }
  }
  if (!filePath) return ''
  const base = filePath.replace(/[\\/][^\\/]*$/, '').replace(/\\/g, '/')
  try { return resolvePath(base, decodeURIComponent(clean.replace(/\\/g, '/'))) } catch (_) { return '' }
}

function imageMimeType(path) {
  const extension = path.split('.').pop().toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' })[extension] || 'image/png'
}

async function hydrateMarkdownImages(root, filePath, generation) {
  if (!filePath) return
  const images = Array.from(root.querySelectorAll('img[src]'))
  for (const image of images) {
    const source = image.getAttribute('src') || ''
    const path = resolveMarkdownImagePath(filePath, source)
    if (!path) continue
    image.loading = 'lazy'
    image.decoding = 'async'
    image.classList.add('markdown-image-loading')
    try {
      const payload = await invoke('read_binary_document', { path })
      if (generation !== state.loadGeneration || !root.contains(image)) return
      const url = URL.createObjectURL(new Blob([decodeBase64(payload.base64)], { type: imageMimeType(path) }))
      reader._markdownImageUrls.push(url)
      image.src = url
      image.dataset.sourcePath = path
      image.classList.remove('markdown-image-loading')
    } catch (_) {
      image.classList.remove('markdown-image-loading')
      image.title = uiText('No se pudo cargar esta imagen.', 'This image could not be loaded.')
    }
  }
}

function updateMeta() {
  fileNameLabel.textContent = state.fileName
  const lines = state.markdown.split('\n').length
  const words = state.markdown.trim().split(/\s+/).filter(Boolean).length
  metaInfo.textContent = `${words} ${t('words')} · ${lines} ${t('lines')}`
}

function renderToc() {
  const headings = Array.prototype.slice.call(reader.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  tocCount.textContent = `${headings.length} ${t('sections')}`

  if (!headings.length) {
    toc.innerHTML = `<p class="muted">${t('noHeadings')}</p>`
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
  { labelKey: 'newNote', hintKey: 'currentLibrary', run: openNewNoteDialog },
  { labelKey: 'quickCapture', hintKey: 'quickCaptureShortcut', run: () => openQuickCapture() },
  { labelKey: 'openInbox', hintKey: 'pendingCaptures', run: () => void openInbox() },
  { labelKey: 'openFile', hintKey: 'systemPicker', run: () => void openMarkdown() },
  { labelKey: 'openFolder', hintKey: 'changeLibrary', run: () => void openFolder() },
  { labelKey: 'folderSearch', hintKey: 'folderNavigationShortcut', run: () => openPalette('search') },
  { labelKey: 'sidebarToggle', hintKey: 'navigation', run: () => toggleSidebar() },
  { labelKey: 'openCodex', hintKey: 'localAssistant', run: () => void openCodexPanel() },
  { labelKey: 'changeTheme', hintKey: 'themeModes', run: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
]

function paletteLabel(item) {
  return item.labelKey ? t(item.labelKey, item.labelKey) : item.label
}

function paletteItemHint(item) {
  return item.hintKey ? t(item.hintKey, item.hintKey) : item.hint
}

function paletteHintText() {
  if (state.paletteMode === 'search') return uiText('Busca en Markdown, texto, CSV y Mermaid', 'Search Markdown, text, CSV and Mermaid')
  if (state.paletteMode === 'commands') return uiText('Acciones disponibles', 'Available actions')
  return state.language === 'en' ? `${state.documentIndex.length} indexed documents` : `${state.documentIndex.length} documentos indexados`
}

function openPalette(mode = 'files') {
  if (!state.folder && mode !== 'commands') {
    showMessage(uiText('Abre una carpeta para usar esta función.', 'Open a folder to use this feature.'))
    return
  }
  state.paletteMode = mode
  commandPalette.classList.remove('hidden')
  paletteInput.value = ''
  paletteInput.placeholder = mode === 'search' ? uiText('Buscar texto en toda la carpeta…', 'Search text across the folder…') : mode === 'commands' ? uiText('Ejecutar comando…', 'Run command…') : t('paletteOpenPlaceholder')
  paletteHint.textContent = paletteHintText()
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
  if (state.paletteMode === 'commands') return PALETTE_COMMANDS.filter((item) => !term || `${paletteLabel(item)} ${paletteItemHint(item)}`.toLowerCase().includes(term))
  if (state.paletteMode === 'files') return state.documentIndex.filter((item) => !term || relativePath(item.path).toLowerCase().includes(term)).slice(0, 80)
  if (!term) return []
  return state.documentIndex.filter((item) => `${item.name}\n${item.searchableText || ''}`.toLowerCase().includes(term)).slice(0, 100)
}

function renderPaletteResults(query) {
  const results = paletteEntries(query)
  if (!results.length) {
    paletteResults.innerHTML = `<p class="palette-empty">${state.paletteMode === 'search' && !query ? t('typeToSearch') : t('noResults')}</p>`
    return
  }
  paletteResults.innerHTML = results.map((item, index) => {
    const isCommand = state.paletteMode === 'commands'
    const snippet = isCommand ? paletteItemHint(item) : state.paletteMode === 'search' ? searchSnippet(item.searchableText || '', query) : relativePath(item.path)
    return `<button class="palette-result${index === 0 ? ' active' : ''}" data-palette-index="${index}" type="button"><span><strong>${escapeHtml(isCommand ? paletteLabel(item) : item.label || item.name)}</strong><small>${escapeHtml(snippet)}</small></span><em>${escapeHtml(isCommand ? uiText('Comando', 'Command') : item.kind)}</em></button>`
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
    referencesBox.innerHTML = `<p class="muted">${t('referencesMarkdown')}</p>`
    return
  }
  const current = state.documentIndex.find((item) => item.path === state.filePath)
  const outgoing = (current?.references || []).map((reference) => ({ reference, target: resolveIndexedReference(state.filePath, reference) }))
  const backlinks = state.documentIndex.filter((item) => item.kind === 'markdown' && item.path !== state.filePath && (item.references || []).some((reference) => resolveIndexedReference(item.path, reference)?.path === state.filePath))
  referenceCount.textContent = String(outgoing.length + backlinks.length)
  const outgoingHtml = outgoing.length ? outgoing.map(({ reference, target }) => target
    ? `<button class="reference-link" data-path="${escapeHtml(target.path)}" type="button">→ ${escapeHtml(reference)}</button>`
    : `<span class="reference-link broken" title="${escapeHtml(t('unresolvedLink'))}">⚠ ${escapeHtml(reference)}</span>`).join('') : `<p class="muted">${t('noOutgoing')}</p>`
  const backlinksHtml = backlinks.length ? backlinks.map((item) => `<button class="reference-link" data-path="${escapeHtml(item.path)}" type="button">← ${escapeHtml(item.name)}</button>`).join('') : `<p class="muted">${t('noBacklinks')}</p>`
  referencesBox.innerHTML = `<p class="reference-heading">${uiText('Enlaces', 'Links')}</p>${outgoingHtml}<p class="reference-heading">${t('backlinks')}</p>${backlinksHtml}`
}

referencesBox.addEventListener('click', (event) => {
  const target = event.target.closest('[data-path]')
  if (target) void loadFileFromPath(target.dataset.path)
})

if (!onboardingCompleted()) window.setTimeout(() => onboarding.start(), 450)

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !commandPalette.classList.contains('hidden')) closePalette()
  if (event.key === 'Escape' && !inboxView.classList.contains('hidden')) inboxView.classList.add('hidden')
  if (event.key === 'Escape' && !newNoteModal.classList.contains('hidden')) closeNewNoteDialog()
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openNewNoteDialog() }
  if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'Space') { event.preventDefault(); openQuickCapture() }
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

const BACKEND_ERROR_TRANSLATIONS = [
  ['No se puede localizar el archivo:', 'Could not locate the file:'],
  ['No se pudo abrir el explorador de archivos:', 'Could not open the file manager:'],
  ['No se pudo resolver la configuración:', 'Could not resolve the configuration:'],
  ['La configuración del Inbox no está disponible', 'Inbox configuration is unavailable'],
  ['La carpeta del Inbox debe usar una ruta absoluta', 'The Inbox folder must use an absolute path'],
  ['Nombre de elemento inválido', 'Invalid item name'],
  ['El nombre no puede contener rutas', 'The name cannot contain path separators'],
  ['El elemento del Inbox no existe', 'The Inbox item does not exist'],
  ['El elemento está fuera del Inbox', 'The item is outside the Inbox'],
  ['Elige primero una carpeta para el Inbox', 'Choose an Inbox folder first'],
  ['La captura está vacía', 'The capture is empty'],
  ['Atajo global inválido', 'Invalid global shortcut'],
  ['No se pudo registrar el atajo:', 'Could not register the shortcut:'],
  ['La URL debe comenzar por http:// o https://', 'The URL must start with http:// or https://'],
  ['No es un archivo válido:', 'Not a valid file:'],
  ['Ya existe un elemento con ese nombre', 'An item with that name already exists'],
  ['La carpeta de destino no es válida', 'The destination folder is not valid'],
  ['El Inbox no elimina carpetas', 'Inbox does not delete folders'],
  ['Escribe un título para la página', 'Enter a title for the page'],
  ['El título no puede superar 120 caracteres', 'The title cannot exceed 120 characters'],
  ['El título contiene caracteres no permitidos', 'The title contains invalid characters'],
  ['El título no produce un nombre de archivo válido', 'The title does not produce a valid file name'],
  ['Ese nombre está reservado por el sistema', 'That name is reserved by the operating system'],
  ['Abre una carpeta válida antes de crear una página', 'Open a valid folder before creating a page'],
  ['Ya existe una página llamada ', 'A page named '],
]

function formatError(error) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : t('unknownError')
  if (state.language !== 'en') return message
  const translation = BACKEND_ERROR_TRANSLATIONS.find(([source]) => message.startsWith(source))
  return translation ? translation[1] + message.slice(translation[0].length) : message
}
