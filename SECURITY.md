# Seguridad de parologames

Este documento explica qué protege el sitio, qué riesgos quedan y qué tienes que configurar antes de
abrirlo al público. Ningún sitio es invulnerable: esto reduce mucho los riesgos, no los elimina.

Última auditoría: 26-10-2026 (revisión de código con OWASP Top 10 / ASVS nivel 2 y ataques reales
contra una instancia de prueba). Resultado: sin fallos críticos ni altos; se corrigieron tres puntos
menores (ver al final).

## Qué está protegido y cómo

- **Entrar al panel**: contraseña (mín. 12 caracteres, guardada con scrypt N=2^17, r=8, p=1) **más**
  un código TOTP de 6 dígitos. Un código ya usado no vale otra vez. Tras 10 fallos el panel se
  bloquea 15 min (y el doble cada vez que se repite, hasta 24 h); además, 5 intentos por IP cada 15 min.
- **Sesión**: cookie aleatoria de 32 bytes, `HttpOnly`, `Secure`, `SameSite=Strict`, prefijo `__Host-`.
  En la BD solo se guarda su huella (SHA-256). Caduca a las 8 h o tras 60 min sin actividad. Cada
  login crea una sesión nueva; «Salir» la borra. `setup-admin` cierra todas las sesiones.
- **Falsificación de peticiones (CSRF)**: cada acción del panel exige un token secreto y que la
  petición venga del propio sitio (cabecera `Origin`/`Sec-Fetch-Site`). El formulario de login también.
- **Inyección de código en páginas (XSS)**: todo texto (título, frase, descripción) se escapa al
  pintarse; política CSP estricta (solo scripts propios, sin `inline`).
- **Base de datos**: solo consultas preparadas (sin inyección SQL).
- **Subidas**: el ZIP se revisa entero antes de extraer: nada de `..`, rutas absolutas, barras
  invertidas, enlaces simbólicos, archivos cifrados, extensiones fuera de la lista (sin `.exe`, `.php`…),
  tamaños falsos ni bombas de descompresión. Portadas: solo PNG/JPEG/WebP reales (bytes mágicos) y
  servidas con `nosniff`.
- **Aislamiento de los juegos**: se sirven desde **otro origen** (`GAMES_ORIGIN`) dentro de un
  `<iframe sandbox>` sin permiso para abrir ventanas ni navegar la página principal. Ese origen nunca
  pone cookies, no ve las del sitio y solo puede incrustarse en tu sitio (`frame-ancestors`).
  Los juegos ocultos no se sirven.
- **Rutas de archivos**: `/play/<id>/…` rechaza `..`, `%2f`, `%5c`, ocultos y caracteres raros.
- **Abuso y caídas**: límites por IP (global, juegos, descargas, login, subidas), tiempos máximos
  contra conexiones lentas, cuerpos limitados; Cloudflare delante para absorber ataques grandes.
- **Errores**: las páginas de error no muestran detalles internos; los logs ocultan contraseñas,
  códigos, tokens y cookies; las IPs se guardan como huella (HMAC), nunca en claro.
- **Servidor**: contenedor sin root, sistema de archivos de solo lectura, sin capacidades extra,
  red interna sin salida a Internet; copias de seguridad cifrables con AES-256-GCM.

## Si pasa algo

Sigue `docs/DEPLOY.md` → **§11 Incidentes** (DDoS, sospecha de acceso al panel, disco lleno…).
Resumen para un acceso sospechoso: limita el panel a tu IP (`ADMIN_ALLOW_IPS`), borra las sesiones,
rota contraseña y TOTP con `npm run setup-admin`, revisa `audit_log` y los juegos cambiados.

Si alguien te avisa de un fallo de seguridad: agradécelo, pídele los pasos para reproducirlo en
privado y no publiques nada hasta haberlo corregido.

Si te quedas fuera por el bloqueo de intentos (por ejemplo, porque alguien lo provoca a propósito),
`npm run setup-admin` lo desbloquea.

## Riesgos que quedan (dichos con honestidad)

1. **El secreto TOTP está en claro en la BD** (hace falta para comprobar los códigos). Quien obtenga
   `parolo.db` o una copia sin cifrar tiene el secreto y el hash de la contraseña. Protege el servidor
   y cifra las copias.
2. **Todos los juegos comparten un mismo origen.** Un juego puede leer el `localStorage`/IndexedDB
   (partidas guardadas) de otro y pedir sus archivos. Sube solo juegos en los que confíes.
3. **Los juegos que subes son código de confianza dentro de su caja.** Pueden ejecutar cualquier
   JavaScript en el origen de juegos, mostrar ventanas `alert`, navegar su propio marco a otra web o,
   abiertos en pestaña nueva (sin JavaScript), mostrar lo que quieran a pantalla completa. No pueden
   tocar el sitio ni el panel.
4. **Hosts externos permitidos a los juegos** (`GAMES_CONNECT_SRC`, `GAMES_IMG_SRC`; hoy Wikidata y
   Wikimedia): cualquier juego puede conectar con ellos, no solo el que los necesita. Mantén la lista
   mínima.
5. **Bloqueo global del login**: el bloqueo por fallos es de la cuenta, no por IP. Alguien con varias
   IPs puede bloquear tu acceso un rato (no adivinar la contraseña). Recuperación: `setup-admin` o
   esperar; mejor aún, `ADMIN_ALLOW_IPS`.
6. **Una sola instancia con SQLite**: si el servidor cae, el sitio cae. Los contadores de límites
   están en memoria y se reinician al reiniciar la app.
7. **Dependencia de Cloudflare** para DDoS grandes y para ocultar la IP del servidor. Si alguien
   descubre la IP y el cortafuegos no está aplicado, puede atacar el origen directamente.
8. **Caché de CDN**: al ocultar o borrar un juego, Cloudflare puede seguir sirviendo sus archivos o la
   descarga unos minutos (las portadas ya publicadas, más). Purga la caché si es urgente.
9. **Copias**: sin `BACKUP_PASSPHRASE` se guardan sin cifrar. Restaurar un `.tar.gz` sin cifrar de
   origen dudoso confía en las protecciones de `tar`; restaura solo copias tuyas (las cifradas están
   autenticadas).
10. **Si `GAMES_ORIGIN` es un subdominio** (`play.tudominio.com`) en vez de otro dominio, comparte
    «sitio» con el panel a ojos del navegador. Las defensas actuales lo cubren (cookies `__Host-`,
    `Origin`, token), pero un dominio registrable distinto es más robusto.

## Lista de comprobación para producción

- [ ] `NODE_ENV=production` (activa `Secure`, `__Host-`, HSTS y exige https).
- [ ] `SITE_ORIGIN` y `GAMES_ORIGIN` en https y en **hosts distintos** (mejor dominios distintos).
- [ ] `IP_HASH_SALT` aleatoria de 32+ caracteres (nunca el valor de desarrollo).
- [ ] `ADMIN_PATH` cambiado a algo no adivinable, y `ADMIN_ALLOW_IPS` limitado a tus IPs si puedes.
- [ ] Propietario creado con `npm run setup-admin` (interactivo), contraseña larga y única,
      secreto TOTP solo en la app de autenticación (no en notas ni capturas).
- [ ] `TRUST_PROXY=1` **solo** detrás de Caddy (que reescribe `X-Forwarded-For`). Nunca expongas los
      puertos 3000/3001 directamente: alguien podría falsear su IP y saltarse los límites.
- [ ] Cortafuegos aplicado (`deploy/firewall-cloudflare.sh` o el del proveedor): 80/443 solo desde
      Cloudflare; SSH limitado.
- [ ] Cloudflare con proxy activo (nube naranja) en ambos dominios, SSL «Full (strict)».
- [ ] Límites de subida coherentes con Cloudflare (≤ 100 MB por envío en planes Free/Pro):
      el `.env.example` trae 200/500 MB; bájalos o sube en varios envíos.
- [ ] `BACKUP_PASSPHRASE` definida (copias cifradas) y guardada también fuera del servidor;
      copia programada y una restauración de prueba (`--verify-only`) hecha.
- [ ] `GAMES_CONNECT_SRC` / `GAMES_IMG_SRC` con lo mínimo imprescindible.
- [ ] `.env` con permisos `600`; `.local-admin.txt` (credenciales de prueba locales) borrado del servidor.
- [ ] Imágenes fijadas por versión/digest (`NODE_IMAGE=…@sha256:…`, Caddy) y `npm audit` revisado
      en cada actualización.

## Cambios hechos en esta auditoría

- `safeUrl` (vistas) rechaza `/\host` y caracteres de control, que el navegador podría interpretar
  como enlace a otro dominio (endurecimiento; hoy esos valores los genera el propio servidor).
- `/readyz` (fuera del limitador) hace una sola comprobación a la vez y reutiliza el resultado 1 s:
  ya no se puede forzar una escritura en disco por petición.
- `.dockerignore` excluye `.local-admin.txt`.
- Pruebas de regresión en `tests/security.test.js`.
