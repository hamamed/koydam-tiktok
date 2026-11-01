/**
 * Stream reports: one report per stream session, saved in data/reports/<id>.json.
 *
 * A session starts automatically with the first activity (gift / follow / ...)
 * or when the TikTok connection opens, and ends when the stream ends, when the
 * host disconnects, after 2 hours without activity, or from the panel.
 * Each report has: totals, diamonds, points per team, gifts breakdown, top
 * supporters, follows/shares, peak viewers, a per-minute timeline and rounds.
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');

const IDLE_END_MS = 2 * 3600 * 1000;
const ID_RE = /^[0-9]{8}-[0-9]{6}(-[a-z0-9]{1,6})?$/;

class Reports extends EventEmitter {
  constructor({ dir, log, getConfig }) {
    super();
    this.dir = dir; this.log = log; this.getConfig = getConfig;
    this.current = null;
    this.supporters = new Map(); // userId -> { n, u, a, team, points, gifts }
    this.lastActivity = 0;
    this._saveTimer = null;
    this._minute = setInterval(() => this._sample(), 60000);
    this._minute.unref();
    this._restore();
  }

  /* ---------- lifecycle ---------- */
  _newId() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    let id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    if (fs.existsSync(path.join(this.dir, `${id}.json`))) id += `-${Math.random().toString(36).slice(2, 6)}`;
    return id;
  }

  begin({ username = '', demo = false, reason = '' } = {}) {
    if (this.current) this.end('new session');
    const cfg = this.getConfig();
    this.current = {
      id: this._newId(), startedAt: Date.now(), endedAt: null, endReason: '', username, demo, startReason: reason,
      title: cfg.title,
      totals: { points: 0, gifts: 0, diamonds: 0, follows: 0, shares: 0, giftEvents: 0 },
      peakViewers: 0,
      teams: Object.fromEntries(cfg.teams.map((t) => [t.id, { name: t.name, emoji: t.emoji, color: t.color, image: t.image, points: 0, gifts: 0 }])),
      giftsByName: {},
      timeline: [],
      rounds: [],
      topSupporters: [],
    };
    this.supporters = new Map();
    this.lastActivity = Date.now();
    this._sample();
    this.log.info(`Report started: ${this.current.id}${username ? ` (@${username})` : ''}${demo ? ' [demo]' : ''}`);
    this._saveSoon();
    this.emit('change');
    return this.current;
  }

  end(reason = '') {
    const c = this.current;
    if (!c) return null;
    c.endedAt = Date.now(); c.endReason = reason;
    this._finalize();
    this._saveNow();
    this.log.info(`Report ended: ${c.id} (${reason})`);
    this.current = null;
    this.emit('change');
    return c;
  }

  /** Called on any scoring activity: opens a session if needed, closes idle ones. */
  _touch(ctx = {}) {
    if (this.current && Date.now() - this.lastActivity > IDLE_END_MS) this.end('idle');
    if (!this.current) this.begin({ reason: 'activity', ...ctx });
    this.lastActivity = Date.now();
    return this.current;
  }

  /* ---------- recording ---------- */
  onGift(ev, ctx) {
    const c = this._touch(ctx);
    const n = ev.gift.delta || 1;
    const diamonds = (ev.gift.diamonds || 0) * n;
    c.totals.points += ev.points; c.totals.gifts += n; c.totals.diamonds += diamonds; c.totals.giftEvents++;
    const t = c.teams[ev.teamId] || (c.teams[ev.teamId] = { name: ev.teamId, points: 0, gifts: 0 });
    t.points += ev.points; t.gifts += n;
    const g = c.giftsByName[ev.gift.name] || (c.giftsByName[ev.gift.name] = { count: 0, diamonds: 0, points: 0, image: ev.gift.image || '' });
    g.count += n; g.diamonds += diamonds; g.points += ev.points; if (ev.gift.image) g.image = ev.gift.image;
    this._supporter(ev.user, ev.teamId, ev.points, n);
    this._saveSoon();
  }
  onPoints(ev, ctx) { // follow / share / chat / like points
    const c = this._touch(ctx);
    if (ev.kind === 'follow') c.totals.follows++;
    if (ev.kind === 'share') c.totals.shares++;
    if (ev.points > 0 && ev.teamId) {
      c.totals.points += ev.points;
      const t = c.teams[ev.teamId]; if (t) t.points += ev.points;
      this._supporter(ev.user, ev.teamId, ev.points, 0);
    }
    this._saveSoon();
  }
  onViewers(n) { if (this.current && n > this.current.peakViewers) { this.current.peakViewers = n; this._saveSoon(); } }
  onRound(result) { const c = this._touch(); c.rounds.push(result); this._saveSoon(); }

  _supporter(user, teamId, points, gifts) {
    if (!user) return;
    const k = user.userId || user.uniqueId || user.nickname;
    const s = this.supporters.get(k) || { n: user.nickname, u: user.uniqueId, a: user.avatar, team: teamId, points: 0, gifts: 0 };
    s.points += points; s.gifts += gifts; s.n = user.nickname || s.n; s.a = user.avatar || s.a; if (teamId) s.team = teamId;
    this.supporters.set(k, s);
    if (this.supporters.size > 20000) this.supporters.delete(this.supporters.keys().next().value);
  }

  _sample() {
    const c = this.current; if (!c) return;
    if (Date.now() - this.lastActivity > IDLE_END_MS) { this.end('idle'); return; }
    c.timeline.push({ t: Date.now(), points: Math.round(c.totals.points), viewers: this.viewers || 0 });
    if (c.timeline.length > 1500) c.timeline.shift();
    this._saveSoon();
  }

  _finalize() {
    const c = this.current; if (!c) return;
    c.topSupporters = [...this.supporters.values()].sort((a, b) => b.points - a.points).slice(0, 50)
      .map((s) => ({ ...s, points: Math.round(s.points * 100) / 100 }));
    c.totals.points = Math.round(c.totals.points * 100) / 100;
    c.supportersCount = this.supporters.size;
  }

  /* ---------- persistence ---------- */
  _saveSoon() { if (!this._saveTimer) this._saveTimer = setTimeout(() => { this._saveTimer = null; this._saveNow(); }, 15000); }
  _saveNow() {
    const c = this.current; if (!c) return;
    this._finalize();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, `${c.id}.json`); const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ ...c, open: !c.endedAt, _supporters: c.endedAt ? undefined : [...this.supporters.entries()].slice(-5000) }));
      fs.renameSync(tmp, file);
    } catch (e) { this.log.warn('Report save failed:', e.message); }
  }
  flush() { if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; } this._saveNow(); }

  /** After a restart, continue the open session (if recent). */
  _restore() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => n.endsWith('.json')).sort(); } catch { return; }
    const last = names[names.length - 1];
    if (!last) return;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(this.dir, last), 'utf8'));
      if (!r.open) return;
      const lastT = r.timeline?.length ? r.timeline[r.timeline.length - 1].t : r.startedAt;
      if (Date.now() - lastT > IDLE_END_MS) { r.open = false; r.endedAt = lastT; r.endReason = 'restart'; delete r._supporters; fs.writeFileSync(path.join(this.dir, last), JSON.stringify(r)); return; }
      this.supporters = new Map(Array.isArray(r._supporters) ? r._supporters : []);
      delete r._supporters; delete r.open;
      this.current = r; this.lastActivity = Date.now();
      this.log.info(`Report resumed: ${r.id}`);
    } catch { /* ignore broken file */ }
  }

  /* ---------- queries ---------- */
  async list() {
    if (this.current) this.flush(); // include the open session
    const names = (await fsp.readdir(this.dir).catch(() => [])).filter((n) => n.endsWith('.json')).sort().reverse().slice(0, 300);
    const out = [];
    for (const n of names) {
      try {
        const r = JSON.parse(await fsp.readFile(path.join(this.dir, n), 'utf8'));
        const winner = Object.entries(r.teams || {}).sort((a, b) => b[1].points - a[1].points)[0];
        out.push({ id: r.id, startedAt: r.startedAt, endedAt: r.endedAt, username: r.username, demo: r.demo, open: Boolean(r.open || (this.current && this.current.id === r.id)),
          totals: r.totals, peakViewers: r.peakViewers, rounds: (r.rounds || []).length, winner: winner ? { id: winner[0], ...winner[1] } : null });
      } catch { /* skip */ }
    }
    return out;
  }
  async get(id) {
    if (!ID_RE.test(String(id))) return null;
    if (this.current && this.current.id === id) { this._finalize(); return { ...this.current, open: true }; }
    try { const r = JSON.parse(await fsp.readFile(path.join(this.dir, `${id}.json`), 'utf8')); delete r._supporters; return r; } catch { return null; }
  }
  async remove(id) {
    if (!ID_RE.test(String(id)) || (this.current && this.current.id === id)) return false;
    await fsp.rm(path.join(this.dir, `${id}.json`), { force: true });
    return true;
  }
  /** CSV with sections (opens in Excel; UTF-8 BOM for Arabic). */
  csv(r) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [];
    const d = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : '');
    rows.push(['التقرير', r.id], ['البداية', d(r.startedAt)], ['النهاية', d(r.endedAt)], ['الحساب', r.username || ''],
      ['إجمالي النقاط', r.totals.points], ['الهدايا', r.totals.gifts], ['الماسات', r.totals.diamonds], ['المتابعون الجدد', r.totals.follows],
      ['المشاركات', r.totals.shares], ['أعلى عدد مشاهدين', r.peakViewers], []);
    rows.push(['الفريق', 'النقاط', 'الهدايا']);
    for (const t of Object.values(r.teams || {}).sort((a, b) => b.points - a.points)) rows.push([t.name, Math.round(t.points), t.gifts]);
    rows.push([], ['الهدية', 'العدد', 'الماسات', 'النقاط']);
    for (const [name, g] of Object.entries(r.giftsByName || {}).sort((a, b) => b[1].diamonds - a[1].diamonds)) rows.push([name, g.count, g.diamonds, Math.round(g.points)]);
    rows.push([], ['الداعم', 'المستخدم', 'الفريق', 'النقاط', 'الهدايا']);
    for (const s of r.topSupporters || []) rows.push([s.n, s.u, r.teams?.[s.team]?.name || s.team || '', Math.round(s.points), s.gifts]);
    rows.push([], ['الجولة', 'الفائز', 'نقاط الفائز', 'المجموع']);
    for (const x of r.rounds || []) rows.push([x.number, x.winner?.name || '-', Math.round(x.winner?.score || 0), Math.round(x.total || 0)]);
    return '﻿' + rows.map((row) => row.map(q).join(',')).join('\r\n');
  }
}

module.exports = { Reports, REPORT_ID_RE: ID_RE };
