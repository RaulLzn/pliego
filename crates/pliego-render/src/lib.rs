//! Lógica de documentos sin acceso al sistema de archivos. La usan la app de
//! escritorio (con `std::fs`) y la versión web (compilada a WebAssembly).

use pulldown_cmark::{html, Options, Parser};
use std::path::{Path, PathBuf};

pub fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("md" | "markdown" | "mdown" | "mkd" | "txt")
    )
}

pub fn document_kind(path: &Path) -> Option<&'static str> {
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

pub fn markdown_references(contents: &str) -> Vec<String> {
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

pub fn markdown_name_from_title(title: &str) -> Result<(String, String), String> {
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

pub fn strip_frontmatter(contents: &str) -> String {
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

pub fn render_markdown(contents: &str) -> String {
    render_markdown_source(&strip_frontmatter(contents))
}

pub fn render_markdown_source(contents: &str) -> String {
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

/// Primer encabezado del documento o, si no hay, el nombre del archivo.
pub fn markdown_title(contents: Option<&str>, path: &Path) -> String {
    if let Some(contents) = contents {
        let body = strip_frontmatter(contents);
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

/// Busca el destino de `[[target]]`: junto al archivo actual, en la carpeta
/// abierta y en `home`, probando también la extensión `.md`.
pub fn find_wiki_target(
    target: &str,
    file_path: &Path,
    folder: Option<&str>,
    home: Option<&Path>,
    is_markdown_file: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if target.is_empty() || target.contains("://") {
        return None;
    }

    let expanded = if target == "~" {
        home?.to_path_buf()
    } else if let Some(relative) = target.strip_prefix("~/") {
        home?.join(relative)
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
        if let Some(home) = home {
            bases.push(home.join(&expanded));
        }
    }

    for candidate in bases {
        let variants = if candidate.extension().is_some() {
            vec![candidate]
        } else {
            vec![candidate.clone(), candidate.with_extension("md")]
        };
        for variant in variants {
            if is_markdown(&variant) && is_markdown_file(&variant) {
                return Some(variant);
            }
        }
    }
    None
}

/// Convierte `[[destino|etiqueta]]` en enlaces Markdown. `resolve` recibe el
/// destino sin ancla y devuelve la ruta encontrada y su título.
pub fn resolve_wiki_links(
    contents: &str,
    resolve: &dyn Fn(&str) -> Option<(PathBuf, String)>,
) -> String {
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
            output.push_str(&resolve_wiki_links_in_line(line, resolve));
        }
    }

    output
}

fn resolve_wiki_links_in_line(
    line: &str,
    resolve: &dyn Fn(&str) -> Option<(PathBuf, String)>,
) -> String {
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

        if let Some((path, title)) = resolve(target) {
            let label = explicit_label
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or(title);
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

fn escape_markdown_label(label: &str) -> String {
    label
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_targets_next_to_the_file_before_the_library_root() {
        let known = ["/lib/section/note.md", "/lib/note.md"];
        let found = find_wiki_target(
            "note",
            Path::new("/lib/section/current.md"),
            Some("/lib"),
            None,
            |path| known.contains(&path.to_str().unwrap()),
        );
        assert_eq!(found, Some(PathBuf::from("/lib/section/note.md")));
    }

    #[test]
    fn keeps_unresolved_links_and_escapes_labels() {
        let resolved = resolve_wiki_links("[[a#b]] [[missing]]", &|target| {
            (target == "a").then(|| (PathBuf::from("/lib/a.md"), "Uno [x]".to_string()))
        });
        assert_eq!(resolved, "[Uno \\[x\\]](</lib/a.md#b>) [[missing]]");
    }

    #[test]
    fn titles_fall_back_to_the_file_name() {
        assert_eq!(
            markdown_title(Some("---\nx: 1\n---\n## Hola ##"), Path::new("a.md")),
            "Hola"
        );
        assert_eq!(
            markdown_title(None, Path::new("/x/mi_nota-1.md")),
            "mi nota 1"
        );
    }
}
