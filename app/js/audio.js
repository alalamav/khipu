/*
 * Just Ends — sound engine
 *
 * Every cord is rendered as a short stereo buffer, computed from that cord's
 * row in the archive at the moment it is touched. Nothing is sampled and no
 * musical scale is imposed:
 *
 *   length (cm)      -> pitch. A cord is treated as a string; f = 6600 / cm,
 *                       folded by octaves into the audible range.
 *   colour           -> brightness and ring time (pale cotton rings longer).
 *   knots            -> partials. A knot at distance p on a cord of length L
 *                       sounds the ratio L / p above the cord, the way a
 *                       finger resting on a string sounds a harmonic.
 *                       single knots ping once each; a long knot of n turns
 *                       is a roll of n grains; a figure-eight knot beats.
 *   knot direction   -> S to the left, Z to the right, unknown in the
 *                       middle and partly noise.
 *   termination      -> how the sound ends (knotted, broken, cut, ravelled,
 *                       doubled, unfinished, wrapped). See endings below.
 *   not recorded     -> breath. A cord with no measured length has no pitch.
 *
 * The synthesis function is pure (no Web Audio), so it can be tested and
 * reused offline, e.g. to render a fixed-media version.
 */
(function (G) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var PITCH_K = 6600;            // Hz·cm : a 30 cm cord sounds 220 Hz
  var F_MIN = 65, F_MAX = 1568;

  function cordFreq(len) {
    if (!len || !(len > 0)) return 0;
    var f = PITCH_K / len;
    while (f < F_MIN) f *= 2;
    while (f > F_MAX) f /= 2;
    return f;
  }

  // seconds of sound for each way of ending
  var DUR = { K: 2.4, B: 1.5, C: 0.9, R: 2.6, U: 1.7, D: 2.6, TT: 0.75, '': 1.4 };

  /*
   * spec = { len, lum, term, knots:[{pos,type,n,value,dir}], pan, integrity, seed }
   * returns { L, R } Float32Arrays
   */
  function synthCord(spec, sr) {
    var rnd = mulberry32(spec.seed || 1);
    var term = spec.term || '';
    var f0 = cordFreq(spec.len);
    var dur = DUR[term] === undefined ? 2.0 : DUR[term];
    if (!f0) dur = 1.2;
    var n = Math.floor(dur * sr);
    var mono = new Float32Array(n);
    var L = new Float32Array(n), R = new Float32Array(n);
    var lum = spec.lum == null ? 0.5 : Math.max(0, Math.min(1, spec.lum));
    var integ = spec.integrity == null ? 1 : Math.max(0, Math.min(1, spec.integrity));
    var i;

    // ---- Karplus-Strong string ---------------------------------------
    function string(freq, amp, t60, bright) {
      var N = Math.max(2, Math.round(sr / freq));
      var line = new Float32Array(N);
      var lp = 0, a = 0.12 + 0.8 * bright, m = 0, j;
      for (j = 0; j < N; j++) { lp += a * ((rnd() * 2 - 1) - lp); line[j] = lp; m += lp; }
      m /= N;
      var peak = 1e-6;
      for (j = 0; j < N; j++) { line[j] -= m; if (Math.abs(line[j]) > peak) peak = Math.abs(line[j]); }
      for (j = 0; j < N; j++) line[j] /= peak;
      var g = Math.pow(10, -3 / (t60 * freq));   // loss per period
      var s = 0.5 - 0.36 * bright;               // averaging: 0.5 dull .. 0.14 bright
      var idx = 0, nx;
      for (j = 0; j < n; j++) {
        nx = idx + 1; if (nx === N) nx = 0;
        mono[j] += line[idx] * amp;
        line[idx] = g * ((1 - s) * line[idx] + s * line[nx]);
        idx = nx;
      }
    }

    // ---- breath: what a cord with no pitch sounds like ---------------
    function breath(amp, centre, len) {
      var lp1 = 0, lp2 = 0, a1 = Math.min(0.9, 2 * Math.PI * centre / sr), j, e, t;
      var m = Math.min(n, Math.floor(len * sr));
      for (j = 0; j < m; j++) {
        t = j / m;
        e = Math.sin(Math.PI * Math.pow(t, 0.6));
        lp1 += a1 * ((rnd() * 2 - 1) - lp1);
        lp2 += 0.02 * (lp1 - lp2);
        mono[j] += (lp1 - lp2) * e * amp;
      }
    }

    var bright = 0.25 + 0.7 * lum;
    var t60 = 0.9 + 1.6 * lum;

    if (!f0) {
      // length not recorded: no string, only breath
      breath(0.55, 500 + 900 * rnd(), 1.1);
    } else if (term === '') {
      // termination not recorded: the string is there but barely, under breath
      string(f0, 0.3, t60 * 0.5, bright * 0.6);
      breath(0.4, f0 * 2, 1.2);
    } else if (term === 'TT') {
      // canutito: the end is wrapped in thread — a damped, muted string
      string(f0, 0.9, 0.16, bright * 0.35);
    } else if (term === 'U') {
      // unfinished: hardly decays at all; it will simply stop (see below)
      string(f0, 0.6, 9, bright);
    } else if (term === 'R') {
      // ravelled: the plies come apart into separate, drifting strings
      string(f0, 0.5, t60, bright);
      string(f0 * 1.011, 0.34, t60 * 0.9, bright);
      string(f0 * 0.985, 0.34, t60 * 0.8, bright);
      string(f0 * 1.027, 0.22, t60 * 0.7, bright);
    } else if (term === 'D') {
      // doubled: the end is folded back on itself — the octave below joins
      string(f0, 0.6, t60, bright);
      string(f0 / 2, 0.5, t60 * 1.1, bright * 0.8);
    } else {
      string(f0, 0.8, t60, bright);
    }

    // a worn cord carries noise in proportion to its wear
    if (integ < 1) breath(0.35 * (1 - integ), 1200, Math.min(dur, 0.9));

    // ---- stereo placement of the cord itself ---------------------------
    var pan = Math.max(-1, Math.min(1, spec.pan || 0));
    var gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (i = 0; i < n; i++) { L[i] = mono[i] * gl; R[i] = mono[i] * gr; }

    // ---- knots ----------------------------------------------------------
    function ping(t, f, amp, dec, kpan, noise) {
      var start = Math.floor(t * sr); if (start >= n) return;
      var len = Math.min(n - start, Math.floor(dec * 5 * sr));
      var pl = Math.cos((kpan + 1) * Math.PI / 4), pr = Math.sin((kpan + 1) * Math.PI / 4);
      var w = 2 * Math.PI * f / sr, att = Math.max(1, Math.floor(0.003 * sr)), k, e, v, lp = 0;
      for (k = 0; k < len; k++) {
        e = Math.exp(-k / (dec * sr)) * (k < att ? k / att : 1);
        v = f ? Math.sin(w * k) : 0;
        if (noise > 0) { lp += 0.3 * ((rnd() * 2 - 1) - lp); v = v * (1 - noise) + lp * noise * 2; }
        v *= e * amp;
        L[start + k] += v * pl; R[start + k] += v * pr;
      }
    }

    var Lcm = spec.len || 0, knots = spec.knots || [];
    for (var q = 0; q < knots.length; q++) {
      var kn = knots[q];
      var p = kn.pos, fk = 0;
      if (f0 && p && Lcm) {
        var h = Lcm / Math.min(p, Lcm);
        if (h < 1) h = 1; if (h > 24) h = 24;
        fk = f0 * h;
        while (fk > 4200) fk /= 2;
      }
      var frac = (p && Lcm) ? Math.min(1, p / Lcm) : rnd();
      var t0 = 0.05 + 0.45 * frac;                 // read from the top of the cord downward
      var kpan = kn.dir === 'Z' ? 0.75 : (kn.dir === 'S' ? -0.75 : 0);
      var unsure = kn.dir === 'U' ? 0.45 : 0;      // direction not recorded
      if (!fk) unsure = 1;                          // position not recorded: only a tick
      var cnt = Math.max(1, Math.min(kn.n || 1, 9));
      var unit = (kn.value || 0) / (kn.n || 1);
      var j2;
      if (kn.type === 'L' || kn.type === 'LL' || kn.type === 'BL' || kn.type === 'SP') {
        var turns = Math.max(2, Math.min(Math.round(unit) || 2, 11));
        for (j2 = 0; j2 < turns; j2++) ping(t0 + j2 * 0.034, fk, 0.2 + 0.015 * j2, 0.05, kpan, unsure);
        ping(t0 + turns * 0.034, fk, 0.2, 0.22, kpan, unsure);
      } else if (kn.type === 'E' || kn.type === 'EE') {
        ping(t0, fk, 0.2, 0.4, kpan, unsure);
        ping(t0, fk ? fk * 1.012 + 2 : 0, 0.2, 0.4, kpan, unsure);
      } else {
        var dec = 0.22 + 0.1 * Math.log10(Math.max(1, unit));
        for (j2 = 0; j2 < cnt; j2++) ping(t0 + j2 * 0.075, fk, 0.26, dec, kpan, unsure);
      }
    }

    // ---- endings ----------------------------------------------------------
    function stopAt(at, fadeSec, crack) {
      var c = Math.floor(at * n), fl = Math.max(1, Math.floor(fadeSec * sr)), k, e;
      for (k = c; k < n; k++) {
        e = k - c < fl ? 1 - (k - c) / fl : 0;
        L[k] *= e; R[k] *= e;
      }
      if (crack > 0) {
        var cl = Math.min(n - c, Math.floor(0.03 * sr)), lp = 0, v;
        for (k = 0; k < cl; k++) {
          lp += 0.6 * ((rnd() * 2 - 1) - lp);
          v = lp * crack * Math.exp(-k / (0.006 * sr));
          L[c + k] += v * gl; R[c + k] += v * gr;
        }
      }
    }
    if (f0) {
      if (term === 'B') stopAt(0.36 + 0.2 * rnd(), 0.003, 0.5);   // broken: torn off, with a crack
      else if (term === 'C') stopAt(0.24, 0.0004, 0.2);            // cut: a clean edge
      else if (term === 'U') stopAt(0.62, 0.02, 0);                // unfinished: just ends
    }

    // ---- tidy: fade the tail, keep the level sane -------------------------
    var tail = Math.floor(0.03 * sr), peak = 1e-6;
    for (i = 0; i < n; i++) {
      if (i > n - tail) { var e2 = (n - i) / tail; L[i] *= e2; R[i] *= e2; }
      var ab = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (ab > peak) peak = ab;
    }
    var scale = 0.5 / Math.max(0.6, peak);
    for (i = 0; i < n; i++) { L[i] *= scale; R[i] *= scale; }
    return { L: L, R: R };
  }

  // ======================================================================
  //  Web Audio wrapper
  // ======================================================================
  function Engine() {
    this.ctx = null;
    this.cache = new Map();
    this.voices = 0;
    this.maxVoices = 30;
    this.lastTick = 0;
    this.played = 0;      // cords sounded so far
    this.droneNodes = null;
  }

  Engine.prototype.start = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    var AC = G.AudioContext || G.webkitAudioContext;
    if (!AC) return false;
    var ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.dry = ctx.createGain(); this.dry.gain.value = 1;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.32;
    this.rev = ctx.createConvolver();
    this.rev.buffer = this._room(3.2);
    this.dry.connect(this.comp);
    this.rev.connect(this.wet); this.wet.connect(this.comp);
    this.comp.connect(this.master); this.master.connect(ctx.destination);
    this._noise = this._noiseBuf(0.5);
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  };

  Engine.prototype.ready = function () { return !!this.ctx && this.ctx.state === 'running'; };

  Engine.prototype.setVolume = function (v) {
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  };

  // a plain decaying-noise room: a storeroom, not a cathedral
  Engine.prototype._room = function (sec) {
    var ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate);
    var b = ctx.createBuffer(2, n, ctx.sampleRate), rnd = mulberry32(1532);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n;
        lp += (0.5 - 0.42 * t) * ((rnd() * 2 - 1) - lp);
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < 600 ? i / 600 : 1);
      }
    }
    return b;
  };

  Engine.prototype._noiseBuf = function (sec) {
    var ctx = this.ctx, n = Math.floor(sec * ctx.sampleRate);
    var b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), rnd = mulberry32(7);
    for (var i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    return b;
  };

  Engine.prototype._out = function (node, wetAmt) {
    node.connect(this.dry);
    if (wetAmt > 0) node.connect(this.rev);
  };

  Engine.prototype.pluck = function (spec, key, gain, delay) {
    if (!this.ready()) return;
    if (this.voices >= this.maxVoices) return;
    var ctx = this.ctx, buf = this.cache.get(key);
    if (!buf) {
      var s = synthCord(spec, ctx.sampleRate);
      buf = ctx.createBuffer(2, s.L.length, ctx.sampleRate);
      buf.getChannelData(0).set(s.L); buf.getChannelData(1).set(s.R);
      this.cache.set(key, buf);
      if (this.cache.size > 96) this.cache.delete(this.cache.keys().next().value);
    }
    var src = ctx.createBufferSource(); src.buffer = buf;
    var g = ctx.createGain(); g.gain.value = gain == null ? 1 : gain;
    src.connect(g); this._out(g, 1);
    var self = this; this.voices++;
    src.onended = function () { self.voices--; g.disconnect(); };
    src.start(ctx.currentTime + (delay || 0));
    this.played++;
  };

  Engine.prototype._burst = function (freq, q, gain, dur, pan, offset) {
    var ctx = this.ctx, t = ctx.currentTime;
    var src = ctx.createBufferSource(); src.buffer = this._noise;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g);
    var last = g;
    if (ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(p); last = p; }
    this._out(last, 1);
    src.onended = function () { last.disconnect(); };
    src.start(t, offset || 0, dur + 0.02);
  };

  // a grain of a fallen knot reaching the floor
  Engine.prototype.tick = function (pan, bright) {
    if (!this.ready()) return;
    var now = this.ctx.currentTime;
    if (now - this.lastTick < 0.035) return;
    this.lastTick = now;
    this._burst(1800 + 5000 * (bright || 0.5) * Math.random(), 6, 0.09, 0.03, pan, Math.random() * 0.4);
  };

  // a cord parting
  Engine.prototype.snap = function (pan) {
    if (!this.ready()) return;
    this._burst(900 + Math.random() * 700, 1.2, 0.5, 0.09, pan, Math.random() * 0.3);
  };

  // the primary cord: a low hum that is there as long as the khipu is
  Engine.prototype.drone = function (lenCm) {
    if (!this.ctx) return;
    var ctx = this.ctx, t = ctx.currentTime;
    if (this.droneNodes) {
      var old = this.droneNodes;
      old.g.gain.setTargetAtTime(0, t, 0.4);
      setTimeout(function () { try { old.o1.stop(); old.o2.stop(); old.lfo.stop(); old.g.disconnect(); } catch (e) {} }, 2500);
      this.droneNodes = null;
    }
    if (lenCm === null) return;                 // silence
    var f = lenCm > 0 ? PITCH_K / lenCm : 55;   // an unmeasured main cord hums at a default
    while (f < 42) f *= 2; while (f > 84) f /= 2;
    var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator();
    var g = ctx.createGain(), lg = ctx.createGain(), lp = ctx.createBiquadFilter();
    o1.type = 'triangle'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f * 1.5 + 0.3;
    lfo.frequency.value = 0.07; lg.gain.value = 0.02;
    lp.type = 'lowpass'; lp.frequency.value = 320;
    g.gain.value = 0; g.gain.setTargetAtTime(0.085, t, 1.5);
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(lp); o2.connect(lp); lp.connect(g); this._out(g, 1);
    o1.start(); o2.start(); lfo.start();
    this.droneNodes = { o1: o1, o2: o2, lfo: lfo, g: g };
  };

  G.KhipuAudio = { Engine: Engine, synthCord: synthCord, cordFreq: cordFreq, mulberry32: mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
