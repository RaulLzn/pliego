import test from 'node:test'
import assert from 'node:assert/strict'
import { askConfirm } from '../src/confirm-dialog.js'

test('waits for an async confirm (Tauri dialog plugin) instead of treating the Promise as true', async () => {
  globalThis.confirm = async () => false
  assert.equal(await askConfirm('¿Borrar?'), false)
  globalThis.confirm = async () => true
  assert.equal(await askConfirm('¿Borrar?'), true)
})

test('works with the synchronous browser confirm', async () => {
  globalThis.confirm = () => false
  assert.equal(await askConfirm('¿Borrar?'), false)
  delete globalThis.confirm
  assert.equal(await askConfirm('¿Borrar?'), true)
})

test('uses the injected platform dialog when set', async () => {
  const { setConfirmImplementation } = await import('../src/confirm-dialog.js')
  setConfirmImplementation(async () => false)
  assert.equal(await askConfirm('¿Cerrar?'), false)
  setConfirmImplementation(null)
})
