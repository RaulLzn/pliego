//! ABI mínima para `src/platform/render-wasm.js`, sin wasm-bindgen.
//!
//! JS reserva memoria con `alloc`, copia la entrada en UTF-8 (campos separados
//! por `\0`) y llama a una función. El resultado queda en un búfer interno que
//! se lee con `output_ptr` y `output_len` hasta la siguiente llamada.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;

thread_local! {
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn input(ptr: *mut u8, len: usize) -> String {
    // SAFETY: `ptr` viene de `alloc(len)` y JS escribió ahí `len` bytes.
    let bytes = unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) };
    String::from_utf8_lossy(&bytes).into_owned()
}

fn output(value: String) {
    OUTPUT.with(|buffer| *buffer.borrow_mut() = value.into_bytes());
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0_u8; len].into_boxed_slice()).cast()
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with(|buffer| buffer.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn output_len() -> usize {
    OUTPUT.with(|buffer| buffer.borrow().len())
}

/// Entrada: el Markdown. Salida: HTML.
#[no_mangle]
pub extern "C" fn render(ptr: *mut u8, len: usize) {
    output(pliego_render::render_markdown(&input(ptr, len)));
}

/// Entrada: `ruta\0carpeta\0markdown\0candidatos`, donde cada candidato es
/// `ruta\ttítulo` en su propia línea. Salida: HTML con los `[[enlaces]]` resueltos.
#[no_mangle]
pub extern "C" fn render_with_context(ptr: *mut u8, len: usize) {
    let text = input(ptr, len);
    let mut fields = text.splitn(4, '\0');
    let file_path = Path::new(fields.next().unwrap_or_default());
    let folder = fields.next().filter(|value| !value.is_empty());
    let contents = fields.next().unwrap_or_default();
    let titles: HashMap<&str, &str> = fields
        .next()
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .collect();
    let contents = pliego_render::strip_frontmatter(contents);
    let contents = pliego_render::resolve_wiki_links(&contents, &|target| {
        let path = pliego_render::find_wiki_target(target, file_path, folder, None, |path| {
            path.to_str().is_some_and(|path| titles.contains_key(path))
        })?;
        let title = titles.get(path.to_str()?)?.to_string();
        Some((path, title))
    });
    output(pliego_render::render_markdown_source(&contents));
}

/// Entrada: `ruta\0markdown`. Salida: el título del documento.
#[no_mangle]
pub extern "C" fn title(ptr: *mut u8, len: usize) {
    let text = input(ptr, len);
    let (path, contents) = text.split_once('\0').unwrap_or((&text, ""));
    output(pliego_render::markdown_title(
        Some(contents),
        Path::new(path),
    ));
}

/// Entrada: Markdown. Salida: una referencia por línea.
#[no_mangle]
pub extern "C" fn references(ptr: *mut u8, len: usize) {
    output(pliego_render::markdown_references(&input(ptr, len)).join("\n"));
}

/// Entrada: título. Salida: `ok\0encabezado\0archivo.md` o `err\0mensaje`.
#[no_mangle]
pub extern "C" fn page_name(ptr: *mut u8, len: usize) {
    output(
        match pliego_render::markdown_name_from_title(&input(ptr, len)) {
            Ok((heading, file_name)) => format!("ok\0{heading}\0{file_name}"),
            Err(message) => format!("err\0{message}"),
        },
    );
}
