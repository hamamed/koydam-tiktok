'use client';
/** Small UI kit for the admin dashboard: icons, form fields, sections, notices. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

const P = {
  overview: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  plug: 'M7 2v6H5v4a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12V8h-2V2h-2v6H9V2H7z',
  flag: 'M5 21V4h9l.4 2H20v10h-7l-.4-2H7v7H5z',
  gift: 'M20 7h-2.18A3 3 0 0 0 12 3.76 3 3 0 0 0 6.18 7H4a1 1 0 0 0-1 1v4h1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8h1V8a1 1 0 0 0-1-1zM15 5a1 1 0 1 1 0 2h-2a1 1 0 0 1 2-2zM9 5a1 1 0 0 1 1 1v1H9a1 1 0 0 1 0-2zM5 9h6v3H5V9zm1 5h5v6H6v-6zm7 6v-6h5v6h-5zm6-8h-6V9h6v3z',
  palette: 'M12 3a9 9 0 0 0 0 18 1.5 1.5 0 0 0 1.1-2.5 1.5 1.5 0 0 1 1.1-2.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  tools: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  server: 'M4 3h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 10h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm3-7a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z',
  logs: 'M4 5h16v2H4V5zm0 4h10v2H4V9zm0 4h16v2H4v-2zm0 4h10v2H4v-2z',
  update: 'M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6 6 6 0 0 1-.7 2.8l1.5 1.5A8 8 0 0 0 20 12a8 8 0 0 0-8-8zm-6 8c0-1 .3-2 .7-2.8L5.2 7.7A8 8 0 0 0 4 12a8 8 0 0 0 8 8v3l4-4-4-4v3a6 6 0 0 1-6-6z',
  logout: 'M16 17v-3H9v-4h7V7l5 5-5 5zM14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9z',
  external: 'M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h5v2H5v12h12v-5h2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z',
  play: 'M8 5v14l11-7L8 5z',
  stop: 'M6 6h12v12H6z',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  save: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  up: 'M7 14l5-5 5 5H7z', down: 'M7 10l5 5 5-5H7z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  close: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4z',
  eye: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  build: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  users: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
  trophy: 'M19 4h-2V2H7v2H5a2 2 0 0 0-2 2v1a5 5 0 0 0 4.4 5A5 5 0 0 0 11 15v3H7v2h10v-2h-4v-3a5 5 0 0 0 3.6-3A5 5 0 0 0 21 7V6a2 2 0 0 0-2-2zM5 7V6h2v4a3 3 0 0 1-2-3zm14 0a3 3 0 0 1-2 3V6h2v1z',
  bolt: 'M11 21h-1l1-7H7.5c-.6 0-.6-.3-.4-.6L13 3h1l-1 7h3.5c.5 0 .6.3.4.6L11 21z',
  key: 'M12.6 10A6 6 0 1 0 7 18a6 6 0 0 0 5.6-4H17v4h4v-4h2v-4H12.6zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
};
export function Icon({ name, size = 18, className }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={P[name] || P.overview} /></svg>;
}

export function Section({ title, desc, actions, children, className = '' }) {
  return (
    <section className={`a-card ${className}`}>
      {(title || actions) && (
        <div className="a-card-head">
          <div>{title && <h3>{title}</h3>}{desc && <p className="a-muted">{desc}</p>}</div>
          {actions && <div className="a-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({ children, icon, variant = '', size = '', busy, ...rest }) {
  return (
    <button type="button" className={`a-btn ${variant} ${size}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spin" /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Field({ label, hint, children, wide }) {
  return <label className={`a-field${wide ? ' wide' : ''}`}><span className="a-label">{label}</span>{children}{hint && <small className="a-hint">{hint}</small>}</label>;
}
export function Text({ value, onChange, ...rest }) {
  return <input type="text" className="a-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
export function Num({ value, onChange, ...rest }) {
  return <input type="number" className="a-input num-latin" value={value ?? 0} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} {...rest} />;
}
export function Color({ value, onChange }) {
  const v = String(value || '#000000');
  const full = v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v.slice(0, 7);
  return (
    <div className="a-color">
      <input type="color" value={full} onChange={(e) => onChange(e.target.value)} />
      <input type="text" className="a-input num-latin" value={v} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
export function Select({ value, onChange, options }) {
  return <select className="a-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="a-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span className="a-switch" /><span>{label}</span>
    </label>
  );
}
export function Range({ value, onChange, min, max, step, suffix = '' }) {
  return (
    <div className="a-range">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="num-latin">{value}{suffix}</span>
    </div>
  );
}

export function CopyField({ value }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="a-copy">
      <code className="num-latin">{value}</code>
      <Btn size="sm" icon={ok ? 'check' : 'copy'} onClick={() => { navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}>{ok ? 'تم النسخ' : 'نسخ'}</Btn>
    </div>
  );
}

/* ---- Notices (bottom toasts for the admin) ---- */
const NoticeCtx = createContext(() => {});
export const useNotice = () => useContext(NoticeCtx);
export function NoticeProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setList((l) => [...l.slice(-3), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((n) => n.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  return (
    <NoticeCtx.Provider value={push}>
      {children}
      <div className="a-notices">{list.map((n) => <div key={n.id} className={`a-notice ${n.kind}`}><Icon name={n.kind === 'err' ? 'close' : 'check'} />{n.text}</div>)}</div>
    </NoticeCtx.Provider>
  );
}

/* ---- Background job progress (build / update) ---- */
export function useJobs(active) {
  const [jobs, setJobs] = useState({ current: null, last: null });
  const timer = useRef(null);
  const poll = useCallback(async () => {
    try { setJobs(await api('/api/jobs')); } catch { /* server restarting */ }
  }, []);
  useEffect(() => {
    poll();
    timer.current = setInterval(poll, active || jobs.current ? 1000 : 5000);
    return () => clearInterval(timer.current);
  }, [poll, active, Boolean(jobs.current)]);
  return [jobs, poll];
}

export function JobView({ job, title }) {
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [job?.output?.length]);
  if (!job) return null;
  const state = job.ok === null || job.ok === undefined ? 'run' : job.ok ? 'ok' : 'err';
  return (
    <div className={`a-job ${state}`}>
      <div className="a-job-head">
        {state === 'run' ? <span className="spin" /> : <Icon name={state === 'ok' ? 'check' : 'close'} />}
        <b>{title || job.name}</b>
        <span className="a-muted">{state === 'run' ? job.step : state === 'ok' ? 'اكتمل بنجاح' : job.error}</span>
      </div>
      <pre ref={box} className="a-job-out">{(job.output || []).join('\n')}</pre>
    </div>
  );
}
