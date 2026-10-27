#!/usr/bin/env node
// Prueba de carga con autocannon (devDependency). Ver docs/LOAD-TEST.md.
//   npm run load-test -- --url http://localhost:3000 --duration 20 --connections 50
//   node scripts/load-test.js --game mi-juego --json > resultado.json
// Mide /, /juegos, la página de un juego y /healthz. Sale con 1 si hubo 5xx, errores,
// timeouts o si /healthz no responde al terminar. Los 429 del limitador son esperados.
import { parseArgs } from 'node:util';
import autocannon from 'autocannon';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    duration: { type: 'string', short: 'd', default: '10' },
    connections: { type: 'string', short: 'c', default: '20' },
    pipelining: { type: 'string', short: 'p', default: '1' },
    game: { type: 'string', short: 'g' },
    json: { type: 'boolean', default: false },
  },
});

const origin = new URL(opt.url).origin;
const duration = Number(opt.duration); const connections = Number(opt.connections); const pipelining = Number(opt.pipelining);
if (![duration, connections, pipelining].every((n) => Number.isInteger(n) && n > 0)) {
  process.stderr.write('duration, connections y pipelining deben ser enteros positivos\n');
  process.exit(2);
}

async function firstGameSlug() {
  try {
    const html = await (await fetch(`${origin}/juegos`)).text();
    return html.match(/href="\/juegos\/([a-z0-9-]+)"/)?.[1] ?? null;
  } catch { return null; }
}

function runOne(path) {
  return new Promise((resolve, reject) => {
    const counts = { s429: 0, s5xx: 0 };
    const inst = autocannon({ url: origin + path, duration, connections, pipelining }, (err, res) => (err ? reject(err) : resolve({ res, counts })));
    inst.on('response', (_client, statusCode) => {
      if (statusCode === 429) counts.s429++;
      else if (statusCode >= 500) counts.s5xx++;
    });
  });
}

const slug = opt.game ?? await firstGameSlug();
const paths = ['/', '/juegos', ...(slug ? [`/juegos/${slug}`] : []), '/healthz'];
const results = [];
for (const path of paths) {
  const { res, counts } = await runOne(path);
  results.push({
    path,
    reqPerSec: res.requests.average,
    latencyMs: { p50: res.latency.p50, p97_5: res.latency.p97_5, p99: res.latency.p99 },
    total: res.requests.total,
    s2xx: res['2xx'],
    non2xx: res.non2xx,
    s429: counts.s429,
    s5xx: counts.s5xx,
    errors: res.errors,
    timeouts: res.timeouts,
  });
}

let healthAfter = null;
try { healthAfter = (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(5000) })).status; } catch { healthAfter = null; }

const failed = results.some((r) => r.s5xx > 0 || r.errors > 0 || r.timeouts > 0) || ![200, 429].includes(healthAfter);

if (opt.json) {
  process.stdout.write(JSON.stringify({ origin, duration, connections, pipelining, results, healthAfter, ok: !failed }, null, 2) + '\n');
} else {
  const pad = (s, n) => String(s).padEnd(n);
  process.stdout.write(`${origin}  ${duration}s/ruta  ${connections} conexiones  pipelining ${pipelining}\n\n`);
  process.stdout.write(`${pad('ruta', 28)}${pad('req/s', 10)}${pad('p50', 7)}${pad('p97.5', 7)}${pad('p99', 7)}${pad('total', 9)}${pad('2xx', 8)}${pad('no-2xx', 8)}${pad('429', 8)}${pad('5xx', 6)}${pad('err', 6)}timeouts\n`);
  for (const r of results) {
    process.stdout.write(`${pad(r.path.slice(0, 27), 28)}${pad(r.reqPerSec, 10)}${pad(r.latencyMs.p50, 7)}${pad(r.latencyMs.p97_5, 7)}${pad(r.latencyMs.p99, 7)}${pad(r.total, 9)}${pad(r.s2xx, 8)}${pad(r.non2xx, 8)}${pad(r.s429, 8)}${pad(r.s5xx, 6)}${pad(r.errors, 6)}${r.timeouts}\n`);
  }
  process.stdout.write(`\n/healthz tras la carga: ${healthAfter ?? 'sin respuesta'}\n${failed ? 'RESULTADO: FALLO' : 'RESULTADO: OK'}\n`);
}
process.exit(failed ? 1 : 0);
