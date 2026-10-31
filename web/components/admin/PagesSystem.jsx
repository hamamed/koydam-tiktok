'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Btn, Field, Icon, JobView, Section, Toggle, useJobs } from './ui';

/** Waits until the server answers again after a restart. */
async function waitForRestart(maxMs = 90000) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() - t0 < maxMs) {
    try { const h = await fetch('/health', { cache: 'no-store' }).then((r) => r.json()); if (h.ok && h.uptime < 90) return true; } catch { /* down */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
async function restartServer(notice, supervised) {
  if (!supervised && !confirm('الخادم لا يعمل تحت systemd/PM2، سيتوقف ولن يعود تلقائياً. متابعة؟')) return;
  if (supervised && !confirm('إعادة تشغيل الخادم الآن؟ ستعود الواجهات تلقائياً خلال ثوانٍ.')) return;
  try { await api('/api/restart', { method: 'POST' }); } catch (e) { return notice(e.message, 'err'); }
  notice('جارٍ إعادة التشغيل…');
  const ok = await waitForRestart();
  notice(ok ? 'تمت إعادة التشغيل' : 'لم يعد الخادم خلال 90 ثانية. راجع السجلات على الخادم.', ok ? 'ok' : 'err');
}

export function ServerPage({ notice, mustChange, onLogout }) {
  const [s, setS] = useState(null);
  const [f, setF] = useState({ email: '', tiktokUsername: '', autoConnect: false, signApiKey: '', adminToken: '', cur: '', pw: '', pw2: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api('/api/settings');
      setS(r);
      setF((x) => ({ ...x, email: r.adminEmail, tiktokUsername: r.tiktokUsername, autoConnect: r.autoConnect, signApiKey: '', adminToken: '', cur: '', pw: '', pw2: '' }));
    } catch (e) { notice(e.message, 'err'); }
  }, [notice]);
  useEffect(() => { load(); }, [load]);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const saveAll = async () => {
    const body = { tiktokUsername: f.tiktokUsername, autoConnect: f.autoConnect, adminEmail: f.email };
    if (f.signApiKey.trim()) body.signApiKey = f.signApiKey.trim();
    if (f.adminToken.trim()) body.adminToken = f.adminToken.trim();
    if (f.cur) body.currentPassword = f.cur;
    if (f.pw) {
      if (f.pw !== f.pw2) return notice('كلمتا المرور غير متطابقتين', 'err');
      body.newPassword = f.pw;
    }
    setBusy(true);
    try {
      const r = await api('/api/settings', { method: 'POST', body });
      notice(r.restartRequired ? 'تم الحفظ. أعد تشغيل الخادم لاستخدام المفتاح الجديد.' : 'تم حفظ إعدادات الخادم');
      load();
    } catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  const clear = async (field) => { try { await api('/api/settings', { method: 'POST', body: { [field]: true } }); notice('تم الحذف'); load(); } catch (e) { notice(e.message, 'err'); } };
  const genToken = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); setF({ ...f, adminToken: btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '') }); notice('تم توليد رمز. انسخه ثم احفظ.'); };
  if (!s) return <div className="a-center"><span className="spin" /></div>;
  const sv = s.server;

  return (
    <div className="a-grid">
      {(mustChange || s.mustChangePassword) && <div className="a-alert warn span-2"><Icon name="key" />أنت تستخدم كلمة المرور المؤقتة. عيّن كلمة مرور خاصة بك أدناه.</div>}
      <Section title="حساب المدير" desc="لتغيير البريد أو كلمة المرور أدخل كلمة المرور الحالية">
        <div className="a-form">
          <Field label="البريد الإلكتروني للدخول"><input className="a-input num-latin" dir="ltr" type="email" value={f.email} onChange={up('email')} /></Field>
          <Field label="كلمة المرور الحالية"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="current-password" value={f.cur} onChange={up('cur')} /></Field>
          <Field label="كلمة مرور جديدة (10 أحرف على الأقل)"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="new-password" value={f.pw} onChange={up('pw')} /></Field>
          <Field label="تأكيد كلمة المرور"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="new-password" value={f.pw2} onChange={up('pw2')} /></Field>
        </div>
      </Section>
      <Section title="تيك توك">
        <div className="a-form">
          <Field label="اسم مستخدم البث"><input className="a-input num-latin" dir="ltr" value={f.tiktokUsername} onChange={up('tiktokUsername')} /></Field>
          <label className="a-toggle"><input type="checkbox" checked={f.autoConnect} onChange={up('autoConnect')} /><span className="a-switch" /><span>اتصال تلقائي عند تشغيل الخادم</span></label>
          <Field label="مفتاح Euler Stream (Sign API)" hint={s.signApiKeySet ? `✓ مفتاح محفوظ (${s.signApiKeyHint}). الصق مفتاحاً جديداً لاستبداله.` : 'يحسّن حدود الاتصال. مجاني من eulerstream.com. يُستخدم بعد إعادة التشغيل.'}>
            <div className="a-inline"><input className="a-input num-latin" dir="ltr" type="password" autoComplete="off" value={f.signApiKey} onChange={up('signApiKey')} placeholder="euler_…" />
              {s.signApiKeySet && <Btn size="sm" variant="ghost" icon="trash" onClick={() => confirm('حذف المفتاح؟') && clear('clearSignApiKey')} />}</div>
          </Field>
          <Field label="رمز API (اختياري)" hint={s.adminTokenSet ? '✓ رمز محفوظ' : 'لإرسال أوامر WebSocket من سكربتات أو Stream Deck'}>
            <div className="a-inline"><input className="a-input num-latin" dir="ltr" type="text" autoComplete="off" value={f.adminToken} onChange={up('adminToken')} />
              <Btn size="sm" variant="ghost" onClick={genToken}>توليد</Btn>
              {s.adminTokenSet && <Btn size="sm" variant="ghost" icon="trash" onClick={() => confirm('حذف الرمز؟') && clear('clearAdminToken')} />}</div>
          </Field>
        </div>
      </Section>
      <div className="a-row span-2">
        <Btn variant="gold" icon="save" busy={busy} onClick={saveAll}>حفظ إعدادات الخادم</Btn>
        <Btn variant="ghost" icon="update" onClick={() => restartServer(notice, sv.supervised).then(load)}>إعادة تشغيل الخادم</Btn>
        <Btn variant="ghost" icon="logout" onClick={onLogout}>تسجيل الخروج</Btn>
      </div>
      <Section title="معلومات الخادم" className="span-2">
        <div className="a-info num-latin">
          <div><span>الإصدار</span><b>{sv.version}</b></div>
          <div><span>Node</span><b>{sv.node}</b></div>
          <div><span>مدة التشغيل</span><b>{Math.floor(sv.uptime / 3600)}h {Math.floor(sv.uptime / 60) % 60}m</b></div>
          <div><span>الذاكرة</span><b>{sv.memoryMb} MB</b></div>
          <div><span>الاتصالات</span><b>{sv.clients}</b></div>
          <div><span>المنفذ الداخلي</span><b>{sv.port}</b></div>
          <div><span>الهدايا</span><b>{sv.stats.gifts}</b></div>
          <div><span>إعادة تشغيل تلقائي</span><b>{sv.supervised ? '✓ systemd' : '✗'}</b></div>
          <div className="wide"><span>مجلد التطبيق</span><b>{sv.appRoot}</b></div>
        </div>
      </Section>
    </div>
  );
}

export function FilesPage({ notice }) {
  const [files, setFiles] = useState([]);
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(null);
  const [content, setContent] = useState('');
  const [mtime, setMtime] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [backups, setBackups] = useState([]);
  const [jobs, poll] = useJobs();
  const buildJob = jobs.current?.name === 'build' ? jobs.current : jobs.last?.name === 'build' ? jobs.last : null;

  const refresh = useCallback(async () => { try { setFiles((await api('/api/files')).files); } catch (e) { notice(e.message, 'err'); } }, [notice]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h); }, [dirty]);

  const loadBackups = async (p) => { try { setBackups((await api(`/api/backups?path=${encodeURIComponent(p)}`)).backups); } catch { setBackups([]); } };
  const open = async (p) => {
    if (dirty && !confirm(`تجاهل التعديلات غير المحفوظة في ${cur}؟`)) return;
    try { const r = await api(`/api/file?path=${encodeURIComponent(p)}`); setCur(r.path); setContent(r.content); setMtime(r.mtime); setDirty(false); setMsg(null); loadBackups(r.path); }
    catch (e) { notice(e.message, 'err'); }
  };
  const build = async () => { try { await api('/api/build', { method: 'POST' }); poll(); notice('بدأ بناء الواجهة'); } catch (e) { notice(e.message, 'err'); } };
  const save = async (force = false) => {
    if (!cur) return;
    try {
      const r = await api('/api/file', { method: 'PUT', body: { path: cur, content, expectMtime: mtime || undefined, force } });
      setMtime(r.mtime); setDirty(false); refresh(); loadBackups(cur);
      setMsg({ kind: 'ok', text: `تم حفظ ${r.path}. ${r.note || ''}`, actions: r.buildRequired ? [['بناء الواجهة الآن', build]] : r.restartRequired ? [['إعادة التشغيل الآن', () => restartServer(notice, true)]] : [] });
    } catch (e) {
      const d = e.data || {};
      if (d.syntax) setMsg({ kind: 'err', text: `لم يُحفظ: خطأ في الصياغة\n${e.message}`, actions: d.canForce ? [['حفظ على أي حال', () => save(true)]] : [] });
      else if (d.conflict) setMsg({ kind: 'err', text: e.message, actions: [['الكتابة فوقه', () => save(true)], ['إعادة التحميل', () => { setDirty(false); open(cur); }]] });
      else setMsg({ kind: 'err', text: e.message, actions: [] });
    }
  };
  const del = async () => {
    if (!cur || !confirm(`حذف ${cur}؟ تُحفظ نسخة احتياطية.`)) return;
    try { await api(`/api/file?path=${encodeURIComponent(cur)}`, { method: 'DELETE' }); setCur(null); setContent(''); setDirty(false); refresh(); notice('تم الحذف'); }
    catch (e) { notice(e.message, 'err'); }
  };
  const newFile = () => {
    if (dirty && !confirm('تجاهل التعديلات غير المحفوظة؟')) return;
    const p = prompt('مسار الملف الجديد داخل مجلد التطبيق (مثال: web/styles/custom.css):');
    if (!p) return;
    setCur(p.trim().replace(/^\/+/, '')); setContent(''); setMtime(0); setDirty(true); setBackups([]); setMsg({ kind: '', text: 'ملف جديد. اكتب المحتوى ثم احفظ.', actions: [] });
  };
  const restoreBackup = async (name) => {
    if (!name || (dirty && !confirm('تجاهل التعديلات الحالية؟'))) return;
    try { const r = await api(`/api/backups?path=${encodeURIComponent(cur)}&name=${encodeURIComponent(name)}`); setContent(r.content); setDirty(true); setMsg({ kind: '', text: 'تم تحميل النسخة الاحتياطية في المحرر. اضغط حفظ لاستعادتها.', actions: [] }); }
    catch (e) { notice(e.message, 'err'); }
  };
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); setContent(t.value); setDirty(true); }
  };
  const shown = files.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="a-files">
      <aside className="a-card a-filelist">
        <div className="a-inline"><input className="a-input" placeholder="بحث…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="a-icon-btn" title="ملف جديد" onClick={newFile}><Icon name="plus" /></button>
          <button className="a-icon-btn" title="تحديث" onClick={refresh}><Icon name="update" /></button></div>
        <div className="a-filelist-items">
          {shown.map((f) => (
            <button key={f.path} className={`a-file${f.path === cur ? ' active' : ''}`} onClick={() => open(f.path)}>
              <span className="num-latin">{f.path}</span><small className="num-latin">{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}</small>
            </button>
          ))}
        </div>
        <div className="a-build">
          <Btn variant="gold" icon="build" busy={jobs.current?.name === 'build'} onClick={build}>بناء الواجهة</Btn>
          <small className="a-muted">بعد تعديل ملفات web/ اضغط «بناء» لتحديث الموقع. كل حفظ يحتفظ بنسخة احتياطية. server/index.js لا يُحفظ إذا كان فيه خطأ.</small>
        </div>
      </aside>
      <section className="a-card a-editor">
        <div className="a-editor-head">
          <b className="num-latin">{cur || 'اختر ملفاً'}</b>{cur && <span className={`a-chip ${dirty ? 'warn' : ''}`}>{dirty ? '● غير محفوظ' : 'محفوظ'}</span>}
          <span className="a-top-spacer" />
          {cur && (
            <>
              <select className="a-input sm" value="" onChange={(e) => restoreBackup(e.target.value)}>
                <option value="">{backups.length ? `النسخ الاحتياطية (${backups.length})` : 'لا نسخ احتياطية'}</option>
                {backups.map((b) => <option key={b.name} value={b.name}>{b.label.replace(/T(\d\d)-(\d\d)-(\d\d)-\d+Z$/, ' $1:$2:$3')}</option>)}
              </select>
              <Btn size="sm" variant="ghost" icon="trash" onClick={del}>حذف</Btn>
              <Btn size="sm" variant="gold" icon="save" onClick={() => save()}>حفظ (Ctrl+S)</Btn>
            </>
          )}
        </div>
        {msg && msg.text && (
          <div className={`a-alert ${msg.kind}`}><pre>{msg.text}</pre>{msg.actions.map(([l, fn]) => <Btn key={l} size="sm" variant="ghost" onClick={fn}>{l}</Btn>)}</div>
        )}
        {buildJob && <JobView job={buildJob} title="بناء الواجهة" />}
        <textarea className="a-code-editor num-latin" dir="ltr" spellCheck={false} wrap="off" disabled={!cur} value={content}
          onChange={(e) => { setContent(e.target.value); setDirty(true); }} onKeyDown={onKey} placeholder="اختر ملفاً من القائمة" />
      </section>
    </div>
  );
}

export function LogsPage() {
  const [lines, setLines] = useState([]);
  const [paused, setPaused] = useState(false);
  const seq = useRef(0); const boot = useRef('');
  const box = useRef(null);
  useEffect(() => {
    if (paused) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api(`/api/logs?since=${seq.current}&boot=${boot.current}`);
        if (stop) return;
        const restarted = boot.current && r.boot !== boot.current;
        boot.current = r.boot; seq.current = r.next;
        if (r.lines.length || restarted) {
          setLines((l) => [...l, ...(restarted ? [{ i: `r${Date.now()}`, l: 'WARN', t: new Date().toISOString(), m: '──────── أُعيد تشغيل الخادم ────────' }] : []), ...r.lines].slice(-800));
        }
      } catch { /* server restarting */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [paused]);
  useEffect(() => { const b = box.current; if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 80) b.scrollTop = b.scrollHeight; }, [lines]);
  return (
    <Section title="سجل الخادم" desc="آخر 500 سطر، يتحدث كل ثانيتين"
      actions={<><Btn size="sm" variant="ghost" icon={paused ? 'play' : 'stop'} onClick={() => setPaused(!paused)}>{paused ? 'استئناف' : 'إيقاف مؤقت'}</Btn><Btn size="sm" variant="ghost" icon="trash" onClick={() => setLines([])}>مسح العرض</Btn></>}>
      <div ref={box} className="a-logs num-latin" dir="ltr">
        {lines.map((l) => <div key={l.i} className={`a-log ${l.l.toLowerCase()}`}><span>{l.t.slice(11, 19)}</span> <b>{l.l}</b> {l.m}</div>)}
      </div>
    </Section>
  );
}

export function UpdatesPage({ notice }) {
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);
  const [stash, setStash] = useState(false);
  const [jobs, poll] = useJobs(true);
  const [waiting, setWaiting] = useState(false);
  const job = jobs.current?.name === 'update' ? jobs.current : jobs.last?.name === 'update' ? jobs.last : null;

  const check = useCallback(async () => {
    setChecking(true);
    try { setInfo(await api('/api/update/check')); } catch (e) { notice(e.message, 'err'); } finally { setChecking(false); }
  }, [notice]);
  useEffect(() => { check(); }, [check]);

  // When the update job finishes OK the server restarts: wait, then reload the dashboard.
  useEffect(() => {
    if (job && job.ok === true && !waiting && Date.now() - (job.finishedAt || 0) < 60000) {
      setWaiting(true);
      waitForRestart().then((ok) => { if (ok) location.reload(); else { setWaiting(false); notice('لم يعد الخادم بعد التحديث. راجع السجلات.', 'err'); } });
    }
  }, [job, waiting, notice]);

  const runUpdate = async () => {
    if (!confirm('تحديث التطبيق الآن؟ سيُعاد تشغيل الخادم بعد البناء (دقيقة تقريباً).')) return;
    try { await api('/api/update/run', { method: 'POST', body: { stashLocal: stash } }); poll(); notice('بدأ التحديث'); }
    catch (e) { notice(e.message, 'err'); }
  };

  return (
    <div className="a-grid">
      <Section title="التحديث من GitHub" className="span-2"
        desc="يجلب آخر نسخة من المستودع، يثبت الحزم، يبني الواجهة ثم يعيد تشغيل الخادم. الإعدادات والنتائج في data/ لا تتأثر."
        actions={<Btn size="sm" variant="ghost" icon="update" busy={checking} onClick={check}>تحقق الآن</Btn>}>
        {!info ? <div className="a-center"><span className="spin" /></div> : !info.git ? (
          <div className="a-alert warn"><Icon name="close" />هذا التثبيت ليس من GitHub. أعد التثبيت بأمر التثبيت الموجود في README لتفعيل التحديث بضغطة.</div>
        ) : info.error ? (
          <div className="a-alert err"><Icon name="close" />{info.error}</div>
        ) : (
          <>
            <div className="a-info num-latin">
              <div><span>الفرع</span><b>{info.branch}</b></div>
              <div><span>النسخة الحالية</span><b>{info.current?.hash} · {info.current?.when}</b></div>
              <div><span>أحدث نسخة</span><b>{info.remote}</b></div>
              <div className="wide"><span>المستودع</span><b>{info.url}</b></div>
            </div>
            {info.behind === 0 ? (
              <div className="a-alert ok"><Icon name="check" />أنت تستخدم أحدث نسخة. {info.current?.subject}</div>
            ) : (
              <>
                <div className="a-alert gold"><Icon name="update" />يوجد {info.behind} تحديث جديد</div>
                <ul className="a-commits">{info.commits.map((c) => <li key={c.hash}><code className="num-latin">{c.hash}</code><span>{c.subject}</span><small className="a-muted">{c.when}</small></li>)}</ul>
                {info.dirty.length > 0 && (
                  <div className="a-alert warn">
                    <div><b>توجد تعديلات محلية على ملفات المستودع:</b><pre className="num-latin">{info.dirty.join('\n')}</pre>
                      <Toggle label="احفظ تعديلاتي في git stash ثم حدّث" checked={stash} onChange={setStash} /></div>
                  </div>
                )}
                <Btn variant="gold" icon="update" busy={Boolean(jobs.current) || waiting} disabled={info.dirty.length > 0 && !stash} onClick={runUpdate}>تحديث الآن</Btn>
              </>
            )}
          </>
        )}
      </Section>
      {job && <div className="span-2"><JobView job={job} title={waiting ? 'تم التحديث، بانتظار إعادة تشغيل الخادم…' : 'التحديث'} /></div>}
    </div>
  );
}
