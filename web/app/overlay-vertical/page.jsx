'use client';
/** OBS / TikTok LIVE Studio browser source (vertical): https://tiktok.koydam.com/overlay-vertical  (1080x1920). */
import Overlay from '@/components/Overlay';
import { useLive } from '@/lib/store';

export default function OverlayVerticalPage() {
  const live = useLive();
  if (!live.config) return null;
  return (
    <>
      <Overlay config={live.config} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} game={live.game} acts={live.acts} orientation="portrait" speak />
      {!live.connected && <div className="offline-pill">الخادم غير متصل، جارٍ إعادة الاتصال…</div>}
    </>
  );
}
