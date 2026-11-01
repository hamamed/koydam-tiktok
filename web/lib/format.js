const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Short numbers for the stream: 950 · 1.2K · 28.4K · 184K · 1.03M · 12.5M · 1.2B.
 * Truncated, never rounded up: 999,999 shows 999K (not a 1M that was not reached yet).
 */
const cut = (v, d) => { const f = 10 ** d; const t = (Math.floor(v * f) / f).toFixed(d); return d ? t.replace(/\.?0+$/, '') : t; };
export function fmt(n) {
  n = Math.round(Number(n) || 0);
  const a = Math.abs(n); const s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + cut(a / 1e9, a >= 1e10 ? 1 : 2) + 'B';
  if (a >= 1e6) return s + cut(a / 1e6, a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e5) return s + cut(a / 1e3, 0) + 'K';
  if (a >= 1e3) return s + cut(a / 1e3, 1) + 'K';
  return String(n);
}
export const fmtFull = (n) => nf.format(Math.round(Number(n) || 0));
/** Allowed image URLs: https:// or files uploaded in the panel (/uploads/<hash>.<ext>). */
export const safeUrl = (u) => {
  const s = String(u || '');
  return /^https?:\/\//i.test(s) || /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/.test(s) || /^\/gift-img\/\d{1,20}\.(png|jpg|webp|gif)$/.test(s) || /^\/flags\/[a-z]{2}(-[a-z0-9]{2,3})?\.svg$/.test(s) ? s : '';
};
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const initial = (name) => ([...String(name || '?').trim()][0] || '?').toUpperCase();

const fontStack = (f) => `${f && f !== 'Cairo' ? `'${f}', ` : ''}'Cairo', 'Segoe UI', system-ui, sans-serif`;
/** Font variables: main font + display font (titles, team names, banner). */
export function fontVars(th = {}) {
  return { '--font': fontStack(th.fontFamily), '--title-font': fontStack(th.titleFont || th.fontFamily) };
}

/** Theme -> CSS variables for the overlay / live board. */
export function themeVars(th = {}) {
  const vars = {
    '--accent': th.accent || '#f5b301',
    '--glass-a': th.glassOpacity ?? 0.32,
    '--blur': `${th.blur ?? 16}px`,
    '--radius': `${th.radius ?? 22}px`,
    '--fs': th.fontScale ?? 1,
    '--panel-w': `${th.width ?? 620}px`,
    ...fontVars(th),
    '--name-g': th.nameScale ?? 1,
    '--flag-scale': th.flagScale ?? 1,
  };
  // White is the default: leave it to the look (light looks use dark text).
  if (th.textColor && th.textColor.toLowerCase() !== '#ffffff' && th.textColor.toLowerCase() !== '#fff') vars['--text'] = th.textColor;
  return vars;
}

/** Loads a Google font once if the theme asks for one that is not bundled. */
import { BUNDLED_FONTS } from './fonts';
const loadedFonts = new Set(BUNDLED_FONTS);
export function ensureFont(family) {
  if (typeof document === 'undefined' || !family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700;800;900&display=swap`;
  document.head.appendChild(l);
}

/**
 * Parts of the OBS header card and the team cards that can be hidden (theme.parts)
 * and resized (theme.sizes). Applied with data-hide + CSS variables (see board.css / overlay.css).
 * Keep in sync with PART_KEYS / SIZE_KEYS in server/index.js.
 */
export const PART_KEYS = ['title', 'subtitle', 'category', 'points', 'goal', 'followGoal', 'rank', 'flag', 'crown', 'medal', 'name', 'share', 'bar', 'score', 'pts', 'gap'];
export const SIZE_KEYS = ['title', 'subtitle', 'chips', 'goal', 'legend', 'score', 'share', 'contribs', 'rank', 'gifts', 'gap', 'strip'];
export function partsProps(th = {}) {
  const p = th.parts || {};
  const s = th.sizes || {};
  const style = {};
  for (const k of SIZE_KEYS) if (s[k] && s[k] !== 1) style[`--sz-${k}`] = s[k];
  return { 'data-hide': PART_KEYS.filter((k) => p[k] === false).join(' ') || undefined, style };
}
