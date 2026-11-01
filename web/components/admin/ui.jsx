'use client';
/** Small UI kit for the admin dashboard: icons, form fields, sections, notices. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { NAMED, iconize, stripEmoji } from './icons';

/** Lucide icon by name (see NAMED in ./icons). */
export function Icon({ name, size = 18, className }) {
  const C = NAMED[name] || NAMED.overview;
  return <C className={className} width={size} height={size} strokeWidth={2.1} aria-hidden="true" />;
}

export function Section({ title, desc, actions, children, className = '' }) {
  return (
    <section className={`a-card ${className}`}>
      {(title || actions) && (
        <div className="a-card-head">
          <div>{title && <h3>{iconize(title)}</h3>}{desc && <p className="a-muted">{iconize(desc)}</p>}</div>
          {actions && <div className="a-actions">{iconize(actions)}</div>}
        </div>
      )}
      {iconize(children)}
    </section>
  );
}

export function Btn({ children, icon, variant = '', size = '', busy, ...rest }) {
  return (
    <button type="button" className={`a-btn ${variant} ${size}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spin" /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children && <span>{iconize(children)}</span>}
    </button>
  );
}

export function Field({ label, hint, children, wide }) {
  return <label className={`a-field${wide ? ' wide' : ''}`}><span className="a-label">{iconize(label)}</span>{children}{hint && <small className="a-hint">{iconize(hint)}</small>}</label>;
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
  return <select className="a-input" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{stripEmoji(l)}</option>)}</select>;
}
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="a-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span className="a-switch" /><span>{iconize(label)}</span>
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
