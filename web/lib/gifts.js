'use client';
/** Gift lookups by name (case-insensitive) from the server's gift catalog. */
import { useMemo } from 'react';

export function useGiftMap(gifts) {
  return useMemo(() => new Map((gifts || []).map((g) => [String(g.name).toLowerCase(), g])), [gifts]);
}
export const findGift = (map, name) => (map && name ? map.get(String(name).toLowerCase()) : null);

/**
 * 1-coin gifts: the only gifts used as a country's gift (cheap = everybody can send).
 * From the real catalog when it is loaded (diamonds === 1), else the well-known 1-coin gifts.
 */
export const ONE_COIN_FALLBACK = ['Rose', 'TikTok', 'GG', 'Ice Cream Cone', 'Heart Me'];
export function oneCoinGifts(gifts) {
  const seen = new Set(); const out = [];
  const list = (gifts || []).filter((g) => Number(g.diamonds) === 1 && g.name && !/^Gift #/.test(g.name));
  // well-known ones first, then the rest of the catalog's 1-coin gifts
  const order = (g) => { const i = ONE_COIN_FALLBACK.findIndex((n) => n.toLowerCase() === g.name.toLowerCase()); return i < 0 ? 99 : i; };
  for (const g of [...list].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))) {
    const k = g.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(g.name);
  }
  return out.length ? out : ONE_COIN_FALLBACK;
}
