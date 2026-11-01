/**
 * Arabic voice reading (text-to-speech) for the OBS overlay.
 *
 * Uses Microsoft Edge's neural voices (msedge-tts): natural Arabic, including
 * Saudi, Moroccan, Algerian, Tunisian, Egyptian and Emirati voices. Audio is
 * generated on the server as MP3, cached in data/tts-cache and served from
 * /tts/<hash>.mp3, so OBS captures it like any other sound ("Control audio
 * via OBS"). The browser's built-in speech is NOT captured by OBS, which is
 * why audio files are used instead.
 *
 * Only texts the server builds itself are spoken (templates + viewer names),
 * never arbitrary text from the public. Names are cleaned and XML-escaped
 * because the voice service accepts SSML markup.
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const VOICES = [
  ['ar-SA-HamedNeural', 'حامد (السعودية) ♂'], ['ar-SA-ZariyahNeural', 'زارية (السعودية) ♀'],
  ['ar-MA-JamalNeural', 'جمال (المغرب) ♂'], ['ar-MA-MounaNeural', 'منى (المغرب) ♀'],
  ['ar-DZ-IsmaelNeural', 'إسماعيل (الجزائر) ♂'], ['ar-DZ-AminaNeural', 'أمينة (الجزائر) ♀'],
  ['ar-TN-HediNeural', 'الهادي (تونس) ♂'], ['ar-TN-ReemNeural', 'ريم (تونس) ♀'],
  ['ar-EG-ShakirNeural', 'شاكر (مصر) ♂'], ['ar-EG-SalmaNeural', 'سلمى (مصر) ♀'],
  ['ar-AE-HamdanNeural', 'حمدان (الإمارات) ♂'], ['ar-AE-FatimaNeural', 'فاطمة (الإمارات) ♀'],
  ['ar-KW-FahedNeural', 'فهد (الكويت) ♂'], ['ar-QA-MoazNeural', 'معاذ (قطر) ♂'],
];
const VOICE_IDS = VOICES.map((v) => v[0]);
const TTS_RE = /^\/tts\/[a-f0-9]{24}\.mp3$/;

/** Removes emoji / control characters and limits length, then escapes for SSML. */
function cleanForSpeech(s, max = 160) {
  return String(s || '')
    .replace(/[\p{Extended_Pictographic}‍️⃣]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')          // flag letters
    .replace(/[\u0000-\u001f<>]/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Fills {placeholders} in a template with cleaned values. */
function fillTemplate(tpl, vars) {
  return cleanForSpeech(String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => cleanForSpeech(vars[k] ?? '', 40)), 220);
}

function createTTS({ dir, log }) {
  let lib = null;
  let chain = Promise.resolve();   // one request at a time (the service dislikes parallel sockets)
  let pending = 0;

  async function loadLib() {
    if (lib) return lib;
    try { lib = require('msedge-tts'); } catch (e) { throw new Error(`msedge-tts غير مثبت: ${e.message}`); }
    return lib;
  }

  async function prune() {
    const names = await fsp.readdir(dir).catch(() => []);
    if (names.length <= 400) return;
    const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fsp.stat(path.join(dir, n)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })));
    stats.sort((a, b) => a.t - b.t);
    for (const s of stats.slice(0, stats.length - 400)) await fsp.rm(path.join(dir, s.n), { force: true });
  }

  /** Text -> cached MP3 URL (/tts/<hash>.mp3). Throws on failure. */
  function synth(text, { voice = 'ar-SA-HamedNeural', rate = 0 } = {}) {
    const clean = cleanForSpeech(text, 240);
    if (!clean) return Promise.reject(new Error('نص فارغ'));
    if (!VOICE_IDS.includes(voice)) voice = 'ar-SA-HamedNeural';
    const r = Math.max(-50, Math.min(60, Math.round(Number(rate) || 0)));
    const hash = crypto.createHash('sha256').update(`${voice}|${r}|${clean}`).digest('hex').slice(0, 24);
    const file = path.join(dir, `${hash}.mp3`);
    const url = `/tts/${hash}.mp3`;
    if (fs.existsSync(file)) return Promise.resolve(url);
    if (pending >= 6) return Promise.reject(new Error('قائمة القراءة ممتلئة'));
    pending++;
    const job = chain.then(async () => {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await loadLib();
      const tts = new MsEdgeTTS();
      try {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(xmlEscape(clean), { rate: `${r >= 0 ? '+' : ''}${r}%` });
        const chunks = [];
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('انتهت مهلة خدمة الصوت')), 20000);
          audioStream.on('data', (c) => chunks.push(c));
          audioStream.on('end', () => { clearTimeout(t); resolve(); });
          audioStream.on('close', () => { clearTimeout(t); resolve(); });
          audioStream.on('error', (e) => { clearTimeout(t); reject(e); });
        });
        const buf = Buffer.concat(chunks);
        if (buf.length < 500) throw new Error('لم تُرجع خدمة الصوت أي صوت');
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(file, buf);
        prune().catch(() => {});
        return url;
      } finally {
        try { tts.close(); } catch { /* ignore */ }
      }
    });
    chain = job.catch(() => {}).finally(() => { pending--; });
    return job;
  }

  return { synth, VOICES, VOICE_IDS, TTS_RE, dir };
}

module.exports = { createTTS, fillTemplate, cleanForSpeech, VOICES, VOICE_IDS, TTS_RE };
