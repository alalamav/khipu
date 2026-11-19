/**
 * Reading the archive.
 *
 * KhipuArchive opens the catalogue and loads khipus on demand. It does not
 * know where the files live: it is given a function that returns the parsed
 * JSON at a path under the data folder, so the same class reads over HTTP in
 * the browser and from disk in tests and tools.
 */
import { Khipu, type Palette } from './Khipu';
import {
  SCHEMA_VERSION,
  type ArchiveIndex,
  type ArchiveStats,
  type KhipuData,
  type KhipuSummary,
} from './schema';

/** Returns the parsed JSON found at `path`, relative to the data folder. */
export type JsonReader = (path: string) => Promise<unknown>;

export type CatalogueOrder = 'id' | 'cords' | 'knots' | 'brokenShare' | 'unrecordedShare';

/** The data files are missing, unreadable, or written for another schema. */
export class KhipuDataError extends Error {
  constructor(message: string) {
    super(`${message} Rebuild the data with: python3 tools/build_data.py`);
    this.name = 'KhipuDataError';
  }
}

/** A reader that fetches from `baseUrl`, for use in the browser. */
export function httpReader(baseUrl: string): JsonReader {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return async (path) => {
    let response: Response;
    try {
      response = await fetch(base + path);
    } catch {
      throw new KhipuDataError(`Could not reach ${base + path}.`);
    }
    if (!response.ok) throw new KhipuDataError(`Could not load ${path} (HTTP ${response.status}).`);
    try {
      return await response.json();
    } catch {
      throw new KhipuDataError(`${path} is not JSON.`);
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function checkSchema(value: unknown, path: string): asserts value is { schema: number } {
  if (!isRecord(value) || typeof value.schema !== 'number') {
    throw new KhipuDataError(`${path} is not a khipu data file.`);
  }
  if (value.schema !== SCHEMA_VERSION) {
    throw new KhipuDataError(`${path} is schema version ${value.schema}; this app reads version ${SCHEMA_VERSION}.`);
  }
}

function asIndex(value: unknown, path: string): ArchiveIndex {
  checkSchema(value, path);
  const v = value as Partial<ArchiveIndex>;
  if (!Array.isArray(v.khipus) || !isRecord(v.colors) || !isRecord(v.stats)) {
    throw new KhipuDataError(`${path} is missing its catalogue, colours or statistics.`);
  }
  return value as ArchiveIndex;
}

function asKhipu(value: unknown, path: string, id: string): KhipuData {
  checkSchema(value, path);
  const v = value as Partial<KhipuData>;
  if (v.id !== id || !Array.isArray(v.cords) || !isRecord(v.primaryCord) || !isRecord(v.collection)) {
    throw new KhipuDataError(`${path} does not hold khipu ${id}.`);
  }
  return value as KhipuData;
}

export class KhipuArchive {
  /** Open the catalogue. */
  static async open(read: JsonReader): Promise<KhipuArchive> {
    return new KhipuArchive(asIndex(await read('index.json'), 'index.json'), read);
  }

  readonly index: ArchiveIndex;
  /** Every khipu number, in catalogue order. */
  readonly ids: readonly string[];

  private readonly read: JsonReader;
  private readonly byId: Map<string, KhipuSummary>;

  private constructor(index: ArchiveIndex, read: JsonReader) {
    this.index = index;
    this.read = read;
    this.ids = index.khipus.map((k) => k.id);
    this.byId = new Map(index.khipus.map((k) => [k.id, k]));
  }

  get stats(): ArchiveStats {
    return this.index.stats;
  }

  /** The archive's colour chart. */
  get palette(): Palette {
    return this.index.colors;
  }

  get summaries(): readonly KhipuSummary[] {
    return this.index.khipus;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  summary(id: string): KhipuSummary | undefined {
    return this.byId.get(id);
  }

  /** The khipu `step` places after `id` in the catalogue, wrapping around. */
  neighbour(id: string, step: number): string {
    const n = this.ids.length;
    const i = Math.max(0, this.ids.indexOf(id));
    return this.ids[(((i + step) % n) + n) % n];
  }

  /** Load one khipu. */
  async load(id: string): Promise<Khipu> {
    if (!this.has(id)) throw new KhipuDataError(`There is no khipu ${id} in the catalogue.`);
    const path = `khipus/${id}.json`;
    return new Khipu(asKhipu(await this.read(path), path, id), this.palette);
  }

  /**
   * Catalogue lines matching `query` (number, earlier name, place, collection
   * or country), in the given order. Every order but 'id' is largest first.
   */
  search(query: string, order: CatalogueOrder = 'id'): KhipuSummary[] {
    const q = query.trim().toLowerCase();
    const found = this.index.khipus.filter((k) => {
      if (!q) return true;
      const hay = `${k.id} ${k.investigatorId} ${k.provenance ?? ''} ${k.collection ?? ''} ${k.country ?? ''}`;
      return hay.toLowerCase().includes(q);
    });
    if (order !== 'id') found.sort((a, b) => b[order] - a[order] || (a.id < b.id ? -1 : 1));
    return found;
  }
}
