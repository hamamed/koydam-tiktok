'use client';
/**
 * Live alerts from server events: gift toasts (combo streaks update one toast),
 * the ticker, the "takes the lead" banner and confetti.
 */
import { useEffect, useRef, useState } from 'react';
import { onLiveEvent } from '@/lib/store';
import { confettiBurst, confettiRain } from '@/lib/confetti';
import { fmt, safeUrl } from '@/lib/format';
import { Avatar, Flag, TeamName, teamImage } from './bits';


export function useAlerts(config, { confetti = true, toasts = true } = {}) {
  const cfg = useRef(config);
  cfg.current = config;
  const [toastList, setToasts] = useState([]);
  const [ticks, setTicks] = useState([]);
  const [banner, setBanner] = useState(null);
  const [feed, setFeed] = useState([]);
  const timers = useRef(new Map());

  useEffect(() => {
    const teamOf = (id) => cfg.current?.teams.find((t) => t.id === id);
    const addTick = (team, parts) => setTicks((t) => [{ id: Math.random(), team, parts }, ...t].slice(0, 20));
    const dismiss = (key) => {
      setToasts((l) => l.map((x) => (x.key === key ? { ...x, out: true } : x)));
      setTimeout(() => setToasts((l) => l.filter((x) => x.key !== key)), 420);
    };
    const arm = (key) => {
      clearTimeout(timers.current.get(key));
      timers.current.set(key, setTimeout(() => dismiss(key), cfg.current?.alerts?.toastDurationMs || 5000));
    };

    return onLiveEvent((ev) => {
      const c = cfg.current; if (!c) return;
      const a = c.alerts || {};
      const team = ev.teamId ? teamOf(ev.teamId) : null;
      switch (ev.kind) {
        case 'gift': {
          setFeed((f) => {
            // Combo streaks update their existing line instead of adding one per tick.
            const i = ev.streakKey ? f.findIndex((x) => x.streakKey === ev.streakKey) : -1;
            if (i >= 0) {
              const n = [...f];
              n[i] = { ...n[i], ts: ev.ts, gift: ev.gift, points: n[i].points + ev.points, major: n[i].major || ev.major };
              return n;
            }
            return [{ id: Math.random(), streakKey: ev.streakKey, ts: ev.ts, team, user: ev.user, gift: ev.gift, points: ev.points, major: ev.major }, ...f].slice(0, 30);
          });
          if (toasts) {
            const key = ev.streakKey || `g${Math.random()}`;
            setToasts((list) => {
              const ex = list.find((x) => x.key === key && !x.out);
              if (ex) {
                return list.map((x) => (x === ex ? { ...x, count: ev.gift.count, points: x.points + ev.points, combo: x.combo + 1, major: x.major || ev.major || x.points + ev.points >= a.majorGiftPoints } : x));
              }
              const next = [{ key, team, user: ev.user, gift: ev.gift, count: ev.gift.count, points: ev.points, major: ev.major, combo: 0 }, ...list];
              next.filter((x) => !x.out).slice(a.maxToasts || 5).forEach((x) => setTimeout(() => dismiss(x.key), 0));
              return next;
            });
            arm(key);
          }
          addTick(team, [['b', ev.user.nickname], ['', ' '], ...(safeUrl(ev.gift.image) ? [['img', ev.gift.image]] : []), ['g', `${ev.gift.name} ×${ev.gift.count}`], ['', ' ← '], ['team', team], ['', ' '], ['tp', `+${fmt(ev.points)}`]]);
          if (ev.major && confetti) {
            const el = document.querySelector(`[data-team-card="${ev.teamId}"]`);
            const r = el && el.offsetParent ? el.getBoundingClientRect() : null;
            const colors = [team?.color || '#f5b301', '#ffd54a', '#ffffff'];
            confettiBurst(r ? r.left + r.width * 0.25 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2, colors, 90);
          }
          break;
        }
        case 'join':
          if (a.showJoins) addTick(team, [['', '👋 '], ['b', ev.user.nickname], ['', ' انضم إلى '], ['team', team], ...(ev.points ? [['tp', ` +${fmt(ev.points)}`]] : [])]);
          break;
        case 'unassigned':
          if (a.showUnassigned) {
            addTick(null, c.scoring?.giftMode === 'giftOnly'
              ? [['b', ev.user.nickname], ['', ' أرسل '], ['g', ev.gift.name], ['', ' ولا تُحسب. أرسل هدية دولتك لتُحسب! 🎁']]
              : [['b', ev.user.nickname], ['', ` أرسل ${ev.gift.name}. اكتب اسم فريقك في الشات لتُحسب! 🙏`]]);
          }
          break;
        case 'follow':
        case 'share': {
          const so = c.social || {};
          const isFollow = ev.kind === 'follow';
          if (isFollow ? so.followAlerts === false : so.shareAlerts === false) break;
          if (toasts) {
            const key = `${ev.kind}${Math.random()}`;
            setToasts((list) => {
              const next = [{ key, kind: ev.kind, team, user: ev.user, points: ev.points }, ...list];
              next.filter((x) => !x.out).slice(a.maxToasts || 5).forEach((x) => setTimeout(() => dismiss(x.key), 0));
              return next;
            });
            arm(key);
          }
          addTick(team, [['', isFollow ? '💛 ' : '🔁 '], ['b', ev.user.nickname], ['', isFollow ? ' تابع البث' : ' شارك البث'], ...(team ? [['', ' ('], ['team', team], ['', ')']] : []), ...(ev.points ? [['tp', ` +${fmt(ev.points)}`]] : [])]);
          break;
        }
        case 'roundStart':
          addTick(null, [['b', `⏱️ بدأت الجولة ${ev.number}! أرسل هدية دولتك الآن`]]);
          break;
        case 'roundEnd':
          addTick(ev.winner ? teamOf(ev.winner.id) : null, [['', '🏆 '], ['b', ev.winner ? `${ev.winner.name} بطل الجولة ${ev.number}!` : `انتهت الجولة ${ev.number}`]]);
          break;
        case 'takeover':
          if (team) {
            setBanner({ key: Math.random(), team, prev: ev.prevTeamId ? teamOf(ev.prevTeamId) : null });
            addTick(team, [['', '👑 '], ['team', team], ['', ' يتصدّر الآن!']]);
            if (a.confettiOnTakeover && confetti) confettiRain([team.color, '#ffd54a', '#ffffff'], 140, team.emoji);
          }
          break;
        case 'reset':
          setToasts([]); setFeed([]);
          setTicks([{ id: Math.random(), team: null, parts: [['b', '🔄 تمت إعادة النتائج. جولة جديدة تبدأ الآن!']] }]);
          break;
        default: break;
      }
    });
  }, [confetti, toasts]);

  useEffect(() => { if (!banner) return; const t = setTimeout(() => setBanner(null), 3600); return () => clearTimeout(t); }, [banner]);
  return { toasts: toastList, ticks, banner, feed, showBanner: setBanner };
}

export function Toasts({ list, side = 'left' }) {
  return (
    <div className={`toasts side-${side}`}>
      {list.map((t) => (t.kind === 'follow' || t.kind === 'share' ? (
        <div key={t.key} className={`toast glass social ${t.kind}${t.out ? ' out' : ''}`} style={{ '--team': t.team?.color }}>
          <Avatar src={t.user.avatar} name={t.user.nickname} color={t.team?.color} />
          <div className="tbody">
            <div className="tuser">{t.user.nickname}</div>
            <div className="tline">{t.kind === 'follow' ? 'تابع البث! شكراً 💛' : 'شارك البث! 🔁'}{t.team && <> · <TeamName team={t.team} className="tteam team-inline" /></>}</div>
          </div>
          <div className="tsocial emoji">{t.kind === 'follow' ? '💛' : '🔁'}</div>
          {t.points > 0 && <div className="tpts">+{fmt(t.points)}</div>}
        </div>
      ) : (
        <div key={t.key} className={`toast glass${t.major ? ' major' : ''}${t.out ? ' out' : ''}`} style={{ '--team': t.team?.color }}>
          <Avatar src={t.user.avatar} name={t.user.nickname} color={t.team?.color} />
          <div className="tbody">
            <div className="tuser">{t.user.nickname}</div>
            <div className="tline">
              أرسل <bdi dir="ltr" className="tgift">{t.gift.name} <span key={t.combo} className="tcount">×{t.count}</span></bdi> لـ <TeamName team={t.team} className="tteam team-inline" />
            </div>
          </div>
          {safeUrl(t.gift.image) && <img className="gimg" src={t.gift.image} alt="" referrerPolicy="no-referrer" />}
          <div className="tpts">+{fmt(t.points)}</div>
        </div>
      )))}
    </div>
  );
}

export function Ticker({ ticks }) {
  return (
    <div className="ticker glass">
      <div className="ticker-label"><span className="live-dot" />مباشر</div>
      <div className="ticker-items">
        {ticks.map((t) => (
          <span key={t.id} className="tick" style={{ '--team': t.team?.color }}>
            {t.parts.map(([cls, text], i) => (cls === 'team' ? <TeamName key={i} team={text} /> : cls === 'b' ? <b key={i}>{text}</b> : cls === 'g' ? <bdi key={i} dir="ltr" className="tg">{text}</bdi> : cls === 'img' ? <img key={i} className="tick-gift" src={text} alt="" referrerPolicy="no-referrer" /> : cls ? <span key={i} className={cls}>{text}</span> : <span key={i}>{text}</span>))}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Banner({ banner }) {
  if (!banner) return null;
  const { team, prev } = banner;
  return (
    <div key={banner.key} className="banner glass show" style={{ '--team': team.color, borderColor: team.color }}>
      <span className="bflag emoji">{teamImage(team) ? <span className="bphoto"><Flag team={team} /></span> : team.emoji || '🏆'}</span>
      <div className="btext">{team.name} يتصدّر!</div>
      <div className="bsub">{prev ? <>تجاوز <TeamName team={prev} /></> : 'أول النقاط! 🔥'}</div>
    </div>
  );
}
