// Cliente JS del renderizador de crates/pliego-render-wasm (ABI descrita allí).
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function createRenderer(source) {
  const { instance } = await WebAssembly.instantiate(source, {})
  const wasm = instance.exports

  function call(name, ...fields) {
    // `\0` separa campos: no puede aparecer dentro de ellos.
    const bytes = encoder.encode(fields.map((field) => String(field ?? '').replaceAll('\0', '�')).join('\0'))
    const pointer = wasm.alloc(bytes.length)
    new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes)
    wasm[name](pointer, bytes.length)
    return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), wasm.output_len()))
  }

  return {
    render: (markdown) => call('render', markdown),
    renderWithContext: (markdown, { path, folder, titles }) => {
      const candidates = Array.from(titles, ([file, title]) => `${file}\t${String(title).replace(/[\t\n\r]+/g, ' ')}`).join('\n')
      return call('render_with_context', path, folder || '', markdown, candidates)
    },
    title: (path, markdown) => call('title', path, markdown),
    references: (markdown) => {
      const output = call('references', markdown)
      return output ? output.split('\n') : []
    },
    pageName: (title) => {
      const [status, first, second] = call('page_name', title).split('\0')
      if (status !== 'ok') throw first
      return { heading: first, fileName: second }
    },
  }
}
