# parologames

Tu propia web para publicar juegos HTML5: la gente los juega en el navegador o los descarga, y solo tú puedes publicarlos.

- **Portada:** la consola se enciende con el logo parolo; el botón **Entrar** (o la tecla Intro) lleva a la estantería.
- **Estantería** (`/juegos`): cada juego es un cartucho con su etiqueta, del más nuevo al más antiguo, en páginas de 24.
- **Juego** (`/juegos/<nombre>`): el juego se carga solo al pulsar **Jugar**, aislado en un origen aparte. Tiene pantalla completa y botón **Descargar**.
- **Panel privado** (`/panel` por defecto): contraseña + código de verificación (2FA). Desde ahí subes, editas, ocultas y eliminas juegos.

Más detalles en [ARCHITECTURE.md](ARCHITECTURE.md) (cómo está hecho), [docs/DEPLOY.md](docs/DEPLOY.md) (cómo ponerlo en internet), [deploy/cloudflare.md](deploy/cloudflare.md) (protección contra ataques) y [SECURITY.md](SECURITY.md) (qué protege y qué no).

## Requisitos

- Node.js 24 o superior (incluye SQLite, no hace falta instalar una base de datos).
- Para producción: un servidor con Docker y un dominio (mejor dos: uno para la web y otro para los juegos).

## Arrancarlo en tu ordenador

```bash
npm install
```

```bash
npm run setup-admin
```

Te pide una contraseña (mínimo 12 caracteres) y te enseña un código QR en texto (`otpauth://…`) y una clave. Añádela a tu app de autenticación (Google Authenticator, Aegis, 1Password…) y escribe el código de 6 dígitos para confirmar. La clave solo se muestra una vez.

```bash
npm run seed-demo
```

Opcional: crea tres juegos de ejemplo («Demo: …») para ver la web con contenido. Puedes borrarlos desde el panel.

```bash
npm start
```

- Web: http://localhost:3000
- Juegos (origen aislado): http://127.0.0.1:3001
- Panel: http://localhost:3000/panel

## Variables de entorno

Copia `.env.example` a `.env` y rellénalo. En local todo tiene valores por defecto; en producción estas son obligatorias:

| Variable | Para qué |
|---|---|
| `NODE_ENV=production` | Activa cookies seguras, HSTS y confianza en el proxy. |
| `SITE_ORIGIN` | La dirección pública de la web, p. ej. `https://parologames.com`. |
| `GAMES_ORIGIN` | La dirección desde la que se sirven los juegos. Tiene que ser otro origen, p. ej. `https://parolo-play.com`. |
| `IP_HASH_SALT` | Texto aleatorio largo para anonimizar IPs en los registros. Genéralo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `ADMIN_PATH` | Ruta del panel. Cámbiala por algo difícil de adivinar. |
| `TRUST_PROXY` | Número de proxies delante (Caddy + Cloudflare). |
| `MAX_BUILD_MB`, `MAX_DOWNLOAD_MB`, `MAX_COVER_MB` | Límites de subida. |

La contraseña y la clave 2FA **no** van en `.env`: `npm run setup-admin` las guarda en la base de datos (la contraseña, solo como hash scrypt). Por eso la base de datos y sus copias son material sensible.

## Publicar un juego

1. Exporta tu juego para la web (Unity WebGL, Godot HTML5, Phaser, JS…) y comprímelo en un **ZIP** con `index.html` en la raíz (o dentro de una única carpeta).
2. Entra en el panel → **Subir juego**: título, frase corta, descripción, portada vertical (3:4) y el ZIP.
3. Opcional: una **descarga aparte** en ZIP (por ejemplo, la versión de escritorio). Si no la subes, la gente descarga la versión web.
4. Publicado u oculto, y si quieres destacarlo en la portada.

## Pruebas

```bash
npm test
```

Ejecuta las pruebas unitarias y de integración (autenticación, 2FA, CSRF, permisos del panel, subida y validación de ZIP, aislamiento del origen de juegos, cabeceras de seguridad, límites de peticiones, copias de seguridad).

```bash
npm run load-test -- --url http://localhost:3000
```

Prueba de carga contra tu propio servidor. Ver [docs/LOAD-TEST.md](docs/LOAD-TEST.md).

## Copias de seguridad

```bash
npm run backup
```

```bash
npm run restore -- <copia> --yes
```

Detalles, cifrado y copia fuera del servidor en [docs/DEPLOY.md](docs/DEPLOY.md).
