'use client';
/** The OBS overlay scene (1920x1080). Also rendered scaled in the admin Theme preview. */
import { useEffect } from 'react';
import Board from './Board';
import { Banner, Ticker, Toasts, useAlerts } from './Effects';
import { AnimatedNumber, GoalBar, Logo } from './bits';
import { ensureFont, fmt, themeVars } from '@/lib/format';

export default function Overlay({ config, state, byId, status, preview = false }) {
  const th = config.theme;
  const { toasts, ticks, banner } = useAlerts(config, { confetti: !preview });
  useEffect(() => { ensureFont(th.fontFamily); }, [th.fontFamily]);
  // Toasts go to the side opposite the board when they would overlap.
  const toastSide = th.layout === 'list' && th.position === th.toastPosition ? (th.position === 'left' ? 'right' : 'left') : th.toastPosition;

  return (
    <div className={`overlay-root${preview ? ' preview' : ''}`} style={{ ...themeVars(th), background: th.background || 'transparent' }}>
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
            </div>
          </header>
        )}
        <Board
          config={config} state={state} byId={byId}
          layout={th.layout} maxVisible={th.maxVisible}
          showContributors={th.showContributors} contributorsCount={th.contributorsCount}
        />
      </div>
      <Toasts list={toasts} side={toastSide} />
      {th.showTicker && <Ticker ticks={ticks} />}
      <Banner banner={banner} />
    </div>
  );
}
