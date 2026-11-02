'use client';
/**
 * Phone remote for the live: big buttons for the game, golden minute, questions and the program.
 * https://tiktok.koydam.com/remote/?live=<slug>   (needs to be logged in to /admin on this phone)
 */
import { useEffect, useState } from 'react';
import { CircleHelp, Flag as FlagIco, ListOrdered, Play, RotateCcw, SkipForward, Square, Zap } from 'lucide-react';
import { cmd, useLive } from '@/lib/store';
import { fmt } from '@/lib/format';

const NAMES = { race: 'سباق المليون', cup: 'كأس العرب', arena: 'حلبة الدول', tug: 'شد الحبل', horses: 'سباق الخيول', rockets: 'سباق الصواريخ', castle: 'حماية العاصمة' };

export default function RemotePage() {
  const live = useLive();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(''), 2500); return () => clearTimeout(t); }, [msg]);
  const run = async (action, payload, ok, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    try { await cmd(action, payload || {}); setMsg(ok); if (navigator.vibrate) navigator.vibrate(30); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  if (!live.config) return <div className="rm-root"><div className="rm-center">جارٍ الاتصال…</div></div>;
  if (!live.isAdmin) {
    return (
      <div className="rm-root"><div className="rm-center">
        <b>سجّل الدخول أولاً</b>
        <p>افتح لوحة التحكم على هذا الجوال وسجّل الدخول، ثم ارجع لهذه الصفحة.</p>
        <a className="rm-btn gold" href="/admin/">فتح لوحة التحكم</a>
      </div></div>
    );
  }
  const mode = live.config.game?.mode || 'race';
  const g = live.game && live.game.mode === mode ? live.game : null;
  const pl = live.playlist;
  const plLeft = pl ? Math.max(0, Math.round((pl.endsAtLocal - Date.now()) / 1000)) : 0;
  const boost = live.acts?.boost;
  const st = live.status || {};
  const B = ({ action, payload, ok, icon: I, children, cls = '', confirmText }) => (
    <button type="button" className={`rm-btn ${cls}`} disabled={Boolean(busy)} onClick={() => run(action, payload, ok, confirmText)}>
      {busy === action ? <span className="spin" /> : <I />}<span>{children}</span>
    </button>
  );
  return (
    <div className="rm-root">
      <header className="rm-head">
        <b>{live.config.title}</b>
        <span className={`rm-dot ${st.state === 'connected' ? 'on' : ''}`}>{st.state === 'connected' ? `مباشر · @${st.username}` : st.demo ? 'وضع تجريبي' : 'غير متصل بتيك توك'}</span>
        <span className="rm-total num-latin">{fmt(live.state?.total || 0)} نقطة</span>
      </header>

      <section className="rm-card">
        <h2>{NAMES[mode]}</h2>
        <p className="rm-sub">{mode === 'race' ? 'الترتيب الكلاسيكي' : !g || g.status === 'idle' ? 'لم تبدأ' : g.status === 'done' ? 'انتهت، يوجد فائز' : g.status === 'break' ? 'استراحة' : 'تعمل الآن'}</p>
        {mode !== 'race' && (
          <div className="rm-grid">
            <B action="gameStart" ok="بدأت اللعبة" icon={Play} cls="gold">{g && g.status !== 'idle' ? 'إعادة البدء' : 'ابدأ اللعبة'}</B>
            {(mode === 'cup' || mode === 'tug') && <B action="gameNext" ok="تم" icon={SkipForward}>{g?.status === 'break' ? 'المباراة التالية' : 'إنهاء المباراة'}</B>}
            <B action="gameStop" ok="توقفت" icon={Square}>إيقاف</B>
          </div>
        )}
      </section>

      <section className="rm-card">
        <h2>الإضافات</h2>
        <div className="rm-grid">
          <B action={boost ? 'actBoostStop' : 'actBoost'} ok={boost ? 'توقفت' : 'الدقيقة الذهبية!'} icon={Zap} cls={boost ? 'red' : 'gold'}>{boost ? `إيقاف الذهبية (${Math.max(0, Math.round((boost.untilLocal - Date.now()) / 1000))})` : 'الدقيقة الذهبية'}</B>
          <B action="actQuiz" payload={{ kind: 'trivia' }} ok="ظهر السؤال" icon={CircleHelp}>سؤال الآن</B>
          <B action="actQuiz" payload={{ kind: 'flag' }} ok="ظهر العلم" icon={FlagIco}>علم الآن</B>
        </div>
      </section>

      <section className="rm-card">
        <h2>البرنامج التلقائي</h2>
        {pl ? <p className="rm-sub">يعمل: <b>{NAMES[pl.mode]}</b> ({pl.index + 1}/{pl.total}) · باقٍ <b className="num-latin">{Math.floor(plLeft / 60)}:{String(plLeft % 60).padStart(2, '0')}</b></p> : <p className="rm-sub">متوقف</p>}
        <div className="rm-grid">
          <B action="playlistStart" payload={{ index: 0 }} ok="بدأ البرنامج" icon={ListOrdered} cls={pl ? '' : 'gold'}>{pl ? 'إعادة البرنامج' : 'ابدأ البرنامج'}</B>
          {pl && <B action="playlistNext" ok="اللعبة التالية" icon={SkipForward}>اللعبة التالية</B>}
          {pl && <B action="playlistStop" ok="توقف" icon={Square}>إيقاف</B>}
        </div>
      </section>

      <section className="rm-card">
        <h2>الجولة</h2>
        <div className="rm-grid">
          <B action="reset" payload={{ keepAllegiance: true }} ok="تم تصفير النقاط" icon={RotateCcw} cls="red" confirmText="تصفير كل النقاط؟">تصفير النقاط</B>
        </div>
      </section>
      {msg && <div className="rm-toast">{msg}</div>}
    </div>
  );
}
