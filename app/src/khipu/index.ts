/**
 * The khipu library: the typed data model and the classes for reading it and
 * working with it. Nothing in this folder depends on React, three.js or
 * Tone.js, so it can be used on its own.
 *
 *   const archive = await KhipuArchive.open(httpReader('data'));
 *   const khipu = await archive.load('KH0279');     // the record: immutable
 *   const hanging = new HangingKhipu(khipu);        // what is left of it: mutable
 *   hanging.wear(khipu.pendants[0], 0.45, listener);
 */
export * from './schema';
export * from './vocabulary';
export { Khipu, Cord, Knot, type Palette, type PrimaryCord, type Rgb } from './Khipu';
export { KhipuArchive, KhipuDataError, httpReader, type CatalogueOrder, type JsonReader } from './KhipuArchive';
export { HangingKhipu, type CordState, type Totals, type WearListener } from './HangingKhipu';
export { layoutKhipu, type CordLayout, type KhipuLayout } from './layout';
export { proportion, relationsInto, type CordRelation, type RelationKind } from './relations';
export { mulberry32 } from './random';
