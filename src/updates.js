import { invoke, Channel } from '@tauri-apps/api/core'
import { getBundleType, getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

const labels = {
  es: {
    check: 'Buscar actualizaciones', checking: 'Buscando actualizaciones…',
    current: (version) => `Pliego ${version} está actualizado.`,
    available: (version) => `Pliego ${version} está disponible.`,
    install: 'Actualizar ahora', downloading: (percent) => `Descargando actualización${percent}…`,
    installing: 'Instalando actualización…', restart: 'Reinicia Pliego para completar la actualización.',
    unsaved: 'Guarda tus cambios antes de actualizar Pliego.',
    authorization: 'La instalación requiere permisos del sistema. Autoriza el diálogo para continuar.',
    cancelled: 'Se canceló la autorización. Puedes volver a intentar la actualización.',
    failed: 'No se pudo comprobar o instalar la actualización. Inténtalo de nuevo.',
  },
  en: {
    check: 'Check for updates', checking: 'Checking for updates…',
    current: (version) => `Pliego ${version} is up to date.`,
    available: (version) => `Pliego ${version} is available.`,
    install: 'Update now', downloading: (percent) => `Downloading update${percent}…`,
    installing: 'Installing update…', restart: 'Restart Pliego to finish updating.',
    unsaved: 'Save your changes before updating Pliego.',
    authorization: 'Installation requires system permissions. Authorize the dialog to continue.',
    cancelled: 'Authorization was cancelled. You can try the update again.',
    failed: 'Could not check for or install the update. Try again.',
  },
}

export function initializeUpdater({ language, hasUnsavedChanges }) {
  const setting = document.querySelector('#updateSetting')
  const status = document.querySelector('#updateStatus')
  const checkButton = document.querySelector('#updateCheck')
  const banner = document.querySelector('#updateBanner')
  const bannerText = document.querySelector('#updateBannerText')
  const installButton = document.querySelector('#updateInstall')
  let packageManaged = false
  let update = null
  let version = ''
  let busy = false
  let downloadedPackage = false
  let message = 'checking'
  let detail = ''

  const copy = () => labels[language() === 'en' ? 'en' : 'es']
  function render() {
    const text = copy()
    status.textContent = typeof text[message] === 'function'
      ? text[message](message === 'downloading' ? detail : (detail || version))
      : text[message]
    checkButton.textContent = text.check
    checkButton.disabled = busy
    installButton.textContent = text.install
    installButton.disabled = busy
    banner.classList.toggle('hidden', !update)
    if (update) bannerText.textContent = status.textContent
  }

  async function checkForUpdate() {
    if (busy) return
    busy = true
    message = 'checking'
    render()
    try {
      if (!packageManaged) await update?.close()
      if (packageManaged) {
        const available = await invoke('package_update_check')
        update = available ? { version: available } : null
      } else {
        update = await check({ timeout: 15000 })
      }
      downloadedPackage = false
      message = update ? 'available' : 'current'
      detail = update?.version || version
    } catch (error) {
      console.warn('Pliego update check failed:', error)
      update = null
      message = 'failed'
    } finally {
      busy = false
      render()
    }
  }

  async function installUpdate() {
    if (busy || !update) return
    if (hasUnsavedChanges()) {
      message = 'unsaved'
      render()
      return
    }
    busy = true
    let downloaded = 0
    let total = 0
    message = 'downloading'
    detail = ''
    render()
    try {
      if (!downloadedPackage) {
        const progress = (event) => {
          if (event.event === 'Started') total = event.data.contentLength || 0
          if (event.event === 'Progress') downloaded += event.data.chunkLength
          detail = total ? ` ${Math.min(100, Math.floor(100 * downloaded / total))}%` : ''
          render()
        }
        if (packageManaged) {
          const onProgress = new Channel()
          onProgress.onmessage = progress
          await invoke('package_update_download', { onProgress })
        } else {
          await update.download(progress)
        }
        downloadedPackage = true
      }
      if (hasUnsavedChanges()) {
        message = 'unsaved'
        return
      }
      message = packageManaged ? 'authorization' : 'installing'
      render()
      if (packageManaged) {
        // A failed/cancelled installer consumes its temporary package. Download again on retry.
        downloadedPackage = false
        await invoke('package_update_install')
      } else {
        await update.install()
      }
      message = 'restart'
      render()
      try {
        await relaunch()
      } catch (error) {
        console.warn('Pliego could not restart after updating:', error)
        update = null
      }
    } catch (error) {
      console.warn('Pliego update installation failed:', error)
      if (!packageManaged) update = null
      downloadedPackage = false
      message = error === 'authorization_cancelled' ? 'cancelled' : 'failed'
    } finally {
      busy = false
      render()
    }
  }

  checkButton.addEventListener('click', () => void checkForUpdate())
  installButton.addEventListener('click', () => void installUpdate())
  void (async () => {
    try {
      const bundle = await getBundleType()
      packageManaged = ['rpm', 'deb'].includes(bundle)
      if (!packageManaged && !['appimage', 'nsis', 'msi', 'app'].includes(bundle)) return
      version = await getVersion()
      setting.classList.remove('hidden')
      await checkForUpdate()
    } catch (error) {
      console.warn('Pliego updater unavailable:', error)
    }
  })()
  return { render }
}
