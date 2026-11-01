'use client';
import { useEffect } from 'react';
import Board from './Board';
import { Banner, Ticker, Toasts, useAlerts } from './Effects';
import { RoundTimer, WinnerScreen, useRoundWinner } from './Rounds';
import Speaker from './Speaker';
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
  const showHeader = portrait ? v.showHeader !== false : th.showHeader;
  const showToasts = portrait ? v.showToasts !== false : true;
  const showTicker = portrait ? Boolean(v.showTicker) : th.showTicker;
  const fg = config.social?.followGoal;
  const vars = { ...themeVars(th), background: th.background || 'transparent' };
  if (portrait) Object.assign(vars, { '--fs': (th.fontScale ?? 1) * (v.scale ?? 1), '--v-top': `${v.top ?? 170}px`, '--v-side': `${v.side ?? 28}px`, '--v-toasts-top': `${v.toastsTop ?? 1080}px` });

  return (
    <div className={`overlay-root${preview ? ' preview' : ''}${portrait ? ' portrait' : ''}`} data-skin={skin} style={vars}>
      {th.bgOnOverlay && <ScenePhoto theme={th} />}
      <div className={`ov-panel ${portrait ? 'portrait' : `pos-${th.position} layout-${th.layout}`}`}>
        {showHeader && (
          <header className="ov-header glass">
            {th.showLogo && <Logo small className="ov-logo" />}
            <div className="ov-head-main">
              <div className="ov-title">{config.title}</div>
              {config.subtitle && <div className="ov-sub">{config.subtitle}</div>}
              <div className="chips">
                <span className="chip"><span className="live-dot" />{config.category || 'مباشر'}</span>
                <span className="chip accent"><AnimatedNumber value={state?.total || 0} /> نقطة</span>
                {th.showViewers && <span className="chip">👁 {fmt(status?.viewers || 0)}</span>}
                <RoundTimer round={round} enabled={config.rounds?.showTimer !== false} className="in-chips" />
              </div>
              <GoalBar total={state?.total || 0} goal={config.goal} compact />
              {fg?.enabled && <GoalBar total={state?.social?.follows || 0} goal={{ ...fg, label: `💛 ${fg.label}` }} compact variant="follow" />}
              {th.showGiftLegend !== false && <GiftLegend teams={config.teams} giftMap={giftMap} />}
            </div>
          </header>
        )}
        {!showHeader && <RoundTimer round={round} enabled={config.rounds?.showTimer !== false} className="solo" />}
        <Board
          config={config} state={state} byId={byId}
          layout={portrait ? 'list' : th.layout} maxVisible={portrait ? v.maxVisible ?? 5 : th.maxVisible} flagShape={th.flagShape} gifts={gifts} showTeamGifts={th.showTeamGifts !== false}
          showContributors={th.showContributors} contributorsCount={th.contributorsCount}
        />
      </div>
      {showToasts && <Toasts list={toasts} side={toastSide} />}
      {showTicker && <Ticker ticks={ticks} />}
      <Banner banner={banner} />
      <WinnerScreen win={win} teams={config.teams} />
      {speak && !preview && <Speaker enabled={config.tts?.enabled} />}
    </div>
  );
}
