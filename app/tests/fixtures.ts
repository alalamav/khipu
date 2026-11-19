/** Small hand-made khipus for the tests, and a reader for the real data files. */
import { readFile } from 'node:fs/promises';
import {
  Khipu,
  SCHEMA_VERSION,
  type CordData,
  type JsonReader,
  type KhipuData,
  type KnotData,
  type Palette,
  type WearListener,
} from '../src/khipu';

export const PALETTE: Palette = {
  W: { rgb: [255, 255, 255], name: 'white' },
  KB: { rgb: [40, 30, 20], name: 'dark brown' },
};

export function knot(over: Partial<KnotData> = {}): KnotData {
  return { position: null, type: 'S', count: 1, value: 10, direction: null, ...over };
}

/** A pendant on the main cord unless `parent` says otherwise: white, 30 cm, knotted at the end, no knots. */
export function cord(over: Partial<CordData> = {}): CordData {
  return {
    parent: null,
    level: over.parent == null ? 1 : 2,
    up: false,
    position: null,
    positionRecorded: over.position != null,
    length: 30,
    color: 'W',
    colorOperator: null,
    color2: null,
    termination: 'K',
    twist: 'S',
    attachment: 'R',
    fiber: 'CN',
    group: 1,
    knots: [],
    note: '',
    ...over,
  };
}

export function khipuData(cords: CordData[], over: Partial<KhipuData> = {}): KhipuData {
  return {
    schema: SCHEMA_VERSION,
    id: 'KH9001',
    investigatorId: 'TEST01',
    provenance: null,
    discoveredBy: null,
    discoveredOn: null,
    collection: { name: null, city: null, country: null },
    notes: '',
    primaryCord: { length: 20, color: null, beginning: null, termination: null, notes: '' },
    cords,
    ...over,
  };
}

export function khipuOf(cords: CordData[], over: Partial<KhipuData> = {}): Khipu {
  return new Khipu(khipuData(cords, over), PALETTE);
}

/** A listener that writes down what it is told, in order. */
export function recorder(): WearListener & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    knotFell: (c, k) => events.push(`knot ${c.index}.${k.index}`),
    cordSnapped: (c) => events.push(`snap ${c.index}`),
    cordFell: (c) => events.push(`fall ${c.index}`),
  };
}

/** Reads the app's data files from disk, as httpReader reads them over HTTP. */
export const diskReader: JsonReader = async (path) =>
  JSON.parse(await readFile(new URL(`../public/data/${path}`, import.meta.url), 'utf8'));
