// Room registry + the shared fixed-step clock that drives every running race.

import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Room } from './room.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ERR } from '../shared/protocol.js';

export class RoomManager {
  constructor(opts, log) {
    this.opts = opts;
    this.log = log;
    this.rooms = new Map();
    this.racing = new Set();
    this.loopTimer = null;
    this.idCounter = 0;
    this.idSalt = crypto.randomBytes(3).toString('hex');
    this.sweepTimer = setInterval(() => this.sweep(), 5000);
    this.sweepTimer.unref?.();
  }

  now() { return performance.now(); }

  /** Globally unique ids (never reused across rooms or server restarts). */
  nextId(prefix) {
    this.idCounter++;
    return `${prefix}${this.idCounter.toString(36)}${this.idSalt}`;
  }

  newCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }

  createRoom() {
    if (this.rooms.size >= this.opts.maxRooms) return { error: ERR.SERVER_FULL };
    const code = this.newCode();
    if (!code) return { error: ERR.SERVER_FULL };
    const room = new Room(this, code);
    this.rooms.set(code, room);
    this.log(`room ${code}: created (${this.rooms.size} rooms)`);
    return { room };
  }

  get(code) { return this.rooms.get(code); }

  closeRoom(room, reason) {
    if (!this.rooms.has(room.code)) return;
    this.rooms.delete(room.code);
    room.close(reason);
    this.racing.delete(room);
    this.log(`room ${room.code}: closed (${reason}); ${this.rooms.size} rooms left`);
    this.updateLoop();
  }

  raceStarted(room) { this.racing.add(room); this.updateLoop(); }
  raceEnded(room) { this.racing.delete(room); this.updateLoop(); }

  updateLoop() {
    if (this.racing.size && !this.loopTimer) {
      // Wake often; each room integrates real elapsed time with its own
      // accumulator, so timer jitter never changes the simulation rate.
      this.loopTimer = setInterval(() => this.loop(), this.opts.loopIntervalMs);
    } else if (!this.racing.size && this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  loop() {
    const now = this.now();
    for (const room of [...this.racing]) {
      try {
        room.update(now);
      } catch (err) {
        this.log(`room ${room.code}: simulation error ${err?.stack || err}`);
        try { room.endRace('error'); } catch { this.closeRoom(room, 'error'); }
      }
    }
  }

  sweep() {
    const t = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.state === 'lobby' && t - room.lastActivity > this.opts.lobbyIdleMs) this.closeRoom(room, 'idle');
      else if (room.players.length === 0) this.closeRoom(room, 'empty');
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.length;
    return { rooms: this.rooms.size, racing: this.racing.size, players };
  }

  dispose() {
    clearInterval(this.sweepTimer);
    clearInterval(this.loopTimer);
    this.loopTimer = null;
    for (const room of [...this.rooms.values()]) this.closeRoom(room, 'shutdown');
  }
}
