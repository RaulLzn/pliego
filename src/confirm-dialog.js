// Confirmaciones que funcionan igual en la web y en escritorio.
//
// En escritorio, tauri-plugin-dialog 2.7 sustituye window.confirm por una
// versión async que llama a un comando `confirm` que ya no existe: devuelve una
// Promise (siempre «verdadera» en un `if`) que además se rechaza. Así el Inbox
// borraba sin preguntar y cerrar la ventana no avisaba. Por eso main.js inyecta
// el diálogo de la plataforma y aquí siempre se espera el resultado.
let implementation = null

export function setConfirmImplementation(fn) {
  implementation = fn
}

export async function askConfirm(message) {
  if (implementation) return Boolean(await implementation(message))
  if (typeof globalThis.confirm !== 'function') return true
  return Boolean(await globalThis.confirm(message))
}
