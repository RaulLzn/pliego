import './focus-mode.css'

/** Owns transient focus-mode state without touching persisted layout preferences. */
export function createFocusMode({ shell, enterButton, reader, getLabels }) {
  const exitButton = document.createElement('button')
  exitButton.type = 'button'
  exitButton.className = 'focus-mode-exit'
  exitButton.hidden = true
  exitButton.setAttribute('aria-keyshortcuts', 'Escape Control+Shift+L Meta+Shift+L')
  shell.append(exitButton)
  reader.tabIndex = -1

  let previousFocus = null
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
    const editing = previousFocus === reader || previousFocus?.closest?.('#editor')
    if (editing) return
    reader.focus({ preventScroll: true })
  }

  function exit() {
    if (!shell.classList.contains('focus-mode')) return
    shell.classList.remove('focus-mode')
    exitButton.hidden = true
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus()
    else reader.focus?.({ preventScroll: true })
    previousFocus = null
  }

  enterButton.addEventListener('click', enter)
  exitButton.addEventListener('click', exit)
  updateLabels()
  return { enter, exit, isActive: () => shell.classList.contains('focus-mode'), updateLabels }
}
