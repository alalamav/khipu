/**
 * The sound engine.
 *
 * Built on Tone.js. It owns the output bus, decides which voice sounds a
 * touched cord, and makes the sounds that are not cords: grains landing, cords
 * parting, and the drone of the main cord.
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
import { DEFAULT_VOICE, PITCH_K, cordFrequency, landingHarmonic, soundOf, type CordSound, type VoiceKind } from './cordSound';
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

/** The floor answers a grain at one of these multiples of the main cord's drone: the darker the cord, the lower. */
const FLOOR_HARMONICS = [3, 4, 5, 6, 8, 10, 12] as const;
/** The floor's echo comes back after this many turns of the drone: 0.19 to 0.38 s. */
const ECHO_TURNS = 16;
/** The drone of a main cord that was never measured, in Hz. */
const DEFAULT_DRONE = 55;

/** The level of the drone. */
const DRONE_LEVEL = 0.085;
/**
 * The drone comes up while the khipu is being attended to and goes down when it is left alone.
 * Time constants, in seconds: it is nearly all there after three of them (3.6 s up, 7.5 s down).
 */
const DRONE_ATTACK = 1.2;
const DRONE_RELEASE = 2.5;

/** Landings that arrive together are heard one after another, this far apart, in seconds… */
const LANDING_GAP = { first: 0.03, rest: 0.014 } as const;
/** …and one that would have to wait longer than this is not heard. */
const LANDING_WAIT = { first: 0.5, rest: 0.25 } as const;
/**
 * After the thud, a scatter of grains: this many short knocks, each softer than the last by LANDING_GRAIN_FADE,
 * at one of these multiples of the thud's pitch (all harmonics of the drone still), at uneven moments spread
 * over one turn of the landing's echo, and to either side of where the cord fell. 0 for none.
 */
const LANDING_GRAINS = 4;
const LANDING_GRAIN_FADE = 0.6;
const LANDING_GRAIN_PITCHES = [1, 2, 3, 4] as const;
/** The landing's echo comes back after this many turns of the drone (the floor's own, ECHO_TURNS, times the bus's 1.5). */
const LANDING_ECHO_TURNS = 24;

interface Drone {
  out: Tone.Gain;
  /** Up while the khipu is attended to. */
  presence: Tone.Gain;
  dispose(): void;
}

export class AudioEngine {
  readonly settings: VoiceSettings = { kind: DEFAULT_VOICE, depth: 1, ring: 1 };
  /** Cords sounded so far. */
  played = 0;
  /** Cords sounding now. */
  voices = 0;
  /** Knocks of cords landing heard so far. */
  landings = 0;
  /** The drone is up: the khipu is being attended to. */
  get droning(): boolean {
    return this.droneActive;
  }

  private bus: Bus | null = null;
  private volume = 0.8;
  private readonly cache = new Map<string, Tone.ToneAudioBuffer>();
  private lastTick = 0;
  /** When the next landing may be heard, in audio time. */
  private landingFree = 0;
  private drone: Drone | null = null;
  /** Length of the main cord the drone is for; null is silence; undefined is "nothing asked yet". */
  private droneLength: number | null | undefined = undefined;
  /** The pitch of the drone, in Hz. The floor is tuned to it. */
  private dronePitch = DEFAULT_DRONE;
  /** The drone is heard. Silenced, it still tunes the floor and times its echo. */
  private droneOn = true;
  /** The khipu is being attended to (a hand moving, or a reading): the drone is up. */
  private droneActive = false;
  /** How much of the khipu has gone, 0 to 1. */
  private erosion = 0;
  /** The snap of a cord parting and the crack of a torn or cut cord are heard. */
  private clicks = true;
  /** Breath is heard: where the archive has nothing, and on worn cords. */
  private breaths = true;

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
      this.bus.breaths = this.breaths;
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
    // The crack of a broken or cut cord and the breath are part of what is rendered, so a sound is kept with or without them.
    const kept = key + (this.clicks ? '' : ':quiet') + (this.breaths ? '' : ':held');
    let buffer = this.cache.get(kept);
    if (!buffer) {
      const samples = synthString(sound, bus.sampleRate, this.clicks, this.breaths);
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
    // The floor knocks, at a harmonic of the drone; and a little dust, lower and slower than a click.
    const step = Math.floor((0.7 * light + 0.3 * Math.random()) * FLOOR_HARMONICS.length);
    const harmonic = FLOOR_HARMONICS[Math.min(FLOOR_HARMONICS.length - 1, step)];
    const door = bus.floorDoor(rising);
    bus.tok(now, this.dronePitch * harmonic, 0.028, 0.06, pan, door);
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

  /**
   * A fallen cord reaching the floor. It is called once for each point of the cord's rope, so a cord
   * lands as a run of knocks, and a long cord takes longer over it than a stub.
   *
   * @param lengthCm how long the piece that fell is, or null if the cord was never measured
   * @param brightness the lightness of the cord, 0 to 1
   * @param force how hard this point came down, 0 to 1
   * @param first the first of the cord to arrive: a thud, where the rest is a patter
   */
  land(pan: number, lengthCm: number | null, brightness: number, force: number, first: boolean): void {
    const bus = this.bus;
    if (!bus || !this.ready) return;
    const now = bus.now;
    // What arrives in the same instant is spread out, in order; what would come too late is left out.
    const time = Math.max(now, this.landingFree);
    if (time - now > (first ? LANDING_WAIT.first : LANDING_WAIT.rest)) return;
    this.landingFree = time + (first ? LANDING_GAP.first : LANDING_GAP.rest);
    this.landings++;

    const light = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness)) : 0.5;
    const hard = 0.35 + 0.65 * Math.max(0, Math.min(1, force || 0));
    const frequency = this.dronePitch * landingHarmonic(lengthCm, light, this.dronePitch);
    // Cords have an echo of their own, slower than the one the knots' grains go to.
    const door = bus.landingDoor();
    if (first) {
      // The thud: the cord's knock, the floor under it at the drone's own pitch, and the dust it raises.
      bus.tok(time, frequency, 0.07, 0.16 * hard, pan, door);
      bus.tok(time, this.dronePitch, 0.09, 0.12 * hard, pan, door);
      bus.burst(time, 350 + 450 * light, 1.2, 0.08 * hard, 0.13, pan, Math.random() * 0.4, 0.006, door);
      // And what the thud throws up: a few grains of it, higher, scattered in time and to either side.
      const turn = LANDING_ECHO_TURNS / this.dronePitch;
      let level = 0.09 * hard;
      for (let k = 0; k < LANDING_GRAINS; k++) {
        const at = time + (turn * (k + 0.35 + 0.65 * Math.random())) / LANDING_GRAINS;
        const pitch = LANDING_GRAIN_PITCHES[Math.floor(Math.random() * LANDING_GRAIN_PITCHES.length)];
        bus.tok(at, frequency * pitch, 0.022, level, pan + (Math.random() - 0.5) * 0.7, door);
        level *= LANDING_GRAIN_FADE;
      }
    } else {
      // The rest of it coming down on top: softer, and now and then an octave up.
      bus.tok(time, frequency * (Math.random() < 0.25 ? 2 : 1), 0.03, 0.05 * hard, pan, door);
      bus.burst(time, 500 + 900 * light * Math.random(), 2, 0.02 * hard, 0.045, pan, Math.random() * 0.4, 0.004, door);
    }
  }

  /** A cord parting. `rising`: its echoes climb; otherwise they sink. */
  snap(pan: number, rising: boolean): void {
    const bus = this.bus;
    if (!bus || !this.ready || !this.clicks) return;
    const now = bus.now;
    const door = bus.floorDoor(rising);
    bus.burst(now, 500 + Math.random() * 400, 1, 0.3, 0.14, pan, Math.random() * 0.3, 0.005, door);
    bus.tok(now, this.dronePitch * 2, 0.06, 0.1, pan, door);
  }

  /**
   * The main cord: a low drone that is there as long as the khipu is.
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

  /**
   * The khipu is being attended to, or it has been left alone. The drone comes up slowly in the first
   * case and goes down more slowly in the second.
   */
  setDroneActive(active: boolean): void {
    if (active === this.droneActive) return;
    this.droneActive = active;
    if (this.bus && this.drone) {
      this.drone.presence.gain.setTargetAtTime(active ? 1 : 0, this.bus.now, active ? DRONE_ATTACK : DRONE_RELEASE);
    }
  }

  /**
   * Let breath be heard, or silence it: the noise that stands for a length or an ending that was not
   * recorded, and for wear. Silenced, a cord with no measured length makes no sound of its own in the
   * string and operator voices.
   */
  setBreath(on: boolean): void {
    this.breaths = on;
    if (this.bus) this.bus.breaths = on;
  }

  /** Let the drone be heard, or silence it. */
  setDroneOn(on: boolean): void {
    this.droneOn = on;
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

    let f = lengthCm > 0 ? PITCH_K / lengthCm : DEFAULT_DRONE; // an unmeasured main cord drones at a default
    while (f < 42) f *= 2;
    while (f > 84) f /= 2;
    this.dronePitch = f;
    bus.setEchoTime(ECHO_TURNS / f);
    const o1 = new Tone.ToneOscillatorNode({ frequency: f, type: 'triangle' });
    const o2 = new Tone.ToneOscillatorNode({ frequency: f * 1.5 + 0.3, type: 'sine' });
    const lfo = new Tone.ToneOscillatorNode({ frequency: 0.07, type: 'sine' });
    const sway = new Tone.Gain(0.02);
    const lowpass = new Tone.BiquadFilter({ type: 'lowpass', frequency: 320 });
    const level = new Tone.Gain(DRONE_LEVEL);
    // Whether it is there and whether it is switched on come after the level, which sways: a swaying
    // level turned to nothing would still be heard.
    const presence = new Tone.Gain(0);
    if (this.droneActive) presence.gain.setTargetAtTime(1, t, DRONE_ATTACK);
    const out = new Tone.Gain(this.droneOn ? 1 : 0);
    lfo.connect(sway);
    sway.connect(level.gain);
    o1.connect(lowpass);
    o2.connect(lowpass);
    // Not into `input` with the voices: under them, where it gives way while they sound.
    lowpass.chain(level, presence, out, bus.under);
    for (const osc of [o1, o2, lfo]) osc.start(t);
    this.drone = {
      out,
      presence,
      dispose: () => {
        for (const node of [o1, o2, lfo, sway, lowpass, level, presence, out]) node.dispose();
      },
    };
  }
}
