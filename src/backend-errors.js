// Traducción al inglés de los errores del backend (Rust y web), que llegan en
// español. Prefijos: se traduce el inicio y se conserva el detalle (p. ej. el
// error del sistema). Patrones: mensajes con datos en medio.
const PREFIXES = [
  ['No se puede localizar el archivo:', 'Could not locate the file:'],
  ['No se pudo abrir el explorador de archivos:', 'Could not open the file manager:'],
  ['No se pudo resolver la configuración:', 'Could not resolve the configuration:'],
  ['La configuración del Inbox no está disponible', 'Inbox configuration is unavailable'],
  ['La carpeta del Inbox debe usar una ruta absoluta', 'The Inbox folder must use an absolute path'],
  ['Nombre de elemento inválido', 'Invalid item name'],
  ['El nombre no puede contener rutas', 'The name cannot contain path separators'],
  ['El elemento del Inbox no existe', 'The Inbox item does not exist'],
  ['El elemento está fuera del Inbox', 'The item is outside the Inbox'],
  ['Elige primero una carpeta para el Inbox', 'Choose an Inbox folder first'],
  ['La captura está vacía', 'The capture is empty'],
  ['Atajo global inválido', 'Invalid global shortcut'],
  ['No se pudo registrar el atajo:', 'Could not register the shortcut:'],
  ['La URL debe comenzar por http:// o https://', 'The URL must start with http:// or https://'],
  ['No es un archivo válido:', 'Not a valid file:'],
  ['Ya existe un elemento con ese nombre', 'An item with that name already exists'],
  ['La carpeta de destino no es válida', 'The destination folder is not valid'],
  ['El Inbox no elimina carpetas', 'Inbox does not delete folders'],
  ['Escribe un título para la página', 'Enter a title for the page'],
  ['El título no puede superar 120 caracteres', 'The title cannot exceed 120 characters'],
  ['El título contiene caracteres no permitidos', 'The title contains invalid characters'],
  ['El título no produce un nombre de archivo válido', 'The title does not produce a valid file name'],
  ['Ese nombre está reservado por el sistema', 'That name is reserved by the operating system'],
  ['Abre una carpeta válida antes de crear una página', 'Open a valid folder before creating a page'],
  ['El archivo no tiene carpeta padre', 'The file has no parent folder'],
  ['El archivo no tiene una carpeta contenedora', 'The file has no containing folder'],
  ['La subcarpeta no es válida', 'The subfolder is not valid'],
  ['La imagen no tiene un formato válido', 'The image is not in a valid format'],
  ['La imagen supera el límite de 32 MB', 'The image exceeds the 32 MB limit'],
  ['La ruta de la imagen no es válida', 'The image path is not valid'],
  ['No hay un nombre libre para la imagen', 'There is no free name for the image'],
  ['Solo se pueden guardar imágenes PNG, JPEG, GIF, WebP o BMP', 'Only PNG, JPEG, GIF, WebP or BMP images can be saved'],
  ['La carpeta de la biblioteca no existe', 'The library folder does not exist'],
  ['El .zip no contiene documentos', 'The .zip contains no documents'],
  ['La carpeta no contiene documentos', 'The folder contains no documents'],
  ['No pude leer ningún archivo de la carpeta', 'Could not read any file in the folder'],
  ['Formato no soportado', 'Unsupported format'],
  ['La versión web no admite atajos globales', 'The web version does not support global shortcuts'],
  ['La versión web no puede abrir el explorador de archivos', 'The web version cannot open the file manager'],
  ['Función no disponible en la versión web:', 'Not available in the web version:'],
  ['La ruta está fuera de la biblioteca:', 'The path is outside the library:'],
]

const PATTERNS = [
  [/^Ya existe una página llamada (.+)$/s, 'A page named $1 already exists'],
  [/^Ya existe un archivo llamado (.+)$/s, 'A file named $1 already exists'],
  [/^Ya existe (.+)$/s, '$1 already exists'],
  [/^(.+) es una carpeta$/s, '$1 is a folder'],
  [/^No existe el archivo (.+)$/s, 'The file $1 does not exist'],
  [/^El documento ocupa ([\d.,]+) MB; el límite seguro para texto es 32 MB$/, 'The document is $1 MB; the safe limit for text is 32 MB'],
  [/^El archivo ocupa ([\d.,]+) MB; el límite seguro de visualización es 128 MB$/, 'The file is $1 MB; the safe viewing limit is 128 MB'],
  [/^No se puede leer la carpeta '(.+)': (.*)$/s, "Could not read the folder '$1': $2"],
  [/^No se puede indexar la carpeta '(.+)': (.*)$/s, "Could not index the folder '$1': $2"],
]

export function translateBackendError(message) {
  const text = String(message)
  const prefix = PREFIXES.find(([source]) => text.startsWith(source))
  if (prefix) return prefix[1] + text.slice(prefix[0].length)
  for (const [pattern, replacement] of PATTERNS) {
    if (pattern.test(text)) return text.replace(pattern, replacement)
  }
  return text
}
