// Compila pliego-render a WebAssembly para la versión web.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'

const manifest = 'crates/pliego-render-wasm/Cargo.toml'
execFileSync('cargo', ['build', '--manifest-path', manifest, '--release', '--locked', '--target', 'wasm32-unknown-unknown'], { stdio: 'inherit' })
mkdirSync('src/platform/generated', { recursive: true })
copyFileSync('crates/pliego-render-wasm/target/wasm32-unknown-unknown/release/pliego_render_wasm.wasm', 'src/platform/generated/pliego-render.wasm')
console.log('WASM listo en src/platform/generated/pliego-render.wasm')
