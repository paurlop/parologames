# Despliegue y operación de parologames

Manual de producción: desde un servidor vacío hasta saber qué hacer cuando algo va mal.
Complementos: `deploy/cloudflare.md` (CDN, WAF, cortafuegos) y `docs/LOAD-TEST.md`.

**Nada garantiza el 100 % de disponibilidad.** Este diseño (un servidor + CDN + copias probadas)
busca que las caídas sean raras, cortas y sin pérdida de datos importante, no imposibles.

---

## 1. Qué hace el código y qué depende del proveedor

| Lo hace el código de este repositorio | Depende del servidor / proveedor / de ti |
|---|---|
| Imagen no-root, sistema de archivos de solo lectura salvo el volumen, sin capacidades, sin red de salida (`docker-compose.yml`). | Que el servidor tenga parches, SSH con claves y cortafuegos (§9). |
| Apagado ordenado con SIGTERM (tini → Node). Healthcheck `/healthz`. `restart: unless-stopped`. | Que Docker arranque al iniciar la máquina (`systemctl enable docker`). Que alguien reciba las alertas. |
| TLS hacia Cloudflare, límites de cuerpo, IP real del visitante, logs JSON sin IP completa (Caddy). | DNS, certificados de origen, WAF, rate limiting y caché en Cloudflare (`deploy/cloudflare.md`). |
| Copia consistente, verificada (SHA-256), cifrada y rotada (`scripts/backup.js`). | **Programarla**, sacarla del servidor (offsite) y **probar a restaurar**. |
| Restauración que verifica antes de tocar nada y no borra los datos anteriores (`scripts/restore.js`). | Guardar `BACKUP_PASSPHRASE` fuera del servidor. Sin ella las copias cifradas no sirven. |
| Limitadores por IP, bloqueo de login, auditoría (`src/security/`). | Disco suficiente, ancho de banda, la red del centro de datos. |

## 2. Dimensionado: un servidor pequeño + CDN

**Recomendación:** un VPS de 1–2 vCPU y 2 GB de RAM (p. ej. Hetzner CX22, DigitalOcean/Linode
básico, OVH/Scaleway equivalentes) con 40+ GB de disco SSD, Debian 12/13 o Ubuntu 24.04 LTS.

Por qué basta:
- Un solo autor escribe; el público solo lee. SQLite en WAL atiende miles de lecturas por segundo
  en un núcleo, y la app cachea en memoria.
- Lo pesado (archivos de los juegos, portadas, estáticos) lo sirve **la caché de Cloudflare**; el
  origen solo ve las primeras peticiones de cada archivo y el HTML.
- Menos piezas = menos cosas que se rompen: no hay servidor de BD, ni colas, ni balanceador.

Disco: estima `tamaño de todos los juegos × (1 en vivo + copias locales comprimidas)`. Con
`BACKUP_KEEP=14` y 2 GB de juegos, ~30 GB de copias locales si no cambian (gzip comprime poco los
binarios de los juegos). Baja `BACKUP_KEEP` si el disco es pequeño: lo importante es la copia offsite.

**Cuándo escalar y qué implicaría (honestamente):**
- Primero: subir de VPS (más CPU/RAM) — cambio de minutos. Después: mejorar la caché en Cloudflare.
- Varias instancias de la app **no** son un cambio de configuración. Harían falta:
  1. Almacenamiento compartido para `games/`, `covers/`, `downloads/` (almacenamiento de objetos
     tipo S3/R2 con cambios en el código de subida y servido, o un sistema de archivos de red).
  2. Pasar de SQLite a PostgreSQL (SQLite no admite escritores en varias máquinas) y adaptar
     `src/db.js` y las consultas.
  3. Limitadores con estado compartido (Redis o similar) en lugar de memoria por proceso.
  4. Un balanceador y sesiones que funcionen en cualquier instancia (ya están en BD).
- Para un sitio de un solo autor, eso solo compensa con tráfico muy alto **en el origen** sostenido
  (no picos que absorbe la CDN). Mide antes (`docs/LOAD-TEST.md`, métricas del VPS).

## 3. Primer despliegue paso a paso

En el servidor, como un usuario con `sudo` (no root directo):

```bash
# 3.1 Sistema al día y Docker oficial
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://get.docker.com -o get-docker.sh   # revisa el script antes de ejecutarlo
sudo sh get-docker.sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # cierra sesión y vuelve a entrar
docker --version && docker compose version

# 3.2 Código
sudo mkdir -p /opt/parologames && sudo chown "$USER": /opt/parologames
git clone <URL-del-repo> /opt/parologames
cd /opt/parologames

# 3.3 Configuración
cp .env.example .env && chmod 600 .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → IP_HASH_SALT
#   (sin Node en el host: docker run --rm node:24-trixie-slim node -e "…mismo comando…")
nano .env    # SITE_ORIGIN, GAMES_ORIGIN, SITE_DOMAIN, GAMES_DOMAIN, ADMIN_PATH, IP_HASH_SALT,
             # CADDY_TLS(_GAMES), BACKUP_PASSPHRASE (guárdala también en tu gestor de contraseñas)

# 3.4 Certificados de origen de Cloudflare → deploy/certs/ (ver deploy/cloudflare.md §3)

# 3.5 Construir y arrancar
export APP_TAG=$(git rev-parse --short HEAD)
echo "APP_TAG=$APP_TAG" >> .env      # o edita la línea APP_TAG existente
docker compose build app
docker compose up -d
docker compose ps                   # app debe estar "healthy"
docker compose logs -f --tail=100

# 3.6 Cuenta del propietario (contraseña + TOTP)
docker compose exec app npm run setup-admin
#   alternativa sin npm: docker compose exec app node scripts/setup-admin.js

# 3.7 Cortafuegos solo-Cloudflare (deploy/cloudflare.md §8) y primera copia
sudo DRY_RUN=1 ./deploy/firewall-cloudflare.sh && sudo ./deploy/firewall-cloudflare.sh
docker compose --profile backup run --rm backup
```

Comprobación final: `https://SITE_DOMAIN/healthz` → 200, entrar al panel, subir un juego pequeño,
jugarlo y descargarlo desde un móvil con datos (no desde la wifi de casa).

## 4. Actualizaciones con vuelta atrás

Cada imagen se etiqueta con el **git sha** (o una versión). La etiqueta anterior se conserva para
volver a ella en segundos.

### 4.1 Construyendo en el servidor

```bash
cd /opt/parologames
docker compose --profile backup run --rm backup        # copia ANTES de actualizar (siempre)
PREV=$(grep '^APP_TAG=' .env | cut -d= -f2); echo "anterior: $PREV" | tee -a deploy.log
git fetch && git checkout <commit-o-tag>
NEW=$(git rev-parse --short HEAD)
APP_TAG=$NEW docker compose build app
sed -i "s/^APP_TAG=.*/APP_TAG=$NEW/" .env
docker compose up -d app
docker compose ps && curl -fsS https://SITE_DOMAIN/healthz
```

### 4.2 Con un registro (GHCR, Docker Hub…)

Construye y publica en CI `ghcr.io/<usuario>/parologames:<sha>`; en el servidor pon
`APP_IMAGE=ghcr.io/<usuario>/parologames` y:

```bash
sed -i "s/^APP_TAG=.*/APP_TAG=<sha-nuevo>/" .env
docker compose pull app && docker compose up -d app
```

### 4.3 Volver atrás

```bash
sed -i "s/^APP_TAG=.*/APP_TAG=$PREV/" .env
docker compose up -d app
```

**Cuidado con las migraciones:** `src/db.js` migra la BD hacia delante (`PRAGMA user_version`) al
arrancar. Si la versión nueva migró el esquema, la antigua puede no entenderlo. En ese caso: para la
app, restaura la copia hecha justo antes de actualizar (§6) y arranca la etiqueta anterior. Se
perderá lo publicado entre medias (por eso la copia previa y actualizar en momentos tranquilos).

No borres imágenes antiguas a ciegas: `docker image prune` (sin `-a`) solo quita las huérfanas.
Conserva al menos las dos últimas etiquetas.

## 5. Copias automáticas

`scripts/backup.js` (ver cabecera del archivo): `VACUUM INTO` (consistente con la app en marcha),
copia de `games/ covers/ downloads/`, `manifest.json` con SHA-256, `.tar.gz`, cifrado AES-256-GCM
si hay `BACKUP_PASSPHRASE`, y rotación (`BACKUP_KEEP`). Sale con código ≠ 0 si algo falla.
Las copias quedan en el volumen: `/var/lib/parolo/backups/` dentro del contenedor.

### 5.1 Temporizador systemd (diario, 03:30)

`/etc/systemd/system/parolo-backup.service`:
```ini
[Unit]
Description=Copia de seguridad de parologames
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/parologames
ExecStart=/usr/bin/docker compose --profile backup run --rm backup
ExecStartPost=/usr/local/bin/parolo-offsite.sh
# Opcional: aviso si falla → OnFailure=parolo-alert.service (en [Unit])
```

`/etc/systemd/system/parolo-backup.timer`:
```ini
[Unit]
Description=Copia diaria de parologames

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now parolo-backup.timer
systemctl list-timers parolo-backup.timer
journalctl -u parolo-backup.service -n 50
```

(Con cron: `30 3 * * * cd /opt/parologames && docker compose --profile backup run --rm backup && /usr/local/bin/parolo-offsite.sh`.)

### 5.2 Copia fuera del servidor con rclone (ejemplo)

Una copia que solo vive en el mismo disco no es una copia. Configura `rclone config` (Backblaze B2,
S3, R2, Hetzner Storage Box…) como root y crea `/usr/local/bin/parolo-offsite.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SRC="$(docker volume inspect -f '{{ .Mountpoint }}' parologames_parolo-state)/backups"
# copy (no sync): borrar localmente no borra lo remoto. Solo copias cifradas.
rclone copy "$SRC" offsite:parolo-backups --include 'parolo-*.tar.gz.enc' --immutable
# Aviso de «hombre muerto»: si este ping no llega en 26 h, el servicio de monitorización avisa.
curl -fsS -m 10 --retry 3 https://hc-ping.com/<tu-uuid> >/dev/null || true
```

- Retención remota con reglas de ciclo de vida del bucket (p. ej. 30 diarias + 12 mensuales).
- Si puedes, credenciales de rclone que **no** permitan borrar (o bucket con bloqueo de objetos):
  protege contra ransomware o un atacante con acceso al servidor.

## 6. Restaurar (y simulacro mensual)

`scripts/restore.js` prepara la copia junto a `DATA_DIR`, verifica **cada SHA-256**, que no sobren
archivos y la integridad de la BD **antes** de tocar los datos vivos; se niega sin `--yes`; se niega
si la BD está bloqueada; aparta los datos actuales a `data.before-restore-<fecha>` (no los borra).

### 6.1 Restauración real

```bash
cd /opt/parologames
docker compose stop app                         # Caddy sigue arriba y responde 502 mientras tanto
docker compose --profile backup run --rm backup ls -l /var/lib/parolo/backups
docker compose --profile backup run --rm backup \
  node scripts/restore.js /var/lib/parolo/backups/parolo-<fecha>.tar.gz.enc --verify-only
docker compose --profile backup run --rm backup \
  node scripts/restore.js /var/lib/parolo/backups/parolo-<fecha>.tar.gz.enc --yes
docker compose start app && docker compose ps
```

Traer una copia offsite al volumen:
```bash
rclone copy offsite:parolo-backups/parolo-<fecha>.tar.gz.enc /tmp/
docker run --rm --user node -v parologames_parolo-state:/var/lib/parolo -v /tmp:/in:ro \
  --entrypoint cp parologames:$APP_TAG /in/parolo-<fecha>.tar.gz.enc /var/lib/parolo/backups/
```

Cuando compruebes que todo está bien, borra el directorio apartado
(`/var/lib/parolo/data.before-restore-<fecha>` dentro del volumen).

### 6.2 Simulacro (una vez al mes, 10 minutos)

Restaura la última copia **offsite** en un volumen desechable y arranca una app temporal sin tocar
producción:

```bash
read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE       # no queda en el historial
rclone copy offsite:parolo-backups/<la-mas-reciente>.tar.gz.enc /tmp/drill/
docker run --rm --network none -e BACKUP_PASSPHRASE -e DATA_DIR=/var/lib/parolo/data \
  -v parolo-drill:/var/lib/parolo -v /tmp/drill:/in:ro parologames:$APP_TAG \
  node scripts/restore.js /in/<la-mas-reciente>.tar.gz.enc --yes
docker run --rm -d --name parolo-drill --env-file .env -e BACKUP_PASSPHRASE= \
  -e SITE_ORIGIN=http://127.0.0.1:3100 -e GAMES_ORIGIN=http://127.0.0.1:3101 -e NODE_ENV=development \
  -v parolo-drill:/var/lib/parolo -p 127.0.0.1:3100:3000 -p 127.0.0.1:3101:3001 parologames:$APP_TAG
curl -fsS http://127.0.0.1:3100/healthz && curl -fsS http://127.0.0.1:3100/juegos | head
docker stop parolo-drill && docker volume rm parolo-drill && rm -rf /tmp/drill
unset BACKUP_PASSPHRASE
```

Anota fecha, copia usada y tiempo total. Si el simulacro falla, la copia **no existe**.

## 7. Monitorización

- **Externa** (UptimeRobot, Better Stack, Healthchecks…), cada 1–5 min, alerta por email/móvil:
  - `https://SITE_DOMAIN/healthz` (espera 200).
  - Origen de juegos: `https://GAMES_DOMAIN/healthz` si la app de juegos lo expone; si no, un archivo
    real como `https://GAMES_DOMAIN/play/<id>/index.html`.
  - Un *heartbeat* para las copias (el `curl hc-ping` del §5.2).
  - Ver `deploy/cloudflare.md` §9 sobre monitores y Bot Fight Mode.
- **En el servidor**:
  ```bash
  docker compose ps                       # estado y salud
  docker compose logs -f --tail=200 app   # logs JSON de la app
  docker compose logs -f caddy            # accesos (IPs truncadas)
  docker inspect -f '{{.RestartCount}} {{.State.Health.Status}}' parologames-app-1
  ```
- **Reinicios y salud:** Docker **no** reinicia un contenedor por estar `unhealthy`, solo si el
  proceso termina. Vigilante sencillo (`/etc/cron.d/parolo-watch`, cada 5 min):
  ```
  */5 * * * * root cd /opt/parologames && s=$(docker inspect -f '{{.State.Health.Status}}' parologames-app-1 2>/dev/null); [ "$s" = unhealthy ] && docker compose restart app && logger -t parolo "app unhealthy: reiniciada"
  ```
  y que tu monitor externo te avise igualmente (los reinicios repetidos son un síntoma, no la cura).
- Métricas del VPS (CPU, RAM, disco) en el panel del proveedor; alerta de disco al 80 %.

## 8. Logs y rotación

- Contenedores: driver `json-file` con `max-size: 10m`, `max-file: 5` (≤ 50 MB por servicio), ya en
  `docker-compose.yml`. Para que valga también para otros contenedores, en `/etc/docker/daemon.json`:
  ```json
  { "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
  ```
  y `sudo systemctl restart docker`.
- journald: `sudo journalctl --vacuum-size=500M` y `SystemMaxUse=500M` en `/etc/systemd/journald.conf`.
- Los logs de la app redactan campos sensibles y los de Caddy truncan IPs y eliminan cookies.
  Aun así son datos personales: no los guardes más de lo necesario.

## 9. Endurecimiento del servidor (checklist)

- [ ] Usuario no root con `sudo`; acceso SSH **solo con claves** (`ssh-copy-id`).
- [ ] `/etc/ssh/sshd_config.d/10-hardening.conf`:
      `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`,
      `AllowUsers <tu-usuario>`; `sudo systemctl reload ssh` (prueba en otra sesión antes de cerrar).
- [ ] Parches automáticos: `sudo apt-get install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`;
      reinicia cuando lo pida (`/var/run/reboot-required`) en horas tranquilas.
- [ ] Cortafuegos: SSH + 80/443 **solo Cloudflare** (`deploy/firewall-cloudflare.sh` y cortafuegos del proveedor).
- [ ] Opcional: `fail2ban` para SSH (con claves solo, el beneficio es sobre todo menos ruido en logs).
- [ ] `.env` con `chmod 600`, propietario tu usuario; `deploy/certs/*.key` con `chmod 600`.
- [ ] Docker al día (`apt-get upgrade` lo incluye si se instaló desde el repo oficial).
- [ ] Imagen base reconstruida al menos mensualmente (`docker compose build --pull app`) para
      recoger parches de Debian/Node, aunque no cambie el código.
- [ ] Copias offsite funcionando y simulacro hecho (§6.2).
- [ ] 2FA en la cuenta del proveedor del VPS, en Cloudflare, en el registrador y en git.

## 10. Rotación de secretos

| Secreto | Cómo | Efecto |
|---|---|---|
| Contraseña y TOTP del propietario | `docker compose exec app npm run setup-admin` | Registra un nuevo TOTP en tu app de autenticación. Purga sesiones (§11.2) para expulsar a cualquiera. |
| `IP_HASH_SALT` | Genera otro (comando del §3.3), cámbialo en `.env`, `docker compose up -d app` | Los hashes de IP antiguos (auditoría, bloqueos) dejan de correlacionar con los nuevos; puede cerrar sesiones ligadas a la IP. |
| `BACKUP_PASSPHRASE` | Cámbiala en `.env` y en tu gestor | Las copias nuevas usan la nueva. **Guarda la antigua** mientras existan copias cifradas con ella. |
| Certificado de origen | Crea uno nuevo en Cloudflare, sustituye `deploy/certs/*`, `docker compose restart caddy`, revoca el viejo | Ninguno visible. |
| Claves SSH / tokens de rclone y Cloudflare | En cada servicio | — |

## 11. Incidentes

Regla general: **primero estabilizar, luego investigar, luego escribir qué pasó** (fecha, síntomas,
qué hiciste, qué cambiarás).

### 11.1 El sitio está bajo DDoS o tráfico abusivo
1. Cloudflare → zona del sitio → **Under Attack Mode: On** (`deploy/cloudflare.md` §7).
2. **Security → Events**: identifica rutas/países/ASN; crea reglas *Block* o *Managed Challenge* concretas.
3. Comprueba que el origen no recibe tráfico directo: `docker compose logs caddy | tail` — todas las
   IPs deben ser de visitantes vía Cloudflare. Si no, revisa el cortafuegos (§9).
4. La app seguirá respondiendo 429 a quien abuse; si el VPS está al 100 % de CPU, súbelo de tamaño
   temporalmente.
5. Desactiva Under Attack cuando pase.

### 11.2 Sospecha de acceso indebido al panel
1. Restringe ya el panel: `ADMIN_ALLOW_IPS=<tu IP>/32` en `.env` → `docker compose up -d caddy`.
2. Expulsa todas las sesiones:
   ```bash
   docker compose exec app node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DATA_DIR+'/parolo.db');console.log(db.prepare('DELETE FROM sessions').run());db.close()"
   ```
3. Rota contraseña y TOTP (`setup-admin`) desde un equipo de confianza.
4. Revisa la auditoría:
   ```bash
   docker compose exec app node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DATA_DIR+'/parolo.db',{readOnly:true});console.table(db.prepare('SELECT at,event,ip_hash,detail_json FROM audit_log ORDER BY id DESC LIMIT 100').all())"
   ```
5. Revisa los juegos publicados/modificados recientemente; si alguno es ajeno, ocúltalo o elimínalo
   y purga la caché de Cloudflare del origen de juegos.
6. Si hay dudas sobre la integridad del servidor (no solo del panel): reconstruye un VPS limpio
   desde este manual y restaura la última copia **anterior** al incidente.

### 11.3 Disco lleno
Síntomas: fallan subidas, errores `SQLITE_FULL`, la app se reinicia.
```bash
df -h; docker system df
sudo du -sh "$(docker volume inspect -f '{{ .Mountpoint }}' parologames_parolo-state)"/*
```
- Directorios `data.before-restore-*` antiguos dentro del volumen: bórralos si ya no los necesitas.
- Baja `BACKUP_KEEP` y ejecuta una copia (la rotación borra las sobrantes) — solo si el offsite está al día.
- `docker image prune` (conserva las dos últimas etiquetas), `journalctl --vacuum-size=200M`.
- `data/tmp/`: restos de subidas interrumpidas (con la app parada se pueden borrar).
- Si sigue lleno: amplía el disco/volumen en el proveedor.

### 11.4 Base de datos corrupta
Síntomas: errores `SQLITE_CORRUPT` o `database disk image is malformed`, `/readyz` falla.
1. `docker compose stop app`.
2. Diagnóstico: `docker compose --profile backup run --rm backup node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DATA_DIR+'/parolo.db');console.log(db.prepare('PRAGMA integrity_check').all())"`
3. Restaura la última copia buena (§6.1). Los datos actuales quedan apartados en
   `data.before-restore-*` por si hace falta rescatar algo (p. ej. juegos subidos tras la copia:
   sus archivos siguen en `games/` del directorio apartado; vuelve a publicarlos desde el panel).
4. Arranca, comprueba, y busca la causa (disco lleno, apagado brusco, fallo del proveedor).

### 11.5 La app no arranca tras actualizar
`docker compose logs app` → si es configuración (`Configuración inválida: …`), corrige `.env`.
Si es el código: vuelve a la etiqueta anterior (§4.3).
