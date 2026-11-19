//! Nombre del PDF al imprimir en Linux.
//!
//! WebKitGTK abre el diálogo de impresión de GTK, que no mira el título de la
//! página: «Imprimir a archivo» proponía siempre `output.pdf` en la carpeta de
//! trabajo del proceso. Antes de mostrarlo, proponemos Documentos/<título>.pdf
//! (el frontend pone el nombre del documento como título al imprimir).

/// Nombre que el frontend fija justo antes de imprimir.
static PRINT_NAME: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

#[tauri::command]
pub fn set_print_file_name(name: String) {
    if let Ok(mut current) = PRINT_NAME.lock() {
        *current = name;
    }
}

fn requested_name() -> String {
    PRINT_NAME
        .lock()
        .map(|name| name.clone())
        .unwrap_or_default()
}

/// Nombre de archivo (sin extensión: GTK la añade según el formato) a partir
/// del título de la página.
pub fn pdf_basename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let name = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let name = name.trim_start_matches('.').trim();
    if name.is_empty() || name == "Pliego" {
        "Pliego".to_string()
    } else {
        name.chars().take(120).collect()
    }
}

#[cfg(target_os = "linux")]
pub fn install(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| {
        use webkit2gtk::{PrintOperationExt, WebViewExt};
        webview.inner().connect_print(|view, operation| {
            // Preferimos el nombre que envió el frontend; si no hay, el título de la página.
            let requested = requested_name();
            let title = if requested.trim().is_empty() {
                view.title()
                    .map(|title| title.to_string())
                    .unwrap_or_default()
            } else {
                requested
            };
            let settings = operation
                .print_settings()
                .unwrap_or_else(gtk::PrintSettings::new);
            // GTK 3 no compone bien output-dir + output-basename: se pasa la
            // ruta completa como output-uri.
            let documents = gtk::glib::user_special_dir(gtk::glib::UserDirectory::Documents)
                .filter(|dir| dir.is_dir())
                .unwrap_or_else(gtk::glib::home_dir);
            let file = documents.join(format!("{}.pdf", pdf_basename(&title)));
            if let Ok(uri) = gtk::glib::filename_to_uri(&file, None) {
                settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(&uri));
                settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
            }
            operation.set_print_settings(&settings);
            // false: que WebKit siga y muestre su diálogo con estos valores.
            false
        });
    });
}

#[cfg(not(target_os = "linux"))]
pub fn install(_app: &tauri::App) {}

#[cfg(test)]
mod tests {
    use super::pdf_basename;

    #[test]
    fn builds_safe_pdf_names_from_the_page_title() {
        assert_eq!(pdf_basename("Informe final"), "Informe final");
        assert_eq!(pdf_basename("a/b: c?"), "a b c");
        assert_eq!(pdf_basename("  ..oculto "), "oculto");
        assert_eq!(pdf_basename(""), "Pliego");
        assert_eq!(pdf_basename("Pliego"), "Pliego");
        assert_eq!(pdf_basename(&"x".repeat(300)).len(), 120);
    }
}
