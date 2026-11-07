import confetti from 'canvas-confetti';
import { tsParticles } from '@tsparticles/engine';
import { loadBasic } from '@tsparticles/basic';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const GOLD = ['#ffe6a8', '#e3b04b', '#c9862b', '#fff6d8', '#b3262e'];

/** Drifting embers / arcane motes above the map. Purely decorative. */
export async function startEmbers(id: string) {
  if (reduced()) return;
  await loadBasic(tsParticles);
  await tsParticles.load({
    id,
    options: {
      fullScreen: { enable: false },
      background: { color: { value: 'transparent' } },
      detectRetina: true,
      fpsLimit: 40,
      particles: {
        number: { value: 34, density: { enable: true } },
        paint: { fill: { enable: true, color: { value: ['#ffcf7a', '#ffb347', '#fff1c2', '#8fd3ff'] } } },
        shape: { type: 'circle' },
        opacity: { value: { min: 0.08, max: 0.55 }, animation: { enable: true, speed: 0.5, sync: false } },
        size: { value: { min: 0.6, max: 2.2 } },
        move: { enable: true, speed: { min: 0.15, max: 0.6 }, direction: 'top', random: true, straight: false, outModes: { default: 'out' } },
      },
    },
  });
}

export function celebrate(big = false) {
  if (reduced()) return;
  const base = { colors: GOLD, disableForReducedMotion: true, zIndex: 3000, scalar: 0.9 };
  if (!big) {
    void confetti({ ...base, particleCount: 70, spread: 70, startVelocity: 38, origin: { x: 0.5, y: 0.85 } });
    return;
  }
  const end = Date.now() + 1400;
  (function frame() {
    void confetti({ ...base, particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
    void confetti({ ...base, particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
