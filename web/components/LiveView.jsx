'use client';
/**
 * Public live page content (used by / and by the admin preview).
 * Applies the active look (data-skin), the background picture and team photos.
 */
import { useMemo } from 'react';
import Board from './Board';
import { Banner, useAlerts } from './Effects';
import { ScenePhoto } from './Overlay';
import { RoundTimer, WinnerScreen, useRoundWinner } from './Rounds';
import { AnimatedNumber, Avatar, Flag, GiftIcon, GoalBar, Logo } from './bits';
import { findGift, useGiftMap } from '@/lib/gifts';
import { ensureFont, fmt, fontVars, safeUrl } from '@/lib/format';
import { useEffect } from 'react';
import { useActiveSkin } from '@/lib/skins';

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `منذ ${s} ث`;
  const m = Math.round(s / 60);
  return m < 60 ? `منذ ${m} د` : `منذ ${Math.round(m / 60)} س`;
}

export default function LiveView({ config, state, byId, status, gifts, round, connected = true, preview = false }) {
  const [win] = useRoundWinner({ confetti: !preview });
  const giftMap = useGiftMap(gifts);
  const { feed, banner } = useAlerts(config, { toasts: false, confetti: !preview });
  const skin = useActiveSkin(config?.theme);
  const th = config?.theme || {};
  const rootProps = { className: `live-root${preview ? ' preview' : ''}`, 'data-skin': skin, style: { '--name-g': th.nameScale ?? 1, '--flag-scale': th.flagScale ?? 1, ...fontVars(th) } };
  useEffect(() => { ensureFont(th.fontFamily); ensureFont(th.titleFont); }, [th.fontFamily, th.titleFont]);

  const supporters = useMemo(() => {
    if (!state || !config) return [];
    const teams = new Map(config.teams.map((t) => [t.id, t]));
    return state.teams.flatMap((t) => (t.top || []).map((u) => ({ ...u, team: teams.get(t.id) })))
      .filter((u) => u.team).sort((a, b) => b.p - a.p).slice(0, 10);
  }, [state, config]);

  if (!config || !state) {
    return (
      <div {...rootProps}><div className="live-bg" /><div className="live-loading"><Logo className="live-logo pulse" /><p>جارٍ الاتصال بالبث…</p></div></div>
    );
  }
  const totalSupporters = state.teams.reduce((n, t) => n + (t.supporters || 0), 0);
  const isLive = status?.state === 'connected' || status?.demo;
  const leader = config.teams.find((t) => t.id === state.leaderId);

  return (
    <div {...rootProps}>
      <div className="live-bg" />
      {th.bgOnLive && <ScenePhoto theme={th} />}
      <header className="live-hero">
        <Logo className="live-logo" />
        <div className="live-hero-text">
          <span className={`live-badge${isLive ? ' on' : ''}`}><span className="live-dot" />{isLive ? 'مباشر الآن' : 'البث متوقف'}{status?.username ? ` · @${status.username}` : ''}</span>
          <h1 className="live-title">{config.title}</h1>
          {config.subtitle && <p className="live-sub">{config.subtitle}</p>}
          <div className="live-stats">
            <div className="stat"><span className="stat-v num-latin"><AnimatedNumber value={state.total} /></span><span className="stat-l">إجمالي النقاط</span></div>
            <div className="stat"><span className="stat-v">{leader ? <><span className="stat-flag"><Flag team={leader} /></span> {leader.name}</> : '—'}</span><span className="stat-l">المتصدر</span></div>
            <div className="stat"><span className="stat-v num-latin">{fmt(totalSupporters)}</span><span className="stat-l">الداعمون</span></div>
            {status?.viewers > 0 && <div className="stat"><span className="stat-v num-latin">{fmt(status.viewers)}</span><span className="stat-l">المشاهدون</span></div>}
          </div>
        </div>
      </header>

      {(config.goal?.enabled || config.social?.followGoal?.enabled || round?.status === 'running') && (
        <section className="surface live-goal">
          {round?.status === 'running' && config.rounds?.showTimer !== false && <div className="live-timer"><RoundTimer round={round} /></div>}
          {config.goal?.enabled && <GoalBar total={state.total} goal={config.goal} />}
          {config.social?.followGoal?.enabled && <GoalBar total={state.social?.follows || 0} goal={{ ...config.social.followGoal, label: `💛 ${config.social.followGoal.label}` }} variant="follow" />}
        </section>
      )}

      <main className="live-grid">
        <section className="surface live-board" style={{ '--fs': 'var(--live-fs)' }}>
          <div className="surface-head"><h2>ترتيب {config.category || 'الفرق'}</h2><span className="muted">يتحدّث مباشرة</span></div>
          <Board config={config} state={state} byId={byId} layout="list" maxVisible={16} showContributors contributorsCount={3} flagShape={th.flagShape} gifts={gifts} showTeamGifts={th.showTeamGifts !== false} />
        </section>

        <aside className="live-side">
          <section className="surface">
            <div className="surface-head"><h2>🎁 أحدث الهدايا</h2></div>
            {feed.length === 0 ? <p className="muted empty">بانتظار أول هدية…</p> : (
              <ul className="feed">
                {feed.slice(0, 12).map((f) => (
                  <li key={f.id} className={f.major ? 'major' : ''} style={{ '--team': f.team?.color }}>
                    <Avatar src={f.user.avatar} name={f.user.nickname} color={f.team?.color} className="avatar lg" />
                    <div className="feed-main">
                      <b>{f.user.nickname}</b>
                      <span className="muted">أرسل <bdi dir="ltr">{f.gift.name} ×{f.gift.count}</bdi> لـ {f.team?.emoji} {f.team?.name}</span>
                    </div>
                    <GiftIcon gift={{ name: f.gift.name, image: f.gift.image || findGift(giftMap, f.gift.name)?.image }} className="feed-gift" />
                    <div className="feed-pts"><b>+{fmt(f.points)}</b><span className="muted">{timeAgo(f.ts)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface">
            <div className="surface-head"><h2>🏆 أكبر الداعمين</h2></div>
            {supporters.length === 0 ? <p className="muted empty">لا يوجد داعمون بعد</p> : (
              <ol className="leaders">
                {supporters.map((u, i) => (
                  <li key={`${u.team.id}-${u.u || u.n}-${i}`}>
                    <span className={`pos p${i + 1}`}>{i + 1}</span>
                    <Avatar src={u.a} name={u.n} color={u.team.color} className="avatar lg" />
                    <div className="feed-main"><b>{u.n || u.u}</b><span className="muted">{u.team.emoji} {u.team.name}</span></div>
                    <b className="num-latin">{fmt(u.p)}</b>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="surface how">
            <div className="surface-head"><h2>كيف تشارك؟</h2></div>
            <ol className="steps">
              {config.scoring?.giftMode === 'giftOnly' ? (
                <>
                  <li><b>كل دولة لها هدية:</b> انظر الهدية بجانب علم دولتك أدناه.</li>
                  <li><b>أرسل هدية دولتك:</b> كل هدية تضيف نقاطاً لدولتك تلقائياً.</li>
                </>
              ) : (
                <>
                  <li><b>أرسل هدية فريقك</b> (أدناه) فتُحسب له تلقائياً،</li>
                  <li><b>أو اكتب اسم فريقك</b> في الشات ثم أرسل أي هدية.</li>
                </>
              )}
              <li><b>ساعد فريقك على الوصول للمليون!</b> 🏆</li>
            </ol>
            <div className="team-chips">
              {config.teams.map((t) => (
                <span key={t.id} className="team-chip" style={{ '--team': t.color }}>
                  <span className="chip-flag"><Flag team={t} /></span> {t.name}
                  {t.gifts.length > 0 && <span className="chip-gifts">{t.gifts.map((n) => <span key={n} className="chip-gift"><GiftIcon gift={findGift(giftMap, n)} name={n} className="gift-icon sm" /><small>{n}</small></span>)}</span>}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </main>

      <footer className="live-foot">
        <span>© {new Date().getFullYear()} Koydam</span>
        <a href="https://koydam.com" target="_blank" rel="noopener">koydam.com</a>
      </footer>
      <Banner banner={banner} />
      <WinnerScreen win={win} teams={config.teams} />
      {!connected && <div className="offline-pill">جارٍ إعادة الاتصال…</div>}
    </div>
  );
}
