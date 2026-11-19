/**
 * What the interface shows, as plain data.
 *
 * The piece runs every frame; the interface is redrawn only when one of these
 * views changes. Each is built from the record (archive) and from what is left
 * (now), which the interface always shows side by side.
 */
import { PITCH_K, cordFrequency, soundOf, type VoiceKind } from '../audio/cordSound';
import { endingOf } from '../audio/endings';
import { buildOperatorPatch, type Operator } from '../audio/operatorPatch';
import { buildResonatorPatch } from '../audio/resonatorPatch';
import { knotPartial } from '../audio/stringVoice';
import {
  ATTACHMENT,
  COLOR_OPERATOR,
  FIBER,
  KNOT_TYPE,
  TERMINATION,
  type Cord,
  type HangingKhipu,
  type Khipu,
  type Palette,
  type Rgb,
} from '../khipu';

export interface HeaderView {
  id: string;
  investigatorId: string;
  provenance: string | null;
  held: string | null;
  /** Short statements about the main cord and about what was not recorded. */
  facts: string[];
}

export interface TallyView {
  cords: [now: number, archive: number];
  knots: [now: number, archive: number];
  value: [now: number, archive: number];
  readings: number;
  reties: number;
  debug: string | null;
}

export interface KhipuRecordView {
  kind: 'khipu';
  id: string;
  provenance: string | null;
  discoveredBy: string | null;
  discoveredOn: string | null;
  held: string | null;
  investigatorId: string;
  cords: number;
  knots: number;
  value: number;
  /** The recorder's note on the main cord. */
  quote: string;
  note: string;
}

export interface Coded {
  code: string;
  label: string;
}

/** One line of the voice read-out: a knot's partial, a modulator, or a resonance. */
export interface VoiceLine {
  /** How deep in a stack of modulators this line is; 0 for the first level. */
  level: number;
  text: string;
}

export interface CordRowView {
  kind: 'cord';
  number: number;
  total: number;
  cordKind: string;
  length: { archive: number | null; now: string; lost: boolean };
  colour: { code: string; name: string; rgb: Rgb | null; operator: string | null; code2: string | null; rgb2: Rgb | null } | null;
  fiber: Coded | null;
  twist: string | null;
  attachment: Coded | null;
  ending: { archive: Coded | null; now: string; lost: boolean };
  knots: { archive: string[]; now: string; lost: boolean };
  value: { archive: number; now: number; lost: boolean };
  /** The archive's definition of the way this cord ends. */
  definition: string | null;
  note: string;
  /** What the current voice makes of this cord as it is now; null once the cord has fallen. */
  voice: { title: string; lines: VoiceLine[] } | null;
}

export type LedgerView = KhipuRecordView | CordRowView;

function heldAt(khipu: Khipu): string | null {
  const c = khipu.data.collection;
  return [c.name, c.city, c.country].filter(Boolean).join(', ') || null;
}

export function headerOf(khipu: Khipu): HeaderView {
  const facts: string[] = [];
  if (!khipu.cords.length) {
    facts.push('the archive holds a number for this khipu, and no cords');
  } else {
    facts.push(khipu.primary.length ? `main cord ${khipu.primary.length} cm` : 'main cord length not recorded');
    const recorded = khipu.positionsRecorded;
    // The data keeps recorded positions only where at least half of a khipu's pendants have one.
    if (recorded === 0) facts.push('pendant positions not recorded, or too few to place the rest: shown evenly spaced');
    else if (recorded < 1) {
      facts.push(`position not recorded for ${Math.max(1, Math.round((1 - recorded) * 100))}% of pendants, shown at a nominal spacing`);
    }
  }
  return {
    id: khipu.id,
    investigatorId: khipu.data.investigatorId,
    provenance: khipu.data.provenance,
    held: heldAt(khipu),
    facts,
  };
}

export function tallyOf(hanging: HangingKhipu, reties: number, debug: string | null): TallyView {
  const { archive, now } = hanging;
  return {
    cords: [now.cords, archive.cords],
    knots: [now.knots, archive.knots],
    value: [now.value, archive.value],
    readings: hanging.readings,
    reties,
    debug,
  };
}

export function recordOf(khipu: Khipu): KhipuRecordView {
  return {
    kind: 'khipu',
    id: khipu.id,
    provenance: khipu.data.provenance,
    discoveredBy: khipu.data.discoveredBy,
    discoveredOn: khipu.data.discoveredOn,
    held: heldAt(khipu),
    investigatorId: khipu.data.investigatorId,
    cords: khipu.cordCount,
    knots: khipu.knotCount,
    value: khipu.totalValue,
    quote: khipu.primary.notes,
    note: khipu.data.notes,
  };
}

const round = (n: number, places = 2) => String(Math.round(n * 10 ** places) / 10 ** places);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const octaves = (n: number) => plural(n, 'octave');

/** The string voice: the pitch of the length, and the partial each knot sounds on it. */
function stringReading(hanging: HangingKhipu, cord: Cord): NonNullable<CordRowView['voice']> {
  const sound = soundOf(hanging, cord);
  const f0 = cordFrequency(sound.length);
  const lines: VoiceLine[] = [];
  for (const knot of hanging.tiedKnots(cord)) {
    const partial = knotPartial(f0, sound.length || 0, knot.position);
    const how = knot.isLong ? `a roll of ${knot.turns}` : knot.isFigureEight ? 'beating' : plural(Math.max(1, Math.min(knot.count, 9)), 'ping');
    const where = knot.position !== null ? `knot at ${knot.position} cm` : 'knot, position not recorded';
    const what = partial ? `×${round(partial / f0)} of the cord · ${Math.round(partial)} Hz` : 'no pitch, only a tick';
    lines.push({ level: 0, text: `${where} · ${what} · ${how}` });
  }
  if (!f0 || !sound.length) return { title: 'string · no pitch: length not recorded, only breath', lines };

  // 6600 / cm, and how far that had to be moved to come into range
  const measured = PITCH_K / sound.length;
  const moved = Math.round(Math.log2(measured / f0));
  const folded = moved ? ` (${Math.round(measured)} Hz, ${octaves(Math.abs(moved))} ${moved > 0 ? 'down' : 'up'})` : '';
  // The ring is asked of the same plan the other voices end by; its numbers are the string voice's own.
  const ring = endingOf(sound, f0, () => 0.5).strands[0]?.ring;
  return { title: `string · ${Math.round(f0)} Hz${folded}` + (ring ? ` · rings ${round(ring, 1)} s` : ''), lines };
}

function operatorLines(operators: readonly Operator[], level: number, out: VoiceLine[]): void {
  for (const op of operators) {
    let proportion = op.ratioOf === 'nothing' ? '×1, no proportion' : `×${round(op.ratio)} of ${op.ratioOf}`;
    // What sounds is not always what the record gives: a modulator above 6 kHz is lowered by octaves.
    if (op.octavesDown) proportion += `, ${octaves(op.octavesDown)} down to ×${round(op.ratio / 2 ** op.octavesDown)}`;
    out.push({
      level,
      text: `${op.kind} cord ${op.cord + 1} · ${proportion} · ${Math.round(op.frequency)} Hz · depth ${round(op.index)}`,
    });
    operatorLines(op.modulators, level + 1, out);
  }
}

function voiceOf(hanging: HangingKhipu, cord: Cord, voice: VoiceKind, depth: number, ring: number): CordRowView['voice'] {
  if (hanging.state(cord).gone) return null;
  if (voice === 'string') return stringReading(hanging, cord);
  if (voice === 'operator') {
    const patch = buildOperatorPatch(hanging, cord, depth);
    if (!patch.frequency) return { title: 'operator · no pitch: length not recorded, only breath', lines: [] };
    const lines: VoiceLine[] = [];
    operatorLines(patch.modulators, 0, lines);
    const title = `operator · sine ${Math.round(patch.frequency)} Hz` + (lines.length ? ', modulated by' : ', unmodulated');
    return { title, lines };
  }
  // One line for each cluster of knots still on the cord, whether or not it rings.
  const patch = buildResonatorPatch(soundOf(hanging, cord), ring);
  const lines: VoiceLine[] = patch.clusters.map((c) => {
    if (c.silent === 'no value') return { level: 0, text: 'a knot the archive gives no value · nothing rings' };
    const note = `${c.value} · ${Math.round(c.frequency)} Hz`;
    if (c.silent) return { level: 0, text: `${note} · ${c.silent}` };
    return { level: 0, text: `${note} · ${plural(c.strikes, 'strike')}` + (c.filters > 1 ? ` · ${c.filters} filters` : '') };
  });
  const rings = patch.resonances.length > 0;
  const title = rings ? 'resonator · rings at' : `resonator · ${lines.length ? 'nothing rings' : 'no knots'}: only the tap`;
  return { title, lines };
}

export function rowOf(
  hanging: HangingKhipu,
  cord: Cord,
  palette: Palette,
  voice: VoiceKind,
  depth: number,
  ring: number,
): CordRowView {
  const state = hanging.state(cord);
  const termination = cord.termination ? TERMINATION[cord.termination] : null;
  const tied = hanging.tiedKnots(cord);
  const valueNow = hanging.valueNow(cord);

  const knots = cord.knots.map((k) => {
    const type = k.type ? KNOT_TYPE[k.type] : 'unknown type';
    return (
      (k.count > 1 ? `${k.count}× ` : '') +
      `${type} (${k.value})` +
      (k.position !== null ? ` at ${k.position} cm` : '') +
      (k.direction ? ` ${k.direction}` : '')
    );
  });

  return {
    kind: 'cord',
    number: cord.index + 1,
    total: hanging.archive.cords,
    cordKind: cord.kind,
    length: {
      archive: cord.length,
      now: state.gone ? 'on the floor' : state.length ? `${Math.round(state.length * 10) / 10} cm` : '—',
      lost: state.gone || (cord.length !== null && state.length !== null && state.length < cord.length),
    },
    colour: cord.color
      ? {
          code: cord.color,
          name: palette[cord.color]?.name ?? '',
          rgb: cord.rgb,
          operator: cord.color2 ? (cord.colorOperator && COLOR_OPERATOR[cord.colorOperator]) || 'with' : null,
          code2: cord.color2,
          rgb2: cord.rgb2,
        }
      : null,
    fiber: cord.fiber ? { code: cord.fiber, label: FIBER[cord.fiber] } : null,
    twist: cord.twist,
    attachment: cord.attachment ? { code: cord.attachment, label: ATTACHMENT[cord.attachment] } : null,
    ending: {
      archive: cord.termination && termination ? { code: cord.termination, label: termination.label } : null,
      now: state.gone ? 'fallen' : state.snapped ? 'broken' : termination ? termination.label : '—',
      lost: state.gone || state.snapped,
    },
    knots: {
      archive: knots,
      now: cord.knots.length ? `${tied.length} of ${cord.knots.length}` : '—',
      lost: tied.length < cord.knots.length,
    },
    value: { archive: cord.value, now: valueNow, lost: valueNow < cord.value },
    definition: termination ? termination.definition : null,
    note: cord.note,
    voice: voiceOf(hanging, cord, voice, depth, ring),
  };
}
