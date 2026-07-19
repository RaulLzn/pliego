# Pliego

Biblioteca documental visual, rápida y local para Fedora/Linux, hecha con `Tauri + Vite`.

Pliego permite organizar bibliotecas, leer múltiples formatos como documentos visuales, conectar notas y trabajar con asistencia local de Codex sin enviar el sistema de archivos a servicios intermedios.

## Incluye

- Apertura de archivos `.md`, `.markdown`, `.mkd` y `.txt`
- Soporte de arrastrar y soltar
- Render Markdown limpio con tablas, listas, checklist y bloques de codigo
- Buscador con navegacion entre coincidencias
- Indice lateral por encabezados
- Busqueda global de la carpeta (`Ctrl+Shift+F`)
- Apertura rapida (`Ctrl+P`) y paleta de comandos (`Ctrl+K`)
- Backlinks, enlaces salientes y deteccion de referencias rotas
- Vista visual integrada para PDF, DOCX, EPUB, CSV/TSV, imagenes y Mermaid
- Renderizadores pesados cargados solo cuando el formato los necesita
- Bibliotecas personalizables, favoritos y documentos recientes
- Pestañas de archivos abiertos y barra de ventana integrada
- Interfaz en español e inglés
- Asistente Codex con permisos explícitos de solo lectura o edición

## Ejecutar ahora

```bash
cd /home/raul/Documents/Proyectos/md-ligero
chmod +x lanzar-pliego.sh
./lanzar-pliego.sh
```

## Artefactos

- Binario directo: `artifacts/Pliego`
- Portable empaquetado: `artifacts/Pliego-AppDir.tar.gz`

## Desarrollo

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

## Verificación

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm audit --omit=dev
```

## Versión

Consulta [CHANGELOG.md](CHANGELOG.md) para las notas completas de cada publicación.

## Licencia

El proyecto todavía no declara una licencia de distribución. Antes de aceptar contribuciones externas debe elegirse y añadirse una licencia explícita.

Nota: en esta maquina la app compilo bien y genero el `AppDir`, pero el cierre final del `.AppImage` fallo dentro de `linuxdeploy`. El contenido portable ya quedo listo igualmente.
