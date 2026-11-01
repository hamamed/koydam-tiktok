'use client';
/**
 * Bar with every team's flag + gift (theme.giftStrip / theme.strip).
 * "scroll" = endless news-channel ticker (the list is repeated and slides one copy width per loop);
 * "static" = all items shown, wrapping to more rows.
 */
import { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { Flag, GiftIcon } from './bits';

function Items({ teams, giftMap }) {
  return teams.map((t) => (
    <span key={t.id} className="gs-item" style={{ '--team': t.color }} title={t.name}>
      <span className="gs-flag"><Flag team={t} /></span>
      {t.gifts.slice(0, 2).map((n) => <GiftIcon key={n} gift={giftMap?.get(String(n).toLowerCase())} name={n} className="gs-gift" />)}
    </span>
  ));
}

const GiftStrip = forwardRef(function GiftStrip({ teams, giftMap, s, style }, ref) {
  const scroll = s.mode !== 'static';
  const view = useRef(null); const track = useRef(null);
  const [copies, setCopies] = useState(2);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!scroll) return undefined;
    const measure = () => {
      const tr = track.current; const v = view.current; if (!tr || !v) return;
      const [a, b] = tr.children;
      if (!a || !b) return;
      const w = Math.abs(b.offsetLeft - a.offsetLeft) || a.offsetWidth;
      setShift((x) => (Math.abs(x - w) > 0.5 ? w : x));
      const need = Math.max(2, Math.ceil(v.clientWidth / Math.max(1, w)) + 1);
      setCopies((c) => (c !== need ? need : c));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (view.current) ro.observe(view.current);
    if (track.current?.firstElementChild) ro.observe(track.current.firstElementChild);
    return () => ro.disconnect();
  }, [scroll, teams.length]);

  const speed = Math.max(10, s.speed || 60);
  return (
    <div ref={ref} className={`gift-strip glass ${scroll ? 'is-scroll' : 'is-static'} pos-${s.pos || 'top'} align-${s.align || 'panel'}`} style={style}>
      {s.label && <span className="gs-label">{s.label}</span>}
      {scroll ? (
        <div ref={view} className={`gs-view${s.dir === 'left' ? ' dir-left' : ''}`}>
          <div ref={track} className={`gs-track dir-${s.dir === 'left' ? 'left' : 'right'}`}
            style={shift ? { '--gs-shift': `${shift}px`, animationDuration: `${(shift / speed).toFixed(2)}s` } : { animation: 'none' }}>
            {Array.from({ length: copies }, (_, i) => <div key={i} className="gs-list" aria-hidden={i > 0 || undefined}><Items teams={teams} giftMap={giftMap} /></div>)}
          </div>
        </div>
      ) : (
        <div className="gs-list wrap"><Items teams={teams} giftMap={giftMap} /></div>
      )}
    </div>
  );
});
export default GiftStrip;
