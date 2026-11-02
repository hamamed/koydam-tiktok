'use client';
/** Command search (Ctrl+K / ⌘K): jump to any page or switch the dashboard design. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Icon } from './ui';

export function useCommandK() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

export function CommandK({ open, onClose, items }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef(null);
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return items.filter((x) => !n || x.label.toLowerCase().includes(n) || (x.keys || '').toLowerCase().includes(n)).slice(0, 12);
  }, [q, items]);
  if (!open) return null;
  const run = (x) => { onClose(); x?.run(); };
  return (
    <div className="a-cmdk-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="a-cmdk" role="dialog" aria-label="بحث">
        <div className="a-cmdk-in"><Search size={18} />
          <input ref={input} value={q} placeholder="ابحث عن صفحة أو أمر…" onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === 'Enter') run(list[i]);
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="a-cmdk-list">
          {list.length ? list.map((x, j) => (
            <button key={x.id} type="button" className={`a-cmdk-item${j === i ? ' on' : ''}`} onMouseEnter={() => setI(j)} onClick={() => run(x)}>
              <span className="a-cmdk-ico"><Icon name={x.icon} size={16} /></span><span>{x.label}</span>{x.hint && <small>{x.hint}</small>}
            </button>
          )) : <p className="a-empty">لا نتائج</p>}
        </div>
      </div>
    </div>
  );
}
