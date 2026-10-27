// Limitadores de peticiones (express-rate-limit, memoria del proceso).
import { rateLimit } from 'express-rate-limit';

/**
 * @param {any} config
 * @param {(req: any, res: any, status: number) => void} onLimit responde al exceder el límite
 */
export function createLimiters(config, onLimit) {
  const base = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, _next, options) => onLimit(req, res, options.statusCode),
  };
  return {
    global: rateLimit({ ...base, windowMs: 60_000, limit: config.rate.globalPerMin }),
    games: rateLimit({ ...base, windowMs: 60_000, limit: config.rate.gamesPerMin }),
    login: rateLimit({
      ...base, windowMs: 15 * 60_000, limit: config.rate.loginPer15Min,
      skipSuccessfulRequests: true, // un login correcto (303) no consume cupo
    }),
    download: rateLimit({ ...base, windowMs: 10 * 60_000, limit: config.rate.downloadsPer10Min }),
    upload: rateLimit({ ...base, windowMs: 60 * 60_000, limit: config.rate.uploadsPerHour }),
  };
}
