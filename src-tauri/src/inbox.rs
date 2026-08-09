use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Space";
const ARCHIVE_DIR: &str = ".archive";
const MAX_PREVIEW_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfig {
    pub folder: String,
    pub shortcut: String,
}

pub struct InboxState {
    config_path: PathBuf,
    config: Mutex<InboxConfig>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxPreview {
    pub contents: Option<String>,
    pub truncated: bool,
}

impl InboxState {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("No se pudo resolver la configuración: {error}"))?;
        fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
        let config_path = config_dir.join("inbox.json");
        let config = load_config(&config_path).unwrap_or_else(|| InboxConfig {
            folder: String::new(),
            shortcut: DEFAULT_SHORTCUT.to_string(),
        });
        if !config.folder.is_empty() {
            ensure_inbox_root(Path::new(&config.folder))?;
        }
        persist_config(&config_path, &config)?;
        Ok(Self {
            config_path,
            config: Mutex::new(config),
        })
    }

    fn snapshot(&self) -> Result<InboxConfig, String> {
        self.config
            .lock()
            .map(|config| config.clone())
            .map_err(|_| "La configuración del Inbox no está disponible".to_string())
    }

    fn replace(&self, config: InboxConfig) -> Result<(), String> {
        persist_config(&self.config_path, &config)?;
        let mut current = self
            .config
            .lock()
            .map_err(|_| "La configuración del Inbox no está disponible".to_string())?;
        *current = config;
        Ok(())
    }
}

fn load_config(path: &Path) -> Option<InboxConfig> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn persist_config(path: &Path, config: &InboxConfig) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn ensure_inbox_root(root: &Path) -> Result<PathBuf, String> {
    if !root.is_absolute() {
        return Err("La carpeta del Inbox debe usar una ruta absoluta".to_string());
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    root.canonicalize().map_err(|error| error.to_string())
}

fn safe_item_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Nombre de elemento inválido".to_string());
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || path.components().count() != 1
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("El nombre no puede contener rutas".to_string());
    }
    Ok(trimmed)
}

fn sanitize_stem(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut last_was_separator = false;
    for ch in value.trim().chars() {
        let allowed = ch.is_alphanumeric() || matches!(ch, '-' | '_');
        if allowed {
            output.push(ch);
            last_was_separator = false;
        } else if !last_was_separator && !output.is_empty() {
            output.push('-');
            last_was_separator = true;
        }
        if output.chars().count() >= 80 {
            break;
        }
    }
    let clean = output.trim_matches('-');
    if clean.is_empty() {
        "captura".to_string()
    } else {
        clean.to_string()
    }
}

fn unique_destination(root: &Path, stem: &str, extension: Option<&str>) -> PathBuf {
    let stem = sanitize_stem(stem);
    for index in 0..10_000_u32 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let file_name = match extension.filter(|value| !value.is_empty()) {
            Some(extension) => format!("{stem}{suffix}.{extension}"),
            None => format!("{stem}{suffix}"),
        };
        let candidate = root.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    root.join(format!("{}-{}", stem, std::process::id()))
}

fn resolve_existing_item(root: &Path, name: &str) -> Result<PathBuf, String> {
    let root = ensure_inbox_root(root)?;
    let name = safe_item_name(name)?;
    let candidate = root.join(name);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "El elemento del Inbox no existe".to_string())?;
    if canonical.parent() != Some(root.as_path()) {
        return Err("El elemento está fuera del Inbox".to_string());
    }
    Ok(canonical)
}

fn root_from_state(state: &InboxState) -> Result<PathBuf, String> {
    let folder = state.snapshot()?.folder;
    if folder.is_empty() {
        return Err("Elige primero una carpeta para el Inbox".to_string());
    }
    ensure_inbox_root(Path::new(&folder))
}

fn is_text_preview(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some(
            "md" | "txt"
                | "csv"
                | "tsv"
                | "json"
                | "toml"
                | "yaml"
                | "yml"
                | "html"
                | "css"
                | "js"
                | "ts"
                | "rs"
                | "py"
        )
    )
}

fn write_capture(root: &Path, title: Option<&str>, contents: &str) -> Result<InboxItem, String> {
    if contents.trim().is_empty() {
        return Err("La captura está vacía".to_string());
    }
    let timestamp = Local::now().format("%Y-%m-%d %H%M%S").to_string();
    let stem = title
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("{timestamp} {}", sanitize_stem(value)))
        .unwrap_or(timestamp);
    let destination = unique_destination(root, &stem, Some("md"));
    fs::write(&destination, contents).map_err(|error| error.to_string())?;
    item_from_path(&destination)
}

fn item_from_path(path: &Path) -> Result<InboxItem, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    Ok(InboxItem {
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().into_owned(),
        is_dir: metadata.is_dir(),
        size: metadata.len(),
        modified_ms,
    })
}

#[tauri::command]
pub fn inbox_get_config(state: State<'_, InboxState>) -> Result<InboxConfig, String> {
    state.snapshot()
}

#[tauri::command]
pub fn inbox_set_folder(
    folder: String,
    state: State<'_, InboxState>,
) -> Result<InboxConfig, String> {
    let root = ensure_inbox_root(Path::new(&folder))?;
    let mut config = state.snapshot()?;
    config.folder = root.to_string_lossy().into_owned();
    state.replace(config.clone())?;
    Ok(config)
}

#[tauri::command]
pub fn inbox_set_shortcut(
    shortcut: String,
    app: AppHandle,
    state: State<'_, InboxState>,
) -> Result<InboxConfig, String> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() || shortcut.len() > 80 {
        return Err("Atajo global inválido".to_string());
    }
    let mut config = state.snapshot()?;
    // The configured shortcut may belong to another running Pliego instance.
    // A missing local registration must not prevent the user from choosing a new one.
    let _ = app.global_shortcut().unregister(config.shortcut.as_str());
    if let Err(error) = app.global_shortcut().register(shortcut) {
        let _ = app.global_shortcut().register(config.shortcut.as_str());
        return Err(format!("No se pudo registrar el atajo: {error}"));
    }
    config.shortcut = shortcut.to_string();
    state.replace(config.clone())?;
    Ok(config)
}

#[tauri::command]
pub fn inbox_capture_text(
    contents: String,
    title: Option<String>,
    state: State<'_, InboxState>,
) -> Result<InboxItem, String> {
    write_capture(&root_from_state(&state)?, title.as_deref(), &contents)
}

#[tauri::command]
pub fn inbox_capture_url(
    url: String,
    title: Option<String>,
    state: State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("La URL debe comenzar por http:// o https://".to_string());
    }
    let label = title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(url);
    let body = format!("# {label}\n\nFuente: [{url}]({url})\n");
    write_capture(
        &root_from_state(&state)?,
        title.as_deref().or(Some("enlace")),
        &body,
    )
}

#[tauri::command]
pub fn inbox_capture_clipboard(
    title: Option<String>,
    app: AppHandle,
    state: State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let contents = app
        .clipboard()
        .read_text()
        .map_err(|error| error.to_string())?;
    write_capture(&root_from_state(&state)?, title.as_deref(), &contents)
}

#[tauri::command]
pub fn inbox_import_files(
    paths: Vec<String>,
    state: State<'_, InboxState>,
) -> Result<Vec<InboxItem>, String> {
    let root = root_from_state(&state)?;
    let mut imported = Vec::new();
    for source in paths {
        let source = PathBuf::from(source);
        if !source.is_absolute() || !source.is_file() {
            return Err(format!("No es un archivo válido: {}", source.display()));
        }
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("archivo");
        let extension = source.extension().and_then(|value| value.to_str());
        let destination = unique_destination(&root, stem, extension);
        fs::copy(&source, &destination).map_err(|error| error.to_string())?;
        imported.push(item_from_path(&destination)?);
    }
    Ok(imported)
}

#[tauri::command]
pub fn inbox_list(state: State<'_, InboxState>) -> Result<Vec<InboxItem>, String> {
    let root = root_from_state(&state)?;
    let mut items = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != ARCHIVE_DIR)
        .filter_map(|entry| item_from_path(&entry.path()).ok())
        .collect::<Vec<_>>();
    items.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(items)
}

#[tauri::command]
pub fn inbox_read_preview(
    name: String,
    state: State<'_, InboxState>,
) -> Result<InboxPreview, String> {
    let root = root_from_state(&state)?;
    let path = resolve_existing_item(&root, &name)?;
    if !path.is_file() || !is_text_preview(&path) {
        return Ok(InboxPreview {
            contents: None,
            truncated: false,
        });
    }
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    let mut bytes = Vec::with_capacity(size.min(MAX_PREVIEW_BYTES) as usize);
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(MAX_PREVIEW_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(InboxPreview {
        contents: Some(String::from_utf8_lossy(&bytes).into_owned()),
        truncated: size > MAX_PREVIEW_BYTES,
    })
}

#[tauri::command]
pub fn inbox_rename(
    name: String,
    new_name: String,
    state: State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let root = root_from_state(&state)?;
    let source = resolve_existing_item(&root, &name)?;
    let new_name = safe_item_name(&new_name)?;
    let destination = root.join(new_name);
    if destination.exists() {
        return Err("Ya existe un elemento con ese nombre".to_string());
    }
    fs::rename(source, &destination).map_err(|error| error.to_string())?;
    item_from_path(&destination)
}

#[tauri::command]
pub fn inbox_archive(name: String, state: State<'_, InboxState>) -> Result<InboxItem, String> {
    let root = root_from_state(&state)?;
    let source = resolve_existing_item(&root, &name)?;
    let archive = root.join(ARCHIVE_DIR);
    fs::create_dir_all(&archive).map_err(|error| error.to_string())?;
    let destination = unique_destination(
        &archive,
        source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("archivo"),
        source.extension().and_then(|value| value.to_str()),
    );
    fs::rename(source, &destination).map_err(|error| error.to_string())?;
    item_from_path(&destination)
}

#[tauri::command]
pub fn inbox_move(
    name: String,
    destination_folder: String,
    state: State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let root = root_from_state(&state)?;
    let source = resolve_existing_item(&root, &name)?;
    let destination_folder = PathBuf::from(destination_folder);
    if !destination_folder.is_absolute() || !destination_folder.is_dir() {
        return Err("La carpeta de destino no es válida".to_string());
    }
    let destination_folder = destination_folder
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let destination = unique_destination(
        &destination_folder,
        source
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("archivo"),
        source.extension().and_then(|value| value.to_str()),
    );
    match fs::rename(&source, &destination) {
        Ok(()) => {}
        Err(_) => {
            fs::copy(&source, &destination).map_err(|error| error.to_string())?;
            fs::remove_file(&source).map_err(|error| error.to_string())?;
        }
    }
    item_from_path(&destination)
}

#[tauri::command]
pub fn inbox_delete(name: String, state: State<'_, InboxState>) -> Result<(), String> {
    let root = root_from_state(&state)?;
    let target = resolve_existing_item(&root, &name)?;
    if target.is_dir() {
        return Err("El Inbox no elimina carpetas".to_string());
    }
    fs::remove_file(target).map_err(|error| error.to_string())
}

pub fn register_configured_shortcut(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<InboxState>();
    let shortcut = state.snapshot()?.shortcut;
    app.global_shortcut()
        .register(shortcut.as_str())
        .map_err(|error| format!("No se pudo registrar {shortcut}: {error}"))
}

pub fn handle_shortcut(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("pliego://open-inbox-capture", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pliego-inbox-{label}-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn rejects_traversal_and_absolute_item_names() {
        assert!(safe_item_name("../secret.md").is_err());
        assert!(safe_item_name("folder/note.md").is_err());
        assert!(safe_item_name("/tmp/note.md").is_err());
        assert_eq!(safe_item_name("note.md").unwrap(), "note.md");
    }

    #[test]
    fn captures_use_sanitized_unique_names() {
        let root = temp_root("capture");
        let first = write_capture(&root, Some("Idea / peligrosa"), "uno").unwrap();
        let second = write_capture(&root, Some("Idea / peligrosa"), "dos").unwrap();
        assert_ne!(first.name, second.name);
        assert!(!first.name.contains('/'));
        assert_eq!(fs::read_to_string(first.path).unwrap(), "uno");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolved_items_cannot_escape_through_symlinks() {
        let root = temp_root("escape");
        let outside = temp_root("outside").join("outside.md");
        fs::write(&outside, "secret").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("link.md")).unwrap();
            assert!(resolve_existing_item(&root, "link.md").is_err());
        }
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside.parent().unwrap()).unwrap();
    }

    #[test]
    fn archive_moves_item_out_of_pending_root() {
        let root = temp_root("archive");
        let source = root.join("note.md");
        fs::write(&source, "content").unwrap();
        let archive = root.join(ARCHIVE_DIR);
        fs::create_dir_all(&archive).unwrap();
        let destination = unique_destination(&archive, "note", Some("md"));
        fs::rename(&source, &destination).unwrap();
        assert!(!source.exists());
        assert!(destination.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn previews_only_supported_text_files_with_a_size_limit() {
        let root = temp_root("preview");
        let text = root.join("note.md");
        let binary = root.join("image.png");
        fs::write(&text, "contenido").unwrap();
        fs::write(&binary, [0, 159, 146, 150]).unwrap();
        assert!(is_text_preview(&text));
        assert!(!is_text_preview(&binary));
        assert_eq!(MAX_PREVIEW_BYTES, 256 * 1024);
        fs::remove_dir_all(root).unwrap();
    }
}
