'use client';
/** Admin pages: Rounds, Voice (Arabic TTS), Stream reports. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cmd, getStoreLive } from '@/lib/store';
import { fmt, safeUrl } from '@/lib/format';
import { useRoundClock } from '../Rounds';
import { Avatar, Flag, GiftIcon } from '../bits';
import { Btn, Field, Icon, Num, Range, Section, Select, Text, Toggle } from './ui';

const dt = (t) => (t ? new Date(t).toLocaleString('ar-MA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m} د`; };

/* ======================================================================== */
export function RoundsPage({ live, draft, edit, notice }) {
  const r = draft.rounds;
  const set = (k) => (v) => edit((c) => { c.rounds[k] = v; });
  const round = live.round || { status: 'idle', number: 0 };
  const clock = useRoundClock(round);
  const [mins, setMins] = useState(r.durationMin);
  const [hist, setHist] = useState(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => { try { setHist((await api('/api/rounds')).history); } catch (e) { notice(e.message, 'err'); } }, [notice]);
  useEffect(() => { load(); }, [load, round.status, round.number]);
  const run = async (key, action, payload, ok) => {
    setBusy(key);
    try { await cmd(action, payload); if (ok) notice(ok); } catch (e) { notice(e.message, 'err'); } finally { setBusy(''); }
  };
  const teamOf = (id) => live.config.teams.find((t) => t.id === id);

  return (
    <div className="a-grid">
      <Section title="⏱️ الجولة الحالية" className="span-2">
        <div className={`a-round ${round.status}`}>
          <div className="a-round-state">
            {round.status === 'running' && clock ? (
              <><span className="a-muted">الجولة {round.number} · الوقت المتبقي</span><b className={`a-round-time num-latin${clock.urgent ? ' urgent' : ''}`}>{clock.text}</b>
                <span className="a-round-bar"><i style={{ width: `${100 - clock.pct}%` }} /></span></>
            ) : round.status === 'celebrating' ? (
              <><span className="a-muted">الجولة {round.number}</span><b className="a-round-time">🏆 احتفال بالفائز…</b></>
            ) : (
              <><span className="a-muted">{round.number ? `آخر جولة: ${round.number}` : 'لم تبدأ أي جولة'}</span><b className="a-round-time">لا توجد جولة جارية</b></>
            )}
          </div>
          <div className="a-actions">
            {round.status !== 'running' ? (
              <>
                <div className="a-inline"><Num value={mins} min={1} max={600} onChange={setMins} /><span className="a-muted">دقيقة</span></div>
                <Btn variant="gold" icon="play" busy={busy === 'start'} onClick={() => run('start', 'roundStart', { durationMin: mins }, `بدأت الجولة (${mins} د)`)}>بدء جولة</Btn>
              </>
            ) : (
              <>
                <Btn variant="ghost" busy={busy === 'e1'} onClick={() => run('e1', 'roundExtend', { sec: 60 }, '+1 دقيقة')}>+1 د</Btn>
                <Btn variant="ghost" busy={busy === 'e5'} onClick={() => run('e5', 'roundExtend', { sec: 300 }, '+5 دقائق')}>+5 د</Btn>
                <Btn variant="red" icon="trophy" busy={busy === 'end'} onClick={() => confirm('إنهاء الجولة الآن وإعلان الفائز؟') && run('end', 'roundEnd', {}, 'انتهت الجولة')}>إنهاء وإعلان الفائز</Btn>
                <Btn variant="ghost" icon="close" busy={busy === 'cancel'} onClick={() => confirm('إلغاء الجولة بدون فائز؟') && run('cancel', 'roundCancel', {}, 'أُلغيت الجولة')}>إلغاء</Btn>
              </>
            )}
          </div>
        </div>
      </Section>

      <Section title="إعدادات الجولات">
        <div className="a-form">
          <Field label="مدة الجولة الافتراضية (دقائق)"><Num value={r.durationMin} min={1} max={600} onChange={set('durationMin')} /></Field>
          <Field label="مدة شاشة الفائز (ثوانٍ)"><Num value={r.celebrateSec} min={3} max={120} onChange={set('celebrateSec')} /></Field>
          <Toggle label="تصفير النقاط تلقائياً بعد كل جولة" checked={r.autoReset} onChange={set('autoReset')} />
          <Toggle label="بدء الجولة التالية تلقائياً" checked={r.autoRestart} onChange={set('autoRestart')} />
          <Toggle label="إظهار العداد في OBS والصفحة" checked={r.showTimer} onChange={set('showTimer')} />
        </div>
      </Section>

      <Section title="كيف تعمل؟">
        <ol className="a-steps">
          <li>اضغط «بدء جولة»: يظهر عداد تنازلي في OBS والصفحة المباشرة (يصبح أحمر في آخر 30 ثانية).</li>
          <li>عند انتهاء الوقت تظهر <b>شاشة الفائز</b> مع أكبر 3 داعمين واحتفال، ويُقرأ الفائز بالصوت إذا كان الصوت مفعلاً.</li>
          <li>تُحفظ النتيجة في السجل أدناه وفي تقرير البث، ثم تُصفّر النقاط (اختياري) وتبدأ جولة جديدة (اختياري).</li>
        </ol>
      </Section>

      <Section title="📜 سجل الجولات" className="span-2"
        actions={hist?.length > 0 && <Btn size="sm" variant="ghost" icon="trash" onClick={async () => { if (!confirm('مسح سجل الجولات؟')) return; try { await api('/api/rounds', { method: 'DELETE' }); load(); } catch (e) { notice(e.message, 'err'); } }}>مسح السجل</Btn>}>
        {!hist ? <div className="a-center"><span className="spin" /></div> : hist.length === 0 ? <p className="a-empty">لا توجد جولات منتهية بعد.</p> : (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>#</th><th>الوقت</th><th>المدة</th><th>الفائز</th><th>نقاط الفائز</th><th>المجموع</th><th>أكبر داعم</th></tr></thead>
              <tbody>
                {hist.map((h) => {
                  const t = h.winner ? { ...h.winner, ...(teamOf(h.winner.id) || {}) } : null;
                  return (
                    <tr key={`${h.number}-${h.endedAt}`}>
                      <td className="num-latin">{h.number}</td>
                      <td>{dt(h.endedAt)}</td>
                      <td>{dur(h.durationSec * 1000)}</td>
                      <td>{t ? <span className="a-cell-team"><span className="a-cell-flag"><Flag team={t} /></span>{t.name}</span> : 'تعادل'}</td>
                      <td className="num-latin a-gold">{fmt(h.winner?.score || 0)}</td>
                      <td className="num-latin">{fmt(h.total)}</td>
                      <td>{h.topSupporters?.[0] ? <span className="a-cell-team"><Avatar src={h.topSupporters[0].a} name={h.topSupporters[0].n} />{h.topSupporters[0].n}</span> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ======================================================================== */
export function VoicePage({ draft, edit, notice }) {
  const t = draft.tts;
  const set = (k) => (v) => edit((c) => { c.tts[k] = v; });
  const [voices, setVoices] = useState([]);
  const [text, setText] = useState('شكراً يوسف على الأسد، المغرب يتصدر الآن!');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('/api/tts/voices').then((r) => setVoices(r.voices)).catch(() => {}); }, []);
  const listen = async () => {
    setBusy('listen');
    try {
      const r = await api('/api/tts/test', { method: 'POST', body: { text, voice: t.voice, rate: t.rate } });
      const a = new Audio(r.url); a.volume = t.volume; await a.play();
    } catch (e) {
      notice(e.message, 'err');
      if (typeof speechSynthesis !== 'undefined') { const u = new SpeechSynthesisUtterance(text); u.lang = 'ar-SA'; speechSynthesis.speak(u); }
    } finally { setBusy(''); }
  };
  const obs = async () => {
    setBusy('obs');
    try { await cmd('say', { text }); notice('أُرسل الصوت إلى OBS'); } catch (e) { notice(e.message, 'err'); } finally { setBusy(''); }
  };
  const vars = '{name} اسم المشاهد · {gift} الهدية · {count} العدد · {team} الفريق · {points} النقاط';

  return (
    <div className="a-grid">
      <Section title="🔊 القراءة الصوتية بالعربية" className="span-2"
        desc="تقرأ واجهة OBS الهدايا الكبيرة وتغيّر المتصدر والفائز بصوت عربي طبيعي. فعّل «Control audio via OBS» في إعدادات Browser Source ليُسمع الصوت في البث.">
        <div className="a-form">
          <Toggle label="تفعيل القراءة الصوتية" checked={t.enabled} onChange={set('enabled')} />
          <Field label="المحرك"><Select value={t.engine} onChange={set('engine')} options={[['edge', 'أصوات Microsoft العصبية (مُوصى به)'], ['browser', 'صوت المتصفح (لا يُسمع داخل OBS)']]} /></Field>
          <Field label="الصوت"><Select value={t.voice} onChange={set('voice')} options={(voices.length ? voices : [{ id: t.voice, label: t.voice }]).map((v) => [v.id, v.label])} /></Field>
          <Field label="سرعة القراءة"><Range value={t.rate} min={-50} max={60} step={5} suffix="%" onChange={set('rate')} /></Field>
          <Field label="مستوى الصوت"><Range value={t.volume} min={0} max={1} step={0.05} onChange={set('volume')} /></Field>
        </div>
      </Section>

      <Section title="ماذا يُقرأ؟">
        <div className="a-form">
          <Toggle label="الهدايا الكبيرة" checked={t.readGifts} onChange={set('readGifts')} />
          <Field label="أقل قيمة هدية تُقرأ (نقاط)" hint="هدايا الكومبو تُقرأ مرة واحدة في نهايتها"><Num value={t.minPoints} min={0} onChange={set('minPoints')} /></Field>
          <Toggle label="تغيّر المتصدر" checked={t.readTakeover} onChange={set('readTakeover')} />
          <Toggle label="فائز الجولة" checked={t.readRoundWinner} onChange={set('readRoundWinner')} />
          <Toggle label="المتابعون الجدد" checked={t.readFollows} onChange={set('readFollows')} />
        </div>
      </Section>

      <Section title="الجمل المقروءة" desc={vars}>
        <div className="a-form" style={{ gridTemplateColumns: '1fr' }}>
          <Field label="هدية"><Text value={t.giftTemplate} onChange={set('giftTemplate')} /></Field>
          <Field label="تغيّر المتصدر"><Text value={t.takeoverTemplate} onChange={set('takeoverTemplate')} /></Field>
          <Field label="فائز الجولة"><Text value={t.roundTemplate} onChange={set('roundTemplate')} /></Field>
          <Field label="متابع جديد"><Text value={t.followTemplate} onChange={set('followTemplate')} /></Field>
        </div>
      </Section>

      <Section title="🎤 تجربة وإعلان" className="span-2" desc="«استماع هنا» يشغّل الصوت على جهازك. «قراءة في OBS» يقرأ النص في البث مباشرة (مفيد للإعلانات). احفظ الإعدادات أولاً لتجربة الصوت المختار في OBS.">
        <div className="a-inline a-say">
          <input className="a-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
          <Btn variant="ghost" icon="play" busy={busy === 'listen'} onClick={listen}>استماع هنا</Btn>
          <Btn variant="gold" icon="external" busy={busy === 'obs'} onClick={obs}>قراءة في OBS</Btn>
        </div>
      </Section>
    </div>
  );
}

/* ======================================================================== */
function Chart({ timeline }) {
  const pts = timeline || [];
  if (pts.length < 2) return <p className="a-empty">يظهر الرسم بعد دقيقتين من النشاط.</p>;
  const W = 760, H = 200, P = 30;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const maxP = Math.max(1, ...pts.map((p) => p.points));
  const maxV = Math.max(1, ...pts.map((p) => p.viewers || 0));
  const x = (t) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v, m) => H - P - (v / m) * (H - 2 * P);
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.points, maxP).toFixed(1)}`).join(' ');
  const vline = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.viewers || 0, maxV).toFixed(1)}`).join(' ');
  return (
    <div className="a-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="النقاط مع الوقت">
        <defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f5b301" stopOpacity=".45" /><stop offset="1" stopColor="#f5b301" stopOpacity="0" /></linearGradient></defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P} x2={W - P} y1={y(maxP * f, maxP)} y2={y(maxP * f, maxP)} stroke="#2a2733" strokeDasharray="4 4" />)}
        <polygon points={`${x(t0)},${H - P} ${line} ${x(t1)},${H - P}`} fill="url(#cg)" />
        <polyline points={line} fill="none" stroke="#f5b301" strokeWidth="2.5" />
        {maxV > 1 && <polyline points={vline} fill="none" stroke="#4cc9f0" strokeWidth="1.5" strokeDasharray="5 4" />}
        <text x={W - P} y={y(maxP, maxP) - 6} fill="#9c96a6" fontSize="11" textAnchor="end">{fmt(maxP)}</text>
        <text x={P} y={H - 8} fill="#9c96a6" fontSize="11">{new Date(t0).toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' })}</text>
        <text x={W - P} y={H - 8} fill="#9c96a6" fontSize="11" textAnchor="end">{new Date(t1).toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' })}</text>
      </svg>
      <div className="a-legend"><span><i style={{ background: '#f5b301' }} />النقاط</span>{maxV > 1 && <span><i style={{ background: '#4cc9f0' }} />المشاهدون (أعلى: {fmt(maxV)})</span>}</div>
    </div>
  );
}

export function ReportsPage({ live, notice }) {
  const [list, setList] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [sel, setSel] = useState(null);
  const [rep, setRep] = useState(null);
  const loadList = useCallback(async () => {
    try { const r = await api('/api/reports'); setList(r.reports); setCurrentId(r.currentId); setSel((s) => s || r.reports[0]?.id || null); }
    catch (e) { notice(e.message, 'err'); }
  }, [notice]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (!sel) { setRep(null); return undefined; }
    let stop = false;
    const get = () => api(`/api/reports/${sel}`).then((r) => { if (!stop) setRep(r.report); }).catch(() => {});
    get();
    const t = sel === currentId ? setInterval(get, 10000) : null; // live report refreshes
    return () => { stop = true; if (t) clearInterval(t); };
  }, [sel, currentId]);
  const teams = useMemo(() => (rep ? Object.entries(rep.teams || {}).map(([id, t]) => ({ id, ...t, ...(live.config.teams.find((x) => x.id === id) ? { image: live.config.teams.find((x) => x.id === id).image } : {}) })).sort((a, b) => b.points - a.points) : []), [rep, live.config]);
  const gifts = useMemo(() => (rep ? Object.entries(rep.giftsByName || {}).map(([name, g]) => ({ name, ...g })).sort((a, b) => b.diamonds - a.diamonds) : []), [rep]);
  const giftImg = (g) => g.image || live.gifts.find((x) => x.name.toLowerCase() === g.name.toLowerCase())?.image;
  const top = teams[0]?.points || 1;

  return (
    <div className="a-reports">
      <aside className="a-card a-rep-list">
        <div className="a-inline" style={{ justifyContent: 'space-between' }}>
          <b>البثوث</b>
          <div className="a-inline">
            {currentId && <Btn size="sm" variant="ghost" icon="stop" onClick={async () => { await api('/api/reports/end', { method: 'POST' }); loadList(); }}>إنهاء</Btn>}
            <Btn size="sm" variant="ghost" icon="plus" onClick={async () => { await api('/api/reports/new', { method: 'POST' }); setSel(null); loadList(); }}>تقرير جديد</Btn>
          </div>
        </div>
        {!list ? <div className="a-center"><span className="spin" /></div> : list.length === 0 ? <p className="a-empty">يبدأ التقرير تلقائياً مع أول نشاط في البث.</p> : (
          <div className="a-rep-items">
            {list.map((r) => (
              <button key={r.id} className={`a-rep-item${sel === r.id ? ' active' : ''}`} onClick={() => setSel(r.id)}>
                <div className="a-rep-top"><b>{dt(r.startedAt)}</b>{r.open && <span className="a-chip gold">● مباشر</span>}{r.demo && <span className="a-chip">تجريبي</span>}</div>
                <span className="a-muted">{r.username ? `@${r.username} · ` : ''}{dur((r.endedAt || Date.now()) - r.startedAt)}</span>
                <div className="a-rep-nums num-latin"><span>{fmt(r.totals?.points)} نقطة</span><span>{fmt(r.totals?.diamonds)} 💎</span>{r.winner && <span>🏆 {r.winner.name}</span>}</div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="a-rep-detail">
        {!rep ? <div className="a-card a-empty">اختر تقريراً من القائمة.</div> : (
          <>
            <div className="a-card a-rep-head">
              <div>
                <h3>{rep.title} · {dt(rep.startedAt)}</h3>
                <span className="a-muted">{rep.username ? `@${rep.username} · ` : ''}المدة {dur((rep.endedAt || Date.now()) - rep.startedAt)}{rep.open ? ' · مستمر' : ''}{rep.demo ? ' · بيانات تجريبية' : ''}</span>
              </div>
              <div className="a-actions">
                <a className="a-btn ghost sm" href={`/api/reports/${rep.id}.csv?live=${encodeURIComponent(getStoreLive())}`}><Icon name="save" size={15} /><span>تنزيل CSV (Excel)</span></a>
                <Btn size="sm" variant="ghost" icon="file" onClick={() => window.print()}>طباعة</Btn>
                {!rep.open && <Btn size="sm" variant="ghost" icon="trash" onClick={async () => { if (!confirm('حذف هذا التقرير؟')) return; await api(`/api/reports/${rep.id}`, { method: 'DELETE' }); setSel(null); loadList(); }}>حذف</Btn>}
              </div>
            </div>
            <div className="a-kpis a-rep-kpis">
              <div className="a-kpi gold"><Icon name="trophy" /><div><span>النقاط</span><b className="num-latin">{fmt(rep.totals.points)}</b></div></div>
              <div className="a-kpi"><Icon name="gift" /><div><span>الهدايا</span><b className="num-latin">{fmt(rep.totals.gifts)}</b></div></div>
              <div className="a-kpi"><span className="a-kpi-ico emoji">💎</span><div><span>الماسات</span><b className="num-latin">{fmt(rep.totals.diamonds)}</b></div></div>
              <div className="a-kpi"><span className="a-kpi-ico emoji">💛</span><div><span>متابعون جدد</span><b className="num-latin">{fmt(rep.totals.follows)}</b></div></div>
              <div className="a-kpi"><span className="a-kpi-ico emoji">🔁</span><div><span>مشاركات</span><b className="num-latin">{fmt(rep.totals.shares)}</b></div></div>
              <div className="a-kpi"><Icon name="eye" /><div><span>أعلى مشاهدين</span><b className="num-latin">{fmt(rep.peakViewers)}</b></div></div>
              <div className="a-kpi"><Icon name="users" /><div><span>الداعمون</span><b className="num-latin">{fmt(rep.supportersCount || rep.topSupporters?.length || 0)}</b></div></div>
              <div className="a-kpi"><Icon name="update" /><div><span>الجولات</span><b className="num-latin">{rep.rounds?.length || 0}</b></div></div>
            </div>
            <Section title="📈 النقاط مع الوقت"><Chart timeline={rep.timeline} /></Section>
            <div className="a-grid">
              <Section title="🏳️ الفرق">
                <div className="a-standings">
                  {teams.map((t, i) => (
                    <div key={t.id} className="a-stand" style={{ '--team': t.color }}>
                      <span className={`a-pos p${i + 1}`}>{i + 1}</span>
                      <span className="a-stand-flag emoji"><Flag team={t} /></span>
                      <div className="a-stand-main">
                        <div className="a-stand-row"><b>{t.name}</b><span className="num-latin">{fmt(t.points)}</span></div>
                        <div className="a-stand-bar"><i style={{ width: `${(t.points / top) * 100}%` }} /></div>
                        <span className="a-muted">{fmt(t.gifts)} هدية</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title="🎁 الهدايا">
                {gifts.length === 0 ? <p className="a-empty">لا هدايا.</p> : (
                  <table className="a-table compact">
                    <thead><tr><th>الهدية</th><th>العدد</th><th>💎</th><th>النقاط</th></tr></thead>
                    <tbody>{gifts.slice(0, 25).map((g) => (
                      <tr key={g.name}><td><span className="a-cell-team"><GiftIcon gift={{ name: g.name, image: giftImg(g) }} className="a-cell-gift" /><span className="num-latin">{g.name}</span></span></td>
                        <td className="num-latin">{fmt(g.count)}</td><td className="num-latin">{fmt(g.diamonds)}</td><td className="num-latin a-gold">{fmt(g.points)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </Section>
              <Section title="👑 أكبر الداعمين">
                {(rep.topSupporters || []).length === 0 ? <p className="a-empty">لا داعمين.</p> : (
                  <table className="a-table compact">
                    <thead><tr><th>#</th><th>الداعم</th><th>الفريق</th><th>النقاط</th></tr></thead>
                    <tbody>{rep.topSupporters.slice(0, 20).map((s, i) => (
                      <tr key={`${s.u}-${i}`}><td className="num-latin">{i + 1}</td>
                        <td><span className="a-cell-team"><Avatar src={safeUrl(s.a)} name={s.n} />{s.n}</span></td>
                        <td>{rep.teams?.[s.team]?.name || '—'}</td><td className="num-latin a-gold">{fmt(s.points)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </Section>
              <Section title="⏱️ الجولات">
                {(rep.rounds || []).length === 0 ? <p className="a-empty">لا جولات في هذا البث.</p> : (
                  <table className="a-table compact">
                    <thead><tr><th>#</th><th>الفائز</th><th>نقاطه</th><th>المجموع</th></tr></thead>
                    <tbody>{rep.rounds.map((x) => (
                      <tr key={x.number}><td className="num-latin">{x.number}</td><td>{x.winner ? `${x.winner.emoji || ''} ${x.winner.name}` : 'تعادل'}</td>
                        <td className="num-latin a-gold">{fmt(x.winner?.score || 0)}</td><td className="num-latin">{fmt(x.total)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </Section>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
