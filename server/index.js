/**
 * ============================================================================
 *  koydam-tiktok · تحدي المليون: TikTok LIVE gift-battle backend (server/index.js)
 * ============================================================================
 *   - Connects to TikTok LIVE (tiktok-live-connector v2/v1) with auto-reconnect.
 *   - Scores gifts / chat / likes per team, tracks top supporters, saves to disk.
 *   - Serves the Next.js static site (web/out): / live page, /overlay for OBS,
 *     /admin Arabic dashboard. WebSocket on the same port for live updates.
 *   - Admin REST API (login cookie): settings, file editor, logs, restart,
 *     build, and one-click update from GitHub (git pull + npm ci + build).
 *
 *  Run:   npm ci && npm run build && npm start      → http://localhost:8080/admin
 *  Demo:  npm run demo
 *  Prod:  see deploy/install.sh (systemd + HTTPS reverse proxy)
 *
 *  Environment (optional): PORT, HOST, PUBLIC_URL, ADMIN_EMAIL, ADMIN_PASSWORD,
 *  TIKTOK_USERNAME, SIGN_API_KEY, ADMIN_TOKEN, DATA_DIR, DEMO=1
 * ============================================================================
 */

'use strict';

const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { EventEmitter } = require('events');
const { WebSocketServer, WebSocket } = require('ws');

/* ----------------------------------------------------------------------------
 * 0. Runtime settings (CLI flags > env vars > defaults)
 * ------------------------------------------------------------------------- */
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);

const SETTINGS = {
  port: Number(argv.port || process.env.PORT || 8080),
  host: String(argv.host || process.env.HOST || '127.0.0.1'),
  publicUrl: String(process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  envUsername: String(argv.user || process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim(),
  envAdminToken: String(process.env.ADMIN_TOKEN || ''),
  envSignApiKey: String(process.env.SIGN_API_KEY || ''),
  envAdminPassword: String(process.env.ADMIN_PASSWORD || ''),
  envAdminEmail: String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  dataDir: path.resolve(String(argv.data || process.env.DATA_DIR || path.join(__dirname, '..', 'data'))),
  demo: Boolean(argv.demo || process.env.DEMO === '1'),
  webOut: path.join(__dirname, '..', 'web', 'out'),
};

const CONFIG_FILE = path.join(SETTINGS.dataDir, 'config.json');
const STATE_FILE = path.join(SETTINGS.dataDir, 'state.json');
const VERSION = (() => { try { return require('../package.json').version; } catch { return '0.0.0'; } })();

/** Tiny logger with timestamps and levels. The last 500 lines are kept in memory for the panel's Logs tab. */
const LOG_BUFFER = [];
let logSeq = 0;
const BOOT_ID = crypto.randomBytes(6).toString('hex'); // lets the Logs tab notice a restart
function logLine(level, fn, args) {
  const t = new Date().toISOString();
  fn(`[${t.slice(11, 23)}] ${level.padEnd(5)}`, ...args);
  const m = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  LOG_BUFFER.push({ i: ++logSeq, t, l: level, m: m.slice(0, 4000) });
  if (LOG_BUFFER.length > 500) LOG_BUFFER.shift();
}
const log = {
  info: (...a) => logLine('INFO', console.log, a),
  warn: (...a) => logLine('WARN', console.warn, a),
  error: (...a) => logLine('ERROR', console.error, a),
};

/* ----------------------------------------------------------------------------
 * 1. Default configuration
 *    This is also the source of truth for the config SCHEMA: sanitizeConfig()
 *    uses it to validate whatever the setup panel sends us.
 * ------------------------------------------------------------------------- */
const DEFAULT_CONFIG = {
  title: 'تحدي المليون',
  subtitle: 'اكتب اسم فريقك في الشات وأرسل الهدايا!',
  category: 'الدول', // free label: الدول / الأندية / القبائل ...

  // The 1M goal shown on the live page and the overlay header
  goal: { enabled: true, target: 1000000, label: 'الهدف: مليون نقطة' },

  teams: [
    {
      id: 'morocco', name: 'المغرب', emoji: '🇲🇦', color: '#c1272d', image: '',
      keywords: ['morocco', 'maroc', 'maghrib', 'مغرب', 'المغرب'],
      gifts: ['Rose'], // anyone who sends a Rose supports Morocco
    },
    {
      id: 'algeria', name: 'الجزائر', emoji: '🇩🇿', color: '#00a651', image: '',
      keywords: ['algeria', 'algerie', 'dz', 'djazair', 'الجزائر', 'جزائر'],
      gifts: ['TikTok'],
    },
    {
      id: 'tunisia', name: 'تونس', emoji: '🇹🇳', color: '#e70013', image: '',
      keywords: ['tunisia', 'tunisie', 'tounes', 'تونس'],
      gifts: ['Finger Heart'],
    },
    {
      id: 'egypt', name: 'مصر', emoji: '🇪🇬', color: '#d4a017', image: '',
      keywords: ['egypt', 'egypte', 'masr', 'مصر'],
      gifts: ['Ice Cream Cone'],
    },
  ],

  scoring: {
    globalMultiplier: 1,        // applied to every gift
    pointsPerDiamond: 1,        // base value = diamonds * this
    unknownGiftValue: 1,        // value used when a gift's diamond cost is unknown
    giftMultipliers: {          // per-gift multiplier, keyed by gift NAME (case-insensitive) or gift ID
      rose: 1,
      galaxy: 1.5,
      universe: 2,
    },
    allegianceEnabled: true,    // chat keyword -> viewer joins a team
    allowTeamSwitch: true,      // may a viewer switch team by typing another keyword?
    chatVotePoints: 0,          // points for each chat "vote" (0 = off)
    chatVoteCooldownSec: 15,    // per-viewer cooldown for chat votes
    likePoints: 0,              // points per like for viewers with a team (0 = off)
    unassignedGiftPolicy: 'ignore', // 'ignore' | 'underdog' | 'leader'
    giftMode: 'mixed',          // 'mixed': team gift OR viewer's chat team · 'giftOnly': only each team's own gifts count
  },

  alerts: {
    majorGiftPoints: 500,       // gifts worth >= this many points fire confetti + gold toast
    confettiOnTakeover: true,
    toastDurationMs: 5000,
    maxToasts: 5,
    showJoins: true,            // show "X joined Morocco" in the ticker
    showUnassigned: true,       // show "X sent a gift, type a team to join!" prompts
  },

  theme: {
    accent: '#f5b301',
    textColor: '#ffffff',
    glassOpacity: 0.32,         // 0..1 card background alpha
    blur: 16,                   // px backdrop blur
    radius: 22,                 // px card corner radius
    fontScale: 1,               // 0.6..1.6
    fontFamily: 'Cairo',        // main font: 17 bundled Arabic fonts (web/lib/fonts.js) or any Google font
    titleFont: '',              // display font for titles / team names / banner ('' = same as main)
    showTeamGifts: true,        // gift images on each team card
    showGiftLegend: true,       // "🇲🇦 = 🌹" strip in the overlay header
    layout: 'list',             // 'list' | 'grid'
    position: 'right',          // 'left' | 'center' | 'right' (RTL default: right)
    width: 620,                 // px panel width (list layout)
    maxVisible: 8,              // teams shown on the overlay
    showContributors: true,
    contributorsCount: 3,
    showTicker: true,
    showHeader: true,
    showViewers: false,
    toastPosition: 'left',      // 'left' | 'right'
    showLogo: true,             // logo in the overlay header
    skin: 'classic',            // one of SKIN_IDS
    skinRotation: { mode: 'off', skins: [] }, // 'off' | 'daily' | 'weekly'; empty list = all skins
    nameScale: 1,               // team name size (all teams)
    flagScale: 1,               // team photo / emoji size
    flagShape: 'rounded',       // 'rounded' | 'circle' | 'square'
    bgImage: '',                // background picture (uploaded or https)
    bgDim: 0.55,                // 0..1 dark layer over the picture
    bgBlur: 0,                  // px
    bgOnLive: true,             // show the picture on the live page
    bgOnOverlay: false,         // show the picture in OBS (covers the stream behind!)
    background: 'transparent',  // 'transparent' or a CSS color for previewing
  },

  advanced: {
    broadcastIntervalMs: 50,    // min gap between state snapshots per WebSocket
    reconnectBaseMs: 2000,
    reconnectMaxMs: 60000,
    offlineRetryMs: 30000,      // retry interval while the streamer is not live
  },
};

/** Visual skins ("looks") for the live page and OBS overlay. Must match web/lib/skins.js. */
const SKIN_IDS = ['classic', 'neon', 'stadium', 'desert', 'ramadan', 'frost', 'inferno', 'emerald', 'royal', 'ocean', 'retro'];

/* ----------------------------------------------------------------------------
 * 2. Small utilities
 * ------------------------------------------------------------------------- */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Converts number | string | bigint | protobuf Long to a finite number. */
function num(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  if (v && typeof v.toNumber === 'function') { try { return v.toNumber(); } catch { /* ignore */ } }
  return fallback;
}
const numIn = (v, lo, hi, fb) => clamp(num(v, fb), lo, hi);
const str = (v, max = 200) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
const bool = (v, fb) => (typeof v === 'boolean' ? v : fb);
const oneOf = (v, list, fb) => (list.includes(v) ? v : fb);
const color = (v, fb) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '').trim()) ? String(v).trim() : fb);
const slug = (s) =>
  String(s || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Only allow http(s) URLs (stops javascript: / data: tricks reaching the overlay). */
function safeUrl(u) {
  const s = str(u, 1000).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

/** Image URL for config fields: https URL or an uploaded file (/uploads/<hash>.<ext>). */
const UPLOAD_RE = /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/;
function imgUrl(u) {
  const s = str(u, 1000).trim();
  return UPLOAD_RE.test(s) ? s : safeUrl(s);
}

/** Picks a browser-renderable URL from a TikTok image list (skips HEIC). */
function pickUrl(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const ok = list.map(String).filter((u) => !/\.heic/i.test(u));
  return safeUrl(ok.find((u) => /\.(jpe?g|png|webp)/i.test(u)) || ok[0] || '');
}

/** Pulls a URL from the many image shapes TikTok/connector versions use. */
function imageUrl(img) {
  if (!img) return '';
  if (typeof img === 'string') return safeUrl(img);
  return pickUrl(img.urlList) || pickUrl(img.url_list) || pickUrl(img.url) ||
    (typeof img.url === 'string' ? safeUrl(img.url) : '');
}

/** Text normalisation for keyword matching: lowercase, no Latin accents,
 *  no Arabic diacritics/tatweel. Emoji (flags) are not changed. */
function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')       // Latin combining accents
    .replace(/[ً-ٰٟـ]/g, '') // Arabic harakat + tatweel
    .normalize('NFC')
    .toLowerCase()
    .trim();
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Atomic JSON write (write temp file, then rename) so a crash never leaves a half-written file. */
async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}
function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Returns a function that runs `fn` at most once per `ms` (runs at the start and again at the end of a burst). */
function throttle(fn, ms) {
  let last = 0; let timer = null;
  const run = () => { last = Date.now(); timer = null; fn(); };
  const t = () => {
    if (timer) return;
    const wait = Math.max(0, ms() - (Date.now() - last));
    if (wait === 0) run(); else timer = setTimeout(run, wait);
  };
  t.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  return t;
}
function debounce(fn, ms) {
  let timer = null;
  const d = () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  d.flush = () => { clearTimeout(timer); return fn(); };
  return d;
}

/* ----------------------------------------------------------------------------
 * 3. Config validation
 *    Every field is type-checked and clamped. Bad input never crashes the
 *    server; it falls back to the default value.
 * ------------------------------------------------------------------------- */
function sanitizeConfig(input) {
  const src = isObj(input) ? input : {};
  const D = DEFAULT_CONFIG;
  const out = {
    title: str(src.title ?? D.title, 80),
    goal: {},
    subtitle: str(src.subtitle ?? D.subtitle, 160),
    category: str(src.category ?? D.category, 40),
    teams: [],
    scoring: {}, alerts: {}, theme: {}, advanced: {},
  };

  // ---- Teams ----
  const rawTeams = Array.isArray(src.teams) && src.teams.length ? src.teams : D.teams;
  const usedIds = new Set();
  for (const t of rawTeams.slice(0, 16)) {
    if (!isObj(t)) continue;
    const name = str(t.name, 40).trim();
    if (!name) continue;
    let id = slug(t.id || name) || `team-${out.teams.length + 1}`;
    let n = 2; const base = id;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
      .map((x) => str(x, 60).trim()).filter(Boolean).slice(0, 40);
    out.teams.push({
      id, name,
      emoji: str(t.emoji, 16).trim(),
      color: color(t.color, '#8b5cf6'),
      image: imgUrl(t.image),
      nameScale: Math.round(numIn(t.nameScale, 0.5, 2.5, 1) * 100) / 100,
      keywords: list(t.keywords),
      gifts: list(t.gifts),
    });
  }
  if (out.teams.length === 0) out.teams = clone(D.teams);

  // ---- Scoring ----
  const s = isObj(src.scoring) ? src.scoring : {};
  const DS = D.scoring;
  const gm = {};
  const rawGm = s.giftMultipliers ?? DS.giftMultipliers;
  const gmEntries = Array.isArray(rawGm)
    ? rawGm.map((r) => [r && (r.gift ?? r.name), r && r.multiplier])
    : Object.entries(isObj(rawGm) ? rawGm : {});
  for (const [k, v] of gmEntries.slice(0, 200)) {
    const key = normalizeText(k);
    if (key) gm[key] = numIn(v, 0, 1000, 1);
  }
  out.scoring = {
    globalMultiplier: numIn(s.globalMultiplier, 0, 1000, DS.globalMultiplier),
    pointsPerDiamond: numIn(s.pointsPerDiamond, 0, 1000, DS.pointsPerDiamond),
    unknownGiftValue: numIn(s.unknownGiftValue, 0, 100000, DS.unknownGiftValue),
    giftMultipliers: gm,
    allegianceEnabled: bool(s.allegianceEnabled, DS.allegianceEnabled),
    allowTeamSwitch: bool(s.allowTeamSwitch, DS.allowTeamSwitch),
    chatVotePoints: numIn(s.chatVotePoints, 0, 100000, DS.chatVotePoints),
    chatVoteCooldownSec: numIn(s.chatVoteCooldownSec, 0, 3600, DS.chatVoteCooldownSec),
    likePoints: numIn(s.likePoints, 0, 1000, DS.likePoints),
    unassignedGiftPolicy: oneOf(s.unassignedGiftPolicy, ['ignore', 'underdog', 'leader'], DS.unassignedGiftPolicy),
    giftMode: oneOf(s.giftMode, ['mixed', 'giftOnly'], DS.giftMode),
  };

  // ---- Alerts ----
  const a = isObj(src.alerts) ? src.alerts : {};
  const DA = D.alerts;
  out.alerts = {
    majorGiftPoints: numIn(a.majorGiftPoints, 1, 1e9, DA.majorGiftPoints),
    confettiOnTakeover: bool(a.confettiOnTakeover, DA.confettiOnTakeover),
    toastDurationMs: numIn(a.toastDurationMs, 1000, 60000, DA.toastDurationMs),
    maxToasts: Math.round(numIn(a.maxToasts, 1, 12, DA.maxToasts)),
    showJoins: bool(a.showJoins, DA.showJoins),
    showUnassigned: bool(a.showUnassigned, DA.showUnassigned),
  };

  // ---- Theme ----
  const th = isObj(src.theme) ? src.theme : {};
  const DT = D.theme;
  const bg = str(th.background, 40).trim();
  out.theme = {
    accent: color(th.accent, DT.accent),
    textColor: color(th.textColor, DT.textColor),
    glassOpacity: numIn(th.glassOpacity, 0, 1, DT.glassOpacity),
    blur: numIn(th.blur, 0, 60, DT.blur),
    radius: numIn(th.radius, 0, 48, DT.radius),
    fontScale: numIn(th.fontScale, 0.6, 1.6, DT.fontScale),
    fontFamily: str(th.fontFamily, 40).replace(/[^\w \-]/g, '').trim() || DT.fontFamily,
    titleFont: str(th.titleFont, 40).replace(/[^\w \-]/g, '').trim(),
    showTeamGifts: bool(th.showTeamGifts, DT.showTeamGifts),
    showGiftLegend: bool(th.showGiftLegend, DT.showGiftLegend),
    layout: oneOf(th.layout, ['list', 'grid'], DT.layout),
    position: oneOf(th.position, ['left', 'center', 'right'], DT.position),
    width: numIn(th.width, 320, 1800, DT.width),
    maxVisible: Math.round(numIn(th.maxVisible, 1, 16, DT.maxVisible)),
    showContributors: bool(th.showContributors, DT.showContributors),
    contributorsCount: Math.round(numIn(th.contributorsCount, 1, 5, DT.contributorsCount)),
    showTicker: bool(th.showTicker, DT.showTicker),
    showHeader: bool(th.showHeader, DT.showHeader),
    showLogo: bool(th.showLogo, DT.showLogo),
    skin: oneOf(th.skin, SKIN_IDS, DT.skin),
    skinRotation: {
      mode: oneOf(isObj(th.skinRotation) ? th.skinRotation.mode : '', ['off', 'daily', 'weekly'], 'off'),
      skins: (isObj(th.skinRotation) && Array.isArray(th.skinRotation.skins) ? th.skinRotation.skins : [])
        .filter((x, i, a) => SKIN_IDS.includes(x) && a.indexOf(x) === i),
    },
    nameScale: numIn(th.nameScale, 0.5, 2.5, DT.nameScale),
    flagScale: numIn(th.flagScale, 0.5, 2.5, DT.flagScale),
    flagShape: oneOf(th.flagShape, ['rounded', 'circle', 'square'], DT.flagShape),
    bgImage: imgUrl(th.bgImage),
    bgDim: numIn(th.bgDim, 0, 1, DT.bgDim),
    bgBlur: numIn(th.bgBlur, 0, 30, DT.bgBlur),
    bgOnLive: bool(th.bgOnLive, DT.bgOnLive),
    bgOnOverlay: bool(th.bgOnOverlay, DT.bgOnOverlay),
    showViewers: bool(th.showViewers, DT.showViewers),
    toastPosition: oneOf(th.toastPosition, ['left', 'right'], DT.toastPosition),
    // Only "transparent" or simple CSS colour tokens: no url(), no expressions.
    background: /^(transparent|#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(bg) ? bg : DT.background,
  };

  // ---- Goal ----
  const g = isObj(src.goal) ? src.goal : {};
  out.goal = {
    enabled: bool(g.enabled, D.goal.enabled),
    target: Math.round(numIn(g.target, 1, 1e12, D.goal.target)),
    label: str(g.label ?? D.goal.label, 80),
  };

  // ---- Advanced ----
  const ad = isObj(src.advanced) ? src.advanced : {};
  const DAd = D.advanced;
  out.advanced = {
    broadcastIntervalMs: numIn(ad.broadcastIntervalMs, 16, 2000, DAd.broadcastIntervalMs),
    reconnectBaseMs: numIn(ad.reconnectBaseMs, 500, 60000, DAd.reconnectBaseMs),
    reconnectMaxMs: numIn(ad.reconnectMaxMs, 5000, 600000, DAd.reconnectMaxMs),
    offlineRetryMs: numIn(ad.offlineRetryMs, 5000, 600000, DAd.offlineRetryMs),
  };
  return out;
}

/* ----------------------------------------------------------------------------
 * 4. Keyword matcher
 *    Turns team keywords (plus team name and emoji) into one matcher.
 *    - Plain Latin/number keywords match only as whole words, so "dz" does
 *      not match inside "adze".
 *    - Emoji / Arabic / other keywords use substring matching.
 *    - If a message names several teams, the one mentioned FIRST wins.
 * ------------------------------------------------------------------------- */
function buildMatcher(teams) {
  const entries = [];
  for (const t of teams) {
    const words = new Set([t.name, t.emoji, ...t.keywords].map(normalizeText).filter(Boolean));
    for (const kw of words) {
      const wordLike = /^[a-z0-9 ]+$/.test(kw);
      entries.push({
        teamId: t.id,
        kw,
        re: wordLike ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(kw)}(?=$|[^\\p{L}\\p{N}])`, 'u') : null,
      });
    }
  }
  return function match(text) {
    const t = normalizeText(text);
    if (!t) return null;
    let best = null;
    for (const e of entries) {
      const idx = e.re ? t.search(e.re) : t.indexOf(e.kw);
      if (idx < 0) continue;
      if (!best || idx < best.idx || (idx === best.idx && e.kw.length > best.len)) {
        best = { teamId: e.teamId, idx, len: e.kw.length };
      }
    }
    return best ? best.teamId : null;
  };
}

/* ----------------------------------------------------------------------------
 * 5. Event normalisation
 *    Converts v2 (nested protobuf objects) and v1 (flat "legacy" objects)
 *    payloads into one shape that the rest of the code uses.
 * ------------------------------------------------------------------------- */
function normalizeUser(raw) {
  const u = isObj(raw.user) ? raw.user : raw;
  const uniqueId = str(u.uniqueId || u.displayId || raw.uniqueId || '', 64);
  const userId = str(u.userId || u.idStr || (u.id && u.id !== '0' ? u.id : '') || raw.userId || uniqueId || 'anon', 64);
  return {
    userId,
    uniqueId,
    nickname: str(u.nickname || raw.nickname || uniqueId || 'Anonymous', 48),
    avatar: safeUrl(u.profilePictureUrl || raw.profilePictureUrl) ||
      imageUrl(u.avatarThumb) || imageUrl(u.avatarMedium) || imageUrl(u.avatarLarge) || imageUrl(u.profilePicture),
  };
}

function normalizeGift(raw, catalog) {
  const gd = isObj(raw.giftDetails) ? raw.giftDetails : {};
  const ext = isObj(raw.extendedGiftInfo) ? raw.extendedGiftInfo : {};
  const giftId = num(raw.giftId ?? gd.id ?? ext.id ?? raw.gift?.gift_id, 0);
  const known = catalog.find(giftId, gd.giftName || raw.giftName || ext.name);
  const diamonds = num(gd.diamondCount ?? raw.diamondCount ?? ext.diamond_count ?? ext.diamondCount, NaN);
  return {
    user: normalizeUser(raw),
    giftId,
    name: str(gd.giftName || raw.giftName || ext.name || (known && known.name) || `Gift #${giftId}`, 48),
    diamonds: Number.isFinite(diamonds) && diamonds > 0 ? diamonds : (known ? known.diamonds : 0),
    giftType: num(gd.giftType ?? raw.giftType ?? ext.type ?? raw.gift?.gift_type, 0),
    repeatCount: Math.max(1, Math.floor(num(raw.repeatCount ?? raw.gift?.repeat_count, 1))),
    repeatEnd: Boolean(raw.repeatEnd ?? raw.gift?.repeat_end),
    groupId: str(raw.groupId ?? '', 40),
    image: imageUrl(gd.giftImage) || safeUrl(raw.giftPictureUrl) || imageUrl(ext.image) || (known ? known.remote : ''),
  };
}

/* ----------------------------------------------------------------------------
 * 6. Scoreboard engine (all state lives here)
 * ------------------------------------------------------------------------- */
const TOP_K = 5;                  // contributors kept per team in each snapshot
const MAX_ALLEGIANCE = 100000;    // cap on remembered viewer->team links (oldest dropped)
const MAX_CONTRIB_PERSIST = 300;  // contributors saved to disk for each team

class ScoreBoard extends EventEmitter {
  constructor(config) {
    super();
    this.rev = 0;
    this.teams = new Map();       // teamId -> { score, contributors: Map, top: [] }
    this.allegiance = new Map();  // userId -> teamId
    this.voteCooldown = new Map();// userId -> last vote timestamp
    this.leaderId = null;
    this.applyConfig(config);
  }

  /** Applies a new config. Scores for teams that still exist (same id) are kept. */
  applyConfig(config) {
    this.config = config;
    this.match = buildMatcher(config.teams);
    // Gift name/id -> teamId lookup
    this.giftTeam = new Map();
    for (const t of config.teams) for (const g of t.gifts) { const k = normalizeText(g); if (!this.giftTeam.has(k)) this.giftTeam.set(k, t.id); }

    const next = new Map();
    for (const t of config.teams) next.set(t.id, this.teams.get(t.id) || this._emptyTeam());
    this.teams = next;
    // Forget allegiances pointing at deleted teams
    for (const [uid, tid] of this.allegiance) if (!next.has(tid)) this.allegiance.delete(uid);
    this.leaderId = this._computeLeader(this.leaderId);
    this._changed();
  }

  _emptyTeam() { return { score: 0, contributors: new Map(), top: [] }; }

  /** Resets all scores. With `keepAllegiance` false, viewers must pick a team again. */
  reset(keepAllegiance = true) {
    for (const id of this.teams.keys()) this.teams.set(id, this._emptyTeam());
    if (!keepAllegiance) this.allegiance.clear();
    this.voteCooldown.clear();
    this.leaderId = null;
    this._changed();
  }

  /** Gift value = diamonds x count x per-gift multiplier x global multiplier. */
  giftPoints(gift, count) {
    const s = this.config.scoring;
    const base = gift.diamonds > 0 ? gift.diamonds * s.pointsPerDiamond : s.unknownGiftValue;
    const gm = s.giftMultipliers;
    const mult = gm[normalizeText(gift.name)] ?? gm[String(gift.giftId)] ?? 1;
    return Math.round(base * count * mult * s.globalMultiplier * 100) / 100;
  }

  /** Works out the team for a gift: gift mapping > viewer allegiance > fallback policy. */
  resolveGiftTeam(gift) {
    const byGift = this.giftTeam.get(normalizeText(gift.name)) || this.giftTeam.get(String(gift.giftId));
    if (byGift) return { teamId: byGift, via: 'gift' };
    // "Team gift only" mode: other gifts don't count (the ticker tells the viewer which gift to send).
    if (this.config.scoring.giftMode === 'giftOnly') return { teamId: null, via: 'none' };
    const byUser = this.allegiance.get(gift.user.userId);
    if (byUser && this.teams.has(byUser)) return { teamId: byUser, via: 'allegiance' };
    const policy = this.config.scoring.unassignedGiftPolicy;
    if (policy === 'ignore') return { teamId: null, via: 'none' };
    const ranked = this.ranked();
    const pick = policy === 'leader' ? ranked[0] : ranked[ranked.length - 1];
    return { teamId: pick ? pick.id : null, via: policy };
  }

  /** Links a viewer to a team. Returns true if the viewer's team changed. */
  setAllegiance(userId, teamId) {
    const prev = this.allegiance.get(userId);
    if (prev === teamId) return false;
    if (prev && !this.config.scoring.allowTeamSwitch) return false;
    this.allegiance.delete(userId); // re-insert so this viewer counts as most recent
    this.allegiance.set(userId, teamId);
    if (this.allegiance.size > MAX_ALLEGIANCE) this.allegiance.delete(this.allegiance.keys().next().value);
    this._changed(false);
    return true;
  }

  /** Per-viewer cooldown for chat votes. */
  canVote(userId) {
    const now = Date.now();
    const last = this.voteCooldown.get(userId) || 0;
    if (now - last < this.config.scoring.chatVoteCooldownSec * 1000) return false;
    this.voteCooldown.set(userId, now);
    if (this.voteCooldown.size > 50000) this.voteCooldown.clear();
    return true;
  }

  /**
   * Adds points to a team (and to the viewer, if one is given) and updates
   * the top contributors list. Returns { takeover, prevLeader } so the
   * caller can send a "takes the lead" alert.
   */
  addPoints(teamId, points, user) {
    const team = this.teams.get(teamId);
    if (!team || !Number.isFinite(points) || points === 0) return { takeover: false };
    team.score = Math.max(0, Math.round((team.score + points) * 100) / 100);

    if (user && points > 0) {
      let c = team.contributors.get(user.userId);
      if (!c) { c = { id: user.userId, u: user.uniqueId, n: user.nickname, a: user.avatar, p: 0 }; team.contributors.set(user.userId, c); }
      c.p = Math.round((c.p + points) * 100) / 100;
      c.n = user.nickname || c.n; c.a = user.avatar || c.a; c.u = user.uniqueId || c.u;
      this._updateTop(team, c);
    }

    const prevLeader = this.leaderId;
    this.leaderId = this._computeLeader(prevLeader);
    this._changed();
    const takeover = Boolean(prevLeader && this.leaderId && prevLeader !== this.leaderId);
    // The first points of the match also count as "taking the lead".
    const firstBlood = !prevLeader && this.leaderId && points > 0;
    return { takeover: takeover || Boolean(firstBlood), prevLeader };
  }

  /** Keeps the top-K list up to date in small steps, so we never sort
   *  thousands of contributors on every gift. */
  _updateTop(team, c) {
    const top = team.top;
    const i = top.indexOf(c);
    if (i === -1) {
      if (top.length < TOP_K || c.p > top[top.length - 1].p) {
        top.push(c);
        top.sort((a, b) => b.p - a.p);
        if (top.length > TOP_K) top.length = TOP_K;
      }
    } else {
      top.sort((a, b) => b.p - a.p);
    }
  }

  _rebuildTop(team) {
    team.top = [...team.contributors.values()].sort((a, b) => b.p - a.p).slice(0, TOP_K);
  }

  /** Manual score change from the host (positive or negative). */
  adjust(teamId, delta) {
    const team = this.teams.get(teamId);
    if (!team) return { takeover: false };
    if (delta < 0) {
      team.score = Math.max(0, Math.round((team.score + delta) * 100) / 100);
      const prev = this.leaderId;
      this.leaderId = this._computeLeader(prev);
      this._changed();
      return { takeover: Boolean(prev && this.leaderId && prev !== this.leaderId), prevLeader: prev };
    }
    return this.addPoints(teamId, delta, null);
  }

  /** The leader keeps 1st place on a tie; a challenger must pass them. */
  _computeLeader(current) {
    let best = null; let bestScore = 0;
    for (const [id, t] of this.teams) if (t.score > bestScore) { best = id; bestScore = t.score; }
    if (current && this.teams.has(current) && this.teams.get(current).score === bestScore && bestScore > 0) return current;
    return best;
  }

  ranked() {
    return this.config.teams
      .map((t, i) => ({ id: t.id, i, score: this.teams.get(t.id)?.score || 0 }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
  }

  _changed(bumpRev = true) {
    if (bumpRev) this.rev++;
    this.emit('change');
  }

  /** Small snapshot sent to overlays (no full contributor lists). */
  snapshot() {
    let total = 0;
    const teams = [];
    for (const [id, t] of this.teams) {
      total += t.score;
      teams.push({ id, score: t.score, supporters: t.contributors.size, top: t.top.map(({ u, n, a, p }) => ({ u, n, a, p })) });
    }
    return { rev: this.rev, total: Math.round(total * 100) / 100, leaderId: this.leaderId, teams, ts: Date.now() };
  }

  /** Data saved to disk. */
  serialize() {
    const teams = {};
    for (const [id, t] of this.teams) {
      teams[id] = {
        score: t.score,
        contributors: [...t.contributors.values()].sort((a, b) => b.p - a.p).slice(0, MAX_CONTRIB_PERSIST),
      };
    }
    return { version: 1, savedAt: new Date().toISOString(), leaderId: this.leaderId, teams, allegiance: [...this.allegiance] };
  }

  restore(data) {
    if (!isObj(data) || !isObj(data.teams)) return;
    for (const [id, t] of Object.entries(data.teams)) {
      const team = this.teams.get(id);
      if (!team || !isObj(t)) continue;
      team.score = Math.max(0, num(t.score, 0));
      team.contributors = new Map();
      for (const c of Array.isArray(t.contributors) ? t.contributors : []) {
        if (c && c.id) team.contributors.set(String(c.id), { id: String(c.id), u: str(c.u, 64), n: str(c.n, 48), a: safeUrl(c.a), p: num(c.p, 0) });
      }
      this._rebuildTop(team);
    }
    if (Array.isArray(data.allegiance)) {
      for (const pair of data.allegiance.slice(-MAX_ALLEGIANCE)) {
        if (Array.isArray(pair) && this.teams.has(pair[1])) this.allegiance.set(String(pair[0]), pair[1]);
      }
    }
    this.leaderId = this._computeLeader(data.leaderId);
    this._changed();
  }
}

/* ----------------------------------------------------------------------------
 * 7. Gift catalog (gift names, diamond costs and images, for the setup panel)
 * ------------------------------------------------------------------------- */
/**
 * Gift catalog: names, diamond costs and REAL TikTok gift images.
 * - Saved to data/gifts.json, so images survive restarts and offline time.
 * - Each image is downloaded once from TikTok's CDN into data/gift-images and
 *   served from /gift-img/<id>.<ext> (fast, and OBS never depends on TikTok's CDN).
 * - Filled from: the room gift list when connected, every received gift,
 *   and the panel's "fetch gifts" button (any account that is live).
 */
const GIFTS_FILE = path.join(SETTINGS.dataDir, 'gifts.json');
const GIFT_IMG_DIR = path.join(SETTINGS.dataDir, 'gift-images');
const GIFT_IMG_RE = /^\/gift-img\/(\d{1,20})\.(png|jpg|webp|gif)$/;
// Only download from TikTok's image servers (gift URLs come from TikTok, but never fetch arbitrary hosts).
const GIFT_HOST_RE = /(^|\.)(tiktokcdn(-us|-eu)?|ibyteimg|byteimg|muscdn|tiktokv|ttwstatic)\.com$/i;
const giftHostOk = (u) => { try { const h = new URL(u).hostname; return GIFT_HOST_RE.test(h) || (process.env.GIFT_IMG_ALLOW_LOCAL === '1' && /^(127\.0\.0\.1|localhost)$/.test(h)); } catch { return false; } };

class GiftCatalog extends EventEmitter {
  constructor() {
    super();
    this.byId = new Map();
    this.byName = new Map();
    this.queue = [];
    this.active = 0;
    this.failed = new Set();
    this._notify = debounce(() => this.emit('change'), 500);
    this._save = debounce(() => writeJsonAtomic(GIFTS_FILE, [...this.byId.values()]).catch((e) => log.warn('Gift catalog save failed:', e.message)), 2000);
  }

  load() {
    const arr = readJsonSafe(GIFTS_FILE);
    if (!Array.isArray(arr)) return;
    for (const g of arr) {
      if (!isObj(g) || !g.name) continue;
      const local = typeof g.local === 'string' && GIFT_IMG_RE.test(g.local) && fs.existsSync(path.join(GIFT_IMG_DIR, path.basename(g.local))) ? g.local : '';
      const e = { id: num(g.id, 0), name: str(g.name, 48), diamonds: num(g.diamonds, 0), remote: safeUrl(g.remote), local };
      this.byId.set(e.id, e); this.byName.set(e.name.toLowerCase(), e.id);
      if (!e.local && e.remote) this._enqueue(e);
    }
    log.info(`Gift catalog: ${this.byId.size} gifts (${[...this.byId.values()].filter((e) => e.local).length} images cached)`);
  }

  add(g) {
    const id = num(g.id, 0);
    const name = str(g.name, 48).trim();
    if (!name || /^Gift #/.test(name) && this.byId.has(id)) return;
    const prev = this.byId.get(id);
    const remote = safeUrl(g.image) || (prev ? prev.remote : '');
    const entry = { id, name, diamonds: num(g.diamonds, 0) || (prev ? prev.diamonds : 0), remote, local: prev ? prev.local : '' };
    if (prev && prev.name === entry.name && prev.diamonds === entry.diamonds && prev.remote === entry.remote) return;
    this.byId.set(id, entry);
    this.byName.set(name.toLowerCase(), id);
    if (remote && !entry.local) this._enqueue(entry);
    this._notify(); this._save();
  }

  /** Finds a gift by id, then by name (case-insensitive). */
  find(id, name) {
    return this.byId.get(num(id, -1)) || this.byId.get(this.byName.get(String(name || '').toLowerCase()));
  }
  imageFor(id, name) { const e = this.find(id, name); return e ? e.local || e.remote : ''; }

  /** Accepts the connector's gift list in any of the shapes it has used. */
  ingest(list) {
    let arr = [];
    if (Array.isArray(list)) arr = list;
    else if (isObj(list)) {
      arr = list.gifts || list.giftList || list.gift_list || [];
      if (Array.isArray(list.pages)) for (const p of list.pages) arr = arr.concat(p.gifts || []);
    }
    let n = 0;
    for (const g of arr) {
      if (!isObj(g)) continue;
      this.add({ id: g.id, name: g.name || g.giftName, diamonds: g.diamond_count ?? g.diamondCount, image: imageUrl(g.image || g.icon || g.giftImage) });
      n++;
    }
    return n;
  }

  list() {
    return [...this.byId.values()]
      .map((e) => ({ id: e.id, name: e.name, diamonds: e.diamonds, image: e.local || e.remote }))
      .sort((a, b) => a.diamonds - b.diamonds || a.name.localeCompare(b.name));
  }

  _enqueue(e) {
    if (this.failed.has(e.id) || this.queue.includes(e) || !giftHostOk(e.remote)) return;
    this.queue.push(e);
    this._pump();
  }
  _pump() {
    while (this.active < 4 && this.queue.length) {
      const e = this.queue.shift();
      this.active++;
      this._download(e).finally(() => { this.active--; this._pump(); });
    }
  }
  async _download(e) {
    try {
      const r = await fetch(e.remote, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 2 * 1024 * 1024) throw new Error('too large');
      const type = imageType(buf);
      if (!type) throw new Error('not an image');
      await fsp.mkdir(GIFT_IMG_DIR, { recursive: true });
      const name = `${e.id}.${type}`;
      await fsp.writeFile(path.join(GIFT_IMG_DIR, name), buf);
      e.local = `/gift-img/${name}`;
      this._notify(); this._save();
    } catch (err) {
      this.failed.add(e.id);
      log.warn(`Gift image download failed (${e.name}): ${err.message}`);
    }
  }
}

/* ----------------------------------------------------------------------------
 * 8. Event pipeline: raw TikTok events -> scores + alerts
 * ------------------------------------------------------------------------- */
class Pipeline extends EventEmitter {
  constructor(board, catalog) {
    super();
    this.board = board;
    this.catalog = catalog;
    // Streak tracking: key -> { count, ts }. Lets us count combo gifts as they
    // happen (by the change in repeatCount) instead of waiting for the combo to end.
    this.streaks = new Map();
    this.stats = { gifts: 0, chats: 0, likes: 0, points: 0 };
    this._gc = setInterval(() => this._sweepStreaks(), 30000);
    this._gc.unref();
  }

  _sweepStreaks() {
    const cutoff = Date.now() - 120000;
    for (const [k, v] of this.streaks) if (v.ts < cutoff) this.streaks.delete(k);
  }

  /**
   * Handles a gift event.
   * TikTok streak gifts (giftType 1) arrive many times with a rising
   * repeatCount, then once more with repeatEnd=true. We score only the
   * difference from the last event so each gift counts exactly once, live.
   */
  handleGift(raw, opts = {}) {
    let gift;
    try { gift = normalizeGift(raw, this.catalog); } catch (e) { log.warn('Bad gift payload:', e.message); return; }
    this.catalog.add({ id: gift.giftId, name: gift.name, diamonds: gift.diamonds, image: gift.image });

    const streakable = gift.giftType === 1;
    const key = `${gift.user.userId}:${gift.giftId}:${gift.groupId}`;
    let delta;
    if (streakable) {
      const prev = this.streaks.get(key);
      const prevCount = prev ? prev.count : 0;
      delta = Math.max(0, gift.repeatCount - prevCount);
      if (gift.repeatEnd) this.streaks.delete(key);
      else this.streaks.set(key, { count: Math.max(prevCount, gift.repeatCount), ts: Date.now() });
    } else {
      delta = gift.repeatCount;
    }
    if (delta <= 0) return; // the streak-end event repeated a count we already scored

    this.stats.gifts += delta;
    // A forced team (from the simulator) works like a chat join.
    if (opts.forceTeam && this.board.teams.has(opts.forceTeam)) this.board.setAllegiance(gift.user.userId, opts.forceTeam);

    const { teamId, via } = this.board.resolveGiftTeam(gift);
    const points = this.board.giftPoints(gift, delta);

    if (!teamId) {
      this.emit('event', {
        kind: 'unassigned', user: gift.user,
        gift: { name: gift.name, image: this.catalog.imageFor(gift.giftId, gift.name) || gift.image, count: gift.repeatCount }, points,
      });
      return;
    }

    // A gift mapped to a team also makes the sender a supporter of that team (if they have no team yet).
    if (via === 'gift' && !this.board.allegiance.has(gift.user.userId)) this.board.allegiance.set(gift.user.userId, teamId);

    const result = this.board.addPoints(teamId, points, gift.user);
    this.stats.points += points;
    this.emit('event', {
      kind: 'gift',
      teamId, via, user: gift.user, points,
      gift: { id: gift.giftId, name: gift.name, image: this.catalog.imageFor(gift.giftId, gift.name) || gift.image, diamonds: gift.diamonds, count: gift.repeatCount, delta },
      streakKey: streakable ? key : null,
      final: !streakable || gift.repeatEnd,
      major: points >= this.board.config.alerts.majorGiftPoints,
    });
    if (result.takeover) this.emit('event', { kind: 'takeover', teamId, prevTeamId: result.prevLeader || null });
  }

  /** Chat: keyword/emoji -> viewer joins a team (+ optional vote points). */
  handleChat(raw) {
    const comment = str(raw.comment, 300);
    if (!comment) return;
    this.stats.chats++;
    const teamId = this.board.match(comment);
    if (!teamId) return;
    const user = normalizeUser(raw);
    const s = this.board.config.scoring;

    let joined = false;
    if (s.allegianceEnabled) joined = this.board.setAllegiance(user.userId, teamId);

    let points = 0;
    if (s.chatVotePoints > 0 && this.board.canVote(user.userId)) {
      // Votes count for the viewer's CURRENT team (if switching is off, the old team).
      const target = s.allegianceEnabled ? (this.board.allegiance.get(user.userId) || teamId) : teamId;
      points = s.chatVotePoints;
      const r = this.board.addPoints(target, points, user);
      if (r.takeover) this.emit('event', { kind: 'takeover', teamId: target, prevTeamId: r.prevLeader || null });
    }
    if (joined || points) this.emit('event', { kind: 'join', teamId: this.board.allegiance.get(user.userId) || teamId, user, points, comment: comment.slice(0, 80) });
  }

  /** Likes: optional points for viewers who already have a team. */
  handleLike(raw) {
    const s = this.board.config.scoring;
    const likes = Math.max(0, Math.floor(num(raw.likeCount ?? raw.count, 0)));
    this.stats.likes += likes;
    if (s.likePoints <= 0 || likes === 0) return;
    const user = normalizeUser(raw);
    const teamId = this.board.allegiance.get(user.userId);
    if (!teamId) return;
    const r = this.board.addPoints(teamId, likes * s.likePoints, user);
    if (r.takeover) this.emit('event', { kind: 'takeover', teamId, prevTeamId: r.prevLeader || null });
  }
}

/* ----------------------------------------------------------------------------
 * 9. TikTok connection manager (auto-reconnect with exponential backoff)
 * ------------------------------------------------------------------------- */
let connectorLib = null;
/** Loads the connector lazily. ESM-only v2 is loaded with dynamic import(). */
async function loadConnector() {
  if (connectorLib) return connectorLib;
  let mod;
  try { mod = await import('tiktok-live-connector'); } catch (e) {
    throw new Error(`tiktok-live-connector is not installed (npm i tiktok-live-connector): ${e.message}`);
  }
  const m = mod.TikTokLiveConnection || mod.WebcastPushConnection ? mod : (mod.default || mod);
  if (m.TikTokLiveConnection) {
    if (serverSettings.signApiKey && m.SignConfig) m.SignConfig.apiKey = serverSettings.signApiKey;
    connectorLib = { kind: 'v2', Ctor: m.TikTokLiveConnection };
  } else if (m.WebcastPushConnection) {
    connectorLib = { kind: 'v1', Ctor: m.WebcastPushConnection };
  } else {
    throw new Error('Unsupported tiktok-live-connector version (no connection class found).');
  }
  log.info(`Loaded tiktok-live-connector (${connectorLib.kind} API)`);
  return connectorLib;
}

class TikTokManager extends EventEmitter {
  constructor(pipeline, getConfig) {
    super();
    this.pipeline = pipeline;
    this.getConfig = getConfig;
    this.conn = null;
    this.generation = 0;      // increases on every start/stop; stale callbacks are ignored
    this.desired = null;      // username we WANT to be connected to (null = stay disconnected)
    this.attempt = 0;
    this.retryTimer = null;
    this.status = { state: 'idle', username: '', roomId: null, viewers: 0, attempt: 0, nextRetryAt: null, message: '', since: Date.now() };
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
    if (patch.state) this.status.since = Date.now();
    this.emit('status', this.status);
  }

  /** Start (or switch to) a stream. Safe to call again at any time. */
  async start(username) {
    const u = String(username || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '').replace(/\/.*$/, '');
    if (!/^[\w.]{2,40}$/.test(u)) throw new Error('اسم مستخدم تيك توك غير صالح');
    this.desired = u;
    this.attempt = 0;
    const gen = ++this.generation;
    this._clearRetry();
    await this._teardown();
    this._setStatus({ username: u, roomId: null, viewers: 0 });
    this._connect(gen);
  }

  async stop() {
    this.desired = null;
    this.generation++;
    this._clearRetry();
    await this._teardown();
    this._setStatus({ state: 'idle', roomId: null, viewers: 0, attempt: 0, nextRetryAt: null, message: 'Disconnected by host' });
  }

  _clearRetry() { clearTimeout(this.retryTimer); this.retryTimer = null; }

  /** Gift list of the room we're connected to (null when not connected). */
  async fetchGifts() {
    const c = this.conn;
    if (!c || this.status.state !== 'connected') return null;
    if (c.availableGifts) return c.availableGifts;
    const f = c.fetchAvailableGifts || c.getAvailableGifts;
    return f ? f.call(c) : null;
  }

  async _teardown() {
    const c = this.conn;
    this.conn = null;
    if (!c) return;
    try { c.removeAllListeners && c.removeAllListeners(); } catch { /* ignore */ }
    // Keep a no-op error handler so a late socket error cannot crash the process.
    try { c.on && c.on('error', () => {}); } catch { /* ignore */ }
    try { await Promise.race([Promise.resolve(c.disconnect && c.disconnect()), new Promise((r) => setTimeout(r, 3000))]); } catch { /* ignore */ }
  }

  async _connect(gen) {
    if (gen !== this.generation || !this.desired) return;
    let lib;
    try { lib = await loadConnector(); } catch (e) {
      this._setStatus({ state: 'error', message: e.message });
      log.error(e.message);
      return; // retrying will not help until the package is installed
    }
    if (gen !== this.generation) return;

    this._setStatus({ state: this.attempt ? 'reconnecting' : 'connecting', attempt: this.attempt, nextRetryAt: null, message: `Connecting to @${this.desired}...` });
    const opts = lib.kind === 'v2'
      ? { processInitialData: false, enableExtendedGiftInfo: true, ...(serverSettings.signApiKey ? { signApiKey: serverSettings.signApiKey } : {}) }
      : { processInitialData: false, enableExtendedGiftInfo: true, enableWebsocketUpgrade: true, requestPollingIntervalMs: 2000 };

    let conn;
    try { conn = new lib.Ctor(this.desired, opts); } catch (e) { return this._scheduleRetry(gen, e); }
    this.conn = conn;

    // Each handler checks `gen`, so events from an old connection are ignored.
    const live = () => gen === this.generation && this.conn === conn;
    const guard = (name, fn) => (data) => {
      if (!live()) return;
      try { fn(data || {}); } catch (e) { log.warn(`Handler "${name}" failed:`, e.message); }
    };
    let lost = false;
    const onLost = (why) => {
      if (!live() || lost) return;
      lost = true;
      log.warn(`Connection lost (${why}).`);
      this._teardown().finally(() => this._scheduleRetry(gen, new Error(why)));
    };

    conn.on('gift', guard('gift', (d) => this.pipeline.handleGift(d)));
    conn.on('chat', guard('chat', (d) => this.pipeline.handleChat(d)));
    conn.on('like', guard('like', (d) => this.pipeline.handleLike(d)));
    conn.on('roomUser', guard('roomUser', (d) => {
      const v = num(d.viewerCount ?? d.total ?? d.totalUser, NaN);
      if (Number.isFinite(v) && v !== this.status.viewers) this._setStatus({ viewers: v });
    }));
    conn.on('streamEnd', () => onLost('stream ended'));
    conn.on('disconnected', (info) => onLost(`disconnected${info && info.reason ? `: ${info.reason}` : ''}`));
    conn.on('error', (err) => {
      if (!live()) return;
      const msg = err && (err.info || err.message || (err.exception && err.exception.message)) || String(err);
      log.warn('Connector error:', msg);
    });

    try {
      const state = await withTimeout(Promise.resolve(conn.connect()), 45000, 'Connect timed out');
      if (!live()) { try { conn.disconnect(); } catch { /* ignore */ } return; }
      this.attempt = 0;
      this._setStatus({ state: 'connected', roomId: state && state.roomId ? String(state.roomId) : null, attempt: 0, nextRetryAt: null, message: `Connected to @${this.desired}` });
      log.info(`Connected to @${this.desired} (room ${this.status.roomId || '?'})`);
      // Fill the gift catalog for the setup panel (best effort; may already be cached).
      const gifts = (state && state.availableGifts) || conn.availableGifts;
      if (gifts) this.pipeline.catalog.ingest(gifts);
      else {
        const f = conn.fetchAvailableGifts || conn.getAvailableGifts;
        if (f) Promise.resolve(f.call(conn)).then((g) => live() && this.pipeline.catalog.ingest(g)).catch(() => {});
      }
    } catch (err) {
      if (!live()) return;
      await this._teardown();
      this._scheduleRetry(gen, err);
    }
  }

  _scheduleRetry(gen, err) {
    if (gen !== this.generation || !this.desired) return;
    const adv = this.getConfig().advanced;
    const msg = String((err && (err.message || err.info)) || err || 'unknown error');
    const name = String((err && err.constructor && err.constructor.name) || '');
    const offline = /offline|not.*live|isn't online|LIVE has ended|stream ended|19881007/i.test(msg) || name === 'UserOfflineError';
    const rateLimited = /rate.?limit|429|too many/i.test(msg) || name === 'SignatureRateLimitError';
    this.attempt++;
    let delay;
    if (offline) delay = adv.offlineRetryMs;
    else if (rateLimited) delay = Math.max(60000, adv.reconnectMaxMs);
    else delay = Math.min(adv.reconnectMaxMs, adv.reconnectBaseMs * 2 ** Math.min(this.attempt - 1, 10));
    delay = Math.round(delay * (0.85 + Math.random() * 0.3)); // jitter so retries don't line up
    this._setStatus({
      state: offline ? 'offline' : 'reconnecting',
      attempt: this.attempt,
      nextRetryAt: Date.now() + delay,
      message: offline ? `@${this.desired} is not live. Retrying...` : `${msg.slice(0, 160)}`,
    });
    log.warn(`Retry #${this.attempt} in ${(delay / 1000).toFixed(1)}s (${offline ? 'offline' : rateLimited ? 'rate limited' : msg})`);
    this._clearRetry();
    this.retryTimer = setTimeout(() => this._connect(gen), delay);
  }
}

function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

/* ----------------------------------------------------------------------------
 * 10. Demo traffic generator (test the overlay with no live stream)
 *     It sends v2-shaped raw payloads through the normal pipeline, so it
 *     tests the same code that handles real TikTok events.
 * ------------------------------------------------------------------------- */
class DemoSimulator {
  constructor(pipeline, board) {
    this.pipeline = pipeline; this.board = board; this.timer = null; this.streakTimers = new Set();
    this.users = ['Yassine', 'Amine', 'Sara', 'Karim', 'Lina', 'Omar', 'Nour', 'Rayan', 'Ines', 'Walid', 'Hiba', 'Mehdi', 'Salma', 'Anis', 'Yasmine', 'Bilal', 'Aya', 'Zakaria', 'Malak', 'Hamza', 'Rania', 'Youssef', 'Imane', 'Adam']
      .map((n, i) => ({ id: String(7000000 + i), displayId: `${n.toLowerCase()}_${(i * 37) % 97}`, nickname: n, avatarThumb: { urlList: [] } }));
    this.gifts = [
      { id: 5655, name: 'Rose', d: 1, t: 1, w: 30 },
      { id: 5269, name: 'TikTok', d: 1, t: 1, w: 18 },
      { id: 5487, name: 'Finger Heart', d: 5, t: 1, w: 14 },
      { id: 5827, name: 'Ice Cream Cone', d: 1, t: 1, w: 14 },
      { id: 5658, name: 'Perfume', d: 20, t: 1, w: 8 },
      { id: 5879, name: 'Doughnut', d: 30, t: 1, w: 6 },
      { id: 5660, name: 'Hand Hearts', d: 100, t: 2, w: 4 },
      { id: 6267, name: 'Corgi', d: 299, t: 2, w: 2.5 },
      { id: 5955, name: 'Galaxy', d: 1000, t: 2, w: 1 },
      { id: 6369, name: 'Lion', d: 29999, t: 2, w: 0.08 },
    ];
  }
  get running() { return Boolean(this.timer); }
  start() {
    if (this.timer) return;
    const tick = () => { this._tick(); this.timer = setTimeout(tick, 250 + Math.random() * 900); };
    this.timer = setTimeout(tick, 300);
    log.info('Demo mode ON');
  }
  stop() {
    clearTimeout(this.timer); this.timer = null;
    for (const t of this.streakTimers) clearTimeout(t);
    this.streakTimers.clear();
    log.info('Demo mode OFF');
  }
  _pickWeighted(list) {
    const total = list.reduce((s, g) => s + g.w, 0);
    let r = Math.random() * total;
    for (const g of list) { if ((r -= g.w) <= 0) return g; }
    return list[0];
  }
  _tick() {
    const user = this.users[Math.floor(Math.random() * this.users.length)];
    const teams = this.board.config.teams;
    if (Math.random() < 0.25 || !this.board.allegiance.has(user.id)) {
      const t = teams[Math.floor(Math.random() * teams.length)];
      const kw = [t.emoji, t.name, ...t.keywords].filter(Boolean);
      this.pipeline.handleChat({ user, comment: `${kw[Math.floor(Math.random() * kw.length)]} let's go!!` });
      if (Math.random() < 0.5) return;
    }
    const g = this._pickWeighted(this.gifts);
    const base = { user, giftId: g.id, groupId: String(Date.now()), giftDetails: { giftName: g.name, diamondCount: g.d, giftType: g.t, giftImage: { url: [] } } };
    if (g.t !== 1) { this.pipeline.handleGift({ ...base, repeatCount: 1, repeatEnd: false }); return; }
    // Fake a streak: rising repeatCount, then a final repeatEnd event.
    const len = 1 + Math.floor(Math.random() ** 2 * 25);
    let i = 0;
    const step = () => {
      i++;
      const end = i > len;
      this.pipeline.handleGift({ ...base, repeatCount: Math.min(i, len), repeatEnd: end });
      if (!end) { const t = setTimeout(() => { this.streakTimers.delete(t); step(); }, 120 + Math.random() * 180); this.streakTimers.add(t); }
    };
    step();
  }
}

/* ----------------------------------------------------------------------------
 * 11. Server settings (secrets) + admin authentication
 *     Stored in data/settings.json (file mode 600). This file is never shown in
 *     the file editor; you edit it from the panel's "Server" tab.
 * ------------------------------------------------------------------------- */
const SETTINGS_FILE = path.join(SETTINGS.dataDir, 'settings.json');
const INITIAL_PW_FILE = path.join(SETTINGS.dataDir, 'initial-admin-password.txt');
const BACKUP_DIR = path.join(SETTINGS.dataDir, 'backups');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function verifyPassword(pw, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = crypto.scryptSync(String(pw), rec.salt, 64);
  const want = Buffer.from(rec.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const serverSettings = (() => {
  const s = readJsonSafe(SETTINGS_FILE) || {};
  return {
    adminEmail: str(s.adminEmail, 200).trim().toLowerCase(),
    password: isObj(s.password) ? s.password : null,
    sessionSecret: typeof s.sessionSecret === 'string' && s.sessionSecret.length >= 32 ? s.sessionSecret : crypto.randomBytes(32).toString('hex'),
    signApiKey: str(s.signApiKey, 300),
    adminToken: str(s.adminToken, 200),
    tiktokUsername: str(s.tiktokUsername, 40),
    autoConnect: bool(s.autoConnect, false),
    mustChangePassword: bool(s.mustChangePassword, false),
  };
})();

function writeServerSettingsSync() {
  fs.mkdirSync(SETTINGS.dataDir, { recursive: true });
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(serverSettings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
}

// Environment variables fill in (or override) the stored settings at boot.
// Admin login email: from the stored settings, else ADMIN_EMAIL, else "admin".
if (!serverSettings.adminEmail) serverSettings.adminEmail = SETTINGS.envAdminEmail || 'admin';

// Re-hash only when the env password differs from the stored one. A fresh salt on every
// boot would change the session fingerprint and log everyone out at each restart.
if (SETTINGS.envAdminPassword && !verifyPassword(SETTINGS.envAdminPassword, serverSettings.password)) {
  serverSettings.password = hashPassword(SETTINGS.envAdminPassword);
  serverSettings.mustChangePassword = false;
}
let generatedPassword = null;
if (!serverSettings.password) {
  // First run: create a random password. It is printed to the log and saved to
  // data/initial-admin-password.txt until you change it in the panel.
  generatedPassword = crypto.randomBytes(12).toString('base64url');
  serverSettings.password = hashPassword(generatedPassword);
  serverSettings.mustChangePassword = true;
  fs.mkdirSync(SETTINGS.dataDir, { recursive: true });
  fs.writeFileSync(INITIAL_PW_FILE, `${generatedPassword}\n`, { mode: 0o600 });
}
if (!serverSettings.signApiKey && SETTINGS.envSignApiKey) serverSettings.signApiKey = SETTINGS.envSignApiKey;
if (!serverSettings.adminToken && SETTINGS.envAdminToken) serverSettings.adminToken = SETTINGS.envAdminToken;
if (SETTINGS.envUsername) { serverSettings.tiktokUsername = SETTINGS.envUsername; serverSettings.autoConnect = true; }
writeServerSettingsSync();

// ---- Sessions: signed, stateless cookies that survive restarts. Changing the
//      password invalidates every existing session.
const SESSION_COOKIE = 'sb_session';
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const sessionSig = (exp) => crypto.createHmac('sha256', serverSettings.sessionSecret)
  .update(`${exp}.${serverSettings.password ? serverSettings.password.hash.slice(0, 24) : ''}`).digest('base64url');
const makeSession = () => { const exp = Date.now() + SESSION_TTL; return `${exp}.${sessionSig(exp)}`; };
function checkSession(tok) {
  const m = /^(\d{10,16})\.([\w-]{20,})$/.exec(String(tok || ''));
  if (!m || Number(m[1]) < Date.now()) return false;
  return safeEqual(m[2], sessionSig(Number(m[1])));
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}
const isAuthed = (req) => checkSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
/** Real client IP. X-Forwarded-For is trusted only when the request came from the local reverse proxy. */
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const xff = req.headers['x-forwarded-for'];
  return isLoopback(remote) && xff ? String(xff).split(',')[0].trim() : remote;
}
const isHttps = (req) => Boolean(req.socket.encrypted) || (isLoopback(req.socket.remoteAddress || '') && req.headers['x-forwarded-proto'] === 'https');
/** Same-origin check: blocks other websites from using your logged-in browser (CSRF / WebSocket hijacking). */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}
function sessionCookie(req, value, maxAgeSec) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

// ---- Login rate limiting (per IP + global) to stop password guessing.
const LOGIN_WINDOW = 15 * 60 * 1000;
const loginFails = new Map();
let globalFails = { n: 0, reset: Date.now() + LOGIN_WINDOW };
function loginBlocked(ip) {
  const now = Date.now();
  if (globalFails.reset < now) globalFails = { n: 0, reset: now + LOGIN_WINDOW };
  const f = loginFails.get(ip);
  if (f && f.reset < now) loginFails.delete(ip);
  return (loginFails.get(ip)?.n || 0) >= 8 || globalFails.n >= 60;
}
function loginFailed(ip) {
  const f = loginFails.get(ip) || { n: 0, reset: Date.now() + LOGIN_WINDOW };
  f.n++; loginFails.set(ip, f); globalFails.n++;
  if (loginFails.size > 10000) loginFails.clear();
}

/* ----------------------------------------------------------------------------
 * 12. File editor backend (limited to the app folder)
 * ------------------------------------------------------------------------- */
const APP_ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.npm', '.cache', '.config', '.local']);
const SKIP_REL = new Set(['web/out', 'data/uploads', 'data/gift-images']); // build output + uploaded images (binary)
const skipRel = (rel) => [...SKIP_REL].some((d) => rel === d || rel.startsWith(d + '/'));
const MAX_EDIT_BYTES = 2 * 1024 * 1024;
const httpErr = (status, message, extra) => Object.assign(new Error(message), { status, extra });

/** Resolves a relative path inside APP_ROOT. Rejects escapes, symlink tricks and protected files. */
function resolveAppPath(rel) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || r.includes('\0')) throw httpErr(400, 'Invalid path');
  const abs = path.resolve(APP_ROOT, r);
  const inside = (p) => p === APP_ROOT || p.startsWith(APP_ROOT + path.sep);
  if (!inside(abs)) throw httpErr(403, 'المسار خارج مجلد التطبيق');
  // Follow symlinks on the existing part of the path
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== APP_ROOT) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (!inside(real) && real !== fs.realpathSync(APP_ROOT)) throw httpErr(403, 'المسار خارج مجلد التطبيق');
  const relNorm = path.relative(APP_ROOT, abs);
  if (relNorm.split(path.sep).some((seg) => SKIP_DIRS.has(seg)) || skipRel(relNorm.split(path.sep).join('/'))) throw httpErr(403, 'لا يمكن تعديل هذا المجلد');
  if (abs === SETTINGS_FILE || abs === INITIAL_PW_FILE || abs === BACKUP_DIR || abs.startsWith(BACKUP_DIR + path.sep)) {
    throw httpErr(403, 'ملف محمي. استخدم صفحة «الخادم» للمفاتيح وكلمة المرور.');
  }
  return { abs, rel: relNorm.split(path.sep).join('/') };
}

async function listAppFiles() {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 6 || out.length >= 1000) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (SKIP_DIRS.has(e.name) || skipRel(path.relative(APP_ROOT, abs).split(path.sep).join('/')) || abs === BACKUP_DIR || abs === SETTINGS_FILE || abs === INITIAL_PW_FILE || e.name.endsWith('.tmp')) continue;
      if (e.isDirectory()) await walk(abs, depth + 1);
      else if (e.isFile()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) out.push({ path: path.relative(APP_ROOT, abs).split(path.sep).join('/'), size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk(APP_ROOT, 0);
  return out;
}

/** Syntax check before saving: `node --check` for JS, JSON.parse for JSON. Returns an error string or null. */
function checkSyntax(rel, content) {
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.json') { try { JSON.parse(content); return null; } catch (e) { return `JSON error: ${e.message}`; } }
  // Only server-side JS is checked with node (web/ files are JSX, checked by the build).
  if (!['.js', '.cjs', '.mjs'].includes(ext) || rel.startsWith('web/')) return null;
  const tmp = path.join(os.tmpdir(), `sbcheck-${process.pid}-${Date.now()}${ext === '.js' ? '.cjs' : ext}`);
  try {
    fs.writeFileSync(tmp, content);
    const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8', timeout: 15000 });
    if (r.status === 0) return null;
    return String(r.stderr || r.error || 'Syntax check failed').split(tmp).join(rel).split(/\n\s+at /)[0].trim().slice(0, 2000);
  } finally { fs.rmSync(tmp, { force: true }); }
}

const backupName = (rel) => rel.replace(/[\/\\]/g, '__');
async function backupFile(abs, rel) {
  if (!fs.existsSync(abs)) return;
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const base = backupName(rel);
  await fsp.copyFile(abs, path.join(BACKUP_DIR, `${base}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`));
  // Keep the newest 20 backups per file
  const old = (await fsp.readdir(BACKUP_DIR)).filter((n) => n.startsWith(base + '.')).sort().reverse().slice(20);
  for (const n of old) await fsp.rm(path.join(BACKUP_DIR, n), { force: true });
}

/* ----------------------------------------------------------------------------
 * 12a. Uploaded images (team photos, backgrounds) in data/uploads
 *      Only PNG / JPEG / WebP / GIF, checked by their first bytes. The file
 *      name is a hash of the content, so URLs can be cached forever.
 * ------------------------------------------------------------------------- */
const UPLOAD_DIR = path.join(SETTINGS.dataDir, 'uploads');
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}
async function listUploads() {
  const names = await fsp.readdir(UPLOAD_DIR).catch(() => []);
  const out = [];
  for (const n of names) {
    if (!UPLOAD_RE.test(`/uploads/${n}`)) continue;
    const st = await fsp.stat(path.join(UPLOAD_DIR, n)).catch(() => null);
    if (st) out.push({ name: n, url: `/uploads/${n}`, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/* ----------------------------------------------------------------------------
 * 12b. Static site (Next.js export in web/out)
 * ------------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};
/** Finds the file for a URL path inside web/out (/admin -> admin/index.html). Returns null if none. */
async function findStatic(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes('\0')) return null;
  const base = path.join(SETTINGS.webOut, rel);
  if (base !== SETTINGS.webOut && !base.startsWith(SETTINGS.webOut + path.sep)) return null;
  for (const f of [base, path.join(base, 'index.html'), `${base}.html`]) {
    const st = await fsp.stat(f).catch(() => null);
    if (st && st.isFile()) return { file: f, size: st.size };
  }
  return null;
}

/* ----------------------------------------------------------------------------
 * 12c. Background jobs: build the web UI, update from GitHub
 *      One job at a time. Output goes to the log (Logs page) and job.output.
 * ------------------------------------------------------------------------- */
const jobs = { current: null, last: null };
const isGitRepo = () => fs.existsSync(path.join(APP_ROOT, '.git'));
// git refuses repos owned by another user unless trusted; trust our own app folder explicitly.
const GIT = ['-c', `safe.directory=${APP_ROOT}`];

/** Runs a command and resolves { code, out } (never rejects). */
function run(cmd, args, { timeout = 15 * 60 * 1000, onLine } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd: APP_ROOT, env: { ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' } });
    } catch (e) { return resolve({ code: -1, out: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeout);
    let buf = '';
    const onData = (d) => {
      const t = d.toString(); out += t; if (out.length > 200000) out = out.slice(-100000);
      buf += t; const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) if (l.trim() && onLine) onLine(l);
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: out + e.message }); });
    child.on('close', (code) => { clearTimeout(timer); if (buf.trim() && onLine) onLine(buf); resolve({ code, out }); });
  });
}

/** Starts a job made of steps [{ label, cmd, args }]. Throws 409 if one is running. */
function startJob(name, steps, onSuccess) {
  if (jobs.current) throw httpErr(409, `مهمة أخرى قيد التشغيل: ${jobs.current.name}`);
  const job = { name, startedAt: Date.now(), step: '', ok: null, error: null, output: [] };
  jobs.current = job;
  const push = (l) => { job.output.push(l); if (job.output.length > 400) job.output.shift(); };
  (async () => {
    log.info(`[${name}] started`);
    for (const st of steps) {
      job.step = st.label;
      push(`▶ ${st.label}`);
      log.info(`[${name}] ${st.label}: ${st.cmd} ${st.args.join(' ')}`);
      const r = await run(st.cmd, st.args, { onLine: (l) => { push(l); log.info(`[${name}] ${l.slice(0, 500)}`); } });
      if (r.code !== 0) { job.ok = false; job.error = `${st.label} فشل (رمز ${r.code})`; break; }
    }
    if (job.ok === null) job.ok = true;
    job.finishedAt = Date.now();
    jobs.last = job; jobs.current = null;
    log[job.ok ? 'info' : 'error'](`[${name}] ${job.ok ? 'finished OK' : job.error}`);
    if (job.ok && onSuccess) onSuccess();
  })();
  return job;
}

async function gitInfo(fetchRemote) {
  if (!isGitRepo()) return { git: false };
  const g = async (...a) => (await run('git', [...GIT, ...a], { timeout: 60000 })).out.trim();
  if (fetchRemote) {
    const f = await run('git', [...GIT, 'fetch', '--quiet', 'origin'], { timeout: 60000 });
    if (f.code !== 0) return { git: true, error: `تعذر الاتصال بـ GitHub: ${f.out.trim().slice(0, 300)}` };
  }
  const branch = await g('rev-parse', '--abbrev-ref', 'HEAD');
  const local = await g('rev-parse', '--short', 'HEAD');
  const remoteRef = `origin/${branch}`;
  const remote = await g('rev-parse', '--short', remoteRef);
  const behind = Number(await g('rev-list', '--count', `HEAD..${remoteRef}`)) || 0;
  const ahead = Number(await g('rev-list', '--count', `${remoteRef}..HEAD`)) || 0;
  const commits = (await g('log', '--pretty=format:%h|%s|%cr', '-n', '20', `HEAD..${remoteRef}`))
    .split('\n').filter(Boolean).map((l) => { const [hash, subject, when] = l.split('|'); return { hash, subject, when }; });
  const current = await g('log', '-1', '--pretty=format:%h|%s|%cr');
  // Not trimmed: porcelain lines start with a status column (" M file").
  const dirty = (await run('git', [...GIT, 'status', '--porcelain'], { timeout: 60000 })).out.split('\n').filter((l) => l.trim()).map((l) => l.slice(3));
  const url = await g('remote', 'get-url', 'origin');
  return { git: true, branch, local, remote, behind, ahead, commits, dirty, url, current: (() => { const [hash, subject, when] = current.split('|'); return { hash, subject, when }; })() };
}

/* ----------------------------------------------------------------------------
 * 13. Bootstrap state + persistence
 * ------------------------------------------------------------------------- */
let config = sanitizeConfig(readJsonSafe(CONFIG_FILE) || DEFAULT_CONFIG);
const board = new ScoreBoard(config);
board.restore(readJsonSafe(STATE_FILE));
const catalog = new GiftCatalog();
catalog.load();
const pipeline = new Pipeline(board, catalog);
const tiktok = new TikTokManager(pipeline, () => config);
const demo = new DemoSimulator(pipeline, board);

// Throttled (not debounced) save: a busy stream changes state constantly, and a debounce
// would keep postponing the write. This saves at most every 2s, including during traffic.
const writeState = () => writeJsonAtomic(STATE_FILE, board.serialize()).catch((e) => log.warn('State save failed:', e.message));
const saveState = throttle(writeState, () => 2000);
const saveConfig = () => writeJsonAtomic(CONFIG_FILE, config).catch((e) => log.warn('Config save failed:', e.message));

/** Validates, applies and sends a new config to every overlay (used by the panel and the file editor). */
async function applyNewConfig(raw, persist = true) {
  config = sanitizeConfig(raw);
  board.applyConfig(config);
  if (persist) await saveConfig();
  broadcast({ type: 'config', config });
  log.info(`Config applied (${config.teams.length} teams)`);
  return config;
}

/* ----------------------------------------------------------------------------
 * 14. HTTP server: overlay, admin page and REST API
 * ------------------------------------------------------------------------- */
const supervised = () => Boolean(process.env.INVOCATION_ID || process.env.pm_id || process.env.SUPERVISED);

function readJsonBody(req, limit = MAX_EDIT_BYTES + 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpErr(413, 'Request too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(isObj(v) ? v : {}); }
      catch { reject(httpErr(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...baseHeaders, ...extra }); res.end(body); };
  const json = (code, obj, extra) => send(code, 'application/json; charset=utf-8', JSON.stringify(obj), extra);

  try {
    // ---------- Public routes ----------
    if (req.method === 'GET' || req.method === 'HEAD') {
      // Old OBS URL (/?obs=1) keeps working: send it to the new overlay page.
      if (p === '/' && url.searchParams.get('obs') === '1') { res.writeHead(302, { Location: '/overlay/' }); return res.end(); }
      if (p === '/health') return json(200, { ok: true, version: VERSION, uptime: Math.round(process.uptime()), clients: wss.clients.size, tiktok: tiktok.status.state });
      if (p === '/api/state') return json(200, { config, state: board.snapshot(), status: publicStatus() });
      if (p.startsWith('/gift-img/')) {
        if (!GIFT_IMG_RE.test(p)) return send(404, 'text/plain', 'Not found');
        const file = path.join(GIFT_IMG_DIR, path.basename(p));
        const st = await fsp.stat(file).catch(() => null);
        if (!st) return send(404, 'text/plain', 'Not found');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size,
          'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
      }
      if (p.startsWith('/uploads/')) {
        if (!UPLOAD_RE.test(p)) return send(404, 'text/plain', 'Not found');
        const file = path.join(UPLOAD_DIR, path.basename(p));
        const st = await fsp.stat(file).catch(() => null);
        if (!st) return send(404, 'text/plain', 'Not found');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size,
          'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
      }
      if (p === '/api/me') return json(200, { authed: isAuthed(req), mustChangePassword: isAuthed(req) && serverSettings.mustChangePassword });
    }

    if (!p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain', 'Method not allowed');
      if (!fs.existsSync(SETTINGS.webOut)) {
        return send(503, 'text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#0b0b10;color:#eee;padding:40px" dir="rtl"><h2>الواجهة غير مبنية بعد</h2><p>شغّل <code>npm run build</code> ثم أعد تحميل الصفحة.</p>');
      }
      const hit = await findStatic(p === '/favicon.ico' ? '/favicon.png' : p);
      const target = hit || await findStatic('/404.html');
      const ext = path.extname(target.file).toLowerCase();
      const cache = p.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Length': target.size };
      if (p.startsWith('/admin')) headers['X-Frame-Options'] = 'DENY';
      res.writeHead(hit ? 200 : 404, headers);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(target.file).on('error', () => res.destroy()).pipe(res);
    }

    // Every write request must come from this site (CSRF protection).
    if (req.method !== 'GET' && !sameOrigin(req)) return json(403, { error: 'تم حظر طلب من موقع آخر' });

    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      if (loginBlocked(ip)) return json(429, { error: 'محاولات كثيرة. حاول بعد 15 دقيقة.' });
      const body = await readJsonBody(req, 4096);
      const emailOk = safeEqual(String(body.email || '').trim().toLowerCase(), serverSettings.adminEmail);
      const pwOk = verifyPassword(body.password || '', serverSettings.password); // always run (constant-ish timing)
      if (!emailOk || !pwOk) {
        loginFailed(ip);
        log.warn(`Failed admin login from ${ip}`);
        await new Promise((r) => setTimeout(r, 500));
        return json(401, { error: 'البريد أو كلمة المرور غير صحيحة' });
      }
      loginFails.delete(ip);
      log.info(`Admin ${serverSettings.adminEmail} logged in from ${ip}`);
      return json(200, { ok: true, mustChangePassword: serverSettings.mustChangePassword }, { 'Set-Cookie': sessionCookie(req, makeSession(), SESSION_TTL / 1000) });
    }
    if (p === '/api/logout' && req.method === 'POST') return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });

    // ---------- Everything below needs a logged-in admin ----------
    if (!isAuthed(req)) return json(401, { error: 'يجب تسجيل الدخول' });

    if (p === '/api/settings' && req.method === 'GET') {
      const k = serverSettings.signApiKey;
      return json(200, {
        adminEmail: serverSettings.adminEmail,
        tiktokUsername: serverSettings.tiktokUsername,
        autoConnect: serverSettings.autoConnect,
        signApiKeySet: Boolean(k),
        signApiKeyHint: k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '',
        adminTokenSet: Boolean(serverSettings.adminToken),
        mustChangePassword: serverSettings.mustChangePassword,
        server: {
          version: VERSION, node: process.version, uptime: Math.round(process.uptime()), pid: process.pid,
          supervised: supervised(), appRoot: APP_ROOT, dataDir: SETTINGS.dataDir, port: SETTINGS.port,
          memoryMb: Math.round(process.memoryUsage().rss / 1048576), clients: wss.clients.size, stats: pipeline.stats,
        },
      });
    }

    if (p === '/api/settings' && req.method === 'POST') {
      const b = await readJsonBody(req, 16384);
      let restartRequired = false;
      const headers = {};
      if (typeof b.tiktokUsername === 'string') serverSettings.tiktokUsername = b.tiktokUsername.trim().replace(/^@/, '').slice(0, 40);
      if (typeof b.autoConnect === 'boolean') serverSettings.autoConnect = b.autoConnect;
      if (typeof b.signApiKey === 'string' && b.signApiKey.trim()) { serverSettings.signApiKey = b.signApiKey.trim().slice(0, 300); restartRequired = true; }
      if (b.clearSignApiKey === true) { serverSettings.signApiKey = ''; restartRequired = true; }
      if (typeof b.adminToken === 'string' && b.adminToken.trim()) serverSettings.adminToken = b.adminToken.trim().slice(0, 200);
      if (b.clearAdminToken === true) serverSettings.adminToken = '';
      if (typeof b.adminEmail === 'string' && b.adminEmail.trim().toLowerCase() !== serverSettings.adminEmail) {
        if (!verifyPassword(b.currentPassword || '', serverSettings.password)) throw httpErr(400, 'أدخل كلمة المرور الحالية لتغيير البريد');
        const em = b.adminEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) && em !== 'admin') throw httpErr(400, 'بريد إلكتروني غير صالح');
        serverSettings.adminEmail = em.slice(0, 200);
        log.info(`Admin login email changed to ${serverSettings.adminEmail}`);
      }
      if (b.newPassword !== undefined) {
        if (!verifyPassword(b.currentPassword || '', serverSettings.password)) throw httpErr(400, 'كلمة المرور الحالية غير صحيحة');
        if (String(b.newPassword).length < 10) throw httpErr(400, 'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل');
        serverSettings.password = hashPassword(String(b.newPassword));
        serverSettings.mustChangePassword = false;
        fs.rmSync(INITIAL_PW_FILE, { force: true });
        // Old sessions are now invalid: give this browser a fresh cookie, and close other admin sockets.
        headers['Set-Cookie'] = sessionCookie(req, makeSession(), SESSION_TTL / 1000);
        for (const ws of wss.clients) if (ws.isAdmin) ws.close(4001, 'Password changed');
        log.info('Admin password changed');
      }
      writeServerSettingsSync();
      return json(200, { ok: true, restartRequired }, headers);
    }

    if (p === '/api/restart' && req.method === 'POST') {
      const sup = supervised();
      json(200, { ok: true, supervised: sup });
      log.warn('Restart requested from admin panel');
      setTimeout(() => shutdown('restart from panel'), 300);
      return;
    }

    if (p === '/api/logs' && req.method === 'GET') {
      const since = url.searchParams.get('boot') === BOOT_ID ? num(url.searchParams.get('since'), 0) : 0;
      return json(200, { lines: LOG_BUFFER.filter((l) => l.i > since), next: logSeq, boot: BOOT_ID });
    }

    if (p === '/api/jobs' && req.method === 'GET') return json(200, jobs);

    if (p === '/api/gifts' && req.method === 'GET') return json(200, { gifts: catalog.list() });

    if (p === '/api/gifts/refresh' && req.method === 'POST') {
      const b = await readJsonBody(req, 4096);
      const username = String(b.username || '').trim().replace(/^@/, '');
      let gifts = username ? null : await tiktok.fetchGifts().catch(() => null);
      if (!gifts) {
        const u = username || serverSettings.tiktokUsername;
        if (!/^[\w.]{2,40}$/.test(u || '')) throw httpErr(400, 'أدخل اسم حساب تيك توك يبث مباشرة الآن');
        const lib = await loadConnector();
        const opts = lib.kind === 'v2'
          ? { processInitialData: false, enableExtendedGiftInfo: true, ...(serverSettings.signApiKey ? { signApiKey: serverSettings.signApiKey } : {}) }
          : { processInitialData: false, enableExtendedGiftInfo: true };
        const c = new lib.Ctor(u, opts);
        c.on('error', () => {});
        try {
          const state = await withTimeout(Promise.resolve(c.connect()), 45000, 'انتهت المهلة');
          gifts = (state && state.availableGifts) || c.availableGifts || (c.fetchAvailableGifts ? await c.fetchAvailableGifts() : null);
        } catch (e) {
          const m = String(e && (e.message || e.info) || e);
          throw httpErr(502, /offline|not.*live|isn't online|UserOffline/i.test(m) || (e && e.constructor && e.constructor.name === 'UserOfflineError')
            ? `@${u} ليس في بث مباشر الآن. أدخل حساباً يبث حالياً (أي حساب) لجلب قائمة الهدايا.`
            : `تعذر جلب الهدايا: ${m.slice(0, 200)}`);
        } finally { try { c.removeAllListeners && c.removeAllListeners(); c.on && c.on('error', () => {}); await c.disconnect(); } catch { /* ignore */ } }
      }
      const n = catalog.ingest(gifts || []);
      log.info(`Gift list fetched: ${n} gifts`);
      return json(200, { ok: true, count: n, total: catalog.byId.size });
    }

    if (p === '/api/uploads' && req.method === 'GET') return json(200, { files: await listUploads() });

    if (p === '/api/upload' && req.method === 'POST') {
      const b = await readJsonBody(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096);
      const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
      if (!buf.length) throw httpErr(400, 'لا توجد صورة');
      if (buf.length > MAX_UPLOAD_BYTES) throw httpErr(413, 'الصورة كبيرة جداً (الحد 6 ميغابايت)');
      const type = imageType(buf);
      if (!type) throw httpErr(415, 'نوع غير مدعوم. استخدم PNG أو JPG أو WebP أو GIF');
      const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${type}`;
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      const file = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(file)) await fsp.writeFile(file, buf);
      log.info(`Image uploaded: ${name} (${Math.round(buf.length / 1024)} KB)`);
      return json(200, { ok: true, url: `/uploads/${name}`, size: buf.length });
    }

    if (p === '/api/upload' && req.method === 'DELETE') {
      const name = String(url.searchParams.get('name') || '');
      if (!UPLOAD_RE.test(`/uploads/${name}`)) throw httpErr(400, 'اسم غير صالح');
      await fsp.rm(path.join(UPLOAD_DIR, name), { force: true });
      return json(200, { ok: true });
    }

    if (p === '/api/build' && req.method === 'POST') {
      const job = startJob('build', [{ label: 'بناء الواجهة', cmd: 'npm', args: ['run', 'build'] }]);
      return json(202, { ok: true, job });
    }

    if (p === '/api/update/check' && req.method === 'GET') return json(200, await gitInfo(true));

    if (p === '/api/update/run' && req.method === 'POST') {
      const b = await readJsonBody(req, 4096);
      const info = await gitInfo(true);
      if (!info.git) throw httpErr(400, 'هذا التثبيت ليس مستودع git. أعد التثبيت عبر deploy/install.sh');
      if (info.error) throw httpErr(502, info.error);
      if (info.dirty.length && !b.stashLocal) throw httpErr(409, 'توجد تعديلات محلية على ملفات المستودع', { dirty: info.dirty });
      const steps = [];
      if (info.dirty.length) steps.push({ label: 'حفظ التعديلات المحلية (git stash)', cmd: 'git', args: [...GIT, 'stash', 'push', '--include-untracked', '-m', `panel-update ${new Date().toISOString()}`] });
      steps.push({ label: 'تنزيل التحديث', cmd: 'git', args: [...GIT, 'pull', '--ff-only', 'origin', info.branch] });
      steps.push({ label: 'تثبيت الحزم', cmd: 'npm', args: ['ci', '--no-audit', '--no-fund'] });
      steps.push({ label: 'بناء الواجهة', cmd: 'npm', args: ['run', 'build'] });
      const job = startJob('update', steps, () => setTimeout(() => shutdown('restart after update'), 500));
      return json(202, { ok: true, job });
    }

    if (p === '/api/files' && req.method === 'GET') return json(200, { files: await listAppFiles(), root: APP_ROOT });

    if (p === '/api/file' && req.method === 'GET') {
      const { abs, rel } = resolveAppPath(url.searchParams.get('path'));
      const st = await fsp.stat(abs).catch(() => null);
      if (!st || !st.isFile()) throw httpErr(404, 'الملف غير موجود');
      if (st.size > MAX_EDIT_BYTES) throw httpErr(413, 'الملف كبير جداً (الحد 2 ميغابايت)');
      const buf = await fsp.readFile(abs);
      if (buf.includes(0)) throw httpErr(415, 'ملف ثنائي ولا يمكن تحريره كنص');
      return json(200, { path: rel, content: buf.toString('utf8'), mtime: st.mtimeMs });
    }

    if (p === '/api/file' && (req.method === 'PUT' || req.method === 'POST')) {
      const b = await readJsonBody(req);
      const { abs, rel } = resolveAppPath(b.path);
      if (typeof b.content !== 'string') throw httpErr(400, 'المحتوى مفقود');
      if (Buffer.byteLength(b.content) > MAX_EDIT_BYTES) throw httpErr(413, 'الملف كبير جداً (الحد 2 ميغابايت)');
      // Warn if someone else changed the file since it was opened
      if (b.expectMtime && fs.existsSync(abs) && Math.abs(fs.statSync(abs).mtimeMs - b.expectMtime) > 1 && !b.force) {
        throw httpErr(409, 'تغيّر الملف على الخادم بعد فتحه. أعد تحميله أو احفظ للكتابة فوقه.', { conflict: true });
      }
      const problem = checkSyntax(rel, b.content);
      // server.js runs this panel, so it is never saved with a syntax error.
      if (problem && (rel === 'server/index.js' || !b.force)) throw httpErr(422, problem, { syntax: true, canForce: rel !== 'server/index.js' });
      await backupFile(abs, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, b.content);
      await fsp.rename(tmp, abs);
      log.info(`File saved from panel: ${rel}`);

      let note = '';
      let restartRequired = false;
      let buildRequired = false;
      if (abs === CONFIG_FILE) { await applyNewConfig(JSON.parse(b.content), false); note = 'تم تطبيق الإعدادات مباشرة.'; }
      else if (abs === STATE_FILE) { note = 'الخادم يكتب state.json باستمرار. أعد التشغيل لتحميل تعديلك.'; restartRequired = true; }
      else if (rel.startsWith('web/')) { buildRequired = true; note = 'اضغط «بناء الواجهة» لتطبيق التعديل على الموقع.'; }
      else if (/\.(c|m)?js$|package(-lock)?\.json$/.test(rel)) { restartRequired = true; note = 'أعد تشغيل الخادم لتطبيق هذا التعديل.'; }
      return json(200, { ok: true, path: rel, mtime: fs.statSync(abs).mtimeMs, note, restartRequired, buildRequired });
    }

    if (p === '/api/file' && req.method === 'DELETE') {
      const { abs, rel } = resolveAppPath(url.searchParams.get('path'));
      if (['server/index.js', 'package.json', 'package-lock.json'].includes(rel)) throw httpErr(403, 'لا يمكن حذف هذا الملف الأساسي');
      await backupFile(abs, rel);
      await fsp.rm(abs, { force: true });
      log.info(`File deleted from panel: ${rel}`);
      return json(200, { ok: true });
    }

    if (p === '/api/backups' && req.method === 'GET') {
      const { rel } = resolveAppPath(url.searchParams.get('path'));
      const base = backupName(rel) + '.';
      const names = fs.existsSync(BACKUP_DIR) ? (await fsp.readdir(BACKUP_DIR)).filter((n) => n.startsWith(base)).sort().reverse() : [];
      const name = url.searchParams.get('name');
      if (name) {
        if (!names.includes(name)) throw httpErr(404, 'النسخة الاحتياطية غير موجودة');
        return json(200, { content: await fsp.readFile(path.join(BACKUP_DIR, name), 'utf8') });
      }
      return json(200, { backups: names.map((n) => ({ name: n, label: n.slice(base.length, -4) })) });
    }

    return json(404, { error: 'مسار غير معروف' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log.error('HTTP error:', e.stack || e.message);
    if (!res.headersSent) json(status, { error: e.message || 'Internal error', ...(e.extra || {}) });
  }
});

/* ----------------------------------------------------------------------------
 * 15. WebSocket hub
 * ------------------------------------------------------------------------- */
const wss = new WebSocketServer({ server: httpServer, maxPayload: 512 * 1024, perMessageDeflate: false });
const MAX_BUFFERED = 1024 * 1024; // skip non-essential messages for clients that cannot keep up

/** Sends one message to every client. JSON is built once and reused. */
function broadcast(msg, { essential = true } = {}) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (!essential && ws.bufferedAmount > MAX_BUFFERED) continue;
    ws.send(data);
  }
}

const publicStatus = () => ({ ...tiktok.status, demo: demo.running });
const broadcastState = throttle(() => broadcast({ type: 'state', state: board.snapshot() }), () => config.advanced.broadcastIntervalMs);

board.on('change', () => { broadcastState(); saveState(); });
pipeline.on('event', (ev) => {
  // Events go out right away (lowest latency). The state update follows within broadcastIntervalMs.
  broadcastState.flush();
  broadcast({ type: 'event', event: { ...ev, ts: Date.now() } }, { essential: false });
});
tiktok.on('status', () => broadcast({ type: 'status', status: publicStatus() }));
catalog.on('change', () => broadcast({ type: 'catalog', gifts: catalog.list() }, { essential: false }));

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  // Admin = logged-in session cookie AND same origin (blocks cross-site WebSocket hijacking).
  ws.isAdmin = isAuthed(req) && sameOrigin(req);
  ws.msgBudget = { tokens: 30, ts: Date.now() };
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (e) => log.warn('WS client error:', e.message));

  ws.send(JSON.stringify({
    type: 'hello', version: VERSION, config, state: board.snapshot(), status: publicStatus(),
    gifts: catalog.list(), isAdmin: ws.isAdmin,
  }));

  ws.on('message', (buf) => {
    // Simple token bucket: about 20 messages/second per client.
    const b = ws.msgBudget; const now = Date.now();
    b.tokens = Math.min(30, b.tokens + ((now - b.ts) / 1000) * 20); b.ts = now;
    if (b.tokens < 1) return;
    b.tokens--;
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (!isObj(msg)) return;
    handleCommand(ws, msg).catch((e) => reply(ws, msg.reqId, false, e.message));
  });
});

function reply(ws, reqId, ok, error, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', reqId: reqId ?? null, ok, error: error || null, data: data ?? null }));
}

/** Handles control commands from the setup panel. */
async function handleCommand(ws, msg) {
  if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
  if (msg.type !== 'cmd') return;

  // Auth: logged-in admin socket, or the optional API token (for scripts / Stream Deck).
  const tokenOk = Boolean(serverSettings.adminToken) && typeof msg.token === 'string' && safeEqual(msg.token, serverSettings.adminToken);
  if (!ws.isAdmin && !tokenOk) return reply(ws, msg.reqId, false, 'يجب تسجيل الدخول من /admin');
  const p = isObj(msg.payload) ? msg.payload : {};

  switch (msg.action) {
    case 'connect': {
      await tiktok.start(p.username);
      // Remember the stream, so the server reconnects to it after a restart.
      serverSettings.tiktokUsername = tiktok.desired; serverSettings.autoConnect = true; writeServerSettingsSync();
      return reply(ws, msg.reqId, true);
    }
    case 'disconnect': {
      await tiktok.stop();
      serverSettings.autoConnect = false; writeServerSettingsSync();
      return reply(ws, msg.reqId, true);
    }
    case 'saveConfig': {
      const c = await applyNewConfig(p.config);
      return reply(ws, msg.reqId, true, null, { config: c });
    }
    case 'reset': {
      board.reset(p.keepAllegiance !== false);
      pipeline.streaks.clear();
      writeState();
      broadcast({ type: 'event', event: { kind: 'reset', ts: Date.now() } });
      log.info('Scores reset');
      return reply(ws, msg.reqId, true);
    }
    case 'adjust': {
      const delta = num(p.delta, 0);
      if (!board.teams.has(p.teamId) || !delta) throw new Error('فريق غير معروف أو قيمة صفر');
      const r = board.adjust(p.teamId, delta);
      if (r.takeover) pipeline.emit('event', { kind: 'takeover', teamId: board.leaderId, prevTeamId: r.prevLeader || null });
      return reply(ws, msg.reqId, true);
    }
    case 'simulateGift': {
      const nick = str(p.nickname || 'TestViewer', 48);
      const id = `sim_${slug(nick) || 'viewer'}`;
      const known = catalog.find(p.giftId, p.giftName);
      if (known && !p.giftId) p.giftId = known.id;
      pipeline.handleGift({
        user: { id, displayId: slug(nick) || 'test_viewer', nickname: nick },
        giftId: num(p.giftId, 999999),
        repeatCount: Math.max(1, Math.min(10000, Math.floor(num(p.count, 1)))),
        repeatEnd: false,
        groupId: String(Date.now()),
        giftDetails: { giftName: str(p.giftName || 'Rose', 48), diamondCount: Math.max(0, num(p.diamonds, 1)), giftType: 2 },
      }, { forceTeam: p.teamId || null });
      return reply(ws, msg.reqId, true);
    }
    case 'simulateChat': {
      const nick = str(p.nickname || 'TestViewer', 48);
      pipeline.handleChat({ user: { id: `sim_${slug(nick) || 'viewer'}`, displayId: slug(nick), nickname: nick }, comment: str(p.text, 300) });
      return reply(ws, msg.reqId, true);
    }
    case 'demo': {
      if (p.enabled) demo.start(); else demo.stop();
      broadcast({ type: 'status', status: publicStatus() });
      return reply(ws, msg.reqId, true);
    }
    case 'getState': {
      return reply(ws, msg.reqId, true, null, { config, state: board.snapshot(), status: publicStatus(), gifts: catalog.list() });
    }
    default:
      throw new Error(`Unknown action "${msg.action}"`);
  }
}

// Heartbeat: terminate clients that stop answering pings (OBS scene switches, sleeping laptops).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 15000);

/* ----------------------------------------------------------------------------
 * 16. Start + graceful shutdown
 * ------------------------------------------------------------------------- */
function onServerError(e) {
  if (e.code === 'EADDRINUSE') log.error(`Port ${SETTINGS.port} is already in use. Set PORT=xxxx or stop the other process.`);
  else log.error('Server error:', e.message);
  process.exit(1);
}
httpServer.on('error', onServerError);
wss.on('error', onServerError); // ws re-emits listen errors on the WebSocketServer

httpServer.listen(SETTINGS.port, SETTINGS.host, () => {
  const base = SETTINGS.publicUrl || `http://${SETTINGS.host === '0.0.0.0' ? 'localhost' : SETTINGS.host}:${SETTINGS.port}`;
  log.info(`Scoreboard v${VERSION} listening on ${SETTINGS.host}:${SETTINGS.port}`);
  log.info(`  Live page:       ${base}/`);
  log.info(`  Overlay (OBS):   ${base}/overlay`);
  log.info(`  Admin panel:     ${base}/admin`);
  if (generatedPassword) {
    log.warn('==================================================================');
    log.warn(`  FIRST RUN: admin login = ${serverSettings.adminEmail} / ${generatedPassword}`);
    log.warn(`  (also saved in ${INITIAL_PW_FILE}). Change it in the panel.`);
    log.warn('==================================================================');
  }
  if (serverSettings.autoConnect && serverSettings.tiktokUsername) {
    tiktok.start(serverSettings.tiktokUsername).catch((e) => log.error(e.message));
  }
  if (SETTINGS.demo) demo.start();
});

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${sig}: shutting down...`);
  clearInterval(heartbeat);
  demo.stop();
  const force = setTimeout(() => process.exit(0), 4000);
  try {
    await tiktok.stop();
    await writeJsonAtomic(STATE_FILE, board.serialize());
    for (const ws of wss.clients) ws.close(1012, 'Server restarting');
    wss.close();
    httpServer.close();
  } catch (e) { log.warn('Shutdown issue:', e.message); }
  clearTimeout(force);
  // Exit code 0: systemd (Restart=always) or PM2 starts the server again.
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Last-resort safety net: log, keep serving the overlay, let reconnect logic recover.
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e && e.stack || e));
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e && e.stack || e));
