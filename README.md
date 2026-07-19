# Pliego

![Pliego](public/pliego-icon.png)

**Una biblioteca documental visual, rápida y local.** Pliego organiza, conecta, lee y edita documentos desde una aplicación de escritorio construida con Tauri, Rust y Vite.

[![CI](https://github.com/RaulLzn/pliego/actions/workflows/ci.yml/badge.svg)](https://github.com/RaulLzn/pliego/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/RaulLzn/pliego?display_name=tag)](https://github.com/RaulLzn/pliego/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pliego funciona localmente: tus documentos no pasan por servidores intermedios. La integración opcional con Codex utiliza la sesión local del usuario y limita explícitamente el acceso a Markdown.

## Características

- Markdown, texto, PDF, DOCX, EPUB, CSV/TSV, imágenes y Mermaid.
- Bibliotecas, favoritos, recientes y pestañas de documentos.
- Búsqueda en documento y biblioteca, apertura rápida y paleta de comandos.
- Enlaces wiki, backlinks, referencias salientes y detección de enlaces rotos.
- Edición visual Markdown con resaltado y preservación de frontmatter.
- PDF, tablas y EPUB optimizados para documentos grandes.
- Tema claro/oscuro, tipografías, escala e interfaz en español e inglés.
- Asistente Codex opcional con permisos separados de lectura y escritura.

## Instalación rápida

Descarga el instalador de tu sistema desde [la versión más reciente](https://github.com/RaulLzn/pliego/releases/latest). No necesitas Node.js, Rust ni clonar el repositorio.

### Fedora, RHEL y derivados

Descarga el archivo `.rpm` y ábrelo con Software, o ejecuta:

```bash
sudo dnf install ./Pliego-*.rpm
```

### Ubuntu, Debian y derivados

Descarga el archivo `.deb` y ábrelo con el instalador del sistema, o ejecuta:

```bash
sudo apt install ./Pliego_*.deb
```

### Linux portable

```bash
chmod +x Pliego_*.AppImage
./Pliego_*.AppImage
```

### Windows

Descarga y ejecuta el instalador `.exe` o `.msi` de la release.

### macOS

Descarga el `.dmg`, arrastra Pliego a Aplicaciones y ábrelo. Mientras los binarios no estén firmados y notarizados, macOS puede pedir confirmar la apertura desde **Privacidad y seguridad**.

> Los instaladores de Windows y macOS generados por la comunidad pueden mostrar advertencias hasta que el proyecto configure certificados de firma de código. Los paquetes Linux no requieren configuración adicional.

## Codex opcional

El lector, editor y organizador funcionan sin Codex. Para activar el asistente local instala [Codex CLI](https://developers.openai.com/codex/cli/) e inicia sesión una vez:

```bash
codex login
```

## Desarrollo

Requisitos: Node.js LTS, Rust estable y las [dependencias del sistema para Tauri 2](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/RaulLzn/pliego.git
cd pliego
npm ci
npm run tauri:dev
```

Validación local:

```bash
npm run check
```

Empaquetado:

```bash
npm run tauri:build
```

## Versiones y releases

Pliego sigue [Semantic Versioning](https://semver.org/) y mantiene notas en [CHANGELOG.md](CHANGELOG.md). Los tags `vX.Y.Z` activan GitHub Actions y publican instaladores nativos para Linux, Windows y macOS. Consulta [docs/RELEASING.md](docs/RELEASING.md) para el procedimiento completo.

## Colaborar

Las contribuciones son bienvenidas. Antes de enviar cambios, revisa:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [Código de conducta](CODE_OF_CONDUCT.md)
- [Política de seguridad](SECURITY.md)
- [Soporte](SUPPORT.md)

## Licencia

Pliego se distribuye bajo la [licencia MIT](LICENSE). Puedes usarlo, modificarlo y distribuirlo, incluso comercialmente, conservando el aviso de copyright y la licencia.
