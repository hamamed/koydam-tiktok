'use client';
/** "Tonight" announcement page (recorded by the promo video tool): /teaser/?live=slug&when=…&handle=… */
import { useEffect, useState } from 'react';
import Teaser from '@/components/Teaser';
import { useLive } from '@/lib/store';

export default function TeaserPage() {
  const live = useLive();
  const [params, setParams] = useState(null);
  useEffect(() => { setParams(Object.fromEntries(new URLSearchParams(window.location.search))); }, []);
  if (!live.config || !params) return null;
  return <Teaser config={live.config} gifts={live.gifts} params={params} />;
}
