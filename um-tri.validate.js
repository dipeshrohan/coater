/*
 * um-tri.validate.js — checks of um-tri.js (the 2D constrained Delaunay mesher with Ruppert's refinement).
 * Run: node um-tri.validate.js
 *  1. The predicates: conventions, and exact signs for points on a line or circle and an ulp off.
 *  2. Each domain below, meshed: every triangle counter-clockwise; the area exact; every segment present as a chain of
 *     edges along it, end to end; constrained Delaunay (every other edge locally Delaunay); the smallest angle at least the
 *     one asked (away from input corners sharper than it); no edge longer than twice the size asked.
 *       a plate with a round hole; an L with an inner line (a boundary between two materials); a spike of 15°; points
 *       given on a segment; a fixed boundary (no point added on it: what a patch sharing its edges needs).
 */
const U = require('./um-tri.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 1. predicates
{
  const ok = U.utOrient(0, 0, 1, 0, 0, 1) > 0 && U.utOrient(0, 0, 0, 1, 1, 0) < 0 && U.utInCircle(0, 0, 1, 0, 0, 1, 0.3, 0.3) > 0 && U.utInCircle(0, 0, 1, 0, 0, 1, 2, 2) < 0 && U.utInCircle(0, 0, 1, 0, 0, 1, 1, 1) === 0;
  let bad = 0, n = 0;
  for (let i = 0; i < 500; i++) {
    const a = [rnd(), rnd()], b = [rnd(), rnd()], t = rnd(), c = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    for (const e of [-2.3e-16, 0, 2.3e-16]) { const cc = [c[0], c[1] * (1 + e)]; const s1 = Math.sign(U.utOrient(...a, ...b, ...cc));
      // (the exact sign, by hand in BigInt through the same splitting)
      const ex = require('./um-tet.js').umtExact([...a, ...b, ...cc]), d = (ex[2] - ex[0]) * (ex[5] - ex[1]) - (ex[3] - ex[1]) * (ex[4] - ex[0]);
      n++; if ((s1 || 0) !== (d > 0n ? 1 : d < 0n ? -1 : 0)) bad++; }
  }
  check('predicates: conventions; on a line and an ulp off it, the sign always the exact one', ok && bad === 0, `${n - bad}/${n}`);
}

/** Everything a constrained Delaunay mesh must satisfy, against the domain given. */
function audit(label, G, o, { area, sharp = [] }) {
  const M = U.utMesh(G, o), nT = M.tri.length / 3, P = v => [M.x[v], M.y[v]];
  let cw = 0, A = 0, amin = 180, amin0 = 180, lmax = 0;
  const h = typeof o.size === 'function' ? o.size : () => o.size ?? Infinity;
  const isSharp = v => sharp.some(([sx, sy]) => M.x[v] === sx && M.y[v] === sy);
  const edges = new Map();
  for (let t = 0; t < nT; t++) {
    const v = [M.tri[3 * t], M.tri[3 * t + 1], M.tri[3 * t + 2]], [a, b, c] = v.map(P);
    const ar = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; if (!(ar > 0)) cw++; A += ar;
    let tmin = 180;
    for (let k = 0; k < 3; k++) {
      const p = P(v[k]), q = P(v[(k + 1) % 3]), w = P(v[(k + 2) % 3]), u = [q[0] - p[0], q[1] - p[1]], z = [w[0] - p[0], w[1] - p[1]];
      tmin = Math.min(tmin, Math.acos(Math.max(-1, Math.min(1, (u[0] * z[0] + u[1] * z[1]) / Math.hypot(...u) / Math.hypot(...z)))) * 180 / Math.PI);
      const L = Math.hypot(...u); lmax = Math.max(lmax, L / h((p[0] + q[0]) / 2, (p[1] + q[1]) / 2));
      const key = Math.min(v[k], v[(k + 1) % 3]) + ',' + Math.max(v[k], v[(k + 1) % 3]); (edges.get(key) || edges.set(key, []).get(key)).push([t, v[(k + 2) % 3]]);
    }
    amin0 = Math.min(amin0, tmin); if (!v.some(isSharp)) amin = Math.min(amin, tmin);
  }
  // every input segment covered by a chain of mesh segment pieces lying on it
  const segKey = new Set(M.seg.map(([a, b]) => Math.min(a, b) + ',' + Math.max(a, b)));
  let missing = 0, off = 0;
  for (const [a, b] of G.seg) {
    const ax = G.x[a], ay = G.y[a], bx = G.x[b], by = G.y[b], L = Math.hypot(bx - ax, by - ay);
    const on = M.seg.filter(([p, q]) => [p, q].every(v => Math.abs((bx - ax) * (M.y[v] - ay) - (by - ay) * (M.x[v] - ax)) <= 1e-12 * L * L && ((M.x[v] - ax) * (bx - ax) + (M.y[v] - ay) * (by - ay)) / (L * L) > -1e-12 && ((M.x[v] - ax) * (bx - ax) + (M.y[v] - ay) * (by - ay)) / (L * L) < 1 + 1e-12));
    const len = on.reduce((s, [p, q]) => s + Math.hypot(M.x[q] - M.x[p], M.y[q] - M.y[p]), 0);
    if (Math.abs(len / L - 1) > 1e-12) missing++;
  }
  for (const [p, q] of M.seg) if (!edges.has(Math.min(p, q) + ',' + Math.max(p, q))) off++;
  // constrained Delaunay: each inner edge that is not a segment piece locally Delaunay
  let nonDel = 0;
  for (const [key, ts] of edges) {
    if (ts.length !== 2 || segKey.has(key)) continue;
    const [t] = ts[0], d = ts[1][1], v = [M.tri[3 * t], M.tri[3 * t + 1], M.tri[3 * t + 2]].map(P);
    if (U.utInCircle(...v[0], ...v[1], ...v[2], ...P(d)) > 0) nonDel++;
  }
  const minA = o.minAngle ?? 25;
  const ok = cw === 0 && Math.abs(A / area - 1) < 1e-12 && missing === 0 && off === 0 && nonDel === 0 && amin >= minA && lmax <= 2;
  check(`${label}: counter-clockwise, area exact, every segment end to end, constrained Delaunay, angles ≥ ${minA}°${sharp.length ? ' (away from the sharp corner)' : ''}, edges ≤ 2 × the size`, ok,
    `${nT} triangles, ${M.x.length} points; area ${(A / area - 1).toExponential(1)}; smallest angle ${amin.toFixed(1)}°${sharp.length ? ` (${amin0.toFixed(1)}° at the corner)` : ''}; longest edge ${lmax.toFixed(2)} × size; not Delaunay ${nonDel}; segments missing ${missing}`);
  return M;
}

// 2. domains
{
  // a plate with a round hole (a polygon of 32 sides)
  const x = [0, 2, 2, 0], y = [0, 0, 1, 1], seg = [[0, 1, 'web'], [1, 2, 'out'], [2, 3, 'top'], [3, 0, 'in']], n = 32, c = [1.2, 0.5], r = 0.25;
  for (let i = 0; i < n; i++) { x.push(c[0] + r * Math.cos(2 * Math.PI * i / n)); y.push(c[1] + r * Math.sin(2 * Math.PI * i / n)); seg.push([4 + i, 4 + (i + 1) % n, 'pipe']); }
  audit('a plate with a round hole', { x, y, seg, holes: [c] }, { size: 0.06, minAngle: 28 }, { area: 2 - 0.5 * n * r * r * Math.sin(2 * Math.PI / n) });
  // graded: finer near the hole
  audit('  graded toward the hole (size 0.02 there, 0.15 far)', { x, y, seg, holes: [c] }, { size: (px, py) => 0.02 + 0.13 * Math.min(1, Math.max(0, (Math.hypot(px - c[0], py - c[1]) - r) / 0.6)), minAngle: 28 }, { area: 2 - 0.5 * n * r * r * Math.sin(2 * Math.PI / n) });
}
{
  // an L with an inner line from the re-entrant corner (two materials)
  const x = [0, 2, 2, 1, 1, 0], y = [0, 0, 1, 1, 2, 2], seg = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [3, 0, 'interface']];
  audit('an L with an inner line (two materials)', { x, y, seg }, { size: 0.1, minAngle: 28 }, { area: 3 });
}
{
  // a spike of 15° (an input corner sharper than the angle asked)
  const a = 15 * Math.PI / 180, x = [0, 2, 2 * Math.cos(a)], y = [0, 0, 2 * Math.sin(a)];
  audit('a wedge of 15° (sharper than the angle asked)', { x, y, seg: [[0, 1], [1, 2], [2, 0]] }, { size: 0.1, minAngle: 25 }, { area: 2 * Math.sin(a), sharp: [[0, 0]] });
}
{
  // points given on a segment (the segment through them, in pieces)
  const x = [0, 1, 1, 0, 0.3, 0.7], y = [0, 0, 1, 1, 0, 0], seg = [[0, 1], [1, 2], [2, 3], [3, 0]];
  audit('points given on a segment', { x, y, seg }, { size: 0.15, minAngle: 28 }, { area: 1 });
}
{
  // a fixed boundary: points every 0.05 along a rectangle's sides; none may be added there
  const x = [], y = [], seg = []; const side = (x0, y0, x1, y1, m) => { for (let i = 0; i < m; i++) { x.push(x0 + (x1 - x0) * i / m); y.push(y0 + (y1 - y0) * i / m); } };
  side(0, 0, 1, 0, 20); side(1, 0, 1, 0.5, 10); side(1, 0.5, 0, 0.5, 20); side(0, 0.5, 0, 0, 10);
  for (let i = 0; i < x.length; i++) seg.push([i, (i + 1) % x.length, 'edge']);
  const M = audit('a fixed boundary (the sides as given)', { x, y, seg }, { size: 0.06, minAngle: 25, fixed: true }, { area: 0.5 });
  const bd = new Set(); for (const [p, q] of M.seg) { bd.add(p); bd.add(q); }
  check('  no point added on the fixed boundary: its points exactly those given', bd.size === x.length && [...bd].every(v => x.some((xx, i) => xx === M.x[v] && y[i] === M.y[v])), `${bd.size} boundary points, ${x.length} given`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
