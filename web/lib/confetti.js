'use client';
/** CSS confetti: transform/opacity only (smooth in OBS), capped particle count. */
const MAX = 450;
let count = 0;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function layer() {
  let fx = document.getElementById('fx-layer');
  if (!fx) { fx = document.createElement('div'); fx.id = 'fx-layer'; document.body.appendChild(fx); }
  return fx;
}
function particle(x, y, vars, color, shape, emoji) {
  if (count >= MAX || document.hidden) return;
  count++;
  const p = document.createElement('i');
  p.className = `cf ${shape}${emoji ? ' em' : ''}`;
  if (emoji) p.textContent = emoji; else p.style.background = color;
  p.style.left = `${x}px`; p.style.top = `${y}px`;
  for (const k in vars) p.style.setProperty(k, vars[k]);
  p.addEventListener('animationend', () => { p.remove(); count--; }, { once: true });
  layer().appendChild(p);
}
export function confettiBurst(x, y, colors, n = 90) {
  for (let i = 0; i < n; i++) {
    const ang = rand(0, Math.PI * 2); const power = rand(120, 420);
    particle(x, y, {
      '--anim': 'cf-burst', '--dx': `${Math.cos(ang) * power}px`, '--up': `${Math.sin(ang) * power * 0.5 - rand(80, 220)}px`,
      '--dy': `${rand(200, 520)}px`, '--rot': `${rand(-720, 720)}deg`, '--dur': `${rand(1300, 2200)}ms`, '--delay': `${rand(0, 120)}ms`,
    }, pick(colors), pick(['', 'circle', 'ribbon']));
  }
}
export function confettiRain(colors, n = 140, emoji) {
  for (let i = 0; i < n; i++) {
    particle(rand(0, innerWidth), -40, {
      '--anim': 'cf-rain', '--dx': `${rand(-160, 160)}px`, '--dy': `${innerHeight + 80}px`,
      '--rot': `${rand(-900, 900)}deg`, '--dur': `${rand(2400, 4200)}ms`, '--delay': `${rand(0, 1400)}ms`,
    }, pick(colors), pick(['', 'circle', 'ribbon']), emoji && i % 9 === 0 ? emoji : null);
  }
}
