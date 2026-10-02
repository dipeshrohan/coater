/*
 * feed-pool-mesh.js — the pool behind the blade as a block of Q2 hexahedra (27 nodes; the format feed-fem.js solves on), for
 * the paste falling from the outlets onto the pool's top (Coating › Pool and feed): no pipes in the paste. The pool, x along
 * the web (0 at the metering edge, upstream negative), y up from the web, z across from one side plate:
 *   from its back edge (x = −xBack) to the 2D's pool edge (x = −xEnd), between the side plates (z = 0, W), from the web up
 *   to its level h -- or, where the blade's face is lower (downstream of where the pool meets it, x > xJ), to the face.
 * Columns of nodes stand on the web; each column's top is the level or the blade's face, so the top's faces are the pool's
 * free top ('pile', x ≤ xJ) or the blade ('blade', x > xJ); xJ is a column of nodes. The element sizes follow a size
 * function: fine where the streams land (around each outlet, in x and z), near the side plates and where the pool meets the
 * blade; the rows finer near the web (the web drags the paste). Faces tagged: web, pile, blade, back (x = −xBack), end
 * (x = −xEnd), side0 (z = 0), side1 (z = W). Pure computation, SI units, no DOM.
 */

/**
 * Element boundaries over [a, b] for a size function size(s) (m): n elements, n = ⌈∫ ds / size⌉, placed so each holds an
 * equal share of ∫ ds / size; the breakpoints given (inside [a, b]) are boundaries exactly.
 */
function fpmLine(a, b, size, breaks = []) {
  const pts = [a, ...breaks.filter(v => v > a + 1e-12 && v < b - 1e-12).sort((p, q) => p - q), b], out = [a];
  for (let k = 0; k + 1 < pts.length; k++) {
    const lo = pts[k], hi = pts[k + 1], m = 400, cum = [0];
    for (let i = 0; i < m; i++) { const s0 = lo + (hi - lo) * i / m, s1 = lo + (hi - lo) * (i + 1) / m; cum.push(cum[i] + (s1 - s0) * (1 / size(s0) + 4 / size((s0 + s1) / 2) + 1 / size(s1)) / 6); }
    const n = Math.max(1, Math.ceil(cum[m] - 1e-9));
    for (let e = 1; e <= n; e++) {
      if (e === n) { out.push(hi); break; }
      const t = cum[m] * e / n; let i = 0; while (i < m - 1 && cum[i + 1] < t) i++;
      const w = (t - cum[i]) / (cum[i + 1] - cum[i]); out.push(lo + (hi - lo) * (i + w) / m);
    }
  }
  return out;
}
/** A size function: fine (h0) within r of each centre, growing at rate g beyond, never above hMax. */
const fpmSize = (centres, h0, r, g, hMax) => s => Math.min(hMax, ...centres.map(c => h0 + g * Math.max(0, Math.abs(s - c) - r)));

/** Each face's 9 nodes (element-local, (c·3 + b)·3 + a for a along x, b along y, c along z): x−, x+, y−, y+, z−, z+. */
const FPM_FACES = [0, 1, 2, 3, 4, 5].map(f => { const ax = f >> 1, at = f & 1 ? 2 : 0, out = [];
  for (let c = 0; c < 3; c++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) if ([a, b, c][ax] === at) out.push((c * 3 + b) * 3 + a);
  return out; });

/** Where the pool's top (level h) meets the blade: the x (negative) where blade(x) = h, by bisection on [−xBack, −xEnd]. */
function fpmMeets(blade, h, xBack, xEnd) {
  let lo = -xBack, hi = -xEnd;
  if (blade(hi) >= h) return hi;     // (the level below the blade's face at the pool edge: the top meets it there)
  if (blade(lo) <= h) return lo;
  for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (blade(m) > h) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * The pool's mesh. o: { W, xBack, xEnd, h (m), blade: x -> the blade's underside height (m), outlets: [{ x, z }] (m, x
 *   negative), r (m: the landing's radius, fine around it), hFine (m, default 2 mm), hMax (m, default 12 mm), grow (default
 *   0.35), ny (rows, default 6), webBias (default 1.6: rows finer near the web), topFine (rows fine at the top as well as at
 *   the web: a heap on the top resolved), sideFine (default true: finer near the side plates; false for mirrors), eta
 *   (optional: the free top's height over
 *   the level at each node of the plan, m, index k·NX + i; 0 where the top meets the blade) }.
 * Returns { nN, nE, X, Y, Z, elems, faces, info: { xJ, xs, zs, rows, W, h, xBack, xEnd, top, NX, NY, NZ } }: node (i, j, k)
 *   (along x, up, across) is (k·NY + j)·NX + i; the top's nodes j = NY − 1.
 */
function fpmMesh(o) {
  const { W, xBack, xEnd, h, blade } = o, outs = o.outlets || [], hF = o.hFine ?? 2e-3, hM = o.hMax ?? 12e-3, gr = o.grow ?? 0.35, r = o.r ?? 3e-3;
  const xJ = fpmMeets(blade, h, xBack, xEnd);
  const xs = fpmLine(-xBack, -xEnd, fpmSize([...outs.map(q => q.x), xJ, -xBack, -xEnd], hF, r, gr, hM), [xJ]);
  const zs = fpmLine(0, W, fpmSize([...outs.map(q => q.z), ...(o.sideFine === false ? [] : [0, W])], hF, r, gr, hM));
  const ny = o.ny ?? 6, bias = o.webBias ?? 1.6;
  // rows: σ from 0 (web) to 1 (top), finer near the web (or near both, 1 − cos)
  const sig = Array.from({ length: ny + 1 }, (_, j) => (o.topFine ? (1 - Math.cos(Math.PI * j / ny)) / 2 : (Math.pow(bias, j / ny) - 1) / (bias - 1)));
  const nx = xs.length - 1, nz = zs.length - 1;
  // nodes: the element boundaries and their midpoints in each direction (Q2), columns of 2 ny + 1 nodes
  const mid = a => a.flatMap((v, i) => i + 1 < a.length ? [v, (v + a[i + 1]) / 2] : [v]);
  const XN = mid(xs), ZN = mid(zs), SN = mid(sig), NX = XN.length, NY = SN.length, NZ = ZN.length;
  const top = x => (x <= xJ + 1e-12 ? h : Math.min(h, blade(x))), eta = o.eta;
  if (eta && eta.length !== NX * NZ) throw new Error('the free top\'s heights do not match the plan');
  const nN = NX * NY * NZ, X = new Float64Array(nN), Y = new Float64Array(nN), Z = new Float64Array(nN), id = (i, j, k) => (k * NY + j) * NX + i;
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    const tp = top(XN[i]) + (eta && XN[i] < xJ - 1e-12 ? eta[k * NX + i] : 0);
    if (!(tp > 0)) throw new Error('the free top reaches the web');
    for (let j = 0; j < NY; j++) { const n = id(i, j, k); X[n] = XN[i]; Y[n] = SN[j] * tp; Z[n] = ZN[k]; }
  }
  const nE = nx * ny * nz, elems = new Int32Array(27 * nE), faces = [];
  let e = 0;
  for (let ez = 0; ez < nz; ez++) for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++, e++) {
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) elems[27 * e + (g * 3 + b) * 3 + a] = id(2 * ex + a, 2 * ey + b, 2 * ez + g);
    if (ex === 0) faces.push({ e, f: 0, tag: 'back' }); if (ex === nx - 1) faces.push({ e, f: 1, tag: 'end' });
    if (ey === 0) faces.push({ e, f: 2, tag: 'web' }); if (ey === ny - 1) faces.push({ e, f: 3, tag: xs[ex + 1] <= xJ + 1e-12 ? 'pile' : 'blade' });
    if (ez === 0) faces.push({ e, f: 4, tag: 'side0' }); if (ez === nz - 1) faces.push({ e, f: 5, tag: 'side1' });
  }
  return { nN, nE, X, Y, Z, elems, faces, info: { xJ, xs, zs, rows: sig, W, h, xBack, xEnd, top, NX, NY, NZ } };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fpmLine, fpmSize, fpmMeets, fpmMesh, FPM_FACES };
