'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Overlay from '../Overlay';
import LiveView from '../LiveView';
import { Flag, GiftIcon, teamImage } from '../bits';
import { ARAB_COUNTRIES, countryTeam, flagCode, flagPath } from '@/lib/flags';
import { GiftFetcher, GiftGrid, GiftPickerModal } from './GiftPicker';
import { findGift, useGiftMap } from '@/lib/gifts';
import { FONTS } from '@/lib/fonts';
import { api } from '@/lib/api';
import { PRESETS } from '@/lib/presets';
import { SKINS, SKIN_CATS, activeSkin, skinName, skinTone, skinVars } from '@/lib/skins';
import { pickFile, uploadImage } from '@/lib/upload';
import { safeUrl } from '@/lib/format';
import { cmd } from '@/lib/store';
import { Btn, Color, Field, Icon, Num, Range, Section, Select, Text, Toggle, useNotice } from './ui';

/** Upload button: picks an image, shrinks it, uploads it and returns its /uploads/ URL. */
function UploadBtn({ max = 512, onDone, children = 'رفع صورة', variant = 'ghost', size = 'sm' }) {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const f = await pickFile(); if (!f) return;
    setBusy(true);
    try { onDone(await uploadImage(f, { max })); notice('تم رفع الصورة'); } catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  return <Btn variant={variant} size={size} icon="plus" busy={busy} onClick={go}>{children}</Btn>;
}

/** Code of the country a team stands for (from its flag picture or flag emoji). */
const teamCountry = (t) => (/^\/flags\/([a-z]{2})\.svg$/.exec(t.image || '') || [])[1] || flagCode(t.emoji);

/** Click a flag to add / remove that Arab country as a team (picture flags, ready keywords, a free gift). */
function ArabCountries({ d, edit, giftMap }) {
  const have = new Map(d.teams.map((t, i) => [teamCountry(t), i]));
  const used = new Set(d.teams.flatMap((t) => t.gifts.map((g) => g.toLowerCase())));
  const freeGift = () => POPULAR_GIFTS.find((g) => !used.has(g.toLowerCase()) && (!giftMap?.size || findGift(giftMap, g)));
  const toggle = (code) => edit((c) => {
    const i = c.teams.findIndex((t) => teamCountry(t) === code);
    if (i >= 0) { if (c.teams.length > 1) c.teams.splice(i, 1); return; }
    if (c.teams.length >= 30) return;
    c.teams.push({ id: '', nameScale: 1, ...countryTeam(code, freeGift()) });
    c.category = c.category || 'الدول';
  });
  const addAll = () => edit((c) => {
    const keep = c.teams.filter((t) => !ARAB_COUNTRIES.some((x) => x.code === teamCountry(t)) && /^فريق \d+$/.test(t.name) === false);
    const taken = new Set(keep.flatMap((t) => t.gifts.map((g) => g.toLowerCase())));
    const gifts = POPULAR_GIFTS.filter((g) => !taken.has(g.toLowerCase()));
    c.teams = [...keep, ...ARAB_COUNTRIES.map((x, i) => ({ id: '', nameScale: 1, ...countryTeam(x.code, gifts[i]) }))].slice(0, 30);
    c.category = 'الدول';
  });
  return (
    <Section title="🌍 الدول العربية" className="span-2"
      desc="اضغط على العلم لإضافة الدولة كفريق (أو لحذفها). الأعلام صور حقيقية تظهر في OBS على كل الأجهزة، مع كلمات شات جاهزة وهدية مختلفة لكل دولة."
      actions={<div className="a-inline">
        <Btn size="sm" variant="gold" onClick={addAll}>إضافة كل الدول (22)</Btn>
        <Btn size="sm" variant="ghost" onClick={() => edit((c) => { c.teams.forEach((t) => { const code = teamCountry(t); if (code && !t.image) t.image = flagPath(code); }); })}>تحويل الإيموجي إلى صور أعلام</Btn>
      </div>}>
      <div className="a-countries">
        {ARAB_COUNTRIES.map((x) => (
          <button key={x.code} type="button" className={`a-country${have.has(x.code) ? ' on' : ''}`} onClick={() => toggle(x.code)} title={have.has(x.code) ? 'حذف من الفرق' : 'إضافة كفريق'}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={flagPath(x.code)} alt="" />
            <span>{x.name}</span>
            {have.has(x.code) && <Icon name="check" size={14} />}
          </button>
        ))}
      </div>
    </Section>
  );
}

// Cheap, well-known gifts first when auto-assigning one distinct gift per team.
const POPULAR_GIFTS = ['Rose', 'TikTok', 'Heart Me', 'GG', 'Ice Cream Cone', 'Finger Heart', 'Weights', 'Perfume', 'Doughnut', 'Hand Hearts', 'Cap', 'Sunglasses', 'Corgi', 'Money Gun', 'Galaxy', 'Lion', 'Friendship Necklace', 'Love you', 'Cake Slice', 'Hat and Mustache', 'Mic', 'Swan', 'Paper Crane', 'Rosa'];

/** Overview: each team's gift(s), conflicts, and one-click distinct assignment. */
function TeamGiftsOverview({ d, edit, live, onPick }) {
  const giftMap = useGiftMap(live.gifts);
  const owner = new Map();
  const dup = new Set();
  const dupNames = new Set();
  d.teams.forEach((t) => t.gifts.forEach((g) => { const k = g.toLowerCase(); if (owner.has(k)) { dup.add(k); dupNames.add(g); } else owner.set(k, t.id); }));
  const missing = d.teams.filter((t) => !t.gifts.length);
  const autoAssign = () => {
    if (!confirm('توزيع هدية مختلفة لكل فريق؟ سيستبدل هذا هدايا الفرق الحالية.')) return;
    const names = live.gifts.length
      ? [...POPULAR_GIFTS.filter((n) => giftMap.has(n.toLowerCase())).map((n) => giftMap.get(n.toLowerCase()).name),
         ...live.gifts.filter((g) => !POPULAR_GIFTS.some((n) => n.toLowerCase() === g.name.toLowerCase())).map((g) => g.name)]
      : POPULAR_GIFTS;
    edit((c) => { c.teams.forEach((t, i) => { t.gifts = names[i] ? [names[i]] : []; }); });
  };
  return (
    <Section title="🎁 هدية كل دولة" className="span-2"
      desc="كل من يرسل هدية الدولة تُحسب نقاطه لتلك الدولة تلقائياً. اجعل لكل دولة هدية مختلفة."
      actions={<Btn size="sm" variant="ghost" icon="dice" onClick={autoAssign}>توزيع تلقائي</Btn>}>
      {dup.size > 0 && <div className="a-alert warn"><Icon name="close" />نفس الهدية عند أكثر من دولة: <b className="num-latin">{[...dupNames].join('، ')}</b>. تُحسب للدولة الأولى في القائمة فقط.</div>}
      {missing.length > 0 && <div className="a-alert warn"><Icon name="gift" />بدون هدية: {missing.map((t) => t.name).join('، ')}</div>}
      <div className="a-gift-map">
        {d.teams.map((t, i) => (
          <button key={t.id || i} type="button" className="a-gm-item" style={{ '--team': t.color }} onClick={() => onPick(i)} title="اضغط لاختيار الهدايا">
            <span className="a-gm-flag"><Flag team={t} /></span>
            <b>{t.name}</b>
            <span className="a-gm-eq">=</span>
            <span className="a-gm-gifts">
              {t.gifts.length ? t.gifts.map((n) => (
                <span key={n} className={`a-gm-gift${dup.has(n.toLowerCase()) && owner.get(n.toLowerCase()) !== t.id ? ' bad' : ''}`}>
                  <GiftIcon gift={findGift(giftMap, n)} name={n} className="a-gm-img" /><small className="num-latin">{n}</small>
                </span>
              )) : <span className="a-muted">+ اختر هدية</span>}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

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
  const giftMap = useGiftMap(live.gifts);
  const [pickFor, setPickFor] = useState(null); // team index for the gift picker
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

      <TeamGiftsOverview d={d} edit={edit} live={live} onPick={setPickFor} />

      <Section title="قوالب جاهزة" desc="تستبدل قائمة الفرق الحالية (لا يُحفظ شيء قبل الضغط على «حفظ»)" className="span-2">
        <div className="a-row">
          {Object.entries(PRESETS).map(([name, p]) => (
            <Btn key={name} variant="ghost" size="sm" onClick={() => edit((c) => { c.teams = p.teams.map((t) => ({ id: '', image: '', nameScale: 1, ...JSON.parse(JSON.stringify(t)) })); c.category = p.category; })}>{name}</Btn>
          ))}
        </div>
      </Section>

      <ArabCountries d={d} edit={edit} giftMap={giftMap} />

      <Section title={`الفرق (${d.teams.length})`} className="span-2"
        desc="كلمات الشات تجعل المشاهد ينضم للفريق فتُحسب هداياه له. الهدايا المحددة للفريق تُحسب له دائماً. اسم الفريق وعلمه يعملان ككلمات تلقائياً."
        actions={<Btn variant="gold" size="sm" icon="plus" disabled={d.teams.length >= 30} onClick={() => edit((c) => { c.teams.push({ id: '', name: `فريق ${c.teams.length + 1}`, emoji: '🏳️', color: colors[c.teams.length % colors.length], image: '', nameScale: 1, keywords: [], gifts: [] }); })}>إضافة فريق</Btn>}>
        <div className="a-teams">
          {d.teams.map((t, i) => (
            <div key={t.id || `new-${i}`} className="a-team" style={{ '--team': t.color }}>
              <div className="a-team-head">
                <span className={`a-team-photo${teamImage(t) ? ' has' : ''}`}><Flag team={t} /></span>
                <input className="a-input a-emoji emoji" value={t.emoji} onChange={(e) => edit((c) => { c.teams[i].emoji = e.target.value; })} aria-label="الإيموجي" title="الإيموجي (يُستخدم إذا لم توجد صورة)" />
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
                <Field label="هدايا خاصة بالفريق" hint="من يرسل هذه الهدايا يدعم هذا الفريق تلقائياً">
                  <div className="a-teamgifts">
                    {t.gifts.map((n) => (
                      <span key={n} className="a-tgift"><GiftIcon gift={findGift(giftMap, n)} name={n} className="a-tgift-img" /><span className="num-latin">{n}</span>
                        <button type="button" onClick={() => edit((c) => { c.teams[i].gifts = c.teams[i].gifts.filter((x) => x !== n); })} aria-label="إزالة"><Icon name="close" size={12} /></button></span>
                    ))}
                    <Btn size="sm" variant="ghost" icon="gift" onClick={() => setPickFor(i)}>اختيار هدايا</Btn>
                  </div>
                  <ListInput value={t.gifts} list="gift-names" placeholder="أو اكتب الأسماء: Rose، TikTok" onChange={(v) => edit((c) => { c.teams[i].gifts = v; })} />
                </Field>
                <Field label="صورة الفريق (علم / شعار / صورة القبيلة)" hint="تستبدل الإيموجي في كل الشاشات. PNG أو JPG أو WebP أو GIF">
                  <div className="a-inline">
                    <UploadBtn onDone={(url) => edit((c) => { c.teams[i].image = url; })}>{t.image ? 'تغيير الصورة' : 'رفع صورة'}</UploadBtn>
                    {t.image && <Btn size="sm" variant="ghost" icon="trash" onClick={() => edit((c) => { c.teams[i].image = ''; })}>إزالة</Btn>}
                    <input className="a-input num-latin" dir="ltr" value={t.image} placeholder="أو رابط https://…" onChange={(e) => edit((c) => { c.teams[i].image = e.target.value; })} />
                  </div>
                </Field>
                <Field label="حجم اسم هذا الفريق" hint="صغّر الأسماء الطويلة أو كبّر القصيرة">
                  <Range value={t.nameScale ?? 1} min={0.5} max={2.5} step={0.05} suffix="×" onChange={(v) => edit((c) => { c.teams[i].nameScale = v; })} />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <GiftPickerModal open={pickFor !== null} multi title={pickFor !== null ? `هدايا ${d.teams[pickFor]?.name || ''}` : ''}
        gifts={live.gifts} selected={pickFor !== null ? d.teams[pickFor]?.gifts || [] : []} onClose={() => setPickFor(null)}
        onPick={(g) => edit((c) => { const t = c.teams[pickFor]; const has = t.gifts.some((x) => x.toLowerCase() === g.name.toLowerCase()); t.gifts = has ? t.gifts.filter((x) => x.toLowerCase() !== g.name.toLowerCase()) : [...t.gifts, g.name]; })} />
    </div>
  );
}

export function Scoring({ live, draft, edit, dirty, notice }) {
  const s = draft.scoring; const a = draft.alerts;
  const toRows = (o) => Object.entries(o || {});
  const [rows, setRows] = useState(() => toRows(s.giftMultipliers));
  useEffect(() => { if (!dirty) setRows(toRows(live.config.scoring.giftMultipliers)); }, [dirty, live.config]);
  const commit = (r) => { setRows(r); edit((c) => { c.scoring.giftMultipliers = Object.fromEntries(r.filter(([k]) => String(k).trim()).map(([k, v]) => [String(k).trim().toLowerCase(), Number(v) || 0])); }); };
  const set = (k) => (v) => edit((c) => { c.scoring[k] = v; });
  const setA = (k) => (v) => edit((c) => { c.alerts[k] = v; });
  const giftMap = useGiftMap(live.gifts);

  return (
    <div className="a-grid">
      <GiftDatalist gifts={live.gifts} />
      <Section title="حساب النقاط" desc="نقاط الهدية = الماسات × نقاط الماسة × مضاعف الهدية × المضاعف العام">
        <div className="a-form">
          <Field label="نقاط لكل ماسة 💎"><Num value={s.pointsPerDiamond} step="0.1" min={0} onChange={set('pointsPerDiamond')} /></Field>
          <Field label="المضاعف العام"><Num value={s.globalMultiplier} step="0.1" min={0} onChange={set('globalMultiplier')} /></Field>
          <Field label="قيمة هدية مجهولة السعر"><Num value={s.unknownGiftValue} min={0} onChange={set('unknownGiftValue')} /></Field>
          <Field label="طريقة احتساب الهدايا" hint="«هدية الدولة فقط»: كل دولة تُدعم بهديتها فقط، والهدايا الأخرى لا تُحسب">
            <Select value={s.giftMode || 'mixed'} onChange={set('giftMode')} options={[['mixed', 'هدية الدولة + اختيار الفريق من الشات'], ['giftOnly', 'هدية الدولة فقط']]} />
          </Field>
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

      <Section title="💛 المتابعون والمشاركات" className="span-2"
        desc="نقاط لفريق المشاهد عند متابعة البث أو مشاركته (يجب أن يكون المشاهد قد اختار فريقاً). كل متابع يُحسب مرة واحدة."
        actions={<Btn size="sm" variant="ghost" icon="trash" onClick={() => confirm('تصفير عداد المتابعين والمشاركات؟') && cmd('socialReset').then(() => notice('تم التصفير')).catch((e) => notice(e.message, 'err'))}>تصفير العداد</Btn>}>
        <div className="a-form cols-3">
          <Field label="نقاط المتابعة"><Num value={draft.social.followPoints} min={0} onChange={(v) => edit((c) => { c.social.followPoints = v; })} /></Field>
          <Field label="نقاط المشاركة"><Num value={draft.social.sharePoints} min={0} onChange={(v) => edit((c) => { c.social.sharePoints = v; })} /></Field>
          <Field label="أقصى مشاركات محسوبة لكل مشاهد" hint="يمنع تكرار المشاركة للنقاط"><Num value={draft.social.shareMaxPerUser} min={0} max={100} onChange={(v) => edit((c) => { c.social.shareMaxPerUser = v; })} /></Field>
          <Toggle label="تنبيه المتابعين الجدد" checked={draft.social.followAlerts} onChange={(v) => edit((c) => { c.social.followAlerts = v; })} />
          <Toggle label="تنبيه المشاركات" checked={draft.social.shareAlerts} onChange={(v) => edit((c) => { c.social.shareAlerts = v; })} />
          <Toggle label="شريط هدف المتابعين" checked={draft.social.followGoal.enabled} onChange={(v) => edit((c) => { c.social.followGoal.enabled = v; })} />
          <Field label="هدف المتابعين"><Num value={draft.social.followGoal.target} min={1} onChange={(v) => edit((c) => { c.social.followGoal.target = v; })} /></Field>
          <Field label="نص هدف المتابعين"><Text value={draft.social.followGoal.label} onChange={(v) => edit((c) => { c.social.followGoal.label = v; })} /></Field>
          <div className="a-field"><span className="a-label">الحالي</span><b className="num-latin a-gold">💛 {live.state?.social?.follows || 0} · 🔁 {live.state?.social?.shares || 0}</b></div>
        </div>
      </Section>

      <Section title="مضاعفات الهدايا" desc="اسم الهدية (أي حالة أحرف) أو رقمها" className="span-2"
        actions={<Btn size="sm" variant="ghost" icon="plus" onClick={() => setRows([...rows, ['', 1]])}>إضافة</Btn>}>
        <div className="a-mults">
          {rows.length === 0 && <p className="a-empty">لا توجد مضاعفات. كل الهدايا ×1.</p>}
          {rows.map(([k, v], i) => (
            <div key={i} className="a-mult">
              <GiftIcon gift={findGift(giftMap, k)} name={k} className="a-mult-img" />
              <input className="a-input num-latin" dir="ltr" list="gift-names" value={k} placeholder="Galaxy" onChange={(e) => { const r = rows.map((x) => [...x]); r[i][0] = e.target.value; commit(r); }} />
              <span className="a-x">×</span>
              <input className="a-input num-latin" type="number" step="0.1" min="0" value={v} onChange={(e) => { const r = rows.map((x) => [...x]); r[i][1] = e.target.value; commit(r); }} />
              <button className="a-icon-btn danger" onClick={() => commit(rows.filter((_, j) => j !== i))}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
        <h4 className="a-sub">🎁 قائمة هدايا تيك توك (اضغط لإضافة مضاعف)</h4>
        <GiftFetcher live={live} />
        <GiftGrid gifts={live.gifts} selected={rows.map(([k]) => k)} onPick={(g) => { if (!rows.some(([k]) => k.toLowerCase() === g.name.toLowerCase())) commit([...rows, [g.name, 1]]); }} />
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

/** A fixed-size stage (1920x1080 overlay or 1440x1000 live page) scaled to fit its box. */
function ScaledStage({ w, h, children }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { if (box.current) setScale(box.current.clientWidth / w); });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={box} className="a-preview" style={{ height: h * scale }}>
      <div className="a-preview-stage" style={{ width: w, height: h, transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

function SkinCard({ skin, theme, title, selected, today, inRotation, rotating, onPick, onToggle }) {
  return (
    <div className={`a-skin${selected ? ' selected' : ''}`}>
      <button className="a-skin-pick" onClick={onPick} title="اختيار هذا الشكل">
        <div className="skin-swatch" data-skin={skin.id} data-tone={skinTone(skin.id, theme)} style={skin.id === 'custom' ? skinVars(theme) : undefined}>
          <span className="sw-title">{title || 'تحدي المليون'}</span>
          <span className="sw-card" /><span className="sw-card b" />
        </div>
        <div className="a-skin-meta">
          <b>{skin.name}</b><span className="a-muted">{skin.desc}</span>
        </div>
      </button>
      <div className="a-skin-foot">
        {today && <span className="a-chip gold">● المعروض الآن</span>}
        {selected && !rotating && !today && <span className="a-chip">المختار</span>}
        {rotating && (
          <label className="a-mini-check"><input type="checkbox" checked={inRotation} onChange={(e) => onToggle(e.target.checked)} />ضمن التبديل</label>
        )}
      </div>
    </div>
  );
}

function Library({ onUse, onLogo, refreshKey }) {
  const notice = useNotice();
  const [files, setFiles] = useState(null);
  const load = useCallback(async () => { try { setFiles((await api('/api/uploads')).files); } catch (e) { notice(e.message, 'err'); } }, [notice]);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!files) return <div className="a-center"><span className="spin" /></div>;
  if (!files.length) return <p className="a-empty">لا توجد صور مرفوعة بعد.</p>;
  return (
    <div className="a-library">
      {files.map((f) => (
        <div key={f.name} className="a-lib-item">
          <img src={f.url} alt="" loading="lazy" />
          <div className="a-lib-actions">
            <button className="a-icon-btn" title="استخدام كخلفية" onClick={() => onUse(f.url)}><Icon name="check" /></button>
            {onLogo && <button className="a-icon-btn" title="استخدام كشعار" onClick={() => onLogo(f.url)}>🏷️</button>}
            <button className="a-icon-btn danger" title="حذف" onClick={async () => {
              if (!confirm('حذف هذه الصورة؟ إذا كانت مستخدمة ستختفي من الشاشات.')) return;
              try { await api(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'DELETE' }); load(); } catch (e) { notice(e.message, 'err'); }
            }}><Icon name="trash" /></button>
          </div>
          <small className="num-latin">{Math.round(f.size / 1024)} KB</small>
        </div>
      ))}
    </div>
  );
}

/** Show / hide and resize every part of the OBS header card and the team cards. */
function PartsEditor({ draft, edit }) {
  const t = draft.theme;
  const p = t.parts || {}; const z = t.sizes || {};
  const part = (k) => ({ checked: p[k] !== false, onChange: (v) => edit((c) => { c.theme.parts = { ...(c.theme.parts || {}), [k]: v }; }) });
  // showGiftLegend / showTeamGifts default to on when missing.
  const theme = (k) => ({ checked: k === 'showGiftLegend' || k === 'showTeamGifts' ? t[k] !== false : Boolean(t[k]), onChange: (v) => edit((c) => { c.theme[k] = v; }) });
  const size = (k) => ({ value: z[k] ?? 1, min: 0.5, max: 2.5, step: 0.05, suffix: '×', onChange: (v) => edit((c) => { c.theme.sizes = { ...(c.theme.sizes || {}), [k]: v }; }) });
  const reset = () => edit((c) => { c.theme.parts = {}; c.theme.sizes = {}; c.theme.nameScale = 1; c.theme.flagScale = 1; c.theme.logoSize = 1; });
  return (
    <Section title="🧩 تخصيص البطاقات" className="span-2"
      desc="اختر ما يظهر وما يختفي في بطاقة الرأس (العنوان والهدف) وبطاقات الفرق، وغيّر حجم كل جزء. المعاينة في الأعلى تتحدث فوراً."
      actions={<Btn size="sm" variant="ghost" icon="update" onClick={reset}>إرجاع الافتراضي</Btn>}>
      <div className="a-parts">
        <div className="a-parts-col">
          <h4 className="a-sub">بطاقة الرأس (OBS)</h4>
          <div className="a-part-row"><Toggle label="الشعار" {...theme('showLogo')} /><Range value={t.logoSize ?? 1} min={0.4} max={2.5} step={0.05} suffix="×" onChange={(v) => edit((c) => { c.theme.logoSize = v; })} /></div>
          <div className="a-part-row"><Toggle label="العنوان" {...part('title')} /><Range {...size('title')} /></div>
          <div className="a-part-row"><Toggle label="العنوان الفرعي (اكتب اسم فريقك…)" {...part('subtitle')} /><Range {...size('subtitle')} /></div>
          <div className="a-part-row"><Toggle label="شارة النوع (الدول)" {...part('category')} /><Range {...size('chips')} /></div>
          <div className="a-part-row"><Toggle label="شارة مجموع النقاط" {...part('points')} /><span className="a-muted a-part-note">نفس حجم الشارات</span></div>
          <div className="a-part-row"><Toggle label="عدد المشاهدين" {...theme('showViewers')} /><span className="a-muted a-part-note">نفس حجم الشارات</span></div>
          <div className="a-part-row"><Toggle label="مؤقت الجولة" checked={draft.rounds?.showTimer !== false} onChange={(v) => edit((c) => { c.rounds = { ...(c.rounds || {}), showTimer: v }; })} /><span className="a-muted a-part-note">نفس حجم الشارات</span></div>
          <div className="a-part-row"><Toggle label="هدف المليون" {...part('goal')} /><Range {...size('goal')} /></div>
          <div className="a-part-row"><Toggle label="هدف المتابعين" {...part('followGoal')} /><span className="a-muted a-part-note">نفس حجم الهدف</span></div>
          <div className="a-part-row"><Toggle label="دليل «العلم = الهدية»" {...theme('showGiftLegend')} /><Range {...size('legend')} /></div>
        </div>
        <div className="a-parts-col">
          <h4 className="a-sub">بطاقات الفرق (OBS والصفحة المباشرة)</h4>
          <div className="a-part-row"><Toggle label="اسم الدولة / الفريق" {...part('name')} /><Range value={t.nameScale ?? 1} min={0.5} max={2.5} step={0.05} suffix="×" onChange={(v) => edit((c) => { c.theme.nameScale = v; })} /></div>
          <div className="a-part-row"><Toggle label="العلم / الصورة" {...part('flag')} /><Range value={t.flagScale ?? 1} min={0.5} max={2.5} step={0.05} suffix="×" onChange={(v) => edit((c) => { c.theme.flagScale = v; })} /></div>
          <div className="a-part-row"><Toggle label="رقم الترتيب" {...part('rank')} /><Range {...size('rank')} /></div>
          <div className="a-part-row"><Toggle label="التاج 👑 للمتصدر" {...part('crown')} /><span /></div>
          <div className="a-part-row"><Toggle label="الميداليات 🥈🥉" {...part('medal')} /><span /></div>
          <div className="a-part-row"><Toggle label="النسبة المئوية" {...part('share')} /><Range {...size('share')} /></div>
          <div className="a-part-row"><Toggle label="شريط التقدم" {...part('bar')} /><span /></div>
          <div className="a-part-row"><Toggle label="صور هدايا الفريق" {...theme('showTeamGifts')} /><Range {...size('gifts')} /></div>
          <div className="a-part-row"><Toggle label="الداعمون" {...theme('showContributors')} /><Range {...size('contribs')} /></div>
          <div className="a-part-row"><Toggle label="النقاط (الرقم)" {...part('score')} /><Range {...size('score')} /></div>
          <div className="a-part-row"><Toggle label="كلمة «نقطة»" {...part('pts')} /><Range {...size('gap')} /></div>
          <div className="a-part-row"><Toggle label="الفارق (تقدّم / ▼)" {...part('gap')} /><span className="a-muted a-part-note">نفس حجم «نقطة»</span></div>
        </div>
      </div>
    </Section>
  );
}

export function Theme({ live, draft, edit }) {
  const t = draft.theme;
  const set = (k) => (v) => edit((c) => { c.theme[k] = v; });
  const [view, setView] = useState('overlay');
  const [libKey, setLibKey] = useState(0);
  const [cat, setCat] = useState('all');
  const shown = cat === 'all' ? SKINS : SKINS.filter((x) => x.cat === cat);
  const cu = t.custom || { primary: '#f5b301', secondary: '#c8102e', bg: '#0b0a0f', tone: 'dark' };
  const setCu = (k) => (v) => edit((c) => { c.theme.custom = { ...(c.theme.custom || cu), [k]: v }; });
  const rot = t.skinRotation || { mode: 'off', skins: [] };
  const rotating = rot.mode !== 'off';
  const nowSkin = activeSkin(t);
  const next = (() => {
    if (!rotating) return null;
    const d = new Date(); d.setDate(d.getDate() + (rot.mode === 'daily' ? 1 : 7 - ((d.getDay() + 6) % 7)));
    return activeSkin(t, d);
  })();
  const toggleRot = (id, on) => edit((c) => {
    const r = c.theme.skinRotation || { mode: 'off', skins: [] };
    const cur = r.skins.length ? r.skins : SKINS.map((s) => s.id);
    r.skins = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    if (r.skins.length === SKINS.length) r.skins = [];
    c.theme.skinRotation = r;
  });

  return (
    <div className="a-grid">
      <Section title="🎨 الأشكال الجاهزة" className="span-2"
        desc={`${SKINS.length} شكلاً للصفحة المباشرة وواجهة OBS، منها «تصميمي الخاص» بألوانك. كل بث له شكله وشعاره الخاص. اختر شكلاً ثابتاً، أو فعّل التبديل التلقائي ليتغير كل يوم أو كل أسبوع.`}
        actions={<div className="a-inline"><span className="a-label">التبديل التلقائي</span>
          <Select value={rot.mode} onChange={(v) => edit((c) => { c.theme.skinRotation = { ...(c.theme.skinRotation || { skins: [] }), mode: v }; })}
            options={[['off', 'إيقاف (شكل ثابت)'], ['daily', 'كل يوم'], ['weekly', 'كل أسبوع (الاثنين)']]} /></div>}>
        {rotating && (
          <div className="a-alert gold"><Icon name="update" />اليوم: <b>{skinName(nowSkin)}</b>{next && <> · {rot.mode === 'daily' ? 'غداً' : 'الأسبوع القادم'}: <b>{skinName(next)}</b></>} · الأشكال المشمولة: {rot.skins.length || SKINS.length}</div>
        )}
        <div className="a-seg a-skin-cats">
          {SKIN_CATS.map(([id, label]) => {
            const n = id === 'all' ? SKINS.length : SKINS.filter((x) => x.cat === id).length;
            return <button key={id} className={cat === id ? 'on' : ''} onClick={() => setCat(id)}>{label} <small className="num-latin">{n}</small></button>;
          })}
        </div>
        <div className="a-skins">
          {shown.map((sk) => (
            <SkinCard key={sk.id} skin={sk} theme={t} title={draft.title} selected={t.skin === sk.id} today={rotating ? nowSkin === sk.id : t.skin === sk.id}
              rotating={rotating} inRotation={!rot.skins.length || rot.skins.includes(sk.id)}
              onPick={() => edit((c) => { c.theme.skin = sk.id; if (rotating) c.theme.skinRotation = { ...c.theme.skinRotation, mode: 'off' }; })}
              onToggle={(on) => toggleRot(sk.id, on)} />
          ))}
        </div>
      </Section>

      <Section title="🎨 تصميمي الخاص" desc="اختر ألوانك ثم اختر شكل «تصميمي الخاص» في الأعلى. ينطبق على هذا البث فقط."
        actions={t.skin !== 'custom' && <Btn size="sm" variant="gold" onClick={() => edit((c) => { c.theme.skin = 'custom'; if (c.theme.skinRotation) c.theme.skinRotation = { ...c.theme.skinRotation, mode: 'off' }; })}>استخدام تصميمي</Btn>}>
        <div className="a-form">
          <Field label="اللون الأساسي" hint="العناوين والأرقام والتمييز"><Color value={cu.primary} onChange={setCu('primary')} /></Field>
          <Field label="اللون الثانوي" hint="الأشرطة والتوهج"><Color value={cu.secondary} onChange={setCu('secondary')} /></Field>
          <Field label="لون الخلفية والبطاقات"><Color value={cu.bg} onChange={setCu('bg')} /></Field>
          <Field label="نوع الخلفية"><Select value={cu.tone} onChange={setCu('tone')} options={[['dark', 'داكنة (نص أبيض)'], ['light', 'فاتحة (نص داكن)']]} /></Field>
        </div>
      </Section>

      <Section title="🏷️ شعار البث" desc="ارفع شعارك ليظهر بدل شعار «تحدي المليون» في OBS والصفحة المباشرة. يفضّل PNG بخلفية شفافة.">
        <div className="a-bg-pick">
          <div className="a-logo-thumb">{safeUrl(t.logo) || /^\/uploads\//.test(t.logo || '') ? <img src={t.logo} alt="" /> : <img src="/logo-sm.png" alt="" className="def" />}</div>
          <div className="a-bg-actions">
            <UploadBtn max={800} variant="gold" size="" onDone={(url) => { edit((c) => { c.theme.logo = url; c.theme.showLogo = true; }); setLibKey((k) => k + 1); }}>{t.logo ? 'تغيير الشعار' : 'رفع شعاري'}</UploadBtn>
            {t.logo && <Btn variant="ghost" icon="trash" onClick={() => edit((c) => { c.theme.logo = ''; })}>الشعار الافتراضي</Btn>}
          </div>
        </div>
        <div className="a-form">
          <Field label="حجم الشعار"><Range value={t.logoSize ?? 1} min={0.4} max={2.5} step={0.05} suffix="×" onChange={set('logoSize')} /></Field>
          <Toggle label="إظهار الشعار في OBS" checked={t.showLogo} onChange={set('showLogo')} />
          <Toggle label="إظهار الشعار في الصفحة المباشرة" checked={t.logoOnLive !== false} onChange={set('logoOnLive')} />
        </div>
      </Section>

      <Section title="معاينة مباشرة" className="span-2" desc="تتحدث فوراً مع كل تعديل. اضغط «حفظ وتطبيق» لإرسالها لكل الشاشات."
        actions={<div className="a-seg">
          <button className={view === 'overlay' ? 'on' : ''} onClick={() => setView('overlay')}>OBS أفقي</button>
          <button className={view === 'vertical' ? 'on' : ''} onClick={() => setView('vertical')}>OBS عمودي</button>
          <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}>الصفحة المباشرة</button>
        </div>}>
        {view === 'overlay' && <ScaledStage w={1920} h={1080}><Overlay config={draft} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} preview /></ScaledStage>}
        {view === 'vertical' && (
          <div className="a-vprev">
            <ScaledStage w={1080} h={1920}><div className="a-tiktok-safe"><span className="top">واجهة تيك توك العلوية</span><span className="bottom">التعليقات وأزرار تيك توك</span></div><Overlay config={draft} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} orientation="portrait" preview /></ScaledStage>
            <div className="a-form a-vprev-ctl">
              <h4 className="a-sub">إعدادات الواجهة العمودية</h4>
              <Field label="المسافة من الأعلى" hint="اترك مكاناً لاسمك وأزرار تيك توك"><Range value={t.vertical.top} min={0} max={900} step={10} suffix="px" onChange={(v) => edit((c) => { c.theme.vertical.top = v; })} /></Field>
              <Field label="الهامش الجانبي"><Range value={t.vertical.side} min={0} max={200} step={2} suffix="px" onChange={(v) => edit((c) => { c.theme.vertical.side = v; })} /></Field>
              <Field label="الحجم"><Range value={t.vertical.scale} min={0.5} max={2} step={0.05} suffix="×" onChange={(v) => edit((c) => { c.theme.vertical.scale = v; })} /></Field>
              <Field label="عدد الفرق الظاهرة"><Num value={t.vertical.maxVisible} min={1} max={30} onChange={(v) => edit((c) => { c.theme.vertical.maxVisible = v; })} /></Field>
              <Field label="موضع التنبيهات (من الأعلى)"><Range value={t.vertical.toastsTop} min={0} max={1800} step={10} suffix="px" onChange={(v) => edit((c) => { c.theme.vertical.toastsTop = v; })} /></Field>
              <Toggle label="إظهار الرأس" checked={t.vertical.showHeader} onChange={(v) => edit((c) => { c.theme.vertical.showHeader = v; })} />
              <Toggle label="إظهار التنبيهات" checked={t.vertical.showToasts} onChange={(v) => edit((c) => { c.theme.vertical.showToasts = v; })} />
              <Toggle label="إظهار الشريط الإخباري" checked={t.vertical.showTicker} onChange={(v) => edit((c) => { c.theme.vertical.showTicker = v; })} />
            </div>
          </div>
        )}
        {view === 'live' && <ScaledStage w={1440} h={1000}><LiveView config={draft} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} preview /></ScaledStage>}
      </Section>

      <PartsEditor draft={draft} edit={edit} />

      <Section title="🔤 الخطوط" className="span-2"
        desc="17 خطاً عربياً مضمّناً (تعمل في OBS بدون إنترنت). الخط الأساسي للنصوص، وخط العناوين للعنوان وأسماء الفرق ولافتة المتصدر.">
        <div className="a-seg a-font-tabs">
          <span className="a-label">الخط الأساسي:</span><b>{t.fontFamily}</b>
          <span className="a-label">خط العناوين:</span><b>{t.titleFont || 'نفس الأساسي'}</b>
        </div>
        <div className="a-fonts">
          {FONTS.map((f) => (
            <div key={f.family} className={`a-font${t.fontFamily === f.family ? ' main' : ''}${(t.titleFont || t.fontFamily) === f.family ? ' title' : ''}`}>
              <div className="a-font-sample" style={{ fontFamily: `'${f.family}', 'Cairo'` }}>
                <span className="a-font-big">تحدي المليون</span>
                <span className="a-font-small">المغرب ضد الجزائر · 1,234,567</span>
              </div>
              <div className="a-font-meta"><b>{f.label}</b><small className="a-muted num-latin">{f.family} · {f.style}</small></div>
              <div className="a-font-btns">
                <button className={t.fontFamily === f.family ? 'on' : ''} onClick={() => edit((c) => { c.theme.fontFamily = f.family; })}>أساسي</button>
                <button className={(t.titleFont || t.fontFamily) === f.family ? 'on' : ''} onClick={() => edit((c) => { c.theme.titleFont = f.family === c.theme.fontFamily ? '' : f.family; })}>عناوين</button>
              </div>
            </div>
          ))}
        </div>
        <div className="a-form" style={{ marginTop: 14 }}>
          <Field label="أو خط من Google Fonts (الأساسي)" hint="اكتب الاسم بالضبط، مثل: Mada"><Text value={t.fontFamily} onChange={set('fontFamily')} /></Field>
          <Field label="خط العناوين من Google Fonts" hint="فارغ = نفس الخط الأساسي"><Text value={t.titleFont} onChange={set('titleFont')} /></Field>
        </div>
      </Section>

      <Section title="🖼️ صورة الخلفية" desc="تظهر خلف المحتوى. ننصح بصورة أفقية 1920×1080.">
        <div className="a-bg-pick">
          <div className="a-bg-thumb" style={safeUrl(t.bgImage) ? { backgroundImage: `url("${t.bgImage}")` } : undefined}>{!t.bgImage && <span className="a-muted">لا توجد صورة</span>}</div>
          <div className="a-bg-actions">
            <UploadBtn max={1920} variant="gold" size="" onDone={(url) => { edit((c) => { c.theme.bgImage = url; }); setLibKey((k) => k + 1); }}>{t.bgImage ? 'تغيير الصورة' : 'رفع صورة خلفية'}</UploadBtn>
            {t.bgImage && <Btn variant="ghost" icon="trash" onClick={() => edit((c) => { c.theme.bgImage = ''; })}>إزالة</Btn>}
          </div>
        </div>
        <div className="a-form">
          <Field label="تعتيم الصورة"><Range value={t.bgDim} min={0} max={1} step={0.05} onChange={set('bgDim')} /></Field>
          <Field label="ضبابية الصورة"><Range value={t.bgBlur} min={0} max={30} step={1} suffix="px" onChange={set('bgBlur')} /></Field>
          <Toggle label="في الصفحة المباشرة" checked={t.bgOnLive} onChange={set('bgOnLive')} />
          <Toggle label="في واجهة OBS" checked={t.bgOnOverlay} onChange={set('bgOnOverlay')} />
        </div>
        {t.bgOnOverlay && t.bgImage && <div className="a-alert warn"><Icon name="eye" />في OBS ستغطي الصورة ما خلف الواجهة (الكاميرا/البث). فعّلها إذا كانت الواجهة مشهداً كاملاً.</div>}
      </Section>

      <Section title="🔠 الأحجام والصور">
        <div className="a-form">
          <Field label="حجم أسماء الفرق" hint="لكل الفرق. يمكن ضبط كل فريق من صفحة «الفرق»"><Range value={t.nameScale} min={0.5} max={2.5} step={0.05} suffix="×" onChange={set('nameScale')} /></Field>
          <Field label="حجم صورة / علم الفريق"><Range value={t.flagScale} min={0.5} max={2.5} step={0.05} suffix="×" onChange={set('flagScale')} /></Field>
          <Field label="شكل صورة الفريق"><Select value={t.flagShape} onChange={set('flagShape')} options={[['rounded', 'مربع بحواف دائرية'], ['circle', 'دائرة'], ['square', 'مربع']]} /></Field>
          <Field label="حجم الخط العام"><Range value={t.fontScale} min={0.6} max={1.6} step={0.05} onChange={set('fontScale')} /></Field>
        </div>
      </Section>

      <Section title="الألوان والزجاج">
        <div className="a-form">
          <Field label="لون التمييز"><Color value={t.accent} onChange={set('accent')} /></Field>
          <Field label="لون النص" hint="الأبيض = حسب الشكل"><Color value={t.textColor} onChange={set('textColor')} /></Field>
          <Field label="شفافية البطاقات"><Range value={t.glassOpacity} min={0} max={1} step={0.01} onChange={set('glassOpacity')} /></Field>
          <Field label="التمويه"><Range value={t.blur} min={0} max={40} step={1} suffix="px" onChange={set('blur')} /></Field>
          <Field label="استدارة الحواف"><Range value={t.radius} min={0} max={40} step={1} suffix="px" onChange={set('radius')} /></Field>
          <Field label="لون خلفية OBS" hint="transparent للشفافية"><Text value={t.background} onChange={set('background')} /></Field>
        </div>
      </Section>

      <Section title="التخطيط">
        <div className="a-form">
          <Field label="الشكل"><Select value={t.layout} onChange={set('layout')} options={[['list', 'قائمة عمودية'], ['grid', 'شبكة']]} /></Field>
          <Field label="موضع اللوحة"><Select value={t.position} onChange={set('position')} options={[['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']]} /></Field>
          <Field label="جهة التنبيهات"><Select value={t.toastPosition} onChange={set('toastPosition')} options={[['left', 'يسار'], ['right', 'يمين']]} /></Field>
          <Field label="عرض اللوحة"><Range value={t.width} min={360} max={1200} step={10} suffix="px" onChange={set('width')} /></Field>
          <Field label="أقصى عدد فرق ظاهرة"><Num value={t.maxVisible} min={1} max={30} onChange={set('maxVisible')} /></Field>
          <Field label="عدد الداعمين لكل فريق"><Num value={t.contributorsCount} min={1} max={5} onChange={set('contributorsCount')} /></Field>
          <Toggle label="إظهار الرأس" checked={t.showHeader} onChange={set('showHeader')} />
          <Toggle label="إظهار الشريط الإخباري" checked={t.showTicker} onChange={set('showTicker')} />
        </div>
      </Section>

      <Section title="📁 مكتبة الصور" desc="كل الصور المرفوعة (صور الفرق والخلفيات والشعارات). ✓ = استخدام كخلفية، 🏷️ = استخدام كشعار." className="span-2">
        <Library refreshKey={libKey} onUse={(url) => edit((c) => { c.theme.bgImage = url; })} onLogo={(url) => edit((c) => { c.theme.logo = url; c.theme.showLogo = true; })} />
      </Section>
    </div>
  );
}
