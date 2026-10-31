'use client';
/** The OBS overlay scene (1920x1080). Also rendered scaled in the admin Theme preview. */
import { useEffect } from 'react';
import Board from './Board';
import { Banner, Ticker, Toasts, useAlerts } from './Effects';
import { AnimatedNumber, GiftLegend, GoalBar, Logo } from './bits';
import { useGiftMap } from '@/lib/gifts';
import { ensureFont, fmt, safeUrl, themeVars } from '@/lib/format';
import { useActiveSkin } from '@/lib/skins';

/** Background picture layer (dimmed, optional blur). */
export function ScenePhoto({ theme }) {
  const url = safeUrl(theme.bgImage);
  if (!url) return null;
  const blur = theme.bgBlur || 0;
  return <div className="scene-photo" style={{ backgroundImage: `url("${url}")`, '--bg-dim': theme.bgDim ?? 0.55, filter: blur ? `blur(${blur}px)` : undefined, transform: blur ? 'scale(1.06)' : undefined }} />;
}

export default function Overlay({ config, state, byId, status, gifts, preview = false }) {
  const th = config.theme;
  const { toasts, ticks, banner } = useAlerts(config, { confetti: !preview });
  const skin = useActiveSkin(th);
  const giftMap = useGiftMap(gifts);
  useEffect(() => { ensureFont(th.fontFamily); ensureFont(th.titleFont); }, [th.fontFamily, th.titleFont]);
  // Toasts go to the side opposite the board when they would overlap.
  const toastSide = th.layout === 'list' && th.position === th.toastPosition ? (th.position === 'left' ? 'right' : 'left') : th.toastPosition;

  return (
    <div className={`overlay-root${preview ? ' preview' : ''}`} data-skin={skin} style={{ ...themeVars(th), background: th.background || 'transparent' }}>
      {th.bgOnOverlay && <ScenePhoto theme={th} />}
      <div className={`ov-panel pos-${th.position} layout-${th.layout}`}>
        {th.showHeader && (
          <header className="ov-header glass">
            {th.showLogo && <Logo small className="ov-logo" />}
            <div className="ov-head-main">
              <div className="ov-title">{config.title}</div>
              {config.subtitle && <div className="ov-sub">{config.subtitle}</div>}
              <div className="chips">
                <span className="chip"><span className="live-dot" />{config.category || 'مباشر'}</span>
                <span className="chip accent"><AnimatedNumber value={state?.total || 0} /> نقطة</span>
                {th.showViewers && <span className="chip">👁 {fmt(status?.viewers || 0)}</span>}
              </div>
              <GoalBar total={state?.total || 0} goal={config.goal} compact />
              {th.showGiftLegend !== false && <GiftLegend teams={config.teams} giftMap={giftMap} />}
            </div>
          </header>
        )}
        <Board
          config={config} state={state} byId={byId}
          layout={th.layout} maxVisible={th.maxVisible} flagShape={th.flagShape} gifts={gifts} showTeamGifts={th.showTeamGifts !== false}
          showContributors={th.showContributors} contributorsCount={th.contributorsCount}
        />
      </div>
      <Toasts list={toasts} side={toastSide} />
      {th.showTicker && <Ticker ticks={ticks} />}
      <Banner banner={banner} />
    </div>
  );
}
