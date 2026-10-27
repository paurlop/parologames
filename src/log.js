// Logger JSON por líneas a stdout. Redacta campos sensibles.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE = /^(authorization|cookie|set-cookie|password|password2|pass|totp|otp|code|secret|token|_csrf|csrf|x-csrf-token|session)$/i;

function serializeError(err) {
  return { name: err.name, message: err.message, code: err.code, status: err.status ?? err.statusCode, stack: err.stack };
}

export function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value);
  if (depth > 5) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

/**
 * @param {{ level?: string, stream?: { write(s: string): unknown }, base?: object }} [opts]
 */
export function createLogger({ level = 'info', stream = process.stdout, base = {} } = {}) {
  let threshold = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = { t: new Date().toISOString(), level: lvl, msg, ...redact({ ...base, ...(fields || {}) }) };
    let line;
    try { line = JSON.stringify(entry); } catch { line = JSON.stringify({ t: entry.t, level: lvl, msg, note: 'unserializable fields' }); }
    stream.write(line + '\n');
  };
  return {
    debug: (msg, f) => write('debug', msg, f),
    info: (msg, f) => write('info', msg, f),
    warn: (msg, f) => write('warn', msg, f),
    error: (msg, f) => write('error', msg, f),
    child: (fields) => createLogger({ level: Object.keys(LEVELS).find((k) => LEVELS[k] === threshold), stream, base: { ...base, ...fields } }),
    setLevel: (l) => { threshold = LEVELS[l] ?? threshold; },
  };
}

/** Logger por defecto del proceso. */
export const logger = createLogger({ level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info') });
