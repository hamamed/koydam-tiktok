'use client';
/** Public live page for viewers: https://tiktok.koydam.com */
import { useMemo } from 'react';
import Board from '@/components/Board';
import { Banner, useAlerts } from '@/components/Effects';
import { AnimatedNumber, Avatar, GoalBar, Logo } from '@/components/bits';
import { useLive } from '@/lib/store';
import { fmt, safeUrl } from '@/lib/format';

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `منذ ${s} ث`;
  const m = Math.round(s / 60);
  return m < 60 ? `منذ ${m} د` : `منذ ${Math.round(m / 60)} س`;
}

export default function LivePage() {
  const live = useLive();
  const { config, state, byId, status } = live;
  const { feed, banner } = useAlerts(config, { toasts: false });

  const supporters = useMemo(() => {
    if (!state || !config) return [];
    const teams = new Map(config.teams.map((t) => [t.id, t]));
    return state.teams.flatMap((t) => (t.top || []).map((u) => ({ ...u, team: teams.get(t.id) })))
      .filter((u) => u.team).sort((a, b) => b.p - a.p).slice(0, 10);
  }, [state, config]);

  if (!config || !state) {
    return (
      <div className="live-root"><div className="live-bg" /><div className="live-loading"><Logo className="live-logo pulse" /><p>جارٍ الاتصال بالبث…</p></div></div>
    );
  }
  const totalSupporters = state.teams.reduce((n, t) => n + (t.supporters || 0), 0);
  const isLive = status?.state === 'connected' || status?.demo;
  const leader = config.teams.find((t) => t.id === state.leaderId);

  return (
    <div className="live-root">
      <div className="live-bg" />
      <header className="live-hero">
        <Logo className="live-logo" />
        <div className="live-hero-text">
          <span className={`live-badge${isLive ? ' on' : ''}`}><span className="live-dot" />{isLive ? 'مباشر الآن' : 'البث متوقف'}{status?.username ? ` · @${status.username}` : ''}</span>
          <h1 className="live-title">{config.title}</h1>
          {config.subtitle && <p className="live-sub">{config.subtitle}</p>}
          <div className="live-stats">
            <div className="stat"><span className="stat-v num-latin"><AnimatedNumber value={state.total} /></span><span className="stat-l">إجمالي النقاط</span></div>
            <div className="stat"><span className="stat-v">{leader ? `${leader.emoji} ${leader.name}` : '—'}</span><span className="stat-l">المتصدر</span></div>
            <div className="stat"><span className="stat-v num-latin">{fmt(totalSupporters)}</span><span className="stat-l">الداعمون</span></div>
            {status?.viewers > 0 && <div className="stat"><span className="stat-v num-latin">{fmt(status.viewers)}</span><span className="stat-l">المشاهدون</span></div>}
          </div>
        </div>
      </header>

      {config.goal?.enabled && <section className="surface live-goal"><GoalBar total={state.total} goal={config.goal} /></section>}

      <main className="live-grid">
        <section className="surface live-board" style={{ '--fs': 'var(--live-fs)' }}>
          <div className="surface-head"><h2>ترتيب {config.category || 'الفرق'}</h2><span className="muted">يتحدّث مباشرة</span></div>
          <Board config={config} state={state} byId={byId} layout="list" maxVisible={16} showContributors contributorsCount={3} />
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
                    {safeUrl(f.gift.image) && <img className="feed-gift" src={f.gift.image} alt="" referrerPolicy="no-referrer" />}
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
                  <li key={`${u.team.id}-${u.u || u.n}`}>
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
              <li><b>اختر فريقك:</b> اكتب اسمه أو علمه في شات البث.</li>
              <li><b>أرسل الهدايا:</b> كل هدية تضيف نقاطاً لفريقك.</li>
              <li><b>ساعد فريقك على الوصول للمليون!</b> 🏆</li>
            </ol>
            <div className="team-chips">
              {config.teams.map((t) => (
                <span key={t.id} className="team-chip" style={{ '--team': t.color }}>
                  <span className="emoji">{t.emoji}</span> {t.name}
                  {t.gifts.length > 0 && <small> · {t.gifts.join('، ')}</small>}
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
      {!live.connected && <div className="offline-pill">جارٍ إعادة الاتصال…</div>}
    </div>
  );
}
