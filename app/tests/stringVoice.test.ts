/**
 * The string voice, by its samples.
 *
 * voices.test.ts checks what each voice decides to play. The string voice
 * does not stop at a decision: synthString is pure and computes the samples
 * itself, so here it is run and what comes out is examined, three ways:
 * sample for sample, against digests taken while it sounded exactly as the
 * first prototype did; by what must be true of every sound; and by listening,
 * with a filter, for the partial a knot is said to add.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cordFrequency, durationOf, unpitchedDuration, type CordSound } from '../src/audio/cordSound';
import { knotPartial, synthString } from '../src/audio/stringVoice';
import { knot } from './fixtures';

const SAMPLE_RATE = 48000;

type Stereo = { L: Float32Array; R: Float32Array };

/** A knotted cord of 40 cm (165 Hz), mid-grey, whole, hanging in the middle, with no knots. */
function cordSound(over: Partial<CordSound> = {}): CordSound {
  return { length: 40, lightness: 0.5, termination: 'K', knots: [], pan: 0, integrity: 1, seed: 1, ...over };
}

/** The first 16 hex digits of the SHA-256 of the samples as they lie in memory: the left channel, then the right. */
function digest({ L, R }: Stereo): string {
  return createHash('sha256')
    .update(Buffer.from(L.buffer, L.byteOffset, L.byteLength))
    .update(Buffer.from(R.buffer, R.byteOffset, R.byteLength))
    .digest('hex')
    .slice(0, 16);
}

/** The largest sample, either way. */
function peak(samples: Float32Array): number {
  let most = 0;
  for (const v of samples) most = Math.max(most, Math.abs(v));
  return most;
}

/** How strongly `signal` sounds at `hz`: the size of its spectrum there, by Goertzel's filter. */
function strengthAt(signal: ArrayLike<number>, hz: number): number {
  const c = 2 * Math.cos((2 * Math.PI * hz) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const s0 = signal[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
}

type Golden = readonly [label: string, spec: CordSound, digest: string];

/**
 * Cords that between them take every branch of the string voice (synthString
 * and what it calls), each with a digest of the samples it gave when these
 * were taken. (The voice began sample-identical to the first prototype. The
 * digests were taken again when its endings were softened, and when a cord
 * was made to ring for as long as it swings, and when breath was made softer
 * and as long as the swing.)
 *
 * The digests are here to notice ANY change in what is heard: a sum taken in
 * another order, or one more call to the random generator, is enough. A
 * digest is the first 16 hex digits of the SHA-256 of the left channel's
 * bytes followed by the right's, rendered at 48 kHz.
 *
 * When a row fails and the sound was not meant to change, the voice has
 * drifted: put the voice right, not the digest. When the
 * change is meant, run `npx vitest run tests/stringVoice.test.ts`: every
 * stale row is reported under its label, as
 *   expected '<the digest now>' to be '<the digest here>'
 * Copy the new digests in, and correct the header of stringVoice.ts, which
 * will no longer be true.
 *
 * They were taken with Node 25 (V8 14.1) on arm64, and Node 20 (V8 11.3)
 * gives the same. The arithmetic is IEEE 754, the same everywhere; Math.sin,
 * cos, exp, pow and log10 are the engine's own. Should every row fail at once
 * on another engine with the voice untouched, suspect those.
 */
const GOLDEN: readonly Golden[] = [
  // ---- how the cord ends ----
  ['knotted', cordSound({ termination: 'K' }), '553c90441230553c'],
  ['broken', cordSound({ termination: 'B' }), 'c7f2201291b1d58b'],
  ['cut', cordSound({ termination: 'C' }), '7cad24bf05ac9250'],
  ['ravelled', cordSound({ termination: 'R' }), 'c1f03b2206e6c9d6'],
  ['doubled', cordSound({ termination: 'D' }), 'aaca1ed3ac39b165'],
  ['unfinished', cordSound({ termination: 'U' }), '5a23620a9906e2fa'],
  ['canutito', cordSound({ termination: 'TT' }), 'c7d2c6a7b6bc3895'],
  ['termination not recorded', cordSound({ termination: null }), '6a255bbfe670ff16'],
  // ---- what else its row may say ----
  // no pitch: only breath; its knot can only tick; and though the cord is broken there is no string to tear
  ['length not recorded', cordSound({ length: null, termination: 'B', knots: [knot({ position: 12, direction: 'Z' })] }), 'da35423d73ed7f56'],
  // 22 Hz, folded up two octaves to 88
  ['three metres long, at the left end of the main cord', cordSound({ length: 300, pan: -0.7 }), '364111a9de4e4c63'],
  ['worn', cordSound({ integrity: 0.4 }), 'b602ca047e931016'],
  // ---- knots ----
  [
    'knots as recorded, at the right end of the main cord',
    cordSound({
      pan: 0.7,
      knots: [
        knot({ position: 8, count: 3, value: 300, direction: 'S' }), // three single knots, hundreds
        knot({ position: 20, count: 2, value: 20, direction: 'Z' }), // two single knots, tens
        knot({ position: 32, type: 'L', value: 6, direction: 'S' }), // a long knot of six turns
        knot({ position: 36, type: 'E', value: 1, direction: 'Z' }), // a figure-eight
      ],
    }),
    'c6f94e2915170b8e',
  ],
  [
    'knots partly recorded',
    cordSound({
      knots: [
        knot({ position: 10, count: 2, value: 20 }), // no direction: in the middle, and partly noise
        knot({ direction: 'S' }), // no position: only a tick, at a moment drawn at random
        knot({ type: 'E', value: 1 }), // neither, and a figure-eight: two ticks at once
      ],
    }),
    'c24bdde15ebfcb14',
  ],
  [
    'at the limits',
    cordSound({
      length: 3, // 2200 Hz, folded down an octave to 1100
      termination: 'TT', // over in 0.75 s, before the last knots are reached
      seed: 0, // taken as 1
      knots: [
        knot({ position: 0.1, type: 'SP', value: 4, direction: 'Z' }), // L / p is 30: held at 24, then lowered three octaves
        knot({ position: 1, type: null, count: 0, value: 0, direction: 'Z' }), // no kind, no count, no value
        knot({ position: 1.5, type: 'L', value: 1, direction: 'S' }), // a long knot of one turn is given two
        knot({ position: 2, type: 'LL', value: 0, direction: 'S' }), // and so is one of none
        knot({ position: 2.5, type: 'BL', value: 30, direction: 'Z' }), // one of thirty is given eleven, the last after the end
        knot({ position: -0.2, type: 'EE', value: 2, direction: 'S' }), // above the top: the cord's own pitch
        knot({ position: 4.5, type: 'TF', count: 12, value: 120, direction: 'S' }), // below the end: the cord's own pitch, nine times at most
      ],
    }),
    '0fa5df821873a738',
  ],
];

describe('the string voice, sample for sample', () => {
  it('sounds each of these cords exactly as it did when its digest was taken', () => {
    for (const [label, spec, expected] of GOLDEN) {
      expect.soft(digest(synthString(spec, SAMPLE_RATE)), label).toBe(expected);
    }
  });
});

describe('every sound of the string voice', () => {
  it('is made of finite samples only', () => {
    for (const [label, spec] of GOLDEN) {
      const { L, R } = synthString(spec, SAMPLE_RATE);
      expect(L.every(Number.isFinite) && R.every(Number.isFinite), label).toBe(true);
    }
  });

  it('lasts the time set for the way the cord ends, or the time set for a cord with no pitch', () => {
    for (const [label, spec] of GOLDEN) {
      const seconds = spec.length === null ? unpitchedDuration(spec.lightness) : durationOf(spec.termination, spec.lightness);
      const samples = Math.floor(seconds * SAMPLE_RATE);
      const { L, R } = synthString(spec, SAMPLE_RATE);
      expect([L.length, R.length], label).toEqual([samples, samples]);
    }
  });

  it('leaves the crack out of a broken cord when clicks are off, and changes nothing else', () => {
    const [, broken] = GOLDEN.find(([label]) => label === 'broken')!;
    const [, knotted] = GOLDEN.find(([label]) => label === 'knotted')!;
    expect(digest(synthString(broken, SAMPLE_RATE, false))).not.toBe(digest(synthString(broken, SAMPLE_RATE)));
    expect(digest(synthString(knotted, SAMPLE_RATE, false))).toBe(digest(synthString(knotted, SAMPLE_RATE)));
  });

  it('stays at or below half of full scale', () => {
    for (const [label, spec] of GOLDEN) {
      const { L, R } = synthString(spec, SAMPLE_RATE);
      expect(Math.max(peak(L), peak(R)), label).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });

  it('is the same, sample for sample, each time the same cord is sounded', () => {
    for (const [label, spec] of GOLDEN) {
      expect(digest(synthString(spec, SAMPLE_RATE)), label).toBe(digest(synthString(spec, SAMPLE_RATE)));
    }
  });

  it('comes from one loudspeaker only when the cord hangs hard left or hard right', () => {
    for (const [label, spec] of GOLDEN) {
      // without its knots, which are placed by the way they are tied and not by where the cord hangs
      const bare = { ...spec, knots: [] };
      const left = synthString({ ...bare, pan: -1 }, SAMPLE_RATE);
      expect(peak(left.R), label).toBeLessThan(1e-9);
      expect(peak(left.L), label).toBeGreaterThan(0.1);
      const right = synthString({ ...bare, pan: 1 }, SAMPLE_RATE);
      expect(peak(right.L), label).toBeLessThan(1e-9);
      expect(peak(right.R), label).toBeGreaterThan(0.1);
    }
  });
});

describe('a knot in the string voice', () => {
  it('is given its partial by one rule, the one the ledger prints from', () => {
    // a 30 cm cord sounds 220 Hz
    expect(knotPartial(220, 30, 15)).toBeCloseTo(440); // half-way down: the octave
    expect(knotPartial(220, 30, 10)).toBeCloseTo(660); // a third of the way down: the twelfth
    expect(knotPartial(220, 30, 1)).toBeCloseTo(2640); // 30 times the cord is held at 24 (5280 Hz), then lowered an octave
    expect(knotPartial(220, 30, 45)).toBeCloseTo(220); // recorded below the end of the cord: the cord's own pitch
    expect(knotPartial(220, 30, null)).toBe(0); // no position: nothing to sound
    expect(knotPartial(0, 30, 15)).toBe(0); // no pitch: nothing to sound it on
    expect(knotPartial(220, 0, 15)).toBe(0);
  });

  /** The rule in the header of stringVoice.ts, with the lowering by octaves that keeps a partial under 4200 Hz. */
  function knotFrequency(length: number, position: number): number {
    let hz = cordFrequency(length) * (length / position);
    while (hz > 4200) hz /= 2;
    return hz;
  }

  it('adds a partial L / p above the cord, lowered by octaves until it is under 4200 Hz', () => {
    const knots: [length: number, position: number][] = [
      [40, 16], // 165 Hz x 2.5 = 412.5 Hz
      [40, 25], // 165 Hz x 1.6 = 264 Hz
      [5, 1], // 1320 Hz x 5 = 6600 Hz, lowered an octave to 3300
    ];
    for (const [length, position] of knots) {
      // A knot whose position and direction are both recorded draws nothing from the random
      // generator, so the string under it is the same with it and without.
      const without = synthString(cordSound({ length }), SAMPLE_RATE);
      const withKnot = synthString(cordSound({ length, knots: [knot({ position, direction: 'S' })] }), SAMPLE_RATE);
      // What the knot added, in both loudspeakers together, from the moment it is reached:
      // the cord is read from the top, 0.05 s after the touch and 0.45 s more to its end.
      const reached = Math.floor((0.05 + 0.45 * (position / length)) * SAMPLE_RATE);
      const added = Float64Array.from(
        { length: without.L.length - reached },
        (_, i) => withKnot.L[reached + i] - without.L[reached + i] + withKnot.R[reached + i] - without.R[reached + i],
      );
      const hz = knotFrequency(length, position);
      const there = strengthAt(added, hz);
      // Far stronger at the partial than a tritone away from it, and than a semitone to either
      // side of it: a partial that was even a little out of place would fail the last two.
      for (const interval of [Math.SQRT2, 2 ** (1 / 12), 2 ** (-1 / 12)]) {
        const elsewhere = hz * interval;
        const which = `${position} cm down a cord of ${length} cm: ${hz.toFixed(1)} Hz against ${elsewhere.toFixed(1)} Hz`;
        expect(there, which).toBeGreaterThan(5 * strengthAt(added, elsewhere));
      }
    }
  });
});
