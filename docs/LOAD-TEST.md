# Pruebas de carga

`scripts/load-test.js` usa [autocannon](https://github.com/mcollina/autocannon) (dependencia de
desarrollo; no va en la imagen de producción) para medir, una tras otra, cuatro rutas:
`/`, `/juegos`, la página de un juego y `/healthz`.

```bash
npm ci                                   # incluye devDependencies (autocannon)
npm start                                # en otra terminal (o la app en Docker)
npm run load-test -- --url http://localhost:3000 --duration 20 --connections 50
node scripts/load-test.js --game mi-juego --json > resultado.json
```

| Opción | Por defecto | |
|---|---|---|
| `--url` | `http://localhost:3000` | Origen a probar (solo el origen; se ignora la ruta). |
| `--duration`, `-d` | `10` | Segundos por ruta. |
| `--connections`, `-c` | `20` | Conexiones concurrentes. |
| `--pipelining`, `-p` | `1` | Peticiones en vuelo por conexión. |
| `--game`, `-g` | primer juego de `/juegos` | Slug de la página de juego. Si no hay juegos, se omite. |
| `--json` | no | Salida JSON en vez de tabla. |

Salida: por ruta, req/s medias, latencia p50/p97.5/p99 (ms), total, 2xx, no-2xx, **de ellas 429**,
5xx, errores de conexión y timeouts; al final, el estado de `/healthz` tras la carga.
Código de salida 1 si hubo 5xx, errores, timeouts o si `/healthz` no responde después.

## Los 429 son esperados

La app limita peticiones **por IP** (`src/security/limits.js`) y una prueba de carga sale de una
única IP. A los pocos cientos de peticiones el limitador empieza a responder **429**. Es el
comportamiento correcto y **no existe ni debe existir** un interruptor para desactivarlo en pruebas:
un atajo así acabaría activado en producción algún día.

Por eso esta prueba mide dos cosas:

1. **Rendimiento hasta el límite**: las primeras peticiones (2xx) dan una idea del coste de cada
   página. Para ver el coste sin limitador mira la latencia p50 de los 2xx en una prueba corta y
   con pocas conexiones (`-d 2 -c 5`).
2. **Comportamiento en sobrecarga**: con el limitador saturado, el servidor debe seguir vivo y
   responder 429 **rápido**. Criterios de aceptación:
   - 0 respuestas 5xx, 0 errores de conexión, 0 timeouts.
   - p99 de latencia baja (decenas de ms en local): rechazar debe ser barato.
   - `/healthz` responde (200 o 429) al terminar, y en cuanto pasa la ventana del limitador, 200.
   - La memoria del proceso vuelve a su nivel tras la prueba (`docker stats`).

Para medir el rendimiento «real» con muchos visitantes distintos haría falta generar carga desde
muchas IPs (varios equipos/servicios de carga), y en producción la mayor parte la absorbería la caché
de Cloudflare antes de llegar al origen.

## Dónde ejecutarla

- **En local o contra un servidor de pruebas**, no contra producción en horario de visitas.
- **No a través de Cloudflare**: el WAF, Bot Fight Mode y el rate limiting de Cloudflare te
  bloquearán (y es lo que deben hacer). Si quieres medir el origen de producción, hazlo desde el
  propio servidor contra el contenedor de la app en una ventana tranquila:
  ```bash
  # 1) instalar devDependencies en una copia de trabajo (con red normal)
  docker run --rm -v "$PWD":/w -w /w node:24-trixie-slim npm ci --no-audit --no-fund
  # 2) lanzar la prueba dentro de la red interna (sin salida a Internet) contra el contenedor
  docker run --rm --network parologames_backend -v "$PWD":/w -w /w node:24-trixie-slim \
    node scripts/load-test.js --url http://app:3000 -d 10 -c 20
  ```
- Nunca contra sitios de terceros.

## Interpretación rápida

| Observación | Significado probable |
|---|---|
| Muchos 429 y 0 errores | Correcto: el limitador protege. |
| 5xx bajo carga | Error en la app (mira `docker compose logs app`), BD bloqueada o falta de memoria. |
| Timeouts / errores de conexión | Proceso saturado de CPU o sin descriptores de archivo (`ulimits` en compose). |
| p99 de 429 alto (cientos de ms) | Algo caro ocurre antes del limitador; el limitador debe ir lo primero posible. |
| `/healthz` sin respuesta al final | El proceso se ha caído o colgado: incidente, investiga antes de desplegar. |
