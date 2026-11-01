'use client';
/**
 * Plays the server's voice messages (Arabic TTS) one after another.
 * Server audio (<audio>) is captured by OBS when "Control audio via OBS" is on.
 * Without audio (browser engine / fallback) it uses the browser's speech.
 */
import { useEffect } from 'react';
import { onSpeak } from '@/lib/store';

export default function Speaker({ enabled = true }) {
  useEffect(() => {
    if (!enabled) return undefined;
    const queue = [];
    let busy = false;
    const next = () => {
      if (busy || !queue.length) return;
      const m = queue.shift();
      busy = true;
      const done = () => { busy = false; setTimeout(next, 250); };
      if (m.url) {
        const a = new Audio(m.url);
        a.volume = Math.max(0, Math.min(1, m.volume ?? 1));
        a.onended = done; a.onerror = done;
        a.play().catch(done);
        setTimeout(() => { if (busy && !a.ended) { a.pause(); done(); } }, 20000);
      } else if (typeof speechSynthesis !== 'undefined' && m.text) {
        const u = new SpeechSynthesisUtterance(m.text);
        u.lang = 'ar-SA'; u.volume = m.volume ?? 1;
        const ar = speechSynthesis.getVoices().find((v) => /^ar/i.test(v.lang));
        if (ar) u.voice = ar;
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(() => { if (busy) done(); }, 15000);
      } else done();
    };
    return onSpeak((m) => {
      if (queue.length >= 5) queue.shift(); // never fall far behind the stream
      queue.push(m);
      next();
    });
  }, [enabled]);
  return null;
}
