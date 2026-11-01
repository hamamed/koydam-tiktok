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
let snap = { config: null, state: null, byId: new Map(), status: {}, gifts: [], connected: false, isAdmin: false, version: '', everConnected: false, round: null };

/** Round with endsAt converted to this device's clock (server and device clocks can differ). */
const localRound = (r) => (r ? { ...r, offset: (r.serverNow || Date.now()) - Date.now(), endsAtLocal: r.endsAt ? r.endsAt - ((r.serverNow || Date.now()) - Date.now()) : 0, celebrateUntilLocal: r.celebrateUntil ? r.celebrateUntil - ((r.serverNow || Date.now()) - Date.now()) : 0 } : null);
let ws = null;
let retry = 0;
let reqSeq = 0;
let started = false;

function set(patch) {
  snap = { ...snap, ...patch };
  for (const l of listeners) l();
}

function wsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  if (q) return q;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

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
          connected: true, everConnected: true, round: localRound(m.round),
        });
        break;
      case 'state': set({ state: m.state, byId: new Map(m.state.teams.map((t) => [t.id, t])) }); break;
      case 'config': set({ config: m.config }); break;
      case 'status': set({ status: m.status || {} }); break;
      case 'catalog': set({ gifts: m.gifts || [] }); break;
      case 'round': set({ round: localRound(m.round) }); break;
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
  if (ws) ws.close(); else connect();
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
