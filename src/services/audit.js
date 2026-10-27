// Registro de eventos de seguridad en BD + log. Las IPs se guardan como HMAC, nunca en claro.
import crypto from 'node:crypto';

export function hashIp(ip, salt) {
  return crypto.createHmac('sha256', salt).update(String(ip ?? '')).digest('hex').slice(0, 32);
}

export function hashUa(ua, salt) {
  return crypto.createHmac('sha256', salt).update('ua:' + String(ua ?? '').slice(0, 512)).digest('hex').slice(0, 32);
}

const RETENTION_MS = 180 * 24 * 3600_000;

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, logger: any }} deps
 */
export function createAudit({ db, logger }) {
  const insert = db.prepare('INSERT INTO audit_log (at, event, ip_hash, detail_json) VALUES (?, ?, ?, ?)');
  const purge = db.prepare('DELETE FROM audit_log WHERE at < ?');
  return {
    /**
     * @param {string} event p. ej. auth.login_failed
     * @param {{ ipHash?: string|null, reqId?: string, detail?: object }} [info]
     */
    record(event, { ipHash = null, reqId, detail = {} } = {}) {
      try {
        insert.run(Date.now(), event, ipHash, JSON.stringify(detail));
      } catch (err) {
        logger.error('audit.write_failed', { event, err });
      }
      logger.info(event, { audit: true, ipHash, reqId, ...detail });
    },
    purgeOld() { return Number(purge.run(Date.now() - RETENTION_MS).changes); },
  };
}
