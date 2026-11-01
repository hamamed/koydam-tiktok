'use strict';
/**
 * Live games on top of the gift points (config.game.mode):
 *   race  - the classic board to 1,000,000 (nothing to do here)
 *   cup   - «كأس العرب»: knockout tournament. Two teams play a timed match; gift points fill a
 *           shot meter, every `goalPoints` is a goal. Winners advance until the champion.
 *   arena - «حلبة الدول»: every team has HP. Points sent to a team attack an opponent and heal
 *           the sender a little. 0 HP = out (gifts to an eliminated team fill a revive meter).
 *           Last team standing wins.
 * Server-authoritative: every screen gets the same state through 'game' messages.
 */
const { EventEmitter } = require('events');

const ROUND_NAMES = { 2: 'النهائي', 4: 'نصف النهائي', 8: 'ربع النهائي', 16: 'دور الـ16', 32: 'دور الـ32' };
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

class GameManager extends EventEmitter {
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;
    this.s = { mode: 'race', status: 'idle' };
    this.timer = setInterval(() => this.tick(), 500);
  }
  destroy() { clearInterval(this.timer); }
  cfg() { const c = this.getConfig(); return { mode: c.game?.mode || 'race', cup: c.game?.cup || {}, arena: c.game?.arena || {}, teams: c.teams }; }
  public() { return { ...this.s, serverNow: Date.now() }; }
  changed() { this.emit('change', this.s); }
  event(ev) { this.emit('event', ev); }

  /** Config saved: a different mode resets the game. */
  onConfig() {
    const { mode } = this.cfg();
    if (mode !== this.s.mode) { this.s = { mode, status: 'idle' }; this.changed(); }
  }

  start() {
    const { mode, cup, arena, teams } = this.cfg();
    const ids = teams.map((t) => t.id);
    if (mode === 'race') throw new Error('اختر لعبة «كأس العرب» أو «حلبة الدول» أولاً');
    if (ids.length < 2) throw new Error('تحتاج اللعبة إلى فريقين على الأقل');
    if (mode === 'cup') {
      const size = Math.min(Number(cup.size) || 8, ids.length);
      const entrants = (cup.shuffle !== false ? shuffle(ids) : ids).slice(0, size);
      this.s = { mode, status: 'running', goalPoints: Number(cup.goalPoints) || 500, matchSec: Number(cup.matchSec) || 90, breakSec: Number(cup.breakSec) || 8,
        rounds: [], champion: null, match: null, nextAt: 0 };
      this.s.rounds.push(this.makeRound(entrants));
      this.nextMatch();
    } else {
      const hp = Number(arena.hp) || 5000;
      this.s = { mode, status: 'running', max: hp, healPct: Number(arena.healPct ?? 25), target: arena.target || 'leader', winner: null, lastHit: null,
        fighters: shuffle(ids).map((id) => ({ id, hp, alive: true, dealt: 0, revive: 0, kos: 0 })) };
      this.event({ kind: 'game', type: 'arenaStart' });
    }
    this.changed();
  }
  stop() { this.s = { mode: this.cfg().mode, status: 'idle' }; this.changed(); }

  /* ---------------- cup ---------------- */
  makeRound(teams) {
    const pairs = [];
    for (let i = 0; i < teams.length; i += 2) pairs.push({ a: teams[i], b: teams[i + 1] || null, ga: 0, gb: 0, pa: 0, pb: 0, done: !teams[i + 1], winner: teams[i + 1] ? null : teams[i] });
    let pow = 2; while (pow < teams.length) pow *= 2;
    return { name: ROUND_NAMES[pow] || `دور الـ${pow}`, matches: pairs };
  }
  curRound() { return this.s.rounds[this.s.rounds.length - 1]; }
  nextMatch() {
    const r = this.curRound();
    const i = r.matches.findIndex((m) => !m.done);
    if (i < 0) {
      const winners = r.matches.map((m) => m.winner);
      if (winners.length === 1) { this.s.champion = winners[0]; this.s.status = 'done'; this.s.match = null; this.event({ kind: 'game', type: 'champion', teamId: winners[0] }); return; }
      this.s.rounds.push(this.makeRound(winners));
      return this.nextMatch();
    }
    const m = r.matches[i];
    this.s.match = { round: this.s.rounds.length - 1, index: i, a: m.a, b: m.b, ga: 0, gb: 0, ma: 0, mb: 0, pa: 0, pb: 0, endsAt: Date.now() + this.s.matchSec * 1000 };
    this.s.status = 'running';
    this.event({ kind: 'game', type: 'kickoff', a: m.a, b: m.b, round: r.name });
  }
  endMatch() {
    const m = this.s.match; if (!m) return;
    const winner = m.ga !== m.gb ? (m.ga > m.gb ? m.a : m.b) : m.pa >= m.pb ? m.a : m.b;
    const slot = this.s.rounds[m.round].matches[m.index];
    Object.assign(slot, { ga: m.ga, gb: m.gb, pa: m.pa, pb: m.pb, done: true, winner });
    this.event({ kind: 'game', type: 'fulltime', a: m.a, b: m.b, ga: m.ga, gb: m.gb, winner });
    this.s.status = 'break'; this.s.nextAt = Date.now() + this.s.breakSec * 1000; this.s.lastResult = { ...slot };
    this.changed();
  }

  /* ---------------- arena ---------------- */
  arenaHit(teamId, points) {
    const s = this.s; const f = s.fighters.find((x) => x.id === teamId); if (!f) return;
    if (!f.alive) {
      // Gifts to an eliminated team fill its revive meter (half of max HP) -> back with 30% HP.
      f.revive += points;
      if (f.revive >= s.max * 0.5) { f.alive = true; f.hp = Math.round(s.max * 0.3); f.revive = 0; this.event({ kind: 'game', type: 'revive', teamId }); }
      return;
    }
    const foes = s.fighters.filter((x) => x.alive && x.id !== teamId);
    if (!foes.length) return;
    const target = s.target === 'random' ? foes[Math.floor(Math.random() * foes.length)] : foes.reduce((a, b) => (b.hp > a.hp ? b : a));
    const dmg = Math.round(points);
    target.hp = Math.max(0, target.hp - dmg); f.dealt += dmg;
    f.hp = Math.min(s.max, f.hp + Math.round(points * (s.healPct / 100)));
    s.lastHit = { from: teamId, to: target.id, dmg, at: Date.now() };
    if (target.hp <= 0) {
      target.alive = false; target.revive = 0; f.kos += 1;
      this.event({ kind: 'game', type: 'ko', teamId: target.id, by: teamId });
      const alive = s.fighters.filter((x) => x.alive);
      if (alive.length === 1) { s.winner = alive[0].id; s.status = 'done'; this.event({ kind: 'game', type: 'arenaWinner', teamId: s.winner }); }
    }
  }

  /** Points for a team (gifts, likes, follows…). */
  onPoints(teamId, points) {
    if (!teamId || !(points > 0) || this.s.status !== 'running') return;
    if (this.s.mode === 'cup') {
      const m = this.s.match; if (!m) return;
      const side = teamId === m.a ? 'a' : teamId === m.b ? 'b' : null; if (!side) return;
      m[`p${side}`] += points; m[`m${side}`] += points;
      while (m[`m${side}`] >= this.s.goalPoints) {
        m[`m${side}`] -= this.s.goalPoints; m[`g${side}`] += 1;
        this.event({ kind: 'game', type: 'goal', teamId, a: m.a, b: m.b, ga: m.ga, gb: m.gb });
      }
    } else if (this.s.mode === 'arena') this.arenaHit(teamId, points);
    this.changed();
  }

  /** Skip the break / end the current match now. */
  next() {
    if (this.s.mode !== 'cup') return;
    if (this.s.status === 'running') this.endMatch();
    else if (this.s.status === 'break') { this.nextMatch(); this.changed(); }
  }

  tick() {
    if (this.s.mode !== 'cup') return;
    const now = Date.now();
    if (this.s.status === 'running' && this.s.match && now >= this.s.match.endsAt) this.endMatch();
    else if (this.s.status === 'break' && now >= this.s.nextAt) { this.nextMatch(); this.changed(); }
  }
}

module.exports = { GameManager };
