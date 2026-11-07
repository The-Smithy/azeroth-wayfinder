// Procedural sound effects via ZzFX – no audio files needed. The library creates an
// AudioContext on import, so it is loaded lazily on the first user gesture.
type ZzfxFn = (...params: (number | undefined)[]) => unknown;
let zzfx: ZzfxFn | null = null;
let loading: Promise<void> | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) { enabled = on; }

export function unlockAudio() {
  loading ??= import('zzfx').then(mod => {
    mod.ZZFX.volume = 0.22;
    zzfx = mod.zzfx as ZzfxFn;
    const ctx = mod.ZZFX.audioContext as AudioContext;
    if (ctx.state === 'suspended') void ctx.resume();
  }).catch(() => { /* audio unavailable – stay silent */ });
  return loading;
}

const presets = {
  // [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo]
  drop: [1.1, 0.05, 160, 0, 0.02, 0.12, 0, 2.2, -8, 0, 0, 0, 0, 0.4],
  click: [0.6, 0.05, 520, 0, 0.01, 0.04, 1, 1.5],
  whoosh: [0.5, 0.1, 300, 0.05, 0.08, 0.25, 4, 0, 12, 0, 0, 0, 0, 0.9],
  chime: [0.9, 0, 880, 0.01, 0.1, 0.5, 0, 1.6, 0, 0, 440, 0.08],
  good: [0.8, 0, 660, 0.01, 0.06, 0.35, 0, 1.4, 0, 0, 220, 0.07],
  meh: [0.7, 0, 330, 0.01, 0.05, 0.3, 2, 1, -4],
  bad: [0.7, 0.05, 140, 0.02, 0.1, 0.35, 3, 1, -6, 0, 0, 0, 0, 0.3],
  hint: [0.6, 0, 1200, 0.02, 0.05, 0.4, 0, 2, 0, 0, -300, 0.05, 0, 0, 0, 0, 0.15],
} satisfies Record<string, (number | undefined)[]>;

export type SoundName = keyof typeof presets | 'fanfare';

export function play(name: SoundName) {
  if (!enabled) return;
  void unlockAudio().then(() => {
    if (!zzfx) return;
    if (name === 'fanfare') {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => zzfx?.(0.7, 0, f, 0.01, 0.12, 0.4, 0, 1.6), i * 130));
      return;
    }
    zzfx(...presets[name]);
  });
}

export const soundForScore = (score: number): SoundName => (score >= 900 ? 'chime' : score >= 500 ? 'good' : score >= 200 ? 'meh' : 'bad');
