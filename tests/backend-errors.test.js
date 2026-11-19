import test from 'node:test'
import assert from 'node:assert/strict'
import { translateBackendError } from '../src/backend-errors.js'

test('translates prefixed backend errors and keeps the detail', () => {
  assert.equal(translateBackendError('No se puede localizar el archivo: permiso denegado'), 'Could not locate the file: permiso denegado')
  assert.equal(translateBackendError('La subcarpeta no es válida'), 'The subfolder is not valid')
  assert.equal(translateBackendError('Solo se pueden guardar imágenes PNG, JPEG, GIF, WebP o BMP'), 'Only PNG, JPEG, GIF, WebP or BMP images can be saved')
})

test('translates messages with data in the middle', () => {
  assert.equal(translateBackendError('Ya existe una página llamada Idea.md'), 'A page named Idea.md already exists')
  assert.equal(translateBackendError('Ya existe foto.png'), 'foto.png already exists')
  assert.equal(translateBackendError('El documento ocupa 40.5 MB; el límite seguro para texto es 32 MB'), 'The document is 40.5 MB; the safe limit for text is 32 MB')
  assert.equal(translateBackendError("No se puede leer la carpeta '/x': Permission denied"), "Could not read the folder '/x': Permission denied")
})

test('leaves unknown messages untouched', () => {
  assert.equal(translateBackendError('Something else'), 'Something else')
})
