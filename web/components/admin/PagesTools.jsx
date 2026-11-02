'use client';
import { useState } from 'react';
import { cmd } from '@/lib/store';
import { api } from '@/lib/api';
import { confettiBurst, confettiRain } from '@/lib/confetti';
import { Btn, Field, Num, Section, Select, Text, Toggle } from './ui';
import { GiftIcon } from '../bits';
import { GiftPickerModal } from './GiftPicker';
import { findGift, useGiftMap } from '@/lib/gifts';

export function Tools({ live, draft, save, notice, myLives, currentLive }) {
  const teams = live.config.teams;
  const [g, setG] = useState({ nickname: 'مشاهد تجريبي', teamId: '', giftName: 'Galaxy', diamonds: 1000, count: 1 });
  const [c, setC] = useState({ nickname: 'مشاهد تجريبي', text: '🇲🇦 ديما مغرب' });
  const [adj, setAdj] = useState({ teamId: teams[0]?.id || '', delta: 100 });
  const [keep, setKeep] = useState(true);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState('');
  const [picker, setPicker] = useState(false);
  const giftMap = useGiftMap(live.gifts);
  const cur = findGift(giftMap, g.giftName);
  const run = async (key, action, payload, ok) => {
    setBusy(key);
    try { await cmd(action, payload); notice(ok); } catch (e) { notice(e.message, 'err'); } finally { setBusy(''); }
  };
  const teamOpts = teams.map((t) => [t.id, `${t.emoji} ${t.name}`]);

  return (
    <div className="a-grid">
      <datalist id="gift-names">{live.gifts.map((x) => <option key={x.id} value={x.name} />)}</datalist>
      <Section title="🎁 محاكاة هدية" desc="ترسل هدية حقيقية للنظام (تظهر في OBS والصفحة المباشرة)">
        <div className="a-form">
          <Field label="المشاهد"><Text value={g.nickname} onChange={(v) => setG({ ...g, nickname: v })} /></Field>
          <Field label="الفريق"><Select value={g.teamId} onChange={(v) => setG({ ...g, teamId: v })} options={[['', 'تلقائي (حسب الهدية/الانضمام)'], ...teamOpts]} /></Field>
          <Field label="الهدية">
            <div className="a-inline">
              <button type="button" className="a-gift-btn" onClick={() => setPicker(true)} title="اختيار من القائمة"><GiftIcon gift={cur} name={g.giftName} className="a-gift-img" /></button>
              <input className="a-input num-latin" dir="ltr" list="gift-names" value={g.giftName} onChange={(e) => setG({ ...g, giftName: e.target.value })} />
            </div>
          </Field>
          <Field label="الماسات 💎"><Num value={g.diamonds} min={0} onChange={(v) => setG({ ...g, diamonds: v })} /></Field>
          <Field label="العدد"><Num value={g.count} min={1} onChange={(v) => setG({ ...g, count: v })} /></Field>
        </div>
        <Btn variant="gold" icon="gift" busy={busy === 'gift'} onClick={() => run('gift', 'simulateGift', { ...g, giftId: cur?.id, teamId: g.teamId || null }, 'تم إرسال الهدية')}>إرسال</Btn>
        <GiftPickerModal open={picker} title="اختيار هدية" gifts={live.gifts} selected={[g.giftName]} onClose={() => setPicker(false)}
          onPick={(x) => setG({ ...g, giftName: x.name, diamonds: x.diamonds || g.diamonds })} />
      </Section>

      <Section title="💬 محاكاة رسالة شات" desc="لاختبار كلمات الفرق">
        <div className="a-form">
          <Field label="المشاهد"><Text value={c.nickname} onChange={(v) => setC({ ...c, nickname: v })} /></Field>
          <Field label="الرسالة"><Text value={c.text} onChange={(v) => setC({ ...c, text: v })} /></Field>
        </div>
        <Btn variant="ghost" icon="play" busy={busy === 'chat'} onClick={() => run('chat', 'simulateChat', c, 'تم إرسال الرسالة')}>إرسال</Btn>
      </Section>

      <Section title="💛 محاكاة متابعة / مشاركة" desc="لتجربة التنبيهات وهدف المتابعين">
        <div className="a-form">
          <Field label="المشاهد"><Text value={c.nickname} onChange={(v) => setC({ ...c, nickname: v })} /></Field>
          <Field label="الفريق"><Select value={g.teamId} onChange={(v) => setG({ ...g, teamId: v })} options={[['', 'بدون فريق'], ...teamOpts]} /></Field>
        </div>
        <div className="a-row">
          <Btn variant="ghost" busy={busy === 'follow'} onClick={() => run('follow', 'simulateFollow', { nickname: c.nickname, teamId: g.teamId || null }, 'تمت محاكاة متابعة')}>💛 متابعة</Btn>
          <Btn variant="ghost" busy={busy === 'share'} onClick={() => run('share', 'simulateShare', { nickname: c.nickname, teamId: g.teamId || null }, 'تمت محاكاة مشاركة')}>🔁 مشاركة</Btn>
        </div>
      </Section>

      <Section title="✏️ تعديل النقاط يدوياً">
        <div className="a-form">
          <Field label="الفريق"><Select value={adj.teamId} onChange={(v) => setAdj({ ...adj, teamId: v })} options={teamOpts} /></Field>
          <Field label="النقاط (+/−)"><Num value={adj.delta} onChange={(v) => setAdj({ ...adj, delta: v })} /></Field>
        </div>
        <Btn variant="ghost" icon="check" busy={busy === 'adj'} onClick={() => run('adj', 'adjust', adj, 'تم تعديل النقاط')}>تطبيق</Btn>
      </Section>

      <Section title="🔄 جولة جديدة" desc="تصفير كل النقاط والداعمين">
        <Toggle label="الاحتفاظ بفرق المشاهدين (من انضم لأي فريق)" checked={keep} onChange={setKeep} />
        <div className="a-row">
          <Btn variant="red" icon="trash" busy={busy === 'reset'} onClick={() => { if (confirm('تصفير كل النقاط؟ لا يمكن التراجع.')) run('reset', 'reset', { keepAllegiance: keep }, 'بدأت جولة جديدة'); }}>تصفير النتائج</Btn>
          <Btn variant="ghost" icon="bolt" onClick={() => confettiBurst(innerWidth / 2, innerHeight / 2, ['#f5b301', '#ffd54a', '#c8102e', '#fff'], 120)}>معاينة الاحتفال</Btn>
          <Btn variant="ghost" icon="trophy" onClick={() => confettiRain(['#f5b301', '#ffd54a', '#c8102e', '#fff'], 140)}>مطر الاحتفال</Btn>
        </div>
      </Section>

      <SettingsFile draft={draft} notice={notice} myLives={myLives} currentLive={currentLive} />
    </div>
  );
}

const PARTS = [['all', 'كل شيء'], ['look', 'الشكل والأصوات'], ['teams', 'الفرق والهدف'], ['games', 'الألعاب والبرنامج'], ['scoring', 'النقاط والتنبيهات والجولات'], ['voice', 'القراءة الصوتية'], ['text', 'العنوان']];

/** Settings as a file: download, import (all or some parts), or copy to another live. */
function SettingsFile({ draft, notice, myLives, currentLive }) {
  const [file, setFile] = useState(null); // { name, config }
  const [parts, setParts] = useState(['all']);
  const [target, setTarget] = useState(currentLive || 'main');
  const [busy, setBusy] = useState(false);
  const lives = myLives || [];
  const toggle = (k) => setParts((p) => (k === 'all' ? ['all'] : p.includes(k) ? p.filter((x) => x !== k) : [...p.filter((x) => x !== 'all'), k]));
  const download = () => {
    const data = { koydam: 1, exportedAt: new Date().toISOString(), live: currentLive, config: draft };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `koydam-${currentLive || 'live'}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const pick = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); const config = j.config && typeof j.config === 'object' ? j.config : j; if (!config.teams && !config.theme) throw new Error('ليس ملف إعدادات'); setFile({ name: f.name, config }); }
      catch (e) { notice(`ملف غير صالح: ${e.message}`, 'err'); }
    };
    input.click();
  };
  const apply = async (config, to) => {
    if (!parts.length) return notice('اختر ما تريد نقله', 'err');
    if (!confirm(`سيتم استبدال (${parts.map((p) => PARTS.find((x) => x[0] === p)?.[1]).join('، ')}) في البث «${to}». متابعة؟`)) return;
    setBusy(true);
    try { await api(`/api/config/apply?live=${encodeURIComponent(to)}`, { method: 'POST', body: { config, parts } }); notice('تم تطبيق الإعدادات'); setFile(null); }
    catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Section title="📁 ملف الإعدادات" className="span-2" desc="احفظ شكل البث وإعداداته كاملة في ملف، أو انقلها إلى بث آخر أو لمستخدم آخر. تختار ما تنقله: كل شيء أو الشكل فقط أو الفرق فقط…">
      <div className="a-row">
        <Btn variant="gold" icon="save" onClick={download}>تنزيل ملف الإعدادات</Btn>
        <Btn variant="ghost" icon="file" onClick={pick}>فتح ملف…</Btn>
      </div>
      <h4 className="a-sub">ما الذي تنقله؟</h4>
      <div className="a-row a-parts-pick">
        {PARTS.map(([k, l]) => <label key={k} className={`a-chip-check${parts.includes(k) ? ' on' : ''}`}><input type="checkbox" checked={parts.includes(k)} onChange={() => toggle(k)} />{l}</label>)}
      </div>
      {file && (
        <div className="a-alert gold" style={{ marginTop: 12 }}>
          <div>الملف: <b dir="ltr">{file.name}</b> ({file.config.teams?.length || 0} فريق)</div>
          <div className="a-row" style={{ marginTop: 8 }}>
            <Btn variant="gold" size="sm" busy={busy} onClick={() => apply(file.config, currentLive)}>تطبيق على هذا البث</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setFile(null)}>إلغاء</Btn>
          </div>
        </div>
      )}
      {lives.length > 1 && (
        <>
          <h4 className="a-sub">نسخ إعدادات هذا البث إلى بث آخر</h4>
          <div className="a-row">
            <Select value={target} onChange={setTarget} options={lives.filter((x) => x.slug !== currentLive).map((x) => [x.slug, `${x.name} (${x.slug})`])} />
            <Btn variant="ghost" busy={busy} onClick={() => apply(draft, target === currentLive ? lives.find((x) => x.slug !== currentLive)?.slug : target)}>نسخ</Btn>
          </div>
        </>
      )}
    </Section>
  );
}
