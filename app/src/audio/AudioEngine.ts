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
const MAX_VOICES: Readonly<Record<VoiceKind, number>> = { string: 60, operator: 32, resonator: 28 };
const CACHE_SIZE = 96;

/** The floor answers a grain at one of these multiples of the main cord's hum: the darker the cord, the lower. */
const FLOOR_HARMONICS = [3, 4, 5, 6, 8, 10, 12] as const;
/** The floor's echo comes back after this many turns of the hum: 0.19 to 0.38 s. */
const ECHO_TURNS = 16;
/** The hum of a main cord that was never measured, in Hz. */
const DEFAULT_HUM = 55;

/** The level of the hum. */
const HUM_LEVEL = 0.085;

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
  /** The pitch of the hum, in Hz. The floor is tuned to it. */
  private hum = DEFAULT_HUM;
  /** The hum is heard. Silenced, it still tunes the floor and times its echo. */
  private humOn = true;
  /** How much of the khipu has gone, 0 to 1. */
  private erosion = 0;
  /** The snap of a cord parting and the crack of a torn or cut cord are heard. */
  private clicks = true;

  /**
   * Bring the engine up. Browsers only let audio begin from a click or a key
   * press, so this is called from those; calling it again is harmless.
   */
  start(): void {
    if (!this.bus) {
      Tone.getContext().lookAhead = 0;
      this.bus = new Bus(this.volume);
      this.bus.setErosion(this.erosion);
      this.bus.clicks = this.clicks;
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
    // The crack of a broken or cut cord is part of what is rendered, so a sound is kept with or without it.
    const kept = this.clicks ? key : key + ':quiet';
    let buffer = this.cache.get(kept);
    if (!buffer) {
      const samples = synthString(sound, bus.sampleRate, this.clicks);
      buffer = Tone.ToneAudioBuffer.fromArray([samples.L, samples.R]);
      this.cache.set(kept, buffer);
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

  /** A grain of a fallen knot reaching the floor. `rising`: its echoes climb; otherwise they sink. */
  tick(pan: number, brightness: number, rising: boolean): void {
    const bus = this.bus;
    if (!bus || !this.ready) return;
    const now = bus.now;
    if (now - this.lastTick < 0.035) return;
    this.lastTick = now;
    const light = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness)) : 0.5;
    // The floor knocks, at a harmonic of the hum; and a little dust, lower and slower than a click.
    const step = Math.floor((0.7 * light + 0.3 * Math.random()) * FLOOR_HARMONICS.length);
    const harmonic = FLOOR_HARMONICS[Math.min(FLOOR_HARMONICS.length - 1, step)];
    const door = bus.floorDoor(rising);
    bus.tok(now, this.hum * harmonic, 0.028, 0.06, pan, door);
    bus.burst(now, 700 + 1500 * light * Math.random(), 3, 0.03, 0.05, pan, Math.random() * 0.4, 0.004, door);
  }

  /**
   * How much of the khipu has gone: 0 whole, 1 bare. The more has gone, the more of what
   * happens on the floor is echo.
   */
  setErosion(erosion: number): void {
    this.erosion = erosion;
    this.bus?.setErosion(erosion);
  }

  /** A cord parting. `rising`: its echoes climb; otherwise they sink. */
  snap(pan: number, rising: boolean): void {
    const bus = this.bus;
    if (!bus || !this.ready || !this.clicks) return;
    const now = bus.now;
    const door = bus.floorDoor(rising);
    bus.burst(now, 500 + Math.random() * 400, 1, 0.3, 0.14, pan, Math.random() * 0.3, 0.005, door);
    bus.tok(now, this.hum * 2, 0.06, 0.1, pan, door);
  }

  /**
   * The main cord: a low hum that is there as long as the khipu is.
   * Pass its length in cm (0 if it was never measured), or null for silence.
   */
  setDrone(lengthCm: number | null): void {
    this.droneLength = lengthCm;
    if (this.bus) this.buildDrone(lengthCm);
  }

  /** Let the clicks be heard, or silence them: the snap of a cord parting, and the crack of a torn or cut cord. */
  setClicks(on: boolean): void {
    this.clicks = on;
    if (this.bus) this.bus.clicks = on;
  }

  /** Let the hum be heard, or silence it. */
  setHum(on: boolean): void {
    this.humOn = on;
    if (this.bus && this.drone) this.drone.out.gain.setTargetAtTime(on ? 1 : 0, this.bus.now, 0.3);
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

    let f = lengthCm > 0 ? PITCH_K / lengthCm : DEFAULT_HUM; // an unmeasured main cord hums at a default
    while (f < 42) f *= 2;
    while (f > 84) f /= 2;
    this.hum = f;
    bus.setEchoTime(ECHO_TURNS / f);
    const o1 = new Tone.ToneOscillatorNode({ frequency: f, type: 'triangle' });
    const o2 = new Tone.ToneOscillatorNode({ frequency: f * 1.5 + 0.3, type: 'sine' });
    const lfo = new Tone.ToneOscillatorNode({ frequency: 0.07, type: 'sine' });
    const sway = new Tone.Gain(0.02);
    const lowpass = new Tone.BiquadFilter({ type: 'lowpass', frequency: 320 });
    const level = new Tone.Gain(0);
    level.gain.setTargetAtTime(HUM_LEVEL, t, 1.5);
    // The switch comes after the level, which sways: a swaying level turned to nothing would still be heard.
    const out = new Tone.Gain(this.humOn ? 1 : 0);
    lfo.connect(sway);
    sway.connect(level.gain);
    o1.connect(lowpass);
    o2.connect(lowpass);
    lowpass.chain(level, out, bus.input);
    for (const osc of [o1, o2, lfo]) osc.start(t);
    this.drone = {
      out,
      dispose: () => {
        for (const node of [o1, o2, lfo, sway, lowpass, level, out]) node.dispose();
      },
    };
  }
}
