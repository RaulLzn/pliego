use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pulldown_cmark::{html, Options, Parser};
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
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "mdown" | "mkd" | "txt")
    )
}

fn document_kind(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "md" | "markdown" | "mdown" | "mkd" => Some("markdown"),
        "txt" => Some("text"),
        "csv" | "tsv" => Some("table"),
        "pdf" => Some("pdf"),
        "docx" => Some("docx"),
        "epub" => Some("epub"),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" => Some("image"),
        "mmd" | "mermaid" => Some("mermaid"),
        _ => None,
    }
}

fn is_document(path: &Path) -> bool {
    document_kind(path).is_some()
}

fn build_tree(dir: &Path) -> Vec<TreeNode> {
    let mut nodes = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return nodes;
    };

    let mut items: Vec<_> = entries.flatten().collect();
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
            let children = build_tree(&path);
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

    nodes
}

#[tauri::command]
fn list_markdown_tree(dir: String) -> Vec<TreeNode> {
    build_tree(Path::new(&dir))
}

fn markdown_references(contents: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut rest = contents;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let target = after[..end]
            .split('|')
            .next()
            .unwrap_or("")
            .split('#')
            .next()
            .unwrap_or("")
            .trim();
        if !target.is_empty() {
            refs.push(target.to_string());
        }
        rest = &after[end + 2..];
    }
    let mut cursor = contents;
    while let Some(start) = cursor.find("](") {
        let after = &cursor[start + 2..];
        let Some(end) = after.find(')') else { break };
        let target = after[..end]
            .trim()
            .trim_matches(['<', '>'])
            .split('#')
            .next()
            .unwrap_or("")
            .trim();
        if !target.is_empty() && !target.contains("://") && is_markdown(Path::new(target)) {
            refs.push(target.trim_end_matches(".md").to_string());
        }
        cursor = &after[end + 1..];
    }
    refs.sort();
    refs.dedup();
    refs
}

fn collect_document_index(dir: &Path, entries: &mut Vec<DocumentIndexEntry>) {
    let Ok(children) = std::fs::read_dir(dir) else {
        return;
    };
    for child in children.flatten() {
        let path = child.path();
        if child.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_document_index(&path, entries);
            continue;
        }
        let Some(kind) = document_kind(&path) else {
            continue;
        };
        let contents = if matches!(kind, "markdown" | "text" | "table" | "mermaid") {
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
}

fn read_text_prefix(path: &Path, limit: u64) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
fn list_document_index(dir: String) -> Vec<DocumentIndexEntry> {
    let mut entries = Vec::new();
    collect_document_index(Path::new(&dir), &mut entries);
    entries.sort_by(|a, b| {
        a.path
            .to_ascii_lowercase()
            .cmp(&b.path.to_ascii_lowercase())
    });
    entries
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

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("No se pudo abrir el explorador de archivos: {error}"))
}

#[tauri::command]
fn save_markdown_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

fn markdown_name_from_title(title: &str) -> Result<(String, String), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Escribe un título para la página".to_string());
    }
    if title.chars().count() > 120 {
        return Err("El título no puede superar 120 caracteres".to_string());
    }
    if title.chars().any(|ch| {
        ch.is_control() || matches!(ch, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
    }) {
        return Err("El título contiene caracteres no permitidos".to_string());
    }
    let lowercase = title.to_ascii_lowercase();
    let clean_title = [".markdown", ".mdown", ".mkd", ".md"]
        .iter()
        .find_map(|extension| {
            lowercase
                .strip_suffix(extension)
                .map(|_| &title[..title.len() - extension.len()])
        })
        .unwrap_or(title)
        .trim()
        .trim_end_matches('.')
        .trim();
    if clean_title.is_empty() || matches!(clean_title, "." | "..") {
        return Err("El título no produce un nombre de archivo válido".to_string());
    }
    let reserved = clean_title.to_ascii_uppercase();
    let reserved = reserved.split('.').next().unwrap_or_default();
    if matches!(reserved, "CON" | "PRN" | "AUX" | "NUL")
        || (reserved.len() == 4
            && (reserved.starts_with("COM") || reserved.starts_with("LPT"))
            && reserved.as_bytes()[3].is_ascii_digit())
    {
        return Err("Ese nombre está reservado por el sistema".to_string());
    }
    Ok((clean_title.to_string(), format!("{clean_title}.md")))
}

fn create_markdown_at(folder: &Path, title: &str) -> Result<CreatedMarkdown, String> {
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("Abre una carpeta válida antes de crear una página".to_string());
    }
    let root = folder.canonicalize().map_err(|error| error.to_string())?;
    let (heading, file_name) = markdown_name_from_title(title)?;
    let path = root.join(&file_name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!("Ya existe una página llamada {file_name}")
            } else {
                error.to_string()
            }
        })?;
    file.write_all(format!("# {heading}\n\n").as_bytes())
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(CreatedMarkdown {
        file_name,
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn create_markdown_file(folder: String, title: String) -> Result<CreatedMarkdown, String> {
    create_markdown_at(Path::new(&folder), &title)
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
    let contents = std::fs::read_to_string(file_path).map_err(|error| error.to_string())?;
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

fn strip_frontmatter(contents: &str) -> String {
    let mut lines = contents.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return contents.to_string();
    }

    let mut consumed = 1;
    for line in lines {
        consumed += 1;
        if line.trim_end() == "---" {
            return contents
                .lines()
                .skip(consumed)
                .collect::<Vec<_>>()
                .join("\n");
        }
    }
    contents.to_string()
}

fn render_markdown(contents: &str) -> String {
    render_markdown_source(&strip_frontmatter(contents))
}

fn render_markdown_with_context(contents: &str, file_path: &Path, folder: Option<&str>) -> String {
    let contents = strip_frontmatter(contents);
    let contents = resolve_wiki_links(&contents, file_path, folder);
    render_markdown_source(&contents)
}

fn render_markdown_source(contents: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

    let parser = Parser::new_ext(contents, options);
    let mut output = String::new();
    html::push_html(&mut output, parser);
    output
}

fn resolve_wiki_links(contents: &str, file_path: &Path, folder: Option<&str>) -> String {
    let mut output = String::with_capacity(contents.len());
    let mut in_fence = false;

    for line in contents.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            output.push_str(line);
        } else if in_fence {
            output.push_str(line);
        } else {
            output.push_str(&resolve_wiki_links_in_line(line, file_path, folder));
        }
    }

    output
}

fn resolve_wiki_links_in_line(line: &str, file_path: &Path, folder: Option<&str>) -> String {
    let mut output = String::with_capacity(line.len());
    let mut rest = line;

    while let Some(start) = rest.find("[[") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find("]]") else {
            output.push_str(&rest[start..]);
            return output;
        };

        let expression = &after_start[..end];
        let (target_with_anchor, explicit_label) = expression
            .split_once('|')
            .map(|(target, label)| (target.trim(), Some(label.trim())))
            .unwrap_or_else(|| (expression.trim(), None));
        let (target, anchor) = target_with_anchor
            .split_once('#')
            .map(|(target, anchor)| (target.trim(), Some(anchor.trim())))
            .unwrap_or((target_with_anchor, None));

        if let Some(path) = find_wiki_target(target, file_path, folder) {
            let label = explicit_label
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| markdown_title(&path));
            let mut destination = path.to_string_lossy().replace('\\', "/");
            if let Some(anchor) = anchor.filter(|value| !value.is_empty()) {
                destination.push('#');
                destination.push_str(anchor);
            }
            output.push('[');
            output.push_str(&escape_markdown_label(&label));
            output.push_str("](<");
            output.push_str(&destination.replace('>', "%3E"));
            output.push_str(">)");
        } else {
            output.push_str("[[");
            output.push_str(expression);
            output.push_str("]]");
        }

        rest = &after_start[end + 2..];
    }

    output.push_str(rest);
    output
}

fn markdown_title(path: &Path) -> String {
    if let Ok(contents) = std::fs::read_to_string(path) {
        let body = strip_frontmatter(&contents);
        if let Some(title) = body.lines().find_map(|line| {
            let trimmed = line.trim_start();
            let heading = trimmed.strip_prefix('#')?.trim_start_matches('#').trim();
            (!heading.is_empty()).then(|| heading.trim_end_matches('#').trim().to_string())
        }) {
            return title;
        }
    }

    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Documento")
        .replace(['-', '_'], " ")
}

fn find_wiki_target(target: &str, file_path: &Path, folder: Option<&str>) -> Option<PathBuf> {
    if target.is_empty() || target.contains("://") {
        return None;
    }

    let expanded = if target == "~" {
        std::env::var_os("HOME").map(PathBuf::from)?
    } else if let Some(relative) = target.strip_prefix("~/") {
        std::env::var_os("HOME").map(PathBuf::from)?.join(relative)
    } else {
        PathBuf::from(target)
    };

    let mut bases = Vec::new();
    if expanded.is_absolute() {
        bases.push(expanded);
    } else {
        if let Some(parent) = file_path.parent() {
            bases.push(parent.join(&expanded));
        }
        if let Some(folder) = folder.filter(|value| !value.is_empty()) {
            bases.push(Path::new(folder).join(&expanded));
        }
        if let Some(home) = std::env::var_os("HOME") {
            bases.push(PathBuf::from(home).join(&expanded));
        }
    }

    for candidate in bases {
        let variants = if candidate.extension().is_some() {
            vec![candidate]
        } else {
            vec![candidate.clone(), candidate.with_extension("md")]
        };
        for variant in variants {
            if variant.is_file() && is_markdown(&variant) {
                return variant.canonicalize().ok().or(Some(variant));
            }
        }
    }
    None
}

fn escape_markdown_label(label: &str) -> String {
    label
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

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
        collect_document_index(&root, &mut entries);

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
    fn creates_a_new_markdown_page_without_overwriting() {
        let root = std::env::temp_dir().join(format!("pliego-create-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let created = create_markdown_at(&root, "Idea del proyecto.md").unwrap();
        assert_eq!(created.file_name, "Idea del proyecto.md");
        assert_eq!(
            std::fs::read_to_string(&created.path).unwrap(),
            "# Idea del proyecto\n\n"
        );
        assert!(create_markdown_at(&root, "Idea del proyecto").is_err());
        assert_eq!(
            std::fs::read_to_string(&created.path).unwrap(),
            "# Idea del proyecto\n\n"
        );
        std::fs::remove_dir_all(root).unwrap();
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
        .invoke_handler(tauri::generate_handler![
            get_launch_paths,
            read_markdown_file,
            render_markdown_text,
            list_markdown_tree,
            list_document_index,
            read_binary_document,
            open_file_in_folder,
            save_markdown_file,
            create_markdown_file,
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
