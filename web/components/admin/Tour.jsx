'use client';
/**
 * Guided tour for new users: highlights the menu items one by one with a short explanation.
 * Shown once per user (localStorage), and again from the «جولة» button.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const STEPS = [
  [null, 'أهلاً بك في «تحدي المليون»', 'جولة سريعة (دقيقة واحدة) تعرّفك على أهم الصفحات. يمكنك إعادتها في أي وقت من زر «جولة» في الأعلى.'],
  ['guide', 'ابدأ هنا', 'قائمة خطوات بالترتيب لتجهيز أول بث: الحساب، الدول، الشكل، ورابط OBS. وتظهر علامة صح عند كل خطوة جاهزة.'],
  ['connection', 'الاتصال بالبث', 'اكتب اسم حسابك في تيك توك واضغط «اتصال». هنا أيضاً رابط واجهة OBS ورابط التحكم من الجوال.'],
  ['teams', 'الفرق والهدف', 'اختر الدول (كل الدول العربية بضغطة) وهدية كل دولة. المشاهد يكتب اسم دولته في الشات أو يرسل هديتها.'],
  ['games', 'الألعاب', 'اختر ما يظهر في البث: سباق المليون، كأس العرب، شد الحبل، الحلبة… مع معاينة وتجربة، والبرنامج التلقائي، والدقيقة الذهبية والأسئلة.'],
  ['theme', 'المظهر', '45 شكلاً وخطوطاً وشعارك وألوانك، مع معاينة مباشرة. كل بث له شكله الخاص.'],
  ['voice', 'القراءة الصوتية والأصوات', 'صوت عربي يقرأ الهدايا والأهداف، ومؤثرات صوتية للهدايا والفائز.'],
  ['video', 'فيديو ترويجي', 'اصنع فيديو «الليلة» أو سباقاً حتى المليون بنفس تصميمك، وحمّله لتنشره قبل البث.'],
  ['tools', 'الأدوات', 'هدايا تجريبية، تصفير الجولة، وملف الإعدادات لنقل شكل البث إلى بث آخر.'],
  [null, 'جاهز!', 'بعد كل تعديل اضغط «حفظ وتطبيق» في الأسفل. بالتوفيق في بثك!'],
];
const key = (uid) => `koydam.tour.${uid || 'x'}`;

export function useTour(userId) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(key(userId))) setTimeout(() => setOpen(true), 800); } catch { /* private mode */ }
  }, [userId]);
  const close = () => { setOpen(false); try { localStorage.setItem(key(userId), '1'); } catch { /* ignore */ } };
  return { open, start: () => setOpen(true), close };
}

export function Tour({ open, onClose, go }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState(null);
  useEffect(() => { if (open) setI(0); }, [open]);
  const [id, title, text] = STEPS[i] || [];
  useLayoutEffect(() => {
    if (!open) return undefined;
    const find = () => {
      const el = id ? document.querySelector(`.a-nav-item[data-tour="${id}"]`) : null;
      if (!el || el.offsetParent === null) { setBox(null); return; }
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect(); setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    find(); window.addEventListener('resize', find);
    return () => window.removeEventListener('resize', find);
  }, [open, id]);
  if (!open) return null;
  const last = i === STEPS.length - 1;
  const cardStyle = box ? { top: Math.min(window.innerHeight - 260, Math.max(16, box.top - 20)), left: Math.max(16, box.left - 380) } : null;
  return (
    <div className="a-tour" role="dialog" aria-label="جولة تعريفية">
      {box ? <div className="a-tour-hole" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} /> : <div className="a-tour-dim" />}
      <div className={`a-tour-card${box ? '' : ' center'}`} style={cardStyle || undefined}>
        <button type="button" className="a-tour-x" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        <small className="num-latin">{i + 1} / {STEPS.length}</small>
        <b>{title}</b>
        <p>{text}</p>
        <div className="a-tour-nav">
          <button type="button" className="a-btn ghost sm" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronRight size={16} /> السابق</button>
          {id && <button type="button" className="a-btn ghost sm" onClick={() => { go(id); onClose(); }}>افتح الصفحة</button>}
          <button type="button" className="a-btn gold sm" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'إنهاء' : 'التالي'} {!last && <ChevronLeft size={16} />}</button>
        </div>
        {!last && <button type="button" className="a-tour-skip" onClick={onClose}>تخطّي الجولة</button>}
      </div>
    </div>
  );
}
