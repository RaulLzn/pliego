// Punto único de acceso a la plataforma: Tauri en escritorio, navegador en la PWA.
import * as native from './tauri.js'
import * as web from './web.js'

const platform = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? native : web

export const { isNative, defaultLibrary, exportLibrary, importLibrary } = platform
export const invoke = (...args) => platform.invoke(...args)
export const openDialog = (...args) => platform.openDialog(...args)
export const listen = (...args) => platform.listen(...args)
export const getCurrentWindow = () => platform.getCurrentWindow()
export const importPicked = (path) => platform.importPicked(path)
