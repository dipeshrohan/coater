/*
 * cfd-1d.js — the 1D stage of Flow: lubrication flow along the blade for a
 * generalized-Newtonian slurry, solved exactly across the gap at every
 * station, with the same blade shape, rheology and web slip as the 2D.
 *
 * Along the flow (x, from the inlet at the pool edge / start of the land to
 * the metering edge) the gap h(x) is slender, so at each station the flow is
 * locally fully developed: a moving web (y = 0, speed U, Beavers–Joseph slip
 * du/dy = lam (u - U)) and the fixed blade (y = h, no slip), driven by the
 * local pressure gradient G = -dp/dx. The shear stress is then exactly linear
 * across the gap, tau(y) = tau0 - G y (y-momentum alone, any rheology), and
 * the shear rate follows from the stress by inverting the rheology law
 * (shearRateFromStress, cfd-solver.js). Two conditions fix the two unknowns
 * (tau0, G) at a station: no slip at the blade, u(h) = 0, and the flow rate
 * per unit width, integral of u dy = q, which is the same at every station.
 * q itself is set by the bead pressure: p = Pup at the inlet and p = 0
 * (ambient) at the metering edge, so the integral of G dx over the blade
 * equals Pup. The film left on the web is q / U.
 *
 * Also here: the blade shape (shared with cfd-worker.js, so the 1D and 2D
 * see the same geometry), the film from the edge to the oven (the 1D
 * thin-film equation, solveDownstreamFilm in cfd-solver.js), the ripple
 * levelling on that film, and the static meniscus on the exit face.
 *
 * Units: SI throughout (m, s, Pa, Pa·s).
 */

/**
 * Blade height above the web over the blade's part of the domain, x = 0 at the inlet, x = Lx at the metering edge.
 * A shaped blade (o.blade: cfd-blade.js's bladeProfile spec, a shape other than the round entry and flat land):
 * its underside, and the profile itself (profile).
 */
function bladeShape(o) {
  if (o.blade && o.blade.shape !== 'round' && o.blade.shape !== 'flat') {
    const make = typeof bladeProfile === 'function' ? bladeProfile : require('./cfd-blade.js').bladeProfile;
    const p = make({ ...o.blade, H: o.H });
    return { Lx: p.xe, h: p.hUnder, profile: p };
  }
  if (o.geometry === 'round') {
    // Round entry of radius R whose lowest point is the metering edge (gap H
    // there), converging from the pool edge Xup upstream.
    const R = o.R, X = o.Xup, H = o.H, root = x => Math.sqrt(R * R - (X - x) ** 2);
    return { Lx: X, h: x => H + R - root(x) };
  }
  return { Lx: o.L, h: () => o.H };
}

/**
 * One station: for the stress at the web tau0 and the pressure gradient G, integrate the exact
 * profile from the web (u(0) = U + du/dy(0) / lam with slip, else U) to the blade.
 * Returns the velocity at the blade uTop (should be 0) and the flow rate q (Simpson's rule).
 */
function station1D(h, U, lam, law, tau0, G, ny, keep) {
  const dy = h / ny;
  const dudy = y => { const t = tau0 - G * y; return Math.sign(t) * shearRateFromStress(Math.abs(t), law.muRef, law.ty, law.n, law.x); };
  let d0 = dudy(0), u = U + (lam > 0 ? d0 / lam : 0);
  const us = keep ? new Float64Array(ny + 1) : null;
  if (us) us[0] = u;
  let q = 0;
  for (let j = 0; j < ny; j++) {
    // u at the end of the interval (Simpson on du/dy, midpoint and ends), and q by Simpson on u
    const dm = dudy((j + 0.5) * dy), d1 = dudy((j + 1) * dy);
    const um = u + dy * (5 * d0 + 8 * dm - d1) / 24;   // (quadratic through d0, dm, d1, integrated to the midpoint)
    const u1 = u + dy * (d0 + 4 * dm + d1) / 6;
    q += dy * (u + 4 * um + u1) / 6;
    u = u1; d0 = d1;
    if (us) us[j + 1] = u;
  }
  return { uTop: u, q, u: us };
}

/**
 * The station's (tau0, G) for the flow rate q: Newton on (u(h), q(h) - q) with a finite-difference
 * Jacobian, damped by halving; start from `guess` (the previous station) or the Newtonian closed form.
 */
function solveStation1D(h, U, lam, law, q, guess, ny = 160) {
  const muN = muEffLocal(Math.abs(U) / h + 1e-12, law.muRef, law.ty, law.n, law.x);
  let tau0, G;
  if (guess) ({ tau0, G } = guess);
  else {   // Newtonian, no slip: q = U h / 2 + G h^3 / (12 mu), u(h) = 0 -> tau0 = G h / 2 - mu U / h
    G = (q - U * h / 2) * 12 * muN / (h * h * h);
    tau0 = G * h / 2 - muN * U / h;
  }
  const sT = Math.abs(tau0) + Math.abs(G) * h + law.ty + muN * Math.abs(U) / h + 1e-9;   // stress scale
  const sQ = Math.abs(q) + Math.abs(U) * h + 1e-15;                                       // flow-rate scale
  const F = (t, g) => { const r = station1D(h, U, lam, law, t, g, ny); return [r.uTop * h / sQ, (r.q - q) / sQ]; };
  let f = F(tau0, G), nf = Math.hypot(f[0], f[1]);
  for (let it = 0; it < 60 && nf > 1e-10; it++) {
    const dT = 1e-7 * sT, dG = 1e-7 * sT / h;
    const fT = F(tau0 + dT, G), fG = F(tau0, G + dG);
    const a = (fT[0] - f[0]) / dT, b = (fG[0] - f[0]) / dG, c = (fT[1] - f[1]) / dT, d = (fG[1] - f[1]) / dG;
    const det = a * d - b * c;
    if (!Number.isFinite(det) || det === 0) break;
    const st = -(d * f[0] - b * f[1]) / det, sg = -(-c * f[0] + a * f[1]) / det;
    let lam2 = 1, ok = false;
    for (let k = 0; k < 30; k++) {
      const t1 = tau0 + lam2 * st, g1 = G + lam2 * sg, f1 = F(t1, g1), n1 = Math.hypot(f1[0], f1[1]);
      if (n1 < nf) { tau0 = t1; G = g1; f = f1; nf = n1; ok = true; break; }
      lam2 /= 2;
    }
    if (!ok) break;
  }
  return { tau0, G, residual: nf, converged: nf <= 1e-8 };
}

/**
 * The 1D gap flow of a location (geo: cfd-ui.js's cfdGeometry, or the same fields): the flow rate
 * the bead pressure drives, and along the blade the gap, pressure, pressure gradient and the wall
 * shear stresses. nx stations, graded toward the metering edge where the gap is smallest.
 */
function gapFlow1D(geo, { nx = 120, ny = 160 } = {}) {
  const o = { geometry: geo.shape, H: geo.H, L: geo.L, R: geo.R, Xup: geo.Xup, blade: geo.blade };
  const shape = bladeShape(o), Lx = shape.Lx;
  const law = { muRef: geo.muRef, ty: geo.ty || 0, n: geo.n ?? 1, x: geo.rheoX };
  const U = geo.U, lam = geo.webSlip || 0;
  // stations: denser near the edge (x = Lx), where the gap is smallest and the pressure falls fastest
  const xs = Array.from({ length: nx + 1 }, (_, i) => Lx * (1 - Math.pow(1 - i / nx, 1.6)));
  // (a shaped blade's underside corners, a step's riser either side: stations there, so the pressure gradient's jump is not smeared)
  if (shape.profile) {
    for (const c of shape.profile.underCorners) { const x = shape.profile.under.P(c.s)[0]; xs.push(x * (1 - 1e-9), x * (1 + 1e-9)); }
    xs.sort((a, b) => a - b);
  }
  const hs = xs.map(shape.h);
  let last = null;
  const sweep = q => {
    const out = [];
    let guess = null;
    for (let i = 0; i < xs.length; i++) {
      const s = solveStation1D(hs[i], U, lam, law, q, guess, ny);
      out.push(s); guess = s;
    }
    let dp = 0;
    for (let i = 1; i < xs.length; i++) dp += (xs[i] - xs[i - 1]) * (out[i].G + out[i - 1].G) / 2;
    last = { q, st: out, dp };
    return dp;
  };
  // q: the pressure drop over the blade grows with q; bracket, then Illinois (regula falsi)
  const muRep = muEffLocal(U / geo.H, law.muRef, law.ty, law.n, law.x);
  let I2 = 0, I3 = 0;
  for (let k = 0; k < 4000; k++) { const h = shape.h((k + 0.5) * Lx / 4000); I2 += Lx / 4000 / (h * h); I3 += Lx / 4000 / (h * h * h); }
  const qLub = (geo.Pup + 6 * muRep * U * I2) / (12 * muRep * I3);   // one viscosity (the classical estimate), as a starting point
  let a = Math.max(qLub * 0.5, 1e-12), fa = sweep(a) - geo.Pup;
  let b = qLub * 1.5, fb = sweep(b) - geo.Pup;
  for (let k = 0; k < 40 && fa > 0; k++) { b = a; fb = fa; a /= 2; fa = sweep(a) - geo.Pup; }
  for (let k = 0; k < 40 && fb < 0; k++) { a = b; fa = fb; b *= 2; fb = sweep(b) - geo.Pup; }
  let side = 0, q = b, it = 0;
  for (; it < 60; it++) {
    q = (a * fb - b * fa) / (fb - fa);
    const fq = sweep(q) - geo.Pup;
    if (Math.abs(fq) < 1e-9 * Math.max(geo.Pup, 1) || Math.abs(b - a) < 1e-12 * q) break;
    if (fq * fb > 0) { b = q; fb = fq; if (side === -1) fa /= 2; side = -1; }
    else { a = q; fa = fq; if (side === 1) fb /= 2; side = 1; }
  }
  if (last.q !== q) sweep(q);
  const st = last.st;
  const p = [geo.Pup];
  for (let i = 1; i < xs.length; i++) p.push(p[i - 1] - (xs[i] - xs[i - 1]) * (st[i].G + st[i - 1].G) / 2);
  return {
    blade: shape.profile || null,               // (a shaped blade's profile, cfd-blade.js)
    q, film: q / U, qLub, filmLub: qLub / U, Lx, x: xs, h: hs, p, G: st.map(s => s.G),
    tauWeb: st.map(s => s.tau0), tauBlade: st.map((s, i) => s.tau0 - s.G * hs[i]),
    pEdgeResidual: p[p.length - 1], iterations: it, converged: st.every(s => s.converged),
    worstStation: Math.max(...st.map(s => s.residual)), law, U, lam,
    /** the velocity profile at station i: y (m) and u (m/s) */
    profile: (i, n = 80) => { const s = st[i], h = hs[i], r = station1D(h, U, lam, law, s.tau0, s.G, n, true); return { y: Array.from({ length: n + 1 }, (_, j) => j * h / n), u: Array.from(r.u), x: xs[i], h }; },
  };
}

/** The film from the metering edge to the oven: the 1D thin-film equation (cfd-solver.js) with this flow rate. */
function film1D(geo, q) {
  const mu = muEffLocal(geo.U * geo.U / q, geo.muRef, geo.ty || 0, geo.n ?? 1, geo.rheoX);   // at the film's own shear scale U / h_inf, as the 2D's film
  const r = solveDownstreamFilm({ H0: geo.H, Q: q, U: geo.U, mu, gamma: geo.gamma, rho: geo.rho, g: geo.g, Lx: geo.ovenDistance, nx: 200, maxSteps: 150000, tol: 1e-8 });
  return { ...r, mu };
}

// (rheo.js: loaded before this in the page and the workers, required in Node)
const ONED_R = typeof rheoLamStep === 'function' ? { rheoCompile, rheoLamEq, rheoLamStep, rheoMuStruct, rheoYieldStruct, rheoLevel } : require('./rheo.js');

/**
 * The structure carried along the blade (GO-1; S = { tb, gdc, cy, ce }, rheo.js): on nLines (64) streamlines, each carrying
 * an equal share of the flow (the midpoints of the stream function's range, found from the web up: the through-flow,
 * not a recirculation by the blade), lambda from steady at the inlet's shear rate there (the fully developed inflow, as
 * the 2D's), updated exactly between stations at the piece's mean shear rate over its time dx / u (the mean of 1 / u at
 * its ends). r: gapFlow1D's result. Returns { exit (lambda leaving the metering edge, flux weighted: the lines' mean),
 * lines (each line's lambda there), along (the flux-weighted lambda at each station), tMean (the mean time under the
 * blade, s) }.
 */
function struct1D(r, S, { nLines = 64, ny = 200 } = {}) {
  const { law, U, lam } = r, N = r.x.length;
  const lineAt = i => {   // at station i: each line's height's shear rate and speed
    const h = r.h[i], t0 = r.tauWeb[i], G = r.G[i], p = station1D(h, U, lam, law, t0, G, ny, true), u = p.u, dy = h / ny;
    const psi = new Float64Array(ny + 1);
    for (let j = 0; j < ny; j++) psi[j + 1] = psi[j] + dy * (u[j] + u[j + 1]) / 2;
    const out = [];
    let j = 0;
    for (let k = 0; k < nLines; k++) {
      const f = (k + 0.5) / nLines * psi[ny];
      while (j < ny - 1 && psi[j + 1] < f) j++;
      const s = psi[j + 1] > psi[j] ? Math.min(1, Math.max(0, (f - psi[j]) / (psi[j + 1] - psi[j]))) : 0, y = (j + s) * dy;
      out.push({ gd: shearRateFromStress(Math.abs(t0 - G * y), law.muRef, law.ty, law.n, law.x), u: u[j] + s * (u[j + 1] - u[j]) });
    }
    return out;
  };
  let prev = lineAt(0);
  const lamL = prev.map(q => ONED_R.rheoLamEq(q.gd, S)), along = [lamL.reduce((a, b) => a + b, 0) / nLines], time = new Float64Array(nLines);
  for (let i = 1; i < N; i++) {
    const cur = lineAt(i), dx = r.x[i] - r.x[i - 1];
    for (let k = 0; k < nLines; k++) {
      const dt = dx * (1 / Math.max(prev[k].u, 1e-30) + 1 / Math.max(cur[k].u, 1e-30)) / 2;
      lamL[k] = ONED_R.rheoLamStep(lamL[k], (prev[k].gd + cur[k].gd) / 2, dt, S); time[k] += dt;
    }
    along.push(lamL.reduce((a, b) => a + b, 0) / nLines);
    prev = cur;
  }
  return { exit: along[N - 1], lines: Array.from(lamL), along, tMean: time.reduce((a, b) => a + b, 0) / nLines };
}

/**
 * Ripple levelling on the 1D film (the Film surface tab's model, on this film and rheology): the
 * starting amplitude a0 from the gap waviness through dh/dH plus vibration, the levelling time
 * tau = 3 mu / (h^3 (gamma k^4 + rho g k^2)), the residual a yield stress leaves, and the amplitude
 * at time t: at(t). dhdH: the film's sensitivity to the gap (dimensionless).
 * With the structure (geo.struct, and lam0: lambda leaving the edge, struct1D) the slurry rebuilds at rest on the web
 * (rheo.js's rheoLevel): mu and the yield stress follow lambda(t), the ripple levels toward the residual and stays once
 * the rebuilding yield stress holds it; tau, mu and residual are then their values just after the blade (at lam0).
 */
function ripple1D(geo, h, dhdH, { dHum, vibUm, lamMm }, lam0) {
  const a0 = (Math.abs(dhdH) * dHum + vibUm) / 1e6;
  const k = 2 * Math.PI / (lamMm / 1000);
  const tRes = geo.ovenDistance / geo.U;
  if (geo.struct && lam0 != null) {
    const S = geo.struct, law = ONED_R.rheoCompile(geo.muRef, geo.ty || 0, geo.n ?? 1, geo.rheoX);
    const muOf = l => ONED_R.rheoMuStruct(0.5, l, law, S), tauOf = l => 3 * muOf(l) / (h * h * h * (geo.gamma * k ** 4 + geo.rho * geo.g * k * k));
    const resOf = l => ONED_R.rheoYieldStruct(l, law, S) / (h * (geo.gamma * k ** 3 + geo.rho * geo.g * k));
    const lv = ONED_R.rheoLevel(a0, lam0, S, tauOf, resOf);
    return { a0, tau: tauOf(lam0), residual: resOf(lam0), asymptote: lv.final(), tRes, mu: muOf(lam0), at: lv.at, lam0, tFrozen: lv.frozen(), tauRested: tauOf(1), residualRested: resOf(1) };
  }
  const mu = muEffLocal(0.5, geo.muRef, geo.ty || 0, geo.n ?? 1, geo.rheoX);   // slow, surface-tension-driven levelling
  const tau = 3 * mu / (h * h * h * (geo.gamma * k ** 4 + geo.rho * geo.g * k * k));
  const residual = (geo.ty || 0) / (h * (geo.gamma * k ** 3 + geo.rho * geo.g * k));
  const asymptote = Math.min(a0, residual);
  return { a0, tau, residual, asymptote, tRes, mu, at: t => asymptote + (a0 - asymptote) * Math.exp(-t / tau) };
}

/**
 * The static meniscus from the film up the exit face (the Contact line tab's model on the 2D's
 * face angle): the free surface climbs hc = 2 Lcap sin(phi / 2) above the film, phi = 180 - face -
 * contact angle (degrees; face measured from the web). Pinned at the edge when film + hc stays below
 * the gap, else s (m) up the face.
 */
function meniscus1D(h, H, contactDeg, faceDeg, gamma, rho, g) {
  const lcap = Math.sqrt(gamma / (rho * g));
  const phi = Math.min(Math.max(180 - faceDeg - contactDeg, 0), 180) * Math.PI / 180;
  const hc = 2 * lcap * Math.sin(phi / 2), climb = h + hc;
  if (climb <= H) return { pinned: true, s: 0, hc, lcap };
  return { pinned: false, s: (climb - H) / Math.sin(faceDeg * Math.PI / 180), hc, lcap };
}

/**
 * The same on a shaped face (prof: cfd-blade.js's profile, its face a path with corners): the contact line
 * where the face's height is the film's plus the climb the contact angle asks for against the face there,
 * 2 lcap sin(phi / 2), phi = 180 - face - contact (the face's own direction at that point), corner by corner
 * from M: it stays at a corner when the face just above is already high enough, and passes a stretch of the
 * face that is not. Returns { pinned, k (the corner it is at, or the one below it), s (m along the face from
 * M), hc (the climb there), lcap }.
 */
function meniscus1DPath(h, prof, contactDeg, gamma, rho, g) {
  const lcap = Math.sqrt(gamma / (rho * g)), F = prof.face, off = prof.faceCorners[0].thp - F.th(0);
  const hcAt = s => { const phi = Math.min(Math.max(180 - (F.th(s) + off) * 180 / Math.PI - contactDeg, 0), 180) * Math.PI / 180; return 2 * lcap * Math.sin(phi / 2); };
  const G = s => F.P(s)[1] - h - hcAt(s);
  const cs = prof.faceCorners.map(c => c.s);
  for (let k = 0; k < cs.length; k++) {
    const a = cs[k], b = k + 1 < cs.length ? cs[k + 1] : F.len, e = 1e-9 * Math.max(b - a, 1e-6);
    if (G(a + e) >= 0) return { pinned: true, k, s: a, hc: hcAt(a + e), lcap };
    if (G(b - e) < 0 && k + 1 < cs.length) continue;
    let lo = a + e, hi = b - e;
    if (G(hi) < 0) return { pinned: false, k, s: hi, hc: hcAt(hi), lcap, beyond: true };
    for (let it = 0; it < 80; it++) { const m = 0.5 * (lo + hi); if (G(m) < 0) lo = m; else hi = m; }
    return { pinned: false, k, s: 0.5 * (lo + hi), hc: hcAt(0.5 * (lo + hi)), lcap };
  }
  return { pinned: true, k: 0, s: 0, hc: hcAt(0), lcap };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { bladeShape, station1D, solveStation1D, gapFlow1D, film1D, struct1D, ripple1D, meniscus1D, meniscus1DPath };
