'use client';
/** Round countdown + winner celebration (overlay and live page). */
import { useEffect, useState } from 'react';
import { onLiveEvent } from '@/lib/store';
import { confettiRain } from '@/lib/confetti';
import { fmt } from '@/lib/format';
import { Avatar, Flag } from './bits';

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Ticking clock for a running round (null when no round is running). */
export function useRoundClock(round) {
  const [now, setNow] = useState(() => Date.now());
  const running = round?.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  if (!running) return null;
  const left = Math.max(0, round.endsAtLocal - now);
  const total = Math.max(1, round.durationSec * 1000);
  return { left, text: mmss(left), pct: Math.min(100, ((total - left) / total) * 100), urgent: left <= 30000, number: round.number };
}

export function RoundTimer({ round, enabled = true, className = '' }) {
  const clock = useRoundClock(round);
  if (!enabled || !clock) return null;
  return (
    <div className={`round-timer${clock.urgent ? ' urgent' : ''} ${className}`}>
      <span className="rt-label">الجولة {clock.number}</span>
      <span className="rt-time">{clock.text}</span>
      <span className="rt-bar"><i style={{ width: `${100 - clock.pct}%` }} /></span>
    </div>
  );
}

/** Winner screen shown when a round ends (from the 'roundEnd' event). */
export function useRoundWinner({ confetti = true } = {}) {
  const [win, setWin] = useState(null);
  useEffect(() => onLiveEvent((ev) => {
    if (ev.kind !== 'roundEnd') return;
    setWin({ ...ev, key: Math.random() });
    if (confetti && ev.winner) confettiRain([ev.winner.color || '#f5b301', '#ffd54a', '#ffffff'], 220, ev.winner.emoji);
  }), [confetti]);
  useEffect(() => {
    if (!win) return undefined;
    const t = setTimeout(() => setWin(null), Math.max(3, win.celebrateSec || 12) * 1000);
    return () => clearTimeout(t);
  }, [win]);
  return [win, setWin];
}

export function WinnerScreen({ win, teams }) {
  if (!win) return null;
  const team = win.winner ? { ...win.winner, ...(teams?.find((t) => t.id === win.winner.id) || {}) } : null;
  return (
    <div key={win.key} className="winner-screen" style={{ '--team': team?.color || '#f5b301' }}>
      <div className="ws-card glass">
        <div className="ws-sub">نهاية الجولة {win.number}</div>
        {team ? (
          <>
            <div className="ws-flagwrap"><div className="ws-flag"><Flag team={team} /></div><div className="ws-crown emoji">👑</div></div>
            <div className="ws-name">{team.name}</div>
            <div className="ws-title">بطل الجولة!</div>
            <div className="ws-score num-latin">{fmt(win.winner.score)} <small>نقطة</small></div>
          </>
        ) : <div className="ws-name">تعادل!</div>}
        {win.topSupporters?.length > 0 && (
          <div className="ws-sups">
            {win.topSupporters.map((u, i) => (
              <div key={`${u.u}-${i}`} className={`ws-sup p${i + 1}`}>
                <span className="ws-medal emoji">{['🥇', '🥈', '🥉'][i]}</span>
                <Avatar src={u.a} name={u.n} color={teams?.find((t) => t.id === u.team)?.color} />
                <b>{u.n}</b><span className="num-latin">{fmt(u.p)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
