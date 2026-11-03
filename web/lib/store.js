'use client';
/**
 * Live data store: one WebSocket per tab, shared by every component.
 *  - useLive()       -> { config, state, byId, status, gifts, connected, isAdmin, version }
 *  - onLiveEvent(cb) -> gift / join / takeover / reset events (for toasts, ticker, confetti)
 *  - cmd(action, p)  -> admin command over the socket, resolves on the server's ack
 * Reconnects with backoff; after a server restart everything refreshes from "hello".
 */
import { useSyncExternalStore } from 'react';

const listeners = new Set();
const eventListeners = new Set();
const speakListeners = new Set();
const pending = new Map();
let snap = { config: null, state: null, byId: new Map(), status: {}, gifts: [], connected: false, isAdmin: false, version: '', everConnected: false, round: null, game: null, acts: null, playlist: null };

/** Round with endsAt converted to this device's clock (server and device clocks can differ). */
/** Game state with server times turned into local times (endsAt / nextAt). */
const localGame = (g) => {
  if (!g) return null;
  const off = (g.serverNow || Date.now()) - Date.now();
  const out = { ...g };
  if (g.match) out.match = { ...g.match, endsAtLocal: g.match.endsAt - off };
  if (g.nextAt) out.nextAtLocal = g.nextAt - off;
  if (g.endsAt) out.endsAtLocal = g.endsAt - off;
  return out;
};
const localPlaylist = (p) => (p ? { ...p, endsAtLocal: p.endsAt - ((p.serverNow || Date.now()) - Date.now()) } : null);
/** Activities (golden minute, quiz, throne) with local times. */
const localActs = (a) => {
  if (!a) return null;
  const off = (a.serverNow || Date.now()) - Date.now();
  return {
    ...a,
    boost: a.boost && { ...a.boost, untilLocal: a.boost.until - off },
    quiz: a.quiz && { ...a.quiz, startedLocal: a.quiz.startedAt - off, endsAtLocal: a.quiz.endsAt - off },
  };
};
const localRound = (r) => (r ? { ...r, offset: (r.serverNow || Date.now()) - Date.now(), endsAtLocal: r.endsAt ? r.endsAt - ((r.serverNow || Date.now()) - Date.now()) : 0, celebrateUntilLocal: r.celebrateUntil ? r.celebrateUntil - ((r.serverNow || Date.now()) - Date.now()) : 0 } : null);
let ws = null;
let retry = 0;
let reqSeq = 0;
let started = false;

function set(patch) {
  snap = { ...snap, ...patch };
  for (const l of listeners) l();
}

let liveSlug = null; // admin: the selected live; public pages: ?live=<slug> (default "main")
const currentLive = () => liveSlug || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('live')) || 'main';

function wsUrl() {
  // ?ws= override (development only): same host only, so a link can never point the panel at another server.
  const q = new URLSearchParams(location.search).get('ws');
  if (q) { try { const u = new URL(q); if (/^wss?:$/.test(u.protocol) && u.hostname === location.hostname) return q; } catch { /* ignore */ } }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?live=${encodeURIComponent(currentLive())}`;
}

/** Admin: switch the live this tab is connected to (clears the old live's data first). */
export function setStoreLive(slug) {
  if (!slug || slug === liveSlug) return;
  liveSlug = slug;
  set({ config: null, state: null, byId: new Map(), status: {}, round: null, game: null, isAdmin: false });
  reconnectSocket();
}
export const getStoreLive = currentLive;

/** Query string for public links of a live ("" for the main live). */
export const liveQuery = (slug) => (slug && slug !== 'main' ? `?live=${encodeURIComponent(slug)}` : '');

function connect() {
  try { ws = new WebSocket(wsUrl()); } catch { return scheduleReconnect(); }
  const sock = ws;
  sock.onopen = () => { retry = 0; };
  sock.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    switch (m.type) {
      case 'hello':
        set({
          config: m.config, state: m.state, byId: new Map(m.state.teams.map((t) => [t.id, t])),
          status: m.status || {}, gifts: m.gifts || [], isAdmin: Boolean(m.isAdmin), version: m.version || '',
          connected: true, everConnected: true, round: localRound(m.round), game: localGame(m.game), acts: localActs(m.acts), playlist: localPlaylist(m.playlist),
        });
        break;
      case 'state': set({ state: m.state, byId: new Map(m.state.teams.map((t) => [t.id, t])) }); break;
      case 'config': set({ config: m.config }); break;
      case 'status': set({ status: m.status || {} }); break;
      case 'catalog': set({ gifts: m.gifts || [] }); break;
      case 'round': set({ round: localRound(m.round) }); break;
      case 'game': set({ game: localGame(m.game) }); break;
      case 'acts': set({ acts: localActs(m.acts) }); break;
      case 'playlist': set({ playlist: localPlaylist(m.playlist) }); break;
      case 'speak': for (const l of speakListeners) { try { l(m); } catch (err) { console.error(err); } } break;
      case 'event': for (const l of eventListeners) { try { l(m.event); } catch (err) { console.error(err); } } break;
      case 'ack': {
        const p = pending.get(m.reqId);
        if (p) { pending.delete(m.reqId); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || 'فشل الطلب')); }
        break;
      }
      default: break;
    }
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    set({ connected: false });
    for (const [, p] of pending) p.reject(new Error('انقطع الاتصال بالخادم'));
    pending.clear();
    scheduleReconnect();
  };
  sock.onerror = () => {};
}

function scheduleReconnect() {
  const delay = Math.min(10000, 500 * 2 ** retry++) * (0.8 + Math.random() * 0.4);
  setTimeout(connect, delay);
}

export function ensureSocket() {
  if (started || typeof window === 'undefined') return;
  started = true;
  connect();
}

/** Re-open the socket (e.g. after login, so it carries the session cookie). */
export function reconnectSocket() {
  retry = 0;
  const old = ws;
  if (!old) return connect();
  // Detach the old socket and open the new one right away. A socket that is still connecting is
  // closed only once it opens (closing it earlier logs "WebSocket is closed before the connection is established").
  old.onclose = null; old.onmessage = null; old.onerror = null;
  if (old.readyState === WebSocket.CONNECTING) old.onopen = () => old.close();
  else old.close();
  for (const [, p] of pending) p.reject(new Error('انقطع الاتصال بالخادم'));
  pending.clear();
  ws = null; set({ connected: false });
  connect();
}

export function cmd(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('غير متصل بالخادم'));
    const reqId = ++reqSeq;
    const timer = setTimeout(() => { pending.delete(reqId); reject(new Error('انتهت مهلة الطلب')); }, 15000);
    pending.set(reqId, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ type: 'cmd', action, payload, reqId }));
  });
}

export function onSpeak(cb) { speakListeners.add(cb); return () => speakListeners.delete(cb); }

export function onLiveEvent(cb) { eventListeners.add(cb); return () => eventListeners.delete(cb); }

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnap = () => snap;
const serverSnap = { ...snap };
export function useLive() {
  ensureSocket();
  return useSyncExternalStore(subscribe, getSnap, () => serverSnap);
}
