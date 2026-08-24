# Changelog

Todos los cambios relevantes de Pliego se documentan en este archivo. El proyecto sigue [Semantic Versioning](https://semver.org/).

## [1.4.2] - 2026-08-23

### Correcciones

- Las bibliotecas cargan el árbol visible y mantienen la pantalla de Library si la carpeta no se puede leer.
- Se invalidan cargas obsoletas al cambiar de biblioteca y se protegen documentos con cambios sin guardar.
- El menú de resaltado conserva la selección, se reposiciona al hacer scroll y permite modificar solo el fragmento seleccionado.
- Se propagan los errores de lectura/indexación de carpetas y se valida el resultado de abrir el explorador de archivos.
- Se corrige la persistencia del tema desde la paleta de comandos y el cierre de overlays con Escape.

## [1.4.1] - 2026-08-23

### Correcciones

- Los bundles de macOS reciben una firma ad hoc gratuita y el workflow valida su integridad para evitar que Apple Silicon los trate como dañados.

## [1.4.0] - 2026-08-11

### Integración con el sistema operativo

- Pliego aparece como aplicación compatible en “Abrir con” para sus formatos soportados en paquetes Linux.
- Los archivos entregados por Linux, Windows y macOS al iniciar la aplicación se abren directamente, con soporte para selecciones múltiples.
- macOS también atiende aperturas posteriores mediante el evento nativo de archivos de Tauri.

## [1.3.0] - 2026-08-07

### Pliego Inbox

- Captura rápida global con `Ctrl+Alt+Space`, disponible aunque la ventana principal esté oculta o minimizada.
- Captura local de texto, URL, portapapeles y archivos, sin depender de Codex ni de una base de datos propietaria.
- Carpeta Inbox elegible por el usuario y atajo global configurable desde Ajustes.
- Contador de pendientes, vista previa textual bajo demanda y acciones para abrir, renombrar, mover, archivar o eliminar.
- Navegación por teclado con flechas, Inicio/Fin, Enter y atajos para las acciones frecuentes.
- Validación de rutas, límites de vista previa y arranque tolerante a conflictos con atajos ya registrados.
- Creación de nuevas páginas Markdown desde la biblioteca actual con `Ctrl+N`, validación segura y apertura inmediata en edición.

## [1.2.0] - 2026-07-18

### Experiencia inicial

- Tutorial interactivo de primera apertura con recorrido por lectura, edición de Markdown, bibliotecas, búsqueda, pestañas, favoritos, índice, apariencia y Codex.
- Acceso permanente para repetir el tutorial desde Configuración.

## [1.1.0] - 2026-07-18

### Documentos grandes

- PDF virtualizado sin alterar escala ni nitidez: mantiene las dimensiones de todas las páginas y solo conserva canvas cercanos al viewport.
- Tablas CSV y TSV virtualizadas con una ventana de filas y encabezado persistente.
- EPUB con carga progresiva de capítulos conforme avanza la lectura.
- Indexación de carpetas acotada a 2 MB de texto por archivo para evitar picos al explorar bibliotecas grandes.
- Límites seguros y mensajes explícitos para documentos visuales mayores de 128 MB y textos mayores de 32 MB.

### Proyecto

- Repositorio público preparado con licencia MIT, guías de contribución, soporte y seguridad.
- CI para compilación, tests, formato, lint y auditoría de dependencias.
- Releases automatizadas para Linux, Windows y macOS a partir de tags semánticos.

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
[1.1.0]: https://github.com/RaulLzn/pliego/releases/tag/v1.1.0
[1.2.0]: https://github.com/RaulLzn/pliego/releases/tag/v1.2.0
[1.3.0]: https://github.com/RaulLzn/pliego/releases/tag/v1.3.0
[1.4.0]: https://github.com/RaulLzn/pliego/releases/tag/v1.4.0
[1.4.1]: https://github.com/RaulLzn/pliego/releases/tag/v1.4.1
[1.4.2]: https://github.com/RaulLzn/pliego/releases/tag/v1.4.2
