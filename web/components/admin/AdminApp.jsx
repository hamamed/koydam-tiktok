'use client';
/**
 * Admin dashboard shell: login gate, sidebar navigation (hash routes),
 * top bar, shared config draft with a sticky "save" bar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cmd, reconnectSocket, useLive } from '@/lib/store';
import { clone } from '@/lib/format';
import { Logo } from '../bits';
import { Btn, Icon, NoticeProvider, useNotice } from './ui';
import Login from './Login';
import { Overview, Connection } from './PagesLive';
import { Teams, Scoring, Theme } from './PagesConfig';
import { Tools } from './PagesTools';
import { ServerPage, FilesPage, LogsPage, UpdatesPage } from './PagesSystem';
import { RoundsPage, VoicePage, ReportsPage } from './PagesExtra';

export const NAV = [
  { id: 'overview', label: 'نظرة عامة', icon: 'overview' },
  { id: 'connection', label: 'الاتصال بالبث', icon: 'plug' },
  { id: 'teams', label: 'الفرق والهدف', icon: 'flag', draft: true },
  { id: 'scoring', label: 'الهدايا والنقاط', icon: 'gift', draft: true },
  { id: 'theme', label: 'المظهر', icon: 'palette', draft: true },
  { id: 'rounds', label: 'الجولات', icon: 'trophy', draft: true },
  { id: 'voice', label: 'القراءة الصوتية', icon: 'bolt', draft: true },
  { id: 'reports', label: 'تقارير البث', icon: 'logs' },
  { id: 'tools', label: 'الأدوات', icon: 'tools' },
  { sep: 'النظام' },
  { id: 'server', label: 'الخادم والحساب', icon: 'server' },
  { id: 'files', label: 'الملفات', icon: 'file' },
  { id: 'logs', label: 'السجلات', icon: 'logs' },
  { id: 'updates', label: 'التحديثات', icon: 'update' },
];

export default function AdminApp() {
  const [auth, setAuth] = useState({ checked: false, authed: false, mustChange: false });
  const check = useCallback(async () => {
    try { const r = await api('/api/me'); setAuth({ checked: true, authed: r.authed, mustChange: r.mustChangePassword }); }
    catch { setAuth({ checked: true, authed: false, mustChange: false }); }
  }, []);
  useEffect(() => {
    check();
    const onUnauth = () => setAuth((a) => ({ ...a, authed: false }));
    window.addEventListener('koydam:unauthorized', onUnauth);
    return () => window.removeEventListener('koydam:unauthorized', onUnauth);
  }, [check]);

  if (!auth.checked) return <div className="admin-root a-center"><Logo className="a-boot-logo" /></div>;
  return (
    <NoticeProvider>
      {auth.authed
        ? <Dashboard mustChange={auth.mustChange} onLogout={() => setAuth({ checked: true, authed: false, mustChange: false })} />
        : <Login onLogin={(r) => { setAuth({ checked: true, authed: true, mustChange: r.mustChangePassword }); reconnectSocket(); }} />}
    </NoticeProvider>
  );
}

function Dashboard({ mustChange, onLogout }) {
  const live = useLive();
  const notice = useNotice();
  const [tab, setTab] = useState('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState('');

  // Hash routing (#teams, #files ...)
  useEffect(() => {
    const read = () => { const h = location.hash.slice(1); if (NAV.some((n) => n.id === h)) setTab(h); };
    read();
    if (mustChange && !location.hash) location.hash = 'server';
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [mustChange]);
  useEffect(() => { api('/api/settings').then((s) => setMe(s.adminEmail)).catch(() => {}); }, []);

  // Draft follows the server config until the admin edits something.
  useEffect(() => { if (live.config && !dirty) setDraft(clone(live.config)); }, [live.config, dirty]);
  const edit = useCallback((fn) => { setDraft((d) => { const n = clone(d); fn(n); return n; }); setDirty(true); }, []);
  const save = async (cfg = draft) => {
    setSaving(true);
    try { await cmd('saveConfig', { config: cfg }); setDirty(false); notice('تم الحفظ والتطبيق على كل الشاشات'); }
    catch (e) { notice(e.message, 'err'); }
    finally { setSaving(false); }
  };
  const revert = () => { setDirty(false); setDraft(clone(live.config)); };

  const logout = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ } reconnectSocket(); onLogout(); };
  const go = (id) => { location.hash = id; setTab(id); setMenuOpen(false); };

  const st = live.status || {};
  const connLabel = !live.connected ? ['err', 'الخادم غير متصل']
    : st.demo ? ['demo', 'وضع تجريبي']
    : st.state === 'connected' ? ['ok', `متصل @${st.username}`]
    : st.state === 'connecting' || st.state === 'reconnecting' ? ['warn', 'جارٍ الاتصال…']
    : st.state === 'offline' ? ['warn', 'البث متوقف']
    : ['idle', 'غير متصل بتيك توك'];
  const current = NAV.find((n) => n.id === tab) || NAV[0];
  const props = { live, draft, edit, save, dirty, notice, go };

  const page = useMemo(() => {
    if (!live.config || !draft) return <div className="a-center a-muted"><span className="spin" /> جارٍ التحميل…</div>;
    switch (tab) {
      case 'connection': return <Connection {...props} />;
      case 'teams': return <Teams {...props} />;
      case 'scoring': return <Scoring {...props} />;
      case 'theme': return <Theme {...props} />;
      case 'tools': return <Tools {...props} />;
      case 'rounds': return <RoundsPage {...props} />;
      case 'voice': return <VoicePage {...props} />;
      case 'reports': return <ReportsPage {...props} />;
      case 'server': return <ServerPage {...props} mustChange={mustChange} onLogout={logout} />;
      case 'files': return <FilesPage {...props} />;
      case 'logs': return <LogsPage {...props} />;
      case 'updates': return <UpdatesPage {...props} />;
      default: return <Overview {...props} />;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, live, draft, dirty, mustChange]);

  return (
    <div className={`admin-root${menuOpen ? ' menu-open' : ''}`}>
      <aside className="a-side">
        <div className="a-brand">
          <Logo small className="a-brand-logo" />
          <div><b>تحدي المليون</b><span>لوحة التحكم</span></div>
        </div>
        <nav className="a-nav">
          {NAV.map((n, i) => n.sep
            ? <div key={i} className="a-nav-sep">{n.sep}</div>
            : (
              <button key={n.id} className={`a-nav-item${tab === n.id ? ' active' : ''}`} onClick={() => go(n.id)}>
                <Icon name={n.icon} /><span>{n.label}</span>
                {n.draft && dirty && <i className="a-dot" title="تغييرات غير محفوظة" />}
              </button>
            ))}
        </nav>
        <div className="a-side-foot">
          <a className="a-btn ghost sm" href="/" target="_blank" rel="noopener"><Icon name="eye" size={15} /><span>الصفحة المباشرة</span></a>
          <span className="a-muted num-latin">v{live.version}</span>
        </div>
      </aside>
      <div className="a-scrim" onClick={() => setMenuOpen(false)} />

      <div className="a-main">
        <header className="a-top">
          <button className="a-icon-btn a-menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="القائمة"><Icon name="menu" /></button>
          <h1>{current.label}</h1>
          <span className={`a-status ${connLabel[0]}`}><span className="a-status-dot" />{connLabel[1]}</span>
          <span className="a-top-spacer" />
          <a className="a-btn ghost sm hide-sm" href="/overlay/" target="_blank" rel="noopener"><Icon name="external" size={15} /><span>واجهة OBS</span></a>
          <div className="a-user">
            <span className="a-avatar">{(me || 'A')[0].toUpperCase()}</span>
            <span className="hide-sm num-latin">{me}</span>
            <button className="a-icon-btn" onClick={logout} title="تسجيل الخروج"><Icon name="logout" /></button>
          </div>
        </header>

        <main className="a-content">{page}</main>

        {dirty && (
          <div className="a-savebar">
            <Icon name="save" /><span>لديك تغييرات غير محفوظة</span>
            <span className="a-top-spacer" />
            <Btn variant="ghost" onClick={revert}>تراجع</Btn>
            <Btn variant="gold" icon="check" busy={saving} onClick={() => save()}>حفظ وتطبيق</Btn>
          </div>
        )}
      </div>
    </div>
  );
}
