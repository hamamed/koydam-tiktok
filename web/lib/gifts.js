'use client';
/** Gift lookups by name (case-insensitive) from the server's gift catalog. */
import { useMemo } from 'react';

export function useGiftMap(gifts) {
  return useMemo(() => new Map((gifts || []).map((g) => [String(g.name).toLowerCase(), g])), [gifts]);
}
export const findGift = (map, name) => (map && name ? map.get(String(name).toLowerCase()) : null);
