'use client';
/** REST helper for the admin API (session cookie). Throws Error with .data and .status. */
export async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || `${r.status} ${r.statusText}`);
    err.data = j; err.status = r.status;
    if (r.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('koydam:unauthorized'));
    throw err;
  }
  return j;
}
