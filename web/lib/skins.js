'use client';
/**
 * Visual "looks" for the live page and the OBS overlay.
 * The ids must match SKIN_IDS in server/index.js. Styles live in styles/skins.css.
 * With rotation on, every screen picks the same look from today's date, so
 * the look changes by itself each day or each week (Monday).
 */
import { useEffect, useState } from 'react';

export const SKINS = [
  { id: 'classic', name: 'الذهبي الكلاسيكي', desc: 'ذهبي وأحمر بألوان الشعار', colors: ['#f5b301', '#c8102e', '#0b0a0f'] },
  { id: 'neon', name: 'نيون', desc: 'توهج سماوي ووردي ليلي', colors: ['#00e5ff', '#ff2bd6', '#05040d'] },
  { id: 'stadium', name: 'الملعب', desc: 'عشب أخضر ولوحة نتائج', colors: ['#ffe14d', '#e63946', '#0b3d1e'] },
  { id: 'desert', name: 'الصحراء', desc: 'رمال دافئة وغروب', colors: ['#f4a259', '#b5541c', '#24120a'] },
  { id: 'ramadan', name: 'ليالي رمضان', desc: 'أزرق ليلي وهلال ذهبي', colors: ['#f2c14e', '#3a5bd9', '#0b1437'] },
  { id: 'frost', name: 'الأبيض الزجاجي', desc: 'فاتح ونظيف بنص داكن', colors: ['#2563eb', '#e11d48', '#eef2f7'] },
  { id: 'inferno', name: 'اللهب', desc: 'برتقالي وأحمر ناري', colors: ['#ff9f1c', '#e63946', '#160404'] },
  { id: 'emerald', name: 'الزمرد', desc: 'أخضر ملكي مع ذهبي', colors: ['#e9c46a', '#0f8b5f', '#03140e'] },
  { id: 'royal', name: 'البنفسجي الملكي', desc: 'بنفسجي فاخر وذهبي', colors: ['#ffcf5c', '#7b2cbf', '#12051f'] },
  { id: 'ocean', name: 'المحيط', desc: 'أزرق سماوي وفيروزي', colors: ['#4cc9f0', '#4361ee', '#031022'] },
  { id: 'retro', name: 'ريترو أركيد', desc: 'ألعاب الثمانينات بزوايا حادة', colors: ['#ffe600', '#ff004d', '#0d0221'] },
];
export const SKIN_IDS = SKINS.map((s) => s.id);
export const skinName = (id) => SKINS.find((s) => s.id === id)?.name || id;

/** Which look is active right now (rotation uses the viewer's local date). */
export function activeSkin(theme, now = new Date()) {
  const base = SKIN_IDS.includes(theme?.skin) ? theme.skin : 'classic';
  const rot = theme?.skinRotation;
  if (!rot || rot.mode === 'off') return base;
  const list = (rot.skins || []).filter((x) => SKIN_IDS.includes(x));
  const pool = list.length ? list : SKIN_IDS;
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
  const idx = rot.mode === 'daily' ? day : Math.floor((day + 3) / 7); // weeks start on Monday
  return pool[((idx % pool.length) + pool.length) % pool.length];
}

/** Active look, re-checked every minute (rotation happens at midnight). */
export function useActiveSkin(theme) {
  const [skin, setSkin] = useState(() => activeSkin(theme));
  useEffect(() => {
    setSkin(activeSkin(theme));
    const t = setInterval(() => setSkin(activeSkin(theme)), 60000);
    return () => clearInterval(t);
  }, [theme?.skin, theme?.skinRotation?.mode, (theme?.skinRotation?.skins || []).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return skin;
}
