import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the UI orchestration with mocked IPC; native package/signature checks live in Rust.
const source = readFileSync(new URL('../src/updates.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replace('export function', 'function')
const flush = () => new Promise(resolve => setImmediate(resolve))
async function setup({ bundle = 'rpm', dirty = false, cancel = false } = {}) {
  const calls = []
  const nodes = new Map()
  const document = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      classList: { remove() {}, toggle() {} },
      addEventListener(event, callback) { this[event] = callback },
    })
    return nodes.get(selector)
  } }
  const invoke = async command => {
    calls.push(command)
    if (command === 'package_update_check') return '1.7.1'
    if (command === 'package_update_install' && cancel) throw 'authorization_cancelled'
  }
  const update = { version: '1.7.1', async download() { calls.push('download') }, async install() { calls.push('install') } }
  new Function('document', 'invoke', 'Channel', 'getBundleType', 'getVersion', 'check', 'relaunch', 'dirty',
    `${source}; initializeUpdater({language: () => 'es', hasUnsavedChanges: () => dirty});`)(
    document, invoke, class {}, async () => bundle, async () => '1.7.0', async () => update,
    async () => calls.push('restart'), dirty)
  await flush()
  return { calls, nodes, async install() { nodes.get('#updateInstall').click(); await flush() } }
}
test('RPM verifies/downloads through native IPC before installation and restart', async () => {
  const ui = await setup()
  await ui.install()
  assert.deepEqual(ui.calls, ['package_update_check', 'package_update_download', 'package_update_install', 'restart'])
})
test('DEB follows native package flow, unsaved edits block installation', async () => {
  const ui = await setup({ bundle: 'deb', dirty: true })
  await ui.install()
  assert.deepEqual(ui.calls, ['package_update_check'])
  assert.match(ui.nodes.get('#updateStatus').textContent, /Guarda tus cambios/)
})
test('authorization cancellation does not restart and offers a fresh download on retry', async () => {
  const ui = await setup({ cancel: true })
  await ui.install()
  assert.match(ui.nodes.get('#updateStatus').textContent, /canceló/)
  await ui.install()
  assert.equal(ui.calls.filter(c => c === 'package_update_download').length, 2)
  assert.ok(!ui.calls.includes('restart'))
})
test('AppImage keeps the existing updater plugin installation', async () => {
  const ui = await setup({ bundle: 'appimage' })
  await ui.install()
  assert.deepEqual(ui.calls, ['download', 'install', 'restart'])
})
