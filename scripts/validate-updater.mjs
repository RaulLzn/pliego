import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const [directory, version, repository] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(`${directory}/latest.json`, 'utf8'))
const release = JSON.parse(readFileSync(`${directory}/release.json`, 'utf8'))
assert.equal(manifest.version.replace(/^v/, ''), version, 'Unexpected updater version')
const assets = new Map(release.assets.map(asset => [asset.name, asset]))
const prefix = `https://github.com/${repository}/releases/download/v${version}/`
for (const target of ['linux-x86_64', 'windows-x86_64', 'darwin-x86_64', 'darwin-aarch64']) {
  const entry = manifest.platforms?.[target]
  assert(entry?.url?.startsWith(prefix), `Missing or foreign URL for ${target}`)
  const filename = decodeURIComponent(entry.url.slice(prefix.length))
  assert(assets.get(filename)?.size > 0, `Missing package for ${target}`)
  assert(assets.get(`${filename}.sig`)?.size > 0, `Missing signature asset for ${target}`)
  assert.equal(entry.signature?.trim(), readFileSync(`${directory}/${filename}.sig`, 'utf8').trim(), `Signature mismatch for ${target}`)
  const decoded = Buffer.from(entry.signature, 'base64').toString('utf8')
  assert(decoded.startsWith('untrusted comment:') && decoded.includes('trusted comment:'), `Malformed signature for ${target}`)
}
console.log(`Validated signed updater manifest for Pliego ${version}: four targets`)
