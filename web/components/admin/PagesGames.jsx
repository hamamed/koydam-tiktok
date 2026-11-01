'use client';
/**
 * «الألعاب»: choose what plays on the stream: the million race, the Arab Cup (knockout matches)
 * or the Country Arena (HP battle), with each game's settings and live controls.
 */
import { useState } from 'react';
import { Flag as FlagIco, Play, SkipForward, Square, Swords, Trophy } from 'lucide-react';
import { cmd } from '@/lib/store';
import { ARAB_COUNTRIES, countryTeam } from '@/lib/flags';
import { Flag } from '../bits';
import { Btn, Field, Num, Section, Select, Toggle } from './ui';

const GAMES = [
  ['race', Trophy, 'سباق المليون', 'الترتيب الكلاسيكي: كل الدول تتسابق نحو المليون نقطة.'],
  ['cup', FlagIco, 'كأس العرب', 'خروج المغلوب: دولتان في كل مباراة بوقت محدد، كل عدد من النقاط = هدف، والفائز يتأهل حتى النهائي.'],
  ['arena', Swords, 'حلبة الدول', 'كل دولة لها طاقة. هدايا دولتك تهاجم الخصوم وتعالجها، ومن تصل طاقته للصفر يخرج. آخر دولة تبقى تفوز.'],
];
const POP = ['Rose', 'TikTok', 'Heart Me', 'GG', 'Ice Cream Cone', 'Finger Heart', 'Weights', 'Perfume', 'Doughnut', 'Hand Hearts', 'Cap', 'Sunglasses', 'Corgi', 'Money Gun', 'Galaxy', 'Lion', 'Friendship Necklace', 'Love you', 'Cake Slice', 'Hat and Mustache', 'Mic', 'Swan'];

export function GamesPage({ live, draft, edit, dirty, notice }) {
  const g = draft.game || { mode: 'race', cup: {}, arena: {} };
  const cup = { matchSec: 90, goalPoints: 500, size: 8, breakSec: 8, shuffle: true, ...(g.cup || {}) };
  const arena = { hp: 5000, healPct: 25, target: 'leader', ...(g.arena || {}) };
  const setG = (patch) => edit((c) => { c.game = { ...(c.game || {}), ...patch }; });
  const setCup = (k) => (v) => edit((c) => { c.game = { ...(c.game || {}), cup: { ...cup, ...(c.game?.cup || {}), [k]: v } }; });
  const setArena = (k) => (v) => edit((c) => { c.game = { ...(c.game || {}), arena: { ...arena, ...(c.game?.arena || {}), [k]: v } }; });
  const [busy, setBusy] = useState('');
  const run = async (action, label) => {
    if (dirty) return notice('احفظ الإعدادات أولاً (زر «حفظ وتطبيق» في الأسفل)', 'err');
    setBusy(action);
    try { await cmd(action); notice(label); } catch (e) { notice(e.message, 'err'); } finally { setBusy(''); }
  };
  const arabOnly = draft.teams.length && draft.teams.every((t) => /^\/flags\/[a-z]{2}\.svg$/.test(t.image || '') && ARAB_COUNTRIES.some((x) => t.image === `/flags/${x.code}.svg`));
  const loadArab = (n) => edit((c) => {
    c.teams = ARAB_COUNTRIES.slice(0, n).map((x, i) => ({ id: '', nameScale: 1, ...countryTeam(x.code, POP[i % POP.length]) }));
    c.category = 'الدول';
  });
  const st = live.game && live.game.mode === g.mode ? live.game : null;
  const running = st && st.status !== 'idle';
  const stateText = !st || st.status === 'idle' ? 'لم تبدأ' : st.status === 'done' ? 'انتهت (يوجد بطل)' : st.status === 'break' ? 'استراحة بين المباريات' : 'تعمل الآن';

  return (
    <div className="a-grid">
      <Section title="🎮 اختر اللعبة" className="span-2" desc="اللعبة تظهر في OBS والصفحة المباشرة مكان لوحة الترتيب، بنفس الشكل والألوان. كل الهدايا والانضمام بالشات والمتابعات تُحسب في اللعبة.">
        <div className="a-games">
          {GAMES.map(([id, Ico, name, desc]) => (
            <button key={id} type="button" className={`a-game${g.mode === id ? ' on' : ''}`} onClick={() => setG({ mode: id })}>
              <Ico className="a-game-ico" />
              <b>{name}</b>
              <span className="a-muted">{desc}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="🌍 الدول العربية فقط" className="span-2"
        desc={arabOnly ? `الفرق الآن ${draft.teams.length} دولة عربية بأعلامها وهداياها.` : 'الألعاب مصممة للدول العربية. حمّل الدول بضغطة (يستبدل الفرق الحالية، ثم احفظ).'}>
        <div className="a-row">
          <Btn variant={arabOnly ? 'ghost' : 'gold'} onClick={() => loadArab(22)}>كل الدول العربية (22)</Btn>
          <Btn variant="ghost" onClick={() => loadArab(16)}>16 دولة</Btn>
          <Btn variant="ghost" onClick={() => loadArab(8)}>8 دول</Btn>
        </div>
        <div className="a-games-flags">{draft.teams.slice(0, 22).map((t, i) => <span key={i} className="a-vid-flag" title={t.name}><Flag team={t} /></span>)}</div>
      </Section>

      {g.mode === 'cup' && (
        <Section title="⚽ إعدادات كأس العرب" className="span-2">
          <div className="a-form">
            <Field label="عدد الدول في البطولة" hint="تُختار من قائمة الفرق"><Select value={String(cup.size)} onChange={(v) => setCup('size')(Number(v))} options={[['2', '2 (نهائي مباشر)'], ['4', '4 (نصف نهائي)'], ['8', '8 (ربع نهائي)'], ['16', '16 دولة'], ['32', 'كل الدول']]} /></Field>
            <Field label="مدة المباراة (ثانية)"><Num value={cup.matchSec} min={20} max={1800} onChange={setCup('matchSec')} /></Field>
            <Field label="نقاط الهدف الواحد" hint="كل هذا العدد من النقاط = هدف"><Num value={cup.goalPoints} min={1} onChange={setCup('goalPoints')} /></Field>
            <Field label="استراحة بين المباريات (ثانية)"><Num value={cup.breakSec} min={2} max={120} onChange={setCup('breakSec')} /></Field>
            <Toggle label="قرعة عشوائية" checked={cup.shuffle !== false} onChange={setCup('shuffle')} />
          </div>
        </Section>
      )}
      {g.mode === 'arena' && (
        <Section title="🛡️ إعدادات حلبة الدول" className="span-2">
          <div className="a-form">
            <Field label="طاقة كل دولة" hint="أكبر = معركة أطول"><Num value={arena.hp} min={10} onChange={setArena('hp')} /></Field>
            <Field label="العلاج من كل هدية (%)" hint="نسبة من نقاط الهدية تعود لطاقة دولتك"><Num value={arena.healPct} min={0} max={100} onChange={setArena('healPct')} /></Field>
            <Field label="الهجوم على"><Select value={arena.target} onChange={setArena('target')} options={[['leader', 'الدولة الأقوى (الأعلى طاقة)'], ['random', 'دولة عشوائية']]} /></Field>
          </div>
          <p className="a-muted">الدولة التي تخرج يمكن أن تعود: هدايا جمهورها تملأ عدّاد العودة (نصف الطاقة)، فتعود بـ30% من طاقتها.</p>
        </Section>
      )}

      {g.mode !== 'race' && (
        <Section title="🕹️ التحكم في اللعبة" className="span-2" desc={`الحالة: ${stateText}`}>
          <div className="a-row">
            <Btn variant="gold" busy={busy === 'gameStart'} onClick={() => run('gameStart', 'بدأت اللعبة')}><Play className="lc-inline" /> {running ? 'إعادة البدء' : 'ابدأ اللعبة'}</Btn>
            {g.mode === 'cup' && running && st.status !== 'done' && <Btn variant="ghost" busy={busy === 'gameNext'} onClick={() => run('gameNext', st.status === 'break' ? 'بدأت المباراة التالية' : 'انتهت المباراة')}><SkipForward className="lc-inline" /> {st.status === 'break' ? 'المباراة التالية الآن' : 'إنهاء المباراة الآن'}</Btn>}
            {running && <Btn variant="ghost" busy={busy === 'gameStop'} onClick={() => run('gameStop', 'توقفت اللعبة')}><Square className="lc-inline" /> إيقاف</Btn>}
          </div>
          {dirty && <p className="a-muted">لديك تغييرات غير محفوظة: احفظها قبل البدء.</p>}
        </Section>
      )}
    </div>
  );
}
