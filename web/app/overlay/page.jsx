'use client';
/**
 * OBS browser source: https://tiktok.koydam.com/overlay
 * 1920x1080 = landscape design. A source taller than wide (e.g. 1080x1920 in TikTok LIVE Studio)
 * automatically gets the vertical design, same as /overlay-vertical.
 */
import { useEffect, useState } from 'react';
import Overlay from '@/components/Overlay';
import { useLive } from '@/lib/store';

const isTall = () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth * 1.15;

export default function OverlayPage() {
  const live = useLive();
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const on = () => setTall(isTall());
    on(); window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  if (!live.config) return null;
  return (
    <>
      <Overlay config={live.config} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} game={live.game} acts={live.acts} orientation={tall ? 'portrait' : 'landscape'} speak />
      {!live.connected && <div className="offline-pill">الخادم غير متصل، جارٍ إعادة الاتصال…</div>}
    </>
  );
}
