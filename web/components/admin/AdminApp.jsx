'use client';
/**
 * Admin dashboard shell: login gate, live switcher, sidebar navigation
 * (hash routes, filtered by role), top bar, shared config draft + save bar.
 *  - owner: all lives, users, server, files, logs, updates
 *  - user:  only their own lives
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, setApiLive } from '@/lib/api';
import { cmd, liveQuery, reconnectSocket, setStoreLive, useLive } from '@/lib/store';
import { clone } from '@/lib/format';
import { Logo } from '../bits';
import { Btn, Icon, NoticeProvider, useNotice } from './ui';
import Login from './Login';
import { Overview, Connection } from './PagesLive';
import { Teams, Scoring, Theme } from './PagesConfig';
import { Tools } from './PagesTools';
import { ServerPage, FilesPage, LogsPage, UpdatesPage } from './PagesSystem';
import { RoundsPage, VoicePage, ReportsPage } from './PagesExtra';
import { GuidePage } from './PagesGuide';
import { LivesPage, UsersPage, AccountPage } from './PagesUsers';

export const NAV = [
  { id: 'guide', label: 'ابدأ هنا', icon: 'check' },
  { id: 'overview', label: 'نظرة عامة', icon: 'overview', live: true },
  { id: 'connection', label: 'الاتصال بالبث', icon: 'plug', live: true },
  { id: 'teams', label: 'الفرق والهدف', icon: 'flag', draft: true, live: true },
  { id: 'scoring', label: 'الهدايا والنقاط', icon: 'gift', draft: true, live: true },
  { id: 'theme', label: 'المظهر', icon: 'palette', draft: true, live: true },
  { id: 'rounds', label: 'الجولات', icon: 'trophy', draft: true, live: true },
  { id: 'voice', label: 'القراءة الصوتية', icon: 'bolt', draft: true, live: true },
  { id: 'reports', label: 'تقارير البث', icon: 'logs', live: true },
  { id: 'tools', label: 'الأدوات', icon: 'tools', live: true },
  { sep: 'الحساب' },
  { id: 'lives', label: 'البثوث', icon: 'eye' },
  { id: 'users', label: 'المستخدمون', icon: 'users', owner: true },
  { id: 'account', label: 'حسابي', icon: 'key' },
  { sep: 'النظام', owner: true },
  { id: 'server', label: 'الخادم والمفاتيح', icon: 'server', owner: true },
  { id: 'files', label: 'الملفات', icon: 'file', owner: true },
  { id: 'logs', label: 'السجلات', icon: 'logs', owner: true },
  { id: 'updates', label: 'التحديثات', icon: 'update', owner: true },
];
const LIVE_KEY = 'koydam.admin.live';

export default function AdminApp() {
  const [auth, setAuth] = useState({ checked: false, user: null, mustChange: false });
  const check = useCallback(async () => {
    try { const r = await api('/api/me'); setAuth({ checked: true, user: r.authed ? r.user : null, mustChange: r.mustChangePassword }); }
    catch { setAuth({ checked: true, user: null, mustChange: false }); }
  }, []);
  useEffect(() => {
    check();
    const onUnauth = () => setAuth((a) => ({ ...a, user: null }));
    window.addEventListener('koydam:unauthorized', onUnauth);
    return () => window.removeEventListener('koydam:unauthorized', onUnauth);
  }, [check]);

  if (!auth.checked) return <div className="admin-root a-center"><Logo className="a-boot-logo" /></div>;
  return (
    <NoticeProvider>
      {auth.user
        ? <Dashboard key={auth.user.id} me={auth.user} mustChange={auth.mustChange}
            onMe={(u) => setAuth((a) => ({ ...a, user: u, mustChange: u.mustChangePassword }))}
            onLogout={() => setAuth({ checked: true, user: null, mustChange: false })} />
        : <Login onLogin={(r) => { setAuth({ checked: true, user: r.user, mustChange: r.mustChangePassword }); }} />}
    </NoticeProvider>
  );
}

function Dashboard({ me, mustChange, onLogout, onMe }) {
  const live = useLive();
  const notice = useNotice();
  const owner = me.role === 'owner';
  const nav = useMemo(() => NAV.filter((n) => owner || !n.owner), [owner]);
  const [tab, setTab] = useState('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [myLives, setMyLives] = useState(null);
  const [current, setCurrent] = useState(null);

  // ---- Lives: load, pick (remembered), switch ----
  const reloadLives = useCallback(async () => {
    try { const r = await api('/api/lives'); setMyLives(r.lives); return r.lives; } catch (e) { notice(e.message, 'err'); return []; }
  }, [notice]);
  const switchLive = useCallback((slug) => {
    setApiLive(slug); setStoreLive(slug); setCurrent(slug);
    setDirty(false); setDraft(null);
    try { localStorage.setItem(LIVE_KEY, slug); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    reloadLives().then((list) => {
      let saved = null; try { saved = localStorage.getItem(LIVE_KEY); } catch { /* ignore */ }
      const pick = list.find((l) => l.slug === saved) || list.find((l) => l.slug === 'main') || list[0];
      if (pick) switchLive(pick.slug); else setCurrent('');
      reconnectSocket();
    });
  }, [reloadLives, switchLive]);

  // Hash routing (#teams, #files ...)
  useEffect(() => {
    const read = () => { const h = location.hash.slice(1); if (nav.some((n) => n.id === h)) setTab(h); };
    read();
    if (mustChange && !location.hash) location.hash = 'account';
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [mustChange, nav]);

  // Draft follows the server config until something is edited.
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
  const onSwitch = (slug) => { if (dirty && !confirm('لديك تغييرات غير محفوظة. تجاهلها والانتقال؟')) return; switchLive(slug); notice('تم الانتقال إلى البث'); };

  const st = live.status || {};
  const connLabel = !live.connected ? ['err', 'الخادم غير متصل']
    : st.demo ? ['demo', 'وضع تجريبي']
    : st.state === 'connected' ? ['ok', `متصل @${st.username}`]
    : st.state === 'connecting' || st.state === 'reconnecting' ? ['warn', 'جارٍ الاتصال…']
    : st.state === 'offline' ? ['warn', 'البث متوقف']
    : ['idle', 'غير متصل بتيك توك'];
  const navItem = nav.find((n) => n.id === tab) || nav[0];
  const props = { live, draft, edit, save, dirty, notice, go, me, currentLive: current, onSwitch, reloadLives, myLives };
  const q = liveQuery(current);
  const noLives = myLives && myLives.length === 0;

  const page = useMemo(() => {
    // Pages that don't need a live
    if (tab === 'lives') return <LivesPage {...props} />;
    if (tab === 'account') return <AccountPage {...props} mustChange={mustChange} onLogout={logout} onUpdated={onMe} />;
    if (tab === 'users' && owner) return <UsersPage {...props} />;
    if (owner && tab === 'server') return <ServerPage {...props} onLogout={logout} />;
    if (owner && tab === 'files') return <FilesPage {...props} />;
    if (owner && tab === 'logs') return <LogsPage {...props} />;
    if (owner && tab === 'updates') return <UpdatesPage {...props} />;
    if (noLives) {
      return (
        <div className="a-empty a-nolive">
          <h3>لا يوجد لديك بث بعد</h3>
          <p>أنشئ أول بث لتبدأ: كل بث له فرقه وهداياه ومظهره وروابطه الخاصة.</p>
          <Btn variant="gold" icon="plus" onClick={() => go('lives')}>إنشاء بث</Btn>
        </div>
      );
    }
    if (!live.config || !draft) return <div className="a-center a-muted"><span className="spin" /> جارٍ التحميل…</div>;
    switch (tab) {
      case 'connection': return <Connection {...props} />;
      case 'teams': return <Teams {...props} />;
      case 'scoring': return <Scoring {...props} />;
      case 'theme': return <Theme {...props} />;
      case 'tools': return <Tools {...props} />;
      case 'rounds': return <RoundsPage {...props} />;
      case 'voice': return <VoicePage {...props} />;
      case 'reports': return <ReportsPage key={current} {...props} />;
      case 'guide': return <GuidePage {...props} />;
      default: return <Overview {...props} />;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, live, draft, dirty, mustChange, myLives, current, me]);

  const currentName = myLives?.find((l) => l.slug === current)?.name;
  return (
    <div className={`admin-root${menuOpen ? ' menu-open' : ''}`}>
      <aside className="a-side">
        <div className="a-brand">
          <Logo small className="a-brand-logo" />
          <div><b>تحدي المليون</b><span>{owner ? 'لوحة المدير' : 'لوحة التحكم'}</span></div>
        </div>
        {myLives && myLives.length > 0 && (
          <div className="a-live-switch">
            <span className="a-label">البث الحالي</span>
            <select className="a-input" value={current || ''} onChange={(e) => (e.target.value === '__new' ? go('lives') : onSwitch(e.target.value))}>
              {myLives.map((l) => <option key={l.slug} value={l.slug}>{l.name}{owner && l.ownerEmail && l.ownerId !== me.id ? ` · ${l.ownerName}` : ''}</option>)}
              <option value="__new">＋ إدارة البثوث…</option>
            </select>
          </div>
        )}
        <nav className="a-nav">
          {nav.map((n, i) => n.sep
            ? <div key={i} className="a-nav-sep">{n.sep}</div>
            : (
              <button key={n.id} className={`a-nav-item${tab === n.id ? ' active' : ''}${n.live && noLives ? ' off' : ''}`} onClick={() => go(n.id)}>
                <Icon name={n.icon} /><span>{n.label}</span>
                {n.draft && dirty && <i className="a-dot" title="تغييرات غير محفوظة" />}
              </button>
            ))}
        </nav>
        <div className="a-side-foot">
          <a className="a-btn ghost sm" href={`/${q}`} target="_blank" rel="noopener"><Icon name="eye" size={15} /><span>الصفحة المباشرة</span></a>
          <span className="a-muted num-latin">v{live.version}</span>
        </div>
      </aside>
      <div className="a-scrim" onClick={() => setMenuOpen(false)} />

      <div className="a-main">
        <header className="a-top">
          <button className="a-icon-btn a-menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="القائمة"><Icon name="menu" /></button>
          <h1>{navItem.label}</h1>
          {navItem.live && currentName && <span className="a-chip hide-sm">{currentName}</span>}
          {navItem.live && <span className={`a-status ${connLabel[0]}`}><span className="a-status-dot" />{connLabel[1]}</span>}
          <span className="a-top-spacer" />
          {current && <a className="a-btn ghost sm hide-sm" href={`/overlay/${q}`} target="_blank" rel="noopener"><Icon name="external" size={15} /><span>واجهة OBS</span></a>}
          <div className="a-user">
            <button className="a-avatar" onClick={() => go('account')} title={me.email}>{(me.name || me.email || 'A')[0].toUpperCase()}</button>
            <span className="hide-sm"><b className="a-user-name">{me.name}</b><small className="a-muted num-latin">{me.email}</small></span>
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
