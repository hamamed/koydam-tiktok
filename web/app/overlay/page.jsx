'use client';
/** OBS browser source (landscape): https://tiktok.koydam.com/overlay  (1920x1080, transparent). */
import Overlay from '@/components/Overlay';
import { useLive } from '@/lib/store';

export default function OverlayPage() {
  const live = useLive();
  if (!live.config) return null;
  return (
    <>
      <Overlay config={live.config} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} round={live.round} speak />
      {!live.connected && <div className="offline-pill">الخادم غير متصل، جارٍ إعادة الاتصال…</div>}
    </>
  );
}
