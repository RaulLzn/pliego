import './focus-mode.css'

const CONTROLS_VISIBLE_MS = 3000
const INTERACTIVE = 'a, button, input, select, textarea, summary, label'

/**
 * Owns transient focus-mode state without touching persisted layout preferences.
 * In immersive mode (touch screens) even the exit button hides; tapping the
 * document shows it for a few seconds.
 */
export function createFocusMode({ shell, enterButton, reader, getLabels, immersive = () => false }) {
  const exitButton = document.createElement('button')
  exitButton.type = 'button'
  exitButton.className = 'focus-mode-exit'
  exitButton.hidden = true
  exitButton.setAttribute('aria-keyshortcuts', 'Escape Control+Shift+L Meta+Shift+L')
  shell.append(exitButton)
  reader.tabIndex = -1

  let previousFocus = null
  let hideTimer = 0
  const hideControls = () => {
    window.clearTimeout(hideTimer)
    shell.classList.remove('focus-controls-visible')
  }
  const showControls = () => {
    window.clearTimeout(hideTimer)
    shell.classList.add('focus-controls-visible')
    hideTimer = window.setTimeout(hideControls, CONTROLS_VISIBLE_MS)
  }
  const updateLabels = () => {
    const labels = getLabels()
    enterButton.setAttribute('aria-label', labels.enter)
    enterButton.dataset.tooltip = labels.enterHint
    exitButton.textContent = labels.exit
    exitButton.setAttribute('aria-label', labels.exit)
    exitButton.dataset.tooltip = labels.exitHint
  }

  function enter() {
    if (shell.classList.contains('focus-mode')) return
    previousFocus = document.activeElement
    shell.classList.add('focus-mode')
    exitButton.hidden = false
    if (immersive()) {
      shell.classList.add('focus-immersive')
      showControls()
    }
    const editing = previousFocus === reader || previousFocus?.closest?.('#editor')
    if (editing) return
    reader.focus({ preventScroll: true })
  }

  function exit() {
    if (!shell.classList.contains('focus-mode')) return
    shell.classList.remove('focus-mode', 'focus-immersive')
    hideControls()
    exitButton.hidden = true
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus()
    else reader.focus?.({ preventScroll: true })
    previousFocus = null
  }

  enterButton.addEventListener('click', enter)
  shell.addEventListener('click', (event) => {
    if (!shell.classList.contains('focus-immersive')) return
    if (event.target.closest(INTERACTIVE) || !window.getSelection()?.isCollapsed) return
    if (shell.classList.contains('focus-controls-visible')) hideControls()
    else showControls()
  })
  exitButton.addEventListener('click', exit)
  updateLabels()
  return { enter, exit, isActive: () => shell.classList.contains('focus-mode'), updateLabels }
}
