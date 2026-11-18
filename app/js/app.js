/*
 * Just Ends — stage, hand, ledger
 */
(function () {
  'use strict';

  var IDX = window.KHIPU_INDEX, COLORS = IDX.colors, STATS = IDX.stats;
  var A = window.KhipuAudio, KH = window.Khipu;
  var audio = new A.Engine();
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var NR = '<span class="nr">not recorded</span>';

  var params = new URLSearchParams(location.search);
  var DEFAULT = 'KH0279';
  var byId = {}, order = IDX.khipus.map(function (k) { byId[k.id] = k; return k.id; });

  var canvas = $('stage'), ctx = canvas.getContext('2d');
  var vw = 0, vh = 0, dpr = 1;
  var view = { s: 1, ox: 0, oy: 0, fitS: 1 };

  var K = null, raw = null, generation = 0;
  var playing = false, playX = 0, pi = 0, speed = 1, restAt = 0, simTime = 0;
  var wearAmt = 0.45, quiet = false, lastSnap = 0;
  var floorY = 0, grav = 30, grain = 0.1, H = 1;
  var flying = [], pieces = [], landedPieces = [], ghosts = [];
  var landed = new Map(), landedCount = 0, heap = null, heapX0 = 0, heapW = 1;
  var focus = null, focusVer = -1, lastFocusAt = 0, tallyDirty = true;

  // ───────────────────────── loading ─────────────────────────
  function load(id) {
    if (!byId[id]) id = DEFAULT;
    playing = false; $('read').textContent = 'Read';
    window.KHIPU_LOAD = function (d) { raw = d; generation = 0; tie(true); };
    var s = document.createElement('script');
    s.src = 'data/k/' + id + '.js';
    s.onload = function () { s.remove(); };
    s.onerror = function () { $('kline').textContent = 'Could not load ' + id + '. Run tools/build_data.py to rebuild the data files.'; };
    document.head.appendChild(s);
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    $('openCat').textContent = id;
  }

  function tie(fresh) {
    K = KH.build(raw, COLORS);
    if (!fresh) generation++;
    K.cords.forEach(function (c) {
      c.css = c.rgb ? rgb(c.rgb) : 'rgba(170,160,150,0.6)';
      c.kcss = rgb(mix(c.rgb || [170, 160, 150], 0.5));
      c.css2 = c.rgb2 ? rgb(c.rgb2) : null;
    });
    H = Math.max(4, K.maxY - K.minY);
    floorY = K.maxY + Math.max(2, H * 0.08);
    grav = Math.max(25, H * 1.7);
    grain = Math.max(0.04, H * 0.0035);
    flying = []; pieces = []; ghosts = [];
    if (fresh) {                                  // a re-tie keeps what has already fallen
      landed = new Map(); landedCount = 0; landedPieces = [];
      heapX0 = -K.W * 0.04; heapW = K.W * 1.08;
      heap = new Float32Array(600);
    }
    var T = clamp(K.pend.length * 0.22, 25, 150);
    speed = K.W / T; playX = -K.W * 0.01; pi = 0; restAt = 0;
    fit();
    audio.drone(K.cords.length ? (K.meta.plen || 0) : null);
    $('banner').hidden = true;
    renderHead(); setFocus(null); tallyDirty = true;
  }

  // ───────────────────────── geometry ─────────────────────────
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    if (K) fit();
  }

  function fit() {
    var ml = 40, mr = vw > 980 ? 356 : 40, mt = 112, mb = vw > 980 ? 150 : 270;
    var Hc = floorY - K.minY;
    var s = Math.min((vw - ml - mr) / K.W, (vh - mt - mb) / Hc);
    s = Math.max(s, 0.05);
    view.s = view.fitS = s;
    view.ox = ml + ((vw - ml - mr) - K.W * s) / 2;
    view.oy = mt + ((vh - mt - mb) - Hc * s) / 2 - K.minY * s;
    if (params.has('zoom')) zoom(parseFloat(params.get('zoom')) || 1, vw * 0.4, mt);   // deep link to a close view
  }

  function zoom(f, cx, cy) {
    var ns = clamp(view.s * f, view.fitS * 0.5, Math.max(view.fitS * 40, 60));
    f = ns / view.s;
    view.ox = cx - (cx - view.ox) * f; view.oy = cy - (cy - view.oy) * f; view.s = ns;
  }

  // ───────────────────────── colour ─────────────────────────
  function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }
  function mix(c, t) { return [c[0] + (255 - c[0]) * t, c[1] + (244 - c[1]) * t, c[2] + (225 - c[2]) * t]; }

  // ───────────────────────── touch ─────────────────────────
  var fx = {
    knot: function (c, k) {
      var at = k.pos != null ? Math.min(k.pos, c.curDraw) : c.curDraw * 0.5;
      var y = c.ey0 + c.dir * at, m = Math.min(k.n, 5);
      for (var j = 0; j < m; j++) {
        flying.push({
          x: c.ex + (Math.random() - 0.5) * grain * 3, y: y + c.dir * j * grain * 2,
          vx: (Math.random() - 0.5) * H * 0.06, vy: -Math.random() * H * 0.05,
          rgb: c.rgb || [150, 140, 128], lum: c.lum
        });
      }
      tallyDirty = true;
    },
    snap: function (c, piece) {
      var top = c.ey0 + c.dir * c.curDraw;
      pieces.push({ x: c.ex, y: top + c.dir * piece / 2, len: piece, ang: 0, va: (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * H * 0.05, vy: 0, css: c.css });
      crack(c);
    },
    fall: function (c) {
      pieces.push({ x: c.ex, y: c.ey0 + c.dir * c.curDraw / 2, len: c.curDraw, ang: 0, va: (Math.random() - 0.5) * 2.4, vx: (Math.random() - 0.5) * H * 0.04, vy: 0, css: c.css });
      if (c.parent === -1) ghosts.push(c.pos);
      crack(c);
      tallyDirty = true;
    }
  };

  function crack(c) {
    if (quiet || simTime - lastSnap < 0.07) return;
    lastSnap = simTime;
    audio.snap((c.ex / K.W) * 1.4 - 0.7);
  }

  function pluck(c, gain, delay, silent) {
    if (c.gone) return;
    c.vib = 1; c.phase = 0; c.lastPluck = simTime;
    if (!silent) audio.pluck(KH.spec(K, c), K.id + ':' + generation + ':' + c.i + ':' + c.ver, gain, delay);
    var kids = c.children;
    quiet = silent;
    KH.wear(K, c, wearAmt, fx);
    for (var j = 0; j < kids.length; j++) {
      if (!kids[j].gone) pluck(kids[j], gain * 0.6, Math.min(0.7, delay + 0.09 * (j + 1)), silent || j >= 8);
    }
  }

  function lowerBound(arr, x) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m].ex < x) lo = m + 1; else hi = m; }
    return lo;
  }

  function strum(x0, x1, y) {
    if (!K) return;
    var a = Math.min(x0, x1), b = Math.max(x0, x1);
    if (b - a > K.W * 0.25) return;                 // the pointer jumped; that is not a stroke
    var tol = 6 / view.s, n = 0;
    for (var i = lowerBound(K.byX, a); i < K.byX.length && K.byX[i].ex <= b; i++) {
      var c = K.byX[i];
      if (c.gone || simTime - c.lastPluck < 0.12) continue;
      var ya = c.ey0, yb = c.ey0 + c.dir * c.curDraw;
      if (y < Math.min(ya, yb) - tol || y > Math.max(ya, yb) + tol) continue;
      pluck(c, 1, n * 0.012, false);
      setFocus(c);
      if (++n > 12) break;
    }
  }

  // ───────────────────────── time ─────────────────────────
  function step(dt, silent) {
    simTime += dt;
    if (!K) return;

    if (playing) {
      if (K.now.cords <= 0) { finish(); }
      else if (simTime >= restAt) {
        playX += speed * dt;
        var n = 0;
        while (pi < K.pend.length && K.pend[pi].pos <= playX) {
          var c = K.pend[pi++];
          if (c.gone) continue;
          pluck(c, 0.85, Math.min(0.1, n * 0.012), silent);
          if (!silent && simTime - lastFocusAt > 0.22) setFocus(c);
          n++;
        }
        if (playX > K.W * 1.01) {
          K.readings++; playX = -K.W * 0.01; pi = 0; restAt = simTime + 1.4; tallyDirty = true;
        }
      }
    }

    var i, c2, cs = K.cords;
    for (i = 0; i < cs.length; i++) {
      c2 = cs[i];
      if (c2.vib > 0) { c2.vib *= Math.exp(-dt * 2.4); c2.phase += dt * 38; if (c2.vib < 0.02) c2.vib = 0; }
    }

    // falling knots
    for (i = flying.length - 1; i >= 0; i--) {
      var p = flying[i];
      p.vy += grav * dt; p.vx *= (1 - 1.2 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      var b = clamp(Math.floor((p.x - heapX0) / heapW * heap.length), 0, heap.length - 1);
      if (p.y >= floorY - heap[b]) {
        p.y = floorY - heap[b];
        heap[b] += grain * 0.55;
        if (b > 0) heap[b - 1] += grain * 0.2;
        if (b < heap.length - 1) heap[b + 1] += grain * 0.2;
        var key = rgb(mix(p.rgb, 0.15), 0.9), arr = landed.get(key);
        if (!arr) { arr = []; landed.set(key, arr); }
        arr.push(p.x, p.y); landedCount++;
        if (!silent) audio.tick((p.x / K.W) * 1.4 - 0.7, p.lum);
        flying[i] = flying[flying.length - 1]; flying.pop();
      }
    }
    // falling lengths of cord
    for (i = pieces.length - 1; i >= 0; i--) {
      var q = pieces[i];
      q.vy += grav * dt; q.y += q.vy * dt; q.x += q.vx * dt; q.ang += q.va * dt;
      var b2 = clamp(Math.floor((q.x - heapX0) / heapW * heap.length), 0, heap.length - 1);
      if (q.y >= floorY - heap[b2] - grain) {
        q.y = floorY - heap[b2] - grain * 0.5;
        q.ang = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.5);
        q.len = Math.min(q.len * 0.4, K.W * 0.07);   // a fallen cord slumps; it does not lie straight
        q.x = clamp(q.x, heapX0 + q.len / 2, heapX0 + heapW - q.len / 2);
        var span = Math.max(1, Math.round(q.len / heapW * heap.length / 2));
        for (var j = Math.max(0, b2 - span); j <= Math.min(heap.length - 1, b2 + span); j++) heap[j] += grain * 0.35;
        landedPieces.push(q);
        if (landedPieces.length > 2500) landedPieces.splice(0, 500);
        pieces[i] = pieces[pieces.length - 1]; pieces.pop();
      }
    }
  }

  function finish() {
    playing = false; $('read').textContent = 'Read';
    $('bannerText').innerHTML = 'Nothing hangs from the main cord.<br>The archive still says ' +
      fmt(K.archive.cords) + ' cords, ' + fmt(K.archive.knots) + ' knots, a sum of ' + fmt(K.archive.value) + '.';
    $('banner').hidden = false;
    tallyDirty = true;
  }

  // ───────────────────────── drawing ─────────────────────────
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (!K) return;
    var s = view.s, ox = view.ox, oy = view.oy, i, j;
    var lw = clamp(s * 0.11, 0.7, 3.4);
    var fy = oy + floorY * s;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // the floor
    ctx.strokeStyle = 'rgba(239,230,214,0.10)'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ox + heapX0 * s, fy + 1.5); ctx.lineTo(ox + (heapX0 + heapW) * s, fy + 1.5); ctx.stroke();

    // what has fallen
    var ps = clamp(grain * s * 1.6, 1.2, 4);
    ctx.lineWidth = Math.max(0.7, lw * 0.8);
    for (i = 0; i < landedPieces.length; i++) drawPiece(landedPieces[i], s, ox, oy, 0.75);
    landed.forEach(function (arr, key) {
      ctx.fillStyle = key;
      for (var k = 0; k < arr.length; k += 2) ctx.fillRect(ox + arr[k] * s - ps / 2, oy + arr[k + 1] * s - ps, ps, ps);
    });
    for (i = 0; i < pieces.length; i++) drawPiece(pieces[i], s, ox, oy, 1);
    for (i = 0; i < flying.length; i++) {
      var p = flying[i];
      ctx.fillStyle = rgb(mix(p.rgb, 0.35));
      ctx.fillRect(ox + p.x * s - ps / 2, oy + p.y * s - ps / 2, ps, ps);
    }

    // the reading hand
    if (playing) {
      var hx = ox + playX * s, top = oy + K.minY * s - 14;
      var g = ctx.createLinearGradient(hx - 46, 0, hx + 46, 0);
      g.addColorStop(0, 'rgba(255,236,200,0)'); g.addColorStop(0.5, 'rgba(255,236,200,0.11)'); g.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = g; ctx.fillRect(hx - 46, top, 92, fy - top);
    }

    // the main cord
    var pw = clamp(s * 0.34, 2.4, 9), pc = COLORS[K.meta.pcol];
    ctx.strokeStyle = pc ? rgb(mix(pc, 0.12)) : 'rgb(206,192,168)';
    ctx.lineWidth = pw; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + K.W * s, oy); ctx.stroke();
    if (pw > 4) {                                   // a suggestion of ply
      ctx.strokeStyle = 'rgba(30,22,16,0.28)'; ctx.lineWidth = 1; ctx.setLineDash([pw * 0.5, pw * 0.9]);
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + K.W * s, oy); ctx.stroke(); ctx.setLineDash([]);
    }
    // "…was probably present as indicated by the discoloration on the main cord"
    ctx.fillStyle = 'rgba(24,14,8,0.6)';
    for (i = 0; i < ghosts.length; i++) ctx.fillRect(ox + ghosts[i] * s - Math.max(1, lw) / 2, oy - pw / 2, Math.max(1, lw), pw);

    // the cords
    var cs = K.cords, drawKnots = s > 0.9, fine = s >= 3;
    for (i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.gone) continue;
      var X = ox + c.ex * s;
      if (X < -60 || X > vw + 60) continue;
      var y0 = oy + c.ey0 * s, y1 = oy + (c.ey0 + c.dir * c.curDraw) * s;
      var w = c.parent === -1 ? lw : lw * 0.8;
      var glow = c.vib;

      ctx.beginPath();
      if (c.parent !== -1) { ctx.moveTo(ox + c.sx * s, oy + c.sy * s); ctx.lineTo(X, y0); } else ctx.moveTo(X, y0);
      if (glow > 0) {
        var off = Math.sin(c.phase) * glow * Math.min(10, 2.5 + s * 0.5);
        ctx.quadraticCurveTo(X + off * 2, (y0 + y1) / 2, X, y1);
      } else ctx.lineTo(X, y1);

      ctx.globalAlpha = 0.4 + 0.6 * clamp(c.integrity, 0, 1);
      if (!c.len) ctx.setLineDash([1.5, 4.5]);          // length not recorded
      else if (!c.rgb) ctx.setLineDash([4, 3]);         // colour not recorded
      else ctx.setLineDash([]);
      if (c.rgb && c.lum < 0.17) {                      // dark cords get a pale edge so they can be seen
        ctx.strokeStyle = 'rgba(255,238,215,0.17)'; ctx.lineWidth = w + 1.5; ctx.stroke();
      }
      ctx.strokeStyle = glow > 0 && c.rgb ? rgb(mix(c.rgb, glow * 0.6)) : c.css;
      ctx.lineWidth = w; ctx.stroke();
      if (c.css2 && s > 1.5 && c.len) {                 // barber pole / mottled
        ctx.setLineDash(c.op === '-' ? [w * 2.2, w * 2.4] : [w * 0.6, w * 3.6]);
        ctx.strokeStyle = c.css2; ctx.stroke();
      }
      ctx.setLineDash([]);

      // knots
      if (drawKnots && c.knots.length) {
        var r = Math.max(0.9, w * 1.15), nk = c.knots.length;
        for (j = 0; j < nk; j++) {
          var k = c.knots[j];
          if (!k.alive) continue;
          var at = k.pos != null ? k.pos : c.curDraw * (j + 1) / (nk + 1);
          if (at > c.curDraw) at = c.curDraw;
          var ky = y0 + c.dir * at * s;
          ctx.fillStyle = c.kcss; ctx.strokeStyle = c.kcss;
          if (k.pos == null) ctx.globalAlpha *= 0.55;
          var t = k.type;
          if (t === 'L' || t === 'LL' || t === 'BL' || t === 'SP') {
            var turns = clamp(Math.round(k.value / (k.n || 1)) || 2, 2, 11), hh = Math.max(r * 2.2, turns * r * 0.95);
            ctx.fillRect(X - r * 1.15, ky - (c.dir < 0 ? hh : 0), r * 2.3, hh);
            if (r >= 2.2) {                              // the slant of the turns: S "\" or Z "/"
              ctx.strokeStyle = 'rgba(30,22,16,0.55)'; ctx.lineWidth = 0.8;
              var sl = k.dir === 'S' ? 1 : (k.dir === 'Z' ? -1 : 0), yy0 = ky - (c.dir < 0 ? hh : 0);
              ctx.beginPath();
              for (var tt = 0; tt < turns; tt++) {
                var ty = yy0 + (tt + 0.5) * hh / turns;
                ctx.moveTo(X - r * 1.15, ty - sl * r * 0.5); ctx.lineTo(X + r * 1.15, ty + sl * r * 0.5);
              }
              ctx.stroke();
            }
          } else if (t === 'E' || t === 'EE') {
            ctx.lineWidth = Math.max(0.8, r * 0.55);
            ctx.beginPath(); ctx.arc(X, ky, r * 1.3, 0, 6.2832); ctx.stroke();
          } else {
            var cnt = Math.min(k.n, 9);
            ctx.beginPath();
            for (var d = 0; d < cnt; d++) { ctx.moveTo(X + r, ky + c.dir * d * r * 2.1); ctx.arc(X, ky + c.dir * d * r * 2.1, r, 0, 6.2832); }
            ctx.fill();
          }
          if (k.pos == null) ctx.globalAlpha = 0.4 + 0.6 * clamp(c.integrity, 0, 1);
        }
      }

      // the end of the cord
      if (fine) {
        var term = c.snapped ? 'B' : c.term, e = Math.min(7, s * 0.5) * c.dir;
        ctx.strokeStyle = c.css; ctx.lineWidth = Math.max(0.6, w * 0.5);
        if (term === 'B' || term === 'R') {
          var sp = term === 'R' ? 1.6 : 0.9;
          ctx.beginPath();
          ctx.moveTo(X, y1); ctx.lineTo(X - e * 0.5 * sp, y1 + e);
          ctx.moveTo(X, y1); ctx.lineTo(X + e * 0.15, y1 + e * 1.2);
          ctx.moveTo(X, y1); ctx.lineTo(X + e * 0.55 * sp, y1 + e * 0.8);
          ctx.stroke();
        } else if (term === 'TT') {
          ctx.fillStyle = '#c8553a'; ctx.fillRect(X - w, y1 - (c.dir > 0 ? 5 : 0), w * 2, 5);
        } else if (term === 'D') {
          ctx.beginPath(); ctx.arc(X, y1, w * 1.1, 0, 6.2832); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPiece(q, s, ox, oy, alpha) {
    var dx = Math.sin(q.ang) * q.len / 2, dy = Math.cos(q.ang) * q.len / 2;
    ctx.globalAlpha = alpha; ctx.strokeStyle = q.css;
    ctx.beginPath(); ctx.moveTo(ox + (q.x - dx) * s, oy + (q.y - dy) * s); ctx.lineTo(ox + (q.x + dx) * s, oy + (q.y + dy) * s); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ───────────────────────── words ─────────────────────────
  function renderHead() {
    var m = K.meta, held = [m.museum, m.city, m.country].filter(Boolean).join(', ');
    $('kline').innerHTML = '<b>' + esc(m.id) + '</b>' + (m.inv ? ' (' + esc(m.inv) + ')' : '') +
      ' · from ' + (m.prov ? esc(m.prov) : NR) + ' · held: ' + (held ? esc(held) : NR);
    var bits = [];
    if (!K.cords.length) bits.push('the archive holds a number for this khipu, and no cords');
    else {
      bits.push('main cord ' + (m.plen ? m.plen + ' cm' : 'length not recorded'));
      if (m.xrec === 0) bits.push('pendant positions not recorded, shown evenly spaced');
      else if (m.xrec < 1) bits.push('position not recorded for ' + Math.max(1, Math.round((1 - m.xrec) * 100)) + '% of pendants, shown at a nominal spacing');
    }
    $('ksub').textContent = bits.join(' · ');
  }

  function swatch(code) {
    var c = COLORS[code];
    return c ? '<span class="sw" style="background:rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')"></span>' : '';
  }

  function setFocus(c) {
    focus = c; focusVer = c ? c.ver : -1; lastFocusAt = simTime;
    var el = $('ledger'), h;
    if (!K) { el.innerHTML = ''; return; }
    if (!c) {
      var m = K.meta;
      h = '<h3>' + esc(m.id) + '<small>the khipu record</small></h3><table>' +
        row('from', m.prov ? esc(m.prov) : NR) +
        row('found by', m.by ? esc(m.by) : NR) + row('found on', m.date ? esc(m.date) : NR) +
        row('held', esc([m.museum, m.city, m.country].filter(Boolean).join(', ')) || NR) +
        row('named', esc(m.inv || '') || NR) +
        row('cords', fmt(K.archive.cords)) + row('knots', fmt(K.archive.knots)) + row('sum', fmt(K.archive.value)) +
        '</table>';
      if (m.pnotes) h += '<p class="quote">“' + esc(m.pnotes) + '”</p>';
      if (m.notes) h += '<p class="note">' + esc(m.notes) + '</p>';
      if (!m.pnotes && !m.notes) h += '<p class="note">Move across the cords. This panel shows each cord\'s row: what the archive says, and what is left.</p>';
      el.innerHTML = h; return;
    }
    var kind = c.parent === -1 ? (c.up ? 'top cord' : 'pendant') : 'subsidiary, level ' + Math.abs(c.level);
    var T = KH.TERM[c.term], col = COLORS[c.c1];
    var colour = c.c1 ? swatch(c.c1) + '<span class="code">' + esc(c.c1) + '</span> ' + esc(col ? col[3] : '') +
      (c.c2 ? '<br>' + esc(KH.COLOR_OP[c.op] || 'with') + ' ' + swatch(c.c2) + esc(c.c2) : '') : NR;
    var alive = 0, valNow = 0;
    var kn = c.knots.map(function (k) {
      if (k.alive) { alive++; valNow += k.value; }
      return (k.n > 1 ? k.n + '× ' : '') + (KH.KNOT[k.type] || 'unknown type') + ' (' + k.value + ')' +
        (k.pos != null ? ' at ' + k.pos + ' cm' : '') + (k.dir === 'U' ? '' : ' ' + k.dir);
    }).join('<br>');
    var lenNow = c.gone ? 'on the floor' : (c.curLen ? (Math.round(c.curLen * 10) / 10) + ' cm' : '—');
    var endNow = c.gone ? 'fallen' : (c.snapped ? 'broken' : (T ? T[0] : '—'));
    h = '<h3>cord ' + (c.i + 1) + '<small>of ' + fmt(K.archive.cords) + ' · ' + kind + '</small></h3>' +
      '<table><tr><th></th><th>archive</th><th>now</th></tr>' +
      row('length', c.len ? c.len + ' cm' : NR, lenNow, c.gone || (c.len && c.curLen < c.len)) +
      row('colour', colour) +
      row('fiber', KH.FIBER[c.fiber] ? '<span class="code">' + esc(c.fiber) + '</span> ' + esc(KH.FIBER[c.fiber]) : NR) +
      row('twist', c.twist === 'S' || c.twist === 'Z' ? c.twist : NR) +
      row('attached', KH.ATTACH[c.att] ? '<span class="code">' + esc(c.att) + '</span> ' + KH.ATTACH[c.att] : NR) +
      row('ends', T ? '<span class="code">' + esc(c.term) + '</span> ' + T[0] : NR, endNow, c.gone || c.snapped) +
      row('knots', kn || 'none', c.knots.length ? alive + ' of ' + c.knots.length : '—', alive < c.knots.length) +
      row('value', fmt(c.value), fmt(valNow), valNow < c.value) +
      '</table>';
    if (T) h += '<p class="quote">“' + esc(T[1]) + '”</p>';
    if (c.note) h += '<p class="note">note: ' + esc(c.note) + '</p>';
    el.innerHTML = h;
  }

  function row(label, archive, now, lost) {
    return '<tr><td>' + label + '</td><td' + (now === undefined ? ' colspan="2"' : '') + '>' + archive + '</td>' +
      (now === undefined ? '' : '<td class="now' + (lost ? ' lost' : '') + '">' + now + '</td>') + '</tr>';
  }

  function renderTally() {
    tallyDirty = false;
    if (!K) return;
    var a = K.archive, n = K.now;
    function part(label, now, was) { return '<span class="' + (now < was ? 'gone' : '') + '">' + label + ' <b>' + fmt(now) + '</b> of ' + fmt(was) + '</span>'; }
    $('tally').innerHTML = [part('cords', n.cords, a.cords), part('knots', n.knots, a.knots), part('sum', n.value, a.value)].join(' · ') +
      ' · read ' + K.readings + '×' + (generation ? ' · re-tied ' + generation + '×' : '');
    if (params.has('debug')) $('tally').innerHTML += ' · audio ' + (audio.ctx ? audio.ctx.state : 'off') + ', ' + audio.played + ' cords sounded, ' + audio.voices + ' voices';
  }

  // ───────────────────────── catalogue ─────────────────────────
  function renderCatalogue() {
    var f = $('catFilter').value.trim().toLowerCase(), sort = $('catSort').value;
    var list = IDX.khipus.filter(function (k) {
      return !f || (k.id + ' ' + k.inv + ' ' + k.prov + ' ' + k.museum + ' ' + k.country).toLowerCase().indexOf(f) >= 0;
    });
    if (sort !== 'id') list.sort(function (a, b) { return b[sort] - a[sort] || (a.id < b.id ? -1 : 1); });
    $('catCount').textContent = list.length + ' of ' + IDX.khipus.length;
    var h = '<div class="row head"><span>number</span><span>from</span><span>held</span><span class="r">cords</span><span class="r">knots</span><span class="r">broken</span></div>';
    for (var i = 0; i < list.length; i++) {
      var k = list[i], pct = Math.round(k.broken * 100);
      h += '<button class="row" role="listitem" data-id="' + k.id + '"><span class="id">' + k.id + '</span><span>' +
        (k.prov ? esc(k.prov) : NR) + '</span><span>' + esc([k.museum, k.country].filter(Boolean).join(', ')) +
        '</span><span class="r">' + fmt(k.n) + '</span><span class="r">' + fmt(k.knots) +
        '</span><span class="bar"><i style="width:' + Math.round(k.broken * 60) + '%"></i><em>' + pct + '%</em></span></button>';
    }
    $('catList').innerHTML = h;
  }

  function fillStats() {
    var c = STATS.counts, t = STATS.terminations, vals = {
      khipus: c.khipus, cords: c.cords, knots: c.knots, km: (STATS.total_cord_metres / 1000).toFixed(1),
      unknown_attachment: c.unknown_attachment, khipus_no_provenance: c.khipus_no_provenance,
      khipus_no_date: c.khipus_no_date, khipus_no_discoverer: c.khipus_no_discoverer,
      broken: t.B, unfinished: t.U, ravelled: t.R, cords_no_knots: c.cords_no_knots,
      knot_dir_unknown: STATS.knot_directions.U,
      abroad: c.khipus - (STATS.countries.Peru || 0), germany: STATS.countries.Germany || 0
    };
    document.querySelectorAll('[data-stat]').forEach(function (el) {
      var v = vals[el.getAttribute('data-stat')];
      if (v !== undefined) el.textContent = typeof v === 'number' ? fmt(v) : v;
    });
  }

  // ───────────────────────── controls ─────────────────────────
  function toggleRead() {
    if (!K || !K.cords.length) return;
    audio.start();
    if (K.now.cords <= 0) { finish(); return; }
    playing = !playing;
    $('read').textContent = playing ? 'Pause' : 'Read';
  }
  function retie() { if (raw) { playing = false; $('read').textContent = 'Read'; tie(false); } }
  function go(delta) {
    var i = order.indexOf(K ? K.id : DEFAULT);
    load(order[(i + delta + order.length) % order.length]);
  }
  function show(id, on) { $(id).hidden = !on; }

  $('read').onclick = toggleRead;
  $('retie').onclick = retie;
  $('bannerRetie').onclick = retie;
  $('prev').onclick = function () { go(-1); };
  $('next').onclick = function () { go(1); };
  $('fit').onclick = function () { if (K) fit(); };
  $('zin').onclick = function () { zoom(1.5, vw / 2, vh / 2); };
  $('zout').onclick = function () { zoom(1 / 1.5, vw / 2, vh / 2); };
  $('wear').oninput = function () { wearAmt = +this.value; };
  $('vol').oninput = function () { audio.setVolume(+this.value); };
  $('openCat').onclick = function () { renderCatalogue(); show('catalogue', true); $('catFilter').focus(); };
  $('openAbout').onclick = function () { show('about', true); };
  $('catFilter').oninput = renderCatalogue;
  $('catSort').onchange = renderCatalogue;
  $('catList').onclick = function (e) {
    var b = e.target.closest('[data-id]');
    if (b) { show('catalogue', false); load(b.getAttribute('data-id')); }
  };
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.onclick = function () { show(b.getAttribute('data-close'), false); };
  });
  document.querySelectorAll('.overlay').forEach(function (o) {
    o.addEventListener('pointerdown', function (e) { if (e.target === o && o.id !== 'intro') o.hidden = true; });
  });
  function enter() {
    audio.start();
    audio.setVolume(+$('vol').value);
    if (K) audio.drone(K.cords.length ? (K.meta.plen || 0) : null);
    show('intro', false);
  }
  $('enter').onclick = enter;

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { show('catalogue', false); show('about', false); return; }
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || !$('intro').hidden || !$('catalogue').hidden || !$('about').hidden) return;
    if (e.key === ' ') { e.preventDefault(); toggleRead(); }
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'f') { if (K) fit(); }
  });

  // the hand
  var last = null, drag = null;
  canvas.addEventListener('pointerdown', function (e) {
    audio.start();
    if (e.pointerType === 'mouse') { drag = { x: e.clientX, y: e.clientY }; canvas.classList.add('panning'); canvas.setPointerCapture(e.pointerId); }
    last = null;
  });
  canvas.addEventListener('pointermove', function (e) {
    if (drag) {
      view.ox += e.clientX - drag.x; view.oy += e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; return;
    }
    var x = (e.clientX - view.ox) / view.s, y = (e.clientY - view.oy) / view.s;
    if (last) strum(last.x, x, y);
    last = { x: x, y: y };
  });
  function lift() { drag = null; last = null; canvas.classList.remove('panning'); }
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('pointerleave', function () { last = null; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else { view.ox -= e.deltaX; view.oy -= e.deltaY; }
  }, { passive: false });
  canvas.addEventListener('dblclick', function () { if (K) fit(); });
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', function () {
    var id = location.hash.slice(1);
    if (byId[id] && (!K || K.id !== id)) load(id);
  });

  // ───────────────────────── loop ─────────────────────────
  var lastT = 0, ffDone = false;
  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
    if (K && !ffDone) {                             // ?ff=seconds : see a later state straight away
      ffDone = true;
      if (params.has('panel')) { if (params.get('panel') === 'catalogue') renderCatalogue(); show(params.get('panel'), true); }
      var ff = parseFloat(params.get('ff') || '0');
      if (ff > 0) { var was = playing; playing = true; for (var i = 0; i < ff * 30; i++) step(1 / 30, !(params.has('debug') && i >= ff * 30 - 45)); playing = was && K.now.cords > 0; }
      if (params.has('cord')) { var fc = K.cords[parseInt(params.get('cord'), 10) - 1]; if (fc) { fc.vib = 1; setFocus(fc); } }
    }
    step(dt, false);
    draw();
    if (tallyDirty) renderTally();
    if (focus && focus.ver !== focusVer) setFocus(focus);
    requestAnimationFrame(frame);
  }

  // ───────────────────────── begin ─────────────────────────
  fillStats();
  resize();
  if (params.has('wear')) { wearAmt = clamp(parseFloat(params.get('wear')) || 0, 0, 1); $('wear').value = wearAmt; }
  if (params.has('autostart')) show('intro', false);
  // ?play : kiosk mode. Start sounding and reading without a click (needs a browser
  // launched with autoplay allowed, e.g. chromium --autoplay-policy=no-user-gesture-required)
  load(location.hash.slice(1) || DEFAULT);
  if (params.has('play')) { enter(); playing = true; $('read').textContent = 'Pause'; }
  requestAnimationFrame(frame);
})();
