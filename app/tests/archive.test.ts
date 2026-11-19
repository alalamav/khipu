/**
 * The library against the real data: every file under public/data is read
 * through KhipuArchive, as the app reads it. This is what fails first when
 * tools/build_data.py and src/khipu/schema.ts stop agreeing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildOperatorPatch } from '../src/audio/operatorPatch';
import { buildResonatorPatch } from '../src/audio/resonatorPatch';
import { soundOf } from '../src/audio/cordSound';
import { ATTACHMENT, FIBER, HangingKhipu, KNOT_TYPE, KhipuArchive, TERMINATION, type Khipu } from '../src/khipu';
import { diskReader } from './fixtures';

describe('the archive on disk', () => {
  let archive: KhipuArchive;
  const khipus: Khipu[] = [];

  beforeAll(async () => {
    archive = await KhipuArchive.open(diskReader);
    for (const id of archive.ids) khipus.push(await archive.load(id));
  });

  it('holds every khipu the catalogue lists, with the totals the catalogue states', () => {
    const { stats } = archive;
    expect(khipus).toHaveLength(stats.khipus);
    expect(khipus.reduce((sum, k) => sum + k.cordCount, 0)).toBe(stats.cords);
    expect(khipus.reduce((sum, k) => sum + k.knotCount, 0)).toBe(stats.knots);
    for (const khipu of khipus) {
      const line = archive.summary(khipu.id)!;
      expect([khipu.id, khipu.cordCount, khipu.knotCount, khipu.totalValue]).toEqual([line.id, line.cords, line.knots, line.value]);
    }
  });

  it('counts what was not recorded the way the statistics say', () => {
    const cords = khipus.flatMap((k) => k.cords);
    const { stats } = archive;
    expect(cords.filter((c) => c.termination === null).length).toBe(stats.notRecorded.termination);
    expect(cords.filter((c) => c.attachment === null).length).toBe(stats.notRecorded.attachment);
    expect(cords.filter((c) => c.length === null).length).toBe(stats.notRecorded.length);
    expect(cords.filter((c) => c.knots.length === 0).length).toBe(stats.cordsWithoutKnots);
    expect(cords.filter((c) => c.termination === 'U').length).toBe(stats.terminations.U);
  });

  it('uses only codes the vocabulary has words for, and colours the chart has', () => {
    for (const khipu of khipus) {
      for (const c of khipu.cords) {
        const where = `${khipu.id} cord ${c.index}`;
        if (c.termination !== null) expect(TERMINATION[c.termination], `${where} termination ${c.termination}`).toBeDefined();
        if (c.fiber !== null) expect(FIBER[c.fiber], `${where} fibre ${c.fiber}`).toBeDefined();
        if (c.attachment !== null) expect(ATTACHMENT[c.attachment], `${where} attachment ${c.attachment}`).toBeDefined();
        for (const k of c.knots) {
          if (k.type !== null) expect(KNOT_TYPE[k.type], `${where} knot ${k.index} type ${k.type}`).toBeDefined();
        }
        if (c.color !== null) expect(c.rgb, `${where} colour ${c.color}`).not.toBeNull();
      }
    }
  });

  it('can hang every khipu: it has a width, and each cord a finite place and a length to draw', () => {
    for (const khipu of khipus) {
      const { layout } = new HangingKhipu(khipu);
      expect(Number.isFinite(layout.width) && layout.width > 0, khipu.id).toBe(true);
      for (const c of khipu.cords) {
        const at = layout.cords[c.index];
        expect(Number.isFinite(at.x) && Number.isFinite(at.top) && at.drawLength > 0, `${khipu.id} cord ${c.index}`).toBe(true);
      }
    }
  });

  it('can sound every cord in the operator and resonator voices', () => {
    let modulated = 0;
    let ringing = 0;
    let valued = 0;
    for (const khipu of khipus) {
      const hanging = new HangingKhipu(khipu);
      for (const c of khipu.cords) {
        const operator = buildOperatorPatch(hanging, c, 1);
        expect(operator.frequency >= 0 && operator.frequency <= 1568, `${khipu.id} cord ${c.index}`).toBe(true);
        for (const m of operator.modulators) {
          expect(m.frequency > 0 && m.frequency <= 6000 && m.index > 0 && Number.isFinite(m.index), `${khipu.id} cord ${c.index}`).toBe(true);
        }
        if (operator.modulators.length) modulated++;
        const resonator = buildResonatorPatch(soundOf(hanging, c), 1);
        for (const r of resonator.resonances) {
          expect(r.frequency >= 20 && r.frequency <= 9300 && r.ring > 0, `${khipu.id} cord ${c.index}`).toBe(true);
        }
        if (resonator.resonances.length) ringing++;
        if (c.knots.some((k) => k.value > 0)) valued++;
      }
    }
    // Two cords in three have a neighbour or a subsidiary to modulate them; the rest are bare sine tones.
    expect(modulated / archive.stats.cords).toBeGreaterThan(0.6);
    // Every cord that carries a number rings. A few cords carry knots the archive gives no value; they only tap.
    expect(ringing).toBe(valued);
    expect(valued).toBeLessThanOrEqual(archive.stats.cords - archive.stats.cordsWithoutKnots);
  });
});
