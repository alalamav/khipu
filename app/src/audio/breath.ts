/**
 * Breath: what is heard where the archive has nothing, and on a cord that is wearing away.
 *
 * It is pink noise through a band-pass, coming up slowly and dying away over the time the cord
 * swings. No two cords breathe quite alike: each breath's band, its rise and its length are a
 * little different, drawn from the cord's seed, so that the same cord in the same state always
 * breathes the same way.
 *
 * Everything here is pure. The string voice renders a breath into its buffer (renderBreath); the
 * voices that play live build the same breath from audio nodes (Bus.breath), from the same noise,
 * the same band-pass and the same envelope.
 */

export interface Breath {
  level: number;
  /** Centre of the band, Hz. */
  centre: number;
  /** Seconds. */
  length: number;
  /** How narrow the band is. */
  q: number;
  /** Seconds it takes to come up. */
  attack: number;
  /** Where in the noise it begins, 0 to 1. Only the live voices use it: they share one stretch of noise. */
  offset: number;
}

/** The seed of what varies a cord's breath, from the seed of its sound. */
export function breathSeed(seed: number): number {
  return ((seed || 1) ^ 0x9e3779b9) >>> 0;
}

/** A breath of about this level, centre (Hz) and length (s), made this cord's own by `vary`. */
export function breathOf(level: number, centre: number, length: number, vary: () => number): Breath {
  const own = length * (0.85 + 0.15 * vary());
  return {
    level,
    centre: centre * (0.88 + 0.26 * vary()),
    length: own,
    q: 0.9 + 0.7 * vary(),
    attack: Math.min(0.15 + 0.15 * vary(), own * 0.3),
    offset: vary(),
  };
}

/** How loud a breath is `t` seconds in, 0 to 1: a slow rise, then a long fall that reaches nothing at its end. */
export function breathEnvelope(breath: Breath, t: number): number {
  if (t <= 0 || t >= breath.length) return 0;
  const rise = t < breath.attack ? Math.sin((Math.PI / 2) * (t / breath.attack)) : 1;
  const fall = 1 - t / breath.length;
  return rise * rise * fall * fall * fall;
}

/** The envelope as `points` values evenly spaced over the breath's length. */
export function breathCurve(breath: Breath, points = 128): number[] {
  return Array.from({ length: points }, (_, i) => breathEnvelope(breath, (breath.length * i) / (points - 1)));
}

/**
 * Turns white noise into pink, a sample at a time: equal energy in every octave, where white has
 * more the higher it goes. (Paul Kellet's three-pole approximation.)
 */
export function pinkFilter(): (white: number) => number {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  return (white) => {
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    // The scale is set by measurement: through its band-pass at 1000 Hz, a breath is then as loud for
    // its level as it was when it was made of white noise.
    return (b0 + b1 + b2 + white * 0.1848) * 0.25;
  };
}

/** `n` samples of pink noise. `random` gives numbers from 0 to 1. */
export function pinkNoise(n: number, random: () => number): Float32Array {
  const pink = pinkFilter();
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = pink(random() * 2 - 1);
  return out;
}

/** Add a breath to `out`, from its first sample. The band-pass is the one a Web Audio filter makes. */
export function renderBreath(breath: Breath, sr: number, random: () => number, out: Float32Array): void {
  const m = Math.min(out.length, Math.floor(breath.length * sr));
  const pink = pinkFilter();
  const w0 = (2 * Math.PI * Math.min(breath.centre, sr * 0.45)) / sr;
  const alpha = Math.sin(w0) / (2 * breath.q);
  const b0 = alpha / (1 + alpha);
  const a1 = (-2 * Math.cos(w0)) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let j = 0; j < m; j++) {
    const x = pink(random() * 2 - 1);
    const y = b0 * (x - x2) - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[j] += y * breathEnvelope(breath, j / sr) * breath.level;
  }
}
