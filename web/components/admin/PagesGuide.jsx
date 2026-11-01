'use client';
/**
 * "Start here": a live go-live checklist. Steps that can be checked
 * automatically (password, key, connection, gifts, teams, voice, HTTPS,
 * updates) update by themselves; the OBS steps are ticked by hand
 * (remembered in this browser).
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getStoreLive, liveQuery } from '@/lib/store';
import { Btn, CopyField, Icon, Section } from './ui';

const MANUAL_KEY = 'koydam.setup.manual';
const loadManual = () => { try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}'); } catch { return {}; } };
const saveManual = (m) => { try { localStorage.setItem(MANUAL_KEY, JSON.stringify(m)); } catch { /* ignore */ } };

function Step({ n, state, title, children, actions, optional }) {
  // state: 'done' | 'todo' | 'warn' | 'manual-done' | 'manual'
  const done = state === 'done' || state === 'manual-done';
  return (
    <div className={`a-gstep ${done ? 'done' : state === 'warn' ? 'warn' : 'todo'}`}>
      <div className="a-gnum">{done ? <Icon name="check" size={18} /> : n}</div>
      <div className="a-gbody">
        <div className="a-ghead">
          <b>{title}</b>
          {optional && <span className="a-chip">اختياري</span>}
          <span className={`a-chip ${done ? 'ok' : state === 'warn' ? 'warn' : ''}`}>{done ? 'تم ✓' : state === 'warn' ? 'يحتاج انتباه' : 'لم يتم بعد'}</span>
        </div>
        <div className="a-gtext">{children}</div>
        {actions && <div className="a-row a-gactions">{actions}</div>}
      </div>
    </div>
  );
}

export function GuidePage({ live, go, me, myLives }) {
  const owner = me?.role === 'owner';
  const meta = (myLives || []).find((l) => l.slug === getStoreLive()) || {};
  const q = liveQuery(getStoreLive());
  const [s, setS] = useState(null);
  const [upd, setUpd] = useState(null);
  const [manual, setManual] = useState({});
  useEffect(() => { setManual(loadManual()); }, []);
  useEffect(() => {
    if (owner) {
      api('/api/settings').then(setS).catch(() => {});
      api('/api/update/check').then(setUpd).catch(() => setUpd({ error: true }));
    } else {
      api('/api/account').then((r) => setS({ mustChangePassword: r.user.mustChangePassword })).catch(() => {});
    }
  }, [live.status?.state]);
  const tick = (k) => { const m = { ...manual, [k]: !manual[k] }; setManual(m); saveManual(m); };

  const cfg = live.config;
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const https = typeof location !== 'undefined' && location.protocol === 'https:';
  const st = live.status || {};
  const connected = st.state === 'connected';
  const giftsWithImg = live.gifts.filter((g) => g.image).length;
  const teamCheck = useMemo(() => {
    const seen = new Set(); let dup = false;
    const missing = cfg.teams.filter((t) => !t.gifts.length).map((t) => t.name);
    cfg.teams.forEach((t) => t.gifts.forEach((g) => { const k = g.toLowerCase(); if (seen.has(k)) dup = true; seen.add(k); }));
    return { missing, dup, ok: !missing.length && !dup };
  }, [cfg.teams]);

  const steps = [
    { key: 'pw', auto: s && !s.mustChangePassword },
    { key: 'https', auto: https },
    ...(owner ? [{ key: 'key', auto: s?.signApiKeySet, optional: true }] : []),
    { key: 'user', auto: Boolean(meta.tiktokUsername) && (connected || meta.autoConnect) },
    { key: 'gifts', auto: giftsWithImg > 0 },
    { key: 'teams', auto: teamCheck.ok },
    { key: 'obs', manual: true }, { key: 'audio', manual: true, optional: true },
    { key: 'voice', auto: cfg.tts?.enabled, optional: true },
    { key: 'test', manual: true },
    ...(owner ? [{ key: 'update', auto: upd && upd.git && !upd.error && upd.behind === 0, optional: true }] : []),
  ];
  const isDone = (x) => (x.manual ? Boolean(manual[x.key]) : Boolean(x.auto));
  const required = steps.filter((x) => !x.optional);
  const doneReq = required.filter(isDone).length;
  const pct = Math.round((steps.filter(isDone).length / steps.length) * 100);
  const state = (key) => { const x = steps.find((y) => y.key === key); return x.manual ? (manual[key] ? 'manual-done' : 'manual') : x.auto ? 'done' : 'todo'; };
  const ManualBtn = ({ k, label = 'تم، فعلت هذا' }) => <Btn size="sm" variant={manual[k] ? 'ghost' : 'gold'} icon={manual[k] ? 'close' : 'check'} onClick={() => tick(k)}>{manual[k] ? 'إلغاء التحديد' : label}</Btn>;

  return (
    <div className="a-guide">
      <Section className="a-guide-hero">
        <div className="a-guide-top">
          <div>
            <h2>🚀 جاهز للبث المباشر؟</h2>
            <p className="a-muted">اتبع الخطوات بالترتيب. الخطوات التي يمكن فحصها تتحدث تلقائياً.</p>
          </div>
          <div className="a-guide-score">
            <b className="num-latin">{doneReq}/{required.length}</b><span>خطوات أساسية</span>
          </div>
        </div>
        <div className="a-guide-bar"><i style={{ width: `${pct}%` }} /></div>
        {doneReq === required.length && <div className="a-alert ok" style={{ marginTop: 14 }}><Icon name="check" />كل الخطوات الأساسية جاهزة! ابدأ البث على تيك توك ثم اضغط «اتصال» إذا لم يكن الاتصال تلقائياً.</div>}
      </Section>

      <h3 className="a-gsec">1. الحساب والأمان</h3>
      <Step n={1} state={state('pw')} title="غيّر كلمة المرور المؤقتة"
        actions={<Btn size="sm" variant="gold" icon="key" onClick={() => go('account')}>حسابي</Btn>}>
        كلمة المرور التي طبعها المثبّت مؤقتة. ضع كلمة مرور طويلة خاصة بك (10 أحرف على الأقل). من يملك كلمة المرور يتحكم في كل شيء.
      </Step>
      <Step n={2} state={state('https')} title="الموقع يعمل عبر HTTPS (القفل 🔒)">
        {https ? 'الاتصال مشفّر.' : <>أنت تفتح اللوحة بدون HTTPS. تأكد أن سجل DNS لـ <b>tiktok.koydam.com</b> يشير إلى خادمك، ثم شغّل على الخادم: <code className="num-latin">sudo certbot --nginx -d tiktok.koydam.com --redirect</code></>}
      </Step>

      <h3 className="a-gsec">2. الاتصال بتيك توك</h3>
      {owner ? <Step n={3} state={state('key')} optional title="مفتاح Euler Stream (Sign API key)"
        actions={<>
          <a className="a-btn ghost sm" href="https://www.eulerstream.com" target="_blank" rel="noopener"><Icon name="external" size={15} /><span>eulerstream.com</span></a>
          <Btn size="sm" variant="gold" icon="key" onClick={() => go('server')}>إدخال المفتاح</Btn>
        </>}>
        المكتبة تحتاج «خادم توقيع» للاتصال بتيك توك. بدون مفتاح تعمل، لكن قد تُرفض الاتصالات عند الضغط. للحصول على مفتاح مجاني:
        <ol className="a-gsteps">
          <li>افتح <b className="num-latin">eulerstream.com</b> وأنشئ حساباً.</li>
          <li>من لوحة Euler انسخ <b>API Key</b>.</li>
          <li>الصقه في «الخادم والحساب» ← «مفتاح Euler Stream»، احفظ، ثم «إعادة تشغيل الخادم».</li>
        </ol>
        {s?.signApiKeySet && <span className="a-gold">✓ المفتاح محفوظ ({s.signApiKeyHint}).</span>}
      </Step> : <div className="a-alert"><Icon name="key" />مفتاح الاتصال بتيك توك يديره المدير لكل البثوث، لا تحتاج لفعل شيء.</div>}
      <Step n={4} state={state('user')} title="اسم حسابك والاتصال"
        actions={<Btn size="sm" variant="gold" icon="plug" onClick={() => go('connection')}>صفحة الاتصال</Btn>}>
        اكتب اسم حساب تيك توك الذي ستبث منه (بدون @)، ثم اضغط «اتصال» <b>بعد أن تبدأ البث</b> على تيك توك. بعد أول اتصال ناجح يتذكر الخادم الحساب ويتصل تلقائياً كل مرة.
        <div className="a-gstatus">الحالة الآن: <b>{connected ? `✅ متصل بـ @${st.username}` : st.state === 'offline' ? `⏳ @${st.username} ليس في بث مباشر (سيحاول تلقائياً)` : st.state === 'reconnecting' || st.state === 'connecting' ? '⏳ جارٍ الاتصال…' : meta.tiktokUsername ? `غير متصل (الحساب المحفوظ: @${meta.tiktokUsername})` : 'لم يُحدد حساب بعد'}</b></div>
      </Step>

      <h3 className="a-gsec">3. الهدايا والفرق</h3>
      <Step n={5} state={state('gifts')} title="جلب صور الهدايا الحقيقية"
        actions={<Btn size="sm" variant="gold" icon="gift" onClick={() => go('scoring')}>الهدايا والنقاط</Btn>}>
        في «الهدايا والنقاط» اضغط «جلب قائمة الهدايا» أثناء بثك (أو اكتب اسم أي حساب يبث الآن). تُحفظ الصور على الخادم مرة واحدة.
        <div className="a-gstatus">الآن: <b className="num-latin">{live.gifts.length}</b> هدية، منها <b className="num-latin">{giftsWithImg}</b> بصورة حقيقية.</div>
      </Step>
      <Step n={6} state={teamCheck.ok ? 'done' : teamCheck.dup ? 'warn' : 'todo'} title="لكل دولة هدية مختلفة"
        actions={<Btn size="sm" variant="gold" icon="flag" onClick={() => go('teams')}>الفرق والهدف</Btn>}>
        في «الفرق والهدف» ← «هدية كل دولة»: اختر هدية لكل دولة أو اضغط «توزيع تلقائي». غيّر العنوان الفرعي ليقول للمشاهدين ماذا يفعلون (مثلاً «أرسل هدية دولتك!»).
        {teamCheck.missing.length > 0 && <div className="a-gstatus">بدون هدية: <b>{teamCheck.missing.join('، ')}</b></div>}
        {teamCheck.dup && <div className="a-gstatus a-warn-text">⚠️ نفس الهدية عند أكثر من دولة.</div>}
      </Step>

      <h3 className="a-gsec">4. OBS أو TikTok LIVE Studio</h3>
      <Step n={7} state={state('obs')} title="أضف الواجهة كـ Browser Source" actions={<ManualBtn k="obs" />}>
        <ol className="a-gsteps">
          <li>في OBS: <b>Sources ← + ← Browser</b>.</li>
          <li>بث أفقي: الرابط أدناه بالمقاس <b className="num-latin">1920 × 1080</b>. بث عمودي (تيك توك): الرابط العمودي بالمقاس <b className="num-latin">1080 × 1920</b>.</li>
          <li>امسح «Custom CSS» ليبقى الخلفية شفافة، وفعّل «Refresh browser when scene becomes active».</li>
        </ol>
        <div className="a-gcopy"><span className="a-label">أفقي</span><CopyField value={`${origin}/overlay/${q}`} /></div>
        <div className="a-gcopy"><span className="a-label">عمودي</span><CopyField value={`${origin}/overlay-vertical/${q}`} /></div>
      </Step>
      <Step n={8} state={state('audio')} optional title="فعّل صوت الواجهة في OBS" actions={<ManualBtn k="audio" />}>
        في خصائص Browser Source فعّل <b>«Control audio via OBS»</b>، ثم تأكد أن مصدر الصوت يظهر في Audio Mixer وغير مكتوم. بدون هذا لن تُسمع القراءة الصوتية في البث.
      </Step>
      <Step n={9} state={state('voice')} optional title="القراءة الصوتية بالعربية"
        actions={<Btn size="sm" variant="gold" icon="bolt" onClick={() => go('voice')}>القراءة الصوتية</Btn>}>
        فعّلها واختر صوتاً (مثلاً «جمال (المغرب)»)، احفظ، ثم اضغط «قراءة في OBS» وتأكد أنك تسمعها في OBS.
      </Step>

      <h3 className="a-gsec">5. تجربة قبل البث</h3>
      <Step n={10} state={state('test')} title="جرّب كل شيء في الوضع التجريبي" actions={<>
        <Btn size="sm" variant="ghost" icon="dice" onClick={() => go('connection')}>الوضع التجريبي</Btn>
        <Btn size="sm" variant="ghost" icon="tools" onClick={() => go('tools')}>محاكاة هدية / متابعة</Btn>
        <ManualBtn k="test" label="جرّبت، كل شيء يعمل" />
      </>}>
        شغّل «الوضع التجريبي» وشاهد OBS: البطاقات تتحرك، التنبيهات، الشريط، الصوت. جرّب جولة قصيرة (دقيقة) من «الجولات» لترى شاشة الفائز.
        <b> بعد التجربة:</b> أوقف الوضع التجريبي واضغط «جولة جديدة / تصفير النتائج» حتى لا تبقى نقاط تجريبية.
      </Step>
      {owner && <Step n={11} state={state('update')} optional title="أحدث نسخة من التطبيق"
        actions={<Btn size="sm" variant="ghost" icon="update" onClick={() => go('updates')}>التحديثات</Btn>}>
        {upd?.git ? (upd.behind ? `يوجد ${upd.behind} تحديث جديد. حدّث قبل البث (يستغرق دقيقة).` : 'أنت على أحدث نسخة.') : 'تحقق من صفحة التحديثات.'}
      </Step>}

      <h3 className="a-gsec">✅ يوم البث</h3>
      <Section>
        <ol className="a-gsteps big">
          <li>ابدأ البث على تيك توك أولاً، ثم افتح OBS (أو TikTok LIVE Studio).</li>
          <li>في «الاتصال بالبث» تأكد أن الحالة «متصل» (أو اضغط «اتصال»).</li>
          <li>في «الجولات» اضغط «بدء جولة» وأعلن للمشاهدين: «الجولة بدأت! أرسل هدية دولتك».</li>
          <li>اقرأ أسماء الداعمين واشكرهم، وذكّر الجدد بالمتابعة (هدف المتابعين على الشاشة).</li>
          <li>استخدم «قراءة في OBS» للإعلانات (مثلاً «بقيت دقيقة!»).</li>
          <li>بعد البث: افتح «تقارير البث» لترى النتائج والماسات وأكبر الداعمين، ونزّل ملف CSV.</li>
        </ol>
      </Section>

      <h3 className="a-gsec">🆘 مشاكل شائعة</h3>
      <Section>
        <ul className="a-faq">
          <li><b>الحالة «البث متوقف» رغم أنك تبث:</b> انتظر 30 ثانية (يعيد المحاولة)، تأكد من اسم الحساب، وأضف مفتاح Euler.</li>
          <li><b>«rate limit» في السجلات:</b> أضف مفتاح Euler Stream ثم أعد تشغيل الخادم.</li>
          <li><b>الواجهة لا تظهر في OBS:</b> افتح الرابط في المتصفح أولاً، ثم في OBS اضغط بالزر الأيمن على المصدر ← Refresh.</li>
          <li><b>لا صوت:</b> «Control audio via OBS» مفعّل؟ المصدر غير مكتوم في Mixer؟ جرّب «استماع هنا» في صفحة القراءة الصوتية لترى رسالة الخطأ.</li>
          <li><b>الهدايا بدون صور:</b> اضغط «جلب قائمة الهدايا» أثناء بث مباشر.</li>
          <li><b>نسيت كلمة المرور:</b> على الخادم: <code className="num-latin">sudo bash /opt/koydam-tiktok/deploy/reset-password.sh</code></li>
          <li><b>تفاصيل أي خطأ:</b> صفحة «السجلات».</li>
        </ul>
      </Section>
    </div>
  );
}
