'use client';
/**
 * Team leaderboard. Cards are absolutely positioned and moved with a CSS
 * transform, so a rank change slides smoothly (and can be interrupted by the
 * next change mid-way). Used by the OBS overlay, the live page and the admin preview.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatedNumber, Avatar, Flag } from './bits';
import { fmt } from '@/lib/format';

const MEDALS = { 2: '🥈', 3: '🥉' };

const Card = memo(function Card({ team, data, rank, isLeader, barPct, share, gapText, hidden, x, y, showContributors, contributorsCount, cardRef }) {
  const inner = useRef(null);
  const [pluses, setPluses] = useState([]);
  const prevScore = useRef(null);
  const prevRank = useRef(null);
  const acc = useRef(0);
  const timer = useRef(null);
  const score = data.score || 0;

  // Score went up: bump the card and float "+N" (combo ticks are merged every 400ms).
  useEffect(() => {
    const prev = prevScore.current;
    prevScore.current = score;
    if (prev === null || score <= prev) return;
    inner.current?.animate(
      [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.025)', filter: 'brightness(1.3)', offset: 0.3 }, { transform: 'scale(1)', filter: 'brightness(1)' }],
      { duration: 450, easing: 'cubic-bezier(.22,1,.36,1)' });
    acc.current += score - prev;
    if (timer.current) return;
    const emit = () => {
      const v = acc.current; acc.current = 0;
      if (v > 0) {
        const id = Math.random();
        setPluses((p) => [...p.slice(-3), { id, v }]);
        setTimeout(() => setPluses((p) => p.filter((q) => q.id !== id)), 1350);
      }
      timer.current = setTimeout(() => { timer.current = null; if (acc.current > 0) emit(); }, 400);
    };
    emit();
  }, [score]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (prevRank.current !== null && rank < prevRank.current) {
      inner.current?.animate([{ boxShadow: '0 0 0 3px #fff, 0 0 50px var(--team)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1000, easing: 'ease-out' });
    }
    prevRank.current = rank;
  }, [rank]);

  const top = showContributors ? (data.top || []).slice(0, contributorsCount) : [];
  return (
    <div
      ref={cardRef}
      className={`card${isLeader ? ' is-leader' : ''}${hidden ? ' is-hidden' : ''}`}
      data-rank={rank}
      data-team-card={team.id}
      style={{ '--team': team.color, '--name-scale': team.nameScale || 1, transform: `translate(${-x}px, ${y}px)`, zIndex: 100 - rank }}
    >
      <div ref={inner} className="card-inner glass">
        <div className="rank">{rank}</div>
        <div className="flag-wrap">
          <div className="flag"><Flag team={team} /></div>
          <div className="crown emoji">👑</div>
        </div>
        <div className="main">
          <div className="row1">
            <span className="name">{team.name}</span>
            {score > 0 && MEDALS[rank] && <span className="medal emoji">{MEDALS[rank]}</span>}
            <span className="share">{share}</span>
          </div>
          <div className="bar"><div className="fill" style={{ width: `${barPct}%` }} /></div>
          {showContributors && (
            <div className="contribs">
              {top.map((u) => (
                <span key={u.u || u.n} className="contrib" title={u.u ? `@${u.u}` : u.n}>
                  <Avatar src={u.a} name={u.n || u.u} color={team.color} />
                  <span className="cn">{u.n || u.u}</span>
                  <span className="cp">{fmt(u.p)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="score">
          <span className="num"><AnimatedNumber value={score} /></span>
          <span className="pts">نقطة</span>
          <span className={`gap${isLeader ? ' lead' : ''}`}>{gapText}</span>
        </div>
      </div>
      {pluses.map((p) => <span key={p.id} className="plus">+{fmt(p.v)}</span>)}
    </div>
  );
});

export default function Board({ config, state, byId, layout = 'list', maxVisible = 16, showContributors = true, contributorsCount = 3, minColWidth = 440, flagShape = 'rounded' }) {
  const order = useRef([]);
  const wrap = useRef(null);
  const firstCard = useRef(null);
  const [cardH, setCardH] = useState(96);
  const [width, setWidth] = useState(600);
  const gap = 10;

  const teams = config?.teams || [];
  const leaderId = state?.leaderId;
  const ranked = useMemo(() => {
    const prev = new Map(order.current.map((id, i) => [id, i]));
    return teams
      .map((t, i) => ({ t, i, score: byId?.get(t.id)?.score || 0 }))
      .sort((a, b) => b.score - a.score
        || (a.t.id === leaderId ? -1 : b.t.id === leaderId ? 1 : 0)
        || ((prev.get(a.t.id) ?? a.i + 100) - (prev.get(b.t.id) ?? b.i + 100)));
  }, [teams, byId, leaderId]);
  useEffect(() => { order.current = ranked.map((r) => r.t.id); }, [ranked]);

  // Measure card height and board width (cards are absolutely positioned).
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      if (firstCard.current) setCardH(firstCard.current.offsetHeight || 96);
      if (wrap.current) setWidth(wrap.current.clientWidth || 600);
    });
    if (firstCard.current) ro.observe(firstCard.current);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [showContributors, ranked.length]);
  // Name/photo size changes the card height: measure again.
  useEffect(() => { if (firstCard.current) setCardH(firstCard.current.offsetHeight || 96); });

  const visible = Math.min(ranked.length, maxVisible);
  const cols = layout === 'grid' ? Math.max(1, Math.floor((width + gap) / (minColWidth + gap))) : 1;
  const colW = cols > 1 ? (width - gap * (cols - 1)) / cols : width;
  const rows = Math.ceil(visible / cols);
  const topScore = ranked[0]?.score || 0;
  const second = ranked[1]?.score || 0;
  const total = state?.total || 0;

  return (
    <div ref={wrap} className={`board layout-${layout}`} data-shape={flagShape} style={{ height: rows ? rows * (cardH + gap) - gap : 0, '--col-w': `${colW}px` }}>
      {ranked.map((r, idx) => {
        const data = byId?.get(r.t.id) || { score: 0, top: [] };
        const isLeader = r.t.id === leaderId && r.score > 0;
        const col = idx % cols; const row = Math.floor(idx / cols);
        const gapText = isLeader ? `▲ ${fmt(r.score - second)} تقدّم` : r.score < topScore ? `▼ ${fmt(topScore - r.score)}` : '';
        return (
          <Card
            key={r.t.id}
            cardRef={idx === 0 ? firstCard : undefined}
            team={r.t}
            data={data}
            rank={idx + 1}
            isLeader={isLeader}
            barPct={topScore > 0 ? (r.score / topScore) * 100 : 0}
            share={total > 0 ? `${((r.score / total) * 100).toFixed(1)}%` : '0%'}
            gapText={gapText}
            hidden={idx >= maxVisible}
            x={col * (colW + gap)}
            y={row * (cardH + gap)}
            showContributors={showContributors}
            contributorsCount={contributorsCount}
          />
        );
      })}
    </div>
  );
}
