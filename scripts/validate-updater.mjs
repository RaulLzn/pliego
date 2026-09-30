import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, createPublicKey, verify } from 'node:crypto'
import assert from 'node:assert/strict'

const [directory, version, repository] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(`${directory}/latest.json`, 'utf8'))
const release = JSON.parse(readFileSync(`${directory}/release.json`, 'utf8'))
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
assert.equal(manifest.version.replace(/^v/, ''), version, 'Unexpected updater version')
const assets = new Map(release.assets.map(asset => [asset.name, asset]))
const apiAssets = new Map(release.assets.map(asset => [asset.apiUrl, asset]))
const prefix = `https://github.com/${repository}/releases/download/v${version}/`
const keyText = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8')
const keyPacket = Buffer.from(keyText.split('\n')[1], 'base64')
assert.equal(keyPacket.length, 42, 'Malformed public key')
const key = createPublicKey({
  key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), keyPacket.subarray(10)]),
  format: 'der', type: 'spki',
})
for (const target of ['linux-x86_64', 'windows-x86_64', 'darwin-x86_64', 'darwin-aarch64']) {
  assert(manifest.platforms?.[target], `Missing target ${target}`)
}
const verified = new Set()
for (const [target, entry] of Object.entries(manifest.platforms)) {
  // Draft assets use API URLs. Resolve only assets belonging to this release.
  const asset = apiAssets.get(entry.url) || (entry.url?.startsWith(prefix)
    ? assets.get(decodeURIComponent(entry.url.slice(prefix.length))) : undefined)
  assert(asset?.size > 0, `Missing or foreign package for ${target}`)
  const filename = asset.name
  assert(assets.get(`${filename}.sig`)?.size > 0, `Missing signature asset for ${target}`)
  assert.equal(entry.signature?.trim(), readFileSync(`${directory}/${filename}.sig`, 'utf8').trim(), `Signature mismatch for ${target}`)
  if (!verified.has(filename)) {
    const lines = Buffer.from(entry.signature, 'base64').toString('utf8').trim().split('\n')
    assert(lines[0]?.startsWith('untrusted comment:') && lines[2]?.startsWith('trusted comment: '), `Malformed signature for ${target}`)
    const signature = Buffer.from(lines[1], 'base64')
    assert.equal(signature.length, 74, `Malformed signature packet for ${target}`)
    assert(signature.subarray(2, 10).equals(keyPacket.subarray(2, 10)), `Unexpected signing key for ${target}`)
    assert.equal(signature.subarray(0, 2).toString(), 'ED', `Unexpected signature algorithm for ${target}`)
    const hash = createHash('blake2b512').update(readFileSync(`${directory}/${filename}`)).digest()
    assert(verify(null, hash, key, signature.subarray(10)), `Invalid package signature for ${target}`)
    const comment = Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice(17))])
    assert(verify(null, comment, key, Buffer.from(lines[3], 'base64')), `Invalid comment signature for ${target}`)
    verified.add(filename)
  }
  entry.url = `${prefix}${encodeURIComponent(filename)}`
}
assert(manifest.platforms['linux-x86_64'].url.endsWith('.AppImage'), 'Default Linux update must be AppImage')
writeFileSync(`${directory}/latest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Validated ${verified.size} signed packages and public URLs for Pliego ${version}`)
