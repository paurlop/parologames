# Cloudflare delante de parologames

Guía paso a paso para poner **los dos dominios** (sitio y juegos) detrás de Cloudflare, con el
servidor de origen cerrado a todo lo que no sea Cloudflare.

En los ejemplos: sitio `parologames.com`, juegos `parolo-play.com`, panel `/panel`.
Cambia los nombres por los tuyos (y `/panel` por tu `ADMIN_PATH`).

> Los nombres de menús de Cloudflare cambian de vez en cuando. Si algo no está donde dice esta guía,
> búscalo por su nombre en la barra de búsqueda del panel de Cloudflare.

---

## 0. Antes de empezar

- Servidor con Docker funcionando y `docker compose up -d` probado (ver `docs/DEPLOY.md`).
- Si la IP del servidor ya ha estado publicada en DNS sin proxy, considera pedir una IP nueva al
  proveedor: los históricos de DNS son públicos y permiten saltarse Cloudflare. El cortafuegos del
  paso 8 lo mitiga, pero una IP nunca expuesta es mejor.
- No alojes correo ni otros servicios con registros DNS sin proxy en la misma IP (lo revelarían).

## 1. Añadir las zonas

1. En <https://dash.cloudflare.com> → **Add a domain** → `parologames.com` → plan (Free sirve; ver
   límites al final).
2. Cambia los *nameservers* en tu registrador por los dos que te indica Cloudflare.
3. Repite para `parolo-play.com` si el origen de juegos es otro dominio registrable (recomendado,
   ver §10).
4. Espera a que ambas zonas aparezcan como **Active**.

## 2. DNS (siempre con proxy, nube naranja)

En cada zona → **DNS → Records**:

| Zona | Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|---|
| parologames.com | A | `@` | IPv4 del servidor | **Proxied** |
| parologames.com | AAAA | `@` | IPv6 del servidor (si tiene) | **Proxied** |
| parolo-play.com | A / AAAA | `@` | la misma IP | **Proxied** |

- Si quieres `www`: añade `www` (Proxied) y una **Redirect Rule** `www.parologames.com/*` →
  `https://parologames.com/${1}` (301). Caddy no sirve `www`.
- Si los juegos van en subdominio: un registro `play` en la zona principal, Proxied.
- **Ningún registro que apunte al servidor debe quedar en gris (DNS only).**

## 3. Certificados y SSL/TLS

### 3.1 Certificado de origen (recomendado)

Con el proxy activo, Let's Encrypt no puede validar el dominio por HTTP/TLS-ALPN de forma fiable.
Lo más simple y robusto es un **certificado de origen de Cloudflare** (válido hasta 15 años; solo
Cloudflare confía en él, lo cual da igual porque solo Cloudflare llega al origen).

1. Zona `parologames.com` → **SSL/TLS → Origin Server → Create Certificate**.
2. Clave RSA 2048 o ECDSA, hostnames `parologames.com, *.parologames.com`, validez 15 años, formato PEM.
3. En el servidor guarda el certificado y la clave:
   ```bash
   cd /opt/parologames
   nano deploy/certs/site.pem    # pega "Origin Certificate"
   nano deploy/certs/site.key    # pega "Private Key" (no se vuelve a mostrar)
   chmod 600 deploy/certs/*.key
   ```
4. Repite en la zona `parolo-play.com` → `deploy/certs/games.pem` / `games.key`.
   (Si los juegos están en `play.parologames.com`, el comodín `*.parologames.com` ya lo cubre:
   deja `CADDY_TLS_GAMES` comentado en `.env`.)
5. En `.env`:
   ```
   CADDY_TLS=/etc/caddy/certs/site.pem /etc/caddy/certs/site.key
   CADDY_TLS_GAMES=/etc/caddy/certs/games.pem /etc/caddy/certs/games.key
   ```
6. `docker compose up -d caddy` (o `docker compose restart caddy`).

`deploy/certs/.gitignore` impide que la clave acabe en git.

### 3.2 Alternativa: certificado de Caddy (ACME)

`CADDY_TLS=tu-email@example.com`. Funciona si emites el primer certificado con la nube en **gris**
(o con el reto DNS-01, que exige compilar Caddy con el módulo `caddy-dns/cloudflare` y un token de
API) y después vuelves a naranja. Las renovaciones por HTTP-01 detrás del proxy dependen de que
Cloudflare no redirija `/.well-known/acme-challenge/*`; por eso es la opción con más piezas.

### 3.3 Ajustes de SSL/TLS (en **cada** zona)

1. **SSL/TLS → Overview → Full (strict)**. Nunca *Flexible* (rompería las cookies `Secure` y crearía
   bucles de redirección).
2. **SSL/TLS → Edge Certificates**:
   - **Always Use HTTPS**: On.
   - **Minimum TLS Version**: 1.2.
   - **Automatic HTTPS Rewrites**: On.
   - **HSTS**: la app ya envía `Strict-Transport-Security`. No actives *preload* hasta llevar
     semanas sin problemas: es difícil de deshacer.
3. Opcional avanzado: **Authenticated Origin Pulls** (mTLS Cloudflare→origen). Requiere añadir
   `client_auth` a la directiva `tls` del Caddyfile; no viene configurado.

## 4. Seguridad general (cada zona)

1. **Security → WAF → Managed rules**: activa el conjunto gestionado disponible en tu plan
   (*Cloudflare Free Managed Ruleset* en Free; *Cloudflare Managed Ruleset* y *OWASP Core* en Pro+).
   Empieza en la acción por defecto y revisa **Security → Events** los primeros días por falsos positivos.
2. **Security → Bots → Bot Fight Mode**: On.
   - Ojo: en Free no se puede excluir rutas. Si tu monitor de disponibilidad empieza a recibir
     desafíos, mira el §9 o usa *Super Bot Fight Mode* (Pro) permitiendo bots verificados.
3. **Security → Settings**: Security Level *Medium*; **Browser Integrity Check** On.
4. Reglas personalizadas (**Security → WAF → Custom rules**), opcionales pero baratas:
   - Zona de juegos: *Block* si `not http.request.method in {"GET" "HEAD" "OPTIONS"}`.
   - Zona del sitio, si tienes IP fija: *Block* si
     `starts_with(http.request.uri.path, "/panel") and not ip.src in {203.0.113.7}`.
     (Es la misma idea que `ADMIN_ALLOW_IPS` en Caddy, pero en el borde.)

## 5. Limitación de peticiones (Rate limiting rules)

La app ya limita por IP (global, login, descargas, subidas). Cloudflare es la primera capa:
para el abuso antes de que cueste ancho de banda al origen.

**Security → WAF → Rate limiting rules → Create rule**:

**Regla A — descargas**
- Expresión:
  ```
  (starts_with(http.request.uri.path, "/juegos/") and ends_with(http.request.uri.path, "/descargar"))
  ```
- Características: *IP*. Umbral: p. ej. **10 peticiones / 10 s** (o 30/min si tu plan permite
  periodos más largos). Acción: *Block* 10 s (Free) o más.

**Regla B — login del panel**
- Expresión:
  ```
  (http.request.uri.path eq "/panel/entrar" and http.request.method eq "POST")
  ```
- Umbral: **5 peticiones / 10 s** por IP (más largo si tu plan lo permite: 10 / 1 min). Acción: *Block*.

En Free solo hay **una** regla de rate limiting: únelas con `or`:
```
(starts_with(http.request.uri.path, "/juegos/") and ends_with(http.request.uri.path, "/descargar"))
or (http.request.uri.path eq "/panel/entrar" and http.request.method eq "POST")
```

## 6. Caché (Caching → Cache Rules)

Orden de las reglas (la primera que coincide en *bypass* gana; colócalas así):

**Zona del sitio**

1. **Bypass panel y salud** — *Bypass cache* si:
   ```
   starts_with(http.request.uri.path, "/panel") or http.request.uri.path in {"/healthz" "/readyz"}
   ```
2. **Estáticos** — *Eligible for cache* si:
   ```
   starts_with(http.request.uri.path, "/static/") or starts_with(http.request.uri.path, "/media/")
   ```
   - Edge TTL: *Use cache-control header if present* (la app envía `immutable`, max-age largo) o,
     si quieres forzar, *Ignore cache-control header* → 1 mes.
   - Browser TTL: *Respect origin*.
3. Las páginas HTML (`/`, `/juegos`, `/juegos/:slug`) no se cachean por defecto: déjalo así.
4. **Descargas** (`/juegos/*/descargar`): no las cachees en el borde por defecto: la app limita y
   cuenta descargas, y las Condiciones de Cloudflare desaconsejan servir archivos grandes de forma
   desproporcionada desde la CDN gratuita. Si el volumen crece, la solución es almacenamiento de
   objetos (p. ej. R2) para los ZIP, no forzar la caché.

**Zona de juegos**

1. **Juegos** — *Eligible for cache* si `starts_with(http.request.uri.path, "/play/")`.
   - Edge TTL: respetar `Cache-Control` del origen (o 1 mes).
   - Si vuelves a subir un juego con el **mismo id**, purga: **Caching → Configuration → Custom Purge**
     → prefijo `https://parolo-play.com/play/<id>/`.
2. **Caching → Configuration → Browser Cache TTL**: *Respect existing headers*.

**Speed → Optimization**: desactiva *Rocket Loader* (rompe la CSP estricta y los juegos) y la
minificación automática si aparece. Brotli/zstd de Cloudflare: activo.

## 7. «Under Attack» (interruptor de emergencia)

**Overview → Quick Actions → Under Attack Mode: On**. Todos los visitantes pasan un desafío antes de
llegar al origen.

- Úsalo **solo en la zona del sitio** si es posible: en la zona de juegos el desafío ocurre dentro
  del `<iframe>` (contexto de terceros) y puede impedir jugar.
- Rompe los monitores de disponibilidad mientras está activo: es esperado.
- Desactívalo en cuanto pase el ataque (Security Level vuelve a *Medium*).
- Alternativa más fina: una regla personalizada con *Managed Challenge* solo en las rutas atacadas.

## 8. Cerrar el origen: solo Cloudflare llega a 80/443

1. **Primero**, en el panel de tu proveedor (si lo tiene) crea un cortafuegos de red: SSH desde tu IP
   (o cualquiera, con claves), TCP 80/443 solo desde los rangos de <https://www.cloudflare.com/ips/>.
   Filtra antes de llegar a la máquina y Docker no puede saltárselo.
2. **Además**, en el servidor (Debian/Ubuntu):
   ```bash
   sudo apt-get install -y ufw ipset curl
   sudo DRY_RUN=1 SSH_PORT=22 /opt/parologames/deploy/firewall-cloudflare.sh   # revisar
   sudo SSH_PORT=22 /opt/parologames/deploy/firewall-cloudflare.sh             # aplicar
   ```
   El script descarga `ips-v4` e `ips-v6`, los valida, los carga en ipsets y aplica reglas en ufw
   **y en la cadena `DOCKER-USER`** (Docker publica puertos por delante de ufw: sin esto, ufw no
   protegería a Caddy). Ten abierta la consola web/rescate del proveedor la primera vez.
3. Programa su repetición (reinicios y cambios de rangos) con el `cron.d` que aparece en la cabecera
   del script. Si avisa de que los rangos han cambiado, actualiza `trusted_proxies` en `deploy/Caddyfile`
   y recarga Caddy.
4. Comprueba:
   ```bash
   curl -m 5 -kI https://IP_DEL_SERVIDOR/      # desde tu PC: debe AGOTAR EL TIEMPO
   curl -I https://parologames.com/healthz     # a través de Cloudflare: 200
   ```

## 9. Monitores y Cloudflare

Los monitores externos (UptimeRobot, Better Stack…) pasan por Cloudflare como cualquier visitante.
Si Bot Fight Mode o Under Attack los desafían verás falsos «caídos». Opciones: aceptar ese ruido en
emergencias, crear una regla *Skip* para el User-Agent/IPs del monitor en `/healthz` (planes que lo
permitan), o usar un monitor de tipo *keyword* que tolere el desafío. No abras el origen al monitor.

## 10. ¿Por qué otro dominio registrable para los juegos?

Los juegos son código no confiable. El navegador aísla por **origen** (esquema+host+puerto) pero
varias protecciones funcionan por **sitio** (dominio registrable, «eTLD+1»):

| Con `parolo-play.com` (otro sitio) | Con `play.parologames.com` (mismo sitio) |
|---|---|
| Un juego no puede fijar cookies para `parologames.com`. | Un juego puede fijar cookies `Domain=.parologames.com` que el sitio recibirá (*cookie tossing*): fijación de sesión, inyección de tokens. |
| `SameSite=Lax/Strict` protege al sitio frente a peticiones originadas en el juego. | Las peticiones del juego al sitio son *same-site*: `SameSite` no las frena. |
| Si Safe Browsing marca un juego, se marca `parolo-play.com`. | Puede arrastrar la reputación de `parologames.com` entera. |
| Dos zonas, dos certificados de origen. | Una zona, un certificado comodín. |

**Si solo puedes usar un subdominio**, la app debe cumplir todo esto (compruébalo en `src/security/`
antes de desplegar así):
- Usar cookies con prefijo `__Host-` (sin `Domain`, `Path=/`, `Secure`), que un subdominio no puede
  sobrescribir, y `SameSite=Strict` en las del panel.
- No depender de `SameSite` para CSRF: tokens CSRF ligados a la sesión y comprobación estricta de
  `Origin` exacto (no «termina en .parologames.com»).
- Mantener `frame-ancestors` del origen de juegos limitado al origen exacto del sitio.
- No usar nunca cookies en el origen de juegos.

En Cloudflare cambia poco: una sola zona, el registro `play` con proxy, las reglas de caché y WAF de
«zona de juegos» se escriben en la misma zona con `http.host eq "play.parologames.com"`.

## 11. Límites de Cloudflare que afectan a esta app

- **Tamaño del cuerpo**: Free y Pro aceptan como máximo **100 MB** por petición (Business 200 MB,
  Enterprise más). Con los valores por defecto (`MAX_BUILD_MB=200`, `MAX_DOWNLOAD_MB=500`) una subida
  grande desde el panel **fallará con 413 en Cloudflare** aunque Caddy y la app la aceptarían.
  Opciones:
  1. Mantener cada subida por debajo de ~95 MB en total (build + descarga + portada en el mismo
     formulario) y ajustar `MAX_BUILD_MB` / `MAX_DOWNLOAD_MB` a tu plan para que el panel avise antes
     de que lo haga Cloudflare con un error genérico.
  2. Subir de plan si necesitas builds más grandes.
  - No se recomienda abrir un acceso directo al origen «solo para subir»: revela la IP, obliga a
    abrir el cortafuegos y la comprobación de `Origin` de la app y el HSTS del dominio lo complican.
- **Tiempo de respuesta**: Cloudflare corta con **524** si el origen tarda más de 100 s en empezar a
  responder. Procesar un ZIP muy grande puede superarlo; la subida se completa en el servidor de
  todos modos (la app usa claves de idempotencia, así que reintentar no duplica el juego).
