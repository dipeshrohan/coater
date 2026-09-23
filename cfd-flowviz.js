/*
 * cfd-flowviz.js — flow-tracking post-processing of an already-solved 2D
 * CFD field: streamlines, velocity vectors, derived scalar fields and flow
 * metrics. Pure computation, no DOM (same convention as physics.js and
 * cfd-solver.js). Nothing here calls the solver: every function reads a
 * field that was solved once, so changing a streamline or vector setting
 * never re-runs CFD.
 *
 * Field layout (matches cfd-solver.js): uniform structured Cartesian grid,
 * node (i,j) at x = i*dx, y = j*dy, row-major index k = j*nx + i. For the
 * metering-gap channel, j = 0 is the moving web, j = ny-1 the stationary
 * blade land, i = 0 the inflow (bead side), i = nx-1 the outflow at the
 * active metering edge. In this geometry the solids (blade, web) coincide
 * with the domain boundary, so "never enter a solid" is the same test as
 * "never leave the domain".
 */

/**
 * Wrap a solver result with the derived fields post-processing needs.
 * `prof1D` (optional) is the fully-developed 1D reference from
 * solveChannelNSNonNewtonian; its shear rate is exactly 0 in a truly
 * unyielded plug, which is used to cap the apparent-viscosity display
 * (mu = ty/gd formally diverges there -- see cfd-ui.js's history).
 */
function makeFlowField(r, rho, prof1D) {
  const nx = r.nx, ny = r.ny, dx = r.dx, dy = r.dy, N = nx * ny;
  const u = r.u, v = r.v;
  const speed = new Float64Array(N);
  let vmax = 0;
  for (let k = 0; k < N; k++) { speed[k] = Math.hypot(u[k], v[k]); if (speed[k] > vmax) vmax = speed[k]; }

  const ddx = (a, i, k) => i === 0 ? (a[k + 1] - a[k]) / dx : i === nx - 1 ? (a[k] - a[k - 1]) / dx : (a[k + 1] - a[k - 1]) / (2 * dx);
  const ddy = (a, j, k) => j === 0 ? (a[k + nx] - a[k]) / dy : j === ny - 1 ? (a[k] - a[k - nx]) / dy : (a[k + nx] - a[k - nx]) / (2 * dy);

  // Shear-rate magnitude, gd = sqrt(2 D:D) = sqrt(2 ux^2 + 2 vy^2 + (uy + vx)^2)
  // -- the same definition the non-Newtonian Picard loop uses.
  const shear = new Float64Array(N);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const ux = ddx(u, i, k), vy = ddy(v, j, k), uy = ddy(u, j, k), vx = ddx(v, i, k);
      shear[k] = Math.sqrt(2 * ux * ux + 2 * vy * vy + (uy + vx) * (uy + vx));
    }
  }

  let mu = null, muCap = null, hasPlug = false;
  if (r.nuField && rho) {
    mu = new Float64Array(N);
    for (let k = 0; k < N; k++) mu[k] = r.nuField[k] * rho;
    let flowMax = 0;
    for (let j = 0; j < ny; j++) {
      const plug = prof1D ? interp1(prof1D.y, prof1D.gd, j * dy) <= 1e-6 : false;
      if (plug) { hasPlug = true; continue; }
      for (let i = 0; i < nx; i++) flowMax = Math.max(flowMax, mu[j * nx + i]);
    }
    muCap = hasPlug ? flowMax * 1.3 : flowMax;
  }

  const psi = r.psi || null;
  return {
    nx, ny, dx, dy, Lx: dx * (nx - 1), Ly: dy * (ny - 1),
    u, v, speed, vmax, shear, mu, muCap, hasPlug, psi, omega: r.omega || null,
    psiWeb: psi ? psi[0] : null, psiLand: psi ? psi[(ny - 1) * nx] : null,
  };
}

function interp1(xs, ys, x) {
  const n = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n]) return ys[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
}

/** Bilinear interpolation of a nodal field at physical (x, y), clamped to the domain. */
function sampleField(f, arr, x, y) {
  let fx = x / f.dx, fy = y / f.dy;
  fx = fx < 0 ? 0 : fx > f.nx - 1 ? f.nx - 1 : fx;
  fy = fy < 0 ? 0 : fy > f.ny - 1 ? f.ny - 1 : fy;
  const i = Math.min(Math.floor(fx), f.nx - 2), j = Math.min(Math.floor(fy), f.ny - 2);
  const tx = fx - i, ty = fy - j, k = j * f.nx + i;
  return (1 - ty) * ((1 - tx) * arr[k] + tx * arr[k + 1]) + ty * ((1 - tx) * arr[k + f.nx] + tx * arr[k + f.nx + 1]);
}

/**
 * One-directional streamline from a seed. Integrated with classical RK4
 * in grid-index space (xi = x/dx, eta = y/dy) along the unit direction of
 * (u/dx, v/dy), so every step is a fixed fraction of a cell no matter how
 * stretched the cells are (the gap grid is ~6:1). A streamline is only a
 * curve, so arc-length parametrisation is exact for it -- this is not a
 * pathline and carries no time information.
 *
 * Stops at: the domain boundary (clipped exactly onto it), speed below
 * minSpeedFrac * vmax (stagnation, direction undefined), a closed loop back
 * to the seed, or maxCells of travelled length.
 */
function traceOneWay(f, x0, y0, sgn, opts) {
  const h = opts.stepCells ?? 0.2;
  const vmin = (opts.minSpeedFrac ?? 1e-3) * f.vmax;
  const maxCells = opts.maxCells ?? 4 * (f.nx + f.ny);
  const Xi = f.nx - 1, Eta = f.ny - 1;
  const pts = [[x0, y0]];
  let xi = x0 / f.dx, eta = y0 / f.dy;
  if (xi < 0 || xi > Xi || eta < 0 || eta > Eta) return { points: pts, reason: 'outside' };

  const dir = (a, b) => {
    const x = a * f.dx, y = b * f.dy;
    const u = sampleField(f, f.u, x, y), v = sampleField(f, f.v, x, y);
    if (Math.hypot(u, v) < vmin) return null;
    const gx = u / f.dx, gy = v / f.dy, m = Math.hypot(gx, gy);
    return [sgn * gx / m, sgn * gy / m];
  };

  let travelled = 0, maxAway = 0;
  const steps = Math.ceil(maxCells / h);
  for (let s = 0; s < steps; s++) {
    const k1 = dir(xi, eta); if (!k1) return { points: pts, reason: 'stagnation' };
    const k2 = dir(xi + 0.5 * h * k1[0], eta + 0.5 * h * k1[1]); if (!k2) return { points: pts, reason: 'stagnation' };
    const k3 = dir(xi + 0.5 * h * k2[0], eta + 0.5 * h * k2[1]); if (!k3) return { points: pts, reason: 'stagnation' };
    const k4 = dir(xi + h * k3[0], eta + h * k3[1]); if (!k4) return { points: pts, reason: 'stagnation' };
    let nxi = xi + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    let neta = eta + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);

    if (nxi < 0 || nxi > Xi || neta < 0 || neta > Eta) {
      // clip the last step exactly onto the boundary it crossed
      let t = 1;
      const ddx = nxi - xi, ddy = neta - eta;
      if (nxi < 0) t = Math.min(t, -xi / ddx);
      if (nxi > Xi) t = Math.min(t, (Xi - xi) / ddx);
      if (neta < 0) t = Math.min(t, -eta / ddy);
      if (neta > Eta) t = Math.min(t, (Eta - eta) / ddy);
      pts.push([(xi + t * ddx) * f.dx, (eta + t * ddy) * f.dy]);
      return { points: pts, reason: 'boundary' };
    }
    xi = nxi; eta = neta; travelled += h;
    pts.push([xi * f.dx, eta * f.dy]);

    const away = Math.hypot(xi - x0 / f.dx, eta - y0 / f.dy);
    maxAway = Math.max(maxAway, away);
    if (maxAway > 2 && travelled > 8 && away < 0.6) { pts.push([x0, y0]); return { points: pts, reason: 'closed' }; }
  }
  return { points: pts, reason: 'maxLength' };
}

/**
 * Streamline through a seed. Points are always returned ordered in the
 * flow direction (a backward trace is reversed), so direction arrows drawn
 * along them point downstream whichever way it was integrated.
 */
function traceStreamline(f, seed, opts = {}) {
  const d = opts.direction || 'forward';
  if (d === 'forward') { const a = traceOneWay(f, seed[0], seed[1], 1, opts); return { seed, points: a.points, startReason: 'seed', endReason: a.reason }; }
  if (d === 'backward') { const b = traceOneWay(f, seed[0], seed[1], -1, opts); return { seed, points: b.points.slice().reverse(), startReason: b.reason, endReason: 'seed' }; }
  const b = traceOneWay(f, seed[0], seed[1], -1, opts);
  if (b.reason === 'closed') return { seed, points: b.points.slice().reverse(), startReason: 'closed', endReason: 'closed' };
  const a = traceOneWay(f, seed[0], seed[1], 1, opts);
  return { seed, points: b.points.slice(1).reverse().concat(a.points), startReason: b.reason, endReason: a.reason };
}

/**
 * Interior streamfunction extrema whose value lies outside the range the
 * through-flow carries (between the web's and the land's psi) -- i.e. the
 * centres of closed recirculating eddies. Strongest first.
 */
function findEddyCentres(f) {
  if (!f.psi) return [];
  const lo = Math.min(f.psiWeb, f.psiLand), hi = Math.max(f.psiWeb, f.psiLand);
  let scale = 0;
  for (let k = 0; k < f.psi.length; k++) scale = Math.max(scale, Math.abs(f.psi[k]));
  const tol = 1e-3 * (scale || 1);
  const out = [];
  for (let j = 1; j < f.ny - 1; j++) {
    for (let i = 1; i < f.nx - 1; i++) {
      const k = j * f.nx + i, p = f.psi[k];
      if (p >= lo - tol && p <= hi + tol) continue;
      let isMin = true, isMax = true;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const q = f.psi[k + dj * f.nx + di];
        if (q <= p) isMin = false;
        if (q >= p) isMax = false;
      }
      if ((isMin && p < lo) || (isMax && p > hi)) out.push({ x: i * f.dx, y: j * f.dy, i, j, psi: p, bound: p < lo ? lo : hi });
    }
  }
  return out.sort((a, b) => Math.abs(b.psi - b.bound) - Math.abs(a.psi - a.bound));
}

/**
 * Automatic seeds, placed where they're physically useful rather than on a
 * uniform grid:
 *  - through-flow seeds at equal streamfunction spacing (equal flux between
 *    neighbouring lines -- the standard CFD seeding, so line crowding reads
 *    as local speed), on the inflow line for forward tracing, the outflow
 *    line for backward, mid-channel for both;
 *  - if any recirculating eddy exists, seeds between its centre and its
 *    edge, so the closed loops are drawn.
 * Falls back to uniform spacing in y if psi isn't monotone along the seed
 * line (reverse flow there), where equal-psi placement is ill-defined.
 */
function autoSeeds(f, n, direction) {
  const seeds = [];
  const xs = direction === 'forward' ? 0 : direction === 'backward' ? f.Lx : f.Lx / 2;
  const i = Math.round(xs / f.dx);
  const col = [];
  for (let j = 0; j < f.ny; j++) col.push(f.psi ? f.psi[j * f.nx + i] : j);
  let mono = !!f.psi && f.psiLand !== f.psiWeb;
  const sgn = Math.sign(col[f.ny - 1] - col[0]);
  for (let j = 1; mono && j < f.ny; j++) if (Math.sign(col[j] - col[j - 1]) !== sgn && col[j] !== col[j - 1]) mono = false;

  for (let m = 1; m <= n; m++) {
    const frac = m / (n + 1);
    if (mono) {
      const target = col[0] + (col[f.ny - 1] - col[0]) * frac;
      for (let j = 1; j < f.ny; j++) {
        if ((col[j] - target) * (col[j - 1] - target) <= 0 && col[j] !== col[j - 1]) {
          const t = (target - col[j - 1]) / (col[j] - col[j - 1]);
          seeds.push([i * f.dx, (j - 1 + t) * f.dy]);
          break;
        }
      }
    } else {
      seeds.push([i * f.dx, frac * f.Ly]);
    }
  }

  for (const c of findEddyCentres(f).slice(0, 3)) {
    // walk up from the centre until psi reaches the eddy's bounding value
    let jEdge = c.j;
    while (jEdge < f.ny - 1 && (f.psi[jEdge * f.nx + c.i] - c.bound) * (c.psi - c.bound) > 0) jEdge++;
    for (const fr of [0.2, 0.45, 0.7]) seeds.push([c.x, c.y + fr * (jEdge - c.j) * f.dy]);
  }
  return seeds;
}

/** Velocity vectors on a regular lattice inset from the walls (nCols x nRows). */
function sampleVectors(f, nCols, nRows) {
  const out = [];
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const x = (c + 0.5) * f.Lx / nCols, y = (r + 0.5) * f.Ly / nRows;
      const u = sampleField(f, f.u, x, y), v = sampleField(f, f.v, x, y);
      out.push({ x, y, u, v, speed: Math.hypot(u, v) });
    }
  }
  return out;
}

/**
 * Flow metrics with an unambiguous definition in this geometry. Anything
 * whose definition would be a judgement call is left out (e.g. "velocity
 * at the active metering edge" -- the edge is a no-slip solid corner, so
 * it's 0 by definition and says nothing).
 */
function flowMetrics(f) {
  const { nx, ny, dx, dy } = f;
  const w = (i, j) => (i === 0 || i === nx - 1 ? 0.5 : 1) * (j === 0 || j === ny - 1 ? 0.5 : 1) * dx * dy;

  let area = 0, speedInt = 0, reverseArea = 0, recircArea = 0;
  let vmaxLoc = null, vmax = -1, vminInt = Infinity, vminLoc = null, gdMax = -1, gdMaxLoc = null;
  const lo = f.psi ? Math.min(f.psiWeb, f.psiLand) : 0, hi = f.psi ? Math.max(f.psiWeb, f.psiLand) : 0;
  let psiScale = 0;
  if (f.psi) for (let k = 0; k < f.psi.length; k++) psiScale = Math.max(psiScale, Math.abs(f.psi[k]));
  const tol = 1e-3 * (psiScale || 1);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, a = w(i, j), s = f.speed[k];
      area += a; speedInt += a * s;
      if (s > vmax) { vmax = s; vmaxLoc = [i * dx, j * dy]; }
      if (f.shear[k] > gdMax) { gdMax = f.shear[k]; gdMaxLoc = [i * dx, j * dy]; }
      const interior = i > 0 && i < nx - 1 && j > 0 && j < ny - 1;
      if (interior) {
        if (s < vminInt) { vminInt = s; vminLoc = [i * dx, j * dy]; }
        if (f.u[k] < 0) reverseArea += a;
        if (f.psi && (f.psi[k] < lo - tol || f.psi[k] > hi + tol)) recircArea += a;
      }
    }
  }

  // Stagnation: connected interior regions where |V| < 1% of max, each
  // reported by its lowest-speed point.
  const thresh = 0.01 * f.vmax, seen = new Uint8Array(nx * ny), stagnation = [];
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k0 = j * nx + i;
      if (seen[k0] || f.speed[k0] >= thresh) continue;
      const stack = [k0]; seen[k0] = 1;
      let best = k0;
      while (stack.length) {
        const k = stack.pop();
        if (f.speed[k] < f.speed[best]) best = k;
        const ci = k % nx, cj = (k - ci) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = ci + di, jj = cj + dj;
          if (ii < 1 || ii > nx - 2 || jj < 1 || jj > ny - 2) continue;
          const kk = jj * nx + ii;
          if (!seen[kk] && f.speed[kk] < thresh) { seen[kk] = 1; stack.push(kk); }
        }
      }
      const bi = best % nx;
      stagnation.push({ x: bi * dx, y: ((best - bi) / nx) * dy, speed: f.speed[best] });
    }
  }

  const Q = f.psi ? Math.abs(f.psiLand - f.psiWeb) : null;
  return {
    area, vmax, vmaxLoc, meanSpeed: speedInt / area, vminInterior: vminInt, vminLoc,
    Q, meanGapVelocity: Q != null ? Q / f.Ly : null,
    reverseFraction: reverseArea / area, recircArea, recircFraction: recircArea / area,
    stagnation, gdMax, gdMaxLoc,
    eddies: findEddyCentres(f),
  };
}

/** Largest deviation of psi along a traced line from its seed value, as a fraction of the psi range -- the streamline correctness check (psi is exactly constant along a true streamline of a steady 2D incompressible flow). */
function streamlinePsiDeviation(f, line) {
  if (!f.psi) return null;
  const p0 = sampleField(f, f.psi, line.seed[0], line.seed[1]);
  let range = 0;
  for (let k = 0; k < f.psi.length; k++) range = Math.max(range, Math.abs(f.psi[k]));
  let dev = 0;
  for (const [x, y] of line.points) dev = Math.max(dev, Math.abs(sampleField(f, f.psi, x, y) - p0));
  return dev / (range || 1);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeFlowField, sampleField, traceStreamline, autoSeeds, sampleVectors, flowMetrics, findEddyCentres, streamlinePsiDeviation };
}
