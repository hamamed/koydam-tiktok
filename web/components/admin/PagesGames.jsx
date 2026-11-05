'use client';
/**
 * «الألعاب»: choose what plays on the stream: the million race, the Arab Cup (knockout matches)
 * or the Country Arena (HP battle), with each game's settings and live controls.
 */
import { useEffect, useState } from 'react';
import { Cable, Castle, CircleHelp, Crown, Flag as FlagIco, FlagTriangleRight, Play, Rocket, SkipForward, Square, Swords, Trophy, Zap } from 'lucide-react';
import { cmd } from '@/lib/store';
import { oneCoinGifts } from '@/lib/gifts';
import { ARAB_COUNTRIES, countryTeam } from '@/lib/flags';
import { Flag } from '../bits';
import { Btn, Field, Num, SafeMode, Section, Select, Toggle } from './ui';
import Overlay from '../Overlay';
import { FitStage } from './PagesConfig';
import { iconize } from './icons';
import { Dices, Gift, Monitor, RotateCcw, Smartphone, Trash2 } from 'lucide-react';
import { GAME_UI_DEFAULTS, gameUi } from '@/lib/gameText';

const GAMES = [
  ['race', Trophy, 'سباق المليون', 'الترتيب الكلاسيكي: كل الدول تتسابق نحو المليون نقطة.'],
  ['cup', FlagIco, 'كأس العرب', 'خروج المغلوب: دولتان في كل مباراة بوقت محدد، كل عدد من النقاط = هدف، والفائز يتأهل حتى النهائي.'],
  ['arena', Swords, 'حلبة الدول', 'كل دولة لها طاقة. هدايا دولتك تهاجم الخصوم وتعالجها، ومن تصل طاقته للصفر يخرج. آخر دولة تبقى تفوز.'],
  ['tug', Cable, 'شد الحبل', 'دولتان على طرفي حبل، كل هدية تسحب الحبل نحو دولتها. من يسحبه لخطّه أو يتقدم عند انتهاء الوقت يفوز، ثم مواجهة جديدة.'],
  ['horses', FlagTriangleRight, 'سباق الخيول', 'كل دولة في مضمار، الهدايا تدفعها للأمام. أول دولة تعبر خط النهاية تفوز.'],
  ['rockets', Rocket, 'سباق الصواريخ', 'صواريخ الدول تصعد نحو القمر بالهدايا. أول صاروخ يصل يفوز. مثالي للشاشة العمودية.'],
  ['castle', Castle, 'حماية العاصمة', 'لكل دولة سور: هداياها تبنيه وتهدم أعلى سور عند الخصوم. عند انتهاء الوقت أعلى سور يفوز.'],
];

export function GamesPage({ live, draft, edit, dirty, notice }) {
  const g = draft.game || { mode: 'race', cup: {}, arena: {} };
  const cup = { matchSec: 90, goalPoints: 500, size: 8, breakSec: 8, shuffle: true, ...(g.cup || {}) };
  const arena = { hp: 5000, healPct: 25, target: 'leader', ...(g.arena || {}) };
  const tug = { sec: 60, win: 1000, breakSec: 6, a: '', b: '', ...(g.tug || {}) };
  const track = { length: 3000, lanes: 8, ...(g.track || {}) };
  const castle = { sec: 180, max: 5000, dmgPct: 50, size: 8, ...(g.castle || {}) };
  const boost = { mult: 3, sec: 60, auto: false, everyMin: 10, ...(g.boost || {}) };
  const quiz = { points: 100, sec: 30, auto: false, everyMin: 3, kinds: 'both', ...(g.quiz || {}) };
  const throne = { enabled: true, ...(g.throne || {}) };
  const setK = (key, base) => (k) => (v) => edit((c) => { c.game = { ...(c.game || {}), [key]: { ...base, ...(c.game?.[key] || {}), [k]: v } }; });
  const setTug = setK('tug', tug); const setTrack = setK('track', track); const setCastle = setK('castle', castle);
  const setBoost = setK('boost', boost); const setQuiz = setK('quiz', quiz); const setThrone = setK('throne', throne);
  const teamOpts = [['', 'تلقائي (كل الدول بالتناوب)'], ...draft.teams.map((t) => [t.id || t.name, t.name])];
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
    const one = oneCoinGifts(live.gifts);
    c.teams = ARAB_COUNTRIES.slice(0, n).map((x, i) => ({ id: '', nameScale: 1, ...countryTeam(x.code, one[i]) }));
    c.category = 'الدول';
  });
  const st = live.game && live.game.mode === g.mode ? live.game : null;
  const running = st && st.status !== 'idle';
  const stateText = !st || st.status === 'idle' ? 'لم تبدأ' : st.status === 'done' ? 'انتهت (يوجد بطل)' : st.status === 'break' ? 'استراحة بين المباريات' : 'تعمل الآن';

  return iconize(
    <div className="a-studio a-gstudio">
      <GamePreview live={live} draft={draft} notice={notice} />
      <div className="a-studio-panel">
      <div className="a-studio-body">
    <div className="a-grid">
      <SafeMode draft={draft} edit={edit} />
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

      {g.mode === 'tug' && (
        <Section title="🪢 إعدادات شد الحبل" className="span-2">
          <div className="a-form">
            <Field label="الدولة الأولى"><Select value={tug.a} onChange={setTug('a')} options={teamOpts} /></Field>
            <Field label="الدولة الثانية"><Select value={tug.b} onChange={setTug('b')} options={teamOpts} /></Field>
            <Field label="نقاط الفوز" hint="الفرق المطلوب لسحب الحبل كاملاً"><Num value={tug.win} min={1} onChange={setTug('win')} /></Field>
            <Field label="مدة المواجهة (ثانية)"><Num value={tug.sec} min={10} max={900} onChange={setTug('sec')} /></Field>
            <Field label="استراحة بين المواجهات (ثانية)"><Num value={tug.breakSec} min={2} max={120} onChange={setTug('breakSec')} /></Field>
          </div>
          <p className="a-muted">اترك الدولتين «تلقائي» لتتناوب كل الدول في مواجهات متتالية. احفظ الفرق أولاً ليظهر اختيار الدول.</p>
        </Section>
      )}
      {(g.mode === 'horses' || g.mode === 'rockets') && (
        <Section title={g.mode === 'rockets' ? '🚀 إعدادات سباق الصواريخ' : '🏁 إعدادات سباق الخيول'} className="span-2">
          <div className="a-form">
            <Field label="طول السباق (نقاط)" hint="النقاط التي تحتاجها الدولة للوصول"><Num value={track.length} min={10} onChange={setTrack('length')} /></Field>
            <Field label="عدد المتسابقين"><Num value={track.lanes} min={2} max={12} onChange={setTrack('lanes')} /></Field>
          </div>
        </Section>
      )}
      {g.mode === 'castle' && (
        <Section title="🏰 إعدادات حماية العاصمة" className="span-2">
          <div className="a-form">
            <Field label="مدة المعركة (ثانية)"><Num value={castle.sec} min={20} max={3600} onChange={setCastle('sec')} /></Field>
            <Field label="أقصى ارتفاع للسور"><Num value={castle.max} min={10} onChange={setCastle('max')} /></Field>
            <Field label="قوة الهدم (%)" hint="نسبة نقاط الهدية التي تهدم من أعلى سور خصم"><Num value={castle.dmgPct} min={0} max={200} onChange={setCastle('dmgPct')} /></Field>
            <Field label="عدد الدول"><Num value={castle.size} min={2} max={12} onChange={setCastle('size')} /></Field>
          </div>
        </Section>
      )}

      <Program live={live} draft={draft} edit={edit} dirty={dirty} notice={notice} />

      {g.mode !== 'race' && <GameLook mode={g.mode} draft={draft} edit={edit} name={GAMES.find((x) => x[0] === g.mode)?.[2]} />}

      <Section title="✨ إضافات تعمل مع أي لعبة" className="span-2" desc="تظهر فوق اللعبة أو الترتيب في OBS والصفحة المباشرة. شغّلها يدوياً بالأزرار أو تلقائياً كل عدة دقائق.">
        <div className="a-acts">
          <div className="a-act">
            <h4 className="a-sub"><Zap className="lc-inline" /> الدقيقة الذهبية</h4>
            <div className="a-form">
              <Field label="المضاعف"><Select value={String(boost.mult)} onChange={(v) => setBoost('mult')(Number(v))} options={[['2', '×2'], ['3', '×3'], ['5', '×5']]} /></Field>
              <Field label="المدة (ثانية)"><Num value={boost.sec} min={10} max={600} onChange={setBoost('sec')} /></Field>
              <Toggle label="تلقائياً" checked={boost.auto} onChange={setBoost('auto')} />
              {boost.auto && <Field label="كل (دقيقة)"><Num value={boost.everyMin} min={1} max={120} onChange={setBoost('everyMin')} /></Field>}
            </div>
            <div className="a-row">
              <Btn variant="gold" size="sm" busy={busy === 'actBoost'} onClick={() => run('actBoost', 'بدأت الدقيقة الذهبية')}><Zap className="lc-inline" /> شغّلها الآن</Btn>
              {live.acts?.boost && <Btn size="sm" variant="ghost" onClick={() => run('actBoostStop', 'توقفت')}>إيقاف</Btn>}
            </div>
          </div>
          <div className="a-act">
            <h4 className="a-sub"><CircleHelp className="lc-inline" /> سؤال وجواب / خمّن العلم</h4>
            <div className="a-form">
              <Field label="النوع"><Select value={quiz.kinds} onChange={setQuiz('kinds')} options={[['both', 'الاثنان بالتناوب'], ['trivia', 'أسئلة فقط'], ['flag', 'خمّن العلم فقط']]} /></Field>
              <Field label="نقاط الجواب الصحيح" hint="تُضاف لدولة صاحب الجواب"><Num value={quiz.points} min={0} onChange={setQuiz('points')} /></Field>
              <Field label="وقت السؤال (ثانية)"><Num value={quiz.sec} min={10} max={300} onChange={setQuiz('sec')} /></Field>
              <Toggle label="تلقائياً" checked={quiz.auto} onChange={setQuiz('auto')} />
              {quiz.auto && <Field label="كل (دقيقة)"><Num value={quiz.everyMin} min={1} max={120} onChange={setQuiz('everyMin')} /></Field>}
            </div>
            <div className="a-row">
              <Btn variant="gold" size="sm" busy={busy === 'actQuiz'} onClick={() => run('actQuiz', 'ظهر السؤال')}>سؤال الآن</Btn>
              <Btn size="sm" variant="ghost" onClick={async () => { if (dirty) return notice('احفظ أولاً', 'err'); try { await cmd('actQuiz', { kind: 'flag' }); notice('ظهر العلم'); } catch (e) { notice(e.message, 'err'); } }}>علم الآن</Btn>
              {live.acts?.quiz && <Btn size="sm" variant="ghost" onClick={() => run('actQuizStop', 'أُغلق السؤال')}>إغلاق</Btn>}
            </div>
          </div>
          <div className="a-act">
            <h4 className="a-sub"><Crown className="lc-inline" /> العرش</h4>
            <div className="a-form">
              <Toggle label="إظهار العرش" checked={throne.enabled !== false} onChange={setThrone('enabled')} />
            </div>
            <p className="a-muted">أكبر هدية واحدة تأخذ العرش باسم صاحبها وعلم دولته، حتى يرسل أحد هدية أكبر. قيمة العرش تنقص 5% كل دقيقة ليتغير الجالس.</p>
            {live.acts?.throne && <div className="a-row"><span>الآن: <b>{live.acts.throne.user.nickname}</b></span><Btn size="sm" variant="ghost" onClick={() => run('actThroneReset', 'أُفرغ العرش')}>إفراغ العرش</Btn></div>}
          </div>
        </div>
      </Section>

      {g.mode !== 'race' && (
        <Section title="🕹️ التحكم في اللعبة" className="span-2" desc={`الحالة: ${stateText}`}>
          <div className="a-row">
            <Btn variant="gold" busy={busy === 'gameStart'} onClick={() => run('gameStart', 'بدأت اللعبة')}><Play className="lc-inline" /> {running ? 'إعادة البدء' : 'ابدأ اللعبة'}</Btn>
            {(g.mode === 'cup' || g.mode === 'tug') && running && st.status !== 'done' && <Btn variant="ghost" busy={busy === 'gameNext'} onClick={() => run('gameNext', st.status === 'break' ? 'بدأت المباراة التالية' : 'انتهت المباراة')}><SkipForward className="lc-inline" /> {st.status === 'break' ? 'المباراة التالية الآن' : 'إنهاء المباراة الآن'}</Btn>}
            {running && <Btn variant="ghost" busy={busy === 'gameStop'} onClick={() => run('gameStop', 'توقفت اللعبة')}><Square className="lc-inline" /> إيقاف</Btn>}
          </div>
          {dirty && <p className="a-muted">لديك تغييرات غير محفوظة: احفظها قبل البدء.</p>}
        </Section>
      )}
    </div>
      </div>
      </div>
    </div>,
  );
}

/** Live preview of the game (same overlay as OBS) + test tools: demo gifts, a gift for one team, quiz. */
function GamePreview({ live, draft, notice }) {
  const [view, setView] = useState(draft.theme?.portraitOnly !== false ? 'v' : 'h');
  const [size, setSize] = useState('small');
  const demoOn = Boolean(live.status?.demo);
  const send = async (t) => {
    const big = size === 'big';
    try {
      await cmd('simulateGift', { teamId: t.id, giftName: t.gifts?.[0] || 'Rose', count: big ? 10 : 3, diamonds: big ? 100 : 10, nickname: 'تجربة' });
    } catch (e) { notice(e.message, 'err'); }
  };
  const teams = (live.config?.teams || []).slice(0, 22);
  return (
    <div className="a-studio-preview">
      <div className="a-studio-head">
        <b>معاينة اللعبة</b>
        <div className="a-seg">
          <button className={view === 'v' ? 'on' : ''} onClick={() => setView('v')}><Smartphone className="lc-inline" /> عمودي</button>
          <button className={view === 'h' ? 'on' : ''} onClick={() => setView('h')}><Monitor className="lc-inline" /> أفقي</button>
        </div>
      </div>
      <div className="a-gtest">
        <Btn size="sm" variant={demoOn ? 'red' : 'gold'} onClick={async () => { try { await cmd('demo', { enabled: !demoOn }); } catch (e) { notice(e.message, 'err'); } }}>
          <Dices className="lc-inline" /> {demoOn ? 'إيقاف الهدايا التجريبية' : 'هدايا تجريبية تلقائية'}
        </Btn>
        <div className="a-seg a-gsize">
          <button className={size === 'small' ? 'on' : ''} onClick={() => setSize('small')}>صغيرة</button>
          <button className={size === 'big' ? 'on' : ''} onClick={() => setSize('big')}>كبيرة</button>
        </div>
      </div>
      <div className="a-gtest-flags" title="اضغط على علم لإرسال هدية تجريبية لتلك الدولة">
        <Gift className="lc-inline a-gold" />
        {teams.map((t) => <button key={t.id} type="button" className="a-gflag" onClick={() => send(t)} title={`هدية لـ ${t.name}`}><Flag team={t} /></button>)}
      </div>
      {view === 'v'
        ? <FitStage w={1080} h={1920}><div className="a-tiktok-safe"><span className="top">واجهة تيك توك العلوية</span><span className="bottom">التعليقات وأزرار تيك توك</span></div><Overlay config={draft} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} game={live.game} acts={live.acts} orientation="portrait" preview /></FitStage>
        : <FitStage w={1920} h={1080}><Overlay config={draft} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} game={live.game} acts={live.acts} preview /></FitStage>}
      <p className="a-muted a-studio-note">احفظ ثم «ابدأ اللعبة»، وجرّبها بالهدايا التجريبية أو اضغط على علم دولة. الهدايا التجريبية تُحسب في النتائج: صفّر الجولة من «الأدوات» قبل البث الحقيقي.</p>
    </div>
  );
}

/** Display settings of ONE game (saved under config.game.ui[mode]): its texts and what shows around it. */
function GameLook({ mode, draft, edit, name }) {
  const ui = gameUi({ ...draft, safe: { enabled: false } }, mode); // the saved values (safe mode only changes what is shown)
  const saved = draft.game?.ui?.[mode] || {};
  const setUi = (k, v) => edit((c) => {
    const all = { ...(c.game?.ui || {}) }; const cur = { ...(all[mode] || {}) };
    if (v === undefined) delete cur[k]; else cur[k] = v;
    all[mode] = cur; c.game = { ...(c.game || {}), ui: all };
  });
  const TEXTS = [
    ['label', 'عنوان اللعبة', 'يظهر أعلى اللعبة'],
    ['waitTitle', 'عنوان الانتظار', 'قبل أن تبدأ اللعبة'],
    ['waitSub', 'جملة الانتظار', ''],
    ['champ', 'عنوان الفائز', 'تحت اسم الدولة الفائزة'],
    ['hint', 'السطر الإرشادي', '{n} = الرقم (نقاط الهدف، المسافة…)'],
  ];
  const def = GAME_UI_DEFAULTS[mode] || {};
  const reset = () => edit((c) => { const all = { ...(c.game?.ui || {}) }; delete all[mode]; c.game = { ...(c.game || {}), ui: all }; });
  return (
    <Section title={`🎨 شكل «${name}»`} className="span-2" desc="هذه الإعدادات لهذه اللعبة فقط. كل لعبة تحفظ نصوصها وشكلها الخاص. اترك النص فارغاً أو اضغط سلة المهملات لإخفائه."
      actions={<Btn size="sm" variant="ghost" onClick={reset}><RotateCcw className="lc-inline" /> الافتراضي</Btn>}>
      <h4 className="a-sub">النصوص</h4>
      <div className="a-gtexts">
        {TEXTS.map(([k, label, hint]) => (
          <Field key={k} label={label} hint={hint}>
            <div className="a-gtext-row">
              <input className="a-input" value={ui[k] ?? ''} placeholder="مخفي" onChange={(e) => setUi(k, e.target.value)} />
              <button type="button" className="a-icon-btn" title="إخفاء" onClick={() => setUi(k, '')}><Trash2 size={16} /></button>
              {k in saved && <button type="button" className="a-icon-btn" title={`إرجاع: ${def[k] || 'مخفي'}`} onClick={() => setUi(k, undefined)}><RotateCcw size={16} /></button>}
            </div>
          </Field>
        ))}
      </div>
      <h4 className="a-sub">ما يظهر مع هذه اللعبة</h4>
      <div className="a-form">
        <Toggle label="بطاقة الرأس (العنوان والشعار)" checked={ui.showHeader !== false} onChange={(v) => setUi('showHeader', v)} />
        {ui.showHeader !== false && <>
          <Field label="عنوان الرأس لهذه اللعبة" hint={`فارغ = «${draft.title}»`}><input className="a-input" value={ui.headerTitle || ''} placeholder={draft.title} onChange={(e) => setUi('headerTitle', e.target.value)} /></Field>
          <Toggle label="العنوان الفرعي" checked={ui.showSub !== false} onChange={(v) => setUi('showSub', v)} />
          {ui.showSub !== false && <Field label="العنوان الفرعي لهذه اللعبة" hint="فارغ = العنوان الفرعي العام"><input className="a-input" value={ui.headerSub || ''} placeholder={draft.subtitle} onChange={(e) => setUi('headerSub', e.target.value)} /></Field>}
          <Toggle label="شريط هدف المليون" checked={Boolean(ui.showGoal)} onChange={(v) => setUi('showGoal', v)} />
        </>}
        <Toggle label="شريط الدول والهدايا" checked={ui.showStrip !== false} onChange={(v) => setUi('showStrip', v)} />
        <Toggle label="«أرسل 🎁» عند كل دولة" checked={ui.showSend !== false} onChange={(v) => setUi('showSend', v)} />
        <Toggle label="الأيقونات" checked={ui.showIcon !== false} onChange={(v) => setUi('showIcon', v)} />
      </div>
    </Section>
  );
}

/** Auto program: the games one after another with a duration each (config.game.playlist). */
function Program({ live, draft, edit, dirty, notice }) {
  const pl = draft.game?.playlist || { loop: true, items: [] };
  const items = pl.items || [];
  const setPl = (patch) => edit((c) => { c.game = { ...(c.game || {}), playlist: { ...pl, ...(c.game?.playlist || {}), ...patch } }; });
  const setItem = (i, k, v) => setPl({ items: items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const move = (i, d) => { const a = [...items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setPl({ items: a }); };
  const run = async (action, payload, msg) => {
    if (dirty) return notice('احفظ الإعدادات أولاً', 'err');
    try { await cmd(action, payload); notice(msg); } catch (e) { notice(e.message, 'err'); }
  };
  const cur = live.playlist;
  const [, tick] = useState(0);
  useEffect(() => { if (!cur) return undefined; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [cur]);
  const left = cur ? Math.max(0, Math.round((cur.endsAtLocal - Date.now()) / 1000)) : 0;
  const name = (m) => GAMES.find((x) => x[0] === m)?.[2] || m;
  const total = items.reduce((n, x) => n + (Number(x.min) || 0), 0);
  return (
    <Section title="📋 البرنامج التلقائي" className="span-2"
      desc={`رتّب الألعاب ومدة كل واحدة، ثم «ابدأ البرنامج»: تتغير اللعبة وحدها وتبدأ تلقائياً مع إعلان «اللعبة التالية». المجموع ${total} دقيقة.`}
      actions={<Toggle label="تكرار من البداية" checked={pl.loop !== false} onChange={(v) => setPl({ loop: v })} />}>
      <div className="a-prog">
        {items.map((it, i) => (
          <div key={i} className={`a-prog-row${cur && cur.index === i ? ' on' : ''}`}>
            <span className="a-prog-n num-latin">{i + 1}</span>
            <Select value={it.mode} onChange={(v) => setItem(i, 'mode', v)} options={GAMES.map(([id, , n]) => [id, n])} />
            <span className="a-prog-min"><Num value={it.min} min={1} max={240} onChange={(v) => setItem(i, 'min', v)} /><small>دقيقة</small></span>
            <button type="button" className="a-icon-btn" onClick={() => move(i, -1)} title="أعلى">↑</button>
            <button type="button" className="a-icon-btn" onClick={() => move(i, 1)} title="أسفل">↓</button>
            <button type="button" className="a-icon-btn danger" onClick={() => setPl({ items: items.filter((_, j) => j !== i) })} title="حذف"><Trash2 size={15} /></button>
          </div>
        ))}
        <Btn size="sm" variant="ghost" icon="plus" onClick={() => setPl({ items: [...items, { mode: 'cup', min: 10 }] })}>إضافة لعبة</Btn>
      </div>
      <div className="a-row" style={{ marginTop: 12 }}>
        <Btn variant="gold" onClick={() => run('playlistStart', { index: 0 }, 'بدأ البرنامج')}><Play className="lc-inline" /> {cur ? 'إعادة البرنامج' : 'ابدأ البرنامج'}</Btn>
        {cur && <Btn variant="ghost" onClick={() => run('playlistNext', {}, 'اللعبة التالية')}><SkipForward className="lc-inline" /> اللعبة التالية الآن</Btn>}
        {cur && <Btn variant="ghost" onClick={() => run('playlistStop', {}, 'توقف البرنامج')}><Square className="lc-inline" /> إيقاف البرنامج</Btn>}
      </div>
      {cur && <p className="a-gold" style={{ marginTop: 8 }}>يعمل الآن: <b>{name(cur.mode)}</b> ({cur.index + 1} من {cur.total}) · باقٍ <b className="num-latin">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>{cur.next ? <> · التالية: <b>{name(cur.next)}</b></> : null}</p>}
    </Section>
  );
}
