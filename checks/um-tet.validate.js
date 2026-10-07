/*
 * um-tet.validate.js — checks of um-tet.js (the app's own tetrahedral mesher: predicates and Delaunay).
 * Run: node um-tet.validate.js
 *  1. The predicates' conventions (the unit tetrahedron positive; a point inside, on and outside its sphere), and their
 *     signs exact where floating point alone cannot tell: points one unit in the last place off a plane and off a sphere,
 *     and exactly on them, against the exact integer evaluation; and the two quick answers: four points sharing one
 *     coordinate exactly (on a plane x, y or z = const: zero, without the integers) and one of them an ulp off it, and three
 *     points on a line (exactly, on lattice lines) or an ulp off it, against the exact evaluation.
 *  2. Delaunay of random points, of a regular grid (every cube's 8 corners on one sphere, faces of many points on the
 *     hull's planes), of points on a sphere, and of a set with duplicates:
 *       every tetrahedron positive (exactly); neighbours symmetric, across a shared face;
 *       Delaunay: every inner face locally Delaunay (the far vertex not strictly inside the sphere -- which makes the whole
 *       triangulation Delaunay), and for the smaller sets every point tested against every sphere;
 *       the hull closed (Euler: V − E + F − T = 1 for the solid), its volume the convex hull's (the cube's exactly; the
 *       sphere's points' hull as its own faces give it); every point used once, duplicates found.
 */
const T = require('../engine/um-tet.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 1. the predicates
{
  const o = T.umtOrient(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1), sIn = T.umtInSphere(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0.25, 0.25, 0.25),
    sOut = T.umtInSphere(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 2), sOn = T.umtInSphere(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1);
  check('conventions: the unit tetrahedron positive; a point inside its sphere positive, outside negative, on it zero', o > 0 && sIn > 0 && sOut < 0 && sOn === 0);
  // near-degenerate: a plane through three random points, the fourth on it (to round-off) and one ulp either side
  let agreeO = 0, nO = 0, agreeS = 0, nS = 0, zeros = 0;
  for (let k = 0; k < 400; k++) {
    const a = [rnd(), rnd(), rnd()], b = [rnd(), rnd(), rnd()], c = [rnd(), rnd(), rnd()], u = rnd(), v = rnd() * (1 - u);
    const d0 = [0, 1, 2].map(i => a[i] + u * (b[i] - a[i]) + v * (c[i] - a[i]));
    for (const dd of [-1, 0, 1]) {
      const d = d0.slice(); d[2] = dd < 0 ? d[2] - Math.abs(d[2]) * 2.3e-16 : dd > 0 ? d[2] + Math.abs(d[2]) * 2.3e-16 : d[2];
      const f = Math.sign(T.umtOrient(...a, ...b, ...c, ...d)), e = -T.umtOrientExact(...a, ...b, ...c, ...d);
      nO++; if (f === e || (f === 0 && e === 0) || Object.is(f, -0) && e === 0) agreeO++; if (e === 0) zeros++;
    }
    // a sphere: four points on it (from angles), the fifth on it and an ulp off
    const ctr = [rnd(), rnd(), rnd()], R = 0.3 + rnd(), on = () => { const th = Math.acos(2 * rnd() - 1), ph = 2 * Math.PI * rnd(); return [ctr[0] + R * Math.sin(th) * Math.cos(ph), ctr[1] + R * Math.sin(th) * Math.sin(ph), ctr[2] + R * Math.cos(th)]; };
    let P = [on(), on(), on(), on()]; if (T.umtOrient(...P[0], ...P[1], ...P[2], ...P[3]) < 0) P = [P[1], P[0], P[2], P[3]];
    const e5 = on();
    for (const f of [1 - 2.2e-16, 1, 1 + 2.2e-16]) {
      const q = [0, 1, 2].map(i => ctr[i] + (e5[i] - ctr[i]) * f);
      const s1 = Math.sign(T.umtInSphere(...P[0], ...P[1], ...P[2], ...P[3], ...q)), s2 = -T.umtInSphereExact(...P[0], ...P[1], ...P[2], ...P[3], ...q);
      nS++; if ((s1 === 0 ? 0 : s1) === (s2 === 0 ? 0 : s2)) agreeS++;
    }
  }
  check('near-degenerate orientations: the filtered sign always the exact one (points on a plane and an ulp off it)', agreeO === nO, `${agreeO}/${nO}, ${zeros} exactly on the plane`);
  check('near-degenerate spheres: the filtered sign always the exact one (points on a sphere and an ulp off it)', agreeS === nS, `${agreeS}/${nS}`);
  // the quick answers: points on a plane x, y or z = const (and one an ulp off it); points on a line (and one an ulp off)
  let agreeP = 0, nP = 0, onP = 0, agreeL = 0, nL = 0, onL = 0;
  const exactCollinear = (a, b, c) => { const [Ax, Ay, Az, Bx, By, Bz, Cx, Cy, Cz] = T.umtExact([...a, ...b, ...c]), ux = Bx - Ax, uy = By - Ay, uz = Bz - Az, vx = Cx - Ax, vy = Cy - Ay, vz = Cz - Az;
    return uy * vz - uz * vy === 0n && uz * vx - ux * vz === 0n && ux * vy - uy * vx === 0n; };
  for (let k = 0; k < 600; k++) {
    const ax = k % 3, h = rnd() * 0.1, P4 = [0, 1, 2, 3].map(() => { const p = [rnd() * 0.05, rnd() * 0.05, rnd() * 0.05]; p[ax] = h; return p; });
    for (const dd of [-1, 0, 1]) {
      const Q = P4.map(p => p.slice()); Q[k % 4][ax] = dd ? h * (1 + dd * 2.3e-16) : h;
      const f = Math.sign(T.umtOrient(...Q[0], ...Q[1], ...Q[2], ...Q[3])), e = -T.umtOrientExact(...Q[0], ...Q[1], ...Q[2], ...Q[3]);
      nP++; if ((f === 0 ? 0 : f) === (e === 0 ? 0 : e)) agreeP++; if (e === 0) onP++;
    }
    // (a lattice line: a + m d, every coordinate a multiple of 2^-12, exactly collinear; then c an ulp off it)
    const g = 1 / 4096, a = [0, 1, 2].map(() => Math.floor(rnd() * 200) * g), d = [0, 1, 2].map(i => (k % 4 === i ? 0 : Math.floor(rnd() * 9) - 4) * g);
    const b = a.map((x, i) => x + 3 * d[i]), c0 = a.map((x, i) => x + 7 * d[i]);
    for (const dd of [-1, 0, 1]) {
      const c = c0.slice(); if (dd) c[k % 3] = c[k % 3] === 0 ? dd * 1e-300 : c[k % 3] * (1 + dd * 2.3e-16);
      const f = T.umtCollinear(...a, ...b, ...c), e = exactCollinear(a, b, c);
      nL++; if (f === e) agreeL++; if (e) onL++;
    }
  }
  check('the quick answers: four points on a plane x, y or z = const zero, one an ulp off it signed, as the exact evaluation', agreeP === nP && onP > 0 && onP < nP, `${agreeP}/${nP}, ${onP} on the plane`);
  check('  three points on a line collinear, one an ulp off it not, as the exact evaluation', agreeL === nL && onL > 0 && onL < nL, `${agreeL}/${nL}, ${onL} on the line`);
}

/** Everything a Delaunay tetrahedralization must satisfy; returns a line for the report. */
function audit(label, X, Y, Z, D, { brute = false, hullVolume = null } = {}) {
  const n = X.length, P = v => [X[v], Y[v], Z[v]];
  let neg = 0, asym = 0, nonDel = 0, used = new Uint8Array(n);
  for (let t = 0; t < D.nT; t++) {
    const v = D.tv.subarray(4 * t, 4 * t + 4); for (const q of v) used[q] = 1;
    if (!(T.umtOrient(...P(v[0]), ...P(v[1]), ...P(v[2]), ...P(v[3])) > 0)) neg++;
    for (let k = 0; k < 4; k++) {
      const nb = D.tn[4 * t + k]; if (nb < 0) continue;
      const back = [0, 1, 2, 3].filter(q => D.tn[4 * nb + q] === t);
      const mine = [0, 1, 2, 3].filter(q => q !== k).map(q => v[q]).sort((a, b) => a - b).join();
      if (back.length !== 1 || [0, 1, 2, 3].filter(q => q !== back[0]).map(q => D.tv[4 * nb + q]).sort((a, b) => a - b).join() !== mine) asym++;
      // (locally Delaunay: the neighbour's far vertex not strictly inside this one's sphere)
      const far = D.tv[4 * nb + back[0]];
      if (T.umtInSphere(...P(v[0]), ...P(v[1]), ...P(v[2]), ...P(v[3]), ...P(far)) > 0) nonDel++;
    }
  }
  let bruteBad = 0;
  if (brute) for (let t = 0; t < D.nT; t++) { const v = D.tv.subarray(4 * t, 4 * t + 4); for (let q = 0; q < n; q++) if (D.dup[q] < 0 && T.umtInSphere(...P(v[0]), ...P(v[1]), ...P(v[2]), ...P(v[3]), ...P(q)) > 0) bruteBad++; }
  // Euler characteristic of the solid: V − E + F − T = 1
  const E = new Set(), F = new Set();
  for (let t = 0; t < D.nT; t++) { const v = Array.from(D.tv.subarray(4 * t, 4 * t + 4)).sort((a, b) => a - b);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) E.add(v[i] + ',' + v[j]);
    for (let k = 0; k < 4; k++) F.add(v.filter((_, i) => i !== k).join()); }
  let V = 0; for (let q = 0; q < n; q++) if (used[q]) V++;
  const chi = V - E.size + F.size - D.nT;
  let vol = 0; for (let t = 0; t < D.nT; t++) { const v = D.tv.subarray(4 * t, 4 * t + 4), a = P(v[0]), b = P(v[1]), c = P(v[2]), d = P(v[3]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], z = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    vol += (u[0] * (w[1] * z[2] - w[2] * z[1]) - u[1] * (w[0] * z[2] - w[2] * z[0]) + u[2] * (w[0] * z[1] - w[1] * z[0])) / 6; }
  // the hull's own volume, from its triangles (outward), against the tetrahedra's
  let hv = 0; for (let i = 0; i < D.hull.length; i += 3) { const a = P(D.hull[i]), b = P(D.hull[i + 1]), c = P(D.hull[i + 2]);
    hv += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  let unused = 0; for (let q = 0; q < n; q++) if (!used[q] && D.dup[q] < 0) unused++;
  const ref = hullVolume ?? hv;
  const ok = neg === 0 && asym === 0 && nonDel === 0 && bruteBad === 0 && chi === 1 && Math.abs(vol / ref - 1) < 1e-12 && Math.abs(hv / vol - 1) < 1e-12;
  check(`${label}: every tetrahedron positive, neighbours symmetric, Delaunay${brute ? ' (every point against every sphere too)' : ''}, the hull closed, its volume exact`, ok && unused === 0,
    `${n} points → ${D.nT} tetrahedra, ${D.hull.length / 3} hull triangles; inverted ${neg}, asymmetric ${asym}, not Delaunay ${nonDel}${brute ? `, inside a sphere ${bruteBad}` : ''}; Euler ${chi}; volume ${(vol / ref - 1).toExponential(1)}; points unused ${unused}`);
  return D;
}

// 2. Delaunay on random, degenerate and duplicate sets
{
  const rand = (n) => { const X = [], Y = [], Z = []; for (let i = 0; i < n; i++) { X.push(rnd()); Y.push(rnd()); Z.push(rnd()); } return [X, Y, Z]; };
  { const [X, Y, Z] = rand(300); audit('300 random points', X, Y, Z, T.umtDelaunay(X, Y, Z), { brute: true }); }
  { const [X, Y, Z] = rand(20000); const t0 = Date.now(), D = T.umtDelaunay(X, Y, Z); audit(`20,000 random points (${Date.now() - t0} ms)`, X, Y, Z, D); }
  { // a grid: every cube's corners cospherical, the hull's faces planes of many points
    const m = 7, X = [], Y = [], Z = []; for (let k = 0; k <= m; k++) for (let j = 0; j <= m; j++) for (let i = 0; i <= m; i++) { X.push(i * 1.5e-3); Y.push(j * 1e-3); Z.push(k * 2e-3); }
    audit(`a regular grid ${m + 1}³ (every cube's 8 corners on one sphere)`, X, Y, Z, T.umtDelaunay(X, Y, Z), { brute: true, hullVolume: (m * 1.5e-3) * (m * 1e-3) * (m * 2e-3) });
  }
  { // points on a sphere (all cospherical) and its centre
    const X = [0], Y = [0], Z = []; Z.push(0);
    for (let i = 0; i < 400; i++) { const th = Math.acos(2 * rnd() - 1), ph = 2 * Math.PI * rnd(); X.push(Math.sin(th) * Math.cos(ph)); Y.push(Math.sin(th) * Math.sin(ph)); Z.push(Math.cos(th)); }
    audit('400 points on a sphere and its centre (all on one sphere)', X, Y, Z, T.umtDelaunay(X, Y, Z), { brute: true });
  }
  { // duplicates and points on the hull's faces and edges
    const X = [], Y = [], Z = []; for (let i = 0; i < 200; i++) { X.push(rnd()); Y.push(rnd()); Z.push(rnd()); }
    for (const c of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) { X.push(c[0]); Y.push(c[1]); Z.push(c[2]); }
    for (let i = 0; i < 60; i++) { X.push(rnd()); Y.push(rnd()); Z.push(i % 2); }          // (on the top and bottom faces)
    for (let i = 0; i < 20; i++) { X.push(rnd()); Y.push(0); Z.push(0); }                  // (on an edge)
    for (let i = 0; i < 30; i++) { const q = Math.floor(rnd() * 200); X.push(X[q]); Y.push(Y[q]); Z.push(Z[q]); }   // (duplicates)
    const D = T.umtDelaunay(X, Y, Z); let nd = 0; for (const d of D.dup) if (d >= 0) nd++;
    audit('a cube\'s corners, points on its faces and an edge, and 30 duplicates', X, Y, Z, D, { brute: true, hullVolume: 1 });
    check('  every duplicate found (30), none taken for one by mistake', nd === 30 && Array.from(D.dup).every((d, q) => d < 0 || (X[d] === X[q] && Y[d] === Y[q] && Z[d] === Z[q])), `${nd} found`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
