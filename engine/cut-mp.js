'use strict';
/*
 * cut-mp.js — MP-CUT: the dried film cut into pieces with a knife along a ruler: the cut edge, in 1D, 2D and 3D.
 * The film comes as the drying left it (film.js's layers through its thickness: each its stiffness at its water and
 * its natural strain -- the size it would take on its own). Held in the whole film, each layer carries a stress; the
 * cut makes a free edge that must carry none, so near the cut the layers pull and push on each other.
 *
 *  - 1D: through the film at the cut. The free piece's stress in each layer far from the edges (its stretch and curl from
 *    the layers' natural strains: laminate theory, both ways in its plane); and, for each interface between the layers,
 *    the energy released per area if the layers part there from the cut inward (steady state: far behind the front each
 *    part free across the cut, held along it as the piece is), against the layers' hold on each other.
 *  - 2D: the section across the cut (x in from the cut, z up through the film), plane strain along the cut with the
 *    piece's own strain there (each layer's natural strain less the piece's stretch and curl): finite elements (mp-core's
 *    mpElastic). The stress near the edge: the peel between the layers (σ_zz), their shear (σ_xz), along the film
 *    (σ_xx), shed to none at the edge; far in, the 1D's.
 *  - 3D: the cut piece (sheet.js's plate, von Kármán): its curl and its corners, free and lying on a table.
 * SI (m, Pa, J).
 */
const CMP = typeof mpMesh === 'function' ? { mpMesh, mpElastic } : require('./mp-core.js');
const CMP_SH = typeof shRun === 'function' ? { shRun, shPlate } : (() => { try { return require('./sheet.js'); } catch (e) { return {}; } })();

/** The layers' bottoms (z, from the film's underside) and its thickness. layers: [{ t, E, nu, en }] from the bottom up. */
function cutZ(layers) { let z = 0; const z0 = layers.map(L => { const a = z; z += L.t; return a; }); return { z0, H: z }; }
/** Q = E / (1 − ν): a layer's biaxial stiffness (its plane strained alike both ways). */
const cutQ = L => L.E / (1 - L.nu);
/**
 * The free piece far from its edges (both ways alike in its plane): its stretch e0 and curl κ (strain e0 + κ z) from
 * N = M = 0, each layer's stress Q (e0 + κ z − en). Returns { e0, kappa, sig (z) → stress, at: [{ z0, z1, s0, s1 }] }.
 */
function cutFree(layers) {
  const { z0 } = cutZ(layers);
  let A = 0, B = 0, D = 0, An = 0, Bn = 0;
  layers.forEach((L, i) => {
    const Q = cutQ(L), a = z0[i], b = a + L.t;
    A += Q * L.t; B += Q * (b * b - a * a) / 2; D += Q * (b * b * b - a * a * a) / 3; An += Q * L.t * L.en; Bn += Q * L.en * (b * b - a * a) / 2;
  });
  const det = A * D - B * B, e0 = (An * D - Bn * B) / det, kappa = (A * Bn - B * An) / det;
  const at = layers.map((L, i) => { const Q = cutQ(L), a = z0[i], b = a + L.t; return { z0: a, z1: b, s0: Q * (e0 + kappa * a - L.en), s1: Q * (e0 + kappa * b - L.en) }; });
  return { e0, kappa, at, A, B, D };
}
/** The energy per area (J/m²) of a stack of layers strained εx = ex + kx z, εy = ey + ky z (plane stress in each layer),
 *  the elastic part less each layer's natural strain; 2-point Gauss in each layer (exact: the energy is quadratic in z). */
function cutEnergy(layers, z0, ex, kx, ey, ky) {
  const g = [0.5 - 0.5 / Math.sqrt(3), 0.5 + 0.5 / Math.sqrt(3)];
  let W = 0;
  layers.forEach((L, i) => {
    const Eb = L.E / (1 - L.nu * L.nu);
    for (const s of g) {
      const z = z0[i] + s * L.t, a = ex + kx * z - L.en, b = ey + ky * z - L.en;
      W += 0.5 * Eb * (a * a + 2 * L.nu * a * b + b * b) * L.t / 2;
    }
  });
  return W;
}
/**
 * One part's stretch and curl across the cut (εx = ex + kx z) with its strain along the cut held at ey + ky z (the
 * piece's): N_x = M_x = 0 in it. Returns { ex, kx }.
 */
function cutArm(layers, z0, ey, ky) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  layers.forEach((L, i) => {
    const Eb = L.E / (1 - L.nu * L.nu), a = z0[i], b = a + L.t, m1 = L.t, m2 = (b * b - a * a) / 2, m3 = (b * b * b - a * a * a) / 3;
    a11 += Eb * m1; a12 += Eb * m2; a22 += Eb * m3;
    // σx = Eb ((ex + kx z − en) + ν (ey + ky z − en)) = 0 on N and M
    b1 += Eb * (L.en * m1 - L.nu * (ey * m1 + ky * m2 - L.en * m1));
    b2 += Eb * (L.en * m2 - L.nu * (ey * m2 + ky * m3 - L.en * m2));
  });
  const det = a11 * a22 - a12 * a12;
  return { ex: (b1 * a22 - b2 * a12) / det, kx: (a11 * b2 - a12 * b1) / det };
}
/**
 * The 1D: the free piece's stresses and, for each interface (between layer j − 1 and j), the energy released per area
 * if the layers part there from the cut (steady state): G_j = W(the piece) − W(the part below) − W(the part above).
 * o: { layers: [{ t, E, nu, en }], Gl (J/m², the layers' hold) }.
 * Returns { free, H, G: [{ z, j, G }], Gmax, jMax, ms }.
 */
function cutRun1(o) {
  const t0 = Date.now(), Ls = o.layers, { z0, H } = cutZ(Ls), F = cutFree(Ls);
  const W0 = cutEnergy(Ls, z0, F.e0, F.kappa, F.e0, F.kappa), G = [];
  for (let j = 1; j < Ls.length; j++) {
    const lo = Ls.slice(0, j), hi = Ls.slice(j), zlo = z0.slice(0, j), zhi = z0.slice(j);
    const A1 = cutArm(lo, zlo, F.e0, F.kappa), A2 = cutArm(hi, zhi, F.e0, F.kappa);
    const W = cutEnergy(lo, zlo, A1.ex, A1.kx, F.e0, F.kappa) + cutEnergy(hi, zhi, A2.ex, A2.kx, F.e0, F.kappa);
    G.push({ j, z: z0[j], G: W0 - W });
  }
  let jMax = -1, Gmax = 0; G.forEach((g, i) => { if (g.G > Gmax) { Gmax = g.G; jMax = i; } });
  return { dim: 1, free: { e0: F.e0, kappa: F.kappa, at: F.at }, H, W0, G, Gmax, jMax, Gl: o.Gl, ms: Date.now() - t0 };
}

/**
 * The 2D's mesh: x from the cut (0) in to L (the domain's far end, a mirror: the piece's middle), graded toward the cut;
 * z through the film, each layer (or a band of them, layers grouped when there are many) its own elements.
 * o.mesh: { nx (along), grade (the largest over the smallest), Lh (L over the film's thickness), nzL (elements a layer),
 * group (layers to an element band, ≥ 1) }.
 */
function cutAxes2(o) {
  const { H } = cutZ(o.layers), m = o.mesh, L = Math.max(2, m.Lh || 20) * H, g = Math.max(1, Math.round(m.group || 1));
  const zs = [], bands = [];
  for (let i = 0; i < o.layers.length; i += g) { const sl = o.layers.slice(i, i + g); bands.push({ i0: i, n: sl.length }); zs.push({ L: sl.reduce((a, q) => a + q.t, 0), n: Math.max(1, m.nzL || 2) }); }
  return { axes: [[{ L, n: m.nx, grade: m.grade, end: 'lo' }], zs], L, H, bands };
}
/**
 * The 2D: plane strain along the cut at the piece's own strain there (e0 + κ z, the 1D's), each element its band's
 * layer properties (a band of layers: their stiffness-weighted means), the layers' natural strain in the plane (x, y);
 * the cut at x = 0 free, the far end a mirror (no movement along x), one point held up and down.
 * Returns { mesh: { coord, nn }, sxx, szz, sxz, syy (N, Pa), far: σ_xx through the film at the far end, edge: σ_zz and
 * σ_xz along each interface from the cut, peel, shear (their largest near the cut), ms }.
 */
function cutRun2(o) {
  const t0 = Date.now(), A = cutAxes2(o), F = cutFree(o.layers), { z0 } = cutZ(o.layers);
  // (a band's properties: E, ν by their thickness-weighted means; its natural strain the Q-weighted mean)
  const mats = A.bands.map(b => { const sl = o.layers.slice(b.i0, b.i0 + b.n), t = sl.reduce((a, q) => a + q.t, 0); return { E: sl.reduce((a, q) => a + q.E * q.t, 0) / t, nu: sl.reduce((a, q) => a + q.nu * q.t, 0) / t }; });
  const enB = A.bands.map(b => { const sl = o.layers.slice(b.i0, b.i0 + b.n), w = sl.reduce((a, q) => a + cutQ(q) * q.t, 0); return sl.reduce((a, q) => a + cutQ(q) * q.t * q.en, 0) / w; });
  const M = CMP.mpMesh({ dim: 2, p: o.mesh.p || 2, axes: A.axes, mat: (ijk, seg) => seg[1] });
  // eigenstrain [xx, through, along-the-cut (out of the plane), ...]: along the cut its elastic strain is the piece's,
  // e0 + κ z − en (total 0 in plane strain: the eigenstrain en − e0 − κ z)
  const r = CMP.mpElastic(M, { mats, plane: 'strain', eig: (m, x) => [enB[m], 0, enB[m] - F.e0 - F.kappa * x[1], 0, 0, 0],
    bc: [{ face: 'x1', fix: [0] }, { node: M.node([M.nn[0] - 1, 0]), fix: [1] }] });
  const N = M.N, sxx = new Array(N), szz = new Array(N), sxz = new Array(N), syy = new Array(N);
  for (let n = 0; n < N; n++) { sxx[n] = r.stress[n * 6]; szz[n] = r.stress[n * 6 + 1]; syy[n] = r.stress[n * 6 + 2]; sxz[n] = r.stress[n * 6 + 5]; }
  const xs = M.coord[0], zs = M.coord[1], nx = xs.length, nz = zs.length;
  const far = zs.map((z, k) => ({ z, sxx: sxx[M.node([nx - 1, k])], syy: syy[M.node([nx - 1, k])] }));
  // (along each band interface: its peel and shear from the cut in)
  const ifaces = [];
  let k = 0; for (let b = 0; b < A.bands.length - 1; b++) { k += Math.max(1, o.mesh.nzL || 2) * M.p; ifaces.push({ k, z: zs[k], szz: xs.map((_, i) => szz[M.node([i, k])]), sxz: xs.map((_, i) => sxz[M.node([i, k])]) }); }
  // (the peel and the shear between the layers a distance in from the cut: at the cut's corner they rise without bound
  //  where the layers differ in stiffness -- a free edge's singularity -- so a fixed distance in, a quarter of the film's
  //  thickness, is the measure that settles as the mesh is refined)
  const xq = (o.at || 0.25) * A.H, at = arr => { for (let i = 1; i < nx; i++) if (xs[i] >= xq) { const f = (xq - xs[i - 1]) / (xs[i] - xs[i - 1]); return arr[i - 1] + f * (arr[i] - arr[i - 1]); } return arr[nx - 1]; };
  let peel = { v: 0, z: 0, i: -1 }, shear = { v: 0, z: 0, i: -1 };
  ifaces.forEach((f, i) => { f.peelAt = at(f.szz); f.shearAt = at(f.sxz); if (Math.abs(f.peelAt) > Math.abs(peel.v)) peel = { v: f.peelAt, z: f.z, i }; if (Math.abs(f.shearAt) > Math.abs(shear.v)) shear = { v: f.shearAt, z: f.z, i }; });
  peel.x = shear.x = xq;
  // (the cut's own face carries no force or moment: its σ_xx through the film, integrated (Simpson on the quadratic elements))
  const edge = zs.map((z, kk) => ({ z, sxx: sxx[M.node([0, kk])] }));
  let Ne = 0, Me = 0, Nf = 0;
  for (let kk = 0; kk + 2 < nz; kk += 2) { const h = zs[kk + 2] - zs[kk], w = [1, 4, 1]; for (let q = 0; q < 3; q++) { const v = edge[kk + q].sxx, z = zs[kk + q]; Ne += w[q] * v * h / 6; Me += w[q] * v * (z - A.H / 2) * h / 6; Nf += w[q] * Math.abs(far[kk + q].sxx) * h / 6; } }
  // (the edge's lift: the cut face's top and bottom moving up and down against the far end's)
  const uz = kk => r.u[M.node([0, kk]) * 2 + 1] - r.u[M.node([nx - 1, kk]) * 2 + 1];
  void z0;
  return { dim: 2, mesh: { coord: M.coord, nn: M.nn, p: M.p, N, E: M.E, L: A.L, H: A.H, bands: A.bands.length }, sxx, szz, sxz, syy, far, edge, ifaces, peel, shear, edgeN: Ne, edgeM: Me, farN: Nf,
    lift: { bottom: uz(0), top: uz(nz - 1) }, free: { e0: F.e0, kappa: F.kappa, at: F.at }, ms: Date.now() - t0 };
}

/**
 * The 3D: the cut piece as a plate (sheet.js, von Kármán): film.js's plate for its film (its stiffnesses A, D, ν about
 * its neutral plane, its natural curl kS both ways and the roll's set kSet along the line, its weight per area p), a
 * quarter n × n elements; free (held up) and lying on a table under its weight. o: { plate, Lx, Ly, n }.
 * Returns { free, table } each: the heights on the whole piece W (mm, (2n + 1)², from its middle), its corner's and its
 * edges' middles' heights (m), the curvatures at its middle, its steepest slope; and the plate's numbers.
 */
function cutRun3(o) {
  const t0 = Date.now(), P = o.plate, n = o.n || 8;
  const base = { Lx: o.Lx, Ly: o.Ly, A: P.A, D: P.D, nu: P.nu, h: P.h, kx: P.kS + (P.kSet || 0), ky: P.kS, n };
  const pk = r => ({ n: r.n, W: r.W.map(row => row.map(v => +(v * 1000).toPrecision(5))), corner: r.corner, edgeX: r.edgeX, edgeY: r.edgeY, middle: r.middle,
    kxMid: r.kxMid, kyMid: r.kyMid, flip: r.flip, maxSlope: r.maxSlope, E: r.E, gnorm: r.gnorm });
  if (o.onProgress) o.onProgress({ k: 0, n: 2 });
  const free = CMP_SH.shRun({ ...base, p: 0, table: false });
  if (o.onProgress) o.onProgress({ k: 1, n: 2 });
  const table = CMP_SH.shRun({ ...base, p: P.p, table: true });
  return { dim: 3, free: pk(free), table: pk(table), kx: base.kx, ky: base.ky, h: P.h, p: P.p, n, ms: Date.now() - t0 };
}
/** A run for a dimension. */
function cutRun(o) { return o.dim === 1 ? cutRun1(o) : o.dim === 2 ? cutRun2(o) : cutRun3(o); }

if (typeof module !== 'undefined' && module.exports) module.exports = { cutRun, cutRun1, cutRun2, cutRun3, cutFree, cutEnergy, cutArm, cutAxes2, cutZ, cutQ };
