/*
 * feed-mesh.js — the coater with its feed, meshed (Coating › 3D with the feed): the pile in front of the blade fed by the
 * outlets' pipes, the gap under the blade, the film after it. Taylor–Hood Q2 hexahedra (27 velocity nodes, pressure on the
 * 8 corners), block-structured:
 *  - a plan mesh (along the web x, across it z) of 9-node quadrilaterals: a graded grid, and round each pipe a square of
 *    O-grid blocks -- the bore (a core square and 4 blocks out to the bore's circle), the pipe's wall (4 blocks between its
 *    inner and outer circles), and a ring out to the square (4 blocks) -- whose sides meet the grid node for node;
 *  - each plan node a column of nodes up from the web to its top: the pile's surface, the blade's underside, the film's
 *    surface, or inside a pipe its inlet; every column in layers below the mouths' height and above it (the break exactly
 *    at the mouth round the pipes, blended to a fraction of the column away from them), so the pipe, its wall's end and the
 *    pile below meet node for node. The pipe's wall is meshed only below the mouth (above it, it is solid).
 * Coordinates (m): x along the web (the blade's metering edge at 0, the pile at x < 0), y up from the web, z across from
 * the side wall at z = 0. Pure computation, no DOM.
 *
 * fmMesh(o) -> { X, Y, Z (per node), elems (27 per element, local node (g*3 + b)*3 + a: a, g the plan quad's two
 *   directions, b up -- cfd-fem3d.js's order, right-handed), zone (per element: FM_OUT, FM_WALL, FM_BORE), layer, faces
 *   (boundary: { e, f (FM_FACES), tag }), lines (per plan node: { base (its first node), n, kind, top, ys }), plan, info }
 * o: { W (between the side walls), half (z to W/2, a symmetry plane in the middle; default: when the outlets are mirror
 *   symmetric and none sits on the middle), xCut (the cut upstream: nothing behind it is modelled), xEnd (the film's end; or,
 *   before the metering edge, where the domain stops under the blade),
 *   bladeY(x) (the blade's underside above the web, x <= 0; bladeY(0) the gap at the edge), H0 (the pile's surface),
 *   film0 (the film's thickness after the edge), outlets: [{ z, ym (the mouth above the web), yIn (the pipe's inlet
 *   height; default ym + 4 d) }], xP (the mouths' distance along the web, < 0, the same for every outlet), d (bore), t (the
 *   pipe's wall), m (elements along a side of a pipe's square; 4 m round the pipe), sq (the square's side over the pipe's
 *   outer diameter), hFar, hEdge, hJ (plan element sizes: far, at the metering edge, where the pile meets the blade), grow
 *   (their growth per metre away), nLo, nUp (layers below and above the mouths), nCore, nWall, nRing (radial elements:
 *   the bore's core blocks, the wall, the outer ring) }
 */

const FM_OUT = 0, FM_WALL = 1, FM_BORE = 2;
/** A hexahedron's faces: [a, b, g] fixed index (0 or 2) on one of them; the 9 nodes in (s, t) order of the other two. */
const FM_FACES = (() => {
  const L = (a, b, g) => (g * 3 + b) * 3 + a, F = [];
  const face = fix => { const out = []; for (let t = 0; t < 3; t++) for (let s = 0; s < 3; s++) out.push(fix(s, t)); return out; };
  F.push(face((s, t) => L(0, s, t)), face((s, t) => L(2, s, t)));   // 0, 1: a = 0, 2 (the plan quad's first direction)
  F.push(face((s, t) => L(s, 0, t)), face((s, t) => L(s, 2, t)));   // 2, 3: b = 0 (the bottom), 2 (the top)
  F.push(face((s, t) => L(s, t, 0)), face((s, t) => L(s, t, 2)));   // 4, 5: g = 0, 2 (the second direction)
  return F;
})();

/** Merge points closer than tol (a spatial hash): returns id for (x, z). */
function fmPointSet(tol) {
  const map = new Map(), xs = [], zs = [];
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  return {
    xs, zs,
    id(x, z) {
      const i = Math.floor(x / tol), j = Math.floor(z / tol);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const L = map.get(key(i + di, j + dj));
        if (L) for (const n of L) if (Math.abs(xs[n] - x) <= tol && Math.abs(zs[n] - z) <= tol) return n;
      }
      const n = xs.length; xs.push(x); zs.push(z);
      const k = key(i, j); if (!map.has(k)) map.set(k, []); map.get(k).push(n);
      return n;
    },
  };
}

/** Q1 lines over [a, b] graded by an element size h(x): n = round(∫ dx / h) cells, nodes equally spaced in ∫ dx / h. */
function fmGraded(a, b, h, nMin = 1) {
  const K = 400, cum = [0];
  for (let i = 1; i <= K; i++) { const x0 = a + (b - a) * (i - 1) / K, x1 = a + (b - a) * i / K; cum.push(cum[i - 1] + (x1 - x0) / h((x0 + x1) / 2)); }
  const n = Math.max(nMin, Math.round(cum[K])), out = [a];
  for (let c = 1; c < n; c++) {
    const target = cum[K] * c / n; let i = 1; while (cum[i] < target) i++;
    const f = (target - cum[i - 1]) / (cum[i] - cum[i - 1]); out.push(a + (b - a) * (i - 1 + f) / K);
  }
  out.push(b);
  return out;
}

/** Where the blade's underside reaches height H (x < 0, bisection): the pile's surface meets the blade there. */
function fmJunction(bladeY, H, xCut) {
  if (!(bladeY(xCut) > H)) return null;
  let lo = xCut, hi = 0;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (bladeY(mid) > H) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function fmMesh(o) {
  const W = o.W, d = o.d, t = o.t ?? 0.002, rb = d / 2, ro = rb + t, m = o.m ?? 4, sq = o.sq ?? 3;
  const A = sq * ro;                                   // the half side of a pipe's square
  const nLo = o.nLo ?? 4, nUp = o.nUp ?? 4, nCore = o.nCore ?? 2, nWall = o.nWall ?? 1, nRing = o.nRing ?? 3;
  const tol = 1e-9 * Math.max(W, -o.xCut);
  const outlets = o.outlets.map(q => ({ ...q, yIn: q.yIn ?? q.ym + 4 * d })).sort((p, q) => p.z - q.z);
  const symm = outlets.every(q => outlets.some(r => Math.abs(r.z - (W - q.z)) < 1e-9 && Math.abs(r.ym - q.ym) < 1e-12 && Math.abs(r.yIn - q.yIn) < 1e-12));
  const onMid = outlets.some(q => Math.abs(q.z - W / 2) < A + 1e-12);
  const half = o.half ?? (symm && !onMid);
  if (half && !symm) throw new Error('half the width needs the outlets mirror symmetric about the middle');
  if (half && onMid) throw new Error('half the width: an outlet\'s square crosses the middle (solve the full width)');
  const Wend = half ? W / 2 : W, pipes = outlets.filter(q => q.z < Wend);
  const xP = o.xP, xJ = fmJunction(o.bladeY, o.H0, o.xCut);
  // ---- the geometry's limits ----
  if (xJ == null) throw new Error('the blade is below the pile\'s surface at the cut: no pile surface (move the cut upstream or lower the pile)');
  if (!(o.xCut < xP - A)) throw new Error(`the outlets' squares (${(2 * A * 1000).toFixed(1)} mm) reach past the cut`);
  if (!(xP + A < xJ)) throw new Error(`the outlets must be in front of the blade: their squares reach x = ${((xP + A) * 1000).toFixed(1)} mm, the blade meets the pile at ${(xJ * 1000).toFixed(1)} mm`);
  for (let i = 0; i < pipes.length; i++) {
    const q = pipes[i];
    if (q.z - A < -1e-12 || q.z + A > Wend + 1e-12) throw new Error(`outlet at z = ${(q.z * 1000).toFixed(1)} mm: its square (${(2 * A * 1000).toFixed(1)} mm) reaches past a side`);
    if (i && q.z - A < pipes[i - 1].z + A - 1e-12) throw new Error('two outlets\' squares overlap: move them apart or make the squares smaller');
    if (!(q.ym > 0 && q.ym < o.H0)) throw new Error('a mouth must be between the web and the pile\'s surface');
    if (!(q.yIn > q.ym)) throw new Error('a pipe\'s inlet must be above its mouth');
  }
  // ---- plan lines (Q1) ----
  const hE = o.hEdge ?? 0.5e-3, hF = o.hFar ?? 8e-3, hJ = o.hJ ?? 2 * hE, g = o.grow ?? 0.25, hSq = 2 * A / m;
  const hx = x => Math.min(hF, hE + g * Math.abs(x), hJ + g * Math.abs(x - xJ), hSq + g * Math.max(0, Math.abs(x - xP) - A));
  const hz = z => Math.min(hF, ...pipes.map(q => hSq + g * Math.max(0, Math.abs(z - q.z) - A)));
  const lines = (req, h, sqs) => {
    const R = [...new Set(req.map(v => +v.toFixed(12)))].sort((p, q) => p - q), out = [R[0]];
    for (let i = 0; i + 1 < R.length; i++) {
      const a = R[i], b = R[i + 1], s = sqs.find(c => Math.abs(c - A - a) < 1e-12 && Math.abs(c + A - b) < 1e-12);
      const seg = s != null ? Array.from({ length: m + 1 }, (_, k) => a + (b - a) * k / m) : fmGraded(a, b, h);
      for (let k = 1; k < seg.length; k++) out.push(seg[k]);
    }
    return out;
  };
  // (an end before the metering edge: the domain stops under the blade -- the region beyond solved on its own)
  if (!(o.xEnd > xJ)) throw new Error('the domain must end beyond where the pile meets the blade');
  const xl = lines([o.xCut, xP - A, xP + A, xJ, 0, o.xEnd].filter(v => v <= o.xEnd + 1e-12), hx, [xP]);
  const zl = lines([0, Wend, ...pipes.flatMap(q => [q.z - A, q.z + A])], hz, pipes.map(q => q.z));
  // Q2 node coordinates of the grid (midpoints added)
  const q2 = L => { const out = []; for (let i = 0; i + 1 < L.length; i++) out.push(L[i], (L[i] + L[i + 1]) / 2); out.push(L[L.length - 1]); return out; };
  const XQ = q2(xl), ZQ = q2(zl);
  // ---- plan quads ----
  const P = fmPointSet(tol), quads = [], qzone = [], qpipe = [];
  const addQuad = (ids, zone, pipe) => {    // ids[g][a] (3 x 3), oriented so that the plan Jacobian is positive
    const c = (a, gg) => ids[gg][a], xs = P.xs, zs = P.zs;
    const p0 = c(0, 0), p1 = c(2, 0), p2 = c(2, 2), p3 = c(0, 2);
    const area = (xs[p1] - xs[p0]) * (zs[p3] - zs[p0]) - (zs[p1] - zs[p0]) * (xs[p3] - xs[p0]) + (xs[p2] - xs[p3]) * (zs[p2] - zs[p1]) - (zs[p2] - zs[p3]) * (xs[p2] - xs[p1]);
    const q = new Int32Array(9);
    for (let gg = 0; gg < 3; gg++) for (let a = 0; a < 3; a++) q[gg * 3 + a] = area > 0 ? c(a, gg) : c(gg, a);
    quads.push(q); qzone.push(zone); qpipe.push(pipe);
  };
  const inSquareX = i => xl[i] >= xP - A - 1e-12 && xl[i + 1] <= xP + A + 1e-12;
  const squareOfZ = j => pipes.findIndex(q => zl[j] >= q.z - A - 1e-12 && zl[j + 1] <= q.z + A + 1e-12);
  for (let i = 0; i + 1 < xl.length; i++) for (let j = 0; j + 1 < zl.length; j++) {
    if (inSquareX(i) && squareOfZ(j) >= 0) continue;
    const ids = [0, 1, 2].map(gg => [0, 1, 2].map(a => P.id(XQ[2 * i + a], ZQ[2 * j + gg])));
    addQuad(ids, FM_OUT, -1);
  }
  // round each pipe: its square of O-grid blocks
  pipes.forEach((q, pi) => {
    const xc = xP, zc = q.z, cH = 0.45 * rb, n2 = 2 * m;
    const TH0 = [225, 315, 45, 135].map(v => v * Math.PI / 180);
    const side = (k, s, a) => [[xc - a + 2 * a * s, zc - a], [xc + a, zc - a + 2 * a * s], [xc + a - 2 * a * s, zc + a], [xc - a, zc + a - 2 * a * s]][k];
    const circ = (k, s, r) => { const th = TH0[k] + Math.PI / 2 * s; return [xc + r * Math.cos(th), zc + r * Math.sin(th)]; };
    // (on the square's sides, the grid's own node coordinates: the blocks meet the grid node for node)
    const sqSide = (k, i) => { const s = i / n2; const pp = side(k, s, A); return pp; };
    const block = (nR, f, zone) => {           // nodes [j][i]: i along the side (2m), j outward (2 nR)
      const N = []; for (let j = 0; j <= 2 * nR; j++) { N.push([]); for (let i = 0; i <= n2; i++) { const p = f(i, j / (2 * nR)); N[j].push(P.id(p[0], p[1])); } }
      for (let j = 0; j < nR; j++) for (let i = 0; i < m; i++) addQuad([0, 1, 2].map(gg => [0, 1, 2].map(a => N[2 * j + gg][2 * i + a])), zone, pi);
    };
    const lerp = (p, r, u) => [(1 - u) * p[0] + u * r[0], (1 - u) * p[1] + u * r[1]];
    for (let k = 0; k < 4; k++) {
      block(nRing, (i, u) => lerp(circ(k, i / n2, ro), sqSide(k, i), u), FM_OUT);
      block(nWall, (i, u) => circ(k, i / n2, rb + (ro - rb) * u), FM_WALL);
      block(nCore, (i, u) => lerp(side(k, i / n2, cH), circ(k, i / n2, rb), u), FM_BORE);
    }
    const N = []; for (let j = 0; j <= n2; j++) { N.push([]); for (let i = 0; i <= n2; i++) N[j].push(P.id(xc - cH + 2 * cH * i / n2, zc - cH + 2 * cH * j / n2)); }
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) addQuad([0, 1, 2].map(gg => [0, 1, 2].map(a => N[2 * j + gg][2 * i + a])), FM_BORE, pi);
  });
  const NP = P.xs.length, px = Float64Array.from(P.xs), pz = Float64Array.from(P.zs);
  // ---- each plan node's column ----
  const inZ = [new Uint8Array(NP), new Uint8Array(NP), new Uint8Array(NP)], pipeOf = new Int32Array(NP).fill(-1);
  quads.forEach((q, i) => q.forEach(n => { inZ[qzone[i]][n] = 1; if (qpipe[i] >= 0) pipeOf[n] = qpipe[i]; }));
  const frac = nLo / (nLo + nUp), Lb = 2 * A;
  const col = [];
  let nNodes = 0;
  for (let p = 0; p < NP; p++) {
    const x = px[p], z = pz[p];
    let kind, top;
    if (inZ[FM_BORE][p]) { kind = 'bore'; top = pipes[pipeOf[p]].yIn; }
    else if (inZ[FM_OUT][p]) {
      if (x > tol) { kind = 'film'; top = o.film0; }
      else if (x >= xJ - tol) { kind = 'blade'; top = o.bladeY(Math.min(0, x)); }
      else { kind = 'pile'; top = o.H0; }
    } else { kind = 'wall'; top = pipes[pipeOf[p]].ym; }
    // the layers' break: the mouth's height in and round a pipe's square, blended away from it to a fraction of the column
    let ys, best = Infinity, bq = null, w = 1;
    for (const q of pipes) { const dd = Math.max(Math.abs(x - xP), Math.abs(z - q.z)) - A; if (dd < best) { best = dd; bq = q; } }
    if (best <= 1e-12) ys = bq.ym;
    else { w = Math.max(0, 1 - best / Lb); ys = Math.min(w * bq.ym + (1 - w) * frac * top, 0.85 * top); }
    const n = kind === 'wall' ? 2 * nLo + 1 : 2 * (nLo + nUp) + 1;
    // (sq: in a pipe's square, the break held at the mouth; w, ym: the blend, kept for moving the top -- fmSetTops)
    col.push({ base: nNodes, n, kind, top, ys, pipe: pipeOf[p], sq: best <= 1e-12, w, ym: bq ? bq.ym : 0 });
    nNodes += n;
  }
  const X = new Float64Array(nNodes), Y = new Float64Array(nNodes), Z = new Float64Array(nNodes);
  const yAt = (C, k) => k <= 2 * nLo ? C.ys * k / (2 * nLo) : C.ys + (C.top - C.ys) * (k - 2 * nLo) / (2 * nUp);
  for (let p = 0; p < NP; p++) { const C = col[p]; for (let k = 0; k < C.n; k++) { X[C.base + k] = px[p]; Y[C.base + k] = yAt(C, k); Z[C.base + k] = pz[p]; } }
  // ---- elements: each plan quad's layers (a pipe's wall: below the mouth only) ----
  const E = [], zone = [], layer = [], pipeE = [];
  quads.forEach((q, i) => {
    const nL = qzone[i] === FM_WALL ? nLo : nLo + nUp;
    for (let ey = 0; ey < nL; ey++) {
      const el = new Int32Array(27);
      for (let gg = 0; gg < 3; gg++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const C = col[q[gg * 3 + a]], k = 2 * ey + b;
        if (k >= C.n) throw new Error('a column too short for its element (the mesh is inconsistent)');
        el[(gg * 3 + b) * 3 + a] = C.base + k;
      }
      E.push(el); zone.push(qzone[i]); layer.push(ey); pipeE.push(qpipe[i]);
    }
  });
  const nE = E.length, elems = new Int32Array(27 * nE); E.forEach((el, e) => elems.set(el, 27 * e));
  // ---- boundary faces: those of one element only, tagged ----
  const seen = new Map();
  for (let e = 0; e < nE; e++) for (let f = 0; f < 6; f++) {
    const F = FM_FACES[f], c4 = [F[0], F[2], F[6], F[8]].map(i => elems[27 * e + i]).sort((p, q) => p - q), k = c4.join(',');
    const s = seen.get(k); if (s) s.n++; else seen.set(k, { e, f, n: 1 });
  }
  const faces = [], kindOf = n => col[0] && null;
  const nodeKind = new Array(nNodes); for (let p = 0; p < NP; p++) { const C = col[p]; for (let k = 0; k < C.n; k++) nodeKind[C.base + k] = k === C.n - 1 ? C.kind : 'in'; }
  const near = (v, w) => Math.abs(v - w) <= 1e3 * tol;
  for (const { e, f, n } of seen.values()) {
    if (n > 2) throw new Error('a face shared by more than two elements');
    if (n === 2) continue;
    const ids = FM_FACES[f].map(i => elems[27 * e + i]);
    let tag;
    if (f === 2) tag = ids.every(i => near(Y[i], 0)) ? 'web' : 'bottom?';
    else if (f === 3) {
      const ks = ids.map(i => nodeKind[i]);
      if (zone[e] === FM_WALL) tag = 'pipeEnd';
      else if (zone[e] === FM_BORE) tag = 'pipeIn';
      else tag = ks.includes('pile') ? 'pile' : ks.includes('film') ? 'film' : ks.every(k => k === 'blade') ? 'blade' : 'top?';
    } else if (ids.every(i => near(X[i], o.xCut))) tag = 'cut';
    else if (ids.every(i => near(X[i], o.xEnd))) tag = 'end';
    else if (ids.every(i => near(Z[i], 0))) tag = 'side0';
    else if (ids.every(i => near(Z[i], Wend))) tag = half ? 'sym' : 'side1';
    else {
      const q = pipes[pipeE[e]], r = q ? ids.map(i => Math.hypot(X[i] - xP, Z[i] - q.z)) : [];
      tag = q && r.every(v => Math.abs(v - ro) < 1e-9 * 1e3) ? 'pipeOut' : q && r.every(v => Math.abs(v - rb) < 1e-9 * 1e3) ? 'pipeInner' : 'side?';
    }
    if (tag.endsWith('?')) throw new Error(`a boundary face the mesh cannot place (${tag}) at element ${e}`);
    faces.push({ e, f, tag });
  }
  return {
    X, Y, Z, elems, nE, nN: nNodes, zone: Uint8Array.from(zone), layer: Uint8Array.from(layer), pipeE: Int32Array.from(pipeE), faces,
    lines: col, plan: { px, pz, quads, qzone, qpipe, xl, zl },
    info: { W, Wend, half, xCut: o.xCut, xEnd: o.xEnd, xJ, xP, A, rb, ro, pipes, nLo, nUp, H0: o.H0, film0: o.film0, frac },
  };
}

/**
 * Move the free surfaces: each pile or film column's top to top(p, column) (undefined: unchanged; the blade's columns, the
 * pipes' and their walls' never move), its nodes along it as the mesher placed them (the layers' break blended as there).
 * In place; returns M.
 */
function fmSetTops(M, top) {
  const { nLo, nUp, frac } = M.info;
  M.lines.forEach((C, p) => {
    if (C.kind !== 'pile' && C.kind !== 'film') return;
    const t = top(p, C); if (t == null || t === C.top) return;
    if (!(t > 0)) throw new Error(`a surface column's top at ${t} m: not above the web`);
    C.top = t; C.ys = C.sq ? C.ym : Math.min(C.w * C.ym + (1 - C.w) * frac * t, 0.85 * t);
    if (C.sq && !(t > 1.02 * C.ym)) throw new Error('the surface down to a pipe\'s mouth: the pipe would stand out of the paste');
    for (let k = 0; k < C.n; k++) M.Y[C.base + k] = k <= 2 * nLo ? C.ys * k / (2 * nLo) : C.ys + (C.top - C.ys) * (k - 2 * nLo) / (2 * nUp);
  });
  return M;
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks of a mesh: every element's shape, its volume, each boundary's area, and that the boundary closes
// ---------------------------------------------------------------------------------------------------------------------
const fmQ2 = s => [s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], fmDQ2 = s => [s - 0.5, -2 * s, s + 0.5];
const FM_G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], FM_W = [5 / 9, 8 / 9, 5 / 9];
/** The Jacobian matrix of element e at (xi, eta, zeta). */
function fmJac(M, e, xi, et, ze) {
  const A = fmQ2(xi), B = fmQ2(et), C = fmQ2(ze), dA = fmDQ2(xi), dB = fmDQ2(et), dC = fmDQ2(ze);
  const J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let gg = 0; gg < 3; gg++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
    const n = M.elems[27 * e + (gg * 3 + b) * 3 + a], x = M.X[n], y = M.Y[n], z = M.Z[n];
    const na = dA[a] * B[b] * C[gg], nb = A[a] * dB[b] * C[gg], nc = A[a] * B[b] * dC[gg];
    J[0] += na * x; J[1] += na * y; J[2] += na * z; J[3] += nb * x; J[4] += nb * y; J[5] += nb * z; J[6] += nc * x; J[7] += nc * y; J[8] += nc * z;
  }
  return J;
}
const fmDet = J => J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
/** Element quality (smallest over largest Jacobian at its 27 nodes, as the 3D page's Mesh step), volume; the boundary's
 *  areas per tag and its closure (the integral of its outward normal: zero for a closed surface). */
function fmStats(M) {
  let qMin = Infinity, qSum = 0, bad = 0, vol = 0;
  const nodesQ = [-1, 0, 1];
  for (let e = 0; e < M.nE; e++) {
    let lo = Infinity, hi = -Infinity;
    for (const c of nodesQ) for (const b of nodesQ) for (const a of nodesQ) { const d = fmDet(fmJac(M, e, a, b, c)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    const q = hi > 0 ? lo / hi : -1; qMin = Math.min(qMin, q); qSum += q; if (q <= 0) bad++;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) vol += FM_W[i] * FM_W[j] * FM_W[k] * fmDet(fmJac(M, e, FM_G[i], FM_G[j], FM_G[k]));
  }
  // faces: area and outward normal (the face's two tangents crossed, signed outward by the element's centre)
  const area = {}, closure = [0, 0, 0];
  for (const { e, f, tag } of M.faces) {
    const fix = [[-1, null, null], [1, null, null], [null, -1, null], [null, 1, null], [null, null, -1], [null, null, 1]][f];
    let Ar = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const s = FM_G[i], u = FM_G[j];
      const pt = fix.map(v => v); let si = 0; for (let k = 0; k < 3; k++) if (pt[k] === null) { pt[k] = si === 0 ? s : u; si++; }
      const J = fmJac(M, e, pt[0], pt[1], pt[2]), rows = [[J[0], J[1], J[2]], [J[3], J[4], J[5]], [J[6], J[7], J[8]]];
      const free = [0, 1, 2].filter(k => fix[k] === null), t1 = rows[free[0]], t2 = rows[free[1]];
      let nrm = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
      const fixed = [0, 1, 2].find(k => fix[k] !== null), out = rows[fixed].map(v => v * fix[fixed]);
      if (nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] < 0) nrm = nrm.map(v => -v);
      const w = FM_W[i] * FM_W[j], L = Math.hypot(...nrm);
      Ar += w * L; closure[0] += w * nrm[0]; closure[1] += w * nrm[1]; closure[2] += w * nrm[2];
    }
    area[tag] = (area[tag] || 0) + Ar;
  }
  const corners = new Set(); for (let e = 0; e < M.nE; e++) for (const i of [0, 2, 6, 8, 18, 20, 24, 26]) corners.add(M.elems[27 * e + i]);
  return { elements: M.nE, nodes: M.nN, nodesP: corners.size, unknowns: 3 * M.nN + corners.size, qMin, qMean: qSum / M.nE, invalid: bad, volume: vol, area, closure };
}

/** The mesh's volume as built (the columns' tops; the pipes' bodies above the mouths taken out, their bores above the
 *  mouths added) -- exact for straight tops, the blade's curve integrated finely. */
function fmVolumeExpected(o, M) {
  const I = M.info, Wend = I.Wend, nP = I.pipes.length;
  const xb = Math.min(0, o.xEnd);
  let blade = 0; const K = 4000; for (let i = 0; i < K; i++) { const x = I.xJ + (xb - I.xJ) * (i + 0.5) / K; blade += o.bladeY(x) * (xb - I.xJ) / K; }
  const pipesVol = I.pipes.reduce((s, q) => s - Math.PI * I.ro * I.ro * (o.H0 - q.ym) + Math.PI * I.rb * I.rb * (q.yIn - q.ym), 0);
  return Wend * (o.H0 * (I.xJ - o.xCut) + blade + o.film0 * Math.max(0, o.xEnd)) + pipesVol;
}

/** The mesh for OpenFOAM (polyMesh: each Q2 hexahedron as 8 linear ones), for its checkMesh and the benchmark. Returns
 *  the files' text: { points, faces, owner, neighbour, boundary }; patches by the faces' tags. */
function fmFoam(M) {
  const L = (a, b, g) => (g * 3 + b) * 3 + a, cells = [], ctag = [];
  for (let e = 0; e < M.nE; e++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const n = (aa, bb, gg) => M.elems[27 * e + L(a + aa, b + bb, g + gg)];
    // OpenFOAM hex: bottom face (y low) then top, counterclockwise seen from below... use the (x, z) orientation: 0 (0,0,0),1 (1,0,0),2 (1,0,1),3 (0,0,1),4..7 the same one layer up
    cells.push([n(0, 0, 0), n(1, 0, 0), n(1, 0, 1), n(0, 0, 1), n(0, 1, 0), n(1, 1, 0), n(1, 1, 1), n(0, 1, 1)]);
  }
  // the faces of every linear cell (outward-normal order for OpenFOAM: right-hand rule pointing out of the owner)
  const HF = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5]];
  const map = new Map(), internal = [], bnd = [];
  // (each face's vertices ordered so that its normal, by the right-hand rule, points out of its owner: checked against the
  // owner's centre, whatever the cell's own orientation)
  const P = n => [M.X[n], M.Y[n], M.Z[n]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const cen = ns => { const c = [0, 0, 0]; ns.forEach(n => { const p = P(n); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }); return c.map(v => v / ns.length); };
  cells.forEach((c, ci) => { const cc = cen(c); HF.forEach(h => {
    let f = h.map(k => c[k]);
    const key = [...f].sort((p, q) => p - q).join(',');
    const s = map.get(key); if (s) { s.nb = ci; return; }
    const nrm = cross(sub(P(f[2]), P(f[0])), sub(P(f[3]), P(f[1]))), out = sub(cen(f), cc);
    if (nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] < 0) f = [f[0], f[3], f[2], f[1]];
    map.set(key, { f, own: ci, nb: -1 });
  }); });
  // boundary tags: a linear face lies in a Q2 boundary face of its element
  const tagOf = new Map();
  for (const { e, f, tag } of M.faces) { const ids = FM_FACES[f].map(i => M.elems[27 * e + i]); for (let t = 0; t < 2; t++) for (let s = 0; s < 2; s++) { const q = [ids[t * 3 + s], ids[t * 3 + s + 1], ids[(t + 1) * 3 + s + 1], ids[(t + 1) * 3 + s]]; tagOf.set([...q].sort((p, r) => p - r).join(','), tag); } }
  for (const [key, v] of map) { if (v.nb >= 0) internal.push(v); else bnd.push({ ...v, tag: tagOf.get(key) || 'unknown' }); }
  internal.sort((p, q) => p.own - q.own || p.nb - q.nb);
  const tags = [...new Set(bnd.map(b => b.tag))].sort();
  bnd.sort((p, q) => tags.indexOf(p.tag) - tags.indexOf(q.tag) || p.own - q.own);
  const allF = [...internal, ...bnd], nPts = M.nN;
  const hdr = (cls, obj) => `FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${cls};\n    location    "constant/polyMesh";\n    object      ${obj};\n}\n\n`;
  const pts = hdr('vectorField', 'points') + `${nPts}\n(\n` + Array.from({ length: nPts }, (_, i) => `(${M.X[i]} ${M.Y[i]} ${M.Z[i]})`).join('\n') + '\n)\n';
  const fcs = hdr('faceList', 'faces') + `${allF.length}\n(\n` + allF.map(v => `4(${v.f.join(' ')})`).join('\n') + '\n)\n';
  const own = hdr('labelList', 'owner') + `${allF.length}\n(\n` + allF.map(v => v.own).join('\n') + '\n)\n';
  const nbr = hdr('labelList', 'neighbour') + `${internal.length}\n(\n` + internal.map(v => v.nb).join('\n') + '\n)\n';
  let start = internal.length;
  const bd = hdr('polyBoundaryMesh', 'boundary') + `${tags.length}\n(\n` + tags.map(tg => { const n = bnd.filter(b => b.tag === tg).length, s = `    ${tg}\n    {\n        type            ${tg === 'sym' ? 'symmetryPlane' : 'patch'};\n        nFaces          ${n};\n        startFace       ${start};\n    }\n`; start += n; return s; }).join('') + ')\n';
  return { points: pts, faces: fcs, owner: own, neighbour: nbr, boundary: bd, nCells: cells.length };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fmSetTops, fmMesh, fmStats, fmVolumeExpected, fmJunction, fmGraded, fmFoam, fmJac, fmDet, FM_FACES, FM_OUT, FM_WALL, FM_BORE };
