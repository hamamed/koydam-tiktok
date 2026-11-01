'use client';
import { Heart, Eye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cmd, getStoreLive, liveQuery } from '@/lib/store';
import { fmt } from '@/lib/format';
import { useAlerts } from '../Effects';
import { AnimatedNumber, Avatar, Flag, GoalBar, TeamName } from '../bits';
import { Btn, CopyField, Field, Icon, Section, Text } from './ui';

function useConnActions(live, notice) {
  const [busy, setBusy] = useState('');
  const run = async (key, action, payload, ok) => {
    setBusy(key);
    try { await cmd(action, payload); if (ok) notice(ok); } catch (e) { notice(e.message, 'err'); } finally { setBusy(''); }
  };
  return {
    busy,
    connect: (u) => run('connect', 'connect', { username: u }, `جارٍ الاتصال بـ @${u.replace(/^@/, '')}…`),
    disconnect: () => run('disconnect', 'disconnect', {}, 'تم قطع الاتصال'),
    demo: () => run('demo', 'demo', { enabled: !live.status?.demo }, live.status?.demo ? 'تم إيقاف الوضع التجريبي' : 'تم تشغيل الوضع التجريبي'),
    reset: () => { if (confirm('إعادة كل النقاط إلى الصفر؟')) run('reset', 'reset', { keepAllegiance: true }, 'تمت إعادة النتائج'); },
  };
}

function statusText(st, connected) {
  if (!connected) return ['err', 'الخادم غير متصل', 'تعذر الوصول إلى الخادم. جارٍ إعادة المحاولة…'];
  const retry = st.nextRetryAt ? ` (محاولة ${st.attempt} بعد ${Math.max(0, Math.ceil((st.nextRetryAt - Date.now()) / 1000))} ث)` : '';
  switch (st.state) {
    case 'connected': return ['ok', `متصل بـ @${st.username}`, st.roomId ? `الغرفة ${st.roomId}` : ''];
    case 'connecting': return ['warn', 'جارٍ الاتصال…', st.message || ''];
    case 'reconnecting': return ['warn', 'إعادة الاتصال…', (st.message || '') + retry];
    case 'offline': return ['warn', 'البث متوقف', `@${st.username} ليس في بث مباشر الآن. سنحاول تلقائياً${retry}`];
    case 'error': return ['err', 'خطأ', st.message || ''];
    default: return ['idle', 'غير متصل بتيك توك', 'أدخل اسم المستخدم واضغط «اتصال»'];
  }
}

export function Overview({ live, notice, go }) {
  const { config, state, status } = live;
  const { feed } = useAlerts(config, { toasts: false, confetti: false });
  const a = useConnActions(live, notice);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const ranked = useMemo(() => config.teams.map((t) => ({ t, d: live.byId.get(t.id) || { score: 0, supporters: 0, top: [] } }))
    .sort((x, y) => y.d.score - x.d.score), [config, live.byId]);
  const total = state?.total || 0;
  const supporters = (state?.teams || []).reduce((n, t) => n + (t.supporters || 0), 0);
  const leader = ranked[0]?.d.score > 0 ? ranked[0].t : null;
  const [kind, title, sub] = statusText(status || {}, live.connected);

  return (
    <div className="a-grid">
      <div className="a-kpis">
        <div className="a-kpi gold"><Icon name="trophy" /><div><span>إجمالي النقاط</span><b className="num-latin"><AnimatedNumber value={total} /></b></div></div>
        <div className="a-kpi"><Icon name="flag" /><div><span>المتصدر</span><b>{leader ? <TeamName team={leader} /> : '—'}</b></div></div>
        <div className="a-kpi"><Icon name="users" /><div><span>الداعمون</span><b className="num-latin">{fmt(supporters)}</b></div></div>
        <div className="a-kpi"><Icon name="eye" /><div><span>المشاهدون</span><b className="num-latin">{fmt(status?.viewers || 0)}</b></div></div>
        <div className="a-kpi"><span className="a-kpi-ico"><Heart /></span><div><span>متابعون جدد</span><b className="num-latin">{fmt(state?.social?.follows || 0)}</b></div></div>
        <div className="a-kpi"><Icon name="trophy" /><div><span>الجولة</span><b className="num-latin">{live.round?.status === 'running' ? `#${live.round.number} جارية` : live.round?.number ? `#${live.round.number}` : '—'}</b></div></div>
      </div>

      <Section title="حالة البث" className="span-2" actions={<Btn size="sm" variant="ghost" icon="plug" onClick={() => go('connection')}>إعدادات الاتصال</Btn>}>
        <div className={`a-conn ${kind}`}>
          <span className="a-conn-dot" />
          <div className="a-conn-text"><b>{title}</b><span className="a-muted">{sub}</span></div>
          <div className="a-actions">
            {status?.state && status.state !== 'idle'
              ? <Btn variant="ghost" icon="stop" busy={a.busy === 'disconnect'} onClick={a.disconnect}>قطع</Btn>
              : <Btn variant="gold" icon="play" onClick={() => go('connection')}>اتصال</Btn>}
            <Btn variant={status?.demo ? 'red' : 'ghost'} icon="dice" busy={a.busy === 'demo'} onClick={a.demo}>{status?.demo ? 'إيقاف التجريبي' : 'وضع تجريبي'}</Btn>
            <Btn variant="ghost" icon="trash" busy={a.busy === 'reset'} onClick={a.reset}>جولة جديدة</Btn>
          </div>
        </div>
        {config.goal?.enabled && <div className="a-goal"><GoalBar total={total} goal={config.goal} /></div>}
      </Section>

      <Section title="الترتيب المباشر" desc={`${config.teams.length} ${config.category || 'فرق'}`}>
        <div className="a-standings">
          {ranked.map(({ t, d }, i) => (
            <div key={t.id} className="a-stand" style={{ '--team': t.color }}>
              <span className={`a-pos p${i + 1}`}>{i + 1}</span>
              <span className="a-stand-flag emoji"><Flag team={t} /></span>
              <div className="a-stand-main">
                <div className="a-stand-row"><b>{t.name}</b><span className="num-latin">{fmt(d.score)}</span></div>
                <div className="a-stand-bar"><i style={{ width: `${ranked[0].d.score ? (d.score / ranked[0].d.score) * 100 : 0}%` }} /></div>
                <span className="a-muted">{fmt(d.supporters || 0)} داعم{d.top?.[0] ? ` · الأول: ${d.top[0].n}` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="آخر النشاط" desc="الهدايا لحظة وصولها">
        {feed.length === 0 ? <p className="a-empty">لا توجد هدايا بعد. جرّب «الوضع التجريبي» أو أدوات المحاكاة.</p> : (
          <ul className="a-feed">
            {feed.slice(0, 10).map((f) => (
              <li key={f.id} className={f.major ? 'major' : ''} style={{ '--team': f.team?.color }}>
                <Avatar src={f.user.avatar} name={f.user.nickname} color={f.team?.color} className="avatar md" />
                <div><b>{f.user.nickname}</b><span className="a-muted"><bdi dir="ltr">{f.gift.name} ×{f.gift.count}</bdi> ← <TeamName team={f.team} /></span></div>
                <b className="num-latin a-gold">+{fmt(f.points)}</b>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function Connection({ live, notice }) {
  const portraitOnly = live.config?.theme?.portraitOnly !== false;
  const st = live.status || {};
  const [user, setUser] = useState(st.username || '');
  useEffect(() => { if (!user && st.username) setUser(st.username); }, [st.username]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useConnActions(live, notice);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const [kind, title, sub] = statusText(st, live.connected);
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const q = liveQuery(getStoreLive());

  return (
    <div className="a-grid">
      <Section title="حساب تيك توك" desc="الخادم يعيد الاتصال تلقائياً إذا انقطع البث، ويتذكر الحساب بعد إعادة التشغيل." className="span-2">
        <div className={`a-conn ${kind}`}>
          <span className="a-conn-dot" />
          <div className="a-conn-text"><b>{title}</b><span className="a-muted">{sub}</span></div>
          {st.viewers > 0 && <span className="a-chip num-latin"><Eye className="lc-inline" /> {fmt(st.viewers)}</span>}
        </div>
        <form className="a-row" onSubmit={(e) => { e.preventDefault(); if (user.trim()) a.connect(user.trim()); }}>
          <Field label="اسم مستخدم صاحب البث (بدون @)" wide>
            <input className="a-input num-latin" dir="ltr" value={user} onChange={(e) => setUser(e.target.value)} placeholder="username" />
          </Field>
          <Btn variant="gold" icon="play" type="submit" busy={a.busy === 'connect'}>اتصال</Btn>
          <Btn variant="ghost" icon="stop" busy={a.busy === 'disconnect'} onClick={a.disconnect}>قطع الاتصال</Btn>
          <Btn variant={st.demo ? 'red' : 'ghost'} icon="dice" busy={a.busy === 'demo'} onClick={a.demo}>{st.demo ? 'إيقاف التجريبي' : 'وضع تجريبي'}</Btn>
        </form>
      </Section>

      {portraitOnly ? <>
      <Section title="📱 واجهة OBS العمودية (تيك توك)" className={portraitOnly ? 'span-2' : ''}
        desc="Browser Source بالمقاس: العرض Width = 1080 والارتفاع Height = 1920. واجعل دقة OBS نفسها عمودية: Settings ← Video ← 1080x1920. فعّل «Control audio via OBS» لسماع القراءة الصوتية.">
        <CopyField value={`${origin}/overlay-vertical/${q}`} />
        <div className="a-row"><a className="a-btn ghost sm" href={`/overlay-vertical/${q}`} target="_blank" rel="noopener"><Icon name="external" size={15} /><span>فتح المعاينة</span></a></div>
      </Section>
      </> : <>
      <Section title="🖥️ واجهة OBS الأفقية" desc="Browser Source بالمقاس 1920×1080. إذا وضعت هذا الرابط في مصدر عمودي يتحول تلقائياً للتصميم العمودي.">
        <CopyField value={`${origin}/overlay/${q}`} />
        <div className="a-row"><a className="a-btn ghost sm" href={`/overlay/${q}`} target="_blank" rel="noopener"><Icon name="external" size={15} /><span>فتح المعاينة</span></a></div>
      </Section>
      <Section title="📱 واجهة OBS العمودية (تيك توك)" className={portraitOnly ? 'span-2' : ''}
        desc="Browser Source بالمقاس: العرض Width = 1080 والارتفاع Height = 1920. واجعل دقة OBS نفسها عمودية: Settings ← Video ← 1080x1920. فعّل «Control audio via OBS» لسماع القراءة الصوتية.">
        <CopyField value={`${origin}/overlay-vertical/${q}`} />
        <div className="a-row"><a className="a-btn ghost sm" href={`/overlay-vertical/${q}`} target="_blank" rel="noopener"><Icon name="external" size={15} /><span>فتح المعاينة</span></a></div>
      </Section>
      </>}

      <Section title="الصفحة المباشرة للجمهور" desc="شارك هذا الرابط مع المتابعين لمشاهدة الترتيب على الهاتف.">
        <CopyField value={`${origin}/${q}`} />
        <div className="a-row"><a className="a-btn ghost sm" href={`/${q}`} target="_blank" rel="noopener"><Icon name="external" size={15} /><span>فتح الصفحة</span></a></div>
      </Section>
    </div>
  );
}
