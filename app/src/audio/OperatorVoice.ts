/**
 * Plays an operator patch with Tone.js.
 *
 * Each operator is a sine oscillator. A modulator is connected, through a
 * gain that sets its frequency deviation, to the frequency of the operator it
 * modulates; stacks are built the same way, to any depth. Only the carrier
 * reaches the output.
 *
 * The modulation is strongest at the touch and settles to a quarter of that,
 * so a cord sounds its relationships first and then, more plainly, itself.
 */
import * as Tone from 'tone';
import type { Bus } from './bus';
import type { Ending } from './endings';
import type { Operator, OperatorPatch } from './operatorPatch';

/** Peak level of a plain cord before the bus. */
const PEAK = 0.3;
const ATTACK = 0.004;
/** The modulation index settles to this share of where it starts… */
const SETTLE_TO = 0.25;
/** …with this time constant, in seconds. */
const SETTLE_TIME = 0.35;

export function playOperator(
  bus: Bus,
  patch: OperatorPatch,
  ending: Ending,
  pan: number,
  gain: number,
  time: number,
  done: () => void,
): void {
  const nodes: Tone.ToneAudioNode[] = [];
  const oscillators: Tone.ToneOscillatorNode[] = [];
  const end = time + ending.duration;

  const panner = new Tone.Panner(Math.max(-1, Math.min(1, pan)));
  panner.connect(bus.input);
  // The gate is where a broken, cut or unfinished cord stops.
  const gate = new Tone.Gain(1);
  gate.connect(panner);
  nodes.push(panner, gate);
  if (ending.stop) {
    gate.gain.setValueAtTime(1, time + ending.stop.at);
    gate.gain.linearRampToValueAtTime(0, time + ending.stop.at + ending.stop.fade);
    if (ending.stop.crack > 0) bus.crack(time + ending.stop.at, ending.stop.crack * gain, pan);
  } else {
    gate.gain.setValueAtTime(1, end - 0.03);
    gate.gain.linearRampToValueAtTime(0, end);
  }

  const modulate = (target: Tone.Param<'frequency'>, operators: readonly Operator[]): void => {
    for (const op of operators) {
      const osc = new Tone.ToneOscillatorNode({ frequency: Math.min(op.frequency, bus.ceiling), type: 'sine' });
      // Frequency deviation in Hz: the modulation index times the modulator's frequency.
      const deviation = new Tone.Gain(0);
      const peak = op.index * op.frequency;
      deviation.gain.setValueAtTime(peak, time);
      deviation.gain.setTargetAtTime(peak * SETTLE_TO, time, SETTLE_TIME);
      osc.connect(deviation);
      deviation.connect(target);
      oscillators.push(osc);
      nodes.push(deviation);
      modulate(osc.frequency, op.modulators);
    }
  };

  if (patch.frequency > 0) {
    const total = ending.strands.reduce((sum, s) => sum + s.level, 0);
    const scale = (PEAK * gain) / Math.max(0.6, total);
    ending.strands.forEach((strand, i) => {
      const osc = new Tone.ToneOscillatorNode({ frequency: Math.min(patch.frequency * strand.ratio, bus.ceiling), type: 'sine' });
      const amp = new Tone.Gain(0);
      amp.gain.setValueAtTime(0, time);
      amp.gain.linearRampToValueAtTime(strand.level * scale, time + ATTACK);
      amp.gain.setTargetAtTime(0, time + ATTACK, strand.ring / 6.91);
      osc.chain(amp, gate);
      oscillators.push(osc);
      nodes.push(amp);
      // The relationships act on the cord itself: the first strand.
      if (i === 0) modulate(osc.frequency, patch.modulators);
    });
  }

  for (const osc of oscillators) {
    osc.start(time);
    osc.stop(end + 0.02);
  }
  for (const breath of ending.breaths) bus.breath(time, breath, pan, gain);

  bus.after(end - bus.now + 0.1, () => {
    for (const osc of oscillators) osc.dispose();
    for (const node of nodes) node.dispose();
    done();
  });
}
