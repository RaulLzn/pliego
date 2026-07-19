# Pliego

![Pliego](public/pliego-icon.png)

**A fast, visual, and local document library.** Pliego lets you organize, connect, read, and edit documents from a desktop application built with Tauri, Rust, and Vite.

[![CI](https://github.com/RaulLzn/pliego/actions/workflows/ci.yml/badge.svg)](https://github.com/RaulLzn/pliego/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/RaulLzn/pliego?display_name=tag)](https://github.com/RaulLzn/pliego/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pliego works locally: your documents never pass through intermediary servers. The optional Codex integration uses your local session and explicitly limits access to Markdown files.

## Features

- Markdown, plain text, PDF, DOCX, EPUB, CSV/TSV, images, and Mermaid.
- Libraries, favorites, recent files, and document tabs.
- Document and library search, quick open, and a command palette.
- Wiki links, backlinks, outgoing references, and broken-link detection.
- Visual Markdown editing with highlighting and frontmatter preservation.
- PDF, table, and EPUB rendering optimized for large documents.
- Light and dark themes, customizable fonts and scale, plus English and Spanish interfaces.
- Optional Codex assistant with separate read and write permissions.

## Quick installation

Download the installer for your system from the [latest release](https://github.com/RaulLzn/pliego/releases/latest). You do not need Node.js, Rust, or a cloned repository.

### Fedora, RHEL, and derivatives

Download the `.rpm` file and open it with your software center, or run:

```bash
sudo dnf install ./Pliego-*.rpm
```

### Ubuntu, Debian, and derivatives

Download the `.deb` file and open it with your system installer, or run:

```bash
sudo apt install ./Pliego_*.deb
```

### Portable Linux

```bash
chmod +x Pliego_*.AppImage
./Pliego_*.AppImage
```

### Windows

Download and run the `.exe` or `.msi` installer from the latest release.

### macOS

Download the `.dmg`, drag Pliego into Applications, and open it. Until the binaries are signed and notarized, macOS may ask you to confirm the first launch under **Privacy & Security**.

> Windows and macOS installers may display a warning until the project configures code-signing certificates. Linux packages require no additional configuration.

## Optional Codex integration

The reader, editor, and organizer work without Codex. To enable the local assistant, install [Codex CLI](https://developers.openai.com/codex/cli/) and sign in once:

```bash
codex login
```

## Development

Requirements: Node.js LTS, stable Rust, and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/RaulLzn/pliego.git
cd pliego
npm ci
npm run tauri:dev
```

Local validation:

```bash
npm run check
```

Packaging:

```bash
npm run tauri:build
```

## Versions and releases

Pliego follows [Semantic Versioning](https://semver.org/) and keeps release notes in [CHANGELOG.md](CHANGELOG.md). Tags matching `vX.Y.Z` trigger GitHub Actions and produce native installers for Linux, Windows, and macOS. See [docs/RELEASING.md](docs/RELEASING.md) for the complete process.

## Contributing

Contributions are welcome. Before submitting changes, please review:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

## License

Pliego is distributed under the [MIT License](LICENSE). You may use, modify, and distribute it, including commercially, as long as you retain the copyright notice and license.
