'use client';
/**
 * On-screen games (config.game.mode): «كأس العرب» (cup) and «حلبة الدول» (arena).
 * State comes from the server (store.game); this only draws it, with the live's look.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cable, Castle, CircleHelp, Crown, FlagTriangleRight, Moon, Rocket, Shield, Skull, Swords, Timer, Trophy, Zap } from 'lucide-react';
import { Flag, GiftIcon } from './bits';
import { findGift, useGiftMap } from '@/lib/gifts';
import { fmt } from '@/lib/format';
import { fillN, gameUi } from '@/lib/gameText';

const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return undefined; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [active]);
  return now;
}

function SendGift({ team, giftMap, hide }) {
  const g = team?.gifts?.[0];
  if (hide) return null;
  if (!g) return null;
  return <span className="gm-send"><span>أرسل</span><GiftIcon gift={findGift(giftMap, g)} name={g} className="gm-gift" /></span>;
}

function Waiting({ title, sub, icon: I, show = true }) {
  return (
    <div className="gm-wait glass">
      {show && <I className="gm-wait-ico" />}
      {title && <b>{title}</b>}
      {sub && <span>{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ cup */
function Cup({ game, teams, giftMap, ui }) {
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

  if (game.status === 'idle') return <Waiting icon={Trophy} title={ui.waitTitle} sub={ui.waitSub} show={ui.showIcon} />;
  const round = game.rounds?.[game.rounds.length - 1];

  if (game.status === 'done') {
    const c = byId.get(game.champion);
    return (
      <div className="gm-champ glass" style={{ '--team': c?.color }}>
        <Crown className="gm-champ-crown" fill="currentColor" />
        <div className="gm-champ-flag"><Flag team={c || {}} /></div>
        <b className="gm-champ-name">{c?.name}</b>
        {ui.champ && <span className="gm-champ-sub">{ui.champ}</span>}
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
      {m && <SendGift team={t} giftMap={giftMap} hide={ui.showSend === false} />}
    </div>
  );
  return (
    <div className="gm-cup">
      <div className="gm-match glass">
        <div className="gm-match-head">
          <span className="gm-round">{ui.showIcon && <Trophy className="lc-inline" />} {[ui.label, round?.name].filter(Boolean).join(' · ')}</span>
          <span className={`gm-clock${game.status === 'break' ? ' brk' : ''}`}><Timer className="lc-inline" /> {game.status === 'break' ? `المباراة التالية ${left}` : left}</span>
        </div>
        <div className="gm-pitch">
          <Side t={A} side="a" />
          <div className="gm-score num-latin"><span>{shown?.ga ?? 0}</span><i>-</i><span>{shown?.gb ?? 0}</span></div>
          <Side t={B} side="b" />
        </div>
        {flash && <div key={flash.k} className="gm-goal">هدف!</div>}
        {res && <div className="gm-result">الفائز: <b>{byId.get(res.winner)?.name}</b></div>}
        {m && ui.hint && <div className="gm-hint">{fillN(ui.hint, fmt(game.goalPoints))}</div>}
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
function Arena({ game, teams, giftMap, ui }) {
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
  if (game.status === 'idle') return <Waiting icon={Swords} title={ui.waitTitle} sub={ui.waitSub} show={ui.showIcon} />;
  if (game.status === 'done') {
    const c = byId.get(game.winner);
    return (
      <div className="gm-champ glass" style={{ '--team': c?.color }}>
        <Crown className="gm-champ-crown" fill="currentColor" />
        <div className="gm-champ-flag"><Flag team={c || {}} /></div>
        <b className="gm-champ-name">{c?.name}</b>
        {ui.champ && <span className="gm-champ-sub">{ui.champ}</span>}
      </div>
    );
  }
  const alive = fighters.filter((f) => f.alive).length;
  const ranked = [...fighters].sort((a, b) => (b.alive - a.alive) || b.hp - a.hp);
  return (
    <div className="gm-arena-wrap">
      <div className="gm-arena-head glass">{ui.showIcon && <Swords className="lc-inline" />} {ui.label ? `${ui.label} · ` : ''}باقٍ <b className="num-latin">{alive}</b> من <b className="num-latin">{fighters.length}</b></div>
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
              <SendGift team={t} giftMap={giftMap} hide={ui.showSend === false} />
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------- champion */
function Champion({ team, title }) {
  return (
    <div className="gm-champ glass" style={{ '--team': team?.color }}>
      <Crown className="gm-champ-crown" fill="currentColor" />
      <div className="gm-champ-flag"><Flag team={team || {}} /></div>
      <b className="gm-champ-name">{team?.name}</b>
      {title && <span className="gm-champ-sub">{title}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- tug */
function Tug({ game, teams, giftMap, ui }) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const now = useNow(true);
  if (game.status === 'idle') return <Waiting icon={Cable} title={ui.waitTitle} sub={ui.waitSub} show={ui.showIcon} />;
  const A = byId.get(game.a); const B = byId.get(game.b);
  const diff = (game.pa || 0) - (game.pb || 0);
  const pos = Math.max(-1, Math.min(1, diff / (game.win || 1))); // + = towards A (right)
  const brk = game.status === 'break';
  const left = brk ? mmss((game.nextAtLocal || now) - now) : mmss((game.endsAtLocal || now) - now);
  const W = brk ? byId.get(game.winner) : null;
  return (
    <div className="gm-tug glass">
      <div className="gm-match-head">
        <span className="gm-round">{ui.showIcon && <Cable className="lc-inline" />} {ui.label}</span>
        <span className={`gm-clock${brk ? ' brk' : ''}`}><Timer className="lc-inline" /> {brk ? `الجولة التالية ${left}` : left}</span>
      </div>
      <div className="gm-tug-teams">
        {[['a', A], ['b', B]].map(([k, t]) => (
          <div key={k} className={`gm-side ${k}${W && W.id === t?.id ? ' won' : ''}`} style={{ '--team': t?.color }}>
            <div className="gm-flag"><Flag team={t || {}} /></div>
            <b className="gm-name">{t?.name}</b>
            <span className="gm-tug-pts num-latin">{fmt(game[`p${k}`] || 0)}</span>
            {(game.wins?.[t?.id] || 0) > 0 && <span className="gm-wins"><Trophy className="lc-inline" /> {game.wins[t.id]}</span>}
            {!brk && <SendGift team={t} giftMap={giftMap} hide={ui.showSend === false} />}
          </div>
        ))}
      </div>
      <div className="gm-rope" style={{ '--pos': pos, '--ta': A?.color, '--tb': B?.color }}>
        <span className="gm-zone a" /><span className="gm-zone b" />
        <span className="gm-rope-line" />
        <span className="gm-knot" />
      </div>
      {W ? <div className="gm-result">الفائز: <b>{W.name}</b></div> : ui.hint ? <div className="gm-hint">{fillN(ui.hint, fmt(game.win))}</div> : null}
    </div>
  );
}

/* --------------------------------------------------- horses / rockets */
function Track({ game, teams, giftMap, ui }) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const rockets = game.mode === 'rockets';
  if (game.status === 'idle') return <Waiting icon={rockets ? Rocket : FlagTriangleRight} title={ui.waitTitle} sub={ui.waitSub} show={ui.showIcon} />;
  if (game.status === 'done') return <Champion team={byId.get(game.winner)} title={ui.champ} />;
  const runners = game.runners || [];
  const lead = runners.reduce((m, r) => Math.max(m, r.dist), 0);
  if (rockets) {
    return (
      <div className="gm-rockets glass">
        <div className="gm-match-head"><span className="gm-round">{ui.showIcon && <Rocket className="lc-inline" />} {ui.label}</span>{ui.hint && <span className="gm-hint">{fillN(ui.hint, fmt(game.length))}</span>}</div>
        <div className="gm-sky">
          <Moon className="gm-moon" fill="currentColor" />
          {runners.map((r) => { const t = byId.get(r.id); const p = Math.min(100, (r.dist / game.length) * 100); return t && (
            <div key={r.id} className={`gm-lane-v${r.dist === lead && lead > 0 ? ' lead' : ''}`} style={{ '--team': t.color, '--p': p }}>
              <div className="gm-rocket"><Rocket className="gm-rocket-ico" /><span className="gm-rflag"><Flag team={t} /></span><span className="gm-flame" /></div>
              <div className="gm-lane-foot"><SendGift team={t} giftMap={giftMap} hide={ui.showSend === false} /></div>
            </div>
          ); })}
        </div>
      </div>
    );
  }
  return (
    <div className="gm-track glass">
      <div className="gm-match-head"><span className="gm-round">{ui.showIcon && <FlagTriangleRight className="lc-inline" />} {ui.label}</span>{ui.hint && <span className="gm-hint">{fillN(ui.hint, fmt(game.length))}</span>}</div>
      <div className="gm-lanes">
        {runners.map((r, i) => { const t = byId.get(r.id); const p = Math.min(100, (r.dist / game.length) * 100); return t && (
          <div key={r.id} className={`gm-lane${r.dist === lead && lead > 0 ? ' lead' : ''}`} style={{ '--team': t.color, '--p': p }}>
            <span className="gm-lane-no num-latin">{i + 1}</span>
            <div className="gm-lane-run">
              <div className="gm-runner"><span className="gm-dust" /><span className="gm-rflag"><Flag team={t} /></span><Zap className="gm-zap" fill="currentColor" /></div>
            </div>
            <SendGift team={t} giftMap={giftMap} hide={ui.showSend === false} />
          </div>
        ); })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- castle */
function Castles({ game, teams, giftMap, ui }) {
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const now = useNow(true);
  if (game.status === 'idle') return <Waiting icon={Castle} title={ui.waitTitle} sub={ui.waitSub} show={ui.showIcon} />;
  if (game.status === 'done') return <Champion team={byId.get(game.winner)} title={ui.champ} />;
  const hit = game.lastHit && Date.now() - (game.lastHit.at || 0) < 900 ? game.lastHit : null;
  return (
    <div className="gm-castles glass">
      <div className="gm-match-head">
        <span className="gm-round">{ui.showIcon && <Castle className="lc-inline" />} {ui.label}</span>
        <span className="gm-clock"><Timer className="lc-inline" /> {mmss((game.endsAtLocal || now) - now)}</span>
      </div>
      <div className="gm-towers" style={{ '--n': (game.castles || []).length }}>
        {(game.castles || []).map((c) => { const t = byId.get(c.id); const p = Math.max(2, Math.min(100, (c.wall / game.max) * 100)); return t && (
          <div key={c.id} className={`gm-tower${hit && hit.to === c.id ? ' hurt' : ''}${hit && hit.from === c.id ? ' atk' : ''}`} style={{ '--team': t.color, '--p': p }}>
            <span className="gm-wall-n num-latin">{fmt(c.wall)}</span>
            <div className="gm-wall"><Castle className="gm-castle-ico" />{hit && hit.to === c.id && <span key={hit.at} className="gm-dmg num-latin">-{fmt(hit.dmg)}</span>}</div>
            <span className="gm-tflag"><Flag team={t} /></span>
            <SendGift team={t} giftMap={giftMap} hide={ui.showSend === false} />
          </div>
        ); })}
      </div>
      {ui.hint && <div className="gm-hint">{fillN(ui.hint, fmt(game.max))}</div>}
    </div>
  );
}

/* -------------------------------------------- activities (any game) */
export function Activities({ acts, config }) {
  const now = useNow(Boolean(acts?.boost || acts?.quiz));
  const byId = useMemo(() => new Map((config.teams || []).map((t) => [t.id, t])), [config.teams]);
  if (!acts) return null;
  const { boost, quiz, throne } = acts;
  const tt = throne && byId.get(throne.teamId);
  const showThrone = throne && config.game?.throne?.enabled !== false;
  if (!boost && !quiz && !showThrone) return null;
  const qLeft = quiz ? Math.max(0, quiz.endsAtLocal - now) : 0;
  const qPct = quiz ? Math.max(0, Math.min(100, (qLeft / (quiz.endsAtLocal - quiz.startedLocal)) * 100)) : 0;
  return (
    <div className="acts">
      {boost && (
        <div className="act-boost">
          <Zap className="act-boost-ico" fill="currentColor" />
          <b>الدقيقة الذهبية</b>
          <span className="act-mult num-latin">×{boost.mult}</span>
          <span className="act-left num-latin">{mmss(boost.untilLocal - now)}</span>
        </div>
      )}
      {quiz && (
        <div className={`act-quiz glass${quiz.done ? ' done' : ''}`}>
          <div className="act-q-head"><CircleHelp className="lc-inline" /> {quiz.kind === 'flag' ? 'خمّن العلم' : 'سؤال وجواب'} · <span>اكتب الجواب في الشات</span> · <b className="num-latin">+{fmt(quiz.points)}</b></div>
          {quiz.kind === 'flag' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="act-flag" src={`/flags/${quiz.flag}.svg`} alt="" style={{ filter: quiz.done ? 'none' : `blur(${Math.round((qPct / 100) * 22)}px)` }} />
          )}
          <div className="act-q">{quiz.q}</div>
          {!quiz.done && <div className="act-q-bar"><span style={{ width: `${qPct}%` }} /></div>}
          {quiz.done && (
            <div className="act-q-res">
              الجواب: <b>{quiz.show}</b>
              {quiz.winner ? <> · أول جواب صحيح: <b>{quiz.winner.nickname}</b>{quiz.winner.teamId && byId.get(quiz.winner.teamId) ? <> لـ {byId.get(quiz.winner.teamId).name}</> : null}</> : <> · لم يجب أحد</>}
            </div>
          )}
        </div>
      )}
      {showThrone && (
        <div className="act-throne glass" style={{ '--team': tt?.color }}>
          <Crown className="act-crown" fill="currentColor" />
          <span className="act-th-av">{throne.user.avatar ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={throne.user.avatar} alt="" referrerPolicy="no-referrer" /> : (throne.user.nickname || '?').slice(0, 1)}</span>
          <div className="act-th-txt"><small>على العرش</small><b>{throne.user.nickname}</b></div>
          {tt && <span className="act-th-flag"><Flag team={tt} /></span>}
          <span className="act-th-pts num-latin">{fmt(throne.points)}</span>
        </div>
      )}
    </div>
  );
}

export default function GameView({ config, game, gifts }) {
  const giftMap = useGiftMap(gifts);
  const mode = config.game?.mode;
  const ui = gameUi(config, mode);
  const g = game && game.mode === mode ? game : { mode, status: 'idle' };
  if (mode === 'cup') return <Cup game={g} teams={config.teams} giftMap={giftMap} ui={ui} />;
  if (mode === 'arena') return <Arena game={g} teams={config.teams} giftMap={giftMap} ui={ui} />;
  if (mode === 'tug') return <Tug game={g} teams={config.teams} giftMap={giftMap} ui={ui} />;
  if (mode === 'horses' || mode === 'rockets') return <Track game={g} teams={config.teams} giftMap={giftMap} ui={ui} />;
  if (mode === 'castle') return <Castles game={g} teams={config.teams} giftMap={giftMap} ui={ui} />;
  return null;
}
