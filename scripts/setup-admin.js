#!/usr/bin/env node
// Crea o cambia la contraseña y el secreto TOTP del propietario (guardados hasheados en la BD).
//
//   npm run setup-admin                    interactivo: contraseña (x2) + nuevo TOTP con confirmación
//   npm run setup-admin -- --rotate-totp   interactivo: solo un nuevo secreto TOTP
//   SETUP_PASSWORD=... node scripts/setup-admin.js --yes                 no interactivo (CI/tests)
//   node scripts/setup-admin.js --rotate-totp --yes                       rota TOTP sin preguntar
//
// En modo no interactivo se imprime el secreto (TOTP_SECRET=...) y no se pide código.
// Cambiar las credenciales cierra todas las sesiones abiertas.
import readline from 'node:readline';
import path from 'node:path';
import { resolveDataDir, dataPaths } from '../src/config.js';
import { openDb } from '../src/db.js';
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../src/security/passwords.js';
import { generateSecret, otpauthUri, verifyTotp } from '../src/security/totp.js';
import { getOwner, setOwner, rotateTotp } from '../src/services/owner.js';

const args = new Set(process.argv.slice(2));
const ROTATE = args.has('--rotate-totp');
const YES = args.has('--yes') || args.has('-y');
if (args.has('--help') || args.has('-h')) {
  process.stdout.write('Uso: npm run setup-admin [-- --rotate-totp] [--yes]\n  En modo --yes la contraseña se lee de SETUP_PASSWORD.\n');
  process.exit(0);
}

function die(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

/** Pregunta sin mostrar lo que se escribe (si hay TTY). */
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { value = [...value].slice(0, -1).join(''); continue; }
        if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function checkPassword(pw) {
  if ([...pw].length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (pw.length > MAX_PASSWORD_LENGTH) return 'La contraseña es demasiado larga.';
  if (pw.trim() !== pw) return 'La contraseña no puede empezar ni terminar con espacios.';
  return null;
}

function printSecret(secret) {
  const uri = otpauthUri({ secret });
  process.stdout.write('\n=== Secreto TOTP (se muestra UNA sola vez; no lo guardes en texto plano) ===\n');
  process.stdout.write(`OTPAUTH_URI=${uri}\n`);
  process.stdout.write(`TOTP_SECRET=${secret}\n`);
  process.stdout.write('Añádelo a tu app de autenticación (pegando la URI o el secreto en base32).\n\n');
}

async function confirmCode(secret) {
  for (let i = 0; i < 3; i++) {
    const code = (await ask('Introduce el código de 6 dígitos que muestra tu app: ')).replace(/\s/g, '');
    const step = verifyTotp(secret, code, { window: 1 });
    if (step !== null) return step;
    process.stdout.write('Código incorrecto. Comprueba la hora del dispositivo y vuelve a intentarlo.\n');
  }
  return null;
}

async function main() {
  const dataDir = resolveDataDir(process.env);
  const db = openDb(dataPaths(dataDir).db);
  try {
    const existing = getOwner(db);
    process.stdout.write(`Base de datos: ${path.join(dataDir, 'parolo.db')}\n`);

    let passwordHash = null;
    if (!ROTATE) {
      if (existing && !YES) {
        const a = (await ask('Ya hay un propietario. ¿Reemplazar contraseña y TOTP? (s/N) ')).trim().toLowerCase();
        if (a !== 's' && a !== 'si' && a !== 'sí') die('Cancelado; no se ha cambiado nada.', 1);
      }
      let pw;
      if (YES) {
        pw = process.env.SETUP_PASSWORD ?? '';
        if (!pw) die('Con --yes hay que definir SETUP_PASSWORD.');
        const problem = checkPassword(pw);
        if (problem) die(problem);
      } else {
        for (;;) {
          pw = await askHidden(`Nueva contraseña (mín. ${MIN_PASSWORD_LENGTH} caracteres): `);
          const problem = checkPassword(pw);
          if (problem) { process.stdout.write(`${problem}\n`); continue; }
          const again = await askHidden('Repite la contraseña: ');
          if (again !== pw) { process.stdout.write('No coinciden. Vuelve a empezar.\n'); continue; }
          break;
        }
      }
      process.stdout.write('Calculando hash (scrypt)…\n');
      passwordHash = await hashPassword(pw);
    } else if (!existing) {
      die('No hay propietario todavía. Ejecuta primero `npm run setup-admin` sin --rotate-totp.');
    }

    const secret = generateSecret();
    printSecret(secret);
    let lastStep = 0;
    if (!YES) {
      const step = await confirmCode(secret);
      if (step === null) die('No se pudo confirmar el código; no se ha guardado nada.');
      lastStep = step; // el código de confirmación no podrá reutilizarse para entrar
    }

    if (passwordHash) setOwner(db, { passwordHash, totpSecret: secret, totpLastStep: lastStep });
    else rotateTotp(db, { totpSecret: secret, totpLastStep: lastStep });
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM login_failures').run();
    db.prepare('INSERT INTO audit_log (at, event, ip_hash, detail_json) VALUES (?, ?, NULL, ?)')
      .run(Date.now(), passwordHash ? 'admin.credentials_set' : 'admin.totp_rotated', JSON.stringify({ source: 'cli' }));
    process.stdout.write(passwordHash ? 'Propietario guardado. Sesiones anteriores cerradas.\n' : 'Secreto TOTP rotado. Sesiones anteriores cerradas.\n');
  } finally {
    db.close();
  }
}

main().catch((err) => die(err.message));
