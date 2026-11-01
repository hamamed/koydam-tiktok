'use client';
/** Lives (every user), Users (owner), My account (every user). */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { liveQuery } from '@/lib/store';
import { ADMIN_SIZES, useAdminPrefs } from '@/lib/adminPrefs';
import { FONTS } from '@/lib/fonts';
import { Btn, CopyField, Field, Icon, Num, Section, Select, Text, Toggle } from './ui';

const dt = (t) => (t ? new Date(t).toLocaleString('ar-MA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const STATUS = { connected: ['ok', 'متصل'], connecting: ['warn', 'يتصل'], reconnecting: ['warn', 'يعيد الاتصال'], offline: ['warn', 'البث متوقف'], error: ['err', 'خطأ'], idle: ['idle', 'غير متصل'] };
const toSlug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/* ======================================================================== */
export function LivesPage({ me, currentLive, onSwitch, reloadLives, notice }) {
  const [data, setData] = useState(null);
  const [usersList, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', slug: '', ownerId: '' });
  const [busy, setBusy] = useState(false);
  const owner = me.role === 'owner';
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const load = useCallback(async () => {
    try { setData(await api('/api/lives')); } catch (e) { notice(e.message, 'err'); }
    if (owner) api('/api/users').then((r) => setUsers(r.users)).catch(() => {});
  }, [notice, owner]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const slug = form.slug || toSlug(form.name);
    if (!slug) return notice('اكتب اسم الرابط بالإنجليزية (مثال: sara-live)', 'err');
    setBusy(true);
    try {
      const r = await api('/api/lives', { method: 'POST', body: { name: form.name || slug, slug, ownerId: form.ownerId || undefined } });
      notice(`تم إنشاء البث «${r.live.name}»`);
      setForm({ name: '', slug: '', ownerId: '' });
      await load(); await reloadLives(); onSwitch(r.live.slug);
    } catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  const rename = async (l) => {
    const name = prompt('الاسم الجديد للبث:', l.name); if (!name) return;
    try { await api('/api/lives/update', { method: 'POST', body: { slug: l.slug, name } }); load(); reloadLives(); } catch (e) { notice(e.message, 'err'); }
  };
  const transfer = async (l, ownerId) => {
    try { await api('/api/lives/update', { method: 'POST', body: { slug: l.slug, ownerId } }); notice('تم نقل البث'); load(); reloadLives(); } catch (e) { notice(e.message, 'err'); }
  };
  const del = async (l) => {
    if (!confirm(`حذف البث «${l.name}»؟ يتوقف الاتصال وتختفي روابطه. (تُحفظ نسخة من بياناته على الخادم)`)) return;
    try { await api(`/api/lives?slug=${encodeURIComponent(l.slug)}`, { method: 'DELETE' }); notice('تم حذف البث'); await load(); await reloadLives(); } catch (e) { notice(e.message, 'err'); }
  };

  if (!data) return <div className="a-center"><span className="spin" /></div>;
  return (
    <div className="a-grid">
      <Section title="➕ بث جديد" className="span-2"
        desc={owner ? 'كل بث منفصل تماماً: حساب تيك توك، الفرق، الهدايا، المظهر، الجولات، الصوت، التقارير والروابط.' : `يمكنك إنشاء ${data.maxLives ?? 0} بث. كل بث منفصل بإعداداته وروابطه.`}>
        {!data.canCreate && !owner ? <div className="a-alert warn"><Icon name="close" />وصلت للحد الأقصى من البثوث. تواصل مع المدير لزيادته.</div> : (
          <div className="a-form">
            <Field label="اسم البث" hint="يظهر في اللوحة فقط"><Text value={form.name} onChange={(v) => setForm({ ...form, name: v, slug: form.slugTouched ? form.slug : toSlug(v) })} placeholder="بث سارة" /></Field>
            <Field label="اسم الرابط (إنجليزي)" hint={`${origin}/l/${form.slug || '…'}`}>
              <input className="a-input num-latin" dir="ltr" value={form.slug} placeholder="sara-live" onChange={(e) => setForm({ ...form, slug: toSlug(e.target.value), slugTouched: true })} />
            </Field>
            {owner && (
              <Field label="المالك"><Select value={form.ownerId || me.id} onChange={(v) => setForm({ ...form, ownerId: v })}
                options={[[me.id, `أنا (${me.email})`], ...usersList.filter((u) => u.id !== me.id).map((u) => [u.id, `${u.name} (${u.email})`])]} /></Field>
            )}
            <div className="a-field"><span className="a-label">&nbsp;</span><Btn variant="gold" icon="plus" busy={busy} onClick={create}>إنشاء البث</Btn></div>
          </div>
        )}
      </Section>

      {data.lives.length === 0 && <div className="a-empty span-2">لا توجد بثوث بعد. أنشئ أول بث من الأعلى.</div>}
      {data.lives.map((l) => {
        const [k, label] = l.demo ? ['demo', 'تجريبي'] : STATUS[l.status] || STATUS.idle;
        const q = liveQuery(l.slug);
        return (
          <Section key={l.slug} className={`a-live-card${l.slug === currentLive ? ' current' : ''}`}
            title={<>{l.name} {l.slug === currentLive && <span className="a-chip gold">● تعمل عليه الآن</span>}</>}
            desc={<span className="num-latin">/l/{l.slug}{owner && l.ownerEmail ? ` · ${l.ownerName} (${l.ownerEmail})` : ''}</span>}
            actions={<>
              {l.slug !== currentLive && <Btn size="sm" variant="gold" icon="check" onClick={() => onSwitch(l.slug)}>فتح</Btn>}
              <Btn size="sm" variant="ghost" onClick={() => rename(l)}>إعادة تسمية</Btn>
              {l.slug !== 'main' && <Btn size="sm" variant="ghost" icon="trash" onClick={() => del(l)}>حذف</Btn>}
            </>}>
            <div className="a-live-meta">
              <span className={`a-status ${k}`}><span className="a-status-dot" />{label}{l.tiktokUsername ? ` · @${l.tiktokUsername}` : ''}</span>
              <span className="a-chip num-latin">{Math.round(l.total).toLocaleString('en-US')} نقطة</span>
              <span className="a-chip">👁 {l.clients} شاشة</span>
            </div>
            <div className="a-live-links">
              <div className="a-gcopy"><span className="a-label">الصفحة</span><CopyField value={`${origin}/${q}`} /></div>
              <div className="a-gcopy"><span className="a-label">OBS</span><CopyField value={`${origin}/overlay/${q}`} /></div>
              <div className="a-gcopy"><span className="a-label">عمودي</span><CopyField value={`${origin}/overlay-vertical/${q}`} /></div>
            </div>
            {owner && usersList.length > 1 && (
              <div className="a-inline" style={{ marginTop: 10 }}>
                <span className="a-label">نقل إلى</span>
                <Select value={l.ownerId} onChange={(v) => v !== l.ownerId && confirm('نقل ملكية هذا البث؟') && transfer(l, v)}
                  options={usersList.map((u) => [u.id, `${u.name} (${u.email})`])} />
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}

/* ======================================================================== */
function NewPassword({ info, onClose }) {
  if (!info) return null;
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const text = `رابط اللوحة: ${origin}/admin/\nالبريد: ${info.email}\nكلمة المرور: ${info.password}${info.live ? `\nرابط البث: ${origin}/l/${info.live}` : ''}`;
  return (
    <div className="a-alert gold a-newpw">
      <div style={{ flex: 1 }}>
        <b>🔑 بيانات الدخول ({info.title}). انسخها الآن، لن تظهر مرة أخرى:</b>
        <pre className="num-latin">{text}</pre>
      </div>
      <div className="a-actions">
        <Btn size="sm" variant="gold" icon="copy" onClick={() => navigator.clipboard?.writeText(text)}>نسخ</Btn>
        <Btn size="sm" variant="ghost" icon="close" onClick={onClose}>إغلاق</Btn>
      </div>
    </div>
  );
}

export function UsersPage({ me, notice, reloadLives }) {
  const [list, setList] = useState(null);
  const [f, setF] = useState({ email: '', name: '', maxLives: 1, role: 'user', createLive: true, liveSlug: '' });
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState(null);
  const load = useCallback(async () => { try { setList((await api('/api/users')).users); } catch (e) { notice(e.message, 'err'); } }, [notice]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api('/api/users', { method: 'POST', body: { ...f, liveSlug: toSlug(f.liveSlug) } });
      setPw({ title: 'مستخدم جديد', email: r.user.email, password: r.password, live: r.live?.slug });
      setF({ email: '', name: '', maxLives: 1, role: 'user', createLive: true, liveSlug: '' });
      load(); reloadLives();
    } catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  const update = async (u, body, ok) => {
    try {
      const r = await api('/api/users/update', { method: 'POST', body: { id: u.id, ...body } });
      if (r.password) setPw({ title: 'كلمة مرور جديدة', email: r.user.email, password: r.password });
      else if (ok) notice(ok);
      load();
    } catch (e) { notice(e.message, 'err'); }
  };
  const remove = async (u) => {
    if (!confirm(`حذف المستخدم ${u.email}؟`)) return;
    const delLives = u.lives.length > 0 && confirm(`لديه ${u.lives.length} بث. اضغط «موافق» لحذف بثوثه، أو «إلغاء» لنقلها إليك.`);
    try { await api(`/api/users?id=${u.id}&lives=${delLives ? 'delete' : 'transfer'}`, { method: 'DELETE' }); notice('تم حذف المستخدم'); load(); reloadLives(); }
    catch (e) { notice(e.message, 'err'); }
  };

  return (
    <div className="a-grid">
      <Section title="➕ إضافة مستخدم" className="span-2" desc="المستخدم يرى بثوثه فقط ويتحكم بها (الفرق، الهدايا، المظهر، الجولات، التقارير…)، ولا يرى إعدادات الخادم أو الملفات أو المستخدمين.">
        <NewPassword info={pw} onClose={() => setPw(null)} />
        <div className="a-form">
          <Field label="البريد الإلكتروني"><input className="a-input num-latin" dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="user@example.com" /></Field>
          <Field label="الاسم"><Text value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
          <Field label="عدد البثوث المسموح"><Num value={f.maxLives} min={0} max={100} onChange={(v) => setF({ ...f, maxLives: v })} /></Field>
          <Field label="الصلاحية"><Select value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[['user', 'مستخدم (بثوثه فقط)'], ['owner', 'مدير (كل شيء)']]} /></Field>
          <Toggle label="إنشاء بث له مباشرة" checked={f.createLive} onChange={(v) => setF({ ...f, createLive: v })} />
          {f.createLive && <Field label="رابط البث (إنجليزي، اختياري)" hint="يُنشأ من البريد إذا تُرك فارغاً"><input className="a-input num-latin" dir="ltr" value={f.liveSlug} onChange={(e) => setF({ ...f, liveSlug: e.target.value })} placeholder="sara" /></Field>}
        </div>
        <div className="a-row"><Btn variant="gold" icon="plus" busy={busy} onClick={create}>إنشاء المستخدم</Btn><span className="a-muted">تُنشأ كلمة مرور تلقائياً، وعليه تغييرها عند أول دخول.</span></div>
      </Section>

      <Section title={`👥 المستخدمون (${list?.length ?? '…'})`} className="span-2">
        {!list ? <div className="a-center"><span className="spin" /></div> : (
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>المستخدم</th><th>الصلاحية</th><th>البثوث</th><th>الحد</th><th>آخر دخول</th><th>الحالة</th><th /></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className={u.disabled ? 'a-row-off' : ''}>
                    <td><b>{u.name}</b><div className="a-muted num-latin">{u.email}</div></td>
                    <td>{u.role === 'owner' ? <span className="a-chip gold">مدير</span> : <span className="a-chip">مستخدم</span>}</td>
                    <td>{u.lives.length ? u.lives.map((l) => <span key={l.slug} className="a-chip num-latin" style={{ marginInlineEnd: 4 }}>{l.slug}</span>) : <span className="a-muted">—</span>}</td>
                    <td>{u.role === 'owner' ? '∞' : (
                      <input className="a-input sm num-latin" type="number" min="0" max="100" defaultValue={u.maxLives} style={{ width: 70 }}
                        onBlur={(e) => Number(e.target.value) !== u.maxLives && update(u, { maxLives: Number(e.target.value) }, 'تم تحديث الحد')} />
                    )}</td>
                    <td className="a-muted">{dt(u.lastLoginAt)}</td>
                    <td>{u.disabled ? <span className="a-chip warn">موقوف</span> : u.mustChangePassword ? <span className="a-chip">لم يغيّر كلمة المرور</span> : <span className="a-chip ok">نشط</span>}</td>
                    <td>
                      <div className="a-actions">
                        <Btn size="sm" variant="ghost" icon="key" onClick={() => confirm(`إنشاء كلمة مرور جديدة لـ ${u.email}؟`) && update(u, { resetPassword: true })}>كلمة مرور جديدة</Btn>
                        {u.id !== me.id && <Btn size="sm" variant="ghost" icon={u.disabled ? 'play' : 'stop'} onClick={() => update(u, { disabled: !u.disabled }, u.disabled ? 'تم التفعيل' : 'تم الإيقاف')}>{u.disabled ? 'تفعيل' : 'إيقاف'}</Btn>}
                        {u.id !== me.id && <Btn size="sm" variant="ghost" icon="trash" onClick={() => remove(u)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ======================================================================== */
/** Dashboard look for this browser: theme, font, text size (saved on this device). */
function DisplayPrefs() {
  const [p, update] = useAdminPrefs();
  return (
    <Section title="🎨 مظهر لوحة التحكم" className="span-2" desc="يُحفظ على هذا الجهاز فقط ولا يغيّر شكل البث. لتغيير خط وشكل البث نفسه استخدم صفحة «المظهر».">
      <div className="a-form">
        <Field label="الوضع">
          <div className="a-seg">
            {[['light', '☀️ فاتح'], ['dark', '🌙 داكن'], ['auto', '🖥️ حسب الجهاز']].map(([v, l]) => <button key={v} className={p.theme === v ? 'on' : ''} onClick={() => update({ theme: v })}>{l}</button>)}
          </div>
        </Field>
        <Field label="حجم النص">
          <div className="a-seg">
            {ADMIN_SIZES.map(([v, l]) => <button key={v} className={p.size === v ? 'on' : ''} onClick={() => update({ size: v })}>{l}</button>)}
          </div>
        </Field>
      </div>
      <h4 className="a-sub">الخط</h4>
      <div className="a-prefs-fonts">
        {FONTS.map((f) => (
          <button key={f.family} type="button" className={`a-prefs-font${p.font === f.family ? ' on' : ''}`} onClick={() => update({ font: f.family })}>
            <b style={{ fontFamily: `'${f.family}', 'Cairo'` }}>{f.label}</b>
            <small>{f.style}</small>
          </button>
        ))}
      </div>
    </Section>
  );
}

export function AccountPage({ me, notice, onLogout, onUpdated, mustChange }) {
  const [f, setF] = useState({ name: me.name, email: me.email, cur: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const body = { name: f.name, email: f.email };
    if (f.cur) body.currentPassword = f.cur;
    if (f.pw) { if (f.pw !== f.pw2) return notice('كلمتا المرور غير متطابقتين', 'err'); body.newPassword = f.pw; }
    setBusy(true);
    try { const r = await api('/api/account', { method: 'POST', body }); notice('تم حفظ حسابك'); setF({ ...f, cur: '', pw: '', pw2: '' }); onUpdated(r.user); }
    catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="a-grid">
      {(mustChange || me.mustChangePassword) && <div className="a-alert warn span-2"><Icon name="key" />أنت تستخدم كلمة مرور مؤقتة. عيّن كلمة مرور خاصة بك الآن.</div>}
      <DisplayPrefs />
      <Section title="👤 حسابي" desc="لتغيير البريد أو كلمة المرور أدخل كلمة المرور الحالية">
        <div className="a-form">
          <Field label="الاسم"><Text value={f.name} onChange={(v) => setF({ ...f, name: v })} /></Field>
          <Field label="البريد الإلكتروني (للدخول)"><input className="a-input num-latin" dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="كلمة المرور الحالية"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="current-password" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} /></Field>
          <Field label="كلمة مرور جديدة (10 أحرف على الأقل)"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="new-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
          <Field label="تأكيد كلمة المرور"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="new-password" value={f.pw2} onChange={(e) => setF({ ...f, pw2: e.target.value })} /></Field>
        </div>
        <div className="a-row"><Btn variant="gold" icon="save" busy={busy} onClick={save}>حفظ</Btn><Btn variant="ghost" icon="logout" onClick={onLogout}>تسجيل الخروج</Btn></div>
      </Section>
      <Section title="الصلاحيات">
        <p className="a-gtext">{me.role === 'owner'
          ? 'أنت مدير: ترى كل البثوث والمستخدمين وإعدادات الخادم والملفات والتحديثات.'
          : <>أنت مستخدم: تتحكم في بثوثك فقط{me.maxLives != null ? ` (حتى ${me.maxLives} بث)` : ''}. مفتاح الاتصال وإعدادات الخادم يديرها المدير.</>}</p>
      </Section>
    </div>
  );
}
