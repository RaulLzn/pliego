//! RPM/DEB installation: only packages selected and signature-verified by Tauri.
use serde::Serialize;
use std::io::Write;
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{
    ipc::Channel,
    utils::{config::BundleType, platform::bundle_type},
    AppHandle, State,
};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PackageUpdateState {
    busy: AtomicBool,
    pending: Mutex<Option<Update>>,
    prepared: Mutex<Option<tempfile::TempDir>>,
}
struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl PackageUpdateState {
    fn begin(&self) -> Result<Operation<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Operation(&self.busy))
            .map_err(|_| "update_busy".into())
    }
}

fn package_kind() -> Result<&'static str, String> {
    if !cfg!(target_os = "linux") {
        return Err("unsupported_package".into());
    }
    match bundle_type() {
        Some(BundleType::Rpm) => Ok("rpm"),
        Some(BundleType::Deb) => Ok("deb"),
        _ => Err("unsupported_package".into()),
    }
}
fn valid_package_url(url: &str, version: &str, kind: &str) -> bool {
    url.starts_with(&format!(
        "https://github.com/RaulLzn/pliego/releases/download/v{version}/"
    )) && url.ends_with(&format!(".{kind}"))
}
fn installer(kind: &str) -> (&'static str, Vec<&'static str>) {
    match kind {
        "rpm" => ("/usr/bin/dnf", vec!["install", "-y"]),
        _ => ("/usr/bin/apt-get", vec!["install", "-y"]),
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum Progress {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
    },
}

#[tauri::command]
pub async fn package_update_check(
    app: AppHandle,
    state: State<'_, PackageUpdateState>,
) -> Result<Option<String>, String> {
    let _operation = state.begin()?;
    let kind = package_kind()?;
    *state.pending.lock().map_err(|_| "update_state")? = None;
    *state.prepared.lock().map_err(|_| "update_state")? = None;
    let target = format!("linux-{}-{kind}", std::env::consts::ARCH);
    let update = app
        .updater_builder()
        .target(target)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "update_check")?
        .check()
        .await
        .map_err(|_| "update_check")?;
    if let Some(ref update) = update {
        if !valid_package_url(update.download_url.as_str(), &update.version, kind) {
            return Err("invalid_package".into());
        }
    }
    let version = update.as_ref().map(|u| u.version.clone());
    *state.pending.lock().map_err(|_| "update_state")? = update;
    Ok(version)
}

#[tauri::command]
pub async fn package_update_download(
    state: State<'_, PackageUpdateState>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let _operation = state.begin()?;
    let kind = package_kind()?;
    let mut update = state
        .pending
        .lock()
        .map_err(|_| "update_state")?
        .clone()
        .ok_or("no_update")?;
    update.timeout = Some(Duration::from_secs(600));
    let mut started = false;
    // download() verifies the pinned Tauri signature before returning any bytes.
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_progress.send(Progress::Started { content_length });
                    started = true;
                }
                let _ = on_progress.send(Progress::Progress { chunk_length });
            },
            || {},
        )
        .await
        .map_err(|_| "update_download")?;
    let directory = tempfile::Builder::new()
        .prefix("pliego-update-")
        .tempdir()
        .map_err(|_| "update_storage")?;
    let path = directory.path().join(format!("Pliego.{kind}"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "update_storage")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "update_storage")?;
    *state.prepared.lock().map_err(|_| "update_state")? = Some(directory);
    Ok(())
}

#[tauri::command]
pub async fn package_update_install(state: State<'_, PackageUpdateState>) -> Result<(), String> {
    let _operation = state.begin()?;
    let kind = package_kind()?;
    let directory = state
        .prepared
        .lock()
        .map_err(|_| "update_state")?
        .take()
        .ok_or("no_download")?;
    tauri::async_runtime::spawn_blocking(move || {
        let (program, arguments) = installer(kind);
        let status = Command::new("/usr/bin/pkexec")
            .arg(program)
            .args(arguments)
            .arg(directory.path().join(format!("Pliego.{kind}")))
            .env("DEBIAN_FRONTEND", "noninteractive")
            .output()
            .map_err(|_| "installer_unavailable")?
            .status;
        // TempDir drops after the installer finishes, including cancellation/error.
        match status.code() {
            Some(0) => Ok(()),
            Some(126) | Some(127) => Err("authorization_cancelled".to_string()),
            _ => Err("installation_failed".to_string()),
        }
    })
    .await
    .map_err(|_| "installation_failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_foreign_or_wrong_package() {
        let base = "https://github.com/RaulLzn/pliego/releases/download/v1.7.1/Pliego.rpm";
        assert!(valid_package_url(base, "1.7.1", "rpm"));
        assert!(!valid_package_url(base, "1.7.2", "rpm"));
        assert!(!valid_package_url(base, "1.7.1", "deb"));
        assert!(!valid_package_url(
            &base.replace("RaulLzn", "other"),
            "1.7.1",
            "rpm"
        ));
    }
    #[test]
    fn operations_are_exclusive_and_unlock_on_error() {
        let state = PackageUpdateState::default();
        let operation = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(operation);
        assert!(state.begin().is_ok());
    }
}
