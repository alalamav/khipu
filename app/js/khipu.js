/*
 * Just Ends — the khipu as a model
 *
 * Turns one khipu's rows into cords with a place in space (centimetres, in
 * the proportions the archive recorded), and holds the only rule of the
 * piece: touch wears things out.
 *
 * Two states are kept side by side and never merged:
 *   archive — what the database says. It does not change.
 *   now     — what is still hanging. It only ever gets smaller.
 */
(function (G) {
  'use strict';

  // The vocabulary below is quoted verbatim from the database's own
  // dictionary tables (termination_dc, fiber_dc, attachment_dc, knot_type_dc).
  var TERM = {
    K: ['knotted', 'cord ends with a knot near the bottom'],
    B: ['broken', 'cord has been broken'],
    C: ['cut', 'cord has been cut (sharper end than broken)'],
    R: ['ravelled', 'plies are coming apart'],
    D: ['doubled', 'end of cord is doubled over'],
    U: ['unfinished', 'not knotted; not broken; not cut... just ends'],
    TT: ['canutito', 'end of cord is wrapped with colored thread']
  };
  var FIBER = {
    A: 'alpaca', L: 'llama', CN: 'cotton', W: "wool (sheep's wool)", V: 'vegetal fiber, undetermined',
    CL: 'camelid: llama or alpaca', CC: 'cotton & camelid', CW: 'cotton & wool', H: 'human hair', AH: 'animal hair'
  };
  var ATTACH = { R: 'recto', V: 'verso', H: 'overhand knot' };
  var KNOT = {
    S: 'single', L: 'long', E: 'figure eight', EE: 'double figure 8', LL: 'double long',
    BL: 'belted long knot', SP: 'spiral knot', TF: 'tufted knot'
  };
  var COLOR_OP = { '-': 'barber pole', ':': 'mottled', '%': 'con elemento' };

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }

  function build(d, colors) {
    var rnd = G.KhipuAudio.mulberry32(parseInt(d.id.replace(/\D/g, ''), 10) || 1);
    var lens = [];
    var cords = d.cords.map(function (a, i) {
      var knots = a[11].map(function (k) {
        return { pos: k[0], type: k[1], n: k[2], value: k[3], dir: k[4], alive: true };
      });
      var rgb = colors[a[4]] || null, rgb2 = colors[a[6]] || null;
      if (a[3]) lens.push(a[3]);
      return {
        i: i, parent: a[0], level: a[1], up: a[1] < 0, pos: a[2], len: a[3],
        c1: a[4], op: a[5], c2: a[6], term: a[7], twist: a[8], att: a[9], fiber: a[10],
        knots: knots, note: a[12], guess: a[13] === 1, children: [],
        rgb: rgb, rgb2: rgb2,
        lum: rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0.4,
        value: knots.reduce(function (s, k) { return s + k.value; }, 0),
        nknots: knots.reduce(function (s, k) { return s + k.n; }, 0),
        // state "now"
        curLen: a[3], drawLen: 0, curDraw: 0, integrity: 1, gone: false, snapped: false,
        vib: 0, phase: 0, ver: 0, lastPluck: -1e9
      };
    });

    var nominal = median(lens) || 20;   // a cord of unrecorded length is drawn at the median, dotted
    var pend = cords.filter(function (c) { return c.parent === -1; })
      .sort(function (a, b) { return a.pos - b.pos; });
    var gaps = [];
    for (var i = 1; i < pend.length; i++) { var g = pend[i].pos - pend[i - 1].pos; if (g > 0) gaps.push(g); }
    var pitch = Math.max(0.15, Math.min(0.9, median(gaps) || 0.5));

    var minY = 0, maxY = 0, maxX = 0;
    cords.forEach(function (c) {           // parents always precede children
      c.drawLen = c.curDraw = c.len || nominal;
      if (c.parent === -1) {
        c.dir = c.up ? -1 : 1;
        c.sx = c.ex = c.pos; c.sy = 0; c.ey0 = 0;
      } else {
        var p = cords[c.parent];
        c.dir = p.dir;
        c.attachAt = c.pos != null ? Math.min(c.pos, p.drawLen) : p.drawLen * 0.3;
        var j = p.children.length;
        p.children.push(c);
        var off = pitch * 0.3 * (1 + (j % 6));
        c.sx = p.ex; c.sy = p.ey0 + p.dir * c.attachAt;
        c.ex = p.ex + off; c.ey0 = c.sy + c.dir * off * 1.3;
      }
      var end = c.ey0 + c.dir * c.drawLen;
      if (end < minY) minY = end; if (end > maxY) maxY = end;
      if (c.ey0 < minY) minY = c.ey0;
      if (c.ex > maxX) maxX = c.ex;
    });

    var W = Math.max(d.plen || 0, maxX + 1, 4);
    var byX = cords.slice().sort(function (a, b) { return a.ex - b.ex; });
    var archive = {
      cords: cords.length,
      knots: cords.reduce(function (s, c) { return s + c.nknots; }, 0),
      value: cords.reduce(function (s, c) { return s + c.value; }, 0)
    };
    return {
      id: d.id, meta: d, cords: cords, pend: pend, byX: byX, W: W, minY: minY, maxY: maxY,
      nominal: nominal, rnd: rnd, archive: archive,
      now: { cords: archive.cords, knots: archive.knots, value: archive.value },
      readings: 0, touches: 0
    };
  }

  // ---- wear --------------------------------------------------------------
  // fx = { knot(cord, knot), snap(cord, pieceLen), fall(cord) }

  function dropKnot(K, c, k, fx) {
    k.alive = false;
    K.now.knots -= k.n; K.now.value -= k.value;
    fx.knot(c, k);
  }

  function dropCord(K, c, fx) {
    if (c.gone) return;
    c.knots.forEach(function (k) { if (k.alive) dropKnot(K, c, k, fx); });
    c.gone = true; c.ver++;
    K.now.cords--;
    fx.fall(c);
    c.children.forEach(function (ch) { dropCord(K, ch, fx); });
  }

  function wear(K, c, amount, fx) {
    if (c.gone || !(amount > 0)) return;
    var rnd = K.rnd, alive = 0, changed = false;
    K.touches++;
    c.knots.forEach(function (k) {
      if (!k.alive) return;
      if (rnd() < amount * 0.5) { dropKnot(K, c, k, fx); changed = true; } else alive++;
    });
    if (alive === 0) {
      // nothing left to loosen: now the cord itself gives way
      c.integrity -= amount * (0.4 + 0.6 * rnd());
      changed = true;
      if (c.integrity <= 0) {
        if (c.curDraw > 5 && rnd() < 0.5) {
          var old = c.curDraw, keep = old * (0.3 + 0.45 * rnd());
          c.curDraw = keep;
          if (c.curLen) c.curLen = c.curLen * keep / old;
          c.snapped = true; c.integrity = 0.5;
          fx.snap(c, old - keep);
          c.children.forEach(function (ch) { if (ch.attachAt > keep) dropCord(K, ch, fx); });
        } else {
          dropCord(K, c, fx);
          return;
        }
      }
    }
    if (changed) c.ver++;
  }

  function spec(K, c) {
    var knots = [];
    for (var i = 0; i < c.knots.length; i++) if (c.knots[i].alive) knots.push(c.knots[i]);
    return {
      len: c.curLen, lum: c.lum, term: c.snapped ? 'B' : c.term, knots: knots,
      pan: (c.ex / K.W) * 1.4 - 0.7, integrity: c.integrity, seed: c.i * 7919 + c.ver * 13 + 1
    };
  }

  G.Khipu = {
    build: build, wear: wear, spec: spec,
    TERM: TERM, FIBER: FIBER, ATTACH: ATTACH, KNOT: KNOT, COLOR_OP: COLOR_OP
  };
})(typeof window !== 'undefined' ? window : globalThis);
