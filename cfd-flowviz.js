/*
 * cfd-flowviz.js — flow-tracking post-processing of an already-solved 2D
 * CFD field: streamlines, velocity vectors, derived scalar fields and flow
 * metrics. Pure computation, no DOM (same convention as physics.js and
 * cfd-solver.js). Nothing here calls the solver: every function reads a
 * field that was solved once, so changing a streamline or vector setting
 * never re-runs CFD.
 *
 * Field layout (matches cfd-gap-solver.js): a boundary-fitted grid, node
 * (i, j) at x = i*dx, y = j/(ny-1) * h(x_i), row-major index k = j*nx + i,
 * where h(x) is the blade's height above the web (constant for the flat
 * land, falling toward the metering edge for the round entry). j = 0 is
 * the moving web, j = ny-1 the stationary blade surface, i = 0 the inflow
 * (bead side), i = nx-1 the outflow at the active metering edge. The
 * solids (blade, web) coincide with the grid's top and bottom rows, so
 * "never enter a solid" is the same test as "never leave the grid".
 * Everything below works in grid-index space (xi = x/dx, et = y/h(x) *
 * (ny-1)) and converts to metres only for output.
 */

/**
 * Wrap a solver result with the derived fields post-processing needs.
 * opts.rho (density) and opts.ty (yield stress, Pa): where the stress
 * mu*gd is below ty the fluid is unyielded -- the apparent viscosity
 * there is the solver's regularized (large, finite) value, so the display
 * caps it instead of letting it swamp the colour scale.
 */
function makeFlowField(r, opts = {}) {
  const nx = r.nx, ny = r.ny, dx = r.dx, N = nx * ny;
  const u = r.u, v = r.v;
  const h = r.h ? Float64Array.from(r.h) : new Float64Array(nx).fill(r.dy * (ny - 1));
  const hx = r.hx ? Float64Array.from(r.hx) : new Float64Array(nx);
  let Ly = 0; for (let i = 0; i < nx; i++) Ly = Math.max(Ly, h[i]);
  const flat = h.every(x => x === h[0]);
  const speed = new Float64Array(N);
  let vmax = 0;
  for (let k = 0; k < N; k++) { speed[k] = Math.hypot(u[k], v[k]); if (speed[k] > vmax) vmax = speed[k]; }

  let shear = r.gd || null;
  if (!shear) {
    // Cartesian grid (cavity check): gd = sqrt(2 ux^2 + 2 vy^2 + (uy + vx)^2)
    const dy = h[0] / (ny - 1);
    const ddx = (a, i, k) => i === 0 ? (a[k + 1] - a[k]) / dx : i === nx - 1 ? (a[k] - a[k - 1]) / dx : (a[k + 1] - a[k - 1]) / (2 * dx);
    const ddy = (a, j, k) => j === 0 ? (a[k + nx] - a[k]) / dy : j === ny - 1 ? (a[k] - a[k - nx]) / dy : (a[k + nx] - a[k - nx]) / (2 * dy);
    shear = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, ux = ddx(u, i, k), vy = ddy(v, j, k), uy = ddy(u, j, k), vx = ddx(v, i, k);
      shear[k] = Math.sqrt(2 * ux * ux + 2 * vy * vy + (uy + vx) * (uy + vx));
    }
  }

  const mu = r.mu || null;
  let muCap = null, hasPlug = false, unyielded = null;
  if (mu) {
    unyielded = new Uint8Array(N);
    let flowMax = 0;
    for (let k = 0; k < N; k++) {
      if (opts.ty > 0 && mu[k] * shear[k] < opts.ty) { unyielded[k] = 1; hasPlug = true; continue; }
      flowMax = Math.max(flowMax, mu[k]);
    }
    muCap = hasPlug ? flowMax * 1.3 : flowMax;
  }

  const psi = r.psi || null;
  return {
    nx, ny, dx, dy: flat ? h[0] / (ny - 1) : null, h, hx, flat, Lx: dx * (nx - 1), Ly, Hedge: h[nx - 1],
    u, v, speed, vmax, shear, mu, muCap, hasPlug, unyielded, psi, omega: r.omega || null, p: r.p || null,
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

/** Blade height (or its slope) at fractional column index xi, linear between columns. */
function colInterp(arr, xi) {
  const n = arr.length - 1;
  if (xi <= 0) return arr[0];
  if (xi >= n) return arr[n];
  const i = Math.floor(xi), t = xi - i;
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}
/** Blade height above the web at x (m). */
const bladeHeightAt = (f, x) => colInterp(f.h, x / f.dx);
const toIndex = (f, x, y) => { const xi = x / f.dx; return [xi, y / colInterp(f.h, xi) * (f.ny - 1)]; };
const fromIndex = (f, xi, et) => [xi * f.dx, et / (f.ny - 1) * colInterp(f.h, xi)];
const nodeY = (f, i, j) => j / (f.ny - 1) * f.h[i];

function sampleIdx(f, arr, fx, fy) {
  fx = fx < 0 ? 0 : fx > f.nx - 1 ? f.nx - 1 : fx;
  fy = fy < 0 ? 0 : fy > f.ny - 1 ? f.ny - 1 : fy;
  const i = Math.min(Math.floor(fx), f.nx - 2), j = Math.min(Math.floor(fy), f.ny - 2);
  const tx = fx - i, ty = fy - j, k = j * f.nx + i;
  return (1 - ty) * ((1 - tx) * arr[k] + tx * arr[k + 1]) + ty * ((1 - tx) * arr[k + f.nx] + tx * arr[k + f.nx + 1]);
}

/** Bilinear interpolation (in grid-index space) of a nodal field at physical (x, y), clamped to the domain. */
function sampleField(f, arr, x, y) {
  const [fx, fy] = toIndex(f, x, y);
  return sampleIdx(f, arr, fx, fy);
}

/**
 * One-directional streamline from a seed. Integrated with classical RK4
 * in grid-index space (xi = x/dx, et = y/h(x) * (ny-1)) along the unit
 * direction of the velocity mapped into that space,
 *   dxi/dt = u/dx,   det/dt = (ny-1) (v - eta h'(x) u) / h(x),
 * so every step is a fixed fraction of a cell however stretched the cells
 * are, and the blade surface is exactly et = ny-1. A streamline is only a
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
  let [xi, eta] = toIndex(f, x0, y0);
  const xi0 = xi, eta0 = eta;
  if (xi < 0 || xi > Xi || eta < -1e-9 || eta > Eta + 1e-9) return { points: pts, reason: 'outside' };

  const dir = (a, b) => {
    const u = sampleIdx(f, f.u, a, b), v = sampleIdx(f, f.v, a, b);
    if (Math.hypot(u, v) < vmin) return null;
    const H = colInterp(f.h, a), Hp = colInterp(f.hx, a);
    const gx = u / f.dx, gy = (f.ny - 1) * (v - (b / (f.ny - 1)) * Hp * u) / H, m = Math.hypot(gx, gy);
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
      pts.push(fromIndex(f, xi + t * ddx, eta + t * ddy));
      return { points: pts, reason: 'boundary' };
    }
    xi = nxi; eta = neta; travelled += h;
    pts.push(fromIndex(f, xi, eta));

    const away = Math.hypot(xi - xi0, eta - eta0);
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
 * through-flow carries (between the web's and the blade's psi) -- i.e. the
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
      if ((isMin && p < lo) || (isMax && p > hi)) out.push({ x: i * f.dx, y: nodeY(f, i, j), i, j, psi: p, bound: p < lo ? lo : hi });
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
 *    line for backward, mid-channel for both. Each seed is the first
 *    crossing of its psi level going up from the web, so seeds stay in the
 *    through-flow even where the column also cuts a recirculation.
 *  - where the inflow line crosses returning flow (psi rising past the
 *    blade's value -- fluid that enters and turns back toward the pool),
 *    a few seeds at levels spread across that returning flux;
 *  - if any closed eddy exists, seeds between its centre and its edge.
 * Falls back to uniform spacing in y if the column's psi never spans the
 * through-flow range.
 */
function autoSeeds(f, n, direction) {
  const seeds = [];
  const xs = direction === 'forward' ? 0 : direction === 'backward' ? f.Lx : f.Lx / 2;
  const i = Math.round(xs / f.dx);
  const col = [];
  for (let j = 0; j < f.ny; j++) col.push(f.psi ? f.psi[j * f.nx + i] : j);
  const firstCrossing = target => {
    for (let j = 1; j < f.ny; j++) {
      if ((col[j] - target) * (col[j - 1] - target) <= 0 && col[j] !== col[j - 1]) {
        const t = (target - col[j - 1]) / (col[j] - col[j - 1]);
        return [i * f.dx, (j - 1 + t) / (f.ny - 1) * f.h[i]];
      }
    }
    return null;
  };
  const p0 = col[0], p1 = col[f.ny - 1];
  for (let m = 1; m <= n; m++) {
    const frac = m / (n + 1);
    const s = f.psi && p1 !== p0 ? firstCrossing(p0 + (p1 - p0) * frac) : null;
    seeds.push(s || [i * f.dx, frac * f.h[i]]);
  }
  if (f.psi && p1 !== p0) {
    // returning flow on this column: psi overshoots the blade's value
    let peak = p1;
    for (const p of col) if ((p - p1) * Math.sign(p1 - p0) > (peak - p1) * Math.sign(p1 - p0)) peak = p;
    if (Math.abs(peak - p1) > 1e-3 * Math.abs(p1 - p0)) {
      const k = Math.max(2, Math.round(n / 4));
      for (let m = 1; m <= k; m++) { const s = firstCrossing(p1 + (peak - p1) * m / (k + 1)); if (s) seeds.push(s); }
    }
  }

  for (const c of findEddyCentres(f).slice(0, 3)) {
    // walk up from the centre until psi reaches the eddy's bounding value
    let jEdge = c.j;
    while (jEdge < f.ny - 1 && (f.psi[jEdge * f.nx + c.i] - c.bound) * (c.psi - c.bound) > 0) jEdge++;
    for (const fr of [0.2, 0.45, 0.7]) seeds.push([c.x, (c.j + fr * (jEdge - c.j)) / (f.ny - 1) * f.h[c.i]]);
  }
  return seeds;
}

/** Velocity vectors on a regular lattice (nCols x nRows over the plot's x and y range), keeping only points inside the fluid. */
function sampleVectors(f, nCols, nRows) {
  const out = [];
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const x = (c + 0.5) * f.Lx / nCols, y = (r + 0.5) * f.Ly / nRows;
      if (y > bladeHeightAt(f, x) * (1 - 0.25 / nRows)) continue;
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
  const { nx, ny, dx } = f;
  const w = (i, j) => (i === 0 || i === nx - 1 ? 0.5 : 1) * (j === 0 || j === ny - 1 ? 0.5 : 1) * dx * f.h[i] / (ny - 1);
  const at = (i, j) => [i * dx, nodeY(f, i, j)];

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
      if (s > vmax) { vmax = s; vmaxLoc = at(i, j); }
      if (f.shear[k] > gdMax) { gdMax = f.shear[k]; gdMaxLoc = at(i, j); }
      const interior = i > 0 && i < nx - 1 && j > 0 && j < ny - 1;
      if (interior) {
        if (s < vminInt) { vminInt = s; vminLoc = at(i, j); }
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
      const bi = best % nx, [sx, sy] = at(bi, (best - bi) / nx);
      stagnation.push({ x: sx, y: sy, speed: f.speed[best] });
    }
  }

  const Q = f.psi ? Math.abs(f.psiLand - f.psiWeb) : null;
  return {
    area, vmax, vmaxLoc, meanSpeed: speedInt / area, vminInterior: vminInt, vminLoc,
    Q, meanGapVelocity: Q != null ? Q / f.Hedge : null,
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
  module.exports = { makeFlowField, sampleField, bladeHeightAt, traceStreamline, autoSeeds, sampleVectors, flowMetrics, findEddyCentres, streamlinePsiDeviation };
}
