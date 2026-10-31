'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Overlay from '../Overlay';
import { PRESETS } from '@/lib/presets';
import { Btn, Color, Field, Icon, Num, Range, Section, Select, Text, Toggle } from './ui';

const splitList = (s) => String(s).split(/[,،]/).map((x) => x.trim()).filter(Boolean);

/** Comma-separated list input that keeps what you type (e.g. a trailing comma). */
function ListInput({ value, onChange, placeholder, list }) {
  const [txt, setTxt] = useState((value || []).join('، '));
  useEffect(() => {
    if (splitList(txt).join('|') !== (value || []).join('|')) setTxt((value || []).join('، '));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="a-input" value={txt} list={list} placeholder={placeholder} onChange={(e) => { setTxt(e.target.value); onChange(splitList(e.target.value)); }} />;
}

function GiftDatalist({ gifts }) {
  return <datalist id="gift-names">{gifts.map((g) => <option key={g.id} value={g.name}>{g.diamonds} 💎</option>)}</datalist>;
}

export function Teams({ live, draft, edit }) {
  const d = draft;
  const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#eab308'];
  return (
    <div className="a-grid">
      <GiftDatalist gifts={live.gifts} />
      <Section title="العنوان" desc="يظهر في الصفحة المباشرة وواجهة OBS">
        <div className="a-form">
          <Field label="العنوان"><Text value={d.title} onChange={(v) => edit((c) => { c.title = v; })} /></Field>
          <Field label="العنوان الفرعي"><Text value={d.subtitle} onChange={(v) => edit((c) => { c.subtitle = v; })} /></Field>
          <Field label="نوع المنافسة" hint="مثال: الدول، الأندية، القبائل"><Text value={d.category} onChange={(v) => edit((c) => { c.category = v; })} /></Field>
        </div>
      </Section>

      <Section title="🏆 هدف المليون" desc="شريط تقدم نحو الهدف في الصفحة والواجهة">
        <div className="a-form">
          <Toggle label="إظهار الهدف" checked={d.goal.enabled} onChange={(v) => edit((c) => { c.goal.enabled = v; })} />
          <Field label="عدد النقاط المستهدف"><Num value={d.goal.target} min={1} onChange={(v) => edit((c) => { c.goal.target = v; })} /></Field>
          <Field label="نص الهدف"><Text value={d.goal.label} onChange={(v) => edit((c) => { c.goal.label = v; })} /></Field>
        </div>
      </Section>

      <Section title="قوالب جاهزة" desc="تستبدل قائمة الفرق الحالية (لا يُحفظ شيء قبل الضغط على «حفظ»)" className="span-2">
        <div className="a-row">
          {Object.entries(PRESETS).map(([name, p]) => (
            <Btn key={name} variant="ghost" size="sm" onClick={() => edit((c) => { c.teams = p.teams.map((t) => ({ id: '', image: '', ...JSON.parse(JSON.stringify(t)) })); c.category = p.category; })}>{name}</Btn>
          ))}
        </div>
      </Section>

      <Section title={`الفرق (${d.teams.length})`} className="span-2"
        desc="كلمات الشات تجعل المشاهد ينضم للفريق فتُحسب هداياه له. الهدايا المحددة للفريق تُحسب له دائماً. اسم الفريق وعلمه يعملان ككلمات تلقائياً."
        actions={<Btn variant="gold" size="sm" icon="plus" disabled={d.teams.length >= 16} onClick={() => edit((c) => { c.teams.push({ id: '', name: `فريق ${c.teams.length + 1}`, emoji: '🏳️', color: colors[c.teams.length % colors.length], image: '', keywords: [], gifts: [] }); })}>إضافة فريق</Btn>}>
        <div className="a-teams">
          {d.teams.map((t, i) => (
            <div key={t.id || `new-${i}`} className="a-team" style={{ '--team': t.color }}>
              <div className="a-team-head">
                <input className="a-input a-emoji emoji" value={t.emoji} onChange={(e) => edit((c) => { c.teams[i].emoji = e.target.value; })} aria-label="الإيموجي" />
                <input className="a-input a-team-name" value={t.name} onChange={(e) => edit((c) => { c.teams[i].name = e.target.value; })} aria-label="اسم الفريق" />
                <Color value={t.color} onChange={(v) => edit((c) => { c.teams[i].color = v; })} />
                <div className="a-team-tools">
                  <button className="a-icon-btn" disabled={i === 0} onClick={() => edit((c) => { [c.teams[i - 1], c.teams[i]] = [c.teams[i], c.teams[i - 1]]; })} title="أعلى"><Icon name="up" /></button>
                  <button className="a-icon-btn" disabled={i === d.teams.length - 1} onClick={() => edit((c) => { [c.teams[i + 1], c.teams[i]] = [c.teams[i], c.teams[i + 1]]; })} title="أسفل"><Icon name="down" /></button>
                  <button className="a-icon-btn danger" disabled={d.teams.length <= 1} onClick={() => edit((c) => { c.teams.splice(i, 1); })} title="حذف"><Icon name="trash" /></button>
                </div>
              </div>
              <div className="a-form">
                <Field label="كلمات الشات (افصل بفاصلة)" hint="مثال: maroc، 🇲🇦، المغرب"><ListInput value={t.keywords} onChange={(v) => edit((c) => { c.teams[i].keywords = v; })} /></Field>
                <Field label="هدايا خاصة بالفريق" hint="أسماء الهدايا بالإنجليزية كما في تيك توك"><ListInput value={t.gifts} list="gift-names" placeholder="Rose" onChange={(v) => edit((c) => { c.teams[i].gifts = v; })} /></Field>
                <Field label="رابط صورة/شعار (اختياري)" hint="يستبدل الإيموجي"><input className="a-input num-latin" dir="ltr" value={t.image} placeholder="https://…" onChange={(e) => edit((c) => { c.teams[i].image = e.target.value; })} /></Field>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function Scoring({ live, draft, edit, dirty }) {
  const s = draft.scoring; const a = draft.alerts;
  const toRows = (o) => Object.entries(o || {});
  const [rows, setRows] = useState(() => toRows(s.giftMultipliers));
  useEffect(() => { if (!dirty) setRows(toRows(live.config.scoring.giftMultipliers)); }, [dirty, live.config]);
  const commit = (r) => { setRows(r); edit((c) => { c.scoring.giftMultipliers = Object.fromEntries(r.filter(([k]) => String(k).trim()).map(([k, v]) => [String(k).trim().toLowerCase(), Number(v) || 0])); }); };
  const set = (k) => (v) => edit((c) => { c.scoring[k] = v; });
  const setA = (k) => (v) => edit((c) => { c.alerts[k] = v; });

  return (
    <div className="a-grid">
      <GiftDatalist gifts={live.gifts} />
      <Section title="حساب النقاط" desc="نقاط الهدية = الماسات × نقاط الماسة × مضاعف الهدية × المضاعف العام">
        <div className="a-form">
          <Field label="نقاط لكل ماسة 💎"><Num value={s.pointsPerDiamond} step="0.1" min={0} onChange={set('pointsPerDiamond')} /></Field>
          <Field label="المضاعف العام"><Num value={s.globalMultiplier} step="0.1" min={0} onChange={set('globalMultiplier')} /></Field>
          <Field label="قيمة هدية مجهولة السعر"><Num value={s.unknownGiftValue} min={0} onChange={set('unknownGiftValue')} /></Field>
          <Field label="هدية من مشاهد بلا فريق">
            <Select value={s.unassignedGiftPolicy} onChange={set('unassignedGiftPolicy')} options={[['ignore', 'تجاهل (واطلب منه اختيار فريق)'], ['underdog', 'تُمنح للأخير'], ['leader', 'تُمنح للمتصدر']]} />
          </Field>
        </div>
      </Section>

      <Section title="الشات والإعجابات">
        <div className="a-form">
          <Toggle label="كلمة في الشات تضم المشاهد لفريق" checked={s.allegianceEnabled} onChange={set('allegianceEnabled')} />
          <Toggle label="يمكن للمشاهد تغيير فريقه" checked={s.allowTeamSwitch} onChange={set('allowTeamSwitch')} />
          <Field label="نقاط لكل تصويت في الشات (0 = إيقاف)"><Num value={s.chatVotePoints} min={0} onChange={set('chatVotePoints')} /></Field>
          <Field label="مهلة التصويت (ثوانٍ)"><Num value={s.chatVoteCooldownSec} min={0} onChange={set('chatVoteCooldownSec')} /></Field>
          <Field label="نقاط لكل إعجاب (0 = إيقاف)"><Num value={s.likePoints} step="0.01" min={0} onChange={set('likePoints')} /></Field>
        </div>
      </Section>

      <Section title="مضاعفات الهدايا" desc="اسم الهدية (أي حالة أحرف) أو رقمها" className="span-2"
        actions={<Btn size="sm" variant="ghost" icon="plus" onClick={() => setRows([...rows, ['', 1]])}>إضافة</Btn>}>
        <div className="a-mults">
          {rows.length === 0 && <p className="a-empty">لا توجد مضاعفات. كل الهدايا ×1.</p>}
          {rows.map(([k, v], i) => (
            <div key={i} className="a-mult">
              <input className="a-input num-latin" dir="ltr" list="gift-names" value={k} placeholder="Galaxy" onChange={(e) => { const r = rows.map((x) => [...x]); r[i][0] = e.target.value; commit(r); }} />
              <span className="a-x">×</span>
              <input className="a-input num-latin" type="number" step="0.1" min="0" value={v} onChange={(e) => { const r = rows.map((x) => [...x]); r[i][1] = e.target.value; commit(r); }} />
              <button className="a-icon-btn danger" onClick={() => commit(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
        <h4 className="a-sub">الهدايا التي ظهرت في البث</h4>
        {live.gifts.length === 0 ? <p className="a-muted">تظهر القائمة بعد الاتصال بالبث أو تشغيل الوضع التجريبي.</p> : (
          <div className="a-giftchips">
            {live.gifts.slice(0, 300).map((g) => (
              <button key={g.id} className="a-giftchip" onClick={() => { if (!rows.some(([k]) => k.toLowerCase() === g.name.toLowerCase())) commit([...rows, [g.name, 1]]); }}>
                {g.image && <img src={g.image} alt="" referrerPolicy="no-referrer" />}<span className="num-latin">{g.name}</span><small className="num-latin">{g.diamonds}💎</small>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="التنبيهات" className="span-2">
        <div className="a-form cols-3">
          <Field label="حد الهدية الكبيرة (نقاط)" hint="احتفال وتنبيه ذهبي"><Num value={a.majorGiftPoints} min={1} onChange={setA('majorGiftPoints')} /></Field>
          <Field label="مدة التنبيه (ملّي ثانية)"><Num value={a.toastDurationMs} step="500" min={1000} onChange={setA('toastDurationMs')} /></Field>
          <Field label="أقصى عدد تنبيهات"><Num value={a.maxToasts} min={1} max={12} onChange={setA('maxToasts')} /></Field>
          <Toggle label="احتفال عند تغيّر المتصدر" checked={a.confettiOnTakeover} onChange={setA('confettiOnTakeover')} />
          <Toggle label="إظهار المنضمين في الشريط" checked={a.showJoins} onChange={setA('showJoins')} />
          <Toggle label="تذكير «اختر فريقك»" checked={a.showUnassigned} onChange={setA('showUnassigned')} />
        </div>
      </Section>
    </div>
  );
}

/** 1920x1080 overlay scaled to fit its box. */
function OverlayPreview({ config, live }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (box.current) setScale(box.current.clientWidth / 1920); });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="a-preview" style={{ height: 1080 * scale }}>
      <div className="a-preview-stage" style={{ transform: `scale(${scale})` }}>
        <Overlay config={config} state={live.state} byId={live.byId} status={live.status} preview />
      </div>
    </div>
  );
}

export function Theme({ live, draft, edit }) {
  const t = draft.theme;
  const set = (k) => (v) => edit((c) => { c.theme[k] = v; });
  return (
    <div className="a-grid">
      <Section title="معاينة مباشرة لواجهة OBS" desc="تتحدث فوراً مع كل تعديل. اضغط «حفظ وتطبيق» لإرسالها إلى OBS." className="span-2">
        <OverlayPreview config={draft} live={live} />
      </Section>
      <Section title="الألوان والزجاج">
        <div className="a-form">
          <Field label="لون التمييز"><Color value={t.accent} onChange={set('accent')} /></Field>
          <Field label="لون النص"><Color value={t.textColor} onChange={set('textColor')} /></Field>
          <Field label="شفافية البطاقات"><Range value={t.glassOpacity} min={0} max={1} step={0.01} onChange={set('glassOpacity')} /></Field>
          <Field label="التمويه"><Range value={t.blur} min={0} max={40} step={1} suffix="px" onChange={set('blur')} /></Field>
          <Field label="استدارة الحواف"><Range value={t.radius} min={0} max={40} step={1} suffix="px" onChange={set('radius')} /></Field>
          <Field label="حجم الخط"><Range value={t.fontScale} min={0.6} max={1.6} step={0.05} onChange={set('fontScale')} /></Field>
          <Field label="الخط" hint="Cairo مضمّن. أي خط آخر من Google Fonts (مثل Tajawal أو Almarai)"><Text value={t.fontFamily} onChange={set('fontFamily')} /></Field>
          <Field label="خلفية المعاينة" hint="transparent لـ OBS"><Text value={t.background} onChange={set('background')} /></Field>
        </div>
      </Section>
      <Section title="التخطيط">
        <div className="a-form">
          <Field label="الشكل"><Select value={t.layout} onChange={set('layout')} options={[['list', 'قائمة عمودية'], ['grid', 'شبكة']]} /></Field>
          <Field label="موضع اللوحة"><Select value={t.position} onChange={set('position')} options={[['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']]} /></Field>
          <Field label="جهة التنبيهات"><Select value={t.toastPosition} onChange={set('toastPosition')} options={[['left', 'يسار'], ['right', 'يمين']]} /></Field>
          <Field label="عرض اللوحة"><Range value={t.width} min={360} max={1200} step={10} suffix="px" onChange={set('width')} /></Field>
          <Field label="أقصى عدد فرق ظاهرة"><Num value={t.maxVisible} min={1} max={16} onChange={set('maxVisible')} /></Field>
          <Field label="عدد الداعمين لكل فريق"><Num value={t.contributorsCount} min={1} max={5} onChange={set('contributorsCount')} /></Field>
          <Toggle label="إظهار الداعمين" checked={t.showContributors} onChange={set('showContributors')} />
          <Toggle label="إظهار الرأس" checked={t.showHeader} onChange={set('showHeader')} />
          <Toggle label="إظهار الشعار" checked={t.showLogo} onChange={set('showLogo')} />
          <Toggle label="إظهار الشريط الإخباري" checked={t.showTicker} onChange={set('showTicker')} />
          <Toggle label="إظهار عدد المشاهدين" checked={t.showViewers} onChange={set('showViewers')} />
        </div>
      </Section>
    </div>
  );
}
