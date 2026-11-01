'use client';
import { useEffect, useRef, useState } from 'react';
import { fmt, initial, safeUrl } from '@/lib/format';
import { emojiFlagUrl } from '@/lib/flags';

/** Number that tweens to its new value (ease-out, 700ms). */
export function AnimatedNumber({ value, format = fmt }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    cancelAnimationFrame(raf.current);
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 700);
      const v = a + (value - a) * (1 - Math.pow(1 - p, 3));
      from.current = v; setShown(v);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <>{format(shown)}</>;
}

/** Avatar with a coloured initial as fallback. */
export function Avatar({ src, name, color, className = 'avatar' }) {
  const [failed, setFailed] = useState(false);
  const url = safeUrl(src);
  if (!url || failed) return <span className={className} style={color ? { background: color } : undefined}>{initial(name)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />;
}

/** Team flag: image URL or emoji. */
/** Team photo, else the picture of its flag emoji (emoji flags don't show on Windows/OBS), else the emoji. */
export function teamImage(team) {
  return safeUrl(team?.image) || emojiFlagUrl(team?.emoji);
}
export function Flag({ team }) {
  const [failed, setFailed] = useState(false);
  const url = teamImage(team);
  // eslint-disable-next-line @next/next/no-img-element
  if (url && !failed) return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return <span className="emoji">{team.emoji || '🏳️'}</span>;
}

/** Small inline flag + team name, for toasts, the ticker and feeds. */
export function TeamName({ team, className = 'team-inline' }) {
  const [failed, setFailed] = useState(false);
  if (!team) return <span className={className}>؟</span>;
  const url = teamImage(team);
  return (
    <span className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && !failed ? <img className="mini-flag" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : team.emoji ? <span className="emoji">{team.emoji}</span> : null}
      <span>{team.name}</span>
    </span>
  );
}

/** Real TikTok gift image (from the catalog), or a 🎁 when the image isn't known yet. */
export function GiftIcon({ gift, name, className = 'gift-icon', title }) {
  const [failed, setFailed] = useState(false);
  const url = safeUrl(gift?.image);
  const label = title ?? (gift?.name || name || '');
  // eslint-disable-next-line @next/next/no-img-element
  if (url && !failed) return <img className={className} src={url} alt={label} title={label} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />;
  return <span className={`${className} emoji fallback`} title={label}>🎁</span>;
}

/** "🇲🇦 = 🌹" legend: which gift supports which team. */
export function GiftLegend({ teams, giftMap, className = 'gift-legend' }) {
  const items = (teams || []).filter((t) => t.gifts?.length);
  if (!items.length) return null;
  return (
    <div className={className}>
      {items.map((t) => (
        <span key={t.id} className="gl-item" style={{ '--team': t.color }}>
          <span className="gl-flag"><Flag team={t} /></span>
          <span className="gl-eq">=</span>
          {t.gifts.slice(0, 2).map((n) => <GiftIcon key={n} gift={giftMap?.get(String(n).toLowerCase())} name={n} className="gl-gift" />)}
        </span>
      ))}
    </div>
  );
}

/** The default logo, or the live's own logo when `src` is set (theme.logo). */
export function Logo({ className = 'logo', small, src, alt = 'تحدي المليون' }) {
  const own = typeof src === 'string' && /^(\/uploads\/|https:\/\/)/.test(src);
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`${className}${own ? ' own-logo' : ''}`} src={own ? src : small ? '/logo-sm.png' : '/logo.png'} alt={alt} draggable={false} />;
}

/** Progress toward the 1M goal. */
export function GoalBar({ total, goal, compact, variant = '' }) {
  if (!goal || !goal.enabled) return null;
  const pct = Math.min(100, (total / Math.max(1, goal.target)) * 100);
  return (
    <div className={`goal${compact ? ' compact' : ''}${variant ? ` ${variant}` : ''}`}>
      <div className="goal-row">
        <span className="goal-label">{goal.label || 'الهدف'}</span>
        <span className="goal-nums"><b><AnimatedNumber value={total} /></b> / {fmt(goal.target)}</span>
      </div>
      <div className="goal-bar"><div className="goal-fill" style={{ width: `${pct}%` }} /><span className="goal-pct">{pct.toFixed(pct < 10 ? 1 : 0)}%</span></div>
    </div>
  );
}
