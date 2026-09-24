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
 *
 * Curvilinear grids (r.grid === 'curvilinear', from cfd-fem.js's
 * coaterGrid): the same (i, j) layout, but every node has its own
 * coordinates gx, gy -- the finite-element mesh of the gap, the exit face
 * and the free-surface film. Its top row is the blade, the face up to the
 * contact line, then the free surface. Index space works the same way;
 * positions are bilinear within each grid cell, and a physical point is
 * located by inverting that map in the cell that contains it.
 */

/**
 * Wrap a solver result with the derived fields post-processing needs.
 * opts.rho (density) and opts.ty (yield stress, Pa): where the stress
 * mu*gd is below ty the fluid is unyielded -- the apparent viscosity
 * there is the solver's regularized (large, finite) value, so the display
 * caps it instead of letting it swamp the colour scale.
 */
function makeFlowField(r, opts = {}) {
  const curv = r.grid === 'curvilinear';
  const nx = r.nx, ny = r.ny, N = nx * ny;
  const u = r.u, v = r.v;
  const speed = new Float64Array(N);
  let vmax = 0;
  for (let k = 0; k < N; k++) { speed[k] = Math.hypot(u[k], v[k]); if (speed[k] > vmax) vmax = speed[k]; }

  let grid;
  if (curv) grid = curvilinearGrid(r);
  else {
    const dx = r.dx;
    const h = r.h ? Float64Array.from(r.h) : new Float64Array(nx).fill(r.dy * (ny - 1));
    const hx = r.hx ? Float64Array.from(r.hx) : new Float64Array(nx);
    let Ly = 0; for (let i = 0; i < nx; i++) Ly = Math.max(Ly, h[i]);
    const flat = h.every(x => x === h[0]);
    grid = { curv: false, dx, dy: flat ? h[0] / (ny - 1) : null, h, hx, flat, Lx: dx * (nx - 1), Ly, Hedge: h[nx - 1] };
    const nodeArea = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) nodeArea[j * nx + i] = (i === 0 || i === nx - 1 ? 0.5 : 1) * (j === 0 || j === ny - 1 ? 0.5 : 1) * dx * h[i] / (ny - 1);
    grid.nodeArea = nodeArea;
  }

  let shear = r.gd || null;
  if (!shear) {
    // Cartesian grid (cavity check): gd = sqrt(2 ux^2 + 2 vy^2 + (uy + vx)^2)
    const dx = grid.dx, dy = grid.h[0] / (ny - 1);
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

  // principal strain rates (eigenvalues of D = tau / (2 mu); strain1 >= strain2, stretching and
  // compression; strainDir the stretching direction, rad from x) and viscous dissipation tau:D = mu gd^2
  let strain1 = null, strain2 = null, strainDir = null, dissipation = null;
  if (r.tauXY && r.tauXX && mu) {
    strain1 = new Float64Array(N); strain2 = new Float64Array(N); strainDir = new Float64Array(N); dissipation = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const ux = r.tauXX[k] / (2 * mu[k]), vy = (r.tauYY ? r.tauYY[k] : -r.tauXX[k]) / (2 * mu[k]), sxy = r.tauXY[k] / (2 * mu[k]);
      const m = 0.5 * (ux + vy), rr = Math.hypot(0.5 * (ux - vy), sxy);
      strain1[k] = m + rr; strain2[k] = m - rr; strainDir[k] = 0.5 * Math.atan2(2 * sxy, ux - vy);
      dissipation[k] = mu[k] * shear[k] * shear[k];
    }
  }

  const psi = r.psi || null;
  return {
    nx, ny, ...grid,
    u, v, speed, vmax, shear, mu, muCap, hasPlug, unyielded, psi, omega: r.omega || null, p: r.p || null,
    strain1, strain2, strainDir, dissipation,
    psiWeb: psi ? psi[0] : null, psiLand: psi ? psi[(ny - 1) * nx] : null,
  };
}

/**
 * Grid API of a curvilinear field: node coordinates, cell-wise bilinear
 * positions, point location (bins over the bounding box, then Newton
 * inversion of the containing cell's bilinear map), node (dual) areas.
 */
function curvilinearGrid(r) {
  const nx = r.nx, ny = r.ny, gx = r.gx, gy = r.gy, N = nx * ny, ncx = nx - 1, ncy = ny - 1;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < N; k++) { x0 = Math.min(x0, gx[k]); x1 = Math.max(x1, gx[k]); y0 = Math.min(y0, gy[k]); y1 = Math.max(y1, gy[k]); }
  const corner = (i, j) => j * nx + i;
  // cell bilinear coefficients: P(s, t) = a + b s + c t + d s t
  const nc = ncx * ncy, cf = new Float64Array(nc * 8), bb = new Float64Array(nc * 4), nodeArea = new Float64Array(N);
  for (let j = 0; j < ncy; j++) for (let i = 0; i < ncx; i++) {
    const c = j * ncx + i, k00 = corner(i, j), k10 = corner(i + 1, j), k01 = corner(i, j + 1), k11 = corner(i + 1, j + 1);
    cf[c * 8] = gx[k00]; cf[c * 8 + 1] = gy[k00];
    cf[c * 8 + 2] = gx[k10] - gx[k00]; cf[c * 8 + 3] = gy[k10] - gy[k00];
    cf[c * 8 + 4] = gx[k01] - gx[k00]; cf[c * 8 + 5] = gy[k01] - gy[k00];
    cf[c * 8 + 6] = gx[k11] - gx[k10] - gx[k01] + gx[k00]; cf[c * 8 + 7] = gy[k11] - gy[k10] - gy[k01] + gy[k00];
    bb[c * 4] = Math.min(gx[k00], gx[k10], gx[k01], gx[k11]); bb[c * 4 + 1] = Math.max(gx[k00], gx[k10], gx[k01], gx[k11]);
    bb[c * 4 + 2] = Math.min(gy[k00], gy[k10], gy[k01], gy[k11]); bb[c * 4 + 3] = Math.max(gy[k00], gy[k10], gy[k01], gy[k11]);
    const area = 0.5 * Math.abs((gx[k11] - gx[k00]) * (gy[k01] - gy[k10]) - (gy[k11] - gy[k00]) * (gx[k01] - gx[k10]));
    for (const k of [k00, k10, k01, k11]) nodeArea[k] += 0.25 * area;
  }
  const nbx = Math.max(8, Math.min(400, Math.round(2 * Math.sqrt(nc) * Math.sqrt((x1 - x0) / (y1 - y0 || 1)))));
  const nby = Math.max(4, Math.min(200, Math.round(nbx * (y1 - y0) / (x1 - x0 || 1))));
  const bins = Array.from({ length: nbx * nby }, () => []);
  const bx = x => Math.min(nbx - 1, Math.max(0, Math.floor((x - x0) / (x1 - x0) * nbx)));
  const by = y => Math.min(nby - 1, Math.max(0, Math.floor((y - y0) / (y1 - y0) * nby)));
  for (let c = 0; c < nc; c++) for (let q = by(bb[c * 4 + 2]); q <= by(bb[c * 4 + 3]); q++) for (let p = bx(bb[c * 4]); p <= bx(bb[c * 4 + 1]); p++) bins[q * nbx + p].push(c);
  const tolBox = 1e-9 * Math.max(x1 - x0, y1 - y0);
  const inCell = (c, x, y) => {
    if (x < bb[c * 4] - tolBox || x > bb[c * 4 + 1] + tolBox || y < bb[c * 4 + 2] - tolBox || y > bb[c * 4 + 3] + tolBox) return null;
    const o = c * 8;
    let s = 0.5, t = 0.5;
    for (let it = 0; it < 12; it++) {
      const Fx = cf[o] + cf[o + 2] * s + cf[o + 4] * t + cf[o + 6] * s * t - x, Fy = cf[o + 1] + cf[o + 3] * s + cf[o + 5] * t + cf[o + 7] * s * t - y;
      const a11 = cf[o + 2] + cf[o + 6] * t, a12 = cf[o + 4] + cf[o + 6] * s, a21 = cf[o + 3] + cf[o + 7] * t, a22 = cf[o + 5] + cf[o + 7] * s;
      const det = a11 * a22 - a12 * a21;
      if (!(Math.abs(det) > 0)) return null;
      const ds = (a22 * Fx - a12 * Fy) / det, dt = (a11 * Fy - a21 * Fx) / det;
      s -= ds; t -= dt;
      if (Math.abs(ds) + Math.abs(dt) < 1e-12) break;
    }
    const e = 1e-7;
    if (!(s > -e && s < 1 + e && t > -e && t < 1 + e)) return null;
    return [Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, t))];
  };
  let last = 0;
  const locate = (x, y) => {
    let st = inCell(last, x, y);
    if (st) return [last % ncx + st[0], Math.floor(last / ncx) + st[1]];
    if (x < x0 - tolBox || x > x1 + tolBox || y < y0 - tolBox || y > y1 + tolBox) return null;
    for (const c of bins[by(y) * nbx + bx(x)]) {
      st = inCell(c, x, y);
      if (st) { last = c; return [c % ncx + st[0], Math.floor(c / ncx) + st[1]]; }
    }
    return null;
  };
  const cellOf = (xi, et) => {
    const i = Math.min(ncx - 1, Math.max(0, Math.floor(xi))), j = Math.min(ncy - 1, Math.max(0, Math.floor(et)));
    return [j * ncx + i, xi - i, et - j];
  };
  const pos = (xi, et) => {
    const [c, s, t] = cellOf(xi, et), o = c * 8;
    return [cf[o] + cf[o + 2] * s + cf[o + 4] * t + cf[o + 6] * s * t, cf[o + 1] + cf[o + 3] * s + cf[o + 5] * t + cf[o + 7] * s * t];
  };
  // velocity mapped into index space: (dxi, det)/dt = J^-1 (u, v) of the cell's bilinear map
  const idxVel = (xi, et, u, v) => {
    const [c, s, t] = cellOf(xi, et), o = c * 8;
    const a11 = cf[o + 2] + cf[o + 6] * t, a12 = cf[o + 4] + cf[o + 6] * s, a21 = cf[o + 3] + cf[o + 7] * t, a22 = cf[o + 5] + cf[o + 7] * s;
    const det = a11 * a22 - a12 * a21;
    return [(a22 * u - a12 * v) / det, (a11 * v - a21 * u) / det];
  };
  // nearest node, for sampling points that land a hair outside the mesh (clipped line ends)
  const nearest = (x, y) => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < N; k++) { const d = (gx[k] - x) ** 2 + (gy[k] - y) ** 2; if (d < bd) { bd = d; best = k; } }
    return [best % nx, Math.floor(best / nx)];
  };
  // nodes within 0.3 H of the metering edge corner: stresses and pressure are singular there
  const cornerZone = new Uint8Array(N);
  if (r.xe != null) for (let k = 0; k < N; k++) cornerZone[k] = Math.hypot(gx[k] - r.xe, gy[k] - r.H) < 0.3 * r.H ? 1 : 0;
  const grid = {
    curv: true, gx, gy, Lx: x1, Ly: y1, Hedge: r.H, nodeArea, locate, pos, idxVel, nearest, cornerZone,
    iCorner: r.iCorner, iCL: r.iCL, xe: r.xe, faceDeg: r.faceDeg,
  };
  if (nx % 2 && ny % 2 && nx > 2 && ny > 2) {
    // Quadratic (Q2) finite-element mesh: every 3 x 3 block of nodes is one
    // element, and the solution and the geometry are biquadratic in it --
    // interpolate with the elements' own shape functions (consistent with
    // the stream function, which was integrated from that velocity), and
    // refine point location by Newton on that map.
    const nEx = (nx - 1) / 2, nEy = (ny - 1) / 2;
    const q2 = x => [x * (x - 1) / 2, 1 - x * x, x * (x + 1) / 2], dq2 = x => [x - 0.5, -2 * x, x + 0.5];
    const elemOf = (xi, et) => {
      const ex = Math.min(nEx - 1, Math.max(0, Math.floor(xi / 2))), ey = Math.min(nEy - 1, Math.max(0, Math.floor(et / 2)));
      return [ex, ey, xi - 2 * ex - 1, et - 2 * ey - 1];
    };
    const interp = (arr, xi, et) => {
      const [ex, ey, a, b] = elemOf(xi, et), A = q2(a), B = q2(b);
      let v = 0;
      for (let jb = 0; jb < 3; jb++) { const row = (2 * ey + jb) * nx + 2 * ex; for (let ia = 0; ia < 3; ia++) v += A[ia] * B[jb] * arr[row + ia]; }
      return v;
    };
    const jac = (ex, ey, a, b) => {
      const A = q2(a), B = q2(b), dA = dq2(a), dB = dq2(b);
      let x = 0, y = 0, xa = 0, xb = 0, ya = 0, yb = 0;
      for (let jb = 0; jb < 3; jb++) for (let ia = 0; ia < 3; ia++) {
        const k = (2 * ey + jb) * nx + 2 * ex + ia, N = A[ia] * B[jb], Na = dA[ia] * B[jb], Nb = A[ia] * dB[jb];
        x += N * gx[k]; y += N * gy[k]; xa += Na * gx[k]; xb += Nb * gx[k]; ya += Na * gy[k]; yb += Nb * gy[k];
      }
      return [x, y, xa, xb, ya, yb];
    };
    grid.q2 = true;
    grid.interp = interp;
    grid.pos = (xi, et) => { const [ex, ey, a, b] = elemOf(xi, et), J = jac(ex, ey, a, b); return [J[0], J[1]]; };
    grid.idxVel = (xi, et, u, v) => {
      const [ex, ey, a, b] = elemOf(xi, et), [, , xa, xb, ya, yb] = jac(ex, ey, a, b), det = xa * yb - xb * ya;
      return [(yb * u - xb * v) / det, (xa * v - ya * u) / det];
    };
    grid.locate = (x, y) => {
      const L = locate(x, y);
      if (!L) return null;
      let [ex, ey, a, b] = elemOf(L[0], L[1]);
      for (let hop = 0; hop < 4; hop++) {
        for (let it = 0; it < 10; it++) {
          const [px, py, xa, xb, ya, yb] = jac(ex, ey, a, b), det = xa * yb - xb * ya;
          const da = (yb * (px - x) - xb * (py - y)) / det, db = (xa * (py - y) - ya * (px - x)) / det;
          a -= da; b -= db;
          if (Math.abs(da) + Math.abs(db) < 1e-12) break;
        }
        // landed in a neighbouring element: move there and solve again
        const sx = a > 1 + 1e-9 && ex < nEx - 1 ? 1 : a < -1 - 1e-9 && ex > 0 ? -1 : 0;
        const sy = b > 1 + 1e-9 && ey < nEy - 1 ? 1 : b < -1 - 1e-9 && ey > 0 ? -1 : 0;
        if (!sx && !sy) break;
        ex += sx; ey += sy; a -= 2 * sx; b -= 2 * sy;
      }
      if (!(Math.abs(a) < 1 + 1e-6 && Math.abs(b) < 1 + 1e-6)) return L;
      return [Math.min(nx - 1, Math.max(0, 2 * ex + 1 + a)), Math.min(ny - 1, Math.max(0, 2 * ey + 1 + b))];
    };
  }
  return grid;
}

/** Is (x, y) inside the fluid? */
function fieldInside(f, x, y) {
  if (f.curv) return !!f.locate(x, y);
  return x >= 0 && x <= f.Lx && y >= 0 && y <= bladeHeightAt(f, x);
}

/** The fluid domain's outline, counter-clockwise from the inlet's foot: web, outlet, top boundary back, inlet. */
function fieldOutline(f) {
  const { nx, ny } = f, P = (i, j) => nodeXY(f, i, j), out = [];
  for (let i = 0; i < nx; i++) out.push(P(i, 0));
  for (let j = 1; j < ny; j++) out.push(P(nx - 1, j));
  for (let i = nx - 2; i >= 0; i--) out.push(P(i, ny - 1));
  for (let j = ny - 2; j > 0; j--) out.push(P(0, j));
  return out;
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
/** Grid-index coordinates of a physical point (sigma grid: unbounded; curvilinear: null outside the fluid). */
const toIndex = (f, x, y) => { if (f.curv) return f.locate(x, y); const xi = x / f.dx; return [xi, y / colInterp(f.h, xi) * (f.ny - 1)]; };
const fromIndex = (f, xi, et) => f.curv ? f.pos(xi, et) : [xi * f.dx, et / (f.ny - 1) * colInterp(f.h, xi)];
const nodeXY = (f, i, j) => f.curv ? [f.gx[j * f.nx + i], f.gy[j * f.nx + i]] : [i * f.dx, j / (f.ny - 1) * f.h[i]];
const nodeY = (f, i, j) => nodeXY(f, i, j)[1];

function sampleIdx(f, arr, fx, fy) {
  fx = fx < 0 ? 0 : fx > f.nx - 1 ? f.nx - 1 : fx;
  fy = fy < 0 ? 0 : fy > f.ny - 1 ? f.ny - 1 : fy;
  if (f.q2) return f.interp(arr, fx, fy);
  const i = Math.min(Math.floor(fx), f.nx - 2), j = Math.min(Math.floor(fy), f.ny - 2);
  const tx = fx - i, ty = fy - j, k = j * f.nx + i;
  return (1 - ty) * ((1 - tx) * arr[k] + tx * arr[k + 1]) + ty * ((1 - tx) * arr[k + f.nx] + tx * arr[k + f.nx + 1]);
}

/** Bilinear interpolation (in grid-index space) of a nodal field at physical (x, y), clamped to the domain. */
function sampleField(f, arr, x, y) {
  const at = toIndex(f, x, y) || f.nearest(x, y);
  return sampleIdx(f, arr, at[0], at[1]);
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
  const at = toIndex(f, x0, y0);
  if (!at) return { points: pts, reason: 'outside' };
  let [xi, eta] = at;
  const xi0 = xi, eta0 = eta;
  if (xi < 0 || xi > Xi || eta < -1e-9 || eta > Eta + 1e-9) return { points: pts, reason: 'outside' };

  const dir = (a, b) => {
    const u = sampleIdx(f, f.u, a, b), v = sampleIdx(f, f.v, a, b);
    if (Math.hypot(u, v) < vmin) return null;
    let gx, gy;
    if (f.curv) [gx, gy] = f.idxVel(a, b, u, v);
    else { const H = colInterp(f.h, a), Hp = colInterp(f.hx, a); gx = u / f.dx; gy = (f.ny - 1) * (v - (b / (f.ny - 1)) * Hp * u) / H; }
    const m = Math.hypot(gx, gy);
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
      if ((isMin && p < lo) || (isMax && p > hi)) { const [x, y] = nodeXY(f, i, j); out.push({ x, y, i, j, psi: p, bound: p < lo ? lo : hi }); }
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
  // seed column: the inflow for forward tracing, the outflow for backward; for both, mid-channel
  // (curvilinear: the metering edge's column, which all the through-flow crosses)
  const i = direction === 'forward' ? 0 : direction === 'backward' ? f.nx - 1 : f.curv && f.iCorner != null ? f.iCorner : Math.round((f.nx - 1) / 2);
  const col = [];
  for (let j = 0; j < f.ny; j++) col.push(f.psi ? f.psi[j * f.nx + i] : j);
  const firstCrossing = target => {
    for (let j = 1; j < f.ny; j++) {
      if ((col[j] - target) * (col[j - 1] - target) <= 0 && col[j] !== col[j - 1]) {
        const t = (target - col[j - 1]) / (col[j] - col[j - 1]);
        return fromIndex(f, i, j - 1 + t);
      }
    }
    return null;
  };
  const p0 = col[0], p1 = col[f.ny - 1];
  for (let m = 1; m <= n; m++) {
    const frac = m / (n + 1);
    const s = f.psi && p1 !== p0 ? firstCrossing(p0 + (p1 - p0) * frac) : null;
    seeds.push(s || fromIndex(f, i, frac * (f.ny - 1)));
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
    for (const fr of [0.2, 0.45, 0.7]) seeds.push(f.curv ? fromIndex(f, c.i, c.j + fr * (jEdge - c.j)) : [c.x, (c.j + fr * (jEdge - c.j)) / (f.ny - 1) * f.h[c.i]]);
  }
  return seeds;
}

/** Velocity vectors on a regular lattice (nCols x nRows over the plot's x and y range), keeping only points inside the fluid. */
/**
 * Quality of each finite element of a curvilinear field (element e = ex + nEx * ey, nodes
 * 2ex..2ex+2 x 2ey..2ey+2 of the node grid): the smallest over the largest Jacobian of its
 * quadratic map, taken at its nine nodes (1 = undistorted; 0 or below = degenerate / inverted).
 * Cached on the field. Returns { nEx, nEy, q, worst, worstAt }.
 */
function meshQuality(f) {
  if (f._quality) return f._quality;
  const nEx = (f.nx - 1) / 2, nEy = (f.ny - 1) / 2, q = new Float64Array(nEx * nEy);
  const N = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], dN = t => [t - 0.5, -2 * t, t + 0.5];
  const at = [-1, 0, 1].map(t => ({ N: N(t), dN: dN(t) }));
  let worst = Infinity, worstAt = 0;
  for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    let jmin = Infinity, jmax = -Infinity;
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      let xs = 0, xt = 0, ys = 0, yt = 0;
      for (let jb = 0; jb < 3; jb++) for (let ia = 0; ia < 3; ia++) {
        const k = (2 * ey + jb) * f.nx + 2 * ex + ia, Ns = at[a].dN[ia] * at[b].N[jb], Nt = at[a].N[ia] * at[b].dN[jb];
        xs += f.gx[k] * Ns; xt += f.gx[k] * Nt; ys += f.gy[k] * Ns; yt += f.gy[k] * Nt;
      }
      const J = xs * yt - xt * ys;
      jmin = Math.min(jmin, J); jmax = Math.max(jmax, J);
    }
    const e = ex + nEx * ey;
    q[e] = jmax > 0 ? jmin / jmax : -1;
    if (q[e] < worst) { worst = q[e]; worstAt = e; }
  }
  return (f._quality = { nEx, nEy, q, worst, worstAt });
}

/**
 * Contour lines (isolines) of a nodal field on a curvilinear grid, by marching squares over its
 * node cells: for each level v (in the field's units x scale), the crossing points on the cell
 * edges (linear along each edge), joined into polylines. Returns [{ v, lines: [[[x, y], ...], ...] }].
 */
function contourLines(f, arr, scale, levels) {
  const { nx, ny, gx, gy } = f, val = k => arr[k] * scale;
  // edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*nx+i), vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
  const pointOn = (id, v) => {
    const k = id >> 1, k2 = id & 1 ? k + nx : k + 1, a = val(k), b = val(k2), t = (v - a) / (b - a);
    return [gx[k] + t * (gx[k2] - gx[k]), gy[k] + t * (gy[k2] - gy[k])];
  };
  return levels.map(v => {
    const segs = [];            // pairs of edge ids
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const k0 = j * nx + i, k1 = k0 + 1, k3 = k0 + nx, k2 = k3 + 1;
      const a0 = val(k0) >= v, a1 = val(k1) >= v, a2 = val(k2) >= v, a3 = val(k3) >= v;
      const idx = (a0 ? 1 : 0) | (a1 ? 2 : 0) | (a2 ? 4 : 0) | (a3 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const eB = 2 * k0, eR = 2 * k1 + 1, eT = 2 * k3, eL = 2 * k0 + 1;   // bottom, right, top, left
      const centre = (val(k0) + val(k1) + val(k2) + val(k3)) / 4 >= v;
      switch (idx) {
        case 1: case 14: segs.push([eL, eB]); break;
        case 2: case 13: segs.push([eB, eR]); break;
        case 3: case 12: segs.push([eL, eR]); break;
        case 4: case 11: segs.push([eR, eT]); break;
        case 6: case 9: segs.push([eB, eT]); break;
        case 7: case 8: segs.push([eL, eT]); break;
        case 5: if (centre) { segs.push([eL, eT], [eB, eR]); } else { segs.push([eL, eB], [eR, eT]); } break;
        case 10: if (centre) { segs.push([eL, eB], [eR, eT]); } else { segs.push([eL, eT], [eB, eR]); } break;
      }
    }
    // join the segments into polylines through their shared edges
    const at = new Map();
    segs.forEach((sg, n) => { for (const e of sg) { if (!at.has(e)) at.set(e, []); at.get(e).push(n); } });
    const used = new Uint8Array(segs.length), lines = [];
    for (let n0 = 0; n0 < segs.length; n0++) {
      if (used[n0]) continue;
      used[n0] = 1;
      const chain = [segs[n0][0], segs[n0][1]];
      for (const dir of [1, 0]) {
        for (;;) {
          const end = dir ? chain[chain.length - 1] : chain[0];
          const next = (at.get(end) || []).find(m => !used[m]);
          if (next == null) break;
          used[next] = 1;
          const other = segs[next][0] === end ? segs[next][1] : segs[next][0];
          if (dir) chain.push(other); else chain.unshift(other);
        }
      }
      lines.push(chain.map(e => pointOn(e, v)));
    }
    return { v, lines };
  });
}

function sampleVectors(f, nCols, nRows, win) {
  const out = [], w = win || { x0: 0, x1: f.Lx, y0: 0, y1: f.Ly };   // (win: the zoom window, m)
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const x = w.x0 + (c + 0.5) * (w.x1 - w.x0) / nCols, y = w.y0 + (r + 0.5) * (w.y1 - w.y0) / nRows;
      if (f.curv ? !f.locate(x, y) : y > bladeHeightAt(f, x) * (1 - 0.25 / nRows)) continue;
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
  const { nx, ny } = f;
  const w = (i, j) => f.nodeArea[j * nx + i];
  const at = (i, j) => nodeXY(f, i, j);

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

/**
 * Time along a streamline (its points in flow order): t[0] = 0 and dt = ds / |V| on each
 * segment, |V| at the segment's middle -- the travel time of a fluid particle along it.
 */
function streamlineTimes(f, line) {
  const pts = line.points, t = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    const ds = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const sp = sampleField(f, f.speed, 0.5 * (pts[i][0] + pts[i - 1][0]), 0.5 * (pts[i][1] + pts[i - 1][1]));
    t[i] = t[i - 1] + ds / Math.max(sp, 1e-12);
  }
  return t;
}

/**
 * Residence time of the through-flow from the inlet to x = xStop (e.g. the metering edge):
 * n streamlines seeded on the inlet at equal flux spacing, traced forward; each line's
 * time to cross xStop. Lines that turn back to the inlet are counted, not timed. Equal flux
 * per line, so the plain mean over the timed lines is the flux-weighted mean.
 */
function residenceTimes(f, xStop, n = 32) {
  const times = [];
  let turned = 0;
  for (const seed of autoSeeds(f, n, 'forward').slice(0, n)) {
    const line = traceStreamline(f, seed, { direction: 'forward', maxCells: 20 * (f.nx + f.ny) }), pts = line.points, t = streamlineTimes(f, line);
    let hit = null;
    for (let i = 1; i < pts.length; i++) if (pts[i - 1][0] < xStop && pts[i][0] >= xStop) { const a = (xStop - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); hit = t[i - 1] + a * (t[i] - t[i - 1]); break; }
    if (hit != null) times.push(hit); else turned++;
  }
  if (!times.length) return { n: 0, turned };
  times.sort((a, b) => a - b);
  return { n: times.length, turned, min: times[0], max: times[times.length - 1], mean: times.reduce((a, b) => a + b, 0) / times.length, times };
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
  module.exports = { makeFlowField, sampleField, bladeHeightAt, fieldInside, fieldOutline, traceStreamline, autoSeeds, sampleVectors, flowMetrics, findEddyCentres, streamlinePsiDeviation, streamlineTimes, residenceTimes, contourLines, meshQuality };
}
