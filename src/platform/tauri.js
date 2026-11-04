// Adaptador de escritorio: delega en Tauri sin cambios.
export { invoke } from '@tauri-apps/api/core'
export { open as openDialog } from '@tauri-apps/plugin-dialog'
export { listen } from '@tauri-apps/api/event'
export { getCurrentWindow } from '@tauri-apps/api/window'

export const isNative = true
export const defaultLibrary = ''
export const importPicked = async (path) => path
export const exportLibrary = null
export const importLibrary = null
