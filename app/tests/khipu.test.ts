import { describe, expect, it } from 'vitest';
import {
  HangingKhipu,
  KhipuArchive,
  KhipuDataError,
  SCHEMA_VERSION,
  layoutKhipu,
  proportion,
  relationsInto,
  type ArchiveStats,
  type JsonReader,
  type KhipuSummary,
} from '../src/khipu';
import { PALETTE, cord, khipuData, khipuOf, knot, recorder } from './fixtures';

describe('Khipu: the record', () => {
  // two pendants in one group, a subsidiary of a subsidiary, and a top cord in a group of its own
  const khipu = khipuOf([
    cord({ position: 2, knots: [knot({ count: 3, value: 30 }), knot({ type: 'L', value: 4 })] }),
    cord({ position: 1, color: null, length: null }),
    cord({ parent: 0, position: 10, knots: [knot({ type: 'E', value: 1 })] }),
    cord({ parent: 2, level: 3, position: 5 }),
    cord({ position: 5, up: true, group: 2, color: 'KB' }),
  ]);
  const [a, b, sub, subsub, top] = khipu.cords;

  it('is a tree that can be walked both ways', () => {
    expect(a.children).toEqual([sub]);
    expect(sub.parent).toBe(a);
    expect(subsub.parent).toBe(sub);
    expect(subsub.depth).toBe(3);
    expect([...a.withDescendants()]).toEqual([a, sub, subsub]);
    expect(a.kind).toBe('pendant');
    expect(top.kind).toBe('top cord');
    expect(subsub.kind).toBe('subsidiary, level 3');
  });

  it('lists the cords on the main cord in the order they hang', () => {
    expect(khipu.pendants).toEqual([b, a, top]);
  });

  it('knows which cord hangs before which, within a group', () => {
    expect(a.previousInGroup).toBe(b);
    expect(b.previousInGroup).toBeNull();
    expect(top.previousInGroup).toBeNull(); // the first of another group
  });

  it('adds up cords, knots and values', () => {
    expect(khipu.cordCount).toBe(5);
    expect(khipu.knotCount).toBe(5); // 3 singles, a long knot, a figure-eight
    expect(khipu.totalValue).toBe(35);
    expect(a.value).toBe(34);
    expect(a.knotCount).toBe(4);
  });

  it('reads a knot as what it counts', () => {
    const [singles, long] = a.knots;
    expect(singles.unitValue).toBe(10);
    expect(singles.isLong).toBe(false);
    expect(long.isLong).toBe(true);
    expect(long.turns).toBe(4);
    expect(sub.knots[0].isFigureEight).toBe(true);
  });

  it('keeps what was not recorded as null', () => {
    expect(b.rgb).toBeNull();
    expect(b.length).toBeNull();
    expect(a.rgb).toEqual([255, 255, 255]);
    expect(a.lightness).toBeCloseTo(1);
    expect(top.lightness).toBeLessThan(0.2);
  });

  it('refuses a cord that hangs from a cord coming after it', () => {
    expect(() => khipuOf([cord({ parent: 1 }), cord()])).toThrow(/does not come before it/);
  });
});

describe('layoutKhipu: where each cord hangs', () => {
  const khipu = khipuOf([
    cord({ position: 3, length: 40 }),
    cord({ parent: 0, position: 10, length: 12 }),
    cord({ parent: 0, position: 99, length: 12 }), // tied on beyond the end of its parent
    cord({ position: 6, length: null }),
    cord({ position: 8, length: 20, up: true }),
  ]);
  const layout = layoutKhipu(khipu);

  it('hangs pendants at their position along the main cord', () => {
    expect(layout.cords[0]).toMatchObject({ x: 3, top: 0, dir: 1, attachAt: null, drawLength: 40 });
  });

  it('ties a subsidiary to its parent where the archive says, and stands it off to one side', () => {
    const at = layout.cords[1];
    expect(at).toMatchObject({ attachX: 3, attachY: 10, attachAt: 10 });
    expect(at.x).toBeGreaterThan(3);
    expect(layout.cords[2].attachAt).toBe(40); // no further along the parent than it reaches
  });

  it('draws a cord of unrecorded length at the median length', () => {
    expect(layout.nominalLength).toBe(20);
    expect(layout.cords[3].drawLength).toBe(20);
  });

  it('draws top cords upward', () => {
    expect(layout.cords[4].dir).toBe(-1);
    expect(layout.minY).toBe(-20);
  });

  it('reaches down to the lowest end of any cord', () => {
    // the subsidiary tied at the very end of the 40 cm pendant hangs 12 cm below it
    expect(layout.maxY).toBeCloseTo(layout.cords[2].top + 12);
    expect(layout.maxY).toBeGreaterThan(52);
  });

  it('is at least as wide as the main cord', () => {
    expect(layout.width).toBe(20);
    expect(layout.byX.map((c) => c.index)[0]).toBe(0);
  });
});

describe('HangingKhipu: what is left', () => {
  /** Touch a cord at full wear until it has fallen. */
  function wearOut(hanging: HangingKhipu, index: number, listener = recorder()) {
    const target = hanging.khipu.cords[index];
    for (let i = 0; i < 500 && !hanging.state(target).gone; i++) hanging.wear(target, 1, listener);
    expect(hanging.state(target).gone).toBe(true);
    return listener;
  }

  it('starts whole', () => {
    const hanging = new HangingKhipu(khipuOf([cord({ knots: [knot(), knot()] }), cord()]));
    expect(hanging.now).toEqual(hanging.archive);
    expect(hanging.isEmpty).toBe(false);
  });

  it('loses nothing to a gloved hand', () => {
    const hanging = new HangingKhipu(khipuOf([cord({ knots: [knot()] })]));
    const log = recorder();
    for (let i = 0; i < 50; i++) hanging.wear(hanging.khipu.cords[0], 0, log);
    expect(log.events).toEqual([]);
    expect(hanging.state(hanging.khipu.cords[0]).version).toBe(0);
  });

  it('loosens every knot before the cord itself gives way, and only ever gets smaller', () => {
    const hanging = new HangingKhipu(khipuOf([cord({ length: 4, knots: [knot(), knot(), knot({ type: 'L', value: 5 })] })]));
    const target = hanging.khipu.cords[0];
    const log = recorder();
    let before = { ...hanging.now };
    while (!hanging.state(target).gone) {
      hanging.wear(target, 1, log);
      expect(hanging.now.knots).toBeLessThanOrEqual(before.knots);
      expect(hanging.now.value).toBeLessThanOrEqual(before.value);
      before = { ...hanging.now };
    }
    expect(log.events.slice(0, 3).sort()).toEqual(['knot 0.0', 'knot 0.1', 'knot 0.2']);
    expect(log.events.at(-1)).toBe('fall 0');
    expect(hanging.now).toEqual({ cords: 0, knots: 0, value: 0 });
    expect(hanging.isEmpty).toBe(true);
  });

  it('takes down everything hanging from a cord that falls, the parent first', () => {
    const hanging = new HangingKhipu(
      khipuOf([cord({ length: 4 }), cord({ parent: 0, knots: [knot()] }), cord({ parent: 1, level: 3 }), cord()]),
    );
    const log = wearOut(hanging, 0);
    expect(log.events).toEqual(['fall 0', 'knot 1.0', 'fall 1', 'fall 2']);
    expect(hanging.now.cords).toBe(1);
    expect(hanging.state(hanging.khipu.cords[3]).gone).toBe(false);
  });

  it('lets a long cord part: what is left hangs shorter and ends in a break', () => {
    // twenty like cords, each with one subsidiary tied near the top and one near the bottom
    const cords = [];
    for (let i = 0; i < 20; i++) {
      cords.push(cord({ position: i, length: 40 }));
      cords.push(cord({ parent: 3 * i, position: 1, length: 4 }));
      cords.push(cord({ parent: 3 * i, position: 39, length: 4 }));
    }
    const hanging = new HangingKhipu(khipuOf(cords));
    let parted = 0;
    for (let i = 0; i < 20; i++) {
      const pendant = hanging.khipu.cords[3 * i];
      const [high, low] = pendant.children;
      while (!hanging.state(pendant).gone && !hanging.state(pendant).snapped) hanging.wear(pendant, 1, recorder());
      const state = hanging.state(pendant);
      if (!state.snapped) continue;
      parted++;
      expect(state.gone).toBe(false);
      expect(state.length).toBeLessThan(40);
      expect(state.length).toBeCloseTo(state.hangingLength);
      expect(pendant.length).toBe(40); // the record still says what it said
      expect(hanging.state(low).gone).toBe(true); // tied on below the break
      expect(hanging.state(high).gone).toBe(false);
    }
    expect(parted).toBeGreaterThan(0);
    expect(parted).toBeLessThan(20);
  });

  it('wears the same khipu the same way for the same touches', () => {
    const khipu = khipuOf([cord({ knots: [knot(), knot(), knot()] }), cord({ knots: [knot()] }), cord({ parent: 0 })]);
    const run = () => {
      const hanging = new HangingKhipu(khipu);
      const log = recorder();
      for (let i = 0; i < 40; i++) hanging.wear(khipu.cords[i % 3], 0.7, log);
      return log.events;
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(0);
  });

  it('can be tied again from the record', () => {
    const khipu = khipuOf([cord({ length: 4, knots: [knot()] })]);
    const worn = new HangingKhipu(khipu);
    wearOut(worn, 0);
    const again = new HangingKhipu(khipu);
    expect(again.now).toEqual({ cords: 1, knots: 1, value: 10 });
    expect(again.tiedKnots(khipu.cords[0])).toHaveLength(1);
  });
});

describe('relations', () => {
  it('names the cord before, then the subsidiaries, as acting on a cord', () => {
    const khipu = khipuOf([cord({ position: 1 }), cord({ position: 2 }), cord({ parent: 1 }), cord({ parent: 1 })]);
    const relations = relationsInto(khipu.cords[1]);
    expect(relations.map((r) => [r.kind, r.from.index])).toEqual([
      ['neighbour', 0],
      ['subsidiary', 2],
      ['subsidiary', 3],
    ]);
    expect(relations.every((r) => r.to === khipu.cords[1])).toBe(true);
  });

  it('takes a proportion as larger over smaller, and has none where a quantity is missing', () => {
    expect(proportion(20, 60)).toBe(3);
    expect(proportion(60, 20)).toBe(3);
    expect(proportion(7, 7)).toBe(1);
    expect(proportion(0, 60)).toBeNull();
    expect(proportion(null, 60)).toBeNull();
  });
});

describe('KhipuArchive: reading the catalogue', () => {
  const summary = (id: string, over: Partial<KhipuSummary> = {}): KhipuSummary => ({
    id,
    investigatorId: '',
    provenance: null,
    collection: null,
    country: null,
    cords: 0,
    knots: 0,
    value: 0,
    brokenShare: 0,
    unrecordedShare: 0,
    longestCord: 0,
    ...over,
  });

  function reader(schema = SCHEMA_VERSION): JsonReader {
    const files: Record<string, unknown> = {
      'index.json': {
        schema,
        source: 'test',
        stats: {} as ArchiveStats,
        colors: PALETTE,
        khipus: [
          summary('KH0001', { cords: 5, provenance: 'Ica' }),
          summary('KH0002', { cords: 50, collection: 'Museo Larco', country: 'Peru' }),
          summary('KH0003', { cords: 5, investigatorId: 'UR1234' }),
        ],
      },
      'khipus/KH0001.json': khipuData([cord(), cord()], { id: 'KH0001' }),
      'khipus/KH0003.json': khipuData([], { id: 'KH0002' }), // the wrong khipu in the file
    };
    return async (path) => {
      if (!(path in files)) throw new KhipuDataError(`Could not load ${path}.`);
      return files[path];
    };
  }

  it('opens the catalogue and steps through it, wrapping at the ends', async () => {
    const archive = await KhipuArchive.open(reader());
    expect(archive.ids).toEqual(['KH0001', 'KH0002', 'KH0003']);
    expect(archive.has('KH0002')).toBe(true);
    expect(archive.has('KH0404')).toBe(false);
    expect(archive.neighbour('KH0003', 1)).toBe('KH0001');
    expect(archive.neighbour('KH0001', -1)).toBe('KH0003');
  });

  it('finds khipus by number, earlier name, place, collection or country, in the order asked for', async () => {
    const archive = await KhipuArchive.open(reader());
    expect(archive.search('0002').map((k) => k.id)).toEqual(['KH0002']); // part of a number
    expect(archive.search('ur1234').map((k) => k.id)).toEqual(['KH0003']); // the name it went by before
    expect(archive.search('ica').map((k) => k.id)).toEqual(['KH0001']);
    expect(archive.search('LARCO').map((k) => k.id)).toEqual(['KH0002']);
    expect(archive.search('peru').map((k) => k.id)).toEqual(['KH0002']);
    expect(archive.search('', 'cords').map((k) => k.id)).toEqual(['KH0002', 'KH0001', 'KH0003']);
    expect(archive.search('nowhere')).toEqual([]);
  });

  it('loads a khipu as a Khipu', async () => {
    const archive = await KhipuArchive.open(reader());
    const khipu = await archive.load('KH0001');
    expect(khipu.id).toBe('KH0001');
    expect(khipu.cordCount).toBe(2);
    expect(khipu.cords[0].rgb).toEqual([255, 255, 255]);
  });

  it('says so when the data is missing, misfiled, or written for another schema', async () => {
    const archive = await KhipuArchive.open(reader());
    await expect(archive.load('KH0404')).rejects.toThrow(KhipuDataError);
    await expect(archive.load('KH0002')).rejects.toThrow(/Could not load/);
    await expect(archive.load('KH0003')).rejects.toThrow(/does not hold khipu KH0003/);
    await expect(KhipuArchive.open(reader(1))).rejects.toThrow(/schema version 1.*tools\/build_data\.py/);
  });
});
