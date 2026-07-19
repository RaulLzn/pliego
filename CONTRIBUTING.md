# Contribuir a Pliego

Gracias por mejorar Pliego. Buscamos cambios pequeños, verificables y compatibles con documentos existentes.

## Antes de empezar

1. Busca issues y pull requests existentes.
2. Para cambios grandes, abre primero una propuesta describiendo experiencia de usuario, alcance y alternativas.
3. No incluyas documentos privados, credenciales, datos personales ni artefactos compilados.

## Flujo de trabajo

1. Crea un fork y una rama desde `main`.
2. Instala dependencias con `npm ci`.
3. Implementa un cambio enfocado.
4. Ejecuta `npm run check`.
5. Actualiza pruebas y documentación cuando corresponda.
6. Abre un pull request utilizando la plantilla.

Usa commits claros, preferiblemente con el formato Conventional Commits: `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `build:` o `chore:`.

## Criterios de aceptación

- El frontend compila sin errores.
- Los tests Rust pasan.
- No se introducen secretos ni telemetría inesperada.
- Los cambios de visualización se prueban con documentos pequeños y grandes.
- Los cambios visibles para usuarios se documentan en `CHANGELOG.md` bajo una sección `Unreleased`.

Al contribuir aceptas que tu trabajo se distribuya bajo la licencia MIT del proyecto y cumplir el [Código de conducta](CODE_OF_CONDUCT.md).
