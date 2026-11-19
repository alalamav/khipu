/**
 * The sound engine.
 *
 * Built on Tone.js. It owns the output bus, decides which voice sounds a
 * touched cord, and makes the sounds that are not cords: grains landing, cords
 * parting, and the hum of the main cord.
 *
 * Three voices read the same row three ways:
 *
 *   string     the cord as a measured string        (stringVoice)
 *   operator   the cord among its relationships     (operatorPatch + OperatorVoice)
 *   resonator  the cord as the numbers knotted on it (resonatorPatch + ResonatorVoice)
 */
import * as Tone from 'tone';
import { mulberry32, type Cord, type HangingKhipu } from '../khipu';
import { Bus } from './bus';
import { PITCH_K, cordFrequency, soundOf, type CordSound, type VoiceKind } from './cordSound';
import { endingOf } from './endings';
import { playOperator } from './OperatorVoice';
import { buildOperatorPatch } from './operatorPatch';
import { playResonator } from './ResonatorVoice';
import { buildResonatorPatch } from './resonatorPatch';
import { synthString } from './stringVoice';

export interface VoiceSettings {
  kind: VoiceKind;
  /** Operator voice: how deeply cords modulate one another. 0 is bare sine tones; 1 is the default. */
  depth: number;
  /** Resonator voice: how long the resonances ring, as a multiple of the default. */
  ring: number;
}

export interface PluckOptions {
  /** 0 to 1. */
  gain?: number;
  /** Seconds from now. */
  delay?: number;
  /**
   * Names the cord and its present state. Rendered string sounds are kept
   * under it and reused while the cord has not changed.
   */
  key: string;
}

/** Sounds at once, per voice. Beyond this a touch is not sounded. */
const MAX_VOICES: Readonly<Record<VoiceKind, number>> = { string: 30, operator: 16, resonator: 20 };
const CACHE_SIZE = 96;

interface Drone {
  out: Tone.Gain;
  dispose(): void;
}

export class AudioEngine {
  readonly settings: VoiceSettings = { kind: 'string', depth: 1, ring: 1 };
  /** Cords sounded so far. */
  played = 0;
  /** Cords sounding now. */
  voices = 0;

  private bus: Bus | null = null;
  private volume = 0.8;
  private readonly cache = new Map<string, Tone.ToneAudioBuffer>();
  private lastTick = 0;
  private drone: Drone | null = null;
  /** Length of the main cord the hum is for; null is silence; undefined is "nothing asked yet". */
  private droneLength: number | null | undefined = undefined;

  /**
   * Bring the engine up. Browsers only let audio begin from a click or a key
   * press, so this is called from those; calling it again is harmless.
   */
  start(): void {
    if (!this.bus) {
      Tone.getContext().lookAhead = 0;
      this.bus = new Bus(this.volume);
      if (this.droneLength !== undefined) this.buildDrone(this.droneLength);
    }
    void Tone.start();
  }

  get state(): 'off' | 'suspended' | 'running' {
    if (!this.bus) return 'off';
    return Tone.getContext().state === 'running' ? 'running' : 'suspended';
  }

  get ready(): boolean {
    return this.state === 'running';
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.bus?.setVolume(volume);
  }

  /** Sound a cord as it is now, in the current voice. */
  pluck(hanging: HangingKhipu, cord: Cord, options: PluckOptions): void {
    const bus = this.bus;
    if (!bus || !this.ready) return;
    const kind = this.settings.kind;
    if (this.voices >= MAX_VOICES[kind]) return;

    const gain = options.gain ?? 1;
    const time = bus.now + (options.delay ?? 0);
    const sound = soundOf(hanging, cord);
    this.voices++;
    this.played++;
    let over = false;
    const done = () => {
      if (!over) this.voices--;
      over = true;
    };

    try {
      if (kind === 'string') {
        this.playString(bus, sound, options.key, gain, time, done);
      } else if (kind === 'operator') {
        const patch = buildOperatorPatch(hanging, cord, this.settings.depth);
        const ending = endingOf(sound, cordFrequency(sound.length), mulberry32(sound.seed || 1));
        playOperator(bus, patch, ending, sound.pan, gain, time, done);
      } else {
        playResonator(bus, buildResonatorPatch(sound, this.settings.ring), sound.pan, gain, time, done);
      }
    } catch (error) {
      // A voice that could not be built must not go on being counted as one that sounds.
      done();
      throw error;
    }
  }

  /**
   * Forget the string sounds rendered so far. They are kept by cord and state,
   * and after a khipu is tied again the same names would mean other cords.
   */
  forget(): void {
    this.cache.clear();
  }

  private playString(bus: Bus, sound: CordSound, key: string, gain: number, time: number, done: () => void): void {
    let buffer = this.cache.get(key);
    if (!buffer) {
      const samples = synthString(sound, bus.sampleRate);
      buffer = Tone.ToneAudioBuffer.fromArray([samples.L, samples.R]);
      this.cache.set(key, buffer);
      if (this.cache.size > CACHE_SIZE) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    const source = new Tone.ToneBufferSource({ url: buffer });
    const level = new Tone.Gain(gain);
    source.chain(level, bus.input);
    source.onended = () => {
      source.dispose();
      level.dispose();
      done();
    };
    source.start(time);
  }

  /** A grain of a fallen knot reaching the floor. */
  tick(pan: number, brightness: number): void {
    const bus = this.bus;
    if (!bus || !this.ready) return;
    const now = bus.now;
    if (now - this.lastTick < 0.035) return;
    this.lastTick = now;
    bus.burst(now, 1800 + 5000 * (brightness || 0.5) * Math.random(), 6, 0.09, 0.03, pan, Math.random() * 0.4);
  }

  /** A cord parting. */
  snap(pan: number): void {
    const bus = this.bus;
    if (!bus || !this.ready) return;
    bus.burst(bus.now, 900 + Math.random() * 700, 1.2, 0.5, 0.09, pan, Math.random() * 0.3);
  }

  /**
   * The main cord: a low hum that is there as long as the khipu is.
   * Pass its length in cm (0 if it was never measured), or null for silence.
   */
  setDrone(lengthCm: number | null): void {
    this.droneLength = lengthCm;
    if (this.bus) this.buildDrone(lengthCm);
  }

  private buildDrone(lengthCm: number | null): void {
    const bus = this.bus;
    if (!bus) return;
    const t = bus.now;
    if (this.drone) {
      const old = this.drone;
      old.out.gain.setTargetAtTime(0, t, 0.4);
      bus.after(2.5, () => old.dispose());
      this.drone = null;
    }
    if (lengthCm === null) return;

    let f = lengthCm > 0 ? PITCH_K / lengthCm : 55; // an unmeasured main cord hums at a default
    while (f < 42) f *= 2;
    while (f > 84) f /= 2;
    const o1 = new Tone.ToneOscillatorNode({ frequency: f, type: 'triangle' });
    const o2 = new Tone.ToneOscillatorNode({ frequency: f * 1.5 + 0.3, type: 'sine' });
    const lfo = new Tone.ToneOscillatorNode({ frequency: 0.07, type: 'sine' });
    const sway = new Tone.Gain(0.02);
    const lowpass = new Tone.BiquadFilter({ type: 'lowpass', frequency: 320 });
    const out = new Tone.Gain(0);
    out.gain.setTargetAtTime(0.085, t, 1.5);
    lfo.connect(sway);
    sway.connect(out.gain);
    o1.connect(lowpass);
    o2.connect(lowpass);
    lowpass.chain(out, bus.input);
    for (const osc of [o1, o2, lfo]) osc.start(t);
    this.drone = {
      out,
      dispose: () => {
        for (const node of [o1, o2, lfo, sway, lowpass, out]) node.dispose();
      },
    };
  }
}
