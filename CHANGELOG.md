# Changelog

Todos los cambios relevantes de Pliego se documentan en este archivo. El proyecto sigue [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-07-18

### Rendimiento y estabilidad

- Liberación completa de workers, páginas, canvas y observadores al cerrar o sustituir un PDF.
- Cancelación segura de cargas obsoletas al cambiar rápidamente entre documentos.
- Liberación garantizada de URLs Blob para imágenes cargadas, fallidas o canceladas.
- Limpieza de solicitudes Codex vencidas, turnos completados y contextos antiguos.
- Cierre y espera determinista del proceso Codex al detener o cerrar Pliego.

## [1.0.0] - 2026-07-18

Primera versión pública de Pliego, una biblioteca documental visual y local para Linux construida con Tauri.

### Funcionalidades

- Biblioteca de carpetas persistentes con acceso desde una pantalla principal.
- Personalización de bibliotecas mediante diez colores y diez iconos opcionales.
- Ordenamiento de bibliotecas por actividad reciente, nombre o color.
- Historial limitado a cinco documentos recientes y favoritos para archivos individuales.
- Pestañas compactas para cambiar y cerrar documentos abiertos.
- Búsqueda dentro del documento y búsqueda global sobre archivos textuales de una carpeta.
- Apertura rápida con `Ctrl+P` y paleta de comandos con `Ctrl+K`.
- Navegación de enlaces wiki, backlinks, referencias salientes y enlaces rotos.
- Edición visual Markdown con formato, resaltado y preservación de frontmatter.
- Asistente Codex local con contexto de documento o carpeta, selección de modelo y permisos de escritura explícitos.
- Tema claro y oscuro, cinco colores de acento, tres familias tipográficas y escala configurable.
- Interfaz disponible en español e inglés con preferencias persistentes.

### Formatos visuales

- Markdown y texto plano.
- PDF renderizado como páginas continuas e integrado con el diseño de lectura.
- DOCX convertido a documento visual.
- EPUB presentado como lectura continua por capítulos.
- CSV y TSV como tablas navegables.
- Imágenes PNG, JPEG, GIF, WebP, SVG y BMP.
- Diagramas Mermaid independientes y embebidos en Markdown.

### Diseño y experiencia

- Identidad oficial Pliego e iconografía propia para Linux, Windows y macOS.
- Barra de ventana personalizada con arrastre, minimizar, maximizar y cerrar.
- Barra superior compacta con iconos animados, tooltips y nombres accesibles.
- Menú principal con bibliotecas y favoritos a la izquierda y recientes a la derecha.
- Controles desplegables LifeOS para idioma y ordenamiento.
- Panel lateral estático con scroll independiente y límites claros de contenido.
- Layout responsive para ventanas reducidas.

### Correcciones y seguridad

- Prevención de pérdida de cambios al navegar desde un documento modificado.
- Escrituras de Codex atómicas y restringidas a archivos Markdown autorizados.
- Rechazo de traversal, archivos externos y symlinks fuera del contexto permitido.
- Re-renderizado de PDF al redimensionar para evitar texto borroso o deformado.
- Corrección del encogimiento vertical y superposición de archivos recientes.
- Carga diferida de PDF, Mermaid, EPUB, DOCX y CSV para mantener ligero el arranque.
- Migración automática de preferencias almacenadas bajo el nombre anterior.
- Cero vulnerabilidades conocidas en dependencias de producción al publicar esta versión.

[1.0.0]: https://github.com/RaulLzn/pliego/releases/tag/v1.0.0
[1.0.1]: https://github.com/RaulLzn/pliego/releases/tag/v1.0.1
