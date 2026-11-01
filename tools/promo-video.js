#!/usr/bin/env node
/**
 * Promo video: records the real OBS overlay while a scripted gift battle races to
 * 1,000,000 points, then shows the winner screen. Output: MP4 (H.264).
 *
 * From the panel (page «فيديو ترويجي») the server runs it with a live's own settings:
 *   node tools/promo-video.js --config=data/lives/<slug>/config.json --data=data --winner=<teamId> [--rival=<teamId>] [--landscape] --out=x.mp4
 * Stand-alone, with ready-made countries:
 *   node tools/promo-video.js --teams=sa,ae,kw,qa,eg,ma --winner=sa --skin=classic --out=promo.mp4
 *
 * Needs a built site, playwright-core (or playwright) + Chromium, and ffmpeg.
 * Install on the VPS once: sudo bash deploy/install-video.sh
 * It runs its own server on a free local port with a temporary copy of the data: your lives are not touched.
 * Progress lines for the panel: "PROGRESS <0-100> <text>".
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const LANDSCAPE = Boolean(args.landscape);
const W = LANDSCAPE ? 1920 : 1080; const H = LANDSCAPE ? 1080 : 1920;
const OUT = path.resolve(String(args.out || 'promo-1m.mp4'));
const TOKEN = 'promo-' + Math.random().toString(36).slice(2);
const progress = (pct, text) => console.log(`PROGRESS ${Math.round(pct)} ${text}`);

const COUNTRIES = {
  sa: ['السعودية', '#006c35', ['saudi', 'ksa', 'السعودية']], ae: ['الإمارات', '#00732f', ['uae', 'الامارات', 'الإمارات']],
  kw: ['الكويت', '#007a3d', ['kuwait', 'الكويت']], qa: ['قطر', '#8a1538', ['qatar', 'قطر']],
  eg: ['مصر', '#c8102e', ['egypt', 'مصر']], ma: ['المغرب', '#c1272d', ['morocco', 'المغرب']],
  dz: ['الجزائر', '#00a651', ['algeria', 'الجزائر']], tn: ['تونس', '#e70013', ['tunisia', 'تونس']],
  iq: ['العراق', '#007a3d', ['iraq', 'العراق']], jo: ['الأردن', '#007a3d', ['jordan', 'الأردن']],
  om: ['عُمان', '#db161b', ['oman', 'عمان']], bh: ['البحرين', '#ce1126', ['bahrain', 'البحرين']],
};
// Gifts used by the story (value = diamonds). Pictures come from the real catalog when it has them, else from the emoji.
const GIFTS = [
  [9001, 'Rose', 1, '🌹'], [9002, 'Falcon', 10999, '🦅'], [9003, 'Perfume', 20, '🧴'], [9004, 'Doughnut', 30, '🍩'],
  [9005, 'Ice Cream Cone', 1, '🍦'], [9006, 'Heart Me', 1, '❤️'], [9007, 'Lion', 29999, '🦁'], [9008, 'Universe', 34999, '🌌'],
  [9009, 'Sports Car', 7000, '🏎️'], [9010, 'Money Gun', 500, '💸'], [9011, 'Crown', 1000, '👑'], [9012, 'Rocket', 20000, '🚀'],
  [9013, 'TikTok', 1, '🎵'], [9014, 'Finger Heart', 5, '🫰'], [9015, 'GG', 1, '🎮'],
];
const TEAM_GIFT = ['Rose', 'Heart Me', 'Perfume', 'Doughnut', 'Ice Cream Cone', 'Finger Heart', 'TikTok', 'GG'];
const NAMES = ['أبو فهد', 'Noura.ae', 'سلطان', 'Khalid_99', 'ريم', 'Mansour', 'شهد', 'Fahad.ksa', 'Mariam', 'عبدالله', 'Yousef', 'Hessa', 'سارة', 'Omar', 'Lulwa', 'نايف'];

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** playwright-core (preferred) or playwright, and a Chromium to run. */
function loadBrowser() {
  let pw = null;
  for (const m of ['playwright-core', 'playwright']) { try { pw = require(m); break; } catch { /* next */ } }
  if (!pw) throw new Error('playwright-core غير مثبت. شغّل: sudo bash deploy/install-video.sh');
  const tries = [process.env.CHROMIUM_PATH];
  try { tries.push(pw.chromium.executablePath()); } catch { /* not downloaded */ }
  tries.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium');
  const exe = tries.find((p) => p && fs.existsSync(p));
  if (!exe) throw new Error('Chromium غير موجود. شغّل: sudo bash deploy/install-video.sh');
  return { chromium: pw.chromium, launch: (o = {}) => pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'], ...o }) };
}

async function emojiPngs(launch, dir, list) {
  if (!list.length) return;
  const b = await launch(); const p = await b.newPage({ viewport: { width: 160, height: 160 } });
  for (const [id, , , emoji] of list) {
    await p.setContent(`<html><body style="margin:0;background:transparent;display:grid;place-items:center;height:160px;font:120px 'Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji'">${emoji}</body></html>`);
    await p.screenshot({ path: path.join(dir, `${id}.png`), omitBackground: true });
  }
  await b.close();
}

/** Builds the temporary data folder. Returns { teams, value } for the story. */
function prepareData(dir) {
  const imgDir = path.join(dir, 'gift-images'); fs.mkdirSync(imgDir, { recursive: true });
  // Real gift catalog (with its cached pictures) when run for a live.
  const src = args.data ? path.resolve(String(args.data)) : null;
  const real = (src && readJson(path.join(src, 'gifts.json'))) || [];
  const realByName = new Map();
  for (const g of real) {
    if (!g || !g.name) continue;
    const file = typeof g.local === 'string' ? path.basename(g.local) : '';
    if (file && fs.existsSync(path.join(src, 'gift-images', file))) fs.copyFileSync(path.join(src, 'gift-images', file), path.join(imgDir, file));
    else g.local = '';
    realByName.set(String(g.name).toLowerCase(), g);
  }
  if (src && fs.existsSync(path.join(src, 'uploads'))) { try { fs.symlinkSync(path.join(src, 'uploads'), path.join(dir, 'uploads'), 'dir'); } catch { /* copy not needed */ } }
  const missing = GIFTS.filter(([, name]) => !realByName.get(name.toLowerCase())?.local);
  const catalog = [...real.filter((g) => g && g.name), ...missing.map(([id, name, diamonds]) => ({ id, name, diamonds, remote: '', local: `/gift-img/${id}.png` }))];
  fs.writeFileSync(path.join(dir, 'gifts.json'), JSON.stringify(catalog));
  const value = Object.fromEntries(GIFTS.map(([, n, d]) => [n, d]));
  for (const g of real) if (g && g.name && Number(g.diamonds) > 0) value[g.name] = Number(g.diamonds);

  let config;
  if (args.config) {
    config = readJson(path.resolve(String(args.config)));
    if (!config || !Array.isArray(config.teams) || config.teams.length < 2) throw new Error('يحتاج البث إلى فريقين على الأقل');
    const th = config.theme || (config.theme = {});
    // A video has nothing behind the overlay: show the look's background unless a picture is on.
    if (!(th.bgOnOverlay && th.bgImage)) th.sceneOnOverlay = true;
    // No TikTok buttons on top of a video: use the screen from higher up.
    th.vertical = { ...(th.vertical || {}), top: Math.min(Number(th.vertical?.top ?? 170), 90), toastsTop: Math.max(Number(th.vertical?.toastsTop ?? 1080), 1320) };
    config.goal = { ...(config.goal || {}), enabled: true, target: 1000000 };
    config.tts = { ...(config.tts || {}), enabled: false };
    config.rounds = { ...(config.rounds || {}), showTimer: true, autoReset: false, autoRestart: false, celebrateSec: 12 };
  } else {
    const codes = String(args.teams || 'sa,ae,kw,qa,eg,ma').split(',').map((c) => c.trim().toLowerCase()).filter((c) => COUNTRIES[c]);
    if (codes.length < 2) throw new Error('--teams needs at least 2 of: ' + Object.keys(COUNTRIES).join(','));
    config = {
      title: String(args.title || 'تحدي المليون'), subtitle: 'اكتب اسم دولتك في الشات وأرسل هديتها!', category: 'الدول',
      teams: codes.map((c, i) => ({ id: c, name: COUNTRIES[c][0], emoji: '', image: `/flags/${c}.svg`, color: COUNTRIES[c][1], keywords: COUNTRIES[c][2], gifts: [TEAM_GIFT[i % TEAM_GIFT.length]] })),
      goal: { enabled: true, target: 1000000, label: 'الهدف: مليون نقطة' }, social: { followGoal: { enabled: false } },
      rounds: { durationMin: 1, showTimer: true, celebrateSec: 12, autoReset: false },
      theme: {
        skin: String(args.skin || 'classic'), sceneOnOverlay: true, giftStrip: true, showContributors: true, contributorsCount: 3, maxVisible: Math.min(codes.length, 6),
        strip: { mode: 'scroll', pos: 'top', offset: 14, speed: 70 },
        vertical: { top: 70, side: 28, scale: 1, maxVisible: Math.min(codes.length, 6), showHeader: true, showToasts: true, toastsTop: 1330, showTicker: false },
      },
    };
  }
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  return { teams: config.teams, value, missing };
}

/** The story: warm-up, rival takes the lead, winner answers, rival strikes back, rockets, winner crosses 1,000,000. */
function timeline(ids, winner, rival, teamGift) {
  const ev = []; let t = 1.2; const others = ids.filter((c) => c !== winner && c !== rival);
  const pick = (i) => (others.length ? others[i % others.length] : ids[i % ids.length]);
  const nick = (i) => NAMES[i % NAMES.length];
  const add = (dt, c, g, n, i) => { ev.push([t, c, g, n, nick(i)]); t += dt; };
  const warm = Math.min(14, Math.max(ids.length, 8));
  for (let i = 0; i < warm; i++) { const c = ids[i % ids.length]; add(0.35, c, teamGift(c), 5 + ((i * 7) % 30), i); }
  for (let i = 0; i < 16; i++) add(0.45, ids[(i * 5) % ids.length], ['Money Gun', 'Crown', 'Sports Car'][i % 3], 2 + (i % 3), i + 3);
  add(1.3, rival, 'Lion', 3, 5); add(1.3, rival, 'Rocket', 2, 6);
  for (let i = 0; i < 6; i++) add(0.5, pick(i), ['Sports Car', 'Crown'][i % 2], 2 + (i % 3), i + 7);
  add(1.5, winner, 'Universe', 4, 0); add(1.1, winner, 'Falcon', 3, 9);
  add(1.5, rival, 'Universe', 3, 1);
  for (let i = 0; i < 6; i++) add(0.6, i % 2 ? pick(i) : (i % 4 ? rival : winner), 'Rocket', 1 + (i % 2), i + 10);
  return { ev, t };
}

/** Records the page with the DevTools screencast, piping JPEG frames into ffmpeg (constant 30 fps). */
async function startRecording(page, file) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-use_wallclock_as_timestamps', '1', '-c:v', 'mjpeg', '-i', '-',
    '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg: ' + (err.trim() || code))))); });
  const cdp = await page.context().newCDPSession(page);
  let frames = 0;
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    frames++; if (ff.stdin.writable) ff.stdin.write(Buffer.from(data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  return {
    stop: async () => { await cdp.send('Page.stopScreencast').catch(() => {}); ff.stdin.end(); await done; return frames; },
  };
}

/** --check: what is installed (for the panel). */
function check() {
  const r = { playwright: false, chromium: false, ffmpeg: false };
  try { loadBrowser(); r.playwright = true; r.chromium = true; } catch (e) { r.playwright = !/playwright-core/.test(e.message); }
  try { require('child_process').execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); r.ffmpeg = true; } catch { /* missing */ }
  console.log(JSON.stringify(r));
}

(async () => {
  if (args.check) return check();
  if (!fs.existsSync(path.join(ROOT, 'web', 'out', 'index.html'))) throw new Error('الواجهة غير مبنية: npm run build');
  const { launch } = loadBrowser();
  progress(2, 'تجهيز البيانات');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koydam-promo-'));
  let srv = null;
  try {
    const { teams, value, missing } = prepareData(dir);
    await emojiPngs(launch, path.join(dir, 'gift-images'), missing);
    const ids = teams.map((t) => String(t.id || '')).filter(Boolean);
    // Team ids in a live config are already final; stand-alone teams are country codes.
    const winner = ids.includes(String(args.winner)) ? String(args.winner) : ids[0];
    const rival = ids.includes(String(args.rival)) && String(args.rival) !== winner ? String(args.rival) : ids.find((c) => c !== winner);
    const teamGift = (id) => {
      const t = teams.find((x) => String(x.id) === id); const g = t && t.gifts && t.gifts[0];
      return g && (value[g] ?? 1) <= 100 ? g : 'Rose';
    };

    progress(8, 'تشغيل خادم مؤقت');
    const port = await freePort();
    srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ADMIN_PASSWORD: 'promo-' + TOKEN, ADMIN_EMAIL: 'promo@example.com', TIKTOK_USERNAME: '', DEMO: '' },
      stdio: 'ignore',
    });
    let ws = null;
    for (let i = 0; i < 40 && !ws; i++) {
      await sleep(300);
      ws = await new Promise((res) => { const s = new WebSocket(`ws://127.0.0.1:${port}/?live=main`); s.once('open', () => res(s)); s.once('error', () => res(null)); });
    }
    if (!ws) throw new Error('تعذر تشغيل الخادم المؤقت');
    let n = 0; const cmd = (action, payload = {}) => ws.send(JSON.stringify({ type: 'cmd', action, payload, token: TOKEN, reqId: ++n }));
    cmd('reset', { keepAllegiance: false });

    progress(12, 'فتح الواجهة');
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`http://127.0.0.1:${port}/${LANDSCAPE ? 'overlay' : 'overlay-vertical'}/`);
    await page.waitForSelector('.card', { timeout: 20000 });
    await sleep(1200);
    const rec = await startRecording(page, OUT);
    await sleep(700);
    cmd('roundStart', { durationMin: 1 });

    const { ev, t: end } = timeline(ids, winner, rival, teamGift);
    let total = 0; const score = Object.fromEntries(ids.map((c) => [c, 0])); const start = Date.now();
    for (const [at, team, gift, count, nickname] of ev) {
      const wait = at * 1000 - (Date.now() - start); if (wait > 0) await sleep(wait);
      const v = value[gift] ?? 1;
      cmd('simulateGift', { teamId: team, giftName: gift, count, nickname, diamonds: v });
      total += v * count; score[team] += v * count;
      progress(15 + (70 * at) / (end + 12), 'تسجيل السباق');
    }
    const U = value.Universe || 34999;
    const best = Math.max(...ids.filter((c) => c !== winner).map((c) => score[c]));
    const need = Math.max(1, Math.ceil((1000000 - total) / U), Math.ceil((best - score[winner]) / U) + 1);
    await sleep(1200); cmd('simulateGift', { teamId: winner, giftName: 'Universe', count: need, nickname: NAMES[0], diamonds: U });
    total += need * U;
    progress(86, 'لحظة الفوز');
    await sleep(3500); cmd('roundEnd');
    await sleep(7500);
    progress(92, 'ترميز الفيديو');
    const frames = await rec.stop();
    await browser.close(); ws.close();
    if (frames < 30) throw new Error('لم يُسجَّل أي إطار');
    const name = (teams.find((t) => String(t.id) === winner) || {}).name || winner;
    progress(100, 'تم');
    console.log(`DONE ${JSON.stringify({ file: OUT, width: W, height: H, total, winner, winnerName: name, seconds: Math.round(end + 13) })}`);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error('ERROR ' + (e.message || e)); process.exit(1); });
