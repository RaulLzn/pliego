# Publicar una versión

Pliego usa Semantic Versioning:

- `PATCH`: corrección compatible (`1.1.0` → `1.1.1`).
- `MINOR`: funcionalidad compatible (`1.1.0` → `1.2.0`).
- `MAJOR`: cambio incompatible (`1.1.0` → `2.0.0`).

## Preparación

1. Actualiza la misma versión en `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` y `src-tauri/tauri.conf.json`.
2. Mueve las notas de `Unreleased` en `CHANGELOG.md` a la versión y fecha correspondientes.
3. Ejecuta `npm run check` y `npm run tauri:build` en al menos una plataforma.
4. Fusiona el cambio en `main`.

## Publicación

```bash
git tag -a v1.2.3 -m "Pliego 1.2.3"
git push origin v1.2.3
```

El workflow `release.yml` valida que el tag coincida con la versión y crea una release con instaladores de cada plataforma. La release queda como borrador para revisar artefactos antes de publicarla.

## Firma de código

Los builds funcionan sin secretos. Para eliminar advertencias de instalación en macOS y Windows deben configurarse posteriormente certificados de firma y notarización siguiendo la documentación oficial de Tauri.
