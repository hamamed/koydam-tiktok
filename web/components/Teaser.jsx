'use client';
/**
 * "Tonight" announcement (teaser) for a live: same look, background, fonts, logo, flags and gift
 * pictures as the stream. Recorded to MP4 by tools/promo-video.js --mode=teaser, or previewed in the panel.
 * Query: ?when=9:00 مساءً&headline=الليلة&cta=…&handle=user&wait=1 (wait: starts on window.startTeaser()).
 */
import { useEffect, useMemo, useState } from 'react';
import { AtSign, CalendarClock, Clock3 } from 'lucide-react';
import { Flag, GiftIcon, Logo } from './bits';
import { findGift, useGiftMap } from '@/lib/gifts';
import { ensureFont, fontVars, themeVars } from '@/lib/format';
import { skinTone, skinVars, useActiveSkin } from '@/lib/skins';

/** Seconds of the whole animation for n teams (also used by the recorder). */
export const teaserLength = (n) => Math.round(4 + Math.min(n, 24) * 0.28 + 6.5);

export default function Teaser({ config, gifts, params = {}, preview = false, portrait: forced }) {
  const th = config.theme || {};
  const skin = useActiveSkin(th);
  const giftMap = useGiftMap(gifts);
  const teams = config.teams || [];
  const [go, setGo] = useState(!params.wait);
  const [tall, setTall] = useState(true);
  useEffect(() => { ensureFont(th.fontFamily); ensureFont(th.titleFont); }, [th.fontFamily, th.titleFont]);
  useEffect(() => {
    if (forced !== undefined) { setTall(forced); return undefined; }
    const on = () => setTall(window.innerHeight >= window.innerWidth);
    on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, [forced]);
  useEffect(() => {
    window.startTeaser = () => setGo(true);
    window.teaserSeconds = teaserLength(teams.length);
    return () => { delete window.startTeaser; };
  }, [teams.length]);
  // Panel preview: replay forever.
  const [loop, setLoop] = useState(0);
  useEffect(() => {
    if (!preview) return undefined;
    const t = setTimeout(() => setLoop((x) => x + 1), (teaserLength(teams.length) + 1.5) * 1000);
    return () => clearTimeout(t);
  }, [preview, loop, teams.length]);

  const n = teams.length;
  const cols = tall ? (n <= 4 ? 2 : n <= 9 ? 3 : n <= 12 ? 4 : 3) : (n <= 6 ? n : n <= 12 ? 6 : 5);
  const teamsEnd = 4 + Math.min(n, 24) * 0.28;
  const category = config.category || 'الدول';
  const cta = params.cta || `كن جاهزاً! اكتب اسم ${category === 'الدول' ? 'دولتك' : 'فريقك'} في الشات وأرسل هديته`;
  const vars = useMemo(() => ({ ...themeVars(th), ...skinVars(th), ...fontVars(th), '--cols': cols, '--t-end': `${teamsEnd}s`, '--n': n }), [th, cols, teamsEnd, n]);

  return (
    <div key={loop} className={`teaser-root${tall ? ' tall' : ' wide'}${go ? ' go' : ''}${preview ? ' preview' : ''}`} data-skin={skin} data-tone={skinTone(skin, th)} style={vars}>
      <div className="live-bg scene-bg" />
      <div className="tz-rays" />
      <div className="tz">
        <div className="tz-logo"><Logo src={th.logo} alt={config.title} /></div>
        <h1 className="tz-title">{config.title}</h1>
        <div className="tz-when">
          <span className="tz-tonight"><CalendarClock className="tz-ico" />{params.headline || 'الليلة'}</span>
          <span className="tz-time"><Clock3 className="tz-ico" /><bdi>{params.when || '9:00 مساءً'}</bdi></span>
        </div>
        <div className="tz-sub">تحدي {category} · من يصل للمليون أولاً؟</div>
        <div className="tz-teams">
          {teams.map((t, i) => {
            const g = t.gifts?.[0];
            return (
              <div key={t.id || i} className="tz-team" style={{ '--i': i, '--team': t.color }}>
                <span className="tz-flag"><Flag team={t} /></span>
                <b className="tz-name">{t.name}</b>
                {g && <span className="tz-gift"><span>أرسل</span><GiftIcon gift={findGift(giftMap, g)} name={g} className="tz-gimg" /></span>}
              </div>
            );
          })}
        </div>
        <div className="tz-cta">{cta}</div>
        {params.handle && <div className="tz-handle"><AtSign className="tz-ico" /><bdi dir="ltr">{String(params.handle).replace(/^@/, '')}</bdi></div>}
      </div>
    </div>
  );
}
