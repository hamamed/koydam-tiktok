'use client';
import { CalendarClock, Trophy } from 'lucide-react';
/**
 * «فيديو ترويجي»: the server records this live's own overlay (teams, look, logo, gift pictures)
 * during a scripted race to 1,000,000 and offers the MP4 for download.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getStoreLive } from '@/lib/store';
import { Flag } from '../bits';
import Teaser from '../Teaser';
import { Btn, Field, Icon, Section, Select } from './ui';

const fileUrl = (id, dl) => `/api/promo/file?id=${encodeURIComponent(id)}&live=${encodeURIComponent(getStoreLive())}${dl ? '&download=1' : ''}`;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

export function VideoPage({ live, notice }) {
  const teams = live.config?.teams || [];
  const [info, setInfo] = useState(null);
  const [opt, setOpt] = useState({ kind: 'teaser', orientation: 'vertical', winner: '', rival: '', when: '9:00 مساءً', headline: 'الليلة', handle: live.status?.username || '', cta: '' });
  const [busy, setBusy] = useState(false);
  const [play, setPlay] = useState(null);

  const load = useCallback(async (check) => {
    try { setInfo(await api(`/api/promo${check ? '?check=1' : ''}`)); } catch (e) { notice(e.message, 'err'); }
  }, [notice]);
  useEffect(() => { load(); }, [load]);
  const running = info?.job && info.job.ok === null;
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => load(), 1500);
    return () => clearInterval(t);
  }, [running, load]);
  useEffect(() => {
    if (info?.job?.ok === true && info.videos?.[0] && !play) setPlay(info.videos[0].id);
  }, [info]); // eslint-disable-line react-hooks/exhaustive-deps

  const winner = opt.winner || teams[0]?.id || '';
  const rival = opt.rival && opt.rival !== winner ? opt.rival : teams.find((t) => t.id !== winner)?.id || '';
  const make = async () => {
    setBusy(true);
    try { await api('/api/promo', { method: 'POST', body: { ...opt, winner, rival } }); setPlay(null); await load(); }
    catch (e) { notice(e.message, 'err'); } finally { setBusy(false); }
  };
  const del = async (id) => {
    if (!confirm('حذف هذا الفيديو؟')) return;
    try { await api(`/api/promo?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); if (play === id) setPlay(null); load(); } catch (e) { notice(e.message, 'err'); }
  };

  if (!info) return <div className="a-center"><span className="spin" /></div>;
  const tools = info.tools || {};
  const teamOpts = teams.map((t) => [t.id, t.name]);
  const job = info.job;

  return (
    <div className="a-grid">
      <Section title="🎬 فيديوهات ترويجية" className="span-2"
        desc="فيديوهات جاهزة للنشر على تيك توك وإنستغرام بنفس تصميم بثك: إعلان «الليلة» يعرّف الجمهور بالدول وهداياها ووقت البث، أو سباق تمثيلي حتى المليون (بأسماء وهمية) ينتهي بشاشة الفائز.">
        {!tools.ready ? (
          <div className="a-alert warn">
            <Icon name="tools" />
            <div>
              <b>أدوات الفيديو غير مثبتة على الخادم بعد.</b> يحتاج المدير لتشغيل هذا الأمر مرة واحدة على الخادم (حوالي 3 دقائق):
              <pre className="a-cmd" dir="ltr">sudo bash /opt/koydam-tiktok/deploy/install-video.sh</pre>
              <span className="a-muted">ناقص: {[!tools.ffmpeg && 'ffmpeg', !tools.chromium && 'Chromium', !tools.playwright && 'playwright-core'].filter(Boolean).join('، ')}</span>
              <div className="a-row" style={{ marginTop: 8 }}><Btn size="sm" variant="ghost" icon="update" onClick={() => load(true)}>إعادة الفحص</Btn></div>
            </div>
          </div>
        ) : teams.length < 2 ? (
          <div className="a-alert warn"><Icon name="flag" />أضف فريقين على الأقل من صفحة «الفرق والهدف» واحفظ.</div>
        ) : (
          <>
            <div className="a-seg a-vid-kind">
              <button className={opt.kind === 'teaser' ? 'on' : ''} onClick={() => setOpt({ ...opt, kind: 'teaser' })}><CalendarClock className="lc-inline" /> إعلان «الليلة»</button>
              <button className={opt.kind === 'race' ? 'on' : ''} onClick={() => setOpt({ ...opt, kind: 'race' })}><Trophy className="lc-inline" /> سباق حتى المليون</button>
            </div>
            <div className="a-form">
              <Field label="الشكل">
                <div className="a-seg">
                  <button className={opt.orientation === 'vertical' ? 'on' : ''} onClick={() => setOpt({ ...opt, orientation: 'vertical' })}>📱 عمودي <bdi dir="ltr" className="num-latin">1080×1920</bdi> (تيك توك)</button>
                  <button className={opt.orientation === 'landscape' ? 'on' : ''} onClick={() => setOpt({ ...opt, orientation: 'landscape' })}>🖥️ أفقي <bdi dir="ltr" className="num-latin">1920×1080</bdi></button>
                </div>
              </Field>
              {opt.kind === 'race' ? <>
                <Field label="الفائز بالمليون"><Select value={winner} onChange={(v) => setOpt({ ...opt, winner: v })} options={teamOpts} /></Field>
                <Field label="المنافس الأقوى" hint="يتصدّر مرتين قبل أن يحسم الفائز"><Select value={rival} onChange={(v) => setOpt({ ...opt, rival: v })} options={teamOpts.filter(([id]) => id !== winner)} /></Field>
              </> : <>
                <Field label="العنوان الكبير" hint="مثل: الليلة، غداً، الجمعة"><input className="a-input" value={opt.headline} maxLength={30} onChange={(e) => setOpt({ ...opt, headline: e.target.value })} /></Field>
                <Field label="الوقت"><input className="a-input" value={opt.when} maxLength={40} onChange={(e) => setOpt({ ...opt, when: e.target.value })} placeholder="9:00 مساءً بتوقيت مكة" /></Field>
                <Field label="حسابك في تيك توك (اختياري)"><input className="a-input num-latin" dir="ltr" value={opt.handle} maxLength={40} onChange={(e) => setOpt({ ...opt, handle: e.target.value.replace(/^@/, '') })} placeholder="username" /></Field>
                <Field label="الجملة الأخيرة (اختياري)" hint="فارغ = «كن جاهزاً! اكتب اسم دولتك في الشات وأرسل هديته»"><input className="a-input" value={opt.cta} maxLength={120} onChange={(e) => setOpt({ ...opt, cta: e.target.value })} /></Field>
              </>}
            </div>
            {opt.kind === 'teaser' && (
              <div className={`a-tz-prev ${opt.orientation}`}>
                <div className="a-tz-stage"><Teaser config={live.config} gifts={live.gifts} params={opt} preview portrait={opt.orientation !== 'landscape'} /></div>
              </div>
            )}
            {opt.kind === 'race' && <div className="a-vid-duel">
              {[winner, rival].map((id, i) => { const t = teams.find((x) => x.id === id); return t && (
                <span key={id} className="a-vid-team" style={{ '--team': t.color }}><span className="a-vid-flag"><Flag team={t} /></span><b>{t.name}</b>{i === 0 && <Trophy className="lc-inline a-gold" />}</span>
              ); })}
            </div>}
            <p className="a-muted">يستخدم الإعدادات المحفوظة لهذا البث: الفرق والشكل والخطوط والشعار وصور الهدايا (احفظ تعديلاتك أولاً). {opt.kind === 'teaser' ? 'مدة الإعلان حوالي 15 ثانية.' : 'مدة الفيديو حوالي 40 ثانية.'} الصنع يستغرق أقل من دقيقة.</p>
            <div className="a-row">
              <Btn variant="gold" icon="bolt" busy={busy || running} disabled={running || info.busy} onClick={make}>{running ? 'جارٍ الصنع…' : 'اصنع الفيديو'}</Btn>
              {info.busy && <span className="a-muted">الخادم يصنع فيديو لبث آخر الآن…</span>}
            </div>
          </>
        )}
        {job && (job.ok === null || job.ok === false) && (
          <div className={`a-vid-job${job.ok === false ? ' err' : ''}`}>
            {job.ok === null ? (
              <>
                <div className="a-vid-bar"><span style={{ width: `${job.pct || 0}%` }} /></div>
                <span>{job.text} · <b className="num-latin">{job.pct || 0}%</b></span>
              </>
            ) : <span><Icon name="close" /> فشل صنع الفيديو: {job.error}</span>}
          </div>
        )}
      </Section>

      <Section title={`📁 الفيديوهات (${info.videos.length})`} className="span-2" desc="يُحفظ آخر 6 فيديوهات لكل بث.">
        {!info.videos.length ? <p className="a-empty">لا توجد فيديوهات بعد.</p> : (
          <div className="a-videos">
            {info.videos.map((v) => (
              <div key={v.id} className={`a-video ${v.orientation}`}>
                {play === v.id
                  ? <video src={fileUrl(v.id)} controls autoPlay playsInline />
                  : <button type="button" className="a-video-poster" onClick={() => setPlay(v.id)}><Icon name="eye" /> تشغيل</button>}
                <div className="a-video-meta">
                  {v.kind === 'teaser'
                    ? <b><CalendarClock className="lc-inline a-gold" /> إعلان {v.when ? `· ${v.when}` : ''}</b>
                    : <b><Trophy className="lc-inline a-gold" /> {v.winnerName}</b>}
                  <span className="a-muted">{v.orientation === 'landscape' ? 'أفقي' : 'عمودي'} · {v.seconds} ثانية · <bdi dir="ltr" className="num-latin">{mb(v.size)}</bdi> · <bdi>{new Date(v.createdAt).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' })}</bdi></span>
                </div>
                <div className="a-row">
                  <a className="a-btn gold sm" href={fileUrl(v.id, true)} download><Icon name="save" size={15} /><span>تحميل MP4</span></a>
                  <Btn size="sm" variant="ghost" icon="trash" onClick={() => del(v.id)}>حذف</Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
