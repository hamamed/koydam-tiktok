'use client';
/** Public live page for viewers: https://tiktok.koydam.com */
import LiveView from '@/components/LiveView';
import { useLive } from '@/lib/store';

export default function LivePage() {
  const live = useLive();
  return <LiveView config={live.config} state={live.state} byId={live.byId} status={live.status} gifts={live.gifts} connected={live.connected} />;
}
