use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const PROTOCOL_ADAPTER: &str = "codex-app-server-v2-0.144";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStatus {
    available: bool,
    connected: bool,
    authenticated: bool,
    version: Option<String>,
    account: Option<String>,
    adapter: &'static str,
    message: String,
}

#[derive(Clone)]
struct MarkdownScope {
    root: PathBuf,
    kind: ScopeKind,
    writable: bool,
    related: HashSet<PathBuf>,
}

#[derive(Clone, Copy, PartialEq)]
enum ScopeKind {
    Document,
    Folder,
}

struct Runtime {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    scopes: Mutex<HashMap<String, MarkdownScope>>,
    scope_order: Mutex<VecDeque<String>>,
    turns: Mutex<HashMap<String, String>>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

impl Runtime {
    fn send(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err("Codex App Server no está conectado".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(lock_error)?.insert(id, tx);
        let message = json!({"id": id, "method": method, "params": params});
        let write_result = self.stdin.lock().map_err(lock_error).and_then(|mut input| {
            writeln!(input, "{message}").map_err(|error| error.to_string())?;
            input.flush().map_err(|error| error.to_string())
        });
        if let Err(error) = write_result {
            self.pending.lock().map_err(lock_error)?.remove(&id);
            return Err(error);
        }
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(result) => result,
            Err(_) => {
                self.pending.lock().map_err(lock_error)?.remove(&id);
                Err(format!("Codex no respondió a {method}"))
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let message = json!({"method": method, "params": params});
        let mut input = self.stdin.lock().map_err(lock_error)?;
        writeln!(input, "{message}").map_err(|error| error.to_string())?;
        input.flush().map_err(|error| error.to_string())
    }
}

pub struct CodexManager {
    runtime: Mutex<Option<Arc<Runtime>>>,
    status: Mutex<CodexStatus>,
}

impl Default for CodexManager {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(None),
            status: Mutex::new(CodexStatus {
                available: false,
                connected: false,
                authenticated: false,
                version: None,
                account: None,
                adapter: PROTOCOL_ADAPTER,
                message: "Codex aún no se ha iniciado".into(),
            }),
        }
    }
}

impl CodexManager {
    fn ensure(&self, app: &AppHandle) -> Result<Arc<Runtime>, String> {
        if let Some(runtime) = self.runtime.lock().map_err(lock_error)?.as_ref() {
            if runtime.alive.load(Ordering::SeqCst) {
                return Ok(runtime.clone());
            }
        }

        let codex = find_codex()?;
        let version_output = Command::new(&codex)
            .arg("--version")
            .output()
            .map_err(|_| {
                "No encontré Codex CLI. Instala @openai/codex y ejecuta codex login".to_string()
            })?;
        if !version_output.status.success() {
            return Err("No pude ejecutar codex --version".into());
        }
        let version = String::from_utf8_lossy(&version_output.stdout)
            .trim()
            .to_string();
        let mut child = Command::new(&codex)
            .args([
                "app-server",
                "--stdio",
                "-c",
                "features.shell_tool=false",
                "-c",
                "features.unified_exec=false",
                "-c",
                "features.apps=false",
                "-c",
                "features.plugins=false",
                "-c",
                "features.multi_agent=false",
                "-c",
                "features.image_generation=false",
                "-c",
                "features.browser_use=false",
                "-c",
                "features.computer_use=false",
                "-c",
                "mcp_servers={}",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("No pude iniciar codex app-server: {error}"))?;
        let stdin = child.stdin.take().ok_or("Codex no expuso stdin")?;
        let stdout = child.stdout.take().ok_or("Codex no expuso stdout")?;
        let stderr = child.stderr.take().ok_or("Codex no expuso stderr")?;
        let runtime = Arc::new(Runtime {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            scopes: Mutex::new(HashMap::new()),
            scope_order: Mutex::new(VecDeque::new()),
            turns: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        spawn_stdout_reader(runtime.clone(), stdout, app.clone());
        spawn_stderr_reader(stderr, app.clone());

        runtime.send(
            "initialize",
            json!({
                "clientInfo": {"name": "pliego", "title": "Pliego", "version": env!("CARGO_PKG_VERSION")},
                "capabilities": {"experimentalApi": true}
            }),
        )?;
        let _ = runtime.notify("initialized", json!({}));
        let account = runtime.send("account/read", json!({}))?;
        let account_data = account.get("account").filter(|value| !value.is_null());
        let authenticated = account_data.is_some();
        let account_name = account_data.and_then(|value| {
            value
                .get("email")
                .and_then(Value::as_str)
                .or_else(|| value.get("type").and_then(Value::as_str))
                .map(str::to_string)
        });
        let message = if authenticated {
            "Conectado con la sesión de Codex".to_string()
        } else {
            "No hay sesión válida. Ejecuta `codex login` en una terminal".to_string()
        };
        *self.status.lock().map_err(lock_error)? = CodexStatus {
            available: true,
            connected: true,
            authenticated,
            version: Some(version),
            account: account_name,
            adapter: PROTOCOL_ADAPTER,
            message,
        };
        *self.runtime.lock().map_err(lock_error)? = Some(runtime.clone());
        Ok(runtime)
    }
}

fn find_codex() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join("codex"))
            .find(|candidate| candidate.is_file())
    }) {
        return Ok(path);
    }
    if let Some(home) = std::env::var_os("HOME") {
        for relative in [".npm-global/bin/codex", ".local/bin/codex"] {
            let candidate = PathBuf::from(&home).join(relative);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err("No encontré Codex CLI. Instala @openai/codex y ejecuta codex login".into())
}

fn spawn_stdout_reader(
    runtime: Arc<Runtime>,
    stdout: impl std::io::Read + Send + 'static,
    app: AppHandle,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(id) = message.get("id").and_then(Value::as_u64) {
                if message.get("method").is_some() {
                    handle_server_request(&runtime, &app, id, &message);
                } else if let Ok(mut pending) = runtime.pending.lock() {
                    if let Some(sender) = pending.remove(&id) {
                        let result = if let Some(error) = message.get("error") {
                            Err(error
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("Error de Codex")
                                .to_string())
                        } else {
                            Ok(message.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = sender.send(result);
                    }
                }
            } else if let Some(method) = message.get("method").and_then(Value::as_str) {
                normalize_notification(
                    &runtime,
                    &app,
                    method,
                    message.get("params").cloned().unwrap_or(Value::Null),
                );
            }
        }
        runtime.alive.store(false, Ordering::SeqCst);
        if let Ok(mut pending) = runtime.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err("Codex App Server terminó inesperadamente".into()));
            }
        }
        let _ = app.emit("codex-event", json!({"type":"connection", "connected":false, "message":"Codex App Server se cerró; se reiniciará al volver a usar el chat"}));
    });
}

fn spawn_stderr_reader(stderr: impl std::io::Read + Send + 'static, app: AppHandle) {
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.contains("ERROR") || line.contains("error") {
                let _ = app.emit("codex-event", json!({"type":"diagnostic", "message":line}));
            }
        }
    });
}

fn normalize_notification(runtime: &Runtime, app: &AppHandle, method: &str, params: Value) {
    let event = match method {
        "item/agentMessage/delta" => {
            json!({"type":"delta", "delta":params.get("delta"), "turnId":params.get("turnId"), "itemId":params.get("itemId")})
        }
        "turn/started" => {
            if let (Some(thread), Some(turn)) = (
                params.get("threadId").and_then(Value::as_str),
                params
                    .get("turn")
                    .and_then(|v| v.get("id"))
                    .and_then(Value::as_str),
            ) {
                if let Ok(mut turns) = runtime.turns.lock() {
                    turns.insert(thread.into(), turn.into());
                }
            }
            json!({"type":"activity", "activity":"turnStarted", "data":params})
        }
        "turn/completed" => {
            if let Some(thread) = params.get("threadId").and_then(Value::as_str) {
                if let Ok(mut turns) = runtime.turns.lock() {
                    turns.remove(thread);
                }
            }
            json!({"type":"completed", "data":params})
        }
        "item/started" | "item/completed" => {
            json!({"type":"toolActivity", "phase":method, "data":params})
        }
        "account/rateLimits/updated" => json!({"type":"rateLimits", "data":params}),
        "error" => {
            json!({"type":"error", "message":params.get("error").and_then(|v| v.get("message")).or_else(|| params.get("message"))})
        }
        _ => return,
    };
    let _ = app.emit("codex-event", event);
}

fn handle_server_request(runtime: &Runtime, app: &AppHandle, id: u64, message: &Value) {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = if method == "item/tool/call" {
        execute_markdown_tool(runtime, &params)
    } else {
        Err(format!("Solicitud no permitida: {method}"))
    };
    let succeeded = result.is_ok();
    let response = match result {
        Ok(text) => {
            json!({"id":id,"result":{"contentItems":[{"type":"inputText","text":text}],"success":true}})
        }
        Err(error) => {
            json!({"id":id,"result":{"contentItems":[{"type":"inputText","text":error}],"success":false}})
        }
    };
    if let Ok(mut input) = runtime.stdin.lock() {
        let _ = writeln!(input, "{response}");
        let _ = input.flush();
    }
    let _ = app.emit("codex-event", json!({"type":"toolActivity", "tool":params.get("tool"), "success":response["result"]["success"]}));
    if succeeded && params.get("tool").and_then(Value::as_str) == Some("markdown_write") {
        let _ = app.emit(
            "codex-event",
            json!({"type":"fileModified", "path":params.get("arguments").and_then(|value| value.get("path"))}),
        );
    }
}

fn execute_markdown_tool(runtime: &Runtime, params: &Value) -> Result<String, String> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .ok_or("Falta threadId")?;
    let tool = params
        .get("tool")
        .and_then(Value::as_str)
        .ok_or("Falta tool")?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let scope = runtime
        .scopes
        .lock()
        .map_err(lock_error)?
        .get(thread_id)
        .cloned()
        .ok_or("El thread no tiene un contexto Markdown autorizado")?;
    match tool {
        "markdown_list" => markdown_list(&scope),
        "markdown_read" => {
            let path = authorized_path(&scope, args.get("path").and_then(Value::as_str))?;
            std::fs::read_to_string(path).map_err(|error| error.to_string())
        }
        "markdown_write" => {
            if !scope.writable {
                return Err("La interfaz está en modo Solo lectura".into());
            }
            let path = authorized_path(&scope, args.get("path").and_then(Value::as_str))?;
            let contents = args
                .get("contents")
                .and_then(Value::as_str)
                .ok_or("Falta contents")?;
            atomic_replace(&path, contents)?;
            Ok(format!(
                "Archivo actualizado: {}",
                display_path(&scope, &path)
            ))
        }
        _ => Err(format!("Herramienta no permitida: {tool}")),
    }
}

fn markdown_list(scope: &MarkdownScope) -> Result<String, String> {
    if scope.kind == ScopeKind::Document {
        let mut files = vec![display_path(scope, &scope.root)];
        files.extend(
            scope
                .related
                .iter()
                .map(|path| path.to_string_lossy().to_string()),
        );
        files.sort();
        return Ok(files.join("\n"));
    }
    let mut files = Vec::new();
    collect_markdown(&scope.root, &scope.root, &mut files)?;
    Ok(files.join("\n"))
}

fn collect_markdown(root: &Path, dir: &Path, files: &mut Vec<String>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') || path.is_symlink() {
            continue;
        }
        if path.is_dir() {
            collect_markdown(root, &path, files)?;
        } else if is_markdown(&path) {
            files.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    files.sort();
    Ok(())
}

fn authorized_path(scope: &MarkdownScope, requested: Option<&str>) -> Result<PathBuf, String> {
    let candidate = match scope.kind {
        ScopeKind::Document => {
            if let Some(requested) = requested.filter(|value| !value.is_empty()) {
                let name = scope
                    .root
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or("");
                if requested == name || Path::new(requested) == scope.root {
                    scope.root.clone()
                } else if Path::new(requested).is_absolute() {
                    PathBuf::from(requested)
                } else {
                    return Err(
                        "Ese archivo está fuera del documento y sus referencias autorizadas".into(),
                    );
                }
            } else {
                scope.root.clone()
            }
        }
        ScopeKind::Folder => {
            let requested = requested.ok_or("Falta path")?;
            if Path::new(requested).is_absolute() {
                PathBuf::from(requested)
            } else {
                scope.root.join(requested)
            }
        }
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "El archivo no existe".to_string())?;
    if !is_markdown(&canonical) || !canonical.is_file() {
        return Err("Solo se permiten archivos Markdown existentes".into());
    }
    let allowed = scope.kind == ScopeKind::Document
        && (canonical == scope.root || scope.related.contains(&canonical))
        || scope.kind == ScopeKind::Folder && canonical.starts_with(&scope.root);
    if !allowed {
        return Err("Ruta fuera del contexto Markdown autorizado".into());
    }
    Ok(canonical)
}

fn atomic_replace(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("El archivo no tiene carpeta padre")?;
    let temp = parent.join(format!(".pliego-{}.tmp", std::process::id()));
    let result = (|| {
        let permissions = std::fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        std::fs::set_permissions(&temp, permissions).map_err(|error| error.to_string())?;
        std::fs::rename(&temp, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn display_path(scope: &MarkdownScope, path: &Path) -> String {
    if scope.kind == ScopeKind::Document {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into()
    } else {
        path.strip_prefix(&scope.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown" | "mdown" | "mkd")
    )
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Estado interno bloqueado".into()
}

fn tool_specs() -> Value {
    json!([
        {"type":"function","name":"markdown_list","description":"Lista los archivos Markdown autorizados en el contexto actual.","inputSchema":{"type":"object","properties":{}}},
        {"type":"function","name":"markdown_read","description":"Lee un archivo Markdown autorizado. En contexto documento, path es opcional.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}}}},
        {"type":"function","name":"markdown_write","description":"Reemplaza el contenido completo de un Markdown existente; solo funciona cuando Pliego habilita edición.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"contents":{"type":"string"}},"required":["contents"]}}
    ])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRequest {
    path: String,
    folder: Option<String>,
    context_type: String,
    writable: bool,
    thread_id: Option<String>,
    model: Option<String>,
}

#[tauri::command]
pub fn codex_status(app: AppHandle, manager: State<CodexManager>) -> CodexStatus {
    if let Err(error) = manager.ensure(&app) {
        let mut status = manager.status.lock().unwrap_or_else(|e| e.into_inner());
        status.message = error;
    }
    manager
        .status
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
pub fn codex_models(app: AppHandle, manager: State<CodexManager>) -> Result<Value, String> {
    let runtime = manager.ensure(&app)?;
    runtime.send("model/list", json!({"limit":100,"includeHidden":false}))
}

#[tauri::command]
pub fn codex_open_context(
    app: AppHandle,
    manager: State<CodexManager>,
    request: ContextRequest,
) -> Result<Value, String> {
    let runtime = manager.ensure(&app)?;
    let root = PathBuf::from(&request.path)
        .canonicalize()
        .map_err(|_| "El contexto no existe".to_string())?;
    let kind = match request.context_type.as_str() {
        "document" if root.is_file() && is_markdown(&root) => ScopeKind::Document,
        "folder" if root.is_dir() => ScopeKind::Folder,
        _ => return Err("Contexto Markdown inválido".into()),
    };
    let related = if kind == ScopeKind::Document {
        related_markdown(&root, request.folder.as_deref())
    } else {
        HashSet::new()
    };
    let related_count = related.len();
    let empty_cwd = std::env::temp_dir().join("pliego-codex-empty");
    std::fs::create_dir_all(&empty_cwd).map_err(|error| error.to_string())?;
    let instructions = "Trabaja exclusivamente con markdown_list, markdown_read y markdown_write. Nunca uses shell, comandos, apply_patch, MCP, conectores ni otras herramientas. No accedas al sistema de archivos por ninguna otra vía. Usa búsqueda web solo cuando el mensaje actual la solicite explícitamente. markdown_write solo reemplaza Markdown existentes y puede ser rechazado por el host.";
    let common = json!({
        "cwd": empty_cwd,
        "approvalPolicy": "never",
        "sandbox": "read-only",
        "model": request.model,
        "developerInstructions": instructions,
        "dynamicTools": tool_specs()
    });
    let (result, resumed) = if let Some(thread_id) = request.thread_id.as_deref() {
        let mut params = common.clone();
        params["threadId"] = json!(thread_id);
        match runtime.send("thread/resume", params) {
            Ok(value) => (value, true),
            Err(_) => (runtime.send("thread/start", common)?, false),
        }
    } else {
        (runtime.send("thread/start", common)?, false)
    };
    let thread_id = result
        .get("thread")
        .and_then(|v| v.get("id"))
        .and_then(Value::as_str)
        .ok_or("Codex devolvió un thread inválido")?
        .to_string();
    {
        const MAX_SCOPES: usize = 64;
        let mut scopes = runtime.scopes.lock().map_err(lock_error)?;
        let mut order = runtime.scope_order.lock().map_err(lock_error)?;
        order.retain(|id| id != &thread_id);
        scopes.insert(
            thread_id.clone(),
            MarkdownScope {
                root,
                kind,
                writable: request.writable,
                related,
            },
        );
        order.push_back(thread_id.clone());
        while order.len() > MAX_SCOPES {
            if let Some(expired) = order.pop_front() {
                scopes.remove(&expired);
                if let Ok(mut turns) = runtime.turns.lock() {
                    turns.remove(&expired);
                }
            }
        }
    }
    Ok(
        json!({"threadId":thread_id,"resumed":resumed,"thread":result.get("thread"),"relatedCount":related_count}),
    )
}

fn related_markdown(document: &Path, folder: Option<&str>) -> HashSet<PathBuf> {
    let Ok(contents) = std::fs::read_to_string(document) else {
        return HashSet::new();
    };
    let mut targets = Vec::new();
    let mut rest = contents.as_str();
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
            targets.push(target.to_string());
        }
        rest = &after[end + 2..];
    }
    let mut cursor = contents.as_str();
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
        if !target.is_empty() {
            targets.push(target.to_string());
        }
        cursor = &after[end + 1..];
    }
    targets
        .into_iter()
        .filter_map(|target| super::find_wiki_target(&target, document, folder))
        .filter(|path| path != document)
        .collect()
}

#[tauri::command]
pub fn codex_set_writable(
    manager: State<CodexManager>,
    thread_id: String,
    writable: bool,
) -> Result<(), String> {
    let runtime = manager
        .runtime
        .lock()
        .map_err(lock_error)?
        .as_ref()
        .cloned()
        .ok_or("Codex no está conectado")?;
    let mut scopes = runtime.scopes.lock().map_err(lock_error)?;
    scopes
        .get_mut(&thread_id)
        .ok_or("Thread sin contexto")?
        .writable = writable;
    Ok(())
}

#[tauri::command]
pub fn codex_send_turn(
    app: AppHandle,
    manager: State<CodexManager>,
    thread_id: String,
    message: String,
    model: Option<String>,
    effort: Option<String>,
    allow_web: bool,
) -> Result<Value, String> {
    if message.trim().is_empty() {
        return Err("Escribe un mensaje".into());
    }
    let runtime = manager.ensure(&app)?;
    let policy = if allow_web {
        "El usuario solicitó búsqueda web explícitamente; puedes usarla si aporta valor."
    } else {
        "No uses búsqueda web en este turno."
    };
    runtime.send(
        "turn/start",
        json!({
            "threadId": thread_id,
            "model": model,
            "effort": effort,
            "input": [{"type":"text","text":format!("{policy}\n\n{}", message.trim())}]
        }),
    )
}

#[tauri::command]
pub fn codex_interrupt(manager: State<CodexManager>, thread_id: String) -> Result<(), String> {
    let runtime = manager
        .runtime
        .lock()
        .map_err(lock_error)?
        .as_ref()
        .cloned()
        .ok_or("Codex no está conectado")?;
    let turn_id = runtime
        .turns
        .lock()
        .map_err(lock_error)?
        .get(&thread_id)
        .cloned()
        .ok_or("No hay turno activo")?;
    runtime.send(
        "turn/interrupt",
        json!({"threadId":thread_id,"turnId":turn_id}),
    )?;
    Ok(())
}

#[tauri::command]
pub fn codex_stop(manager: State<CodexManager>) -> Result<(), String> {
    stop_runtime(&manager)
}

pub fn stop_runtime(manager: &CodexManager) -> Result<(), String> {
    if let Some(runtime) = manager.runtime.lock().map_err(lock_error)?.take() {
        runtime.alive.store(false, Ordering::SeqCst);
        let mut child = runtime.child.lock().map_err(lock_error)?;
        if child.try_wait().map_err(|error| error.to_string())?.is_none() {
            child.kill().map_err(|error| error.to_string())?;
        }
        child.wait().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(root: &Path, kind: ScopeKind, writable: bool) -> MarkdownScope {
        MarkdownScope {
            root: root.canonicalize().unwrap(),
            kind,
            writable,
            related: HashSet::new(),
        }
    }

    #[test]
    fn rejects_traversal_non_markdown_and_external_symlink() {
        let root = std::env::temp_dir().join(format!("pliego-scope-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("pliego-outside-{}.md", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("ok.md"), "ok").unwrap();
        std::fs::write(root.join("no.txt"), "no").unwrap();
        std::fs::write(&outside, "outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("link.md")).unwrap();
        let folder = scope(&root, ScopeKind::Folder, false);
        assert!(authorized_path(&folder, Some("ok.md")).is_ok());
        assert!(authorized_path(&folder, Some("../outside.md")).is_err());
        assert!(authorized_path(&folder, Some("no.txt")).is_err());
        #[cfg(unix)]
        assert!(authorized_path(&folder, Some("link.md")).is_err());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_file(outside).unwrap();
    }

    #[test]
    fn atomically_replaces_existing_markdown() {
        let root = std::env::temp_dir().join(format!("pliego-write-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("note.md");
        std::fs::write(&file, "antes").unwrap();
        atomic_replace(&file, "después").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "después");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn document_scope_authorizes_only_direct_markdown_references() {
        let root = std::env::temp_dir().join(format!("pliego-related-{}", std::process::id()));
        let notes = root.join("notes");
        std::fs::create_dir_all(&notes).unwrap();
        let current = root.join("current.md");
        let related = notes.join("related.md");
        let unrelated = root.join("unrelated.md");
        std::fs::write(&current, "Ver [[notes/related]]").unwrap();
        std::fs::write(&related, "# Relacionado").unwrap();
        std::fs::write(&unrelated, "# No relacionado").unwrap();
        let related_files = related_markdown(&current, root.to_str());
        let scope = MarkdownScope {
            root: current.canonicalize().unwrap(),
            kind: ScopeKind::Document,
            writable: false,
            related: related_files,
        };
        assert!(authorized_path(&scope, related.canonicalize().unwrap().to_str()).is_ok());
        assert!(authorized_path(&scope, unrelated.canonicalize().unwrap().to_str()).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
