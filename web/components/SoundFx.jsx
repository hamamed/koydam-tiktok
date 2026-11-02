'use client';
/** Plays the sound effects for live events (OBS overlay only), following config.sounds. */
import { useEffect, useRef } from 'react';
import { onLiveEvent } from '@/lib/store';
import { playSfx } from '@/lib/sfx';

const GAME_SFX = {
  goal: ['games', 'goal'], kickoff: ['games', 'whistle'], fulltime: ['games', 'whistle'], tugStart: ['games', 'whistle'], raceStart: ['games', 'whistle'],
  castleStart: ['games', 'whistle'], arenaStart: ['games', 'whistle'], ko: ['games', 'hit'], revive: ['games', 'success'],
  champion: ['games', 'fanfare'], arenaWinner: ['games', 'fanfare'], raceWinner: ['games', 'fanfare'], castleWinner: ['games', 'fanfare'], tugWin: ['games', 'fanfare'],
  boost: ['extras', 'sweep'], quiz: ['extras', 'ding'], quizWin: ['extras', 'success'], throne: ['extras', 'chime'], playlistNext: ['extras', 'whistle'],
};

export default function SoundFx({ config }) {
  const cfg = useRef(config); cfg.current = config;
  const last = useRef(0);
  useEffect(() => onLiveEvent((ev) => {
    const s = cfg.current?.sounds; if (!s?.enabled) return;
    let pick = null;
    if (ev.kind === 'gift') {
      if (ev.major && s.bigGifts) pick = 'chime';
      else if (s.gifts) { const now = Date.now(); if (now - last.current < 150) return; last.current = now; pick = 'coin'; }
    } else if (ev.kind === 'takeover' && s.lead && (cfg.current?.game?.mode || 'race') === 'race') pick = 'drum';
    else if (ev.kind === 'roundEnd' && s.games) pick = 'fanfare';
    else if (ev.kind === 'follow' && s.extras) pick = 'ding';
    else if (ev.kind === 'game' && GAME_SFX[ev.type]) { const [k, n] = GAME_SFX[ev.type]; if (s[k]) pick = n; }
    if (pick) playSfx(pick, s.volume);
  }), []);
  return null;
}
