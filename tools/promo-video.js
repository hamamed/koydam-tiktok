#!/usr/bin/env node
/**
 * Promo video: records the real vertical OBS overlay (1080x1920) while a scripted
 * gift battle races to 1,000,000 points, then shows the winner screen.
 *
 *   node tools/promo-video.js [--teams=sa,ae,kw,qa,eg,ma] [--winner=sa] [--skin=classic]
 *                             [--title="تحدي المليون"] [--out=promo.mp4] [--landscape]
 *
 * Needs: a built site (npm run build), Playwright with Chromium (npm i -D playwright &&
 * npx playwright install chromium) and ffmpeg. Runs its own server on a free port with a
 * temporary data folder: nothing in data/ is touched.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const LANDSCAPE = Boolean(args.landscape);
const W = LANDSCAPE ? 1920 : 1080; const H = LANDSCAPE ? 1080 : 1920;
const OUT = path.resolve(String(args.out || 'promo-1m.mp4'));
const TOKEN = 'promo-' + Math.random().toString(36).slice(2);

const COUNTRIES = {
  sa: ['السعودية', '#006c35', ['saudi', 'ksa', 'السعودية']], ae: ['الإمارات', '#00732f', ['uae', 'الامارات', 'الإمارات']],
  kw: ['الكويت', '#007a3d', ['kuwait', 'الكويت']], qa: ['قطر', '#8a1538', ['qatar', 'قطر']],
  eg: ['مصر', '#c8102e', ['egypt', 'مصر']], ma: ['المغرب', '#c1272d', ['morocco', 'المغرب']],
  dz: ['الجزائر', '#00a651', ['algeria', 'الجزائر']], tn: ['تونس', '#e70013', ['tunisia', 'تونس']],
  iq: ['العراق', '#007a3d', ['iraq', 'العراق']], jo: ['الأردن', '#007a3d', ['jordan', 'الأردن']],
  om: ['عُمان', '#db161b', ['oman', 'عمان']], bh: ['البحرين', '#ce1126', ['bahrain', 'البحرين']],
};
// Gift catalog for the video (emoji pictures; real TikTok pictures need TikTok's CDN).
const GIFTS = [
  [9001, 'Rose', 1, '🌹'], [9002, 'Falcon', 10999, '🦅'], [9003, 'Perfume', 20, '🧴'], [9004, 'Doughnut', 30, '🍩'],
  [9005, 'Ice Cream Cone', 1, '🍦'], [9006, 'Heart Me', 1, '❤️'], [9007, 'Lion', 29999, '🦁'], [9008, 'Universe', 34999, '🌌'],
  [9009, 'Sports Car', 7000, '🏎️'], [9010, 'Money Gun', 500, '💸'], [9011, 'Crown', 1000, '👑'], [9012, 'Rocket', 20000, '🚀'],
  [9013, 'TikTok', 1, '🎵'], [9014, 'Finger Heart', 5, '🫰'], [9015, 'GG', 1, '🎮'],
];
// Each team's own (cheap) gift, shown as «أرسل 🌹» on its card.
const TEAM_GIFT = ['Rose', 'Heart Me', 'Perfume', 'Doughnut', 'Ice Cream Cone', 'Finger Heart', 'TikTok', 'GG'];
const NAMES = ['أبو فهد', 'Noura.ae', 'سلطان', 'Khalid_99', 'ريم', 'Mansour', 'شهد', 'Fahad.ksa', 'Mariam', 'عبدالله', 'Yousef', 'Hessa', 'سارة', 'Omar', 'Lulwa', 'نايف'];

const codes = String(args.teams || 'sa,ae,kw,qa,eg,ma').split(',').map((c) => c.trim().toLowerCase()).filter((c) => COUNTRIES[c]);
if (codes.length < 2) throw new Error('--teams needs at least 2 of: ' + Object.keys(COUNTRIES).join(','));
const winner = codes.includes(String(args.winner)) ? String(args.winner) : codes[0];
const rival = codes.find((c) => c !== winner);

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function emojiPngs(chromium, dir) {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 160, height: 160 } });
  for (const [id, , , emoji] of GIFTS) {
    await p.setContent(`<html><body style="margin:0;background:transparent;display:grid;place-items:center;height:160px;font:120px 'Noto Color Emoji','Apple Color Emoji','Segoe UI Emoji'">${emoji}</body></html>`);
    await p.screenshot({ path: path.join(dir, `${id}.png`), omitBackground: true });
  }
  await b.close();
}

function writeData(dir) {
  fs.mkdirSync(path.join(dir, 'gift-images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'gifts.json'), JSON.stringify(GIFTS.map(([id, name, diamonds]) => ({ id, name, diamonds, remote: '', local: `/gift-img/${id}.png` }))));
  const teams = codes.map((c, i) => ({ id: c, name: COUNTRIES[c][0], emoji: '', image: `/flags/${c}.svg`, color: COUNTRIES[c][1], keywords: COUNTRIES[c][2], gifts: [TEAM_GIFT[i % TEAM_GIFT.length]] }));
  const config = {
    title: String(args.title || 'تحدي المليون'), subtitle: 'اكتب اسم دولتك في الشات وأرسل هديتها!', category: 'الدول',
    teams, goal: { enabled: true, target: 1000000, label: 'الهدف: مليون نقطة' },
    social: { followGoal: { enabled: false } },
    rounds: { durationMin: 1, showTimer: true, celebrateSec: 12, autoReset: false },
    alerts: { majorThreshold: 5000, confettiOnTakeover: true },
    theme: {
      skin: String(args.skin || 'classic'), sceneOnOverlay: true, giftStrip: true, showContributors: true, contributorsCount: 3,
      maxVisible: Math.min(codes.length, 6), showTicker: true,
      strip: { mode: 'scroll', pos: 'top', offset: 14, speed: 70 },
      vertical: { top: 70, side: 28, scale: 1, maxVisible: Math.min(codes.length, 6), showHeader: true, showToasts: true, toastsTop: 1330, showTicker: false },
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
}

/**
 * The race, with a story: everybody warms up, the rival takes the lead with lions,
 * the winner answers with Universe, the rival strikes back, rockets fly everywhere,
 * and the winner crosses 1,000,000 at the end. [secondsFromStart, team, gift, count, nickname]
 */
function timeline() {
  const ev = []; let t = 1.2; const others = codes.filter((c) => c !== winner && c !== rival);
  const pick = (i) => (others.length ? others[i % others.length] : codes[i % codes.length]);
  const tg = (c) => TEAM_GIFT[codes.indexOf(c) % TEAM_GIFT.length];
  const nick = (i) => NAMES[i % NAMES.length];
  const add = (dt, c, g, n, i) => { ev.push([t, c, g, n, nick(i)]); t += dt; };
  for (let i = 0; i < 14; i++) { const c = codes[i % codes.length]; add(0.35, c, tg(c), 5 + ((i * 7) % 30), i); }          // warm-up
  for (let i = 0; i < 16; i++) add(0.45, codes[(i * 5) % codes.length], ['Money Gun', 'Crown', 'Sports Car'][i % 3], 2 + (i % 3), i + 3); // climb (~110k)
  add(1.3, rival, 'Lion', 3, 5); add(1.3, rival, 'Rocket', 2, 6);                                                          // rival leads (+130k)
  for (let i = 0; i < 6; i++) add(0.5, pick(i), ['Sports Car', 'Crown'][i % 2], 2 + (i % 3), i + 7);                      // others (~40k)
  add(1.5, winner, 'Universe', 4, 0); add(1.1, winner, 'Falcon', 3, 9);                                                    // winner answers (+173k)
  add(1.5, rival, 'Universe', 3, 1);                                                                                        // rival back on top (+105k)
  for (let i = 0; i < 6; i++) add(0.6, i % 2 ? pick(i) : (i % 4 ? rival : winner), 'Rocket', 1 + (i % 2), i + 10);        // rockets (~180k)
  return { ev, t };
}

(async () => {
  const { chromium } = require('playwright');
  if (!fs.existsSync(path.join(ROOT, 'web', 'out', 'index.html'))) throw new Error('Build the site first: npm run build');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koydam-promo-'));
  const vidDir = path.join(dir, 'video');
  writeData(dir); await emojiPngs(chromium, path.join(dir, 'gift-images'));
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_TOKEN: TOKEN, ADMIN_PASSWORD: 'promo-' + TOKEN, ADMIN_EMAIL: 'promo@example.com' }, stdio: 'ignore',
  });
  try {
    await sleep(2500);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?live=main`);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    let n = 0; const cmd = (action, payload = {}) => ws.send(JSON.stringify({ type: 'cmd', action, payload, token: TOKEN, reqId: ++n }));
    cmd('reset');

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: vidDir, size: { width: W, height: H } } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/${LANDSCAPE ? 'overlay' : 'overlay-vertical'}/`);
    await page.waitForSelector('.card', { timeout: 15000 });
    const startedAt = (Date.now() - t0) / 1000; // trimmed from the final video
    await sleep(800);
    cmd('roundStart', { durationMin: 1 });

    const { ev, t: end } = timeline();
    const value = Object.fromEntries(GIFTS.map(([, name, d]) => [name, d]));
    let total = 0; const score = Object.fromEntries(codes.map((c) => [c, 0])); const start = Date.now();
    for (const [at, team, gift, count, nickname] of ev) {
      const wait = at * 1000 - (Date.now() - start); if (wait > 0) await sleep(wait);
      cmd('simulateGift', { teamId: team, giftName: gift, count, nickname, diamonds: value[gift] });
      total += value[gift] * count; score[team] += value[gift] * count;
    }
    // Final push: the winner crosses 1,000,000 (and passes the rival) with a last Universe combo.
    const best = Math.max(...codes.filter((c) => c !== winner).map((c) => score[c]));
    const need = Math.max(1, Math.ceil((1000000 - total) / value.Universe), Math.ceil((best - score[winner]) / value.Universe) + 1);
    await sleep(1200); cmd('simulateGift', { teamId: winner, giftName: 'Universe', count: need, nickname: NAMES[0], diamonds: value.Universe });
    total += need * value.Universe;
    await sleep(3500); cmd('roundEnd');
    await sleep(7000);
    await page.close(); const video = await page.video().path(); await ctx.close(); await browser.close(); ws.close();

    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(startedAt + 0.6), '-i', video,
      '-vf', `fps=30,scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT]);
    console.log(`Video: ${OUT}  (${W}x${H}, total ${total.toLocaleString('en')} points, winner ${COUNTRIES[winner][0]}, ~${Math.round(end + 13)}s)`);
  } finally {
    srv.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
