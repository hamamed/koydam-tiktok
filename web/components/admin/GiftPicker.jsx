'use client';
import { Gem } from 'lucide-react';
/** Searchable grid of real TikTok gifts (image, name, diamond cost). */
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { GiftIcon } from '../bits';
import { Btn, Icon, useNotice } from './ui';

export function GiftGrid({ gifts, selected = [], onPick, max = 400 }) {
  const [q, setQ] = useState('');
  const sel = useMemo(() => new Set(selected.map((s) => String(s).toLowerCase())), [selected]);
  const shown = gifts.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()) || String(g.id) === q.trim()).slice(0, max);
  return (
    <div className="a-giftgrid-wrap">
      <input className="a-input" placeholder="ابحث عن هدية… (Rose, Lion…)" value={q} onChange={(e) => setQ(e.target.value)} />
      {gifts.length === 0 ? <p className="a-empty">قائمة الهدايا فارغة. اضغط «جلب قائمة الهدايا» في صفحة «الهدايا والنقاط».</p> : (
        <div className="a-giftgrid">
          {shown.map((g) => (
            <button key={g.id} type="button" className={`a-gift${sel.has(g.name.toLowerCase()) ? ' on' : ''}`} onClick={() => onPick(g)} title={`${g.name} · ${g.diamonds} ماسة · #${g.id}`}>
              <GiftIcon gift={g} className="a-gift-img" />
              <span className="a-gift-name num-latin">{g.name}</span>
              <small className="num-latin">{g.diamonds} <Gem className="lc-inline" /></small>
              {sel.has(g.name.toLowerCase()) && <i className="a-gift-check"><Icon name="check" size={12} /></i>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Modal wrapper around GiftGrid. */
export function GiftPickerModal({ open, title, gifts, selected, onPick, onClose, multi }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="a-modal-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="a-modal">
        <div className="a-card-head"><div><h3>{title}</h3><p className="a-muted">{multi ? 'اضغط على الهدايا لإضافتها أو إزالتها' : 'اختر هدية'}</p></div>
          <Btn variant="gold" icon="check" onClick={onClose}>تم</Btn></div>
        <GiftGrid gifts={gifts} selected={selected} onPick={(g) => { onPick(g); if (!multi) onClose(); }} />
      </div>
    </div>
  );
}

/** "Fetch the TikTok gift list" box: from the connected stream or any live account. */
export function GiftFetcher({ live }) {
  const notice = useNotice();
  const [user, setUser] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = live.status?.state === 'connected';
  const run = async () => {
    setBusy(true);
    try {
      const r = await api('/api/gifts/refresh', { method: 'POST', body: { username: user.trim() } });
      notice(`تم جلب ${r.count} هدية. الصور تُحفظ على الخادم خلال ثوانٍ.`);
    } catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  const withImg = live.gifts.filter((g) => g.image).length;
  return (
    <div className="a-fetcher">
      <div className="a-fetch-stats"><b className="num-latin">{live.gifts.length}</b><span>هدية</span><b className="num-latin">{withImg}</b><span>بصورة حقيقية</span></div>
      <div className="a-inline">
        <input className="a-input num-latin" dir="ltr" value={user} onChange={(e) => setUser(e.target.value)}
          placeholder={connected ? `(البث الحالي @${live.status.username})` : 'username لحساب يبث الآن'} />
        <Btn variant="gold" icon="update" busy={busy} onClick={run}>جلب قائمة الهدايا</Btn>
      </div>
      <small className="a-hint">تيك توك يعطي قائمة الهدايا لبث مباشر فقط. اتركه فارغاً لاستخدام بثك المتصل، أو اكتب اسم أي حساب يبث الآن. تُحفظ القائمة والصور على الخادم وتبقى بعد إعادة التشغيل.</small>
    </div>
  );
}
