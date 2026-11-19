use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pliego_render::{
    document_kind, markdown_name_from_title, markdown_references, render_markdown,
    strip_frontmatter,
};
use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;

mod codex;
mod inbox;
mod package_update;

const MAX_VISUAL_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES: u64 = 32 * 1024 * 1024;
const INDEX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePayload {
    file_name: String,
    contents: String,
    html: String,
}

#[derive(Default)]
struct PendingOpenPaths(Mutex<Vec<String>>);

fn launch_paths_from_args(args: impl IntoIterator<Item = OsString>) -> Vec<String> {
    let mut seen = HashSet::new();
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_document(path))
        .filter_map(|path| path.canonicalize().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

#[tauri::command]
fn get_launch_paths(pending: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    let mut paths = launch_paths_from_args(std::env::args_os());
    let mut queued = pending.0.lock().unwrap_or_else(|error| error.into_inner());
    for path in queued.drain(..) {
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<TreeNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentIndexEntry {
    name: String,
    path: String,
    kind: String,
    searchable_text: String,
    references: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BinaryPayload {
    file_name: String,
    kind: String,
    base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedMarkdown {
    file_name: String,
    path: String,
    /// `false` cuando la página ya existía y se pidió abrirla (`existing_ok`).
    created: bool,
}

/// Opciones de una página nueva. Todas son opcionales para que las llamadas
/// antiguas (solo carpeta y título) sigan funcionando igual.
#[derive(Default)]
struct NewPageOptions<'a> {
    /// Subcarpeta relativa a la biblioteca (p. ej. «Diario»); se crea si falta.
    subfolder: Option<&'a str>,
    /// Contenido inicial (plantilla ya rellenada); si falta, solo el título.
    contents: Option<&'a str>,
    /// Si la página ya existe, se devuelve en vez de fallar (nota diaria).
    existing_ok: bool,
}

/// Extensiones de imagen que se pueden guardar al pegar en el editor. Son las
/// que el lector sabe mostrar; SVG queda fuera porque puede llevar scripts.
const PASTE_IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const MAX_PASTED_IMAGE_BYTES: usize = 32 * 1024 * 1024;

fn is_document(path: &Path) -> bool {
    document_kind(path).is_some()
}

fn build_tree(dir: &Path) -> Result<Vec<TreeNode>, String> {
    build_tree_inner(dir, &mut HashSet::new())
}

/// Clave para no recorrer dos veces la misma carpeta (enlaces simbólicos en bucle).
fn visit_key(dir: &Path) -> PathBuf {
    dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf())
}

fn build_tree_inner(dir: &Path, visited: &mut HashSet<PathBuf>) -> Result<Vec<TreeNode>, String> {
    let mut nodes = Vec::new();
    if !visited.insert(visit_key(dir)) {
        return Ok(nodes);
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|error| format!("No se puede leer la carpeta '{}': {error}", dir.display()))?;

    // Una entrada ilegible no debe impedir mostrar el resto de la biblioteca.
    let mut items: Vec<_> = entries.filter_map(Result::ok).collect();
    items.sort_by_key(|entry| {
        (
            !entry.path().is_dir(),
            entry.file_name().to_ascii_lowercase(),
        )
    });

    for entry in items {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            // Una subcarpeta sin permisos se omite en vez de tumbar todo el árbol.
            let Ok(children) = build_tree_inner(&path, visited) else {
                continue;
            };
            if !children.is_empty() {
                nodes.push(TreeNode {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: true,
                    children,
                });
            }
        } else if is_document(&path) {
            nodes.push(TreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: Vec::new(),
            });
        }
    }

    Ok(nodes)
}

#[tauri::command]
fn list_markdown_tree(dir: String) -> Result<Vec<TreeNode>, String> {
    build_tree(Path::new(&dir))
}

fn collect_document_index(dir: &Path, entries: &mut Vec<DocumentIndexEntry>) -> Result<(), String> {
    collect_document_index_inner(dir, entries, &mut HashSet::new())
}

fn collect_document_index_inner(
    dir: &Path,
    entries: &mut Vec<DocumentIndexEntry>,
    visited: &mut HashSet<PathBuf>,
) -> Result<(), String> {
    if !visited.insert(visit_key(dir)) {
        return Ok(());
    }
    let children = std::fs::read_dir(dir).map_err(|error| {
        format!(
            "No se puede indexar la carpeta '{}': {error}",
            dir.display()
        )
    })?;
    for child in children.filter_map(Result::ok) {
        let path = child.path();
        if child.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            // Igual que en el árbol: una subcarpeta ilegible se omite.
            let _ = collect_document_index_inner(&path, entries, visited);
            continue;
        }
        let Some(kind) = document_kind(&path) else {
            continue;
        };
        let contents = if matches!(kind, "markdown" | "text" | "table" | "mermaid") {
            // Un enlace simbólico roto o sin permisos se indexa sin texto.
            read_text_prefix(&path, INDEX_TEXT_BYTES).unwrap_or_default()
        } else {
            String::new()
        };
        let references = if kind == "markdown" {
            markdown_references(&contents)
        } else {
            Vec::new()
        };
        entries.push(DocumentIndexEntry {
            name: child.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            kind: kind.to_string(),
            searchable_text: contents,
            references,
        });
    }
    Ok(())
}

fn read_text_prefix(path: &Path, limit: u64) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(decode_text(&bytes))
}

/// Windows-1252 para 0x80–0x9F; el resto coincide con Latin-1.
const CP1252_HIGH: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž', '\u{8F}',
    '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}', 'ž', 'Ÿ',
];

/// Decodifica texto quitando el BOM UTF-8. Si no es UTF-8 válido (archivos
/// antiguos de Windows), se interpreta como Windows-1252 en vez de fallar o
/// sustituir caracteres por U+FFFD, que se perderían al guardar.
fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        // Secuencia cortada al final (lectura parcial del índice): sigue siendo UTF-8.
        Err(error) if error.error_len().is_none() => {
            String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()
        }
        Err(_) => bytes
            .iter()
            .map(|&byte| match byte {
                0x80..=0x9F => CP1252_HIGH[usize::from(byte - 0x80)],
                _ => char::from(byte),
            })
            .collect(),
    }
}

#[tauri::command]
fn list_document_index(dir: String) -> Result<Vec<DocumentIndexEntry>, String> {
    let mut entries = Vec::new();
    collect_document_index(Path::new(&dir), &mut entries)?;
    entries.sort_by(|a, b| {
        a.path
            .to_ascii_lowercase()
            .cmp(&b.path.to_ascii_lowercase())
    });
    Ok(entries)
}

#[tauri::command]
fn read_binary_document(path: String) -> Result<BinaryPayload, String> {
    let file_path = Path::new(&path);
    let kind = document_kind(file_path).ok_or("Formato no soportado")?;
    let size = std::fs::metadata(file_path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_VISUAL_FILE_BYTES {
        return Err(format!(
            "El archivo ocupa {:.1} MB; el límite seguro de visualización es 128 MB",
            size as f64 / 1_048_576.0
        ));
    }
    let bytes = std::fs::read(file_path).map_err(|error| error.to_string())?;
    Ok(BinaryPayload {
        file_name: file_path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("documento")
            .to_string(),
        kind: kind.to_string(),
        base64: BASE64.encode(bytes),
    })
}

#[tauri::command]
fn open_file_in_folder(path: String) -> Result<(), String> {
    let file_path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("No se puede localizar el archivo: {error}"))?;
    let folder = if file_path.is_dir() {
        file_path.clone()
    } else {
        file_path
            .parent()
            .ok_or_else(|| "El archivo no tiene una carpeta contenedora".to_string())?
            .to_path_buf()
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        if file_path.is_file() {
            command.arg(format!("/select,{}", file_path.display()));
        } else {
            command.arg(&folder);
        }
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        if file_path.is_file() {
            command.arg("-R").arg(&file_path);
        } else {
            command.arg(&folder);
        }
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    #[cfg(all(unix, not(target_os = "macos")))]
    command.arg(&folder);

    let status = command
        .status()
        .map_err(|error| format!("No se pudo abrir el explorador de archivos: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "El explorador de archivos terminó con código {}",
            status
                .code()
                .map_or_else(|| "desconocido".to_string(), |code| code.to_string())
        ))
    }
}

#[tauri::command]
fn save_markdown_file(path: String, contents: String) -> Result<(), String> {
    write_file_atomically(Path::new(&path), contents.as_bytes())
}

/// Escribe en un temporal y lo renombra: un disco lleno o un cierre a mitad
/// de escritura ya no deja el documento truncado.
fn write_file_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    // Si el documento es un enlace simbólico, se escribe en su destino para no
    // sustituir el enlace por un archivo normal.
    let target = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let parent = target.parent().ok_or("El archivo no tiene carpeta padre")?;
    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let temp = parent.join(format!(
        ".{file_name}.pliego-{}-{nonce}.tmp",
        std::process::id()
    ));
    let permissions = std::fs::metadata(&target)
        .ok()
        .map(|meta| meta.permissions());
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        file.write_all(contents)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        if let Some(permissions) = permissions {
            std::fs::set_permissions(&temp, permissions).map_err(|error| error.to_string())?;
        }
        std::fs::rename(&temp, &target).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Valida una subcarpeta relativa: sin `..`, sin rutas absolutas, sin carpetas
/// ocultas ni caracteres que Windows no admite. Devuelve sus componentes.
fn subfolder_components(subfolder: &str) -> Result<Vec<String>, String> {
    let parts: Vec<String> = subfolder
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect();
    if subfolder.starts_with(['/', '\\']) || parts.len() > 8 {
        return Err("La subcarpeta no es válida".to_string());
    }
    for part in &parts {
        let invalid = part.starts_with('.')
            || part.trim() != part
            || part
                .chars()
                .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'));
        if invalid {
            return Err("La subcarpeta no es válida".to_string());
        }
    }
    Ok(parts)
}

fn create_markdown_at(
    folder: &Path,
    title: &str,
    options: NewPageOptions,
) -> Result<CreatedMarkdown, String> {
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("Abre una carpeta válida antes de crear una página".to_string());
    }
    let root = folder.canonicalize().map_err(|error| error.to_string())?;
    let (heading, file_name) = markdown_name_from_title(title)?;
    let mut target_dir = root.clone();
    if let Some(subfolder) = options.subfolder {
        for part in subfolder_components(subfolder)? {
            target_dir.push(part);
        }
        std::fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
        // Un enlace simbólico dentro de la biblioteca no debe sacar la página fuera.
        target_dir = target_dir
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !target_dir.starts_with(&root) {
            return Err("La subcarpeta no es válida".to_string());
        }
    }
    let path = target_dir.join(&file_name);
    let created = |created| CreatedMarkdown {
        file_name: file_name.clone(),
        path: path.to_string_lossy().into_owned(),
        created,
    };
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return if options.existing_ok && path.is_file() {
                Ok(created(false))
            } else {
                Err(format!("Ya existe una página llamada {file_name}"))
            };
        }
        Err(error) => return Err(error.to_string()),
    };
    let contents = options
        .contents
        .map_or_else(|| format!("# {heading}\n\n"), str::to_string);
    file.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(created(true))
}

#[tauri::command]
fn create_markdown_file(
    folder: String,
    title: String,
    contents: Option<String>,
    subfolder: Option<String>,
    existing_ok: Option<bool>,
) -> Result<CreatedMarkdown, String> {
    create_markdown_at(
        Path::new(&folder),
        &title,
        NewPageOptions {
            subfolder: subfolder.as_deref(),
            contents: contents.as_deref(),
            existing_ok: existing_ok.unwrap_or(false),
        },
    )
}

/// Ruta sin `.` ni `..` resueltos a mano (el archivo aún no existe, así que no
/// se puede canonicalizar). Devuelve `None` si intenta subir por encima de la raíz.
fn lexical_normalize(path: &Path) -> Option<PathBuf> {
    use std::path::Component;
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Some(normalized)
}

/// Guarda una imagen pegada en el editor. Nunca sobrescribe: si el nombre ya
/// existe añade `-1`, `-2`… y devuelve la ruta final escrita.
fn save_binary_at(path: &Path, bytes: &[u8], root: &Path) -> Result<PathBuf, String> {
    let invalid = || "La ruta de la imagen no es válida".to_string();
    if !path.is_absolute() || !root.is_absolute() {
        return Err(invalid());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !PASTE_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("Solo se pueden guardar imágenes PNG, JPEG, GIF, WebP o BMP".to_string());
    }
    if bytes.len() > MAX_PASTED_IMAGE_BYTES {
        return Err("La imagen supera el límite de 32 MB".to_string());
    }
    let lexical_root = lexical_normalize(root).ok_or_else(invalid)?;
    let root = root
        .canonicalize()
        .map_err(|_| "La carpeta de la biblioteca no existe".to_string())?;
    let path = lexical_normalize(path).ok_or_else(invalid)?;
    let parent = path.parent().ok_or_else(invalid)?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty() && !value.starts_with('.'))
        .ok_or_else(invalid)?;
    // Primero la comprobación léxica, para no crear carpetas fuera de la biblioteca.
    if !parent.starts_with(&lexical_root) && !parent.starts_with(&root) {
        return Err(invalid());
    }
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    // Y después la real, por si un enlace simbólico apunta fuera.
    let parent = parent.canonicalize().map_err(|error| error.to_string())?;
    if !parent.starts_with(&root) {
        return Err(invalid());
    }
    for index in 0..10_000 {
        let name = if index == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = parent.join(name);
        // Reserva el nombre con create_new para no pisar un archivo creado a la vez.
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(_) => {
                return match write_file_atomically(&candidate, bytes) {
                    Ok(()) => Ok(candidate),
                    Err(error) => {
                        let _ = std::fs::remove_file(&candidate);
                        Err(error)
                    }
                };
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("No hay un nombre libre para la imagen".to_string())
}

#[tauri::command]
fn save_binary_file(path: String, base64: String, root: String) -> Result<String, String> {
    let bytes = BASE64
        .decode(base64.as_bytes())
        .map_err(|_| "La imagen no tiene un formato válido".to_string())?;
    save_binary_at(Path::new(&path), &bytes, Path::new(&root))
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn render_markdown_text(contents: String) -> String {
    render_markdown(&contents)
}

#[tauri::command]
fn read_markdown_file(path: String, folder: Option<String>) -> Result<FilePayload, String> {
    let file_path = Path::new(&path);
    let size = std::fs::metadata(file_path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "El documento ocupa {:.1} MB; el límite seguro para texto es 32 MB",
            size as f64 / 1_048_576.0
        ));
    }
    let contents = decode_text(&std::fs::read(file_path).map_err(|error| error.to_string())?);
    let file_name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("archivo.md")
        .to_string();
    let html = render_markdown_with_context(&contents, file_path, folder.as_deref());

    Ok(FilePayload {
        file_name,
        contents,
        html,
    })
}

fn render_markdown_with_context(contents: &str, file_path: &Path, folder: Option<&str>) -> String {
    let contents = strip_frontmatter(contents);
    let contents = resolve_wiki_links(&contents, file_path, folder);
    pliego_render::render_markdown_source(&contents)
}

fn find_wiki_target(target: &str, file_path: &Path, folder: Option<&str>) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let path =
        pliego_render::find_wiki_target(target, file_path, folder, home.as_deref(), Path::is_file)?;
    path.canonicalize().ok().or(Some(path))
}

fn resolve_wiki_links(contents: &str, file_path: &Path, folder: Option<&str>) -> String {
    pliego_render::resolve_wiki_links(contents, &|target| {
        let path = find_wiki_target(target, file_path, folder)?;
        let contents = std::fs::read_to_string(&path).ok();
        let title = pliego_render::markdown_title(contents.as_deref(), &path);
        Some((path, title))
    })
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    #[test]
    fn decodes_bom_and_legacy_encodings() {
        assert_eq!(decode_text(b"\xEF\xBB\xBF# A"), "# A");
        assert_eq!(decode_text(b"caf\xe9 \x93hola\x94"), "café “hola”");
        // Un carácter UTF-8 cortado al final de una lectura parcial no cambia de codificación.
        assert_eq!(decode_text("añ".as_bytes().split_at(2).0), "a");
    }

    #[test]
    fn saves_atomically_and_keeps_tree_when_a_subfolder_fails() {
        let root = std::env::temp_dir().join(format!("pliego-save-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let file = root.join("nota.md");
        std::fs::write(&file, "antes").unwrap();
        write_file_atomically(&file, "después".as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "después");
        std::fs::write(root.join("sub/otra.md"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, root.join("sub/bucle")).unwrap();
        let tree = build_tree(&root).unwrap();
        assert_eq!(tree.iter().filter(|node| node.name == "nota.md").count(), 1);
        let leftovers = std::fs::read_dir(&root)
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn resolves_existing_wiki_links_from_open_folder() {
        let root = std::env::temp_dir().join(format!("pliego-wiki-{}", std::process::id()));
        let notes = root.join("notes");
        let models = root.join("models");
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::create_dir_all(&models).unwrap();
        let current = notes.join("course.md");
        let target = models.join("agent.md");
        std::fs::write(&current, "course").unwrap();
        std::fs::write(&target, "# Arquitectura de agentes\n").unwrap();

        let resolved = resolve_wiki_links(
            "Continuar: [[models/agent|Modelo]] y [[models/missing]]",
            &current,
            root.to_str(),
        );

        assert!(resolved.contains("[Modelo](<"));
        assert!(resolved.contains("models/agent.md>"));
        assert!(resolved.contains("[[models/missing]]"));

        let titled = resolve_wiki_links("Continuar: [[models/agent]]", &current, root.to_str());
        assert!(titled.contains("[Arquitectura de agentes](<"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolves_from_current_file_before_selected_folder_root() {
        let root = std::env::temp_dir().join(format!("pliego-priority-{}", std::process::id()));
        let section = root.join("section");
        std::fs::create_dir_all(&section).unwrap();
        let current = section.join("current.md");
        let local = section.join("note.md");
        let root_note = root.join("note.md");
        std::fs::write(&current, "actual").unwrap();
        std::fs::write(&local, "# Nota local").unwrap();
        std::fs::write(&root_note, "# Nota raiz").unwrap();

        let resolved = resolve_wiki_links("[[note]]", &current, root.to_str());
        assert!(resolved.contains("[Nota local](<"));
        assert!(resolved.contains("section/note.md>"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn leaves_wiki_syntax_untouched_inside_fenced_code() {
        let rendered =
            resolve_wiki_links("```md\n[[note]]\n```\n", Path::new("/tmp/current.md"), None);
        assert_eq!(rendered, "```md\n[[note]]\n```\n");
    }

    #[test]
    fn indexes_visual_documents_and_markdown_references() {
        let root = std::env::temp_dir().join(format!("pliego-index-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("home.md"), "# Inicio\n[[notes/target]]").unwrap();
        std::fs::write(root.join("data.csv"), "name,value\nuno,1").unwrap();
        std::fs::write(root.join("book.epub"), b"fake epub").unwrap();
        std::fs::write(root.join("ignored.zip"), b"ignored").unwrap();

        let mut entries = Vec::new();
        collect_document_index(&root, &mut entries).unwrap();

        assert_eq!(entries.len(), 3);
        let markdown = entries
            .iter()
            .find(|entry| entry.kind == "markdown")
            .unwrap();
        assert_eq!(markdown.references, vec!["notes/target"]);
        assert!(entries.iter().any(|entry| entry.kind == "table"));
        assert!(entries.iter().any(|entry| entry.kind == "epub"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reports_missing_library_errors_instead_of_returning_empty_results() {
        let missing = std::env::temp_dir().join(format!("pliego-missing-{}", std::process::id()));
        assert!(!missing.exists());
        assert!(list_markdown_tree(missing.to_string_lossy().into_owned()).is_err());
        assert!(list_document_index(missing.to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn creates_a_new_markdown_page_without_overwriting() {
        let root = std::env::temp_dir().join(format!("pliego-create-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let created =
            create_markdown_at(&root, "Idea del proyecto.md", NewPageOptions::default()).unwrap();
        assert_eq!(created.file_name, "Idea del proyecto.md");
        assert_eq!(
            std::fs::read_to_string(&created.path).unwrap(),
            "# Idea del proyecto\n\n"
        );
        assert!(create_markdown_at(&root, "Idea del proyecto", NewPageOptions::default()).is_err());
        assert_eq!(
            std::fs::read_to_string(&created.path).unwrap(),
            "# Idea del proyecto\n\n"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_pages_with_contents_in_a_validated_subfolder() {
        let root = std::env::temp_dir().join(format!("pliego-daily-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let options = || NewPageOptions {
            subfolder: Some("Diario"),
            contents: Some("# 2026-11-18\n\nHoy\n"),
            existing_ok: true,
        };
        let created = create_markdown_at(&root, "2026-11-18", options()).unwrap();
        assert!(created.created);
        assert!(created.path.ends_with("2026-11-18.md"));
        assert!(Path::new(&created.path)
            .parent()
            .unwrap()
            .ends_with("Diario"));
        assert_eq!(
            std::fs::read_to_string(&created.path).unwrap(),
            "# 2026-11-18\n\nHoy\n"
        );
        // La segunda vez solo se devuelve la existente, sin tocar su contenido.
        std::fs::write(&created.path, "editada").unwrap();
        let again = create_markdown_at(&root, "2026-11-18", options()).unwrap();
        assert!(!again.created);
        assert_eq!(again.path, created.path);
        assert_eq!(std::fs::read_to_string(&created.path).unwrap(), "editada");
        for bad in ["../fuera", "/abs", "a/../../b", ".oculta", "a:b", "x/./y"] {
            let options = NewPageOptions {
                subfolder: Some(bad),
                ..NewPageOptions::default()
            };
            assert!(create_markdown_at(&root, "Nota", options).is_err(), "{bad}");
        }
        assert!(!root.parent().unwrap().join("fuera").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saves_pasted_images_only_inside_the_library() {
        let base = std::env::temp_dir().join(format!("pliego-paste-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("biblioteca");
        std::fs::create_dir_all(root.join("notas")).unwrap();
        let wanted = root.join("notas/assets/pegado-20261118-101500.png");
        let first = save_binary_at(&wanted, b"png", &root).unwrap();
        assert!(first.ends_with("notas/assets/pegado-20261118-101500.png"));
        assert_eq!(std::fs::read(&first).unwrap(), b"png");
        // Mismo nombre: no se pisa, se numera.
        let second = save_binary_at(&wanted, b"otra", &root).unwrap();
        assert!(second.ends_with("pegado-20261118-101500-1.png"));
        assert_eq!(std::fs::read(&first).unwrap(), b"png");

        let outside = root.join("notas/../../fuera/x.png");
        assert!(save_binary_at(&outside, b"x", &root).is_err());
        assert!(!base.join("fuera").exists());
        assert!(save_binary_at(&base.join("otra/x.png"), b"x", &root).is_err());
        assert!(save_binary_at(&root.join("notas/x.svg"), b"<svg/>", &root).is_err());
        assert!(save_binary_at(&root.join("notas/x.md"), b"# x", &root).is_err());
        assert!(save_binary_at(Path::new("relativa/x.png"), b"x", &root).is_err());
        #[cfg(unix)]
        {
            std::fs::create_dir_all(base.join("secreta")).unwrap();
            std::os::unix::fs::symlink(base.join("secreta"), root.join("enlace")).unwrap();
            assert!(save_binary_at(&root.join("enlace/x.png"), b"x", &root).is_err());
            assert_eq!(std::fs::read_dir(base.join("secreta")).unwrap().count(), 0);
        }
        assert!(save_binary_file(
            wanted.to_string_lossy().into_owned(),
            "no es base64!".to_string(),
            root.to_string_lossy().into_owned()
        )
        .is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_unsafe_or_reserved_page_titles() {
        assert!(markdown_name_from_title("../secreto").is_err());
        assert!(markdown_name_from_title("carpeta/nota").is_err());
        assert!(markdown_name_from_title("CON").is_err());
        assert!(markdown_name_from_title("   ").is_err());
        assert_eq!(
            markdown_name_from_title("Plan 1.3").unwrap().1,
            "Plan 1.3.md"
        );
    }

    #[test]
    fn collects_supported_launch_files_and_ignores_other_arguments() {
        let root = std::env::temp_dir().join(format!("pliego-launch-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let markdown = root.join("nota.md");
        let pdf = root.join("informe.pdf");
        let unsupported = root.join("archivo.zip");
        std::fs::write(&markdown, "# Nota").unwrap();
        std::fs::write(&pdf, b"fake pdf").unwrap();
        std::fs::write(&unsupported, b"fake zip").unwrap();

        let paths = launch_paths_from_args([
            OsString::from("pliego"),
            OsString::from("--flag"),
            markdown.as_os_str().to_owned(),
            unsupported.as_os_str().to_owned(),
            pdf.as_os_str().to_owned(),
            markdown.as_os_str().to_owned(),
        ]);

        assert_eq!(paths.len(), 2);
        assert!(paths.iter().any(|path| path.ends_with("nota.md")));
        assert!(paths.iter().any(|path| path.ends_with("informe.pdf")));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(codex::CodexManager::default())
        .manage(PendingOpenPaths::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        inbox::handle_shortcut(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let inbox_state =
                inbox::InboxState::initialize(app.handle()).map_err(std::io::Error::other)?;
            app.manage(inbox_state);
            if let Err(error) = inbox::register_configured_shortcut(app.handle()) {
                eprintln!("Pliego Inbox: {error}");
            }
            Ok(())
        })
        .manage(package_update::PackageUpdateState::default())
        .invoke_handler(tauri::generate_handler![
            package_update::package_update_check,
            package_update::package_update_download,
            package_update::package_update_install,
            get_launch_paths,
            read_markdown_file,
            render_markdown_text,
            list_markdown_tree,
            list_document_index,
            read_binary_document,
            open_file_in_folder,
            save_markdown_file,
            create_markdown_file,
            save_binary_file,
            inbox::inbox_get_config,
            inbox::inbox_set_folder,
            inbox::inbox_set_shortcut,
            inbox::inbox_capture_text,
            inbox::inbox_capture_url,
            inbox::inbox_capture_clipboard,
            inbox::inbox_import_files,
            inbox::inbox_list,
            inbox::inbox_read_preview,
            inbox::inbox_rename,
            inbox::inbox_archive,
            inbox::inbox_move,
            inbox::inbox_delete,
            codex::codex_status,
            codex::codex_models,
            codex::codex_open_context,
            codex::codex_set_writable,
            codex::codex_send_turn,
            codex::codex_interrupt,
            codex::codex_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(&event, tauri::RunEvent::Exit) {
                let manager = app.state::<codex::CodexManager>();
                let _ = codex::stop_runtime(&manager);
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_file() && is_document(path))
                    .filter_map(|path| path.canonicalize().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    let pending = app.state::<PendingOpenPaths>();
                    pending
                        .0
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .extend(paths.clone());
                    let _ = app.emit("open-files", &paths);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}

// build: resaltador + acento
// rebuild resaltador v2
