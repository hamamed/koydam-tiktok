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
const { createTTS, fillTemplate, VOICES, VOICE_IDS, TTS_RE } = require('./tts');
const { Reports } = require('./reports');
const { GameManager } = require('./games');

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
    showGiftLegend: true,       // "🇲🇦 = 🌹" strip in the overlay header (only when giftStrip is off)
    giftStrip: true,            // bar in OBS with every team's flag + gift (also teams not on the board)
    // mode: 'scroll' (news ticker) | 'static'; pos: 'top' | 'bottom'; offset px from that edge; width %; align; speed px/s; dir: items move 'right' | 'left'
    strip: { mode: 'scroll', pos: 'top', offset: 14, width: 100, align: 'panel', speed: 60, dir: 'right', label: '' },
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
    logo: '',                   // this live's own logo (uploaded or https); '' = the default logo
    logoSize: 1,                // 0.4..2.5
    logoOnLive: true,           // show the logo on the public live page
    custom: { primary: '#f5b301', secondary: '#c8102e', bg: '#0b0a0f', tone: 'dark' }, // colours of the "custom" look
    parts: {},                  // { title:false, … } hide parts of the header card / team cards (PART_KEYS)
    sizes: {},                  // { title:1.3, … } size of each part, 0.5..2.5 (SIZE_KEYS)
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
    sceneOnOverlay: false,      // the look's own background in OBS (full scene, covers the stream behind)
    portraitOnly: true,         // this live streams vertically (TikTok): the panel shows the vertical overlay first
    zoom: 1,                    // overall size of everything (texts, boxes, pictures): 0.5..1.8
    // Vertical overlay (1080x1920, /overlay-vertical): TikTok's own buttons cover the top and the bottom.
    // layout: 'grid' (tiles in columns) | 'side' (narrow column, the middle stays free) | 'list' (wide cards)
    // header: 'compact' | 'full' | 'off'; alert pills: at most maxToasts, toastsAlign 'center' | 'right' | 'left'
    vertical: { top: 170, side: 28, scale: 1, maxVisible: 6, showHeader: true, showToasts: true, toastsTop: 1080, showTicker: false,
      layout: 'grid', columns: 2, sideWidth: 440, sideAlign: 'right', header: 'compact', maxToasts: 3, toastsAlign: 'center' },
    background: 'transparent',  // 'transparent' or a CSS color for previewing
  },

  // Timed rounds: countdown on screen, winner celebration, history.
  rounds: { durationMin: 15, autoReset: true, autoRestart: false, celebrateSec: 12, showTimer: true },

  // Game on the stream: 'race' (board to 1M) | 'cup' (Arab Cup knockout) | 'arena' (Country Arena, HP)
  game: {
    mode: 'race',
    cup: { matchSec: 90, goalPoints: 500, size: 8, breakSec: 8, shuffle: true },
    arena: { hp: 5000, healPct: 25, target: 'leader' },
  },

  // Followers & shares: points for the viewer's team, alerts, follow goal.
  social: {
    followPoints: 50, sharePoints: 10, shareMaxPerUser: 3,
    followAlerts: true, shareAlerts: true,
    followGoal: { enabled: true, target: 100, label: 'هدف المتابعين الجدد' },
  },

  // Arabic voice reading (server-made audio, played by the OBS overlay).
  tts: {
    enabled: false,
    engine: 'edge',             // 'edge' (neural voices, recommended) | 'browser' (only works outside OBS)
    voice: 'ar-SA-HamedNeural',
    rate: 0,                    // -50..60 (%)
    volume: 1,                  // 0..1 (overlay playback)
    minPoints: 100,             // read gifts worth at least this many points
    readGifts: true, readTakeover: true, readRoundWinner: true, readFollows: false,
    giftTemplate: 'شكراً {name} على {gift} لفريق {team}',
    takeoverTemplate: '{team} يتصدر الآن',
    roundTemplate: 'انتهت الجولة، الفائز {team} بـ {points} نقطة',
    followTemplate: 'شكراً {name} على المتابعة',
  },

  advanced: {
    broadcastIntervalMs: 50,    // min gap between state snapshots per WebSocket
    reconnectBaseMs: 2000,
    reconnectMaxMs: 60000,
    offlineRetryMs: 30000,      // retry interval while the streamer is not live
  },
};

/** Visual skins ("looks") for the live page and OBS overlay. Must match web/lib/skins.js. */
const SKIN_IDS = [
  'classic', 'neon', 'stadium', 'desert', 'ramadan', 'frost', 'inferno', 'emerald', 'royal', 'ocean', 'retro', 'midnight', 'sunset', 'aurora', 'cyber', 'galaxy', 'matrix', 'carbon', 'glacier', 'storm', 'bloodmoon', 'rosegold', 'sapphire', 'copper', 'pharaoh', 'andalus', 'majlis', 'eid', 'national', 'wedding', 'champions', 'derby', 'arena', 'forest', 'sakura', 'mint', 'paper', 'clean', 'mono', 'vapor', 'gameboy', 'comic', 'candy', 'holo', 'custom',
];

/** Parts of the header card / team cards that can be hidden or resized. Must match web/lib/format.js. */
const PART_KEYS = ['title', 'subtitle', 'category', 'points', 'goal', 'followGoal', 'rank', 'flag', 'crown', 'medal', 'name', 'share', 'bar', 'score', 'pts', 'gap'];
const SIZE_KEYS = ['title', 'subtitle', 'chips', 'goal', 'legend', 'score', 'share', 'contribs', 'rank', 'gifts', 'gap', 'strip'];

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
/** Bundled country flags (web/public/flags/<code>.svg). */
const FLAG_RE = /^\/flags\/[a-z]{2}(-[a-z0-9]{2,3})?\.svg$/;
function imgUrl(u) {
  const s = str(u, 1000).trim();
  return UPLOAD_RE.test(s) || FLAG_RE.test(s) ? s : safeUrl(s);
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
    rounds: {}, social: {}, tts: {},
    subtitle: str(src.subtitle ?? D.subtitle, 160),
    category: str(src.category ?? D.category, 40),
    teams: [],
    scoring: {}, alerts: {}, theme: {}, advanced: {},
  };

  // ---- Teams ----
  const rawTeams = Array.isArray(src.teams) && src.teams.length ? src.teams : D.teams;
  const usedIds = new Set();
  for (const t of rawTeams.slice(0, 30)) {
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
    giftStrip: bool(th.giftStrip, DT.giftStrip),
    strip: (() => {
      const x = isObj(th.strip) ? th.strip : {}; const D2 = DT.strip;
      return {
        mode: oneOf(x.mode, ['scroll', 'static'], D2.mode), pos: oneOf(x.pos, ['top', 'bottom'], D2.pos),
        offset: Math.round(numIn(x.offset, 0, 1600, D2.offset)), width: Math.round(numIn(x.width, 20, 100, D2.width)),
        // v2: old saved 'center' becomes 'panel' (aligned with the boxes) once
        align: oneOf(!x.v2 && (x.align === 'center' || !x.align) ? 'panel' : x.align, ['panel', 'center', 'right', 'left'], D2.align), v2: true, speed: Math.round(numIn(x.speed, 10, 300, D2.speed)),
        dir: oneOf(x.dir, ['right', 'left'], D2.dir), label: str(x.label, 40).trim(),
      };
    })(),
    layout: oneOf(th.layout, ['list', 'grid'], DT.layout),
    position: oneOf(th.position, ['left', 'center', 'right'], DT.position),
    width: numIn(th.width, 320, 1800, DT.width),
    maxVisible: Math.round(numIn(th.maxVisible, 1, 30, DT.maxVisible)),
    showContributors: bool(th.showContributors, DT.showContributors),
    contributorsCount: Math.round(numIn(th.contributorsCount, 1, 5, DT.contributorsCount)),
    showTicker: bool(th.showTicker, DT.showTicker),
    showHeader: bool(th.showHeader, DT.showHeader),
    showLogo: bool(th.showLogo, DT.showLogo),
    logo: imgUrl(th.logo),
    logoSize: numIn(th.logoSize, 0.4, 2.5, DT.logoSize),
    logoOnLive: bool(th.logoOnLive, DT.logoOnLive),
    parts: Object.fromEntries(PART_KEYS.map((k) => [k, !(isObj(th.parts) && th.parts[k] === false)])),
    sizes: Object.fromEntries(SIZE_KEYS.map((k) => [k, Math.round(numIn(isObj(th.sizes) ? th.sizes[k] : 1, 0.5, 2.5, 1) * 100) / 100])),
    custom: (() => {
      const c = isObj(th.custom) ? th.custom : {}; const DC = DT.custom;
      return { primary: color(c.primary, DC.primary), secondary: color(c.secondary, DC.secondary), bg: color(c.bg, DC.bg), tone: oneOf(c.tone, ['dark', 'light'], DC.tone) };
    })(),
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
    sceneOnOverlay: bool(th.sceneOnOverlay, DT.sceneOnOverlay),
    portraitOnly: bool(th.portraitOnly, DT.portraitOnly),
    zoom: Math.round(numIn(th.zoom, 0.5, 1.8, DT.zoom) * 100) / 100,
    vertical: (() => {
      const v = isObj(th.vertical) ? th.vertical : {}; const DV = DT.vertical;
      return {
        top: Math.round(numIn(v.top, 0, 1400, DV.top)), side: Math.round(numIn(v.side, 0, 300, DV.side)),
        scale: numIn(v.scale, 0.5, 2, DV.scale), maxVisible: Math.round(numIn(v.maxVisible, 1, 30, DV.maxVisible)),
        showHeader: bool(v.showHeader, DV.showHeader), showToasts: bool(v.showToasts, DV.showToasts),
        toastsTop: Math.round(numIn(v.toastsTop, 0, 1800, DV.toastsTop)), showTicker: bool(v.showTicker, DV.showTicker),
        layout: oneOf(v.layout, ['grid', 'side', 'list'], DV.layout), columns: Math.round(numIn(v.columns, 1, 3, DV.columns)),
        sideWidth: Math.round(numIn(v.sideWidth, 300, 1000, DV.sideWidth)), sideAlign: oneOf(v.sideAlign, ['right', 'left'], DV.sideAlign),
        header: oneOf(v.header, ['compact', 'full', 'off'], DV.header), maxToasts: Math.round(numIn(v.maxToasts, 1, 8, DV.maxToasts)),
        toastsAlign: oneOf(v.toastsAlign, ['center', 'right', 'left'], DV.toastsAlign),
      };
    })(),
    showViewers: bool(th.showViewers, DT.showViewers),
    toastPosition: oneOf(th.toastPosition, ['left', 'right'], DT.toastPosition),
    // Only "transparent" or simple CSS colour tokens: no url(), no expressions.
    background: /^(transparent|#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(bg) ? bg : DT.background,
  };

  // ---- Game ----
  {
    const gm = isObj(src.game) ? src.game : {}; const DG = D.game;
    const c = isObj(gm.cup) ? gm.cup : {}; const a = isObj(gm.arena) ? gm.arena : {};
    out.game = {
      mode: oneOf(gm.mode, ['race', 'cup', 'arena'], DG.mode),
      cup: {
        matchSec: Math.round(numIn(c.matchSec, 20, 1800, DG.cup.matchSec)), goalPoints: Math.round(numIn(c.goalPoints, 1, 1e7, DG.cup.goalPoints)),
        size: oneOf(Number(c.size), [2, 4, 8, 16, 32], DG.cup.size), breakSec: Math.round(numIn(c.breakSec, 2, 120, DG.cup.breakSec)), shuffle: bool(c.shuffle, DG.cup.shuffle),
      },
      arena: { hp: Math.round(numIn(a.hp, 10, 1e8, DG.arena.hp)), healPct: Math.round(numIn(a.healPct, 0, 100, DG.arena.healPct)), target: oneOf(a.target, ['leader', 'random'], DG.arena.target) },
    };
  }

  // ---- Goal ----
  const g = isObj(src.goal) ? src.goal : {};
  out.goal = {
    enabled: bool(g.enabled, D.goal.enabled),
    target: Math.round(numIn(g.target, 1, 1e12, D.goal.target)),
    label: str(g.label ?? D.goal.label, 80),
  };

  // ---- Rounds ----
  const rd = isObj(src.rounds) ? src.rounds : {}; const DR = D.rounds;
  out.rounds = {
    durationMin: numIn(rd.durationMin, 1, 600, DR.durationMin),
    autoReset: bool(rd.autoReset, DR.autoReset),
    autoRestart: bool(rd.autoRestart, DR.autoRestart),
    celebrateSec: Math.round(numIn(rd.celebrateSec, 3, 120, DR.celebrateSec)),
    showTimer: bool(rd.showTimer, DR.showTimer),
  };
  // ---- Social ----
  const so = isObj(src.social) ? src.social : {}; const DSo = D.social; const fg = isObj(so.followGoal) ? so.followGoal : {};
  out.social = {
    followPoints: numIn(so.followPoints, 0, 1e6, DSo.followPoints),
    sharePoints: numIn(so.sharePoints, 0, 1e6, DSo.sharePoints),
    shareMaxPerUser: Math.round(numIn(so.shareMaxPerUser, 0, 100, DSo.shareMaxPerUser)),
    followAlerts: bool(so.followAlerts, DSo.followAlerts),
    shareAlerts: bool(so.shareAlerts, DSo.shareAlerts),
    followGoal: { enabled: bool(fg.enabled, DSo.followGoal.enabled), target: Math.round(numIn(fg.target, 1, 1e7, DSo.followGoal.target)), label: str(fg.label ?? DSo.followGoal.label, 60) },
  };
  // ---- Voice ----
  const tt = isObj(src.tts) ? src.tts : {}; const DTt = D.tts;
  const tpl = (v, d) => str(v ?? d, 200);
  out.tts = {
    enabled: bool(tt.enabled, DTt.enabled),
    engine: oneOf(tt.engine, ['edge', 'browser'], DTt.engine),
    voice: VOICE_IDS.includes(tt.voice) ? tt.voice : DTt.voice,
    rate: Math.round(numIn(tt.rate, -50, 60, DTt.rate)),
    volume: numIn(tt.volume, 0, 1, DTt.volume),
    minPoints: numIn(tt.minPoints, 0, 1e9, DTt.minPoints),
    readGifts: bool(tt.readGifts, DTt.readGifts), readTakeover: bool(tt.readTakeover, DTt.readTakeover),
    readRoundWinner: bool(tt.readRoundWinner, DTt.readRoundWinner), readFollows: bool(tt.readFollows, DTt.readFollows),
    giftTemplate: tpl(tt.giftTemplate, DTt.giftTemplate), takeoverTemplate: tpl(tt.takeoverTemplate, DTt.takeoverTemplate),
    roundTemplate: tpl(tt.roundTemplate, DTt.roundTemplate), followTemplate: tpl(tt.followTemplate, DTt.followTemplate),
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
    // Followers & shares (kept across rounds; reset from the panel)
    this.social = { follows: 0, shares: 0 };
    this.followed = new Set();    // users already rewarded for following (once each)
    this.shareCount = new Map();  // userId -> rewarded shares
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

  resetSocial() {
    this.social = { follows: 0, shares: 0 };
    this.followed.clear(); this.shareCount.clear();
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
    return { rev: this.rev, total: Math.round(total * 100) / 100, leaderId: this.leaderId, teams, social: { ...this.social }, ts: Date.now() };
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
    return { version: 1, savedAt: new Date().toISOString(), leaderId: this.leaderId, teams, allegiance: [...this.allegiance],
      social: { ...this.social, followed: [...this.followed].slice(-50000), shareCount: [...this.shareCount].slice(-50000) } };
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
    if (isObj(data.social)) {
      this.social = { follows: num(data.social.follows, 0), shares: num(data.social.shares, 0) };
      if (Array.isArray(data.social.followed)) this.followed = new Set(data.social.followed.map(String));
      if (Array.isArray(data.social.shareCount)) this.shareCount = new Map(data.social.shareCount.filter((x) => Array.isArray(x)));
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

  /** New follower: counted once per viewer; points go to the viewer's team. */
  handleFollow(raw) {
    const user = normalizeUser(raw);
    if (this.board.followed.has(user.userId)) return;
    this.board.followed.add(user.userId);
    this.board.social.follows++;
    const s = this.board.config.social;
    const teamId = this.board.allegiance.get(user.userId) || null;
    let points = 0;
    if (teamId && s.followPoints > 0) {
      points = s.followPoints;
      const r = this.board.addPoints(teamId, points, user);
      if (r.takeover) this.emit('event', { kind: 'takeover', teamId, prevTeamId: r.prevLeader || null });
    } else this.board._changed();
    this.emit('event', { kind: 'follow', user, teamId, points });
  }

  /** Share: always counted; points for the first N shares of each viewer (stops share spam). */
  handleShare(raw) {
    const user = normalizeUser(raw);
    this.board.social.shares++;
    const s = this.board.config.social;
    const n = (this.board.shareCount.get(user.userId) || 0) + 1;
    this.board.shareCount.set(user.userId, n);
    if (this.board.shareCount.size > 50000) this.board.shareCount.delete(this.board.shareCount.keys().next().value);
    const teamId = this.board.allegiance.get(user.userId) || null;
    let points = 0;
    if (teamId && s.sharePoints > 0 && n <= s.shareMaxPerUser) {
      points = s.sharePoints;
      const r = this.board.addPoints(teamId, points, user);
      if (r.takeover) this.emit('event', { kind: 'takeover', teamId, prevTeamId: r.prevLeader || null });
    } else this.board._changed();
    this.emit('event', { kind: 'share', user, teamId, points });
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
    if (lib.kind === 'v2') {
      conn.on('follow', guard('follow', (d) => this.pipeline.handleFollow(d)));
      conn.on('share', guard('share', (d) => this.pipeline.handleShare(d)));
    } else {
      conn.on('social', guard('social', (d) => {
        const t = String(d.displayType || '');
        if (/follow/i.test(t)) this.pipeline.handleFollow(d); else if (/share/i.test(t)) this.pipeline.handleShare(d);
      }));
    }
    conn.on('roomUser', guard('roomUser', (d) => {
      const v = num(d.viewerCount ?? d.total ?? d.totalUser, NaN);
      if (Number.isFinite(v) && v !== this.status.viewers) { this._setStatus({ viewers: v }); this.emit('viewers', v); }
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
    const r = Math.random();
    if (r < 0.05) { // a "new" follower (unique id so it counts), on the same team as this demo viewer
      const id = `${user.id}${Date.now() % 100000}`;
      const team = this.board.allegiance.get(user.id);
      if (team) this.board.allegiance.set(id, team);
      this.pipeline.handleFollow({ user: { ...user, id } });
      return;
    }
    if (r < 0.08) { this.pipeline.handleShare({ user }); return; }
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

// Server-wide settings (owner only): sign key, API token, session secret.
// Older versions also kept the admin login + TikTok account here; those are migrated below.
const legacySettings = readJsonSafe(SETTINGS_FILE) || {};
const serverSettings = {
  sessionSecret: typeof legacySettings.sessionSecret === 'string' && legacySettings.sessionSecret.length >= 32 ? legacySettings.sessionSecret : crypto.randomBytes(32).toString('hex'),
  signApiKey: str(legacySettings.signApiKey, 300),
  adminToken: str(legacySettings.adminToken, 200),
};
if (!serverSettings.signApiKey && SETTINGS.envSignApiKey) serverSettings.signApiKey = SETTINGS.envSignApiKey;
if (!serverSettings.adminToken && SETTINGS.envAdminToken) serverSettings.adminToken = SETTINGS.envAdminToken;

function writeServerSettingsSync() {
  fs.mkdirSync(SETTINGS.dataDir, { recursive: true });
  const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(serverSettings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
}

/* ---- Users: the owner (you) + users you add. data/users.json (mode 600). ----
 * role 'owner': everything (server, files, updates, users, all lives)
 * role 'user' : only their own lives (up to maxLives)
 */
const USERS_FILE = path.join(SETTINGS.dataDir, 'users.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const users = {
  list: [],
  load() { const a = readJsonSafe(USERS_FILE); this.list = Array.isArray(a) ? a.filter((u) => isObj(u) && u.id && u.email) : []; },
  save() {
    fs.mkdirSync(SETTINGS.dataDir, { recursive: true });
    const tmp = `${USERS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.list, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, USERS_FILE);
  },
  byId(id) { return this.list.find((u) => u.id === id) || null; },
  byEmail(email) { const e = String(email || '').trim().toLowerCase(); return this.list.find((u) => u.email === e) || null; },
  owners() { return this.list.filter((u) => u.role === 'owner' && !u.disabled); },
  create({ email, name, password, role = 'user', maxLives = 1, mustChangePassword = true }) {
    const em = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(em) && em !== 'admin') throw httpErr(400, 'بريد إلكتروني غير صالح');
    if (this.byEmail(em)) throw httpErr(409, 'يوجد مستخدم بهذا البريد');
    const u = {
      id: crypto.randomBytes(6).toString('hex'), email: em, name: str(name || em.split('@')[0], 60).trim(), role: role === 'owner' ? 'owner' : 'user',
      password: hashPassword(password), mustChangePassword: Boolean(mustChangePassword),
      maxLives: Math.round(numIn(maxLives, 0, 100, 1)), disabled: false, createdAt: Date.now(), lastLoginAt: 0,
    };
    this.list.push(u); this.save();
    return u;
  },
};
const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name, role: u.role, maxLives: u.role === 'owner' ? null : u.maxLives, disabled: Boolean(u.disabled), mustChangePassword: Boolean(u.mustChangePassword), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || 0 } : null);
const isOwner = (u) => Boolean(u && u.role === 'owner');

users.load();
let generatedPassword = null;
if (!users.list.length) {
  // First start of v3 (or a fresh install): create the owner from the old single-admin login, or a new one.
  let password = null; let mustChange = true;
  const owner = {
    id: crypto.randomBytes(6).toString('hex'),
    email: str(legacySettings.adminEmail, 200).trim().toLowerCase() || SETTINGS.envAdminEmail || 'admin',
    name: 'المدير', role: 'owner', maxLives: 100, disabled: false, createdAt: Date.now(), lastLoginAt: 0,
  };
  if (isObj(legacySettings.password)) { owner.password = legacySettings.password; mustChange = bool(legacySettings.mustChangePassword, false); }
  else { password = generatedPassword = crypto.randomBytes(12).toString('base64url'); owner.password = hashPassword(password); }
  owner.mustChangePassword = mustChange;
  users.list.push(owner);
  users.save();
  if (generatedPassword) { fs.mkdirSync(SETTINGS.dataDir, { recursive: true }); fs.writeFileSync(INITIAL_PW_FILE, `${generatedPassword}\n`, { mode: 0o600 }); }
}
// ADMIN_PASSWORD (env) sets the first owner's password; re-hash only when it changed (keeps sessions valid).
{
  const owner = users.owners()[0];
  if (owner && SETTINGS.envAdminPassword && !verifyPassword(SETTINGS.envAdminPassword, owner.password)) {
    owner.password = hashPassword(SETTINGS.envAdminPassword); owner.mustChangePassword = false; users.save();
  }
  if (owner && SETTINGS.envAdminEmail && owner.email === 'admin') { owner.email = SETTINGS.envAdminEmail; users.save(); }
}
writeServerSettingsSync();

// ---- Sessions: signed, stateless cookies that survive restarts: "<userId>.<expiry>.<signature>".
//      Changing a user's password invalidates that user's sessions.
const SESSION_COOKIE = 'sb_session';
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const sessionSig = (u, exp) => crypto.createHmac('sha256', serverSettings.sessionSecret)
  .update(`${u.id}.${exp}.${u.password ? u.password.hash.slice(0, 24) : ''}`).digest('base64url');
const makeSession = (u) => { const exp = Date.now() + SESSION_TTL; return `${u.id}.${exp}.${sessionSig(u, exp)}`; };
function checkSession(tok) {
  const m = /^([a-f0-9]{6,24})\.(\d{10,16})\.([\w-]{20,})$/.exec(String(tok || ''));
  if (!m || Number(m[2]) < Date.now()) return null;
  const u = users.byId(m[1]);
  if (!u || u.disabled) return null;
  return safeEqual(m[3], sessionSig(u, Number(m[2]))) ? u : null;
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}
/** The logged-in user for this request (or null). */
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
const SKIP_REL = new Set(['web/out', 'data/uploads', 'data/gift-images', 'data/tts-cache']); // build output + uploaded images (binary)
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

/* ----------------------------------------------------------------------------
 * 12d. Promo videos (tools/promo-video.js): a scripted race to 1,000,000 recorded
 *      from the live's own overlay. One render at a time on the server; files in
 *      data/lives/<slug>/videos/ (the last 6 per live are kept).
 * ------------------------------------------------------------------------- */
const PROMO_TOOL = path.join(APP_ROOT, 'tools', 'promo-video.js');
const PROMO_KEEP = 6;
const promo = { current: null, last: new Map() }; // last result per live slug
let promoToolsCache = { at: 0, value: null };
const promoEnv = () => {
  const env = { ...process.env };
  const local = path.join(APP_ROOT, '.browsers');
  if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(local)) env.PLAYWRIGHT_BROWSERS_PATH = local;
  return env;
};
async function promoTools(fresh) {
  if (!fresh && promoToolsCache.value && Date.now() - promoToolsCache.at < 60000) return promoToolsCache.value;
  const value = await new Promise((resolve) => {
    let out = '';
    const ch = spawn(process.execPath, [PROMO_TOOL, '--check'], { cwd: APP_ROOT, env: promoEnv() });
    ch.stdout.on('data', (d) => { out += d; });
    ch.on('error', () => resolve({ playwright: false, chromium: false, ffmpeg: false }));
    ch.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve({ playwright: false, chromium: false, ffmpeg: false }); } });
  });
  value.ready = Boolean(value.playwright && value.chromium && value.ffmpeg);
  promoToolsCache = { at: Date.now(), value };
  return value;
}
const VIDEO_ID_RE = /^[a-z0-9-]{6,60}$/;
const videoDir = (l) => path.join(l.dir, 'videos');
async function listVideos(l) {
  const dir = videoDir(l);
  const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json'));
  const out = [];
  for (const n of names) {
    const meta = readJsonSafe(path.join(dir, n));
    const st = await fsp.stat(path.join(dir, n.replace(/\.json$/, '.mp4'))).catch(() => null);
    if (meta && st) out.push({ ...meta, size: st.size });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
function startPromo(l, opt, user) {
  if (promo.current) throw httpErr(409, promo.current.slug === l.slug ? 'يتم صنع فيديو الآن' : 'يتم صنع فيديو لبث آخر الآن، انتظر قليلاً');
  const teamIds = l.config.teams.map((t) => t.id);
  if (teamIds.length < 2) throw httpErr(400, 'يحتاج البث إلى فريقين على الأقل');
  const winner = teamIds.includes(opt.winner) ? opt.winner : teamIds[0];
  const rival = teamIds.includes(opt.rival) && opt.rival !== winner ? opt.rival : teamIds.find((t) => t !== winner);
  const landscape = opt.orientation === 'landscape';
  const teaser = opt.kind === 'teaser';
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = videoDir(l); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.mp4`);
  const job = { slug: l.slug, id, pct: 0, text: 'بدء', startedAt: Date.now(), ok: null, error: null };
  promo.current = job;
  const argsList = [PROMO_TOOL, `--config=${l.files.config}`, `--data=${SETTINGS.dataDir}`, `--winner=${winner}`, `--rival=${rival}`, `--out=${file}`];
  if (landscape) argsList.push('--landscape');
  if (teaser) argsList.push('--mode=teaser', `--when=${opt.when || ''}`, `--headline=${opt.headline || ''}`, `--handle=${opt.handle || ''}`, `--cta=${opt.cta || ''}`);
  log.info(`[${l.slug}] Promo video ${id} started (${landscape ? 'landscape' : 'vertical'}, winner ${winner})`);
  (async () => {
    let done = null; let lastErr = '';
    const r = await new Promise((resolve) => {
      const ch = spawn(process.execPath, argsList, { cwd: APP_ROOT, env: promoEnv() });
      let buf = '';
      const onData = (d) => {
        buf += d.toString(); const lines = buf.split(/\r?\n/); buf = lines.pop();
        for (const line of lines) {
          const m = /^PROGRESS (\d+) (.*)$/.exec(line);
          if (m) { job.pct = Number(m[1]); job.text = m[2]; continue; }
          if (line.startsWith('DONE ')) { try { done = JSON.parse(line.slice(5)); } catch { /* ignore */ } continue; }
          if (line.startsWith('ERROR ')) lastErr = line.slice(6);
          else if (line.trim()) lastErr = lastErr || line.trim().slice(0, 300);
        }
      };
      ch.stdout.on('data', onData); ch.stderr.on('data', onData);
      const timer = setTimeout(() => ch.kill('SIGKILL'), 6 * 60 * 1000);
      ch.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, err: e.message }); });
      ch.on('close', (code) => { clearTimeout(timer); resolve({ code }); });
    });
    if (r.code === 0 && done && fs.existsSync(file)) {
      const teams = new Map(l.config.teams.map((t) => [t.id, t.name]));
      const meta = { id, kind: teaser ? 'teaser' : 'race', when: teaser ? opt.when || '' : '', createdAt: Date.now(), orientation: landscape ? 'landscape' : 'vertical', width: done.width, height: done.height,
        seconds: done.seconds, total: done.total, winner, winnerName: teams.get(winner) || winner, rivalName: teams.get(rival) || rival, by: user.email };
      await writeJsonAtomic(path.join(dir, `${id}.json`), meta);
      job.ok = true; job.pct = 100; job.text = 'تم';
      // keep the newest PROMO_KEEP videos
      const all = await listVideos(l);
      for (const v of all.slice(PROMO_KEEP)) { await fsp.rm(path.join(dir, `${v.id}.mp4`), { force: true }); await fsp.rm(path.join(dir, `${v.id}.json`), { force: true }); }
      log.info(`[${l.slug}] Promo video ${id} ready`);
    } else {
      job.ok = false; job.error = lastErr || r.err || `فشل صنع الفيديو (رمز ${r.code})`;
      await fsp.rm(file, { force: true });
      log.error(`[${l.slug}] Promo video failed: ${job.error}`);
    }
    job.finishedAt = Date.now();
    promo.last.set(l.slug, job); promo.current = null;
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
 * 12d. Timed rounds
 *      start -> countdown -> end: winner + top supporters (event 'roundEnd'),
 *      saved to data/rounds.json; then optional auto-reset and auto-restart.
 *      The running round is saved, so a server restart continues the countdown.
 * ------------------------------------------------------------------------- */

class RoundManager extends EventEmitter {
  constructor(board, getConfig, files) {
    super();
    this.board = board; this.getConfig = getConfig; this.files = files; // { round, history }
    const saved = readJsonSafe(files.round) || {};
    this.state = { status: 'idle', number: num(saved.number, 0), startedAt: 0, endsAt: 0, durationSec: 0, celebrateUntil: 0 };
    const h = readJsonSafe(files.history);
    this.history = Array.isArray(h) ? h : [];
    this.timers = new Set();
    this.tick = setInterval(() => this._check(), 500);
    this.tick.unref();
    if (saved.status === 'running' && num(saved.endsAt, 0) > Date.now()) {
      Object.assign(this.state, { status: 'running', startedAt: num(saved.startedAt, Date.now()), endsAt: num(saved.endsAt, 0), durationSec: num(saved.durationSec, 0) });
      log.info(`Round ${this.state.number} resumed (${Math.round((this.state.endsAt - Date.now()) / 1000)}s left)`);
    } else if (saved.status === 'running') {
      // Ended while the server was down: record it without the celebration.
      Object.assign(this.state, { status: 'running', startedAt: num(saved.startedAt, 0), endsAt: num(saved.endsAt, 0), durationSec: num(saved.durationSec, 0) });
      setTimeout(() => this.end('ended while offline', { quiet: true }), 2000);
    }
  }
  public() { return { ...this.state, serverNow: Date.now() }; }
  _save() { writeJsonAtomic(this.files.round, this.state).catch(() => {}); }
  _changed() { this._save(); this.emit('change', this.public()); }
  _later(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); }
  _clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
  destroy() { this._clearTimers(); clearInterval(this.tick); }

  start(durationMin) {
    this._clearTimers();
    const min = clamp(num(durationMin, this.getConfig().rounds.durationMin), 0.1, 600);
    const now = Date.now();
    this.state = { status: 'running', number: this.state.number + 1, startedAt: now, durationSec: Math.round(min * 60), endsAt: now + Math.round(min * 60000), celebrateUntil: 0 };
    log.info(`Round ${this.state.number} started (${min} min)`);
    this.emit('event', { kind: 'roundStart', number: this.state.number, durationSec: this.state.durationSec });
    this._changed();
  }
  extend(sec) {
    if (this.state.status !== 'running') throw new Error('لا توجد جولة جارية');
    this.state.endsAt = Math.max(Date.now() + 5000, this.state.endsAt + num(sec, 60) * 1000);
    this.state.durationSec += num(sec, 60);
    this._changed();
  }
  cancel() {
    this._clearTimers();
    if (this.state.status === 'idle') return;
    this.state = { ...this.state, status: 'idle', endsAt: 0, celebrateUntil: 0 };
    log.info('Round cancelled');
    this._changed();
  }
  _check() { if (this.state.status === 'running' && Date.now() >= this.state.endsAt) this.end('time'); }

  /** Ends the round now: result, history, celebration, then optional reset/restart. */
  end(reason = 'manual', { quiet = false } = {}) {
    if (this.state.status !== 'running') throw new Error('لا توجد جولة جارية');
    const cfg = this.getConfig();
    const snap = this.board.snapshot();
    const teamsById = new Map(cfg.teams.map((t) => [t.id, t]));
    const ranked = this.board.ranked();
    const w = ranked[0] && ranked[0].score > 0 ? teamsById.get(ranked[0].id) : null;
    const supporters = snap.teams.flatMap((t) => (t.top || []).map((u) => ({ ...u, team: t.id }))).sort((a, b) => b.p - a.p).slice(0, 3);
    const result = {
      number: this.state.number, startedAt: this.state.startedAt, endedAt: Date.now(), reason,
      durationSec: Math.round((Date.now() - this.state.startedAt) / 1000),
      total: snap.total,
      winner: w ? { id: w.id, name: w.name, emoji: w.emoji, color: w.color, image: w.image, score: ranked[0].score } : null,
      standings: ranked.map((r) => ({ id: r.id, name: teamsById.get(r.id)?.name || r.id, score: r.score })),
      topSupporters: supporters,
    };
    this.history.unshift(result);
    if (this.history.length > 500) this.history.length = 500;
    writeJsonAtomic(this.files.history, this.history).catch(() => {});
    log.info(`Round ${result.number} ended (${reason}): winner ${w ? w.name : 'none'}`);

    const celebrate = quiet ? 0 : cfg.rounds.celebrateSec * 1000;
    this.state = { ...this.state, status: celebrate ? 'celebrating' : 'idle', endsAt: 0, celebrateUntil: celebrate ? Date.now() + celebrate : 0 };
    this._changed();
    if (!quiet) this.emit('event', { kind: 'roundEnd', ...result, celebrateSec: cfg.rounds.celebrateSec });
    this.emit('ended', result);

    this._later(() => {
      if (this.state.status === 'celebrating') { this.state.status = 'idle'; this.state.celebrateUntil = 0; this._changed(); }
      if (cfg.rounds.autoReset) this.emit('reset');
      if (cfg.rounds.autoRestart && !quiet) this.start(cfg.rounds.durationMin);
    }, celebrate || 10);
    return result;
  }
}

/* ----------------------------------------------------------------------------
 * 13. Lives: each live is a separate scoreboard with its own TikTok account,
 *     config, scores, rounds, voice and reports (data/lives/<slug>/).
 *     Shared by all lives: the gift catalog, gift images, uploads, voice cache.
 * ------------------------------------------------------------------------- */
const catalog = new GiftCatalog();
catalog.load();
const tts = createTTS({ dir: path.join(SETTINGS.dataDir, 'tts-cache'), log });
const LIVES_DIR = path.join(SETTINGS.dataDir, 'lives');
const LIVES_FILE = path.join(SETTINGS.dataDir, 'lives.json');
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const MAX_BUFFERED = 1024 * 1024; // skip non-essential messages for clients that cannot keep up

class Live {
  constructor(meta) {
    this.meta = meta;                     // { slug, name, ownerId, createdAt, tiktokUsername, autoConnect }
    this.slug = meta.slug;
    this.dir = path.join(LIVES_DIR, meta.slug);
    this.files = {
      config: path.join(this.dir, 'config.json'), state: path.join(this.dir, 'state.json'),
      round: path.join(this.dir, 'round.json'), history: path.join(this.dir, 'rounds.json'), reports: path.join(this.dir, 'reports'),
    };
    fs.mkdirSync(this.dir, { recursive: true });
    const saved = readJsonSafe(this.files.config);
    this.config = sanitizeConfig(saved || { ...DEFAULT_CONFIG, title: meta.slug === 'main' ? DEFAULT_CONFIG.title : (meta.name || DEFAULT_CONFIG.title) });
    if (!saved) writeJsonAtomic(this.files.config, this.config).catch(() => {});
    this.board = new ScoreBoard(this.config);
    this.board.restore(readJsonSafe(this.files.state));
    this.pipeline = new Pipeline(this.board, catalog);
    this.tiktok = new TikTokManager(this.pipeline, () => this.config);
    this.demo = new DemoSimulator(this.pipeline, this.board);
    this.rounds = new RoundManager(this.board, () => this.config, { round: this.files.round, history: this.files.history });
    this.reports = new Reports({ dir: this.files.reports, log, getConfig: () => this.config });
    this.game = new GameManager(() => this.config);
    this.clients = new Set();
    this.streakPoints = new Map(); this.lastTakeoverSpeech = 0; this.ttsWarnedAt = 0; this.lastConnState = 'idle';
    this._wire();
  }

  /* ---- persistence ---- */
  writeState() { return writeJsonAtomic(this.files.state, this.board.serialize()).catch((e) => log.warn(`[${this.slug}] State save failed:`, e.message)); }
  async applyNewConfig(raw, persist = true) {
    this.config = sanitizeConfig(raw);
    this.board.applyConfig(this.config);
    this.game.onConfig();
    if (persist) await writeJsonAtomic(this.files.config, this.config).catch((e) => log.warn('Config save failed:', e.message));
    this.broadcast({ type: 'config', config: this.config });
    log.info(`[${this.slug}] Config applied (${this.config.teams.length} teams)`);
    return this.config;
  }

  /* ---- clients ---- */
  broadcast(msg, { essential = true } = {}) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!essential && ws.bufferedAmount > MAX_BUFFERED) continue;
      ws.send(data);
    }
  }
  publicStatus() { return { ...this.tiktok.status, demo: this.demo.running }; }
  hello(ws) {
    return {
      type: 'hello', version: VERSION, config: this.config, state: this.board.snapshot(), status: this.publicStatus(),
      gifts: catalog.list(), isAdmin: ws.isAdmin, round: this.rounds.public(), game: this.game.public(), live: { slug: this.slug, name: this.meta.name },
    };
  }

  /* ---- events -> screens, reports, voice ---- */
  _wire() {
    const { board, pipeline, tiktok, rounds, reports, demo } = this;
    this.saveState = throttle(() => this.writeState(), () => 2000);
    this.broadcastState = throttle(() => this.broadcast({ type: 'state', state: board.snapshot() }), () => this.config.advanced.broadcastIntervalMs);
    board.on('change', () => { this.broadcastState(); this.saveState(); });
    const ctx = () => ({ username: tiktok.status.username || '', demo: demo.running });
    pipeline.on('event', (ev) => {
      if ((ev.kind === 'gift' || ev.kind === 'follow' || ev.kind === 'share' || ev.kind === 'join') && ev.points) this.game.onPoints(ev.teamId, ev.points);
      this.broadcastState.flush();
      this.broadcast({ type: 'event', event: { ...ev, ts: Date.now() } }, { essential: false });
      if (ev.kind === 'gift') reports.onGift(ev, ctx());
      else if (ev.kind === 'follow' || ev.kind === 'share' || (ev.kind === 'join' && ev.points)) reports.onPoints(ev, ctx());
      this.speakFor(ev);
    });
    tiktok.on('status', (st) => {
      this.broadcast({ type: 'status', status: this.publicStatus() });
      if (st.state === this.lastConnState) return;
      const prev = this.lastConnState; this.lastConnState = st.state;
      if (st.state === 'connected') {
        if (reports.current && reports.current.username && reports.current.username !== st.username) reports.end('new stream');
        if (!reports.current) reports.begin({ username: st.username, reason: 'connected' });
        else if (!reports.current.username) reports.current.username = st.username;
      } else if (prev === 'connected' && st.state === 'offline') reports.end('stream ended');
      else if (st.state === 'idle' && /host/i.test(st.message || '')) reports.end('disconnected');
    });
    tiktok.on('viewers', (v) => { reports.viewers = v; reports.onViewers(v); });
    rounds.on('change', (r) => this.broadcast({ type: 'round', round: r }));
    this.broadcastGame = throttle(() => this.broadcast({ type: 'game', game: this.game.public() }), () => 120);
    this.game.on('change', () => this.broadcastGame());
    this.game.on('event', (ev) => { this.broadcastGame.flush(); this.broadcast({ type: 'event', event: { ...ev, ts: Date.now() } }); this.speakFor(ev); });
    rounds.on('event', (ev) => { this.broadcast({ type: 'event', event: { ...ev, ts: Date.now() } }); this.speakFor(ev); });
    rounds.on('ended', (res) => reports.onRound(res));
    rounds.on('reset', () => {
      board.reset(true); pipeline.streaks.clear(); this.writeState();
      this.broadcast({ type: 'event', event: { kind: 'reset', ts: Date.now(), auto: true } });
    });
  }

  sayText(text, { force = false } = {}) {
    const t = this.config.tts;
    if (!text || (!t.enabled && !force)) return Promise.resolve(null);
    if (t.engine === 'browser') { this.broadcast({ type: 'speak', text, volume: t.volume }); return Promise.resolve(null); }
    return tts.synth(text, { voice: t.voice, rate: t.rate })
      .then((url) => { this.broadcast({ type: 'speak', url, text, volume: t.volume }); return url; })
      .catch((e) => {
        if (Date.now() - this.ttsWarnedAt > 60000) { this.ttsWarnedAt = Date.now(); log.warn(`[${this.slug}] Voice (Edge TTS) failed, using browser voice:`, e.message); }
        this.broadcast({ type: 'speak', text, volume: t.volume });
        throw e;
      });
  }
  speakFor(ev) {
    const t = this.config.tts;
    if (!t.enabled) return;
    const teamName = (id) => this.config.teams.find((x) => x.id === id)?.name || '';
    let text = '';
    if (ev.kind === 'gift' && t.readGifts) {
      let pts = ev.points;
      if (ev.streakKey) { // combo: speak once, at the end, with the full total
        pts = (this.streakPoints.get(ev.streakKey) || 0) + ev.points;
        if (!ev.final) { this.streakPoints.set(ev.streakKey, pts); if (this.streakPoints.size > 2000) this.streakPoints.clear(); return; }
        this.streakPoints.delete(ev.streakKey);
      }
      if (pts < t.minPoints) return;
      text = fillTemplate(t.giftTemplate, { name: ev.user.nickname, gift: ev.gift.name, count: ev.gift.count, team: teamName(ev.teamId), points: Math.round(pts) });
    } else if (ev.kind === 'takeover' && t.readTakeover) {
      if (Date.now() - this.lastTakeoverSpeech < 10000) return;
      this.lastTakeoverSpeech = Date.now();
      text = fillTemplate(t.takeoverTemplate, { team: teamName(ev.teamId) });
    } else if (ev.kind === 'roundEnd' && t.readRoundWinner) {
      text = ev.winner ? fillTemplate(t.roundTemplate, { team: ev.winner.name, points: Math.round(ev.winner.score) }) : 'انتهت الجولة بدون فائز';
    } else if (ev.kind === 'game' && t.readRoundWinner) {
      const n = (id) => teamName(id);
      text = ev.type === 'goal' ? `هدف لـ${n(ev.teamId)}! ${ev.ga} مقابل ${ev.gb}`
        : ev.type === 'kickoff' ? `${ev.round}: ${n(ev.a)} ضد ${n(ev.b)}، بدأت المباراة`
        : ev.type === 'fulltime' ? `انتهت المباراة، الفائز ${n(ev.winner)}`
        : ev.type === 'champion' ? `${n(ev.teamId)} بطل كأس العرب!`
        : ev.type === 'ko' ? `خرجت ${n(ev.teamId)} من الحلبة`
        : ev.type === 'revive' ? `عادت ${n(ev.teamId)} إلى الحلبة!`
        : ev.type === 'arenaWinner' ? `${n(ev.teamId)} بطل الحلبة!` : '';
    } else if (ev.kind === 'follow' && t.readFollows) {
      text = fillTemplate(t.followTemplate, { name: ev.user.nickname });
    }
    if (text) this.sayText(text).catch(() => {});
  }

  /* ---- panel commands for this live ---- */
  async command(action, p, msg) {
    const { board, pipeline, tiktok, demo, rounds } = this;
    switch (action) {
      case 'connect':
        await tiktok.start(p.username);
        // Remember the account so the server reconnects after a restart.
        this.meta.tiktokUsername = tiktok.desired; this.meta.autoConnect = true; lives.save();
        return null;
      case 'disconnect':
        await tiktok.stop();
        this.meta.autoConnect = false; lives.save();
        return null;
      case 'saveConfig': return { config: await this.applyNewConfig(p.config) };
      case 'reset':
        board.reset(p.keepAllegiance !== false); pipeline.streaks.clear(); this.writeState();
        this.broadcast({ type: 'event', event: { kind: 'reset', ts: Date.now() } });
        log.info(`[${this.slug}] Scores reset`);
        return null;
      case 'adjust': {
        const delta = num(p.delta, 0);
        if (!board.teams.has(p.teamId) || !delta) throw new Error('فريق غير معروف أو قيمة صفر');
        const r = board.adjust(p.teamId, delta);
        if (r.takeover) pipeline.emit('event', { kind: 'takeover', teamId: board.leaderId, prevTeamId: r.prevLeader || null });
        return null;
      }
      case 'simulateGift': {
        const nick = str(p.nickname || 'TestViewer', 48);
        const id = `sim_${slug(nick) || 'viewer'}`;
        const known = catalog.find(p.giftId, p.giftName);
        if (known && !p.giftId) p.giftId = known.id;
        pipeline.handleGift({
          user: { id, displayId: slug(nick) || 'test_viewer', nickname: nick },
          giftId: num(p.giftId, 999999), repeatCount: Math.max(1, Math.min(10000, Math.floor(num(p.count, 1)))),
          repeatEnd: false, groupId: String(Date.now()),
          giftDetails: { giftName: str(p.giftName || 'Rose', 48), diamondCount: Math.max(0, num(p.diamonds, 1)), giftType: 2 },
        }, { forceTeam: p.teamId || null });
        return null;
      }
      case 'simulateChat': {
        const nick = str(p.nickname || 'TestViewer', 48);
        pipeline.handleChat({ user: { id: `sim_${slug(nick) || 'viewer'}`, displayId: slug(nick), nickname: nick }, comment: str(p.text, 300) });
        return null;
      }
      case 'demo':
        if (p.enabled) demo.start(); else demo.stop();
        this.broadcast({ type: 'status', status: this.publicStatus() });
        return null;
      case 'gameStart': this.game.start(); return null;
      case 'gameStop': this.game.stop(); return null;
      case 'gameNext': this.game.next(); return null;
      case 'roundStart': rounds.start(p.durationMin); return null;
      case 'roundEnd': rounds.end('manual'); return null;
      case 'roundCancel': rounds.cancel(); return null;
      case 'roundExtend': rounds.extend(num(p.sec, 60)); return null;
      case 'socialReset': board.resetSocial(); this.writeState(); return null;
      case 'simulateFollow':
      case 'simulateShare': {
        const nick = str(p.nickname || 'متابع جديد', 48);
        const id = action === 'simulateFollow' ? `sim_f_${Date.now()}` : `sim_${slug(nick) || 'viewer'}`;
        if (p.teamId && board.teams.has(p.teamId)) board.allegiance.set(id, p.teamId);
        const raw = { user: { id, displayId: slug(nick) || 'viewer', nickname: nick } };
        if (action === 'simulateFollow') pipeline.handleFollow(raw); else pipeline.handleShare(raw);
        return null;
      }
      case 'say': {
        const text = str(p.text, 200).trim();
        if (!text) throw new Error('اكتب النص');
        return { url: await this.sayText(text, { force: true }) };
      }
      case 'getState': return { config: this.config, state: board.snapshot(), status: this.publicStatus(), gifts: catalog.list() };
      default: throw new Error(`Unknown action "${action}"`);
    }
  }

  start() {
    if (this.meta.autoConnect && this.meta.tiktokUsername) this.tiktok.start(this.meta.tiktokUsername).catch((e) => log.error(`[${this.slug}]`, e.message));
  }
  async stop() {
    this.demo.stop();
    await this.tiktok.stop().catch(() => {});
    await writeJsonAtomic(this.files.state, this.board.serialize()).catch(() => {});
    this.reports.flush();
  }
  async destroy() {
    await this.stop();
    this.rounds.destroy();
    this.game.destroy();
    for (const ws of this.clients) ws.close(4004, 'Live deleted');
  }
}

/** Registry of lives (data/lives.json). */
const lives = {
  map: new Map(),
  meta() { return [...this.map.values()].map((l) => l.meta); },
  save() { writeJsonAtomic(LIVES_FILE, this.meta()).catch((e) => log.warn('lives.json save failed:', e.message)); },
  get(slugName) { return this.map.get(String(slugName || '')) || null; },
  ownedBy(userId) { return [...this.map.values()].filter((l) => l.meta.ownerId === userId); },
  forUser(u) { return isOwner(u) ? [...this.map.values()] : this.ownedBy(u.id); },
  canManage(u, live) { return Boolean(u && live && (isOwner(u) || live.meta.ownerId === u.id)); },
  defaultFor(u) { const l = this.forUser(u); return (isOwner(u) && this.map.get('main')) || l[0] || null; },
  create({ slug: sl, name, ownerId }) {
    const s2 = String(sl || '').trim().toLowerCase();
    if (!SLUG_RE.test(s2)) throw httpErr(400, 'اسم الرابط: حروف إنجليزية صغيرة وأرقام و- فقط (2-31 حرفاً)');
    if (this.map.has(s2)) throw httpErr(409, 'هذا الرابط مستخدم، اختر اسماً آخر');
    const meta = { slug: s2, name: str(name || s2, 60).trim(), ownerId, createdAt: Date.now(), tiktokUsername: '', autoConnect: false };
    const live = new Live(meta);
    this.map.set(s2, live); this.save();
    log.info(`Live created: ${s2} (owner ${ownerId})`);
    return live;
  },
  async remove(sl) {
    const live = this.map.get(sl);
    if (!live) return;
    await live.destroy();
    this.map.delete(sl); this.save();
    // Keep the data folder (renamed) so nothing is lost by mistake.
    try { fs.renameSync(live.dir, path.join(LIVES_DIR, `_deleted-${sl}-${Date.now()}`)); } catch { /* ignore */ }
    log.info(`Live deleted: ${sl}`);
  },
};

// Boot: load lives; the first start of v3 moves the single-live data into data/lives/main.
{
  const owner = users.owners()[0];
  let metas = readJsonSafe(LIVES_FILE);
  if (!Array.isArray(metas) || !metas.length) {
    const mainDir = path.join(LIVES_DIR, 'main');
    fs.mkdirSync(mainDir, { recursive: true });
    for (const n of ['config.json', 'state.json', 'round.json', 'rounds.json', 'reports']) {
      const from = path.join(SETTINGS.dataDir, n);
      if (fs.existsSync(from) && !fs.existsSync(path.join(mainDir, n))) { try { fs.renameSync(from, path.join(mainDir, n)); } catch (e) { log.warn(`Migration of ${n} failed:`, e.message); } }
    }
    metas = [{ slug: 'main', name: 'البث الرئيسي', ownerId: owner ? owner.id : '', createdAt: Date.now(),
      tiktokUsername: SETTINGS.envUsername || str(legacySettings.tiktokUsername, 40), autoConnect: Boolean(SETTINGS.envUsername) || bool(legacySettings.autoConnect, false) }];
    writeJsonAtomic(LIVES_FILE, metas).catch(() => {});
    log.info('Lives: created "main" (data migrated from the single-live layout)');
  }
  for (const m of metas) {
    if (!isObj(m) || !SLUG_RE.test(String(m.slug || ''))) continue;
    if (!users.byId(m.ownerId) && owner) m.ownerId = owner.id; // orphaned live -> owner
    lives.map.set(m.slug, new Live(m));
  }
  if (SETTINGS.envUsername && lives.get('main')) { const mm = lives.get('main').meta; mm.tiktokUsername = SETTINGS.envUsername; mm.autoConnect = true; }
}

// Uploads belong to the user who uploaded them (the owner sees all). data/uploads/index.json: { name: [userIds] }
const UPLOAD_INDEX = path.join(UPLOAD_DIR, 'index.json');
const uploadIndex = (() => { const x = readJsonSafe(UPLOAD_INDEX); return isObj(x) ? x : {}; })();
const saveUploadIndex = () => writeJsonAtomic(UPLOAD_INDEX, uploadIndex).catch(() => {});

catalog.on('change', () => { const msg = { type: 'catalog', gifts: catalog.list() }; for (const l of lives.map.values()) l.broadcast(msg, { essential: false }); });

/* ----------------------------------------------------------------------------
 * 14. HTTP server: pages, public data, admin REST API
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

async function sendFile(res, req, file, type, cache, extra = {}) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', ...extra });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

const liveSummary = (l) => {
  const owner = users.byId(l.meta.ownerId);
  return { slug: l.slug, name: l.meta.name, ownerId: l.meta.ownerId, ownerEmail: owner?.email || '', ownerName: owner?.name || '', createdAt: l.meta.createdAt,
    tiktokUsername: l.meta.tiktokUsername, autoConnect: l.meta.autoConnect, status: l.tiktok.status.state, demo: l.demo.running,
    clients: l.clients.size, total: l.board.snapshot().total, title: l.config.title };
};

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...baseHeaders, ...extra }); res.end(body); };
  const json = (code, obj, extra) => send(code, 'application/json; charset=utf-8', JSON.stringify(obj), extra);

  try {
    // ---------- Public routes ----------
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/' && url.searchParams.get('obs') === '1') { res.writeHead(302, { Location: '/overlay/' }); return res.end(); }
      // Short links: /l/<live>, /l/<live>/overlay, /l/<live>/overlay-vertical
      const short = /^\/l\/([a-z0-9-]{2,31})(?:\/(overlay|overlay-vertical))?\/?$/.exec(p);
      if (short) { res.writeHead(302, { Location: `/${short[2] ? `${short[2]}/` : ''}?live=${short[1]}` }); return res.end(); }
      if (p === '/health') return json(200, { ok: true, version: VERSION, uptime: Math.round(process.uptime()), clients: wss.clients.size, lives: lives.map.size });
      if (p === '/api/state') {
        const l = lives.get(url.searchParams.get('live') || 'main');
        if (!l) return json(404, { error: 'البث غير موجود' });
        return json(200, { config: l.config, state: l.board.snapshot(), status: l.publicStatus() });
      }
      if (p.startsWith('/tts/')) return TTS_RE.test(p) ? sendFile(res, req, path.join(tts.dir, path.basename(p)), 'audio/mpeg', 'public, max-age=86400') : send(404, 'text/plain', 'Not found');
      if (p.startsWith('/gift-img/')) return GIFT_IMG_RE.test(p) ? sendFile(res, req, path.join(GIFT_IMG_DIR, path.basename(p)), MIME[path.extname(p)] || 'application/octet-stream', 'public, max-age=604800', { 'Content-Security-Policy': "default-src 'none'" }) : send(404, 'text/plain', 'Not found');
      if (p.startsWith('/uploads/')) return UPLOAD_RE.test(p) ? sendFile(res, req, path.join(UPLOAD_DIR, path.basename(p)), MIME[path.extname(p)] || 'application/octet-stream', 'public, max-age=31536000, immutable', { 'Content-Security-Policy': "default-src 'none'" }) : send(404, 'text/plain', 'Not found');
      if (p === '/api/me') {
        const u = isAuthed(req);
        return json(200, { authed: Boolean(u), user: publicUser(u), mustChangePassword: Boolean(u && u.mustChangePassword) });
      }
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
      const u = users.byEmail(body.email);
      const pwOk = verifyPassword(body.password || '', u ? u.password : { salt: 'x', hash: '00' }); // always run (timing)
      if (!u || !pwOk || u.disabled) {
        loginFailed(ip);
        log.warn(`Failed login (${String(body.email || '').slice(0, 60)}) from ${ip}`);
        await new Promise((r) => setTimeout(r, 500));
        return json(401, { error: u && u.disabled && pwOk ? 'هذا الحساب موقوف. تواصل مع المدير.' : 'البريد أو كلمة المرور غير صحيحة' });
      }
      loginFails.delete(ip);
      u.lastLoginAt = Date.now(); users.save();
      log.info(`Login: ${u.email} (${u.role}) from ${ip}`);
      return json(200, { ok: true, user: publicUser(u), mustChangePassword: u.mustChangePassword }, { 'Set-Cookie': sessionCookie(req, makeSession(u), SESSION_TTL / 1000) });
    }
    if (p === '/api/logout' && req.method === 'POST') return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });

    // ---------- Everything below needs a logged-in user ----------
    const me = isAuthed(req);
    if (!me) return json(401, { error: 'يجب تسجيل الدخول' });
    const ownerOnly = () => { if (!isOwner(me)) throw httpErr(403, 'هذه الصفحة للمدير فقط'); };
    /** The live this request is about (?live=slug), after checking this user may manage it. */
    const reqLive = () => {
      const sl = url.searchParams.get('live');
      const l = sl ? lives.get(sl) : lives.defaultFor(me);
      if (!l) throw httpErr(404, 'البث غير موجود. أنشئ بثاً من صفحة «البثوث».');
      if (!lives.canManage(me, l)) throw httpErr(403, 'ليس لديك صلاحية على هذا البث');
      return l;
    };

    // ---- My account (every user) ----
    if (p === '/api/account' && req.method === 'GET') return json(200, { user: publicUser(me), lives: lives.forUser(me).length });
    if (p === '/api/account' && req.method === 'POST') {
      const b = await readJsonBody(req, 8192);
      const headers = {};
      const needPw = () => { if (!verifyPassword(b.currentPassword || '', me.password)) throw httpErr(400, 'كلمة المرور الحالية غير صحيحة'); };
      if (typeof b.name === 'string' && b.name.trim()) me.name = str(b.name, 60).trim();
      if (typeof b.email === 'string' && b.email.trim().toLowerCase() !== me.email) {
        needPw();
        const em = b.email.trim().toLowerCase();
        if (!EMAIL_RE.test(em) && em !== 'admin') throw httpErr(400, 'بريد إلكتروني غير صالح');
        if (users.byEmail(em)) throw httpErr(409, 'يوجد مستخدم بهذا البريد');
        me.email = em;
      }
      if (b.newPassword !== undefined) {
        needPw();
        if (String(b.newPassword).length < 10) throw httpErr(400, 'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل');
        me.password = hashPassword(String(b.newPassword));
        me.mustChangePassword = false;
        if (isOwner(me)) fs.rmSync(INITIAL_PW_FILE, { force: true });
        headers['Set-Cookie'] = sessionCookie(req, makeSession(me), SESSION_TTL / 1000);
        for (const ws of wss.clients) if (ws.user && ws.user.id === me.id) ws.close(4001, 'Password changed');
        log.info(`Password changed: ${me.email}`);
      }
      users.save();
      return json(200, { ok: true, user: publicUser(me) }, headers);
    }

    // ---- Lives ----
    if (p === '/api/lives' && req.method === 'GET') {
      return json(200, { lives: lives.forUser(me).map(liveSummary), canCreate: isOwner(me) || lives.ownedBy(me.id).length < (me.maxLives || 0), maxLives: isOwner(me) ? null : me.maxLives });
    }
    if (p === '/api/lives' && req.method === 'POST') {
      const b = await readJsonBody(req, 4096);
      let ownerId = me.id;
      if (isOwner(me) && b.ownerId) { if (!users.byId(b.ownerId)) throw httpErr(400, 'المستخدم غير موجود'); ownerId = b.ownerId; }
      const target = users.byId(ownerId);
      if (!isOwner(me) && lives.ownedBy(me.id).length >= (me.maxLives || 0)) throw httpErr(403, `وصلت للحد الأقصى من البثوث (${me.maxLives || 0}). تواصل مع المدير.`);
      if (isOwner(me) && !isOwner(target) && lives.ownedBy(ownerId).length >= (target.maxLives || 0) && !b.force) {
        throw httpErr(409, `المستخدم وصل لحده (${target.maxLives || 0}). ارفع الحد من صفحة المستخدمين.`);
      }
      const l = lives.create({ slug: b.slug, name: b.name, ownerId });
      return json(200, { ok: true, live: liveSummary(l) });
    }
    if (p === '/api/lives/update' && req.method === 'POST') {
      const b = await readJsonBody(req, 4096);
      const l = lives.get(b.slug);
      if (!l || !lives.canManage(me, l)) throw httpErr(404, 'البث غير موجود');
      if (typeof b.name === 'string' && b.name.trim()) l.meta.name = str(b.name, 60).trim();
      if (b.ownerId !== undefined) { ownerOnly(); if (!users.byId(b.ownerId)) throw httpErr(400, 'المستخدم غير موجود'); l.meta.ownerId = b.ownerId; }
      lives.save();
      for (const ws of l.clients) ws.close(4003, 'Live updated'); // re-check permissions
      return json(200, { ok: true, live: liveSummary(l) });
    }
    if (p === '/api/lives' && req.method === 'DELETE') {
      const l = lives.get(url.searchParams.get('slug'));
      if (!l || !lives.canManage(me, l)) throw httpErr(404, 'البث غير موجود');
      if (l.slug === 'main') throw httpErr(400, 'لا يمكن حذف البث الرئيسي');
      await lives.remove(l.slug);
      return json(200, { ok: true });
    }

    // ---- Users (owner) ----
    if (p.startsWith('/api/users')) {
      ownerOnly();
      if (p === '/api/users' && req.method === 'GET') {
        return json(200, { users: users.list.map((u) => ({ ...publicUser(u), lives: lives.ownedBy(u.id).map((l) => ({ slug: l.slug, name: l.meta.name, status: l.tiktok.status.state })) })) });
      }
      if (p === '/api/users' && req.method === 'POST') {
        const b = await readJsonBody(req, 8192);
        const password = b.password && String(b.password).length >= 10 ? String(b.password) : crypto.randomBytes(9).toString('base64url');
        const u = users.create({ email: b.email, name: b.name, password, role: b.role === 'owner' ? 'owner' : 'user', maxLives: b.maxLives ?? 1, mustChangePassword: true });
        let live = null;
        if (b.createLive) {
          const base = (String(b.liveSlug || '').trim().toLowerCase() || slug(u.email.split('@')[0]).replace(/[^a-z0-9-]/g, '') || 'live').slice(0, 24);
          let sl = SLUG_RE.test(base) ? base : `live-${u.id.slice(0, 6)}`; let n = 2;
          while (lives.get(sl)) sl = `${base}-${n++}`;
          live = liveSummary(lives.create({ slug: sl, name: b.liveName || u.name, ownerId: u.id }));
        }
        log.info(`User created: ${u.email} (${u.role}) by ${me.email}`);
        return json(200, { ok: true, user: publicUser(u), password, live });
      }
      if (p === '/api/users/update' && req.method === 'POST') {
        const b = await readJsonBody(req, 8192);
        const u = users.byId(b.id);
        if (!u) throw httpErr(404, 'المستخدم غير موجود');
        const lastOwner = isOwner(u) && users.owners().length <= 1;
        if (typeof b.name === 'string' && b.name.trim()) u.name = str(b.name, 60).trim();
        if (typeof b.email === 'string' && b.email.trim().toLowerCase() !== u.email) {
          const em = b.email.trim().toLowerCase();
          if (!EMAIL_RE.test(em)) throw httpErr(400, 'بريد إلكتروني غير صالح');
          if (users.byEmail(em)) throw httpErr(409, 'يوجد مستخدم بهذا البريد');
          u.email = em;
        }
        if (b.maxLives !== undefined) u.maxLives = Math.round(numIn(b.maxLives, 0, 100, u.maxLives));
        if (b.role !== undefined) { if (lastOwner && b.role !== 'owner') throw httpErr(400, 'يجب أن يبقى مدير واحد على الأقل'); u.role = b.role === 'owner' ? 'owner' : 'user'; }
        if (b.disabled !== undefined) {
          if (u.id === me.id) throw httpErr(400, 'لا يمكنك إيقاف حسابك');
          u.disabled = Boolean(b.disabled);
          if (u.disabled) { for (const ws of wss.clients) if (ws.user && ws.user.id === u.id) ws.close(4001, 'Account disabled'); }
        }
        let password = null;
        if (b.resetPassword) {
          password = crypto.randomBytes(9).toString('base64url');
          u.password = hashPassword(password); u.mustChangePassword = true;
          for (const ws of wss.clients) if (ws.user && ws.user.id === u.id) ws.close(4001, 'Password reset');
        }
        users.save();
        return json(200, { ok: true, user: publicUser(u), password });
      }
      if (p === '/api/users' && req.method === 'DELETE') {
        const u = users.byId(url.searchParams.get('id'));
        if (!u) throw httpErr(404, 'المستخدم غير موجود');
        if (u.id === me.id) throw httpErr(400, 'لا يمكنك حذف حسابك');
        if (isOwner(u) && users.owners().length <= 1) throw httpErr(400, 'يجب أن يبقى مدير واحد على الأقل');
        const mode = url.searchParams.get('lives') === 'delete' ? 'delete' : 'transfer';
        for (const l of lives.ownedBy(u.id)) {
          if (mode === 'delete' && l.slug !== 'main') await lives.remove(l.slug);
          else { l.meta.ownerId = me.id; }
        }
        lives.save();
        users.list = users.list.filter((x) => x.id !== u.id); users.save();
        for (const ws of wss.clients) if (ws.user && ws.user.id === u.id) ws.close(4001, 'Account deleted');
        log.info(`User deleted: ${u.email} by ${me.email} (lives: ${mode})`);
        return json(200, { ok: true });
      }
      throw httpErr(404, 'مسار غير معروف');
    }

    // ---- Live-scoped: rounds, reports, voice test ----
    // ---- Promo videos (per live) ----
    if (p === '/api/promo' && req.method === 'GET') {
      const l = reqLive();
      const job = promo.current && promo.current.slug === l.slug ? promo.current : promo.last.get(l.slug) || null;
      return json(200, { tools: await promoTools(url.searchParams.get('check') === '1'), busy: Boolean(promo.current && promo.current.slug !== l.slug), job, videos: await listVideos(l) });
    }
    if (p === '/api/promo' && req.method === 'POST') {
      const l = reqLive(); const b = await readJsonBody(req, 4096);
      const tools = await promoTools(true);
      if (!tools.ready) throw httpErr(400, 'أدوات الفيديو غير مثبتة على الخادم. شغّل مرة واحدة: sudo bash /opt/koydam-tiktok/deploy/install-video.sh');
      const clean = (v, n) => str(v, n).replace(/[\r\n]+/g, ' ').trim();
      return json(202, { ok: true, job: startPromo(l, { kind: b.kind === 'teaser' ? 'teaser' : 'race', winner: str(b.winner, 60), rival: str(b.rival, 60), orientation: str(b.orientation, 20),
        when: clean(b.when, 40), headline: clean(b.headline, 30), handle: clean(b.handle, 40).replace(/[^\w.]/g, ''), cta: clean(b.cta, 120) }, me) });
    }
    if (p === '/api/promo/file' && (req.method === 'GET' || req.method === 'HEAD')) {
      const l = reqLive(); const id = String(url.searchParams.get('id') || '');
      if (!VIDEO_ID_RE.test(id)) throw httpErr(400, 'معرف غير صالح');
      const dl = url.searchParams.get('download') === '1';
      return sendFile(res, req, path.join(videoDir(l), `${id}.mp4`), 'video/mp4', 'private, max-age=3600',
        dl ? { 'Content-Disposition': `attachment; filename="1m-${l.slug}-${id}.mp4"` } : {});
    }
    if (p === '/api/promo' && req.method === 'DELETE') {
      const l = reqLive(); const id = String(url.searchParams.get('id') || '');
      if (!VIDEO_ID_RE.test(id)) throw httpErr(400, 'معرف غير صالح');
      await fsp.rm(path.join(videoDir(l), `${id}.mp4`), { force: true }); await fsp.rm(path.join(videoDir(l), `${id}.json`), { force: true });
      return json(200, { ok: true });
    }

    if (p === '/api/rounds' && req.method === 'GET') { const l = reqLive(); return json(200, { round: l.rounds.public(), history: l.rounds.history }); }
    if (p === '/api/rounds' && req.method === 'DELETE') { const l = reqLive(); l.rounds.history = []; await writeJsonAtomic(l.files.history, []); return json(200, { ok: true }); }
    if (p === '/api/reports' && req.method === 'GET') { const l = reqLive(); return json(200, { reports: await l.reports.list(), currentId: l.reports.current?.id || null }); }
    if (p === '/api/reports/new' && req.method === 'POST') { const l = reqLive(); const r = l.reports.begin({ username: l.tiktok.status.username || '', demo: l.demo.running, reason: 'manual' }); return json(200, { ok: true, id: r.id }); }
    if (p === '/api/reports/end' && req.method === 'POST') { const l = reqLive(); const r = l.reports.end('manual'); return json(200, { ok: true, id: r?.id || null }); }
    {
      const m = /^\/api\/reports\/([0-9a-z-]+?)(\.csv)?$/.exec(p);
      if (m) {
        const l = reqLive();
        if (req.method === 'DELETE') { if (!(await l.reports.remove(m[1]))) throw httpErr(400, 'لا يمكن حذف هذا التقرير'); return json(200, { ok: true }); }
        const r = await l.reports.get(m[1]);
        if (!r) throw httpErr(404, 'التقرير غير موجود');
        if (m[2]) return send(200, 'text/csv; charset=utf-8', l.reports.csv(r), { 'Content-Disposition': `attachment; filename="report-${l.slug}-${r.id}.csv"` });
        return json(200, { report: r });
      }
    }
    if (p === '/api/tts/voices' && req.method === 'GET') return json(200, { voices: VOICES.map(([id, label]) => ({ id, label })) });
    if (p === '/api/tts/test' && req.method === 'POST') {
      const l = reqLive();
      const b = await readJsonBody(req, 4096);
      const text = str(b.text || 'شكراً على الهدية، المغرب يتصدر الآن!', 200);
      try { return json(200, { ok: true, url: await tts.synth(text, { voice: b.voice || l.config.tts.voice, rate: b.rate ?? l.config.tts.rate }) }); }
      catch (e) { throw httpErr(502, `تعذر توليد الصوت: ${e.message}`); }
    }

    // ---- Gift catalog (shared) ----
    if (p === '/api/gifts' && req.method === 'GET') return json(200, { gifts: catalog.list() });
    if (p === '/api/gifts/refresh' && req.method === 'POST') {
      const l = reqLive();
      const b = await readJsonBody(req, 4096);
      const username = String(b.username || '').trim().replace(/^@/, '');
      let gifts = username ? null : await l.tiktok.fetchGifts().catch(() => null);
      if (!gifts) {
        const u = username || l.meta.tiktokUsername;
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
      log.info(`Gift list fetched: ${n} gifts (by ${me.email})`);
      return json(200, { ok: true, count: n, total: catalog.byId.size });
    }

    // ---- Uploads (each user sees their own; the owner sees all) ----
    if (p === '/api/uploads' && req.method === 'GET') {
      const all = await listUploads();
      return json(200, { files: isOwner(me) ? all : all.filter((f) => (uploadIndex[f.name] || []).includes(me.id)) });
    }
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
      uploadIndex[name] = [...new Set([...(uploadIndex[name] || []), me.id])]; saveUploadIndex();
      log.info(`Image uploaded: ${name} (${Math.round(buf.length / 1024)} KB) by ${me.email}`);
      return json(200, { ok: true, url: `/uploads/${name}`, size: buf.length });
    }
    if (p === '/api/upload' && req.method === 'DELETE') {
      const name = String(url.searchParams.get('name') || '');
      if (!UPLOAD_RE.test(`/uploads/${name}`)) throw httpErr(400, 'اسم غير صالح');
      const holders = (uploadIndex[name] || []).filter((id) => isOwner(me) || id !== me.id);
      if (!isOwner(me) && !(uploadIndex[name] || []).includes(me.id)) throw httpErr(403, 'هذه الصورة ليست لك');
      if (isOwner(me) || !holders.length) { await fsp.rm(path.join(UPLOAD_DIR, name), { force: true }); delete uploadIndex[name]; }
      else uploadIndex[name] = holders;
      saveUploadIndex();
      return json(200, { ok: true });
    }

    // ================= Owner only: server, files, logs, updates =================
    ownerOnly();

    if (p === '/api/settings' && req.method === 'GET') {
      const k = serverSettings.signApiKey;
      const stats = { gifts: 0, chats: 0, likes: 0, points: 0 };
      for (const l of lives.map.values()) for (const key of Object.keys(stats)) stats[key] += l.pipeline.stats[key] || 0;
      return json(200, {
        adminEmail: me.email, signApiKeySet: Boolean(k), signApiKeyHint: k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '',
        adminTokenSet: Boolean(serverSettings.adminToken), mustChangePassword: me.mustChangePassword,
        server: {
          version: VERSION, node: process.version, uptime: Math.round(process.uptime()), pid: process.pid,
          supervised: supervised(), appRoot: APP_ROOT, dataDir: SETTINGS.dataDir, port: SETTINGS.port,
          memoryMb: Math.round(process.memoryUsage().rss / 1048576), clients: wss.clients.size, stats, lives: lives.map.size, users: users.list.length,
        },
      });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await readJsonBody(req, 16384);
      let restartRequired = false;
      if (typeof b.signApiKey === 'string' && b.signApiKey.trim()) { serverSettings.signApiKey = b.signApiKey.trim().slice(0, 300); restartRequired = true; }
      if (b.clearSignApiKey === true) { serverSettings.signApiKey = ''; restartRequired = true; }
      if (typeof b.adminToken === 'string' && b.adminToken.trim()) serverSettings.adminToken = b.adminToken.trim().slice(0, 200);
      if (b.clearAdminToken === true) serverSettings.adminToken = '';
      writeServerSettingsSync();
      return json(200, { ok: true, restartRequired });
    }
    if (p === '/api/restart' && req.method === 'POST') {
      json(200, { ok: true, supervised: supervised() });
      log.warn('Restart requested from admin panel');
      setTimeout(() => shutdown('restart from panel'), 300);
      return;
    }
    if (p === '/api/logs' && req.method === 'GET') {
      const since = url.searchParams.get('boot') === BOOT_ID ? num(url.searchParams.get('since'), 0) : 0;
      return json(200, { lines: LOG_BUFFER.filter((l) => l.i > since), next: logSeq, boot: BOOT_ID });
    }
    if (p === '/api/jobs' && req.method === 'GET') return json(200, jobs);
    if (p === '/api/build' && req.method === 'POST') return json(202, { ok: true, job: startJob('build', [{ label: 'بناء الواجهة', cmd: 'npm', args: ['run', 'build'] }]) });
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
      return json(202, { ok: true, job: startJob('update', steps, () => setTimeout(() => shutdown('restart after update'), 500)) });
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
      if (b.expectMtime && fs.existsSync(abs) && Math.abs(fs.statSync(abs).mtimeMs - b.expectMtime) > 1 && !b.force) {
        throw httpErr(409, 'تغيّر الملف على الخادم بعد فتحه. أعد تحميله أو احفظ للكتابة فوقه.', { conflict: true });
      }
      const problem = checkSyntax(rel, b.content);
      if (problem && (rel === 'server/index.js' || !b.force)) throw httpErr(422, problem, { syntax: true, canForce: rel !== 'server/index.js' });
      await backupFile(abs, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, b.content);
      await fsp.rename(tmp, abs);
      log.info(`File saved from panel: ${rel}`);
      let note = ''; let restartRequired = false; let buildRequired = false;
      const liveOfConfig = [...lives.map.values()].find((l) => l.files.config === abs);
      const liveOfState = [...lives.map.values()].find((l) => l.files.state === abs);
      if (liveOfConfig) { await liveOfConfig.applyNewConfig(JSON.parse(b.content), false); note = 'تم تطبيق الإعدادات مباشرة.'; }
      else if (liveOfState) { note = 'الخادم يكتب state.json باستمرار. أعد التشغيل لتحميل تعديلك.'; restartRequired = true; }
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
 * 15. WebSocket hub: each socket belongs to one live (?live=slug, default "main")
 * ------------------------------------------------------------------------- */
const wss = new WebSocketServer({ server: httpServer, maxPayload: 512 * 1024, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.msgBudget = { tokens: 30, ts: Date.now() };
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', (e) => log.warn('WS client error:', e.message));
  const q = new URL(req.url, 'http://localhost').searchParams;
  const live = lives.get(q.get('live') || 'main');
  if (!live) { ws.send(JSON.stringify({ type: 'error', error: 'البث غير موجود' })); ws.close(4004, 'Unknown live'); return; }
  // Admin = logged-in user who may manage this live, from the same origin (blocks cross-site hijacking).
  ws.user = sameOrigin(req) ? isAuthed(req) : null;
  ws.isAdmin = lives.canManage(ws.user, live);
  ws.live = live;
  live.clients.add(ws);
  ws.on('close', () => live.clients.delete(ws));
  ws.send(JSON.stringify(live.hello(ws)));

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

/** Panel commands, for the live this socket is connected to. */
async function handleCommand(ws, msg) {
  if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
  if (msg.type !== 'cmd') return;
  // Auth: a user who may manage this live, or the optional server API token (owner level).
  const tokenOk = Boolean(serverSettings.adminToken) && typeof msg.token === 'string' && safeEqual(msg.token, serverSettings.adminToken);
  if (!ws.isAdmin && !tokenOk) return reply(ws, msg.reqId, false, 'يجب تسجيل الدخول من /admin');
  // A user disabled or changed since the socket opened loses access.
  if (!tokenOk && (!ws.user || !users.byId(ws.user.id) || users.byId(ws.user.id).disabled || !lives.canManage(users.byId(ws.user.id), ws.live))) {
    return reply(ws, msg.reqId, false, 'ليس لديك صلاحية على هذا البث');
  }
  const data = await ws.live.command(msg.action, isObj(msg.payload) ? msg.payload : {}, msg);
  return reply(ws, msg.reqId, true, null, data);
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
  log.info(`Scoreboard v${VERSION} listening on ${SETTINGS.host}:${SETTINGS.port} (${lives.map.size} lives, ${users.list.length} users)`);
  log.info(`  Live page:       ${base}/`);
  log.info(`  Overlay (OBS):   ${base}/overlay`);
  log.info(`  Admin panel:     ${base}/admin`);
  if (generatedPassword) {
    const owner = users.owners()[0];
    log.warn('==================================================================');
    log.warn(`  FIRST RUN: admin login = ${owner ? owner.email : 'admin'} / ${generatedPassword}`);
    log.warn(`  (also saved in ${INITIAL_PW_FILE}). Change it in the panel.`);
    log.warn('==================================================================');
  }
  for (const l of lives.map.values()) l.start();
  if (SETTINGS.demo && lives.get('main')) lives.get('main').demo.start();
});

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${sig}: shutting down...`);
  clearInterval(heartbeat);
  const force = setTimeout(() => process.exit(0), 5000);
  try {
    await Promise.all([...lives.map.values()].map((l) => l.stop().catch(() => {})));
    lives.save();
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
