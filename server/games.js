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
  cfg() { const c = this.getConfig(); const g = c.game || {}; return { mode: g.mode || 'race', cup: g.cup || {}, arena: g.arena || {}, tug: g.tug || {}, track: g.track || {}, castle: g.castle || {}, teams: c.teams }; }
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
    if (mode === 'race') throw new Error('اختر لعبة من القائمة أولاً');
    if (ids.length < 2) throw new Error('تحتاج اللعبة إلى فريقين على الأقل');
    if (mode === 'cup') {
      const size = Math.min(Number(cup.size) || 8, ids.length);
      const entrants = (cup.shuffle !== false ? shuffle(ids) : ids).slice(0, size);
      this.s = { mode, status: 'running', goalPoints: Number(cup.goalPoints) || 500, matchSec: Number(cup.matchSec) || 90, breakSec: Number(cup.breakSec) || 8,
        rounds: [], champion: null, match: null, nextAt: 0 };
      this.s.rounds.push(this.makeRound(entrants));
      this.nextMatch();
    } else if (mode === 'tug') {
      const { tug } = this.cfg();
      const fixed = ids.includes(tug.a) && ids.includes(tug.b) && tug.a !== tug.b ? [tug.a, tug.b] : null;
      this.s = { mode, status: 'running', win: Number(tug.win) || 1000, sec: Number(tug.sec) || 60, breakSec: Number(tug.breakSec) || 6,
        order: fixed || shuffle(ids), fixed: Boolean(fixed), pair: 0, wins: {}, last: null };
      this.tugMatch();
    } else if (mode === 'horses' || mode === 'rockets') {
      const { track } = this.cfg();
      const lanes = Math.min(Number(track.lanes) || 8, ids.length);
      this.s = { mode, status: 'running', length: Number(track.length) || 3000, runners: shuffle(ids).slice(0, lanes).map((id) => ({ id, dist: 0 })), winner: null, podium: [] };
      this.event({ kind: 'game', type: 'raceStart' });
    } else if (mode === 'castle') {
      const { castle } = this.cfg();
      const max = Number(castle.max) || 5000;
      this.s = { mode, status: 'running', max, dmgPct: Number(castle.dmgPct ?? 50), sec: Number(castle.sec) || 180, endsAt: Date.now() + (Number(castle.sec) || 180) * 1000,
        castles: shuffle(ids).slice(0, Math.min(ids.length, Number(castle.size) || 8)).map((id) => ({ id, wall: Math.round(max * 0.3) })), winner: null, lastHit: null };
      this.event({ kind: 'game', type: 'castleStart' });
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

  /* ---------------- tug of war ---------------- */
  tugMatch() {
    const s = this.s; const n = s.order.length;
    const a = s.order[(s.pair * 2) % n]; let b = s.order[(s.pair * 2 + 1) % n]; if (b === a) b = s.order[(s.pair * 2 + 2) % n];
    Object.assign(s, { a, b, pa: 0, pb: 0, status: 'running', endsAt: Date.now() + s.sec * 1000, winner: null });
    this.event({ kind: 'game', type: 'tugStart', a, b });
  }
  tugEnd(winner) {
    const s = this.s; s.winner = winner; s.wins[winner] = (s.wins[winner] || 0) + 1;
    s.last = { a: s.a, b: s.b, winner }; s.status = 'break'; s.nextAt = Date.now() + s.breakSec * 1000;
    this.event({ kind: 'game', type: 'tugWin', teamId: winner }); this.changed();
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
    else if (this.s.mode === 'tug') {
      const s = this.s;
      if (teamId === s.a) s.pa += points; else if (teamId === s.b) s.pb += points; else return;
      if (Math.abs(s.pa - s.pb) >= s.win) return this.tugEnd(s.pa > s.pb ? s.a : s.b);
    } else if (this.s.mode === 'horses' || this.s.mode === 'rockets') {
      const s = this.s; const r = s.runners.find((x) => x.id === teamId); if (!r) return;
      r.dist = Math.min(s.length, r.dist + points);
      if (r.dist >= s.length) {
        s.winner = teamId; s.status = 'done';
        s.podium = [...s.runners].sort((x, y) => y.dist - x.dist).slice(0, 3).map((x) => x.id);
        this.event({ kind: 'game', type: 'raceWinner', teamId });
      }
    } else if (this.s.mode === 'castle') {
      const s = this.s; const c = s.castles.find((x) => x.id === teamId); if (!c) return;
      c.wall = Math.min(s.max, c.wall + points);
      const foes = s.castles.filter((x) => x.id !== teamId && x.wall > 0);
      if (foes.length) {
        const t = foes.reduce((x, y) => (y.wall > x.wall ? y : x));
        const dmg = Math.round(points * (s.dmgPct / 100)); t.wall = Math.max(0, t.wall - dmg);
        s.lastHit = { from: teamId, to: t.id, dmg, at: Date.now() };
      }
    }
    this.changed();
  }

  /** Skip the break / end the current match now. */
  next() {
    if (this.s.mode === 'tug') { if (this.s.status === 'running') this.tugEnd(this.s.pa >= this.s.pb ? this.s.a : this.s.b); else { this.s.pair += this.s.fixed ? 0 : 1; this.tugMatch(); this.changed(); } return; }
    if (this.s.mode !== 'cup') return;
    if (this.s.status === 'running') this.endMatch();
    else if (this.s.status === 'break') { this.nextMatch(); this.changed(); }
  }

  tick() {
    const now = Date.now();
    if (this.s.mode === 'tug') {
      if (this.s.status === 'running' && now >= this.s.endsAt) this.tugEnd(this.s.pa >= this.s.pb ? this.s.a : this.s.b);
      else if (this.s.status === 'break' && now >= this.s.nextAt) { this.s.pair += this.s.fixed ? 0 : 1; this.tugMatch(); this.changed(); }
      return;
    }
    if (this.s.mode === 'castle') {
      if (this.s.status === 'running' && now >= this.s.endsAt) {
        const w = this.s.castles.reduce((x, y) => (y.wall > x.wall ? y : x));
        this.s.winner = w.id; this.s.status = 'done'; this.event({ kind: 'game', type: 'castleWinner', teamId: w.id }); this.changed();
      }
      return;
    }
    if (this.s.mode !== 'cup') return;
    if (this.s.status === 'running' && this.s.match && now >= this.s.match.endsAt) this.endMatch();
    else if (this.s.status === 'break' && now >= this.s.nextAt) { this.nextMatch(); this.changed(); }
  }
}

/* ==========================================================================
 * Activities that run on top of any game:
 *   boost  - «الدقيقة الذهبية»: all points ×mult for a while (manual or automatic)
 *   quiz   - «سؤال وجواب» / «خمّن العلم»: first right answer in the chat wins points for their team
 *   throne - «العرش»: the biggest single gift takes the throne until a bigger one comes
 * ========================================================================== */
const ARAB = [
  ['sa', 'السعودية', 'الرياض', 'الريال السعودي', ['المملكة', 'السعوديه', 'saudi', 'ksa']], ['eg', 'مصر', 'القاهرة', 'الجنيه المصري', ['egypt']],
  ['ma', 'المغرب', 'الرباط', 'الدرهم المغربي', ['morocco', 'maroc']], ['dz', 'الجزائر', 'الجزائر', 'الدينار الجزائري', ['algeria']],
  ['tn', 'تونس', 'تونس', 'الدينار التونسي', ['tunisia']], ['ly', 'ليبيا', 'طرابلس', 'الدينار الليبي', ['libya']],
  ['mr', 'موريتانيا', 'نواكشوط', 'الأوقية', ['mauritania']], ['sd', 'السودان', 'الخرطوم', 'الجنيه السوداني', ['sudan']],
  ['ae', 'الإمارات', 'أبوظبي', 'الدرهم الإماراتي', ['الامارات', 'uae']], ['kw', 'الكويت', 'الكويت', 'الدينار الكويتي', ['kuwait']],
  ['qa', 'قطر', 'الدوحة', 'الريال القطري', ['qatar']], ['bh', 'البحرين', 'المنامة', 'الدينار البحريني', ['bahrain']],
  ['om', 'عمان', 'مسقط', 'الريال العماني', ['عُمان', 'oman']], ['ye', 'اليمن', 'صنعاء', 'الريال اليمني', ['yemen']],
  ['iq', 'العراق', 'بغداد', 'الدينار العراقي', ['iraq']], ['sy', 'سوريا', 'دمشق', 'الليرة السورية', ['سورية', 'syria']],
  ['jo', 'الأردن', 'عمّان', 'الدينار الأردني', ['الاردن', 'jordan']], ['lb', 'لبنان', 'بيروت', 'الليرة اللبنانية', ['lebanon']],
  ['ps', 'فلسطين', 'القدس', 'الشيكل', ['palestine']], ['so', 'الصومال', 'مقديشو', 'الشلن الصومالي', ['somalia']],
  ['dj', 'جيبوتي', 'جيبوتي', 'الفرنك الجيبوتي', ['djibouti']], ['km', 'جزر القمر', 'موروني', 'الفرنك القمري', ['القمر', 'comoros']],
];
const EXTRA_Q = [
  ['ما أطول نهر في الوطن العربي؟', ['النيل']], ['ما أكبر دولة عربية مساحة؟', ['الجزائر']], ['كم عدد الدول العربية؟', ['22', 'اثنان وعشرون', 'اثنين وعشرين']],
  ['في أي دولة تقع الأهرامات؟', ['مصر']], ['في أي دولة يقع برج خليفة؟', ['الإمارات', 'الامارات', 'دبي']], ['ما عاصمة الإمارات؟', ['أبوظبي', 'ابو ظبي']],
  ['أي دولة عربية فازت بكأس العرب 2021؟', ['الجزائر']], ['في أي دولة تقع مدينة البتراء؟', ['الأردن', 'الاردن']], ['كم ثانية في الدقيقة؟', ['60', 'ستين', 'ستون']],
];
/** Arabic-friendly comparison: no diacritics, ا/أ/إ/آ, ة/ه, ى/ي, no «ال», no spaces. */
const norm = (t) => String(t || '').toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  .split(' ').map((w) => w.replace(/^ال(?=.{2,})/, '')).join('');

function makeQuestion(kind) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  if (kind === 'flag') {
    const [code, name, , , alt] = pick(ARAB);
    return { kind, q: 'لمن هذا العلم؟', flag: code, answers: [name, ...alt], show: name };
  }
  const r = Math.random();
  if (r < 0.2) { const [q, ans] = pick(EXTRA_Q); return { kind: 'trivia', q, answers: ans, show: ans[0] }; }
  const [, name, capital, currency, alt] = pick(ARAB);
  if (r < 0.6) return { kind: 'trivia', q: `ما عاصمة ${name}؟`, answers: [capital], show: capital };
  if (r < 0.85) return { kind: 'trivia', q: `${capital} عاصمة أي دولة؟`, answers: [name, ...alt], show: name };
  return { kind: 'trivia', q: `ما عملة ${name}؟`, answers: [currency, currency.split(' ').slice(0, 1).join(' ')], show: currency };
}

class Activities extends EventEmitter {
  /** hooks: { board, getConfig, award(teamId, points, user) } */
  constructor(hooks) {
    super();
    this.h = hooks;
    this.s = { boost: null, quiz: null, throne: null };
    this.next = { boost: 0, quiz: 0 };
    this.timer = setInterval(() => this.tick(), 500);
  }
  destroy() { clearInterval(this.timer); }
  g() { return this.h.getConfig().game || {}; }
  public() {
    const q = this.s.quiz;
    // never send the answers while the question is open
    return { ...this.s, quiz: q && { ...q, answers: undefined, show: q.done ? q.show : undefined }, serverNow: Date.now() };
  }
  changed() { this.emit('change'); }

  startBoost(mult, sec) {
    const b = this.g().boost || {};
    mult = Number(mult || b.mult) || 3; sec = Number(sec || b.sec) || 60;
    this.s.boost = { mult, until: Date.now() + sec * 1000 };
    this.h.board.boost = mult;
    this.emit('event', { kind: 'game', type: 'boost', mult, sec });
    this.changed();
  }
  stopBoost() { this.s.boost = null; this.h.board.boost = 1; this.changed(); }

  ask(kind) {
    const qz = this.g().quiz || {};
    const k = kind === 'flag' || kind === 'trivia' ? kind : qz.kinds === 'flag' ? 'flag' : qz.kinds === 'trivia' ? 'trivia' : Math.random() < 0.5 ? 'flag' : 'trivia';
    const sec = Number(qz.sec) || 30;
    this.s.quiz = { ...makeQuestion(k), id: Date.now(), startedAt: Date.now(), endsAt: Date.now() + sec * 1000, points: Number(qz.points) || 100, winner: null, done: false };
    this.emit('event', { kind: 'game', type: 'quiz', q: this.s.quiz.q });
    this.changed();
  }
  stopQuiz() { this.s.quiz = null; this.changed(); }
  closeQuiz(winner) {
    const q = this.s.quiz; if (!q || q.done) return;
    q.done = true; q.winner = winner || null; q.closeAt = Date.now() + 7000;
    if (winner) this.emit('event', { kind: 'game', type: 'quizWin', name: winner.nickname, teamId: winner.teamId, answer: q.show });
    this.changed();
  }
  onChat({ user, comment }) {
    const q = this.s.quiz; if (!q || q.done) return;
    const c = norm(comment); if (!c) return;
    if (!q.answers.some((a) => { const n = norm(a); return n && (c === n || (n.length >= 3 && c.includes(n))); })) return;
    const teamId = this.h.board.allegiance.get(user.userId) || null;
    if (teamId) this.h.award(teamId, q.points, user);
    this.closeQuiz({ nickname: user.nickname, avatar: user.avatar || user.profilePictureUrl || '', teamId, points: teamId ? q.points : 0 });
  }

  onGift(ev) {
    const t = this.g().throne || {};
    if (t.enabled === false || !ev.teamId || !(ev.points > 0)) return;
    const cur = this.s.throne;
    // the throne slowly loses value (5% a minute) so it keeps changing hands
    const need = cur ? cur.points * Math.pow(0.95, (Date.now() - cur.since) / 60000) : 0;
    if (ev.points <= need) return;
    const prev = cur;
    this.s.throne = { user: { nickname: ev.user.nickname, avatar: ev.user.avatar || ev.user.profilePictureUrl || '' }, teamId: ev.teamId, points: ev.points, since: Date.now(), gift: ev.gift?.name || '' };
    if (!prev || prev.user.nickname !== ev.user.nickname) this.emit('event', { kind: 'game', type: 'throne', teamId: ev.teamId, name: ev.user.nickname, prev: prev?.user.nickname || '' });
    this.changed();
  }
  resetThrone() { this.s.throne = null; this.changed(); }

  tick() {
    const now = Date.now(); const g = this.g();
    if (this.s.boost && now >= this.s.boost.until) { this.stopBoost(); this.emit('event', { kind: 'game', type: 'boostEnd' }); }
    if (this.s.quiz && !this.s.quiz.done && now >= this.s.quiz.endsAt) this.closeQuiz(null);
    if (this.s.quiz && this.s.quiz.done && now >= this.s.quiz.closeAt) this.stopQuiz();
    // automatic golden minute / questions
    const b = g.boost || {}; const q = g.quiz || {};
    const safe = this.h.getConfig().safe?.enabled !== false; // TikTok-safe: no automatic urgency pushes
    if (b.auto && !safe && !this.s.boost) { if (!this.next.boost) this.next.boost = now + (Number(b.everyMin) || 10) * 60000; else if (now >= this.next.boost) { this.next.boost = 0; this.startBoost(); } } else if (!b.auto || safe) this.next.boost = 0;
    if (q.auto && !this.s.quiz) { if (!this.next.quiz) this.next.quiz = now + (Number(q.everyMin) || 3) * 60000; else if (now >= this.next.quiz) { this.next.quiz = 0; this.ask(); } } else if (!q.auto) this.next.quiz = 0;
  }
}

module.exports = { GameManager, Activities, norm };
