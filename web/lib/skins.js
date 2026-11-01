'use client';
/**
 * Visual "looks" for the live page and the OBS overlay.
 * The ids must match SKIN_IDS in server/index.js. Styles live in styles/skins.css.
 * With rotation on, every screen picks the same look from today's date, so
 * the look changes by itself each day or each week (Monday).
 */
import { useEffect, useState } from 'react';

export const SKIN_CATS = [
  ['all', 'الكل'], ['dark', 'داكن'], ['light', 'فاتح'], ['lux', 'فاخر'], ['sport', 'رياضي'],
  ['heritage', 'تراثي ومناسبات'], ['fun', 'ألعاب ومرح'], ['custom', 'مخصص'],
];

// tone: 'light' looks get dark text (see [data-tone="light"] in skins.css).
export const SKINS = [
  { id: 'classic', cat: 'lux', name: 'الذهبي الكلاسيكي', desc: 'ذهبي وأحمر بألوان الشعار' },
  { id: 'neon', cat: 'dark', name: 'نيون', desc: 'توهج سماوي ووردي ليلي' },
  { id: 'stadium', cat: 'sport', name: 'الملعب', desc: 'عشب أخضر ولوحة نتائج' },
  { id: 'desert', cat: 'heritage', name: 'الصحراء', desc: 'رمال دافئة وغروب' },
  { id: 'ramadan', cat: 'heritage', name: 'ليالي رمضان', desc: 'أزرق ليلي وهلال ذهبي' },
  { id: 'frost', cat: 'light', tone: 'light', name: 'الأبيض الزجاجي', desc: 'فاتح ونظيف بنص داكن' },
  { id: 'inferno', cat: 'dark', name: 'اللهب', desc: 'برتقالي وأحمر ناري' },
  { id: 'emerald', cat: 'lux', name: 'الزمرد', desc: 'أخضر ملكي مع ذهبي' },
  { id: 'royal', cat: 'lux', name: 'البنفسجي الملكي', desc: 'بنفسجي فاخر وذهبي' },
  { id: 'ocean', cat: 'dark', name: 'المحيط', desc: 'أزرق سماوي وفيروزي' },
  { id: 'retro', cat: 'fun', name: 'ريترو أركيد', desc: 'ألعاب الثمانينات بزوايا حادة' },
  // ---- v3.1 ----
  { id: 'midnight', cat: 'lux', name: 'منتصف الليل', desc: 'أسود عميق وخطوط ذهبية رفيعة' },
  { id: 'sunset', cat: 'dark', name: 'الغروب', desc: 'وردي وبرتقالي دافئ' },
  { id: 'aurora', cat: 'dark', name: 'الشفق القطبي', desc: 'أخضر وبنفسجي متموج' },
  { id: 'cyber', cat: 'fun', name: 'سايبربنك', desc: 'أصفر حاد وسماوي بزوايا مقصوصة' },
  { id: 'galaxy', cat: 'dark', name: 'المجرة', desc: 'نجوم وسديم بنفسجي' },
  { id: 'matrix', cat: 'fun', name: 'الماتريكس', desc: 'أخضر شاشة الأوامر' },
  { id: 'carbon', cat: 'sport', name: 'كربون', desc: 'ألياف رمادية وأحمر سباقات' },
  { id: 'glacier', cat: 'dark', name: 'الجليد', desc: 'أزرق بارد ولمعة ثلجية' },
  { id: 'storm', cat: 'dark', name: 'العاصفة', desc: 'رمادي داكن وبرق كهربائي' },
  { id: 'bloodmoon', cat: 'dark', name: 'القمر الأحمر', desc: 'قرمزي غامق وأسود' },
  { id: 'rosegold', cat: 'lux', name: 'الذهب الوردي', desc: 'وردي نحاسي ناعم' },
  { id: 'sapphire', cat: 'lux', name: 'الياقوت الأزرق', desc: 'أزرق ملكي وفضي' },
  { id: 'copper', cat: 'lux', name: 'النحاس', desc: 'نحاسي معدني وبني' },
  { id: 'pharaoh', cat: 'heritage', name: 'الفراعنة', desc: 'ذهب ولازورد' },
  { id: 'andalus', cat: 'heritage', name: 'الأندلس', desc: 'زليج فيروزي ونقوش' },
  { id: 'majlis', cat: 'heritage', name: 'المجلس', desc: 'عنابي وبني ونقش السدو' },
  { id: 'eid', cat: 'heritage', name: 'العيد', desc: 'أخضر وذهبي احتفالي' },
  { id: 'national', cat: 'heritage', name: 'اليوم الوطني', desc: 'أخضر وأبيض بفخر' },
  { id: 'wedding', cat: 'light', tone: 'light', name: 'الأفراح', desc: 'أبيض عاجي وذهبي' },
  { id: 'champions', cat: 'sport', name: 'الأبطال', desc: 'كحلي ونجوم فضية' },
  { id: 'derby', cat: 'sport', name: 'الديربي', desc: 'أحمر ضد أزرق' },
  { id: 'arena', cat: 'sport', name: 'الحلبة', desc: 'أحمر وأسود وأضواء قوية' },
  { id: 'forest', cat: 'dark', name: 'الغابة', desc: 'أخضر داكن وخشبي' },
  { id: 'sakura', cat: 'light', tone: 'light', name: 'ساكورا', desc: 'وردي فاتح كزهر الكرز' },
  { id: 'mint', cat: 'light', tone: 'light', name: 'النعناع', desc: 'أخضر فاتح منعش' },
  { id: 'paper', cat: 'light', tone: 'light', name: 'الورق', desc: 'كريمي بحبر داكن' },
  { id: 'clean', cat: 'light', tone: 'light', name: 'أبيض بسيط', desc: 'مسطح بلا توهج' },
  { id: 'mono', cat: 'dark', name: 'أسود بسيط', desc: 'مسطح بالأبيض والأسود' },
  { id: 'vapor', cat: 'fun', name: 'فيبرويف', desc: 'وردي وبنفسجي وشبكة' },
  { id: 'gameboy', cat: 'fun', name: 'جيم بوي', desc: 'أربع درجات من الأخضر' },
  { id: 'comic', cat: 'fun', name: 'كوميك', desc: 'خطوط سوداء عريضة ونقاط' },
  { id: 'candy', cat: 'fun', name: 'الحلوى', desc: 'ألوان مرحة زاهية' },
  { id: 'holo', cat: 'fun', name: 'هولوغرام', desc: 'ألوان قزحية لامعة' },
  { id: 'custom', cat: 'custom', name: 'تصميمي الخاص', desc: 'ألوانك أنت: اختر 3 ألوان' },
];
export const SKIN_IDS = SKINS.map((s) => s.id);
export const skinName = (id) => SKINS.find((s) => s.id === id)?.name || id;
/** 'light' or 'dark' (the custom look takes it from the theme). */
export const skinTone = (id, theme) => (id === 'custom' ? (theme?.custom?.tone === 'light' ? 'light' : 'dark') : SKINS.find((s) => s.id === id)?.tone || 'dark');

const hexRgb = (h) => {
  let x = String(h || '').replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x.slice(0, 6), 16);
  return Number.isNaN(n) ? '11, 10, 15' : `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};
/** CSS variables for the custom look and the logo size; spread on the root element. */
export function skinVars(th = {}) {
  const c = th.custom || {};
  return {
    '--c1': c.primary || '#f5b301', '--c2': c.secondary || '#c8102e', '--c3': c.bg || '#0b0a0f',
    '--c3-rgb': hexRgb(c.bg || '#0b0a0f'), '--logo-s': th.logoSize ?? 1,
  };
}

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
