# parologames — arquitectura

Sitio de un solo autor para publicar juegos HTML5 jugables en el navegador y descargables.
Solo el propietario publica (panel con contraseña + TOTP). El público es anónimo y de solo lectura.

## Decisiones

| Decisión | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 24, ESM, JavaScript con JSDoc | Sin paso de compilación; menos piezas que fallen. |
| Servidor | Express 5 | Maduro, manejo de errores async nativo. |
| Base de datos | SQLite vía `node:sqlite` (integrado), modo WAL | Un solo autor y lecturas masivas: SQLite sobra y no hay servidor de BD que mantener. Consultas siempre con sentencias preparadas. |
| Vistas | HTML renderizado en servidor con plantillas etiquetadas que escapan por defecto | Rápido en móviles, sin JS obligatorio, XSS mitigado por diseño. |
| JS cliente | Vanilla, un archivo por página, sin framework | Presupuesto de JS mínimo; CSP estricta sin `unsafe-inline`. |
| Juegos | Servidos desde un **origen separado** (`GAMES_ORIGIN`, otro puerto/subdominio) dentro de `<iframe sandbox>` | El código del juego nunca comparte origen con el sitio ni con el panel. |
| Despliegue | Imagen Docker no-root + proxy inverso (Caddy) detrás de Cloudflare | TLS automático, caché en CDN, absorción de DDoS en el borde. |

Dependencias de producción permitidas: `express`, `multer`, `yauzl`, `helmet`, `express-rate-limit`. Nada más sin justificarlo.
Dev: `autocannon` (pruebas de carga). Tests con `node:test` y `fetch` nativo.

## Estructura

```
src/
  config.js            Lee y valida variables de entorno; falla al arrancar si falta algo.
  server.js            Arranque: abre BD, crea las dos apps, escucha, apagado ordenado.
  app.js               createApp({ db, config }) → app Express del sitio (público + panel).
  games-app.js         createGamesApp({ db, config }) → app Express del origen de juegos.
  db.js                openDb(path) + migraciones versionadas (PRAGMA user_version).
  log.js               Logger JSON por líneas; redacción de campos sensibles.
  html.js              `html` tagged template (escapa), `raw()`, `attr()`.
  security/
    passwords.js       scrypt (N=2^17, r=8, p=1, 64 bytes), timingSafeEqual.
    totp.js            RFC 6238 (SHA-1, 30 s, 6 dígitos, ventana ±1), base32.
    sessions.js        Token aleatorio de 32 bytes en cookie; en BD solo su SHA-256.
    csrf.js            Token sincronizado ligado a la sesión (o a cookie pre-sesión en el login).
    limits.js          Limitadores: global, login, descargas, subida.
    headers.js         CSP y cabeceras para cada origen.
  services/
    games.js           CRUD de juegos (consultas preparadas, transacciones).
    uploads.js         Validación y extracción segura de ZIP (yauzl) y portadas.
    audit.js           Registro de eventos de seguridad en BD + log.
  routes/
    public.js          /, /juegos, /juegos/:slug, /juegos/:slug/descargar, /media/...
    admin.js           Panel bajo ADMIN_PATH.
    health.js          /healthz (vivo) y /readyz (BD accesible).
  views/               Funciones puras: datos → string HTML. Sin acceso a BD.
public/                CSS, JS, fuentes, iconos (servidos con caché larga e immutables por hash/versión).
scripts/
  setup-admin.js       Crea/rota la contraseña y el secreto TOTP del propietario.
  backup.js            Copia consistente de la BD (VACUUM INTO) + archivos de juegos → .tar.gz con fecha.
  restore.js           Restaura una copia (con confirmación explícita).
tests/                 node:test — unitarios y de integración.
data/                  (gitignored) parolo.db, games/, covers/, downloads/, tmp/
```

## Contrato entre rutas y vistas

Las vistas viven en `src/views/` y exportan funciones puras que reciben un objeto y devuelven un string HTML completo:

```js
renderSplash({ featured, csp })                     // GET /  — logo parolo + «Entrar»
renderCatalog({ games, page, totalPages, csp })     // GET /juegos
renderGame({ game, playUrl, csp })                  // GET /juegos/:slug
renderLogin({ csrf, error, csp })                   // GET /panel/entrar
renderAdminList({ games, csrf, flash, csp })        // GET /panel
renderAdminForm({ game|null, csrf, errors, values, limits, csp })  // nuevo / editar
renderError({ status, csp })                        // 404, 429, 500… sin detalles internos
```

`csp` lleva `{ nonce }` por si una vista necesita un `<script>` concreto; por defecto todo JS es externo.

Objeto `game` que reciben las vistas (nunca rutas de disco):

```js
{ id, slug, title, tagline, description, coverUrl, hasDownload, downloadSize, webSize,
  status: 'published'|'hidden', featured, createdAt, updatedAt }
```

## Modelo de datos (SQLite)

```
games(id TEXT PK, slug TEXT UNIQUE, title, tagline, description,
      cover_file, build_dir, download_file NULL, download_size, web_size,
      status TEXT CHECK(status IN ('published','hidden')), featured INTEGER,
      created_at, updated_at)
  INDEX games_status_created (status, created_at DESC)
sessions(token_hash TEXT PK, csrf TEXT, created_at, expires_at, ip_hash, ua_hash)
  INDEX sessions_expires (expires_at)
login_failures(key TEXT PK, count, first_at, locked_until)
audit_log(id INTEGER PK, at, event, ip_hash, detail_json)
upload_requests(idempotency_key TEXT PK, game_id, created_at)
```

## Rutas

Público (solo GET/HEAD): `/`, `/juegos?pagina=N`, `/juegos/:slug`, `/juegos/:slug/descargar`, `/media/portadas/:file`, `/healthz`, `/readyz`, `/robots.txt`.

Panel (`ADMIN_PATH`, por defecto `/panel`; `noindex`, sin caché):
`GET|POST /entrar`, `POST /salir`, `GET /`, `GET /nuevo`, `POST /juegos`, `GET /juegos/:id/editar`,
`POST /juegos/:id`, `POST /juegos/:id/estado`, `POST /juegos/:id/eliminar`.

Origen de juegos: `GET /play/:id/*` — archivos estáticos extraídos; `frame-ancestors` limitado al origen del sitio.

## Variables de entorno

| Variable | Ejemplo | Notas |
|---|---|---|
| `NODE_ENV` | `production` | En producción: cookies `Secure`, HSTS, `trust proxy`. |
| `PORT` | `3000` | Sitio. |
| `GAMES_PORT` | `3001` | Origen de juegos. |
| `SITE_ORIGIN` | `https://parologames.com` | Usado en CSP, CORS y comprobación de `Origin`. |
| `GAMES_ORIGIN` | `https://play.parologames.com` | Debe ser un origen distinto (otro subdominio, mejor otro dominio registrable). |
| `ADMIN_PATH` | `/panel` | Puede cambiarse por algo no adivinable. |
| `DATA_DIR` | `./data` | BD y archivos. |
| `TRUST_PROXY` | `1` | Saltos de proxy de confianza (Caddy/Cloudflare). |
| `SESSION_TTL_HOURS` | `8` | |
| `MAX_BUILD_MB` / `MAX_DOWNLOAD_MB` / `MAX_COVER_MB` | `200` / `500` / `5` | Límites de subida. |
| `IP_HASH_SALT` | 32+ caracteres aleatorios | Para no guardar IPs en claro. |

Las credenciales del propietario **no** van en variables de entorno: `npm run setup-admin` las guarda hasheadas en la BD.

## Desviaciones del backend

- **Archivos extra en `src/`**: `context.js` (servicios compartidos entre las dos apps: misma BD y misma caché, para que una escritura en el panel invalide también el origen de juegos), `render.js` (añade `csp` y `assetVersion` a cada vista), `security/cookies.js` (parseo de cookies sin dependencia), `services/owner.js` (tabla `owner`), `services/mime.js`, `services/zip-writer.js` (ZIP de descarga del build, deflate/store, sin dependencias).
- **Modelo de datos**: además de lo documentado, `games.web_zip_file`/`web_zip_size` (ZIP del build web generado al subir; `download_file` queda solo para la descarga separada), `sessions.last_seen_at` (timeout por inactividad), `login_failures.lock_count` (backoff exponencial) y la tabla `owner(id=1, password_hash, totp_secret, totp_last_step, …)`. Tablas `STRICT`; marcas de tiempo en ms (INTEGER). Las rutas de disco se guardan relativas a `DATA_DIR` (`build_dir = <id>/<versión>`).
- **Objeto `game` para vistas**: añade `hasSeparateDownload` (para la casilla `remove_download`). `coverUrl` puede ser `null` (portada opcional). `createdAt`/`updatedAt` son ISO 8601.
- **Argumentos de vistas**: `renderSplash` recibe `latest` (hasta 4) y `renderCatalog` recibe `total`, a petición del frontend. `renderAdminForm.errors` usa la clave `_form` para errores generales.
- **Variables de entorno extra** (todas opcionales): `HOST`, `LOG_LEVEL`, `SESSION_IDLE_MINUTES` (60), `RATE_GLOBAL_PER_MIN` (300), `RATE_GAMES_PER_MIN` (1500), `RATE_LOGIN_PER_15MIN` (5), `RATE_DOWNLOAD_PER_10MIN` (20), `RATE_UPLOAD_PER_HOUR` (30), `LOGIN_LOCK_THRESHOLD` (10), `LOGIN_LOCK_MINUTES` (15), `CACHE_TTL_SECONDS` (30). Los límites se pueden ajustar pero no desactivar (mínimo 1); los tests los bajan para provocar 429/bloqueos rápido.
- **Límites de subida por defecto**: `MAX_BUILD_MB=90`, `MAX_DOWNLOAD_MB=95`, `MAX_COVER_MB=5` (Cloudflare rechaza cuerpos > 100 MB). Ojo: los tres archivos van en el mismo formulario; si build + descarga superan ~100 MB, súbelos en dos envíos (alta con el build, luego editar para añadir la descarga).
- **CSRF multipart**: el token se acepta en el campo `_csrf` o en la cabecera `X-CSRF-Token`; si llega la cabecera se valida antes de aceptar archivos. Sin cabecera, se valida tras multer (con sesión y `Origin` ya comprobados antes de leer el cuerpo) y los temporales se borran.
- **Login**: un CSRF de formulario caducado devuelve 403 con un mensaje propio («El formulario caducó…»), no el genérico; no revela nada sobre las credenciales. Durante un bloqueo de cuenta se devuelve el error genérico sin calcular scrypt. scrypt limitado a 2 cálculos simultáneos (cola de 16) para evitar agotar memoria.
- **Portadas de juegos ocultos**: `/media/portadas/:file` responde 404 salvo con sesión de propietario (`Cache-Control: private, no-store`).
- **Origen de juegos**: los juegos ocultos tampoco se sirven (no hay vista previa para el propietario). `connect-src 'self' blob: data:` (blob/data no salen a la red; algunos cargadores de Unity/Godot los usan). `/play/:id` redirige a `/play/:id/`. Range no implementado.
- **Slug**: se fija al crear y no cambia al editar el título (los enlaces compartidos no se rompen).
- **ZIP del build**: archivos ocultos (`.x`), `__MACOSX/`, `Thumbs.db` y `desktop.ini` se omiten en vez de rechazar el ZIP; `x.gz`/`x.br` exigen que la extensión interior también esté permitida; la entrada debe llamarse exactamente `index.html`.
- **`npm test`**: `node --test "tests/**/*.test.js"` en vez de `node --test tests/` (Node 24 no acepta un directorio como argumento de `--test`).
- **`overrides.uuid = 11.1.1`** en package.json: corrige el aviso moderado de `uuid` que arrastra `autocannon` (solo dev; hyperid usa `crypto.randomUUID` igualmente).
- **Secreto TOTP**: se guarda en claro en la BD (hace falta para verificar); la BD y las copias deben protegerse como un secreto.
