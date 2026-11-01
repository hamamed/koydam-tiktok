'use client';
/**
 * Dashboard look for this browser: light / dark / auto, font and text size.
 * Saved in localStorage and applied on <html> (see the light theme in styles/admin.css).
 */
import { useEffect, useState } from 'react';
import { BUNDLED_FONTS } from './fonts';

const KEY = 'koydam.admin.prefs';
export const ADMIN_SIZES = [[0.86, 'صغير'], [0.93, 'متوسط'], [1, 'عادي'], [1.08, 'كبير']];
export const DEFAULT_PREFS = { theme: 'dark', font: 'Cairo', size: 0.93 };

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      theme: ['dark', 'light', 'auto'].includes(p.theme) ? p.theme : DEFAULT_PREFS.theme,
      font: BUNDLED_FONTS.has(p.font) ? p.font : DEFAULT_PREFS.font,
      size: ADMIN_SIZES.some(([v]) => v === p.size) ? p.size : DEFAULT_PREFS.size,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

const systemLight = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
export function applyPrefs(p) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.dataset.adminTheme = p.theme === 'auto' ? (systemLight() ? 'light' : 'dark') : p.theme;
  el.style.setProperty('--a-font', `'${p.font}', 'Cairo', system-ui, sans-serif`);
  el.style.setProperty('--a-fs', String(p.size));
}

/** [prefs, update(patch)] — applies and saves on every change; follows the OS in "auto". */
export function useAdminPrefs() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  useEffect(() => { const p = loadPrefs(); setPrefs(p); applyPrefs(p); }, []);
  useEffect(() => {
    if (prefs.theme !== 'auto' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => applyPrefs(prefs);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [prefs]);
  const update = (patch) => setPrefs((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
    applyPrefs(next);
    // other mounted hooks (top bar button / account page) stay in sync
    window.dispatchEvent(new CustomEvent('koydam-admin-prefs', { detail: next }));
    return next;
  });
  useEffect(() => {
    const on = (e) => setPrefs(e.detail);
    window.addEventListener('koydam-admin-prefs', on);
    return () => window.removeEventListener('koydam-admin-prefs', on);
  }, []);
  return [prefs, update];
}
