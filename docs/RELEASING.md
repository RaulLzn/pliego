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

### macOS

Pliego usa exclusivamente una firma ad hoc para sus bundles de macOS. No requiere cuenta, certificado, clave ni membresía paga de Apple. La pseudoidentidad `-` configurada en Tauri aporta integridad al bundle y evita que los builds para Apple Silicon descargados desde GitHub aparezcan como dañados.

La firma ad hoc no identifica al desarrollador ni satisface la política de confianza de Gatekeeper. Después de copiar Pliego a Aplicaciones, el usuario debe intentar abrirlo una vez y autorizarlo en **Configuración del Sistema → Privacidad y seguridad → Abrir igualmente**. Ese botón aparece temporalmente después del intento bloqueado.

El runner macOS valida que la aplicación completa tenga una firma ad hoc íntegra:

```bash
codesign --verify --deep --strict --verbose=2 Pliego.app
codesign --display --verbose=4 Pliego.app
```

La release permanece como borrador hasta que los jobs de ambas arquitecturas macOS validen la firma ad hoc. Después de publicarla, también debe instalarse y abrirse el DMG descargado en un Mac real: la cuarentena aplicada por el navegador es la que activa la evaluación completa de Gatekeeper y no puede reproducirse en los runners de CI.

### Windows

Los builds de Windows continúan sin certificado Authenticode y pueden mostrar una advertencia de SmartScreen.
