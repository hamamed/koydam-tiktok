'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Logo } from '../bits';
import { Icon } from './ui';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onLogin(await api('/api/login', { method: 'POST', body: { email, password } })); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="admin-root a-login">
      <div className="a-login-glow" />
      <form className="a-login-card" onSubmit={submit}>
        <Logo className="a-login-logo" />
        <h1>لوحة تحكم تحدي المليون</h1>
        <p className="a-muted">سجّل الدخول لإدارة البث والفرق والإعدادات</p>
        <label className="a-field"><span className="a-label">البريد الإلكتروني</span>
          <input className="a-input num-latin" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@koydam.com" />
        </label>
        <label className="a-field"><span className="a-label">كلمة المرور</span>
          <input className="a-input num-latin" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="a-alert err"><Icon name="close" size={16} />{err}</div>}
        <button className="a-btn gold lg" type="submit" disabled={busy}>{busy ? <span className="spin" /> : <Icon name="key" />}<span>دخول</span></button>
        <a className="a-login-foot" href="/">← العودة إلى الصفحة المباشرة</a>
      </form>
    </div>
  );
}
