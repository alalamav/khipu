/**
 * The string voice: the cord as a measured string.
 *
 * Every cord is rendered as a short stereo buffer, computed from its row at
 * the moment it is touched. Nothing is sampled and no musical scale is
 * imposed:
 *
 *   length (cm)      -> pitch. f = 6600 / cm, folded by octaves into range.
 *   colour           -> brightness and ring time (pale cotton rings longer).
 *   knots            -> partials. A knot at distance p on a cord of length L
 *                       sounds the ratio L / p above the cord, the way a
 *                       finger resting on a string sounds a harmonic.
 *                       Single knots ping once each; a long knot of n turns
 *                       is a roll of n grains; a figure-eight knot beats.
 *   knot direction   -> S to the left, Z to the right, unknown in the
 *                       middle and partly noise.
 *   termination      -> how the sound ends. See the endings below.
 *   not recorded     -> breath. A cord with no measured length has no pitch.
 *
 * synthString is pure: no Web Audio, the same input always gives the same
 * samples. It began as a line-for-line port of the first prototype's synthesis.
 * It no longer sounds the same: a cord now rings for as long as it swings
 * (ringTime), a broken or cut cord stops less abruptly, and breath is softer
 * and lasts as long as the swing (breath.ts). The order of the
 * arithmetic and of the calls to the random generator still matters: the
 * frozen cases in stringVoice.test.ts notice any change.
 */
import { mulberry32 } from '../khipu';
import { breathOf, breathSeed, renderBreath } from './breath';
import { cordFrequency, durationOf, ringTime, unpitchedDuration, type CordSound } from './cordSound';

export interface StereoSamples {
  L: Float32Array;
  R: Float32Array;
}

/**
 * The partial a knot sounds, in Hz: the cord's pitch `f0` times (cord length
 * / knot position), as a finger resting there would sound on a string. The
 * ratio is kept between 1 and 24, and the result is lowered by octaves until
 * it is under 4200 Hz. 0 when the knot cannot be placed: the cord has no
 * pitch, or the position was not recorded.
 */
export function knotPartial(f0: number, lengthCm: number, position: number | null): number {
  let fk = 0;
  if (f0 && position && lengthCm) {
    let h = lengthCm / Math.min(position, lengthCm);
    if (h < 1) h = 1;
    if (h > 24) h = 24;
    fk = f0 * h;
    while (fk > 4200) fk /= 2;
  }
  return fk;
}

/**
 * `clicks`: a broken or cut cord stops with a crack. Without it the cord stops just the same, and silently.
 * `breaths`: what was not recorded, and wear, are heard as breath. Without it they are silence, and the
 * rest of the sound is as it was: a cord with no measured length is then only its knots' ticks, or nothing.
 */
export function synthString(spec: CordSound, sr: number, clicks = true, breaths = true): StereoSamples {
  const rnd = mulberry32(spec.seed || 1);
  const term = spec.termination ?? '';
  const f0 = cordFrequency(spec.length);
  let dur = durationOf(spec.termination, spec.lightness);
  if (!f0) dur = unpitchedDuration(spec.lightness);
  const n = Math.floor(dur * sr);
  const mono = new Float32Array(n);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const lum = Math.max(0, Math.min(1, spec.lightness));
  const integ = Math.max(0, Math.min(1, spec.integrity));

  // ---- Karplus-Strong string ---------------------------------------
  function string(freq: number, amp: number, t60: number, bright: number): void {
    const N = Math.max(2, Math.round(sr / freq));
    const line = new Float32Array(N);
    let lp = 0;
    const a = 0.12 + 0.8 * bright;
    let m = 0;
    for (let j = 0; j < N; j++) {
      lp += a * (rnd() * 2 - 1 - lp);
      line[j] = lp;
      m += lp;
    }
    m /= N;
    let peak = 1e-6;
    for (let j = 0; j < N; j++) {
      line[j] -= m;
      if (Math.abs(line[j]) > peak) peak = Math.abs(line[j]);
    }
    for (let j = 0; j < N; j++) line[j] /= peak;
    const g = Math.pow(10, -3 / (t60 * freq)); // loss per period
    const s = 0.5 - 0.36 * bright; // averaging: 0.5 dull .. 0.14 bright
    let idx = 0;
    for (let j = 0; j < n; j++) {
      let nx = idx + 1;
      if (nx === N) nx = 0;
      mono[j] += line[idx] * amp;
      line[idx] = g * ((1 - s) * line[idx] + s * line[nx]);
      idx = nx;
    }
  }

  // ---- breath: what a cord with no pitch sounds like ---------------
  const vary = mulberry32(breathSeed(spec.seed));
  // A breath that is not heard is still made, and thrown away: the noise it takes is taken all the
  // same, so that everything after it in the sound is sample for sample what it would have been.
  const unheard = breaths ? null : new Float32Array(n);
  function breath(amp: number, centre: number, len: number): void {
    renderBreath(breathOf(amp, centre, len, vary), sr, rnd, unheard ?? mono);
  }

  const bright = 0.25 + 0.7 * lum;
  const t60 = ringTime(lum);

  if (!f0) {
    // length not recorded: no string, only breath
    breath(0.4, 500 + 900 * rnd(), dur);
  } else if (term === '') {
    // termination not recorded: the string is there but barely, under breath
    string(f0, 0.3, t60 * 0.5, bright * 0.6);
    breath(0.3, f0 * 2, dur);
  } else if (term === 'TT') {
    // canutito: the end is wrapped in thread — a damped, muted string
    string(f0, 0.9, 0.16, bright * 0.35);
  } else if (term === 'U') {
    // unfinished: hardly decays at all; it will simply stop (see below)
    string(f0, 0.6, t60 * 5, bright);
  } else if (term === 'R') {
    // ravelled: the plies come apart into separate, drifting strings
    string(f0, 0.5, t60, bright);
    string(f0 * 1.011, 0.34, t60 * 0.9, bright);
    string(f0 * 0.985, 0.34, t60 * 0.8, bright);
    string(f0 * 1.027, 0.22, t60 * 0.7, bright);
  } else if (term === 'D') {
    // doubled: the end is folded back on itself — the octave below joins
    string(f0, 0.6, t60, bright);
    string(f0 / 2, 0.5, t60 * 1.1, bright * 0.8);
  } else {
    string(f0, 0.8, t60, bright);
  }

  // a worn cord carries noise in proportion to its wear
  if (integ < 1) breath(0.28 * (1 - integ), 1200, dur);

  // ---- stereo placement of the cord itself ---------------------------
  const pan = Math.max(-1, Math.min(1, spec.pan || 0));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    L[i] = mono[i] * gl;
    R[i] = mono[i] * gr;
  }

  // ---- knots ----------------------------------------------------------
  function ping(t: number, f: number, amp: number, dec: number, kpan: number, noise: number): void {
    const start = Math.floor(t * sr);
    if (start >= n) return;
    const len = Math.min(n - start, Math.floor(dec * 5 * sr));
    const pl = Math.cos(((kpan + 1) * Math.PI) / 4);
    const pr = Math.sin(((kpan + 1) * Math.PI) / 4);
    const w = (2 * Math.PI * f) / sr;
    const att = Math.max(1, Math.floor(0.003 * sr));
    let lp = 0;
    for (let k = 0; k < len; k++) {
      const e = Math.exp(-k / (dec * sr)) * (k < att ? k / att : 1);
      let v = f ? Math.sin(w * k) : 0;
      if (noise > 0) {
        lp += 0.3 * (rnd() * 2 - 1 - lp);
        v = v * (1 - noise) + lp * noise * 2;
      }
      v *= e * amp;
      L[start + k] += v * pl;
      R[start + k] += v * pr;
    }
  }

  const Lcm = spec.length || 0;
  for (const kn of spec.knots) {
    const p = kn.position;
    const fk = knotPartial(f0, Lcm, p);
    const frac = p && Lcm ? Math.min(1, p / Lcm) : rnd();
    const t0 = 0.05 + 0.45 * frac; // read from the top of the cord downward
    const kpan = kn.direction === 'Z' ? 0.75 : kn.direction === 'S' ? -0.75 : 0;
    let unsure = kn.direction === null ? 0.45 : 0; // direction not recorded
    if (!fk) unsure = 1; // position not recorded: only a tick
    const cnt = Math.max(1, Math.min(kn.count || 1, 9));
    const unit = (kn.value || 0) / (kn.count || 1);
    if (kn.type === 'L' || kn.type === 'LL' || kn.type === 'BL' || kn.type === 'SP') {
      const turns = Math.max(2, Math.min(Math.round(unit) || 2, 11));
      for (let j = 0; j < turns; j++) ping(t0 + j * 0.034, fk, 0.2 + 0.015 * j, 0.05, kpan, unsure);
      ping(t0 + turns * 0.034, fk, 0.2, 0.22, kpan, unsure);
    } else if (kn.type === 'E' || kn.type === 'EE') {
      ping(t0, fk, 0.2, 0.4, kpan, unsure);
      ping(t0, fk ? fk * 1.012 + 2 : 0, 0.2, 0.4, kpan, unsure);
    } else {
      const dec = 0.22 + 0.1 * Math.log10(Math.max(1, unit));
      for (let j = 0; j < cnt; j++) ping(t0 + j * 0.075, fk, 0.26, dec, kpan, unsure);
    }
  }

  // ---- endings ----------------------------------------------------------
  function stopAt(at: number, fadeSec: number, crack: number): void {
    const c = Math.floor(at * n);
    const fl = Math.max(1, Math.floor(fadeSec * sr));
    for (let k = c; k < n; k++) {
      const e = k - c < fl ? 1 - (k - c) / fl : 0;
      L[k] *= e;
      R[k] *= e;
    }
    if (crack > 0 && clicks) {
      const cl = Math.min(n - c, Math.floor(0.08 * sr));
      const rise = Math.max(1, Math.floor(0.002 * sr));
      let lp = 0;
      for (let k = 0; k < cl; k++) {
        lp += 0.3 * (rnd() * 2 - 1 - lp);
        // it comes up over 2 ms: a crack that begins at full level is a click
        const v = lp * crack * 1.6 * Math.min(1, k / rise) * Math.exp(-k / (0.012 * sr));
        L[c + k] += v * gl;
        R[c + k] += v * gr;
      }
    }
  }
  if (f0) {
    if (term === 'B') stopAt(0.36 + 0.2 * rnd(), 0.008, 0.5); // broken: torn off, with a crack
    else if (term === 'C') stopAt(0.24, 0.004, 0.2); // cut: a clean edge
    else if (term === 'U') stopAt(0.62, 0.02, 0); // unfinished: just ends
  }

  // ---- tidy: fade the tail, keep the level sane -------------------------
  const tail = Math.floor(0.03 * sr);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    if (i > n - tail) {
      const e2 = (n - i) / tail;
      L[i] *= e2;
      R[i] *= e2;
    }
    const ab = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    if (ab > peak) peak = ab;
  }
  const scale = 0.5 / Math.max(0.6, peak);
  for (let i = 0; i < n; i++) {
    L[i] *= scale;
    R[i] *= scale;
  }
  return { L, R };
}
