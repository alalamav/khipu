/**
 * The output every voice plays into, and the few sounds they share.
 *
 *   voices -> input -+-> compressor -> limiter -> trim -> master -> speakers
 *                    +-> room -> wet -+
 *
 * A Bus builds its nodes in whatever Tone context is current, so the same
 * class serves the live context and offline rendering (see selftest.ts).
 */
import * as Tone from 'tone';
import { mulberry32 } from '../khipu';
import type { Breath } from './endings';

/** Shape of a breath over its length: sin(pi * t^0.6), a quick rise and a long fall. */
const BREATH_CURVE: number[] = Array.from({ length: 48 }, (_, i) => Math.sin(Math.PI * Math.pow(i / 47, 0.6)));

/** The limiter acts above this level, in dB below full scale… */
const LIMIT_DB = -3;
/** …letting 1 dB out for every this many dB that come in. */
const LIMIT_RATIO = 20;

function clampPan(pan: number): number {
  return Math.max(-1, Math.min(1, pan || 0));
}

export class Bus {
  /** Voices connect here. */
  readonly input: Tone.Gain;
  /** A very short smooth pulse: what strikes the resonators. Its samples add up to 1. */
  readonly pulse: Tone.ToneAudioBuffer;

  private readonly master: Tone.Gain;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Compressor;
  private readonly trim: Tone.Gain;
  private readonly room: Tone.Convolver;
  private readonly wet: Tone.Gain;
  private readonly noise: Tone.ToneAudioBuffer;
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

    this.noise = Tone.ToneAudioBuffer.fromArray(whiteNoise(1.5, sr));
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

  /** A short burst of band-passed noise that dies away: a grain landing, a cord parting, a tap. */
  burst(time: number, frequency: number, q: number, level: number, length: number, pan: number, offset = 0): void {
    const source = new Tone.ToneBufferSource({ url: this.noise });
    const filter = new Tone.BiquadFilter({ type: 'bandpass', frequency: Math.min(frequency, this.ceiling), Q: q });
    const gain = new Tone.Gain(0);
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(filter, gain, panner, this.input);
    source.onended = () => {
      source.dispose();
      filter.dispose();
      gain.dispose();
      panner.dispose();
    };
    source.start(time, offset, length + 0.02);
  }

  /** The crack of a cord that is torn or cut. */
  crack(time: number, level: number, pan: number): void {
    const source = new Tone.ToneBufferSource({ url: this.noise });
    const filter = new Tone.BiquadFilter({ type: 'lowpass', frequency: Math.min(4600, this.ceiling), Q: 0 });
    const gain = new Tone.Gain(0);
    gain.gain.setValueAtTime(level * 1.2, time);
    gain.gain.setTargetAtTime(0, time, 0.006);
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(filter, gain, panner, this.input);
    source.onended = () => {
      source.dispose();
      filter.dispose();
      gain.dispose();
      panner.dispose();
    };
    source.start(time, 0.7, 0.04);
  }

  /** Breath: band-limited noise that swells and fades. What is heard where the archive has nothing. */
  breath(time: number, breath: Breath, pan: number, level = 1): void {
    const source = new Tone.ToneBufferSource({ url: this.noise });
    const low = new Tone.BiquadFilter({ type: 'lowpass', frequency: Math.min(breath.centre, this.ceiling), Q: 0 });
    const high = new Tone.BiquadFilter({ type: 'highpass', frequency: 150, Q: 0 });
    const gain = new Tone.Gain(0);
    gain.gain.setValueCurveAtTime(BREATH_CURVE, time, breath.length, breath.level * level);
    const panner = new Tone.Panner(clampPan(pan));
    source.chain(low, high, gain, panner, this.input);
    source.onended = () => {
      source.dispose();
      low.dispose();
      high.dispose();
      gain.dispose();
      panner.dispose();
    };
    source.start(time, 0.1, breath.length + 0.02);
  }

  dispose(): void {
    for (const node of [this.input, this.room, this.wet, this.compressor, this.limiter, this.trim, this.master]) node.dispose();
    this.noise.dispose();
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
