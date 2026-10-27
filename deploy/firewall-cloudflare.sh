#!/usr/bin/env bash
# deploy/firewall-cloudflare.sh — solo Cloudflare puede llegar a los puertos 80/443 del origen.
#
# Uso (como root, en el servidor; Debian/Ubuntu):
#   apt-get install -y ufw ipset curl
#   SSH_PORT=22 ./deploy/firewall-cloudflare.sh            # aplica
#   DRY_RUN=1 ./deploy/firewall-cloudflare.sh              # muestra lo que haría
#
# Variables:
#   SSH_PORT        puerto SSH (22)
#   SSH_ALLOW_FROM  IP/CIDR desde la que se permite SSH ("any" por defecto; mejor tu IP fija)
#   EXT_IF          interfaz pública (se detecta por la ruta por defecto)
#   DRY_RUN=1       no cambia nada
#
# IMPORTANTE — Docker se salta ufw:
#   Los puertos publicados por Docker (ports: "80:80") se enrutan por la cadena FORWARD/DOCKER
#   de iptables ANTES de que ufw los vea. Por eso este script, además de las reglas de ufw
#   (que protegen servicios del propio host), filtra en la cadena DOCKER-USER, que es la que
#   Docker reserva para reglas del administrador. Las listas de IPs van en ipsets (cf4/cf6),
#   que se reemplazan de forma atómica al volver a ejecutar el script.
#
# Persistencia: las reglas de iptables/ipset no sobreviven a un reinicio. Programa el script:
#   /etc/cron.d/parolo-firewall:
#     @reboot  root sleep 60 && /opt/parologames/deploy/firewall-cloudflare.sh >> /var/log/parolo-firewall.log 2>&1
#     17 4 * * 1 root /opt/parologames/deploy/firewall-cloudflare.sh >> /var/log/parolo-firewall.log 2>&1
#
# Mejor aún (si tu proveedor lo ofrece): un cortafuegos de red del proveedor (Hetzner Cloud
# Firewall, DigitalOcean Cloud Firewall, AWS Security Group…) con las mismas reglas. Filtra antes
# de que el tráfico llegue a la máquina y Docker no puede saltárselo. Este script sigue siendo útil
# como segunda capa.
#
# No lo ejecutes por SSH sin tener una consola de rescate del proveedor a mano la primera vez.

set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
SSH_ALLOW_FROM="${SSH_ALLOW_FROM:-any}"
DRY_RUN="${DRY_RUN:-0}"
TAG="parolo-cf"
CF_V4_URL="https://www.cloudflare.com/ips-v4"
CF_V6_URL="https://www.cloudflare.com/ips-v6"
STATE_DIR="/var/lib/parolo-firewall"

log() { printf '[firewall] %s\n' "$*"; }
die() { printf '[firewall] ERROR: %s\n' "$*" >&2; exit 1; }
run() {
  if [[ "$DRY_RUN" == "1" ]]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}

[[ $EUID -eq 0 ]] || die "ejecútalo como root"
for cmd in curl ufw ipset iptables ip6tables ip awk grep; do
  command -v "$cmd" >/dev/null 2>&1 || die "falta el comando '$cmd' (apt-get install -y ufw ipset curl iproute2)"
done
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || die "SSH_PORT no válido"

EXT_IF="${EXT_IF:-$(ip -o route show default | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')}"
[[ -n "$EXT_IF" ]] || die "no se pudo detectar la interfaz pública; define EXT_IF"
log "interfaz pública: $EXT_IF"

# ---------------------------------------------------------------- descargar rangos
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsS --proto '=https' --tlsv1.2 --max-time 20 --retry 3 "$CF_V4_URL" -o "$tmp/v4" || die "no se pudo descargar $CF_V4_URL"
curl -fsS --proto '=https' --tlsv1.2 --max-time 20 --retry 3 "$CF_V6_URL" -o "$tmp/v6" || die "no se pudo descargar $CF_V6_URL"

# Validación estricta: solo CIDR, y un número mínimo razonable (nunca aplicar una lista vacía o rara).
tr -d '\r' < "$tmp/v4" | grep -v '^\s*$' > "$tmp/v4.clean" || true
tr -d '\r' < "$tmp/v6" | grep -v '^\s*$' > "$tmp/v6.clean" || true
grep -Evq '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$' "$tmp/v4.clean" && die "lista IPv4 con líneas no válidas; no se aplica nada"
grep -Evq '^[0-9a-fA-F:]+/[0-9]{1,3}$' "$tmp/v6.clean" && die "lista IPv6 con líneas no válidas; no se aplica nada"
n4=$(wc -l < "$tmp/v4.clean"); n6=$(wc -l < "$tmp/v6.clean")
(( n4 >= 5 && n6 >= 3 )) || die "listas sospechosamente cortas (v4=$n4, v6=$n6); no se aplica nada"
log "rangos de Cloudflare: $n4 IPv4, $n6 IPv6"

mkdir -p "$STATE_DIR"
if [[ -f "$STATE_DIR/v4" ]] && ! cmp -s "$STATE_DIR/v4" "$tmp/v4.clean"; then
  log "AVISO: los rangos IPv4 de Cloudflare han cambiado: actualiza trusted_proxies en deploy/Caddyfile"
fi
if [[ -f "$STATE_DIR/v6" ]] && ! cmp -s "$STATE_DIR/v6" "$tmp/v6.clean"; then
  log "AVISO: los rangos IPv6 de Cloudflare han cambiado: actualiza trusted_proxies en deploy/Caddyfile"
fi

# ---------------------------------------------------------------- ipsets (reemplazo atómico)
load_set() { # nombre familia archivo
  local name="$1" family="$2" file="$3"
  run ipset create "$name" hash:net family "$family" -exist
  run ipset create "$name-new" hash:net family "$family" -exist
  run ipset flush "$name-new"
  while read -r cidr; do run ipset add "$name-new" "$cidr" -exist; done < "$file"
  run ipset swap "$name-new" "$name"
  run ipset destroy "$name-new"
}
load_set cf4 inet  "$tmp/v4.clean"
load_set cf6 inet6 "$tmp/v6.clean"

# ---------------------------------------------------------------- ufw (servicios del host)
run ufw default deny incoming
run ufw default allow outgoing
if [[ "$SSH_ALLOW_FROM" == "any" ]]; then
  run ufw limit "$SSH_PORT/tcp" comment 'ssh'
else
  run ufw allow from "$SSH_ALLOW_FROM" to any port "$SSH_PORT" proto tcp comment 'ssh'
fi

# Borrar reglas antiguas de Cloudflare (marcadas con el comentario) de mayor a menor número.
if [[ "$DRY_RUN" != "1" ]]; then
  old_rules="$(ufw status numbered | grep -F "# $TAG" | sed -E 's/^\[ *([0-9]+)\].*/\1/' | sort -rn || true)"
  for n in $old_rules; do
    ufw --force delete "$n" >/dev/null
  done
fi
while read -r cidr; do
  run ufw allow proto tcp from "$cidr" to any port 80,443 comment "$TAG"
done < <(cat "$tmp/v4.clean" "$tmp/v6.clean")
run ufw --force enable

# ---------------------------------------------------------------- DOCKER-USER (contenedores)
apply_docker_user() { # binario set
  local ipt="$1" set="$2"
  run "$ipt" -N DOCKER-USER 2>/dev/null || true
  # Quitar reglas previas de este script.
  if [[ "$DRY_RUN" != "1" ]]; then
    old="$("$ipt" -S DOCKER-USER | grep -F -- "--comment $TAG" | sed 's/^-A /-D /' || true)"
    while read -r rule; do
      [[ -n "$rule" ]] || continue
      read -ra args <<< "$rule"
      "$ipt" "${args[@]}"
    done <<< "$old"
  fi
  # Se insertan en orden inverso con -I 1 para que queden: established → CF → drop.
  for port in 443 80; do
    run "$ipt" -I DOCKER-USER 1 -i "$EXT_IF" -p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL \
      -m comment --comment "$TAG" -j DROP
  done
  for port in 443 80; do
    run "$ipt" -I DOCKER-USER 1 -i "$EXT_IF" -p tcp -m set --match-set "$set" src \
      -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -m comment --comment "$TAG" -j RETURN
  done
  run "$ipt" -I DOCKER-USER 1 -i "$EXT_IF" -m conntrack --ctstate RELATED,ESTABLISHED \
    -m comment --comment "$TAG" -j RETURN
}
apply_docker_user iptables cf4
apply_docker_user ip6tables cf6   # Docker ≥ 27 publica también por IPv6 (ip6tables) por defecto

if [[ "$DRY_RUN" != "1" ]]; then
  cp "$tmp/v4.clean" "$STATE_DIR/v4"
  cp "$tmp/v6.clean" "$STATE_DIR/v6"
fi
log "listo. Comprueba desde fuera: curl -m 5 -kI https://<IP-del-servidor>  → debe agotar el tiempo."
log "y a través de Cloudflare: curl -I https://<tu-dominio>/healthz → 200."
