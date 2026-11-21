/**
 * The output every voice plays into, and the few sounds they share.
 *
 *   voices -> input -+-> compressor -> limiter -> trim -> master -> speakers
 *                    +-> room -> wet -+
 *
 * What happens on the floor (a grain landing, a cord parting) comes in by another
 * door, and is heard from further off: less of it direct, more of it from the room,
 * a little late and duller, and repeated by an echo.
 *
 *   door -+-> floor -+-> dry ------------------------> compressor
 *         |          +-> late -> dark -> send --------> room
 *         +-> echo -> band -+-> out -+----------------> compressor
 *               ^           |        +-> send --------> room
 *               +- feedback +
 *
 * There are two doors, each with an echo of its own. Each time round, an echo passes a
 * band-pass filter that is on the move: upward in one echo, downward in the other. So the
 * repeats of a sound climb, or sink. Which door a sound takes is drawn by lot for each cord.
 * The echo's time is set by the main cord, and it grows as the khipu wears away.
 *
 * A cord landing takes a door of its own, to a third echo that takes half as long again to come
 * back and whose band settles downward a little: three of the knots' echoes to two of the cords'.
 *
 * The hum comes in by a third door, `under`, and gives way to the voices: the level of what
 * arrives at `input` is followed, and the hum is turned down a little while they sound.
 *
 *   input -> rectify -> smooth -> how far down -+
 *                                               v (gain)
 *   hum ------------------------------------> under -+-> compressor
 *                                                    +-> room
 *
 * A Bus builds its nodes in whatever Tone context is current, so the same
 * class serves the live context and offline rendering (see selftest.ts).
 */
import * as Tone from 'tone';
import { mulberry32 } from '../khipu';
import { breathCurve, pinkNoise, type Breath } from './breath';

/** Seconds of pink noise kept for breath. A breath can last longer: the noise goes round. */
const PINK_SECONDS = 4;
/** The limiter acts above this level, in dB below full scale… */
const LIMIT_DB = -3;
/** …letting 1 dB out for every this many dB that come in. */
const LIMIT_RATIO = 20;

/** The floor's sounds reach the room this long after they are made. */
const FLOOR_LATE = 0.03;
/**
 * How the floor is heard on a whole khipu (0) and on a bare one (1). As the khipu wears away
 * there is less of the thing itself and more of what comes back from it.
 */
const FLOOR = {
  dry: [0.55, 0.2],
  /** Into the room, which `wet` then scales like everything else. */
  send: [2, 3.5],
  feedback: [0.3, 0.68],
  echo: [0.6, 1.2],
} as const;
/** How much of the echoes goes into the room, which `wet` then scales like everything else. */
const ECHO_ROOM = 2.5;
/** Where an echo's band-pass starts, in Hz, and how far it travels: up to 4 times that, or down to a quarter. */
const BAND_FROM = 800;
const BAND_SPAN = 4;
const BAND_Q = 0.9;
/** The band crosses its span in this many repeats of the echo. */
const BAND_REPEATS = 7;
/** The echo of the cords that land: its time as a multiple of the other two, and where its band ends up, in Hz. */
const LANDING_TURNS = 1.5;
const LANDING_BAND_TO = 500;

/**
 * How far the hum gives way to the voices. The level at `input` is followed (rectified, then
 * smoothed by a low-pass at DUCK_SMOOTH Hz), and the hum's gain is 1 - DUCK_DEPTH * tanh(DUCK_SENSE * level):
 * about 2 dB down under one cord, and never more than 5 dB.
 */
const DUCK_DEPTH = 0.45;
const DUCK_SENSE = 6;
const DUCK_SMOOTH = 6;

/** One echo: what comes in at its door is repeated, through a band-pass that moves one way. */
interface EchoLine {
  door: Tone.Gain;
  delay: Tone.Delay;
  band: Tone.BiquadFilter;
  feedback: Tone.Gain;
  /** Where the band ends up, in Hz. */
  bandTo: number;
  /** When the band's present journey is over, in audio time. */
  arrives: number;
  /** How long it takes to come back, as a multiple of the floor's echo time. */
  turns: number;
}

function between([whole, bare]: readonly [number, number], erosion: number): number {
  return whole + (bare - whole) * Math.max(0, Math.min(1, erosion || 0));
}

function clampPan(pan: number): number {
  return Math.max(-1, Math.min(1, pan || 0));
}

export class Bus {
  /** Voices connect here. */
  readonly input: Tone.Gain;
  /** The hum connects here: it is heard under the voices, and gives way to them a little. */
  readonly under: Tone.Gain;
  /** A very short smooth pulse: what strikes the resonators. Its samples add up to 1. */
  readonly pulse: Tone.ToneAudioBuffer;
  /** A cord that is torn or cut stops with a crack. Without, it stops just the same, and silently. */
  clicks = true;
  /** What was not recorded, and wear, are heard as breath. Without, they are silence. */
  breaths = true;

  private readonly master: Tone.Gain;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Compressor;
  private readonly trim: Tone.Gain;
  private readonly room: Tone.Convolver;
  private readonly wet: Tone.Gain;
  private readonly rectify: Tone.WaveShaper;
  private readonly smooth: Tone.BiquadFilter;
  private readonly duck: Tone.WaveShaper;
  private readonly ducking: Tone.Gain;
  private readonly floorDry: Tone.Gain;
  private readonly floorLate: Tone.Delay;
  private readonly floorDark: Tone.BiquadFilter;
  private readonly floorSend: Tone.Gain;
  private readonly floor: Tone.Gain;
  /** The echo whose repeats climb, and the one whose repeats sink. */
  private readonly rising: EchoLine;
  private readonly sinking: EchoLine;
  /** The echo of the cords that land: slower than the other two. */
  private readonly landing: EchoLine;
  private readonly echoOut: Tone.Gain;
  private readonly echoSend: Tone.Gain;
  private echoTime = 0.3;
  private readonly noise: Tone.ToneAudioBuffer;
  private readonly pink: Tone.ToneAudioBuffer;
  private readonly pulseSamples: Float32Array;

  /**
   * @param volume level of the output, 0 to 1
   * @param room how much of the room is mixed in; 0 is dry
   */
  constructor(volume = 0.8, room = 0.32) {
    this.master = new Tone.Gain(volume).toDestination();
    // A last guard, so that the output stays under full scale however many cords sound at once.
    this.limiter = new Tone.Compressor({ threshold: LIMIT_DB, knee: 0, ratio: LIMIT_RATIO, attack: 0.001, release: 0.08 });
    // A Web Audio compressor adds a fixed gain of its own: 0.6 of what it would take off a
    // full-scale signal, in dB. The trim removes it, so that below its threshold the limiter changes nothing.
    this.trim = new Tone.Gain(Tone.dbToGain(0.6 * LIMIT_DB * (1 - 1 / LIMIT_RATIO)));
    this.limiter.chain(this.trim, this.master);

    this.compressor = new Tone.Compressor({ threshold: -16, ratio: 4, attack: 0.004, release: 0.25 });
    this.compressor.connect(this.limiter);
    this.input = new Tone.Gain(1);
    this.input.connect(this.compressor);

    const sr = this.input.context.sampleRate;
    this.room = new Tone.Convolver();
    this.room.buffer = Tone.ToneAudioBuffer.fromArray(roomImpulse(3.2, sr));
    this.wet = new Tone.Gain(room);
    this.input.chain(this.room, this.wet, this.compressor);

    // The hum, turned down by what the voices are doing. The curves have a middle sample, so that
    // silence at `input` is exactly no change.
    this.under = new Tone.Gain(1);
    this.under.fan(this.compressor, this.room);
    this.rectify = new Tone.WaveShaper((x) => Math.abs(x), 1025);
    // (a low-pass's Q is in dB: -6 is critically damped, so the hum's level does not overshoot)
    this.smooth = new Tone.BiquadFilter({ type: 'lowpass', frequency: DUCK_SMOOTH, Q: -6 });
    this.duck = new Tone.WaveShaper((x) => -DUCK_DEPTH * Math.tanh(DUCK_SENSE * Math.max(0, x)), 1025);
    // (Tone sets a parameter to nothing when one of its signal operators is connected to it, and a
    // wave shaper is one: a plain gain goes between, so that what comes is added to the 1 that is there.)
    this.ducking = new Tone.Gain(1);
    this.input.chain(this.rectify, this.smooth, this.duck, this.ducking);
    this.ducking.connect(this.under.gain);

    this.floor = new Tone.Gain(1);
    this.floorDry = new Tone.Gain(between(FLOOR.dry, 0));
    this.floor.chain(this.floorDry, this.compressor);
    this.floorLate = new Tone.Delay(FLOOR_LATE, 0.1);
    this.floorDark = new Tone.BiquadFilter({ type: 'lowpass', frequency: Math.min(2400, this.ceiling), Q: 0 });
    this.floorSend = new Tone.Gain(between(FLOOR.send, 0));
    this.floor.chain(this.floorLate, this.floorDark, this.floorSend, this.room);
    // The echoes. They are heard directly, and from the room.
    this.echoOut = new Tone.Gain(between(FLOOR.echo, 0));
    this.echoOut.connect(this.compressor);
    this.echoSend = new Tone.Gain(ECHO_ROOM);
    this.echoOut.chain(this.echoSend, this.room);
    this.rising = this.echoLine(BAND_FROM * BAND_SPAN);
    this.sinking = this.echoLine(BAND_FROM / BAND_SPAN);
    this.landing = this.echoLine(LANDING_BAND_TO, LANDING_TURNS);

    this.noise = Tone.ToneAudioBuffer.fromArray(whiteNoise(1.5, sr));
    this.pink = Tone.ToneAudioBuffer.fromArray(pinkNoise(Math.floor(PINK_SECONDS * sr), mulberry32(11)));
    this.pulseSamples = hannPulse(Math.max(3, Math.round(sr * 0.00025)));
    this.pulse = Tone.ToneAudioBuffer.fromArray(this.pulseSamples);
  }

  /**
   * The audio clock, without Tone's look-ahead. These sounds answer a touch,
   * so they are scheduled for now, not a tenth of a second from now.
   */
  get now(): number {
    return this.input.context.currentTime;
  }

  get sampleRate(): number {
    return this.input.context.sampleRate;
  }

  /**
   * The highest frequency worth asking this output for: a little under half
   * its sample rate. A node asked for more than half is an error, and an
   * output can be slow (a telephone headset runs at 8 or 16 kHz).
   */
  get ceiling(): number {
    return this.sampleRate * 0.45;
  }

  setVolume(volume: number): void {
    this.master.gain.setTargetAtTime(volume, this.now, 0.05);
  }

  private echoLine(bandTo: number, turns = 1): EchoLine {
    const door = new Tone.Gain(1);
    door.connect(this.floor);
    const delay = new Tone.Delay(this.echoTime * turns, Math.max(1, turns));
    const band = new Tone.BiquadFilter({ type: 'bandpass', frequency: Math.min(BAND_FROM, this.ceiling), Q: BAND_Q });
    const feedback = new Tone.Gain(between(FLOOR.feedback, 0));
    // Each time round the echo passes the band again, and the band has moved on.
    door.chain(delay, band, feedback, delay);
    band.connect(this.echoOut);
    return { door, delay, band, feedback, bandTo: Math.min(bandTo, this.ceiling), arrives: 0, turns };
  }

  private get echoes(): EchoLine[] {
    return [this.rising, this.sinking, this.landing];
  }

  /**
   * Where a sound made on the floor connects: it is heard from further off, and echoed. Through one
   * door its repeats climb, through the other they sink.
   */
  floorDoor(rising: boolean): Tone.Gain {
    return this.open(rising ? this.rising : this.sinking);
  }

  /** Where the sound of a cord landing connects: on the floor like the rest, with a slower echo of its own. */
  landingDoor(): Tone.Gain {
    return this.open(this.landing);
  }

  private open(line: EchoLine): Tone.Gain {
    const t = this.now;
    // The band sets out again once it has arrived. While it is on its way, what comes in travels with it.
    if (t >= line.arrives) {
      line.arrives = t + this.echoTime * line.turns * BAND_REPEATS;
      const frequency = line.band.frequency;
      frequency.cancelScheduledValues(t);
      frequency.setValueAtTime(Math.min(BAND_FROM, this.ceiling), t);
      frequency.exponentialRampToValueAtTime(line.bandTo, line.arrives);
    }
    return line.door;
  }

  /** How long the floor's echo takes to come back, in seconds. */
  setEchoTime(seconds: number): void {
    this.echoTime = Math.max(0.05, Math.min(1, seconds));
    for (const line of this.echoes) line.delay.delayTime.setTargetAtTime(this.echoTime * line.turns, this.now, 0.2);
  }

  /**
   * How much of the khipu has gone: 0 whole, 1 bare. The more has gone, the less of the floor
   * is heard directly and the more as room and echo.
   */
  setErosion(erosion: number): void {
    const t = this.now;
    this.floorDry.gain.setTargetAtTime(between(FLOOR.dry, erosion), t, 0.3);
    this.floorSend.gain.setTargetAtTime(between(FLOOR.send, erosion), t, 0.3);
    for (const line of this.echoes) line.feedback.gain.setTargetAtTime(between(FLOOR.feedback, erosion), t, 0.3);
    this.echoOut.gain.setTargetAtTime(between(FLOOR.echo, erosion), t, 0.3);
  }

  /** Run `fn` once `seconds` of audio time have passed. */
  after(seconds: number, fn: () => void): void {
    this.input.context.setTimeout(fn, Math.max(0, seconds));
  }

  /** How much of the strike pulse there is at a frequency (1 at 0 Hz, falling above a few kHz). */
  pulseResponse(frequency: number): number {
    const w = (2 * Math.PI * frequency) / this.sampleRate;
    let re = 0;
    let im = 0;
    for (let n = 0; n < this.pulseSamples.length; n++) {
      re += this.pulseSamples[n] * Math.cos(w * n);
      im -= this.pulseSamples[n] * Math.sin(w * n);
    }
    return Math.max(0.05, Math.hypot(re, im));
  }

  /**
   * A short burst of band-passed noise that dies away: a grain landing, a cord parting, a tap.
   * It comes up over `attack` seconds: a sound that begins at full level begins with a click.
   * `to` is where it is heard: `input`, or a door to the floor.
   */
  burst(
    time: number,
    frequency: number,
    q: number,
    level: number,
    length: number,
    pan: number,
    offset = 0,
    attack = 0.002,
    to: Tone.Gain = this.input,
  ): void {
    const source = new Tone.ToneBufferSource({ url: this.noise });
    const filter = new Tone.BiquadFilter({ type: 'bandpass', frequency: Math.min(frequency, this.ceiling), Q: q });
    const gain = new Tone.Gain(0);
    const rise = Math.min(attack, length * 0.5);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(level, time + rise);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(filter, gain, panner, to);
    source.onended = () => {
      source.dispose();
      filter.dispose();
      gain.dispose();
      panner.dispose();
    };
    source.start(time, offset, length + 0.02);
  }

  /**
   * The floor struck: a short, dull, pitched knock. The strike pulse rings one resonance,
   * which dies away with a time constant of `ring` seconds. `level` is its peak. `to` is a door to the floor.
   */
  tok(time: number, frequency: number, ring: number, level: number, pan: number, to: Tone.Gain): void {
    const f = Math.min(frequency, this.ceiling);
    const source = new Tone.ToneBufferSource({ url: this.pulse });
    // A band-pass struck by a unit pulse rings at 2*pi*f / (Q * sr), for Q / (pi * f) seconds.
    const q = Math.max(0.5, Math.PI * f * ring);
    const filter = new Tone.BiquadFilter({ type: 'bandpass', frequency: f, Q: q });
    const gain = new Tone.Gain((level * q * this.sampleRate) / (2 * Math.PI * f * this.pulseResponse(f)));
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(filter, gain, panner, to);
    source.start(time);
    // The pulse is over at once, and the resonance is not: let go once it has died away.
    this.after(time - this.now + ring * 9 + 0.05, () => {
      source.dispose();
      filter.dispose();
      gain.dispose();
      panner.dispose();
    });
  }

  /** The crack of a cord that is torn or cut. */
  crack(time: number, level: number, pan: number): void {
    if (!this.clicks) return;
    const source = new Tone.ToneBufferSource({ url: this.noise });
    const filter = new Tone.BiquadFilter({ type: 'lowpass', frequency: Math.min(2600, this.ceiling), Q: 0 });
    const gain = new Tone.Gain(0);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level, time + 0.002);
    gain.gain.setTargetAtTime(0, time + 0.002, 0.012);
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(filter, gain, panner, this.input);
    source.onended = () => {
      source.dispose();
      filter.dispose();
      gain.dispose();
      panner.dispose();
    };
    source.start(time, 0.7, 0.08);
  }

  /**
   * Breath: soft band-limited noise that comes up slowly and dies away over the time the cord swings.
   * What is heard where the archive has nothing. See breath.ts.
   */
  breath(time: number, breath: Breath, pan: number, level = 1): void {
    if (!this.breaths) return;
    // The noise goes round for as long as the breath lasts, and each breath begins somewhere else in it.
    const source = new Tone.ToneBufferSource({ url: this.pink, loop: true });
    const band = new Tone.BiquadFilter({ type: 'bandpass', frequency: Math.min(breath.centre, this.ceiling), Q: breath.q });
    const gain = new Tone.Gain(0);
    gain.gain.setValueCurveAtTime(breathCurve(breath), time, breath.length, breath.level * level);
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(band, gain, panner, this.input);
    source.onended = () => {
      source.dispose();
      band.dispose();
      gain.dispose();
      panner.dispose();
    };
    source.start(time, breath.offset * (PINK_SECONDS - 0.01), breath.length + 0.02);
  }

  dispose(): void {
    for (const node of [
      this.input, this.under, this.rectify, this.smooth, this.duck, this.ducking, this.floor, this.floorDry, this.floorLate, this.floorDark, this.floorSend,
      ...this.echoes.flatMap((line) => [line.door, line.delay, line.band, line.feedback]),
      this.echoOut, this.echoSend,
      this.room, this.wet, this.compressor, this.limiter, this.trim, this.master,
    ]) node.dispose();
    this.noise.dispose();
    this.pink.dispose();
    this.pulse.dispose();
  }
}

/** A plain decaying-noise room: a storeroom, not a cathedral. */
function roomImpulse(seconds: number, sr: number): Float32Array[] {
  const n = Math.floor(seconds * sr);
  const rnd = mulberry32(1532);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp += (0.5 - 0.42 * t) * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - t, 3.2) * (i < 600 ? i / 600 : 1);
    }
    channels.push(d);
  }
  return channels;
}

function whiteNoise(seconds: number, sr: number): Float32Array {
  const d = new Float32Array(Math.floor(seconds * sr));
  const rnd = mulberry32(7);
  for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  return d;
}

function hannPulse(n: number): Float32Array {
  const d = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    d[i] = 1 - Math.cos((2 * Math.PI * (i + 1)) / (n + 1));
    sum += d[i];
  }
  for (let i = 0; i < n; i++) d[i] /= sum;
  return d;
}
