/*
 * cfd-blade.js — the blade's side profile, shared by the 1D, 2D and 3D solvers and the drawings: its
 * underside from the inlet to the metering point M (the gap H there) and its exit face from M up, each a
 * path of straight lines and circular arcs, with the corners where the contact line can pin.
 * Pure computation, no DOM.
 *
 * Axes (SI, m): x along the web from the inlet (the start of the underside), y up from the web. A
 * direction is an angle in radians from +x, counter-clockwise (the inputs are in degrees). Along both
 * paths the liquid is on the right: under the underside, downstream of the face.
 *
 * Shapes (bladeProfile): 'round' (an entry radius R from the pool edge Xup) and 'flat' (a land L), the
 * shapes the solvers have always had (legacy: their old code paths run, node for node); 'bevel' (the land
 * L, a chamfer at bevelDeg of length bevelLen, then the exit face); 'radius' (the land L, the edge rounded
 * with radius r into the exit face); 'wedge' (a straight underside from the inlet gap down to H over L);
 * 'twostep' (land 1 at H + stepH, a riser at riserDeg -- up to 90 --, then land 2 = L at H); 'custom'
 * (points and arcs: customProfile). Every shape's exit face ends faceLen along its last straight part
 * (the notch corner).
 */

const BLADE_TAU = 2 * Math.PI;
/** Underside parts steeper than this (from the web) are meshed by a fan of spines (a step's riser); gentler ones by vertical spines. */
const BLADE_STEEP = 60 * Math.PI / 180;
const bladeWrap = a => { a %= BLADE_TAU; if (a <= -Math.PI) a += BLADE_TAU; else if (a > Math.PI) a -= BLADE_TAU; return a; };

// ---------------------------------------------------------------------
// Pieces and paths
// ---------------------------------------------------------------------
/** A straight piece from (x0, y0) to (x1, y1). */
const bladeLine = (x0, y0, x1, y1) => ({ kind: 'line', x0, y0, x1, y1 });
/** A circular arc: centre (cx, cy), radius r, its radius vector from angle a0 turning by da (> 0 counter-clockwise). */
const bladeArc = (cx, cy, r, a0, da) => ({ kind: 'arc', cx, cy, r, a0, da });
/** The arc that leaves (x0, y0) in direction th0 and turns by dth (> 0 to the left) with radius r. */
function bladeArcFrom(x0, y0, th0, dth, r) {
  const sg = dth < 0 ? -1 : 1, a0 = th0 - sg * Math.PI / 2;      // the radius vector at the start
  return bladeArc(x0 - r * Math.cos(a0), y0 - r * Math.sin(a0), r, a0, dth);
}
const pieceLen = p => p.kind === 'line' ? Math.hypot(p.x1 - p.x0, p.y1 - p.y0) : p.r * Math.abs(p.da);
/** Point and direction u along a piece (u = 0 .. its length); the direction not wrapped (continuous along an arc). */
function pieceAt(p, u) {
  if (p.kind === 'line') {
    const L = pieceLen(p), t = L > 0 ? u / L : 0;
    return [p.x0 + t * (p.x1 - p.x0), p.y0 + t * (p.y1 - p.y0), Math.atan2(p.y1 - p.y0, p.x1 - p.x0)];
  }
  const sg = p.da < 0 ? -1 : 1, a = p.a0 + sg * u / p.r;
  return [p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a), a + sg * Math.PI / 2];
}
/** A piece's part from u0 to u1 along it. */
function pieceCut(p, u0, u1) {
  if (p.kind === 'line') { const a = pieceAt(p, u0), b = pieceAt(p, u1); return bladeLine(a[0], a[1], b[0], b[1]); }
  const sg = p.da < 0 ? -1 : 1;
  return bladeArc(p.cx, p.cy, p.r, p.a0 + sg * u0 / p.r, sg * (u1 - u0) / p.r);
}
/** A piece run backwards. */
const pieceReverse = p => p.kind === 'line' ? bladeLine(p.x1, p.y1, p.x0, p.y0) : bladeArc(p.cx, p.cy, p.r, p.a0 + p.da, -p.da);

/**
 * A path of pieces joined end to end. Arc length s from its start. at(s) -> [x, y, th]: th continuous
 * along the path but for the turns at its joins; joins: [{ s, thm, thp, turn }] (the directions either
 * side: the end of the piece before and the start of the one after; turn = thp - thm, > 0 to the left).
 */
function makeBladePath(pieces) {
  const s0 = [0];
  for (const p of pieces) s0.push(s0[s0.length - 1] + pieceLen(p));
  const n = pieces.length, len = s0[n], off = new Float64Array(n), joins = [];
  // each piece's directions shifted by whole turns so the path's direction runs on without 2 pi jumps
  for (let i = 0; i < n; i++) {
    const start = pieceAt(pieces[i], 0)[2];
    if (i === 0) { off[i] = bladeWrap(start) - start; continue; }
    const thm = pieceAt(pieces[i - 1], s0[i] - s0[i - 1])[2] + off[i - 1];
    const thp = thm + bladeWrap(start - thm);
    off[i] = thp - start;
    joins.push({ s: s0[i], thm, thp, turn: thp - thm, i });
  }
  const find = s => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s0[m] <= s) lo = m; else hi = m - 1; } return lo; };
  const at = s => {
    const i = find(Math.min(Math.max(s, 0), len)), u = Math.min(Math.max(s - s0[i], 0), s0[i + 1] - s0[i]), q = pieceAt(pieces[i], u);
    q[2] += off[i];
    return q;
  };
  return { pieces, s0, len, joins, at, P: s => { const q = at(s); return [q[0], q[1]]; }, th: s => at(s)[2], start: at(0), end: at(len) };
}
/** Points along a path for drawing: every join, and arcs every few degrees. */
function pathPoints(path, dDeg = 3) {
  const out = [path.at(0).slice(0, 2)];
  path.pieces.forEach((p, i) => {
    const L = path.s0[i + 1] - path.s0[i], m = p.kind === 'arc' ? Math.max(1, Math.ceil(Math.abs(p.da) * 180 / Math.PI / dDeg)) : 1;
    for (let k = 1; k <= m; k++) { const q = pieceAt(p, L * k / m); out.push([q[0], q[1]]); }
  });
  return out;
}
/** A path split at arc length s: [the part before, the part after] (pieces). */
function pathSplit(path, s) {
  const a = [], b = [];
  path.pieces.forEach((p, i) => {
    const s0 = path.s0[i], s1 = path.s0[i + 1];
    if (s1 <= s + 1e-15) a.push(p);
    else if (s0 >= s - 1e-15) b.push(p);
    else { a.push(pieceCut(p, 0, s - s0)); b.push(pieceCut(p, s - s0, s1 - s0)); }
  });
  return [a, b];
}

// ---------------------------------------------------------------------
// Points to pieces: straight lines (rounded at the points that are not corners) or a spline
// ---------------------------------------------------------------------
/** The arc of a DXF-style bulge (tan of a quarter of its sweep, > 0 counter-clockwise) from a to b. */
function bulgeArc(a, b, bulge) {
  const da = 4 * Math.atan(bulge), d = Math.hypot(b[0] - a[0], b[1] - a[1]), r = d / (2 * Math.abs(Math.sin(da / 2)));
  const chord = Math.atan2(b[1] - a[1], b[0] - a[0]), th0 = chord - da / 2;   // the tangent at a
  return bladeArcFrom(a[0], a[1], th0, da, r);
}
/** The direction (rad) leaving vertex i toward i + 1, and arriving at i + 1 from i: the chord, turned by half a bulge's sweep. */
const chordDir = (v, i) => Math.atan2(v[i + 1].y - v[i].y, v[i + 1].x - v[i].x);
const dirOut = (v, i) => chordDir(v, i) - 2 * Math.atan(v[i].bulge || 0);
const dirIn = (v, i) => chordDir(v, i - 1) + 2 * Math.atan(v[i - 1].bulge || 0);
/** The turn (rad, > 0 left) at inner vertex i: from the direction arriving to the direction leaving. */
const turnAt = (v, i) => bladeWrap(dirOut(v, i) - dirIn(v, i));
/** Consecutive vertices at the same place dropped (the later one's bulge kept). */
function dedupe(v) {
  const out = [];
  for (const p of v) { const q = out[out.length - 1]; if (q && Math.hypot(p.x - q.x, p.y - q.y) <= 1e-12 * (1 + Math.abs(p.x) + Math.abs(p.y))) { out[out.length - 1] = { ...q, bulge: p.bulge || 0 }; continue; } out.push(p); }
  return out;
}
/** A piece moved by (dx, dy). */
const pieceShift = (p, dx, dy) => p.kind === 'line' ? bladeLine(p.x0 + dx, p.y0 + dy, p.x1 + dx, p.y1 + dy) : bladeArc(p.cx + dx, p.cy + dy, p.r, p.a0, p.da);

/**
 * Centripetal Catmull-Rom through points p (at least 2), sampled `per` segments between each pair: the
 * sampled points (the given ones among them, index per * i). Its ends: the first and last spans end
 * straight toward the reflected neighbour.
 */
function catmullRom(p, per = 8) {
  const n = p.length;
  if (n < 3) return p.map(q => q.slice());
  const P = i => i < 0 ? [2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]] : i >= n ? [2 * p[n - 1][0] - p[n - 2][0], 2 * p[n - 1][1] - p[n - 2][1]] : p[i];
  const out = [p[0].slice()];
  for (let i = 0; i < n - 1; i++) {
    const P0 = P(i - 1), P1 = P(i), P2 = P(i + 1), P3 = P(i + 2);
    const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-12;
    const t0 = 0, t1 = t0 + tj(P0, P1), t2 = t1 + tj(P1, P2), t3 = t2 + tj(P2, P3);
    for (let k = 1; k <= per; k++) {
      const t = t1 + (t2 - t1) * k / per;
      const L = (A, B, ta, tb) => [0, 1].map(d => ((tb - t) * A[d] + (t - ta) * B[d]) / (tb - ta));
      const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2, t1, t2), A3 = L(P2, P3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(k === per ? P2.slice() : L(B1, B2, t1, t2));
    }
  }
  return out;
}

/**
 * Pieces through vertices v = [{ x, y, corner, bulge }] (in order): straight lines (or the arc of a
 * bulge) between them; at a vertex that is not a corner the join is rounded by an arc tangent to both
 * sides (each side giving up at most half its length), so the direction turns smoothly there. corner:
 * isCorner(i) for the inner vertices. Returns { pieces, vs: the arc length of each vertex along them (a
 * rounded vertex: the middle of its arc) }.
 */
function roundedPieces(v, isCorner) {
  const n = v.length, pieces = [], vs = new Float64Array(n);
  // the straight segments' ends after rounding: at each rounded vertex, the tangent length t
  const segLen = i => Math.hypot(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y);
  const bul = i => v[i].bulge || 0;
  const tl = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (isCorner(i) || bul(i - 1) || bul(i)) continue;          // corners stay sharp; joins at arcs are left as they are
    const phi = turnAt(v, i);
    if (Math.abs(phi) < 1e-6) continue;             // (a kink this small is left: rounding it needs a radius so large its arc loses precision)
    tl[i] = 0.5 * Math.min(segLen(i - 1), segLen(i));
  }
  let s = 0, cur = [v[0].x, v[0].y];
  for (let i = 0; i < n - 1; i++) {
    const a = [v[i].x, v[i].y], b = [v[i + 1].x, v[i + 1].y];
    if (bul(i)) {
      const p = bulgeArc(a, b, bul(i));
      if (i === 0 || !tl[i]) vs[i] = s;
      pieces.push(p); s += pieceLen(p); cur = b;
      continue;
    }
    const L = segLen(i), ux = (b[0] - a[0]) / (L || 1), uy = (b[1] - a[1]) / (L || 1);
    const end = [b[0] - tl[i + 1] * ux, b[1] - tl[i + 1] * uy];
    if (!(i > 0 && tl[i])) vs[i] = s;
    if (Math.hypot(end[0] - cur[0], end[1] - cur[1]) > 1e-12 * (L || 1)) { pieces.push(bladeLine(cur[0], cur[1], end[0], end[1])); s += pieceLen(pieces[pieces.length - 1]); }
    cur = end;
    if (tl[i + 1]) {
      // the rounding at vertex i + 1: from end, turning by phi, with radius t / tan(|phi| / 2)
      const phi = turnAt(v, i + 1), r = tl[i + 1] / Math.tan(Math.abs(phi) / 2), p = bladeArcFrom(end[0], end[1], Math.atan2(uy, ux), phi, r);
      vs[i + 1] = s + 0.5 * pieceLen(p);
      pieces.push(p); s += pieceLen(p);
      const q = pieceAt(p, pieceLen(p)); cur = [q[0], q[1]];
    }
  }
  vs[n - 1] = s;
  return { pieces, vs };
}

// ---------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------
/**
 * The blade's profile. spec (lengths m, angles degrees): { shape, H (the gap at M), exitDeg (the exit
 * face to the web), faceLen (the exit face's last straight part, to the notch corner), and by shape:
 * round: R, Xup; flat: L; bevel: L, bevelDeg, bevelLen; radius: L, r; wedge: L, inletGap; twostep:
 * land1, stepH, riserDeg, L; custom: custom (customProfile's) }.
 * Returns { shape, legacy ('round' | 'flat' | null), H, xe (M's x), under (path, the inlet to M), face
 * (path from M up), hUnder(x) (the underside's height; at a vertical riser the downstream one), steep
 * (arc-length ranges [s0, s1] of the underside steeper than BLADE_STEEP), underCorners and faceCorners
 * ([{ s, thm, thp, turn }]; faceCorners[0] is M itself: thm the underside's direction there, thp the
 * face's, a zero turn when they meet smoothly), C (arc length on the face where the simple model's
 * wetted part ends), straightFace (the face is one straight piece: faceDeg its angle), err (why the
 * shape is not possible, else absent) }.
 */
function bladeProfile(spec) {
  const H = spec.H, th = spec.exitDeg * Math.PI / 180, F = spec.faceLen ?? 8e-3;
  const shape = spec.shape;
  let under = [], face = [], C = 0, err = null;
  const exitFrom = (x, y) => bladeLine(x, y, x + F * Math.cos(th), y + F * Math.sin(th));
  if (shape === 'round') {
    // the lower part of the circle about (Xup, H + R), from the inlet (x = 0) to its lowest point
    const R = spec.R, X = spec.Xup, a0 = -Math.acos(-X / R);
    under = [bladeArc(X, H + R, R, a0, -Math.PI / 2 - a0)];
    face = [exitFrom(X, H)];
  } else if (shape === 'flat') {
    under = [bladeLine(0, H, spec.L, H)];
    face = [exitFrom(spec.L, H)];
  } else if (shape === 'bevel') {
    const L = spec.L, b = spec.bevelLen, be = spec.bevelDeg * Math.PI / 180;
    if (!(be > 0 && be < Math.PI)) err = 'the bevel angle must be between 0° and 180°';
    if (!(b > 0)) err = 'the bevel length must be above 0';
    under = [bladeLine(0, H, L, H)];
    const Cx = L + b * Math.cos(be), Cy = H + b * Math.sin(be);
    face = [bladeLine(L, H, Cx, Cy), exitFrom(Cx, Cy)];
    C = b;
  } else if (shape === 'radius') {
    const L = spec.L, r = spec.r;
    if (!(r > 0)) err = 'the edge radius must be above 0';
    under = [bladeLine(0, H, L, H)];
    const a = bladeArcFrom(L, H, 0, th, r), q = pieceAt(a, pieceLen(a));
    face = [a, exitFrom(q[0], q[1])];
    C = pieceLen(a);
  } else if (shape === 'wedge') {
    const L = spec.L, Hin = spec.inletGap;
    if (!(Hin > H)) err = 'the inlet gap must be above the gap at the edge';
    under = [bladeLine(0, Hin, L, H)];
    face = [exitFrom(L, H)];
  } else if (shape === 'twostep') {
    const L1 = spec.land1, st = spec.stepH, rd = spec.riserDeg, L = spec.L;
    if (!(st > 0)) err = 'the step height must be above 0';
    if (!(rd > 0 && rd <= 90)) err = 'the riser angle must be above 0° and at most 90°';
    const dx = rd >= 90 ? 0 : st / Math.tan(rd * Math.PI / 180);
    under = [bladeLine(0, H + st, L1, H + st), bladeLine(L1, H + st, L1 + dx, H), bladeLine(L1 + dx, H, L1 + dx + L, H)];
    face = [exitFrom(L1 + dx + L, H)];
  } else if (shape === 'custom') {
    return customProfile(spec.custom, H);
  } else err = `unknown blade shape ${shape}`;
  return finishProfile(shape, H, under, face, C, err, { legacy: shape === 'round' || shape === 'flat' ? shape : null });
}

/** The profile's parts from its two paths' pieces (see bladeProfile). */
function finishProfile(shape, H, underPieces, facePieces, C, err, extra = {}) {
  const under = makeBladePath(underPieces), face = makeBladePath(facePieces), xe = under.end[0];
  const tol = 1e-9;
  // the underside's height at x: its pieces run with x never falling (checked below); a vertical piece gives none
  const spans = under.pieces.map((p, i) => { const a = pieceAt(p, 0), b = pieceAt(p, under.s0[i + 1] - under.s0[i]); return [a[0], b[0]]; });
  const hUnder = x => {
    let lo = 0, hi = spans.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (spans[m][0] <= x) lo = m; else hi = m - 1; }
    while (lo < spans.length - 1 && spans[lo][1] - spans[lo][0] <= 0) lo++;     // (a vertical piece: the one after it)
    const p = under.pieces[lo];
    if (p.kind === 'line') { const t = spans[lo][1] > spans[lo][0] ? Math.min(1, Math.max(0, (x - spans[lo][0]) / (spans[lo][1] - spans[lo][0]))) : 1; return p.y0 + t * (p.y1 - p.y0); }
    // an arc: the angle whose x is x, on the swept range
    const c = Math.min(1, Math.max(-1, (x - p.cx) / p.r)), a1 = Math.acos(c), lo2 = Math.min(p.a0, p.a0 + p.da), hi2 = Math.max(p.a0, p.a0 + p.da);
    let best = null;
    for (const a of [a1, -a1]) for (let k = -2; k <= 2; k++) { const aa = a + k * BLADE_TAU; if (aa >= lo2 - 1e-9 && aa <= hi2 + 1e-9) best = aa; }
    if (best == null) best = Math.abs(x - pieceAt(p, 0)[0]) < Math.abs(x - pieceAt(p, pieceLen(p))[0]) ? p.a0 : p.a0 + p.da;
    return p.cy + p.r * Math.sin(best);
  };
  if (!err) {
    for (const p of under.pieces) {
      const L = pieceLen(p), m = p.kind === 'arc' ? 16 : 1;
      for (let k = 0; k < m && !err; k++) {
        const a = pieceAt(p, L * k / m), b = pieceAt(p, L * (k + 1) / m);
        if (b[0] < a[0] - tol) err = 'the underside must not overhang: it has to run downstream (or straight up or down) all the way to the metering point';
        if (b[1] <= tol || a[1] <= tol) err = 'the underside would touch the web';
      }
    }
    for (const p of face.pieces) {
      const L = pieceLen(p), m = p.kind === 'arc' ? 16 : 1;
      for (let k = 0; k < m && !err; k++) if (pieceAt(p, L * (k + 1) / m)[1] < pieceAt(p, L * k / m)[1] - tol) err = 'the exit face must rise from the metering point';
    }
  }
  // steep parts of the underside (their ranges of arc length)
  const steep = [];
  under.pieces.forEach((p, i) => {
    const L = under.s0[i + 1] - under.s0[i], m = p.kind === 'arc' ? Math.max(4, Math.ceil(Math.abs(p.da) * 36 / Math.PI)) : 1;
    for (let k = 0; k < m; k++) {
      const u0 = L * k / m, u1 = L * (k + 1) / m, isSteep = Math.abs(Math.sin(pieceAt(p, (u0 + u1) / 2)[2])) > Math.sin(BLADE_STEEP);
      if (!isSteep) continue;
      const a = under.s0[i] + u0, b = under.s0[i] + u1, last = steep[steep.length - 1];
      if (last && Math.abs(last[1] - a) < 1e-15) last[1] = b; else steep.push([a, b]);
    }
  });
  const corner = j => Math.abs(j.turn) > 1e-5;      // (turns below this: rounding errors, or kinks too small to round)
  const underCorners = under.joins.filter(corner).map(({ s, thm, thp, turn }) => ({ s, thm, thp, turn }));
  const thU = under.end[2], thF = face.start[2], thFp = thU + bladeWrap(thF - thU);
  const faceCorners = [{ s: 0, thm: thU, thp: thFp, turn: thFp - thU }, ...face.joins.filter(corner).map(({ s, thm, thp, turn }) => ({ s, thm: thm + (thFp - thF), thp: thp + (thFp - thF), turn }))];
  const straightFace = face.pieces.length === 1 && face.pieces[0].kind === 'line';
  const out = { shape, H, xe, under, face, hUnder, steep, underCorners, faceCorners, C, straightFace, faceDeg: straightFace ? thF * 180 / Math.PI : null, legacy: null, ...extra };
  if (err) out.err = err;
  return out;
}

/**
 * A custom profile. c: { verts: [{ x, y, corner (true / false; absent: by the turning angle), bulge
 * (the arc to the next vertex, DXF style; 0 = straight) }] in order from the inlet round the metering
 * point and up the face (m, the flow along +x, y up; their height is set by H at M), join ('straight':
 * lines (and bulge arcs) as given, rounded at the vertices that are not corners; 'spline': a smooth
 * spline through them, broken at the corners), cornerDeg (a vertex turning more than this is a corner,
 * default 10), M, C (a vertex index each: the metering point, the simple model's wetted end; absent:
 * automatic) }.
 * M automatic: the downstream end of the lowest part (within 1e-6 of the profile's height); C automatic:
 * the highest corner on the face (none: M). Returns bladeProfile's result with auto { M, C, corners }
 * (the vertex indices found), vs (each vertex's arc length along under then face: s < 0 on the underside,
 * measured back from M) and verts (as placed: x from 0, y with the gap H at M).
 */
function customProfile(c, H) {
  const v0 = dedupe((c && c.verts || []).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const fail = msg => { const p = finishProfile('custom', H, [bladeLine(0, H, 1e-3, H)], [bladeLine(1e-3, H, 1e-3, H + 1e-3)], 0, msg); p.auto = { M: 0, C: 0, corners: [], autoCorners: [] }; p.verts = v0; p.vs = []; p.Mi = 0; p.Ci = 0; return p; };
  if (v0.length < 3) return fail('a custom profile needs at least 3 points');
  // automatic corners: the inner vertices where the outline turns by more than cornerDeg
  const cd = (c.cornerDeg ?? 10) * Math.PI / 180, n = v0.length;
  const autoCorner = i => i > 0 && i < n - 1 && Math.abs(turnAt(v0, i)) > cd;
  const isCorner = i => i > 0 && i < n - 1 && (v0[i].corner === true || v0[i].corner === false ? v0[i].corner : autoCorner(i));
  // M: the downstream end of the lowest run of vertices
  let ymin = Infinity, ymax = -Infinity, lowest = 0;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, v0[i].y); ymax = Math.max(ymax, v0[i].y); if (v0[i].y < v0[lowest].y) lowest = i; }
  const tolY = Math.max(1e-12, 1e-6 * (ymax - ymin));
  let Mi = lowest;
  while (Mi + 1 < n - 1 && v0[Mi + 1].y <= ymin + tolY) Mi++;
  const M = Number.isInteger(c.M) && c.M > 0 && c.M < n - 1 ? c.M : Mi;
  if (M <= 0 || M >= n - 1) return fail('the metering point must have points before it (the underside) and after it (the face)');
  const v = v0.map(p => ({ ...p, x: p.x - v0[0].x }));
  // pieces over the whole outline (a spline: broken at the corners), then split at M
  let pieces, vs;
  if (c.join === 'spline') {
    const breaks = [0];
    for (let i = 1; i < n - 1; i++) if (isCorner(i)) breaks.push(i);
    breaks.push(n - 1);
    pieces = []; vs = new Float64Array(n);
    let s = 0;
    const per = 64;       // (the rounding at each sample then keeps within about 0.1 µm of the given points)
    for (let b = 0; b < breaks.length - 1; b++) {
      const i0 = breaks[b], i1 = breaks[b + 1];
      const sp = catmullRom(v.slice(i0, i1 + 1).map(p => [p.x, p.y]), per).map(q => ({ x: q[0], y: q[1] }));
      const rp = roundedPieces(sp, () => false);          // (rounded at every sample: smooth; sharp at the run's ends)
      for (let k = 0; k <= i1 - i0; k++) vs[i0 + k] = s + rp.vs[k * per];
      pieces.push(...rp.pieces);
      s += rp.pieces.reduce((a, p) => a + pieceLen(p), 0);
    }
  } else ({ pieces, vs } = roundedPieces(v, isCorner));
  const all = makeBladePath(pieces), sM = vs[M], yM = all.at(sM)[1];
  // (up so the path's point at M -- the middle of its rounding when it is rounded -- is H above the web)
  const [up, fp] = pathSplit(all, sM).map(ps => ps.map(p => pieceShift(p, 0, H - yM)));
  // C: the given vertex (at M or on the face), else the highest corner on the face
  const faceV = []; for (let i = M + 1; i < n - 1; i++) if (isCorner(i)) faceV.push(i);
  const Cauto = faceV.length ? faceV[faceV.length - 1] : M;
  const Ci = Number.isInteger(c.C) && c.C >= M && c.C < n - 1 ? c.C : Cauto;
  const prof = finishProfile('custom', H, up, fp, Math.max(0, vs[Ci] - sM), null);
  const corners = []; for (let i = 1; i < n - 1; i++) if (isCorner(i)) corners.push(i);
  prof.auto = { M: Mi, C: Cauto, corners, autoCorners: Array.from({ length: n }, (_, i) => autoCorner(i)) };
  prof.Mi = M; prof.Ci = Ci;
  prof.vs = Array.from(vs, q => q - sM);
  prof.verts = v.map(p => ({ ...p, y: p.y + H - yM }));
  prof.placed = true;                       // (verts as placed: x from the first, the gap H at M)
  return prof;
}

// ---------------------------------------------------------------------
// Imports: an outline to the open profile, DXF
// ---------------------------------------------------------------------
/**
 * The open profile (inlet, round the metering point, up the face) from an outline: vertices [{ x, y,
 * bulge }] of a closed loop (closed = true) or an open chain, the flow along +x, y up. M: the lowest
 * vertex (the downstream end of the lowest run); from there upstream while x does not grow (a step's
 * riser is kept; a steep rise at the upstream end -- the blade's back -- is not) and downstream while y
 * does not fall (a level part at the top end -- the blade's top -- is not kept). Returns the vertices in
 * that order (bulges carried with their segments, corner flags with their points), or null.
 */
function openProfile(verts, closed) {
  const n = verts.length;
  if (n < 3) return null;
  const idx = k => closed ? ((k % n) + n) % n : k;
  const ok = k => closed || (k >= 0 && k < n);
  let ymin = Infinity, ymax = -Infinity; for (const p of verts) { ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  const tol = Math.max(1e-12, 1e-6 * (ymax - ymin)), xtol = 1e-9 * Math.max(1, ymax - ymin);
  let lowest = 0; for (let i = 0; i < n; i++) if (verts[i].y < verts[lowest].y) lowest = i;
  // which way along the loop is downstream: the lowest run's neighbours; the direction whose x grows
  const dir = (() => {
    const a = verts[idx(lowest + 1)], b = verts[idx(lowest - 1)];
    if (!ok(lowest + 1)) return -1; if (!ok(lowest - 1)) return 1;
    return a.x - verts[lowest].x >= b.x - verts[lowest].x ? 1 : -1;
  })();
  let M = lowest;
  for (let k = 1; k < n; k++) { const j = lowest + dir * k; if (!ok(j) || verts[idx(j)].y > ymin + tol) break; M = j; }
  // upstream from M
  const upI = [M];
  for (let k = 1; k < n; k++) {
    const j = M - dir * k; if (!ok(j) || idx(j) === idx(M)) break;
    if (verts[idx(j)].x > verts[idx(upI[upI.length - 1])].x + xtol) break;
    upI.push(j);
  }
  // (drop a steep rise at the upstream end: the blade's back, not a riser)
  while (upI.length > 2) {
    const a = verts[idx(upI[upI.length - 1])], b = verts[idx(upI[upI.length - 2])];
    if (a.y - b.y > 0 && Math.abs(a.x - b.x) < Math.tan(Math.PI / 2 - BLADE_STEEP) * (a.y - b.y)) upI.pop(); else break;
  }
  const downI = [M];
  for (let k = 1; k < n; k++) {
    const j = M + dir * k; if (!ok(j) || idx(j) === idx(upI[upI.length - 1])) break;
    if (verts[idx(j)].y < verts[idx(downI[downI.length - 1])].y - xtol) break;
    downI.push(j);
  }
  while (downI.length > 2 && Math.abs(verts[idx(downI[downI.length - 1])].y - verts[idx(downI[downI.length - 2])].y) <= xtol) downI.pop();
  const order = [...upI.slice().reverse(), ...downI.slice(1)];
  if (order.length < 3) return null;
  // bulges: a segment from a to b in the loop's direction keeps its bulge; run backwards, negated
  const out = order.map(k => { const v = verts[idx(k)]; return { x: v.x, y: v.y, bulge: 0, ...(v.corner === true || v.corner === false ? { corner: v.corner } : {}) }; });
  for (let t = 0; t < order.length - 1; t++) {
    const a = order[t], b = order[t + 1];
    // the loop segment from idx(a) to idx(b): forward when b = a + 1 in the loop's own order
    if (idx(a + 1) === idx(b)) out[t].bulge = verts[idx(a)].bulge || 0;
    else if (idx(b + 1) === idx(a)) out[t].bulge = -(verts[idx(b)].bulge || 0);
  }
  return out;
}

/** A (rational) B-spline's point at t: degree p, knots, control points [[x, y]], weights (or null). */
function deBoor(p, knots, ctl, w, t) {
  const n = ctl.length;
  let k = p; while (k < n - 1 && t >= knots[k + 1]) k++;
  const d = [];
  for (let j = 0; j <= p; j++) { const c = ctl[k - p + j], wj = w ? w[k - p + j] : 1; d.push([c[0] * wj, c[1] * wj, wj]); }
  for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
    const i = k - p + j, den = knots[i + p - r + 1] - knots[i], a = den > 0 ? (t - knots[i]) / den : 0;
    for (let q = 0; q < 3; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q];
  }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}

/**
 * Read a DXF file (text): its LINE, ARC, LWPOLYLINE, POLYLINE and SPLINE entities as chains of vertices
 * [{ x, y, bulge }] joined end to end (within 1e-6 of the drawing's size), each { verts, closed }, and the
 * drawing's units in m per unit ($INSUNITS; null when not given).
 */
function parseDXF(text) {
  const lines = text.split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const UNITS = { 1: 0.0254, 2: 0.3048, 4: 1e-3, 5: 1e-2, 6: 1, 8: 2.54e-8, 9: 2.54e-5, 10: 0.9144, 13: 1e-6, 14: 1e-10 };
  let units = null;
  for (let i = 0; i < pairs.length - 1; i++) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') { const u = parseInt(pairs[i + 1][1], 10); units = UNITS[u] ?? null; }
  const segs = [];     // { a: [x, y], b: [x, y], bulge }
  let i = pairs.findIndex(p => p[0] === 2 && p[1] === 'ENTITIES');
  if (i < 0) i = 0;
  const ent = () => { const start = i; i++; const out = []; while (i < pairs.length && pairs[i][0] !== 0) { out.push(pairs[i]); i++; } return { type: pairs[start][1], g: out }; };
  const val = (g, code) => { const p = g.find(q => q[0] === code); return p ? parseFloat(p[1]) : null; };
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) { i++; continue; }
    if (pairs[i][1] === 'ENDSEC') break;
    const e = ent();
    if (e.type === 'LINE') segs.push({ a: [val(e.g, 10), val(e.g, 20)], b: [val(e.g, 11), val(e.g, 21)], bulge: 0 });
    else if (e.type === 'ARC') {
      const cx = val(e.g, 10), cy = val(e.g, 20), r = val(e.g, 40), a0 = val(e.g, 50) * Math.PI / 180;
      let a1 = val(e.g, 51) * Math.PI / 180; while (a1 <= a0) a1 += BLADE_TAU;
      segs.push({ a: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)], b: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], bulge: Math.tan((a1 - a0) / 4) });
    } else if (e.type === 'LWPOLYLINE') {
      const closed = ((val(e.g, 70) || 0) & 1) === 1, vs = [];
      for (const [code, s] of e.g) {
        if (code === 10) vs.push({ x: parseFloat(s), y: 0, bulge: 0 });
        else if (code === 20 && vs.length) vs[vs.length - 1].y = parseFloat(s);
        else if (code === 42 && vs.length) vs[vs.length - 1].bulge = parseFloat(s);
      }
      for (let k = 0; k < vs.length - (closed ? 0 : 1); k++) { const p = vs[k], q = vs[(k + 1) % vs.length]; segs.push({ a: [p.x, p.y], b: [q.x, q.y], bulge: p.bulge }); }
    } else if (e.type === 'POLYLINE') {
      const closed = ((val(e.g, 70) || 0) & 1) === 1, vs = [];
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'SEQEND')) {
        if (pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') { const v = ent(); vs.push({ x: val(v.g, 10), y: val(v.g, 20), bulge: val(v.g, 42) || 0 }); } else i++;
      }
      for (let k = 0; k < vs.length - (closed ? 0 : 1); k++) { const p = vs[k], q = vs[(k + 1) % vs.length]; segs.push({ a: [p.x, p.y], b: [q.x, q.y], bulge: p.bulge }); }
    } else if (e.type === 'SPLINE') {
      // the B-spline from its degree, knots, control points (and weights) when it has them, else a smooth curve through its fit points
      const deg = val(e.g, 71) || 3, knots = [], ctl = [], w = [], fit = [];
      for (const [code, str] of e.g) {
        const f = parseFloat(str);
        if (code === 40) knots.push(f); else if (code === 41) w.push(f);
        else if (code === 10) ctl.push([f, 0]); else if (code === 20 && ctl.length) ctl[ctl.length - 1][1] = f;
        else if (code === 11) fit.push([f, 0]); else if (code === 21 && fit.length) fit[fit.length - 1][1] = f;
      }
      let pts;
      if (ctl.length > deg && knots.length === ctl.length + deg + 1) {
        const m = Math.max(16, 8 * (ctl.length - deg)), t0 = knots[deg], t1 = knots[ctl.length];
        pts = Array.from({ length: m + 1 }, (_, k) => deBoor(deg, knots, ctl, w.length === ctl.length ? w : null, t0 + (t1 - t0) * k / m));
      } else pts = catmullRom(fit.length >= 2 ? fit : ctl, 8);
      for (let k = 0; k < pts.length - 1; k++) segs.push({ a: pts[k], b: pts[k + 1], bulge: 0, smooth: true });
    }
  }
  if (!segs.length) return { chains: [], units };
  // join the segments end to end
  let ext = 0; for (const s of segs) ext = Math.max(ext, Math.abs(s.a[0]), Math.abs(s.a[1]), Math.abs(s.b[0]), Math.abs(s.b[1]));
  const eps = 1e-6 * Math.max(ext, 1e-9), same = (p, q) => Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps;
  const used = new Uint8Array(segs.length), chains = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    let chain = [{ p: segs[k].a, bulge: segs[k].bulge, smooth: segs[k].smooth }, { p: segs[k].b, bulge: 0 }];
    for (const end of ['tail', 'head']) {
      for (let grown = true; grown;) {
        grown = false;
        for (let j = 0; j < segs.length; j++) {
          if (used[j]) continue;
          const s = segs[j], tip = end === 'tail' ? chain[chain.length - 1].p : chain[0].p;
          if (end === 'tail' && same(s.a, tip)) { chain[chain.length - 1].bulge = s.bulge; chain[chain.length - 1].smooth = s.smooth; chain.push({ p: s.b, bulge: 0 }); }
          else if (end === 'tail' && same(s.b, tip)) { chain[chain.length - 1].bulge = -s.bulge; chain[chain.length - 1].smooth = s.smooth; chain.push({ p: s.a, bulge: 0 }); }
          else if (end === 'head' && same(s.b, tip)) chain.unshift({ p: s.a, bulge: s.bulge, smooth: s.smooth });
          else if (end === 'head' && same(s.a, tip)) chain.unshift({ p: s.b, bulge: -s.bulge, smooth: s.smooth });
          else continue;
          used[j] = 1; grown = true;
        }
      }
    }
    const closed = chain.length > 2 && same(chain[0].p, chain[chain.length - 1].p);
    if (closed) chain.pop();
    chains.push({ verts: chain.map(q => ({ x: q.p[0], y: q.p[1], bulge: q.bulge || 0, smooth: !!q.smooth })), closed });
  }
  chains.sort((a, b) => b.verts.length - a.verts.length);
  return { chains, units };
}

/** Points "x, y" per line (commas, semicolons, tabs or spaces; a header line and blank lines skipped; a third column 1 / 0 marks corners). */
function parsePointsCSV(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (f.length < 2) continue;
    const x = parseFloat(f[0]), y = parseFloat(f[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const v = { x, y, bulge: 0 };
    if (f.length > 2 && /^[01]$/.test(f[2])) v.corner = f[2] === '1';
    out.push(v);
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  BLADE_STEEP, bladeLine, bladeArc, bladeArcFrom, pieceLen, pieceAt, pieceCut, pieceReverse, makeBladePath, pathPoints, pathSplit,
  bulgeArc, catmullRom, roundedPieces, pieceShift, turnAt, deBoor, bladeProfile, finishProfile, customProfile, openProfile, parseDXF, parsePointsCSV,
};
