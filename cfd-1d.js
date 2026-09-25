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

/** Blade height above the web over the blade's part of the domain, x = 0 at the inlet, x = Lx at the metering edge. */
function bladeShape(o) {
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
  const dudy = y => { const t = tau0 - G * y; return Math.sign(t) * shearRateFromStress(Math.abs(t), law.muRef, law.ty, law.n); };
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
  const muN = muEffLocal(Math.abs(U) / h + 1e-12, law.muRef, law.ty, law.n);
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
  const o = { geometry: geo.shape, H: geo.H, L: geo.L, R: geo.R, Xup: geo.Xup };
  const shape = bladeShape(o), Lx = shape.Lx;
  const law = { muRef: geo.muRef, ty: geo.ty || 0, n: geo.n ?? 1 };
  const U = geo.U, lam = geo.webSlip || 0;
  // stations: denser near the edge (x = Lx), where the gap is smallest and the pressure falls fastest
  const xs = Array.from({ length: nx + 1 }, (_, i) => Lx * (1 - Math.pow(1 - i / nx, 1.6)));
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
  const muRep = muEffLocal(U / geo.H, law.muRef, law.ty, law.n);
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
  const mu = muEffLocal(geo.U * geo.U / q, geo.muRef, geo.ty || 0, geo.n ?? 1);   // at the film's own shear scale U / h_inf, as the 2D's film
  const r = solveDownstreamFilm({ H0: geo.H, Q: q, U: geo.U, mu, gamma: geo.gamma, rho: geo.rho, g: geo.g, Lx: geo.ovenDistance, nx: 200, maxSteps: 150000, tol: 1e-8 });
  return { ...r, mu };
}

/**
 * Ripple levelling on the 1D film (the Film surface tab's model, on this film and rheology): the
 * starting amplitude a0 from the gap waviness through dh/dH plus vibration, the levelling time
 * tau = 3 mu / (h^3 (gamma k^4 + rho g k^2)), the residual a yield stress leaves, and the amplitude
 * at time t: at(t). dhdH: the film's sensitivity to the gap (dimensionless).
 */
function ripple1D(geo, h, dhdH, { dHum, vibUm, lamMm }) {
  const a0 = (Math.abs(dhdH) * dHum + vibUm) / 1e6;
  const k = 2 * Math.PI / (lamMm / 1000);
  const mu = muEffLocal(0.5, geo.muRef, geo.ty || 0, geo.n ?? 1);   // slow, surface-tension-driven levelling
  const tau = 3 * mu / (h * h * h * (geo.gamma * k ** 4 + geo.rho * geo.g * k * k));
  const residual = (geo.ty || 0) / (h * (geo.gamma * k ** 3 + geo.rho * geo.g * k));
  const asymptote = Math.min(a0, residual);
  const tRes = geo.ovenDistance / geo.U;
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

if (typeof module !== 'undefined' && module.exports) module.exports = { bladeShape, station1D, solveStation1D, gapFlow1D, film1D, ripple1D, meniscus1D };
