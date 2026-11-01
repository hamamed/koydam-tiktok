'use client';
/**
 * On-screen games (config.game.mode): «كأس العرب» (cup) and «حلبة الدول» (arena).
 * State comes from the server (store.game); this only draws it, with the live's look.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Crown, Shield, Skull, Swords, Timer, Trophy } from 'lucide-react';
import { Flag, GiftIcon } from './bits';
import { findGift, useGiftMap } from '@/lib/gifts';
import { fmt } from '@/lib/format';

const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return undefined; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [active]);
  return now;
}

function SendGift({ team, giftMap }) {
  const g = team?.gifts?.[0];
  if (!g) return null;
  return <span className="gm-send"><span>أرسل</span><GiftIcon gift={findGift(giftMap, g)} name={g} className="gm-gift" /></span>;
}

function Waiting({ title, sub, icon: I }) {
  return (
    <div className="gm-wait glass">
      <I className="gm-wait-ico" />
      <b>{title}</b>
      <span>{sub}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ cup */
function Cup({ game, teams, giftMap }) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const now = useNow(true);
  const [flash, setFlash] = useState(null);
  const prev = useRef(null);
  const m = game.match;
  useEffect(() => {
    if (!m) { prev.current = null; return; }
    const p = prev.current;
    if (p && p.a === m.a && p.b === m.b) {
      if (m.ga > p.ga) setFlash({ side: 'a', k: Date.now() });
      else if (m.gb > p.gb) setFlash({ side: 'b', k: Date.now() });
    }
    prev.current = { a: m.a, b: m.b, ga: m.ga, gb: m.gb };
  }, [m?.a, m?.b, m?.ga, m?.gb]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(null), 2200); return () => clearTimeout(t); }, [flash]);

  if (game.status === 'idle') return <Waiting icon={Trophy} title="كأس العرب" sub="المباريات تبدأ قريباً، جهّز دولتك!" />;
  const round = game.rounds?.[game.rounds.length - 1];

  if (game.status === 'done') {
    const c = byId.get(game.champion);
    return (
      <div className="gm-champ glass" style={{ '--team': c?.color }}>
        <Crown className="gm-champ-crown" fill="currentColor" />
        <div className="gm-champ-flag"><Flag team={c || {}} /></div>
        <b className="gm-champ-name">{c?.name}</b>
        <span className="gm-champ-sub">بطل كأس العرب</span>
      </div>
    );
  }

  const res = game.status === 'break' ? game.lastResult : null;
  const shown = m || (res && { ...res, ga: res.ga, gb: res.gb });
  const A = byId.get(shown?.a); const B = byId.get(shown?.b);
  const left = game.status === 'running' && m ? mmss(m.endsAtLocal - now) : game.status === 'break' ? mmss((game.nextAtLocal || now) - now) : '';
  const meter = (side) => (m ? Math.min(100, (m[`m${side}`] / game.goalPoints) * 100) : 0);
  const Side = ({ t, side }) => (
    <div className={`gm-side ${side}${flash?.side === side ? ' scored' : ''}${res && res.winner === t?.id ? ' won' : ''}`} style={{ '--team': t?.color }}>
      <div className="gm-flag"><Flag team={t || {}} /></div>
      <b className="gm-name">{t?.name}</b>
      {m && <div className="gm-meter"><span style={{ width: `${meter(side)}%` }} /></div>}
      {m && <SendGift team={t} giftMap={giftMap} />}
    </div>
  );
  return (
    <div className="gm-cup">
      <div className="gm-match glass">
        <div className="gm-match-head">
          <span className="gm-round"><Trophy className="lc-inline" /> {round?.name}</span>
          <span className={`gm-clock${game.status === 'break' ? ' brk' : ''}`}><Timer className="lc-inline" /> {game.status === 'break' ? `المباراة التالية ${left}` : left}</span>
        </div>
        <div className="gm-pitch">
          <Side t={A} side="a" />
          <div className="gm-score num-latin"><span>{shown?.ga ?? 0}</span><i>-</i><span>{shown?.gb ?? 0}</span></div>
          <Side t={B} side="b" />
        </div>
        {flash && <div key={flash.k} className="gm-goal">هدف!</div>}
        {res && <div className="gm-result">الفائز: <b>{byId.get(res.winner)?.name}</b></div>}
        {m && <div className="gm-hint">كل <b className="num-latin">{fmt(game.goalPoints)}</b> نقطة = هدف</div>}
      </div>
      <div className="gm-bracket">
        {round?.matches.map((x, i) => {
          const a = byId.get(x.a); const b = byId.get(x.b);
          const live = m && game.match.index === i && game.match.round === game.rounds.length - 1;
          return (
            <div key={i} className={`gm-bm glass${live ? ' live' : ''}${x.done ? ' done' : ''}`}>
              <span className={`gm-bt${x.winner === x.a ? ' w' : ''}`}><span className="gm-bflag"><Flag team={a || {}} /></span>{a?.name}</span>
              <span className="gm-bs num-latin">{x.done ? `${x.ga}-${x.gb}` : live ? `${m.ga}-${m.gb}` : 'ضد'}</span>
              {b ? <span className={`gm-bt${x.winner === x.b ? ' w' : ''}`}><span className="gm-bflag"><Flag team={b} /></span>{b.name}</span> : <span className="gm-bt bye">تأهل مباشر</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- arena */
function Arena({ game, teams, giftMap }) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const box = useRef(null);
  const bodies = useRef(new Map());
  const [, force] = useState(0);
  const fighters = useMemo(() => game.fighters || [], [game.fighters]);
  const n = Math.max(1, fighters.length);
  const size = n <= 4 ? 190 : n <= 8 ? 150 : n <= 14 ? 118 : 96;

  // Light physics: each team bounces inside the arena (visual only, HP comes from the server).
  useEffect(() => {
    let raf; let last = performance.now();
    const step = (t) => {
      const el = box.current; const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (el) {
        const W = el.clientWidth; const H = el.clientHeight; const r = size / 2;
        for (const f of fighters) {
          let b = bodies.current.get(f.id);
          if (!b) { const a = Math.random() * Math.PI * 2; b = { x: r + Math.random() * Math.max(1, W - size), y: r + Math.random() * Math.max(1, H - size), vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 }; bodies.current.set(f.id, b); }
          const sp = f.alive ? 1 : 0.15;
          b.x += b.vx * dt * sp; b.y += b.vy * dt * sp;
          if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); } if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx); }
          if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy); } if (b.y > H - r) { b.y = H - r; b.vy = -Math.abs(b.vy); }
        }
        // simple circle collisions between alive teams
        const alive = fighters.filter((f) => f.alive).map((f) => bodies.current.get(f.id)).filter(Boolean);
        for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
          const p = alive[i]; const q = alive[j]; const dx = q.x - p.x; const dy = q.y - p.y; const d = Math.hypot(dx, dy) || 1;
          if (d < size) { const nx = dx / d; const ny = dy / d; const push = (size - d) / 2; p.x -= nx * push; p.y -= ny * push; q.x += nx * push; q.y += ny * push;
            const pv = p.vx * nx + p.vy * ny; const qv = q.vx * nx + q.vy * ny; p.vx += (qv - pv) * nx; p.vy += (qv - pv) * ny; q.vx += (pv - qv) * nx; q.vy += (pv - qv) * ny; }
        }
        force((x) => (x + 1) % 1e6);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fighters, size]);

  const hit = game.lastHit && Date.now() - (game.lastHit.at || 0) < 900 ? game.lastHit : null;
  if (game.status === 'idle') return <Waiting icon={Swords} title="حلبة الدول" sub="أرسل هدية دولتك لتهاجم، آخر دولة تبقى تفوز!" />;
  if (game.status === 'done') {
    const c = byId.get(game.winner);
    return (
      <div className="gm-champ glass" style={{ '--team': c?.color }}>
        <Crown className="gm-champ-crown" fill="currentColor" />
        <div className="gm-champ-flag"><Flag team={c || {}} /></div>
        <b className="gm-champ-name">{c?.name}</b>
        <span className="gm-champ-sub">بطل الحلبة</span>
      </div>
    );
  }
  const alive = fighters.filter((f) => f.alive).length;
  const ranked = [...fighters].sort((a, b) => (b.alive - a.alive) || b.hp - a.hp);
  return (
    <div className="gm-arena-wrap">
      <div className="gm-arena-head glass"><Swords className="lc-inline" /> حلبة الدول · باقٍ <b className="num-latin">{alive}</b> من <b className="num-latin">{fighters.length}</b></div>
      <div ref={box} className="gm-arena glass" style={{ '--sz': `${size}px` }}>
        {fighters.map((f) => {
          const t = byId.get(f.id); const b = bodies.current.get(f.id); if (!t || !b) return null;
          const pct = Math.max(0, Math.min(100, (f.hp / game.max) * 100));
          const hurt = hit && hit.to === f.id; const atk = hit && hit.from === f.id;
          return (
            <div key={f.id} className={`gm-ball${f.alive ? '' : ' out'}${hurt ? ' hurt' : ''}${atk ? ' atk' : ''}`}
              style={{ '--team': t.color, '--hp': pct, transform: `translate(${b.x - size / 2}px, ${b.y - size / 2}px)` }}>
              <div className="gm-ring" />
              <div className="gm-ball-flag"><Flag team={t} /></div>
              {!f.alive && <Skull className="gm-dead" />}
              <span className="gm-ball-hp num-latin">{fmt(f.hp)}</span>
              {hurt && <span key={hit.at} className="gm-dmg num-latin">-{fmt(hit.dmg)}</span>}
            </div>
          );
        })}
      </div>
      <div className="gm-hp-list">
        {ranked.map((f) => {
          const t = byId.get(f.id); if (!t) return null;
          const pct = Math.max(0, Math.min(100, (f.hp / game.max) * 100));
          return (
            <div key={f.id} className={`gm-hp glass${f.alive ? '' : ' out'}`} style={{ '--team': t.color }}>
              <span className="gm-hp-flag"><Flag team={t} /></span>
              <span className="gm-hp-bar"><span style={{ width: `${f.alive ? pct : Math.min(100, (f.revive / (game.max * 0.5)) * 100)}%` }} /></span>
              {f.alive ? <Shield className="gm-hp-ico" /> : <Skull className="gm-hp-ico" />}
              <SendGift team={t} giftMap={giftMap} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function GameView({ config, game, gifts }) {
  const giftMap = useGiftMap(gifts);
  const mode = config.game?.mode;
  const g = game && game.mode === mode ? game : { mode, status: 'idle' };
  if (mode === 'cup') return <Cup game={g} teams={config.teams} giftMap={giftMap} />;
  if (mode === 'arena') return <Arena game={g} teams={config.teams} giftMap={giftMap} />;
  return null;
}
