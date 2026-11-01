'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Board from './Board';
import { Banner, Ticker, Toasts, useAlerts } from './Effects';
import { RoundTimer, WinnerScreen, useRoundWinner } from './Rounds';
import Speaker from './Speaker';
import { AnimatedNumber, GiftLegend, GoalBar, Logo } from './bits';
import GiftStrip from './GiftStrip';
import { Eye } from 'lucide-react';
import { useGiftMap } from '@/lib/gifts';
import { ensureFont, fmt, partsProps, safeUrl, themeVars } from '@/lib/format';
import { skinTone, skinVars, useActiveSkin } from '@/lib/skins';

/** Background picture layer (dimmed, optional blur). */
export function ScenePhoto({ theme }) {
  const url = safeUrl(theme.bgImage);
  if (!url) return null;
  const blur = theme.bgBlur || 0;
  return <div className="scene-photo" style={{ backgroundImage: `url("${url}")`, '--bg-dim': theme.bgDim ?? 0.55, filter: blur ? `blur(${blur}px)` : undefined, transform: blur ? 'scale(1.06)' : undefined }} />;
}

/**
 * The OBS overlay scene.
 *  - landscape: 1920x1080 (/overlay)
 *  - portrait:  1080x1920 (/overlay-vertical) for TikTok LIVE Studio / phones;
 *    keeps clear of TikTok's own UI at the top and bottom (settings in theme.vertical).
 */
export default function Overlay({ config, state, byId, status, gifts, round, preview = false, orientation = 'landscape', speak = false }) {
  const th = config.theme;
  const portrait = orientation === 'portrait';
  const v = th.vertical || {};
  const { toasts, ticks, banner } = useAlerts(config, { confetti: !preview });
  const [win] = useRoundWinner({ confetti: !preview });
  const skin = useActiveSkin(th);
  const giftMap = useGiftMap(gifts);
  useEffect(() => { ensureFont(th.fontFamily); ensureFont(th.titleFont); }, [th.fontFamily, th.titleFont]);
  // Toasts go to the side opposite the board when they would overlap.
  const toastSide = portrait ? 'center' : th.layout === 'list' && th.position === th.toastPosition ? (th.position === 'left' ? 'right' : 'left') : th.toastPosition;
  // Vertical design: layout 'grid' (tiles in columns) | 'side' (narrow column, the middle stays free) | 'list';
  // header 'compact' | 'full' | 'off'; alerts as small pills, at most v.maxToasts.
  const vLayout = ['grid', 'side', 'list'].includes(v.layout) ? v.layout : 'grid';
  const vHeader = v.showHeader === false ? 'off' : ['compact', 'full', 'off'].includes(v.header) ? v.header : 'compact';
  const showHeader = portrait ? vHeader !== 'off' : th.showHeader;
  const showToasts = portrait ? v.showToasts !== false : true;
  const showTicker = portrait ? Boolean(v.showTicker) : th.showTicker;
  const fg = config.social?.followGoal;
  // Shrink the panel when header + cards are taller than the screen (many teams visible).
  const rootRef = useRef(null); const panelRef = useRef(null); const stripRef = useRef(null);
  const [fit, setFit] = useState(1);
  const fitRef = useRef(1); fitRef.current = fit;
  // Top bar with EVERY team's flag + gift, so viewers know how to push a team that is not on the board.
  const stripTeams = th.giftStrip !== false ? config.teams.filter((t) => t.gifts?.length) : [];
  const [stripH, setStripH] = useState(0);
  // Placement: top or bottom, distance from that edge, width and alignment (theme.strip).
  const strip = { mode: 'scroll', pos: 'top', offset: 14, width: 100, align: 'center', speed: 60, dir: 'right', label: '', ...(th.strip || {}) };
  const stripTop = strip.pos !== 'bottom';
  const edgeBase = stripTop ? (portrait ? v.top ?? 170 : 0) : (showTicker ? (portrait ? 108 : 92) : (portrait ? 40 : 0));
  const stripStyle = {
    [stripTop ? 'top' : 'bottom']: `${edgeBase + (strip.offset ?? 14)}px`,
    [strip.mode === 'static' ? 'maxWidth' : 'width']: `calc(${strip.width ?? 100}% - ${portrait ? 2 * (v.side ?? 28) : 60}px)`,
  };
  // Push the board down only when the bar sits at the very top (otherwise it floats where you put it).
  const pushDown = stripTop && (strip.offset ?? 14) <= 60 && stripH ? (strip.offset ?? 14) + stripH + 12 - (portrait ? 0 : 36) : 0;
  const reserveBottom = !stripTop && stripH ? stripH + (strip.offset ?? 14) + 10 : 0;
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) { setStripH(0); return undefined; }
    const m = () => setStripH(el.offsetHeight);
    m(); const ro = new ResizeObserver(m); ro.observe(el);
    return () => ro.disconnect();
  }, [stripTeams.length]);
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current; const panel = panelRef.current; if (!root || !panel) return;
      // Measured on screen, so it works with the overall size (CSS zoom) and inside the scaled admin preview.
      const rr = root.getBoundingClientRect(); const pr = panel.getBoundingClientRect();
      const px = rr.height / Math.max(1, root.clientHeight); // screen px per CSS px of the root
      const cur = fitRef.current || 1;
      const top = (pr.top - rr.top) / px;
      const avail = root.clientHeight - top - Math.max(showTicker ? (portrait ? 130 : 110) : 30, reserveBottom + (showTicker ? 92 : 0));
      const h = pr.height / px / cur; // natural height before the current fit
      const k = h > avail && avail > 0 ? Math.max(0.4, Math.floor((avail / h) * 100) / 100) : 1;
      setFit((f) => (Math.abs(f - k) > 0.005 ? k : f));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (panelRef.current) ro.observe(panelRef.current);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [portrait, showTicker, stripH, reserveBottom, th.zoom]);
  // Gift legend: only the teams shown on the board (by score), so 20+ teams don't fill the header.
  const legendTeams = (() => {
    const max = portrait ? v.maxVisible ?? 5 : th.maxVisible ?? 8;
    if (config.teams.length <= max) return config.teams;
    const score = new Map((state?.teams || []).map((x) => [x.id, x.score || 0]));
    return [...config.teams].sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0)).slice(0, max);
  })();
  const parts = partsProps(th);
  const on = (k) => th.parts?.[k] !== false;
  const vars = { ...themeVars(th), ...skinVars(th), ...parts.style, background: th.background || 'transparent' };
  if (portrait) Object.assign(vars, { '--fs': (th.fontScale ?? 1) * (v.scale ?? 1), '--v-top': `${v.top ?? 170}px`, '--v-side': `${v.side ?? 28}px`, '--v-toasts-top': `${v.toastsTop ?? 1080}px`, '--v-side-w': `${v.sideWidth ?? 440}px` });

  return (
    <div className={`overlay-root${preview ? ' preview' : ''}${portrait ? ' portrait' : ''}`} data-skin={skin} data-tone={skinTone(skin, th)} data-hide={parts['data-hide']} style={{ ...vars, '--zoom': th.zoom ?? 1, '--fit': fit, '--strip-h': `${Math.max(0, pushDown)}px` }} ref={rootRef}>
      {th.sceneOnOverlay && <div className="live-bg scene-bg" />}
      {th.bgOnOverlay && <ScenePhoto theme={th} />}
      {stripTeams.length > 0 && <GiftStrip ref={stripRef} teams={stripTeams} giftMap={giftMap} s={strip} style={stripStyle} />}
      <div ref={panelRef} className={`ov-panel ${portrait ? `portrait v-${vLayout} v-align-${v.sideAlign === 'left' ? 'left' : 'right'}` : `pos-${th.position} layout-${th.layout}`}`}>
        {showHeader && (
          <header className={`ov-header glass${portrait && vHeader === 'compact' ? ' hdr-compact' : ''}`}>
            {th.showLogo && <Logo small className="ov-logo" src={th.logo} alt={config.title} />}
            <div className="ov-head-main">
              {on('title') && <div className="ov-title">{config.title}</div>}
              {on('subtitle') && config.subtitle && <div className="ov-sub">{config.subtitle}</div>}
              <div className="chips">
                {on('category') && <span className="chip"><span className="live-dot" />{config.category || 'مباشر'}</span>}
                {on('points') && <span className="chip accent"><AnimatedNumber value={state?.total || 0} /> نقطة</span>}
                {th.showViewers && <span className="chip"><Eye className="lc-inline" /> {fmt(status?.viewers || 0)}</span>}
                <RoundTimer round={round} enabled={config.rounds?.showTimer !== false} className="in-chips" />
              </div>
              {on('goal') && <GoalBar total={state?.total || 0} goal={config.goal} compact />}
              {on('followGoal') && fg?.enabled && <GoalBar total={state?.social?.follows || 0} goal={fg} compact variant="follow" />}
              {!stripTeams.length && th.showGiftLegend !== false && <GiftLegend teams={legendTeams} giftMap={giftMap} />}
            </div>
          </header>
        )}
        {!showHeader && <RoundTimer round={round} enabled={config.rounds?.showTimer !== false} className="solo" />}
        <Board
          config={config} state={state} byId={byId}
          layout={portrait ? (vLayout === 'grid' ? 'grid' : 'list') : th.layout} maxVisible={portrait ? v.maxVisible ?? 6 : th.maxVisible} flagShape={th.flagShape} gifts={gifts} showTeamGifts={th.showTeamGifts !== false}
          showContributors={portrait && vLayout !== 'list' ? false : th.showContributors} contributorsCount={th.contributorsCount}
          columns={portrait ? (vLayout === 'grid' ? Math.min(3, Math.max(1, v.columns ?? 2)) : 1) : 0} tile={portrait && vLayout !== 'list'}
        />
      </div>
      {showToasts && <Toasts list={portrait ? toasts.slice(0, Math.max(1, v.maxToasts ?? 3)) : toasts} side={portrait ? `v-${v.toastsAlign || 'center'}` : toastSide} compact={portrait} />}
      {showTicker && <Ticker ticks={ticks} />}
      <Banner banner={banner} />
      <WinnerScreen win={win} teams={config.teams} />
      {speak && !preview && <Speaker enabled={config.tts?.enabled} />}
    </div>
  );
}
