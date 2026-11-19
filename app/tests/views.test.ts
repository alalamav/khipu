/**
 * What the ledger says a voice makes of a cord. These lines are how a visitor
 * checks the instrument against the row, so they must say what really sounds.
 */
import { describe, expect, it } from 'vitest';
import { HangingKhipu, type CordData } from '../src/khipu';
import { headerOf, rowOf, type CordRowView } from '../src/piece/views';
import { PALETTE, cord, khipuOf, knot, recorder } from './fixtures';
import type { VoiceKind } from '../src/audio/cordSound';

/** The voice read-out for the first cord of a khipu made of these cords. */
function readout(cords: CordData[], voice: VoiceKind, depth = 1): NonNullable<CordRowView['voice']> {
  const khipu = khipuOf(cords);
  const row = rowOf(new HangingKhipu(khipu), khipu.cords[0], PALETTE, voice, depth, 1);
  if (!row.voice) throw new Error('the cord has no read-out');
  return row.voice;
}

const texts = (voice: NonNullable<CordRowView['voice']>) => voice.lines.map((line) => line.text);

describe('the string voice in the ledger', () => {
  it('gives the pitch of the length and how long the colour rings', () => {
    // 30 cm is 220 Hz; a white cord rings 0.9 + 1.6 s
    expect(readout([cord()], 'string').title).toBe('string · 220 Hz · rings 2.5 s');
  });

  it('says how far a very short or very long cord was moved to come into range', () => {
    expect(readout([cord({ length: 2 })], 'string').title).toBe('string · 825 Hz (3300 Hz, 2 octaves down) · rings 2.5 s');
    expect(readout([cord({ length: 120 })], 'string').title).toBe('string · 110 Hz (55 Hz, 1 octave up) · rings 2.5 s');
  });

  it('lists the partial each knot sounds, and how it is struck', () => {
    const voice = readout(
      [
        cord({
          knots: [
            knot({ position: 15, count: 2, value: 20 }),
            knot({ position: 25, type: 'L', value: 4 }),
            knot({ position: 28, type: 'E', value: 1 }),
            knot({ position: null }),
          ],
        }),
      ],
      'string',
    );
    expect(texts(voice)).toEqual([
      'knot at 15 cm · ×2 of the cord · 440 Hz · 2 pings',
      'knot at 25 cm · ×1.2 of the cord · 264 Hz · a roll of 4',
      'knot at 28 cm · ×1.07 of the cord · 236 Hz · beating',
      'knot, position not recorded · no pitch, only a tick · 1 ping',
    ]);
  });

  it('shows the partial that sounds when it had to be lowered under 4200 Hz', () => {
    // a knot 1 cm down a 30 cm cord: the ratio 30 is held at 24 (5280 Hz), then lowered an octave
    expect(texts(readout([cord({ knots: [knot({ position: 1 })] })], 'string'))).toEqual([
      'knot at 1 cm · ×12 of the cord · 2640 Hz · 1 ping',
    ]);
  });

  it('says a cord of unrecorded length is only breath', () => {
    const voice = readout([cord({ length: null, knots: [knot({ position: 3 })] })], 'string');
    expect(voice.title).toBe('string · no pitch: length not recorded, only breath');
    expect(texts(voice)).toEqual(['knot at 3 cm · no pitch, only a tick · 1 ping']);
  });

  it('follows the cord as it wears', () => {
    const khipu = khipuOf([cord({ knots: [knot({ position: 15 })] })]);
    const hanging = new HangingKhipu(khipu);
    const row = () => rowOf(hanging, khipu.cords[0], PALETTE, 'string', 1, 1);
    expect(row().voice?.lines).toHaveLength(1);
    while (hanging.tiedKnots(khipu.cords[0]).length) hanging.wear(khipu.cords[0], 1, recorder());
    expect(row().voice?.lines).toHaveLength(0); // the knot has gone, and its partial with it
    while (!hanging.state(khipu.cords[0]).gone) hanging.wear(khipu.cords[0], 1, recorder());
    expect(row().voice).toBeNull(); // a cord on the floor makes no sound
  });
});

describe('the operator voice in the ledger', () => {
  it('lists each modulator with its proportion, frequency and depth', () => {
    const voice = readout([cord({ knots: [knot({ value: 20 })] }), cord({ parent: 0, knots: [knot({ value: 60 })] })], 'operator');
    expect(voice.title).toBe('operator · sine 220 Hz, modulated by');
    // depth: 2.2 for a subsidiary, times 0.4 + 0.6 × 60 / 80
    expect(texts(voice)).toEqual(['subsidiary cord 2 · ×3 of values · 660 Hz · depth 1.87']);
  });

  it('shows the proportion that sounds when a modulator had to be lowered under 6 kHz', () => {
    // a 4.3 cm cord sounds 1535 Hz; five times that is 7674 Hz
    const voice = readout(
      [cord({ length: 4.3, knots: [knot({ value: 10 })] }), cord({ parent: 0, knots: [knot({ value: 50 })] })],
      'operator',
    );
    expect(texts(voice)).toHaveLength(1);
    expect(texts(voice)[0]).toMatch(/^subsidiary cord 2 · ×5 of values, 1 octave down to ×2\.5 · 3837 Hz · depth /);
  });

  it('says when nothing relates two cords, and when a cord stands alone', () => {
    const unrelated = readout([cord({ length: null }), cord({ parent: 0, length: null })], 'operator');
    expect(unrelated.title).toBe('operator · no pitch: length not recorded, only breath');
    const alone = readout([cord()], 'operator');
    expect(alone.title).toBe('operator · sine 220 Hz, unmodulated');
    expect(alone.lines).toEqual([]);
    const bare = readout([cord({ knots: [knot({ value: 20 })] }), cord({ parent: 0, knots: [knot({ value: 60 })] })], 'operator', 0);
    expect(bare.title).toBe('operator · sine 220 Hz, unmodulated'); // depth 0: bare sine tones
  });

  it('indents the modulators of a modulator', () => {
    const voice = readout(
      [
        cord({ knots: [knot({ value: 20 })] }),
        cord({ parent: 0, knots: [knot({ value: 60 })] }),
        cord({ parent: 1, level: 3, knots: [knot({ value: 30 })] }),
      ],
      'operator',
    );
    expect(voice.lines.map((line) => line.level)).toEqual([0, 1]);
    expect(texts(voice)[1]).toMatch(/^subsidiary cord 3 · ×2 of values · 1320 Hz · depth /);
  });
});

describe('the resonator voice in the ledger', () => {
  it('gives a line to every cluster of knots, even two of the same value', () => {
    const voice = readout(
      [cord({ knots: [knot({ position: 5, count: 2, value: 20 }), knot({ position: 10, count: 2, value: 20 }), knot({ position: 20, type: 'L', value: 5 })] })],
      'resonator',
    );
    expect(voice.title).toBe('resonator · rings at');
    // 110 Hz × 2^log10(20) is 271 Hz; × 2^log10(5) is 179 Hz
    expect(texts(voice)).toEqual(['20 · 271 Hz · 2 strikes', '20 · 271 Hz · 2 strikes', '5 · 179 Hz · 5 strikes']);
  });

  it('counts the filters of a ravelled cord and of a figure-eight knot', () => {
    expect(texts(readout([cord({ termination: 'R', knots: [knot({ position: 5, value: 10 })] })], 'resonator'))).toEqual([
      '10 · 220 Hz · 1 strike · 4 filters',
    ]);
    expect(texts(readout([cord({ knots: [knot({ position: 5, type: 'E', value: 1 })] })], 'resonator'))).toEqual([
      '1 · 110 Hz · 1 strike · 2 filters',
    ]);
  });

  it('counts only the strikes that are heard before a cut cord stops', () => {
    const voice = readout(
      [cord({ termination: 'C', knots: [knot({ position: 7.5, count: 2, value: 20 }), knot({ position: 15, value: 3 })] })],
      'resonator',
    );
    expect(texts(voice)).toEqual(['20 · 271 Hz · 1 strike', '3 · 153 Hz · struck after the cord stops']);
  });

  it('tells a cord with no knots from one whose knots have no value', () => {
    expect(readout([cord()], 'resonator')).toEqual({ title: 'resonator · no knots: only the tap', lines: [] });
    expect(readout([cord({ knots: [knot({ value: 0 })] })], 'resonator')).toEqual({
      title: 'resonator · nothing rings: only the tap',
      lines: [{ level: 0, text: 'a knot the archive gives no value · nothing rings' }],
    });
  });
});

describe('the header', () => {
  it('says when pendant positions could not be used, without claiming none were recorded', () => {
    const khipu = khipuOf([cord({ position: 1, positionRecorded: false }), cord({ position: 2, positionRecorded: false })]);
    expect(headerOf(khipu).facts).toContain('pendant positions not recorded, or too few to place the rest: shown evenly spaced');
  });
});
