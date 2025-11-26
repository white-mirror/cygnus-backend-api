# Cygnus Backend API

- Los commits (salvo los que comiencen con `wip:` o merges) ejecutan `npm run format`, `npm run lint`, `npm run typecheck` y `npm run build:app`. Si alguna verificación falla el commit se aborta automáticamente.
- El mensaje del commit se interpreta con Conventional Commits: `feat` incrementa el **minor**, `fix` y el resto el **patch**, y los commits con `!` o `BREAKING CHANGE` elevan el **major**. La versión resultante se guarda en `package.json` y `package-lock.json`.
- Después de crear el commit, un hook `post-commit` vuelve a correr `npm run build` (lo que actualiza el campo `buildNumber` de `package.json` con `build-number-generator`) y hace `git commit --amend --no-edit` para dejar registrados `major.minor.patch.buildNumber` sin tocar el mensaje original.
- Ejecutá `npm install` para que Husky configure los hooks mediante `npm run prepare`. Si necesitás omitir todas las validaciones usá `wip:` como prefijo del mensaje.

## Variables de entorno

- `SESSION_SECRET` (obligatoria): clave simétrica para cifrar y firmar el token de sesión enviado por cookie. Sin esto no se pueden emitir sesiones.
- `CORS_ALLOWED_ORIGINS`: lista separada por comas de orígenes habilitados además de localhost y `capacitor://localhost`.
- `CORS_ALLOW_ALL`: si está en `1` acepta cualquier origen. Úsalo solo para pruebas o previsualizaciones; no se recomienda en producción.
- `BGH_TIMEOUT_MS`: timeout opcional (ms) para el cliente de BGH.

## Healthcheck

- `GET /api/health`: devuelve versión, buildNumber y variables CORS relevantes para debugging de despliegue.

## Despliegue serverless

- El handler HTTP vive en `api/[[...route]].ts` y reusa la app Express exportada en `src/app.ts`, compatible con Vercel (`/api/*`).
