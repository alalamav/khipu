/**
 * Plays a resonator patch with Tone.js.
 *
 * Each resonance is a band-pass filter with a high Q, struck by a very short
 * pulse. A struck band-pass rings at its centre frequency and dies away at a
 * rate set by its Q, which is how the ring time is set. The filters are real
 * filters: anything else sent into them would ring them too.
 */
import * as Tone from 'tone';
import type { Bus } from './bus';
import type { ResonatorPatch } from './resonatorPatch';

/** Peak level of a cord's resonances together, before the bus. */
const PEAK = 0.3;
/** Level of the dry tap of the strike. */
const TAP = 0.3;
/**
 * A constant far too small to hear, fed to every filter while its cord sounds.
 *
 * A browser stops computing a filter shortly after its input falls silent.
 * How shortly, it works out from the filter alone, as if the input had been
 * of ordinary level. These filters are struck by a very small pulse and their
 * level is made up afterwards, so that estimate comes out far too short and
 * the ring is cut off: in Chrome a filter asked to ring down 60 dB went
 * silent after 12. An input that is never silent keeps a filter running.
 * Being constant, it is removed by the band-pass; what it leaves in the
 * output is 160 dB below full scale.
 */
const KEEP_ALIVE = 1e-9;

export function playResonator(
  bus: Bus,
  patch: ResonatorPatch,
  pan: number,
  gain: number,
  time: number,
  done: () => void,
): void {
  const { ending } = patch;
  const nodes: Tone.ToneAudioNode[] = [];
  const end = time + ending.duration;
  const sr = bus.sampleRate;

  // What a strike sounds like with nothing to ring: all a knotless cord has.
  bus.burst(time, patch.tapHz, 0.8, TAP * gain, 0.05, pan, 0.2);

  const gate = new Tone.Gain(1);
  gate.connect(bus.input);
  nodes.push(gate);
  if (ending.stop) {
    gate.gain.setValueAtTime(1, time + ending.stop.at);
    gate.gain.linearRampToValueAtTime(0, time + ending.stop.at + ending.stop.fade);
    if (ending.stop.crack > 0) bus.crack(time + ending.stop.at, ending.stop.crack * gain, pan);
  } else {
    gate.gain.setValueAtTime(1, end - 0.03);
    gate.gain.linearRampToValueAtTime(0, end);
  }

  if (patch.resonances.length) {
    const alive = new Tone.Signal(KEEP_ALIVE);
    nodes.push(alive);

    const total = patch.resonances.reduce((sum, r) => sum + r.level, 0);
    const scale = (PEAK * gain) / Math.max(1, total);
    for (const r of patch.resonances) {
      // Amplitude falls by e every tau seconds; 60 dB is 6.91 of those.
      const tau = Math.max(0.02, r.ring) / 6.91;
      const frequency = Math.min(r.frequency, bus.ceiling);
      const w0 = (2 * Math.PI * frequency) / sr;
      // For a band-pass biquad the ring-down time is 2Q / (sr * sin w0).
      const q = Math.max(0.5, (tau * sr * Math.sin(w0)) / 2);
      const filter = new Tone.BiquadFilter({ type: 'bandpass', frequency, Q: q });
      // A unit pulse rings such a filter at an amplitude of 2 / (tau * sr), less
      // whatever the pulse lacks at this frequency. Undo both, then set the level.
      // Several strikes pile up roughly as the square root of their number.
      const perStrike = 1 / Math.sqrt(r.strikes.length || 1);
      const makeup = (r.level * scale * perStrike * tau * sr) / (2 * bus.pulseResponse(frequency));
      const out = new Tone.Gain(makeup);
      const panner = new Tone.Panner(Math.max(-1, Math.min(1, r.pan)));
      alive.connect(filter);
      filter.chain(out, panner, gate);
      nodes.push(filter, out, panner);

      for (const strike of r.strikes) {
        const source = new Tone.ToneBufferSource({ url: bus.pulse });
        source.connect(filter);
        source.onended = () => source.dispose();
        source.start(time + strike.at, 0, undefined, strike.level);
      }
    }
  }

  for (const breath of ending.breaths) bus.breath(time, breath, pan, gain);

  bus.after(end - bus.now + 0.1, () => {
    for (const node of nodes) node.dispose();
    done();
  });
}
