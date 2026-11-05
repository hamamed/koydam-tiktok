/**
 * Per-game display settings (config.game.ui[mode]): texts you can change or empty to hide,
 * and what shows around the game. Empty text = hidden. Defaults below.
 */
import { isSafe, safeText } from './format';

export const GAME_UI_DEFAULTS = {
  cup: { label: 'كأس العرب', waitTitle: 'كأس العرب', waitSub: 'المباريات تبدأ قريباً، جهّز دولتك!', champ: 'بطل كأس العرب', hint: 'كل {n} نقطة = هدف' },
  arena: { label: 'حلبة الدول', waitTitle: 'حلبة الدول', waitSub: 'أرسل هدية دولتك لتهاجم، آخر دولة تبقى تفوز!', champ: 'بطل الحلبة', hint: '' },
  tug: { label: 'شد الحبل', waitTitle: 'شد الحبل', waitSub: 'دولتان، حبل واحد. كل هدية تسحب الحبل نحو دولتك!', champ: '', hint: 'اسحب الحبل {n} نقطة نحو دولتك لتفوز' },
  horses: { label: 'سباق الخيول', waitTitle: 'سباق الخيول', waitSub: 'أول خيل يعبر خط النهاية يفوز!', champ: 'بطل سباق الخيول', hint: 'المسافة {n}' },
  rockets: { label: 'سباق الصواريخ', waitTitle: 'سباق الصواريخ', waitSub: 'أول صاروخ يصل القمر يفوز!', champ: 'وصل إلى القمر أولاً!', hint: 'المسافة {n}' },
  castle: { label: 'حماية العاصمة', waitTitle: 'حماية العاصمة', waitSub: 'ابنِ أسوار عاصمتك بالهدايا واهدم أسوار الخصوم!', champ: 'عاصمتها صمدت حتى النهاية', hint: 'هداياك تبني سور دولتك وتهدم أعلى سور عند الخصوم' },
};
/** Around the game (same for every game, saved per game). */
export const GAME_FRAME_DEFAULTS = { showHeader: true, headerTitle: '', showSub: true, headerSub: '', showGoal: false, showStrip: true, showIcon: true, showSend: true };

/** TikTok-safe mode: neutral texts that describe the game without asking for gifts. */
const SAFE_UI = {
  arena: { waitSub: 'آخر دولة تبقى في الحلبة تفوز!' },
  tug: { waitSub: 'دولتان، حبل واحد. من يسحب الحبل نحوه يفوز!' },
  castle: { waitSub: 'احمِ أسوار عاصمتك، آخر عاصمة صامدة تفوز!', hint: 'نقاط دولتك تبني سورها وتهدم أسوار الخصوم' },
};
const TEXT_KEYS = ['label', 'waitTitle', 'waitSub', 'champ', 'hint', 'headerTitle', 'headerSub'];

export function gameUi(config, mode) {
  const saved = config?.game?.ui?.[mode] || {};
  const safe = isSafe(config);
  const out = { ...GAME_FRAME_DEFAULTS, ...(GAME_UI_DEFAULTS[mode] || {}), ...(safe ? SAFE_UI[mode] : null) };
  for (const [k, v] of Object.entries(saved)) if (v !== undefined && v !== null) out[k] = v;
  if (safe) {
    out.showSend = false; out.showStrip = false;
    for (const k of TEXT_KEYS) if (typeof out[k] === 'string') out[k] = safeText(out[k], config);
  }
  return out;
}
/** "كل {n} نقطة" -> "كل 500 نقطة" */
export const fillN = (text, n) => String(text || '').replace('{n}', n);
