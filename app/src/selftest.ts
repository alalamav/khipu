/**
 * Sound self-test.
 *
 * The voices are built from Web Audio nodes, so they cannot be unit-tested
 * under Node. This page renders them offline in the browser, measures what
 * comes out, and compares it with what the mappings say should come out:
 * that the operator voice is frequency modulation at the index its patch
 * states, that the resonator rings at the pitches of the knot values for as
 * long as it was asked to, and that the three voices are about as loud as
 * one another.
 *
 * Run `npm run dev` and open /selftest.html. It is not part of the build.
 */
import * as Tone from 'tone';
import { Bus } from './audio/bus';
import { cordFrequency, ringTime, soundOf, type CordSound, type VoiceKind } from './audio/cordSound';
import { endingOf } from './audio/endings';
import { playOperator } from './audio/OperatorVoice';
import { buildOperatorPatch, type Operator, type OperatorPatch } from './audio/operatorPatch';
import { playResonator } from './audio/ResonatorVoice';
import { buildResonatorPatch, valueFrequency } from './audio/resonatorPatch';
import { synthString } from './audio/stringVoice';
import './index.css';
import { HangingKhipu, KhipuArchive, httpReader, mulberry32, type Cord } from './khipu';

const SR = 48000;

// ───────────────────────── rendering ─────────────────────────

type Stereo = [left: Float32Array, right: Float32Array];

/**
 * Render what `build` plays into a bus. `room` is how much reverberation the
 * bus adds: 0 to measure a voice by itself, 0.32 to measure what is heard.
 */
async function render(seconds: number, room: number, build: (bus: Bus) => void): Promise<Stereo> {
  const context = new Tone.OfflineContext(2, seconds, SR);
  Tone.setContext(context);
  build(new Bus(1, room));
  // The browser is asked to render directly. Tone's own render() first runs its clock through the whole
  // length, and that would fire the voices' clean-up timers before a single sample had been computed.
  const raw = context.rawContext as unknown as { startRendering(): Promise<AudioBuffer> };
  const buffer = await raw.startRendering();
  return [buffer.getChannelData(0), buffer.getChannelData(1)];
}

function mono([left, right]: Stereo): Float32Array {
  const out = new Float32Array(left.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (left[i] + right[i]);
  return out;
}

function peak([left, right]: Stereo): number {
  let top = 0;
  for (let i = 0; i < left.length; i++) top = Math.max(top, Math.abs(left[i]), Math.abs(right[i]));
  return top;
}

function rms([left, right]: Stereo, seconds: number): number {
  const n = Math.min(left.length, Math.round(seconds * SR));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += left[i] * left[i] + right[i] * right[i];
  return Math.sqrt(sum / (2 * n));
}

const db = (amplitude: number): number => 20 * Math.log10(Math.max(amplitude, 1e-12));

// ───────────────────────── spectra ─────────────────────────

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cos - im[b] * sin;
        const ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

interface Line {
  hz: number;
  /** Linear amplitude, in units that are the same for every line of one spectrum. */
  level: number;
}

/**
 * The spectral lines in `n` samples (a power of two) of `x` starting at
 * `start` seconds, strongest first, down to `floorDb` below the strongest.
 */
function linesOf(x: Float32Array, start: number, n: number, floorDb = -60): Line[] {
  const from = Math.round(start * SR);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  const half = n / 2;
  const magnitude = new Float64Array(half);
  let top = 0;
  for (let k = 0; k < half; k++) {
    magnitude[k] = Math.hypot(re[k], im[k]);
    top = Math.max(top, magnitude[k]);
  }
  const floor = top * 10 ** (floorDb / 20);
  const maxima: (Line & { bin: number })[] = [];
  for (let k = 2; k < half - 1; k++) {
    if (magnitude[k] < floor || magnitude[k] < magnitude[k - 1] || magnitude[k] <= magnitude[k + 1]) continue;
    // place the peak between bins with a parabola through the log magnitudes
    const a = Math.log(magnitude[k - 1]);
    const b = Math.log(magnitude[k]);
    const c = Math.log(magnitude[k + 1]);
    const shift = (0.5 * (a - c)) / (a - 2 * b + c);
    maxima.push({ bin: k, hz: ((k + shift) * SR) / n, level: Math.exp(b - 0.25 * (a - c) * shift) });
  }
  maxima.sort((p, q) => q.level - p.level);
  // a strong line is flanked by the ripples of the window; they are not lines
  const lines: (Line & { bin: number })[] = [];
  for (const m of maxima) if (!lines.some((l) => Math.abs(l.bin - m.bin) <= 6)) lines.push(m);
  return lines;
}

/** Level of the line nearest `hz`, if there is one within `within` Hz; else 0. */
function levelAt(lines: readonly Line[], hz: number, within: number): number {
  let best = 0;
  let distance = within;
  for (const line of lines) {
    const d = Math.abs(line.hz - hz);
    if (d <= distance) {
      distance = d;
      best = line.level;
    }
  }
  return best;
}

/** Bessel function of the first kind, integer order: the strength of the nth sideband at a modulation index. */
function bessel(order: number, x: number): number {
  const steps = 4000;
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const theta = (Math.PI * i) / steps;
    sum += Math.cos(order * theta - x * Math.sin(theta)) * (i === 0 || i === steps ? 0.5 : 1);
  }
  return sum / steps;
}

// ───────────────────────── reporting ─────────────────────────

const out = document.getElementById('report')!;
let failed = 0;
let passed = 0;

function say(text = ''): void {
  out.textContent += text + '\n';
}

function check(ok: boolean, what: string, detail: string): void {
  if (ok) passed++;
  else failed++;
  say(`${ok ? 'ok  ' : 'FAIL'}  ${what}\n        ${detail}`);
}

const hz = (f: number): string => `${f.toFixed(1)} Hz`;
const fmtDb = (amplitude: number): string => `${db(amplitude).toFixed(1)} dB`;

// ───────────────────────── fixtures ─────────────────────────

function cordSound(over: Partial<CordSound> = {}): CordSound {
  return { length: 30, lightness: 1, termination: 'K', knots: [], pan: 0, integrity: 1, seed: 1, ...over };
}

function operator(frequency: number, index: number, modulators: Operator[] = []): Operator {
  return { cord: 0, kind: 'subsidiary', ratio: 1, ratioOf: 'nothing', octavesDown: 0, frequency, index, modulators };
}

/** Render an operator patch by itself, dry, on a pale knotted cord (which rings for 2.5 s). */
function renderOperator(patch: OperatorPatch, seconds: number): Promise<Stereo> {
  const ending = endingOf(cordSound(), patch.frequency, mulberry32(1));
  return render(seconds, 0, (bus) => playOperator(bus, patch, ending, 0, 1, 0, () => {}));
}

// ───────────────────────── the tests ─────────────────────────

async function operatorTests(): Promise<void> {
  say('OPERATOR VOICE\n');

  // 1. No relations: a sine tone and nothing else.
  {
    const x = mono(await renderOperator({ frequency: 220, modulators: [] }, 1.2));
    const lines = linesOf(x, 0.1, 32768);
    const others = lines.slice(1).filter((l) => Math.abs(l.hz - lines[0].hz) > 10);
    check(
      Math.abs(lines[0].hz - 220) < 0.5 && (others.length === 0 || others[0].level / lines[0].level < 10 ** (-50 / 20)),
      'a cord with no relations is a bare sine tone',
      `strongest line ${hz(lines[0].hz)} (asked for 220.0); ` +
        (others.length ? `next ${hz(others[0].hz)} at ${fmtDb(others[0].level / lines[0].level)}` : 'nothing else within 60 dB'),
    );
  }

  // 2. One modulator: frequency modulation at the stated index, settling to a quarter of it.
  {
    const carrier = 220;
    const modulator = 660;
    const index = 2;
    const x = mono(await renderOperator({ frequency: carrier, modulators: [operator(modulator, index)] }, 2.6));

    // At the touch the index is 2, where the first sidebands are stronger than the carrier.
    const early = linesOf(x, 0.004, 2048, -40);
    const c0 = levelAt(early, carrier, 20);
    const s0 = levelAt(early, carrier + modulator, 20);
    check(
      s0 > c0,
      'at the touch the relationship is heard before the cord',
      `first 43 ms: sideband ${hz(carrier + modulator)} is ${fmtDb(s0 / c0)} against the carrier ` +
        `(index ${index}: expected about ${fmtDb(Math.abs(bessel(1, 1.9) / bessel(0, 1.9)))})`,
    );

    // Long after, the index has settled to 0.25 × 2. The sidebands of true FM are then in the
    // proportions of the Bessel functions J1/J0 and J2/J0 at that index.
    const start = 1.5;
    const n = 32768;
    const settled = (t: number) => index * (0.25 + 0.75 * Math.exp(-t / 0.35));
    const now = 0.5 * (settled(start) + settled(start + n / SR));
    const late = linesOf(x, start, n, -70);
    const c = levelAt(late, carrier, 2);
    const upper = levelAt(late, carrier + modulator, 2) / c;
    const lower = levelAt(late, modulator - carrier, 2) / c;
    const second = levelAt(late, carrier + 2 * modulator, 2) / c;
    const want1 = Math.abs(bessel(1, now) / bessel(0, now));
    const want2 = Math.abs(bessel(2, now) / bessel(0, now));
    const close = (got: number, want: number) => Math.abs(got / want - 1) < 0.08;
    check(
      close(upper, want1) && close(lower, want1) && close(second, want2),
      'the modulation is frequency modulation at the index the patch states',
      `settled index ${now.toFixed(3)}: sidebands at ${hz(carrier + modulator)} and ${hz(modulator - carrier)} are ` +
        `${upper.toFixed(4)} and ${lower.toFixed(4)} of the carrier (J1/J0 = ${want1.toFixed(4)}); ` +
        `second sideband ${second.toFixed(4)} (J2/J0 = ${want2.toFixed(4)})`,
    );
  }

  // 3. A stack: a modulator that is itself modulated adds lines the single modulator cannot make.
  {
    const single = mono(await renderOperator({ frequency: 200, modulators: [operator(400, 1)] }, 1.2));
    const stacked = mono(await renderOperator({ frequency: 200, modulators: [operator(400, 1, [operator(100, 1)])] }, 1.2));
    const a = linesOf(single, 0.02, 16384, -50);
    const b = linesOf(stacked, 0.02, 16384, -50);
    const off = (lines: Line[]) => levelAt(lines, 500, 3) / lines[0].level; // 500 Hz is not 200 ± 400k
    const offGrid = b.filter((l) => Math.abs(l.hz / 100 - Math.round(l.hz / 100)) > 0.03);
    check(
      off(a) < 10 ** (-45 / 20) && off(b) > 10 ** (-30 / 20) && offGrid.length === 0,
      'a subsidiary of a subsidiary modulates the modulator',
      `line at 500 Hz: ${off(a) ? fmtDb(off(a)) : 'absent'} with one modulator, ${fmtDb(off(b))} with the stack; ` +
        `all ${b.length} lines of the stack fall on multiples of 100 Hz`,
    );
  }
}

async function resonatorTests(): Promise<void> {
  say('\nRESONATOR VOICE\n');

  const knots = [
    { position: 10, type: 'S' as const, count: 2, value: 20, direction: 'S' as const },
    { position: 20, type: 'L' as const, count: 1, value: 5, direction: 'Z' as const },
  ];
  const lightness = 0.8;
  const natural = ringTime(lightness);

  for (const ring of [1, 0.5]) {
    const patch = buildResonatorPatch(cordSound({ length: 40, lightness, knots }), ring);
    const stereo = await render(2.4, 0, (bus) => playResonator(bus, patch, 0, 1, 0, () => {}));
    const x = mono(stereo);

    const want = knots.map((k) => valueFrequency(k.value));
    const lines = linesOf(x, 0.6, 32768, -50);
    const got = want.map((f) => lines.find((l) => Math.abs(l.hz - f) < 2));
    if (ring === 1) {
      check(
        got.every(Boolean) && lines.length === want.length,
        'the filters ring at the pitches of the knot values',
        `values 20 and 5 should ring at ${want.map(hz).join(' and ')}; lines found: ${lines.map((l) => hz(l.hz)).join(', ')}`,
      );
    }

    // Ring time: how fast the line of the value 20 falls, between two moments after the last strike.
    const t1 = 0.7;
    const t2 = t1 + 0.45 * natural * ring;
    const n = 8192;
    const l1 = levelAt(linesOf(x, t1, n, -50), want[0], 6);
    const l2 = levelAt(linesOf(x, t2, n, -50), want[0], 6);
    const t60 = (60 * (t2 - t1)) / (db(l1) - db(l2));
    const asked = natural * ring;
    check(
      Math.abs(t60 / asked - 1) < 0.1,
      `ring ${ring}: a resonance takes the time it was given to die away`,
      `the ${hz(want[0])} line falls 60 dB in ${t60.toFixed(2)} s; asked for ${asked.toFixed(2)} s`,
    );
    if (ring === 1) say(`        peak of this cord alone, before the room: ${fmtDb(peak(stereo))}`);
  }

  // No knots: nothing rings.
  {
    const patch = buildResonatorPatch(cordSound({ length: 40, lightness }), 1);
    const stereo = await render(1.5, 0, (bus) => playResonator(bus, patch, 0, 1, 0, () => {}));
    const tail = rms([stereo[0].subarray(SR * 0.3), stereo[1].subarray(SR * 0.3)], 1);
    check(
      patch.resonances.length === 0 && tail < 10 ** (-80 / 20),
      'a cord with no knots only taps',
      `after the tap, from 0.3 s on: ${fmtDb(tail)} rms`,
    );
  }
}

/** Play one cord of a hanging khipu in a voice, as the engine does. */
function pluck(bus: Bus, hanging: HangingKhipu, cord: Cord, voice: VoiceKind): void {
  const sound = soundOf(hanging, cord);
  if (voice === 'string') {
    const samples = synthString(sound, SR);
    const source = new Tone.ToneBufferSource({ url: Tone.ToneAudioBuffer.fromArray([samples.L, samples.R]) });
    source.connect(bus.input);
    source.start(0);
  } else if (voice === 'operator') {
    const ending = endingOf(sound, cordFrequency(sound.length), mulberry32(sound.seed || 1));
    playOperator(bus, buildOperatorPatch(hanging, cord, 1), ending, sound.pan, 1, 0, () => {});
  } else {
    playResonator(bus, buildResonatorPatch(sound, 1), sound.pan, 1, 0, () => {});
  }
}

async function levelTests(): Promise<void> {
  say('\nLEVELS, as heard (through the compressor and the room)\n');

  const archive = await KhipuArchive.open(httpReader(import.meta.env.BASE_URL + 'data'));
  const khipu = await archive.load('KH0279');
  const hanging = new HangingKhipu(khipu);
  // cords that every voice can sound: a length to give a pitch, knots to give resonances
  const cords = khipu.pendants.filter((c) => c.length && c.knots.length).slice(0, 12);
  const voices: VoiceKind[] = ['string', 'operator', 'resonator'];
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

  const loudness: Record<string, number> = {};
  for (const voice of voices) {
    const peaks: number[] = [];
    const levels: number[] = [];
    for (const cord of cords) {
      const stereo = await render(3, 0.32, (bus) => pluck(bus, hanging, cord, voice));
      peaks.push(db(peak(stereo)));
      levels.push(db(rms(stereo, 1)));
    }
    loudness[voice] = median(levels);
    say(
      `        ${voice.padEnd(9)} one cord: peak ${Math.min(...peaks).toFixed(1)} to ${Math.max(...peaks).toFixed(1)} dB, ` +
        `median ${median(peaks).toFixed(1)}; rms over the first second, median ${median(levels).toFixed(1)} dB`,
    );
  }
  for (const voice of voices.slice(1)) {
    const difference = loudness[voice] - loudness.string;
    check(
      Math.abs(difference) <= 6,
      `the ${voice} voice is about as loud as the string voice`,
      `${difference >= 0 ? '+' : ''}${difference.toFixed(1)} dB against the string voice, over ${cords.length} cords of ${khipu.id}`,
    );
  }

  // The most that can sound at once must not clip.
  const most: Record<VoiceKind, number> = { string: 30, operator: 16, resonator: 20 };
  const crowd = khipu.pendants.filter((c) => c.length);
  for (const voice of voices) {
    const stereo = await render(3, 0.32, (bus) => {
      for (const cord of crowd.slice(0, most[voice])) pluck(bus, hanging, cord, voice);
    });
    const top = peak(stereo);
    check(top < 1, `${most[voice]} cords at once in the ${voice} voice do not clip`, `peak ${fmtDb(top)} (0 dB is full scale)`);
  }
}

/**
 * The hum's door: what comes in at `under` gives way while something sounds at `input`, and comes back.
 * A steady 3 kHz tone stands for the hum, and a second of a 200 Hz tone for a cord. The same is rendered
 * with the steady tone at `input`, where nothing gives way, so that what the compressor does is left out.
 */
async function humTests(): Promise<void> {
  say('\nTHE HUM, under the voices\n');

  const probe = 3000;
  const voice = 0.12;
  const at = async (door: 'under' | 'input'): Promise<number[]> => {
    const stereo = await render(4, 0, (bus) => {
      const steady = new Tone.ToneOscillatorNode({ frequency: probe, type: 'sine' });
      const steadyLevel = new Tone.Gain(0.05);
      steady.chain(steadyLevel, bus[door]);
      steady.start(0);
      const cord = new Tone.ToneOscillatorNode({ frequency: 200, type: 'sine' });
      const cordLevel = new Tone.Gain(voice);
      cord.chain(cordLevel, bus.input);
      cord.start(1);
      cord.stop(2);
    });
    const x = mono(stereo);
    // before the cord, while it sounds, and well after it
    return [0.4, 1.5, 3.5].map((start) => {
      const line = linesOf(x, start, 8192).find((l) => Math.abs(l.hz - probe) < 20);
      return line ? line.level : 0;
    });
  };
  const under = await at('under');
  const plain = await at('input');
  const [before, during, after] = under.map((level, i) => db(level / plain[i]));
  // a sine of amplitude a is 2a/pi once rectified and smoothed
  const expected = db(1 - 0.45 * Math.tanh((6 * 2 * voice) / Math.PI));
  check(Math.abs(before) < 0.1, 'in silence the hum is not turned down', `${before.toFixed(2)} dB`);
  check(
    Math.abs(during - expected) < 0.4,
    'while a cord sounds the hum gives way a little',
    `${during.toFixed(2)} dB under a tone at ${fmtDb(voice)}; the curve says ${expected.toFixed(2)} dB`,
  );
  check(Math.abs(after) < 0.1, 'and it comes back when the cord is over', `${after.toFixed(2)} dB, 1.5 s after`);
}

async function run(): Promise<void> {
  out.textContent = '';
  say(`Just Ends: sound self-test, rendered offline at ${SR} Hz\n`);
  try {
    await operatorTests();
    await resonatorTests();
    await humTests();
    await levelTests();
    say(`\n${passed} passed, ${failed} failed`);
  } catch (error) {
    failed++;
    say(`\nThe self-test stopped: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  document.title = `${failed ? 'FAILED' : 'passed'}: sound self-test`;
  out.dataset.done = failed ? 'failed' : 'passed';
}

void run();
