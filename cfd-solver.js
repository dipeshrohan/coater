/*
 * cfd-solver.js — 2D incompressible Navier-Stokes solver, streamfunction-
 * vorticity formulation. Pure computation, no DOM (same convention as
 * physics.js).
 *
 * Method (classical, not invented for this project — the standard approach
 * for 2D incompressible viscous flow, e.g. Anderson, "Computational Fluid
 * Dynamics: The Basics with Applications"):
 *
 *   Kinematics (exact):      grad^2(psi) = -omega,  u = d(psi)/dy,  v = -d(psi)/dx
 *   Vorticity transport:     d(omega)/dt + u*d(omega)/dx + v*d(omega)/dy = nu * grad^2(omega)
 *
 * Solved by pseudo-time marching the vorticity transport equation
 * (explicit, upwind convection + central diffusion) while re-solving the
 * streamfunction Poisson equation (SOR) and updating wall vorticity (Thom's
 * formula) every step, until the field stops changing (steady state).
 *
 * This file only knows about a rectangular grid with per-wall velocity
 * boundary conditions — it has no idea whether that rectangle is a
 * lid-driven cavity or a coating blade's metering gap. That's deliberate:
 * it lets the lid-driven-cavity case be used to validate the numerics
 * against an independent published benchmark before trusting it on the
 * process geometry.
 */

/**
 * Solve steady 2D incompressible Navier-Stokes on a rectangular domain.
 *
 * @param {object} opts
 * @param {number} opts.nx  grid points in x (including both walls)
 * @param {number} opts.ny  grid points in y (including both walls)
 * @param {number} opts.Lx  domain length in x (m)
 * @param {number} opts.Ly  domain length in y (m)
 * @param {number} opts.nu  kinematic viscosity (m^2/s)
 * @param {{top?:number,bottom?:number,left?:number,right?:number}} opts.wallU
 *        tangential wall speed (m/s) for each of the 4 walls (default 0 = stationary).
 *        top/bottom walls move in x; left/right walls move in y.
 * @param {number} [opts.maxIter=20000]  pseudo-time steps
 * @param {number} [opts.tol=1e-6]       convergence tolerance on max|domega|/dtau-normalized change
 * @param {number} [opts.dtau]           pseudo-timestep; auto-computed (stability-safe) if omitted
 * @param {number} [opts.sorBeta=1.7]    SOR over-relaxation factor for the Poisson solve
 * @returns {{nx:number,ny:number,dx:number,dy:number,psi:Float64Array,omega:Float64Array,
 *            u:Float64Array,v:Float64Array,iterations:number,converged:boolean,residual:number}}
 */
function solveCavityNS(opts) {
  const nx = opts.nx, ny = opts.ny;
  const Lx = opts.Lx, Ly = opts.Ly;
  const nu = opts.nu;
  const wallU = opts.wallU || {};
  const uTop = wallU.top || 0, uBottom = wallU.bottom || 0;
  const vLeft = wallU.left || 0, vRight = wallU.right || 0;
  const maxIter = opts.maxIter ?? 20000;
  const tol = opts.tol ?? 1e-6;
  const sorBeta = opts.sorBeta ?? 1.7;

  const dx = Lx / (nx - 1), dy = Ly / (ny - 1);
  const idx = (i, j) => j * nx + i; // i: x-index, j: y-index (j=0 bottom, j=ny-1 top)

  const psi = new Float64Array(nx * ny);
  const omega = new Float64Array(nx * ny);
  const omegaNew = new Float64Array(nx * ny);

  // Stability-safe explicit pseudo-timestep: diffusive limit (2D explicit
  // diffusion) combined with a CFL-style convective limit using the fastest
  // wall speed as a bound on interior velocities (a conservative estimate,
  // refined below once the field is non-trivial).
  const diffLimit = 0.25 / (nu * (1 / (dx * dx) + 1 / (dy * dy)));
  const maxWallSpeed = Math.max(Math.abs(uTop), Math.abs(uBottom), Math.abs(vLeft), Math.abs(vRight), 1e-9);
  const convLimit = 0.5 * Math.min(dx, dy) / maxWallSpeed;
  const dtau = opts.dtau ?? Math.min(diffLimit, convLimit) * 0.5;

  function poissonSolve() {
    // SOR for grad^2(psi) = -omega on interior points; psi = 0 on all walls
    // (impermeable, closed domain -- no net flux through any wall).
    const dx2 = dx * dx, dy2 = dy * dy;
    const denom = 2 * (dx2 + dy2);
    let maxDelta = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(i, j);
        const rhs = (psi[idx(i + 1, j)] + psi[idx(i - 1, j)]) * dy2
                  + (psi[idx(i, j + 1)] + psi[idx(i, j - 1)]) * dx2
                  + omega[k] * dx2 * dy2;
        const psiGS = rhs / denom;
        const delta = sorBeta * (psiGS - psi[k]);
        psi[k] += delta;
        if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
      }
    }
    return maxDelta;
  }

  function updateWallVorticity() {
    // Thom's formula on each wall, using the just-updated interior psi.
    const dx2 = dx * dx, dy2 = dy * dy;
    for (let i = 0; i < nx; i++) {
      // bottom wall (j=0): normal is +y, tangential speed = uBottom
      omega[idx(i, 0)] = 2 * (psi[idx(i, 0)] - psi[idx(i, 1)]) / dy2 + 2 * uBottom / dy;
      // top wall (j=ny-1): normal is -y, tangential speed = uTop
      omega[idx(i, ny - 1)] = 2 * (psi[idx(i, ny - 1)] - psi[idx(i, ny - 2)]) / dy2 - 2 * uTop / dy;
    }
    for (let j = 0; j < ny; j++) {
      // left wall (i=0): normal is +x, tangential speed = vLeft
      omega[idx(0, j)] = 2 * (psi[idx(0, j)] - psi[idx(1, j)]) / dx2 + 2 * vLeft / dx;
      // right wall (i=nx-1): normal is -x, tangential speed = vRight
      omega[idx(nx - 1, j)] = 2 * (psi[idx(nx - 1, j)] - psi[idx(nx - 2, j)]) / dx2 - 2 * vRight / dx;
    }
  }

  function velocityAt(i, j) {
    // central differences for u=d(psi)/dy, v=-d(psi)/dx; one-sided at walls (unused there, BCs govern).
    const u = (psi[idx(i, Math.min(j + 1, ny - 1))] - psi[idx(i, Math.max(j - 1, 0))]) / ((Math.min(j + 1, ny - 1) - Math.max(j - 1, 0)) * dy);
    const v = -(psi[idx(Math.min(i + 1, nx - 1), j)] - psi[idx(Math.max(i - 1, 0), j)]) / ((Math.min(i + 1, nx - 1) - Math.max(i - 1, 0)) * dx);
    return [u, v];
  }

  let converged = false, lastResidual = Infinity, it = 0;
  for (it = 0; it < maxIter; it++) {
    poissonSolve();
    updateWallVorticity();

    // Explicit pseudo-time step of the vorticity transport equation,
    // upwind for convection (stable, standard first choice), central for diffusion.
    let maxOmega = 1e-12;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const [u, v] = velocityAt(i, j);
        const k = idx(i, j);

        const dOmegaDx = u >= 0
          ? (omega[k] - omega[idx(i - 1, j)]) / dx
          : (omega[idx(i + 1, j)] - omega[k]) / dx;
        const dOmegaDy = v >= 0
          ? (omega[k] - omega[idx(i, j - 1)]) / dy
          : (omega[idx(i, j + 1)] - omega[k]) / dy;

        const lap = (omega[idx(i + 1, j)] - 2 * omega[k] + omega[idx(i - 1, j)]) / (dx * dx)
                  + (omega[idx(i, j + 1)] - 2 * omega[k] + omega[idx(i, j - 1)]) / (dy * dy);

        omegaNew[k] = omega[k] + dtau * (-u * dOmegaDx - v * dOmegaDy + nu * lap);
        if (Math.abs(omega[k]) > maxOmega) maxOmega = Math.abs(omega[k]);
      }
    }

    let maxChange = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(i, j);
        const change = Math.abs(omegaNew[k] - omega[k]);
        if (change > maxChange) maxChange = change;
        omega[k] = omegaNew[k];
      }
    }
    lastResidual = maxChange / maxOmega;
    if (!Number.isFinite(lastResidual)) break;
    if (lastResidual < tol) { converged = true; it++; break; }
  }

  // Final velocity field: interior points from the converged psi field;
  // wall points use the *exact* prescribed boundary velocity directly
  // rather than a one-sided finite difference of psi (which is only a
  // numerical approximation of a value we already know analytically).
  const u = new Float64Array(nx * ny), v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = idx(i, j);
      if (j === 0) { u[k] = uBottom; v[k] = 0; continue; }
      if (j === ny - 1) { u[k] = uTop; v[k] = 0; continue; }
      if (i === 0) { u[k] = 0; v[k] = vLeft; continue; }
      if (i === nx - 1) { u[k] = 0; v[k] = vRight; continue; }
      const [uu, vv] = velocityAt(i, j);
      u[k] = uu; v[k] = vv;
    }
  }

  return { nx, ny, dx, dy, psi, omega, u, v, iterations: it, converged, residual: lastResidual };
}

/**
 * Solve steady 2D incompressible Navier-Stokes on the real coating-gap
 * geometry: an open rectangular channel between a moving web (bottom wall)
 * and a stationary blade land (top wall), with prescribed inflow and a
 * zero-gradient outflow -- unlike solveCavityNS's fully closed cavity
 * (psi=0 on all four walls, no net flux), this domain carries a real net
 * flow rate through it, driven by both the moving web (Couette) and the
 * upstream bead pressure (Poiseuille), exactly the two terms already
 * combined in physics.js's filmThickness().
 *
 * Boundary conditions:
 *   - bottom wall (y=0, the web):   no-slip, moving at U, impermeable
 *   - top wall    (y=Ly, the land): no-slip, stationary, impermeable
 *   - inlet   (x=0):  prescribed velocity = the analytic, fully-developed
 *     Couette-Poiseuille profile for this gap (exact solution of the
 *     parallel-flow limit of both Stokes and full Navier-Stokes -- see
 *     CFD_PLAN.md). This is a physically-grounded inflow condition, not a
 *     guess: it is the same closed-form solution filmThickness() already
 *     assumes for the whole gap, just applied pointwise instead of
 *     depth-averaged.
 *   - outlet  (x=Lx): zero streamwise gradient (fully-developed outflow;
 *     the field is free to differ from the inlet profile between x=0 and
 *     x=Lx if the 2D solve finds it should -- convergence to a profile
 *     that stays equal to the inlet profile at every x is itself a
 *     correctness check, since the fully-developed analytic solution is
 *     exact and x-invariant for a true parallel channel).
 *
 * The pressure gradient never appears explicitly in the vorticity
 * transport equation (curl of a gradient is zero -- pressure drops out of
 * the vorticity formulation entirely, standard result). Its effect on the
 * flow enters only through these boundary conditions, via the inlet
 * profile and the wall-flux difference (top-wall psi minus bottom-wall
 * psi equals the net flow rate the inlet profile carries).
 *
 * @param {object} opts
 * @param {number} opts.nx  grid points in x (including inlet/outlet)
 * @param {number} opts.ny  grid points in y (including both walls)
 * @param {number} opts.Lx  land length (m)
 * @param {number} opts.Ly  gap height (m)
 * @param {number} opts.nu  kinematic viscosity, mu/rho (m^2/s)
 * @param {number} opts.mu  dynamic viscosity (Pa.s) -- needed (with dpdxFavorable) for the analytic inlet profile
 * @param {number} opts.U   web speed, bottom wall (m/s)
 * @param {number} opts.dpdxFavorable  -dp/dx (Pa/m), positive = pressure assists flow in +x
 *        (same sign convention as physics.js's filmThickness(): dpdx = Pup/L)
 * @param {number} [opts.maxIter=20000]
 * @param {number} [opts.tol=1e-6]
 * @param {number} [opts.dtau]
 * @param {number} [opts.sorBeta=1.7]
 * @returns {{nx,ny,dx,dy,psi,omega,u,v,iterations,converged,residual,uIn:(y)=>number}}
 */
function solveChannelNS(opts) {
  const nx = opts.nx, ny = opts.ny;
  const Lx = opts.Lx, Ly = opts.Ly;
  const nu = opts.nu, mu = opts.mu;
  const U = opts.U || 0;
  const G = opts.dpdxFavorable || 0;
  const maxIter = opts.maxIter ?? 20000;
  const tol = opts.tol ?? 1e-6;
  const sorBeta = opts.sorBeta ?? 1.7;
  // Optional overrides for the non-Newtonian Picard driver below: a
  // spatially-varying viscosity field (nx*ny, m^2/s) in place of the
  // scalar nu, and a pre-solved inlet profile in place of the closed-form
  // (Newtonian-only) Couette-Poiseuille one. Both default to the original
  // Phase 1b behavior when omitted -- this function's existing validated
  // path is untouched when neither is passed.
  const nuField = opts.nuField || null;
  const nuAt = nuField ? ((i, j) => nuField[j * nx + i]) : (() => nu);

  const dx = Lx / (nx - 1), dy = Ly / (ny - 1);
  const idx = (i, j) => j * nx + i;

  const psi = new Float64Array(nx * ny);
  const omega = new Float64Array(nx * ny);
  const omegaNew = new Float64Array(nx * ny);

  // Exact Couette-Poiseuille profile for this gap (see file header). Bc is
  // the linear coefficient of u(y) = U + Bc*y - (G/(2*mu))*y^2, fixed by
  // u(0)=U (web) and u(Ly)=0 (land). Used as the inlet condition unless
  // opts.inletProfile supplies a (generally non-Newtonian) alternative.
  const Bc = -U / Ly + G * Ly / (2 * mu);
  const closedFormUIn = y => U + Bc * y - (G / (2 * mu)) * y * y;
  const closedFormDudyIn = y => Bc - (G / mu) * y;
  const uIn = opts.inletProfile ? (y => interp1D(opts.inletProfile.y, opts.inletProfile.u, y)) : closedFormUIn;
  const dudyIn = opts.inletProfile ? (y => interp1D(opts.inletProfile.y, opts.inletProfile.dudy, y)) : closedFormDudyIn;

  // Fixed boundary values. Bottom wall (web) is the psi=0 reference; the
  // inlet column's psi is the cumulative flow (trapezoidal integral of
  // uIn, on this same grid, so the discrete BCs are exactly self
  // consistent); the top wall (land) carries whatever psi the inlet
  // reaches at y=Ly, constant along its length since no flux crosses a
  // solid wall.
  for (let j = 0; j < ny; j++) {
    const y = j * dy;
    let q = 0;
    for (let jj = 1; jj <= j; jj++) {
      const y0 = (jj - 1) * dy, y1 = jj * dy;
      q += 0.5 * (uIn(y0) + uIn(y1)) * dy;
    }
    psi[idx(0, j)] = q;
    omega[idx(0, j)] = -dudyIn(y);
  }
  const psiTop = psi[idx(0, ny - 1)];
  for (let i = 0; i < nx; i++) {
    psi[idx(i, 0)] = 0;
    psi[idx(i, ny - 1)] = psiTop;
  }
  // Seed the interior/outlet. A warm start (opts.psi0/omega0, e.g. the
  // previous Picard outer iteration's converged field, which is close to
  // this one's answer since only the viscosity field changed slightly)
  // converges far faster than the cold-start default of copying the
  // inlet profile across every column and re-relaxing from there.
  for (let j = 0; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      psi[idx(i, j)] = opts.psi0 ? opts.psi0[idx(i, j)] : psi[idx(0, j)];
      omega[idx(i, j)] = opts.omega0 ? opts.omega0[idx(i, j)] : omega[idx(0, j)];
    }
  }

  let nuMax = nu;
  if (nuField) { nuMax = 1e-12; for (let k = 0; k < nx * ny; k++) nuMax = Math.max(nuMax, nuField[k]); }
  const diffLimit = 0.25 / (nuMax * (1 / (dx * dx) + 1 / (dy * dy)));
  const maxSpeed = Math.max(Math.abs(U), Math.abs(uIn(0)), Math.abs(uIn(Ly / 2)), Math.abs(uIn(Ly)), 1e-9);
  const convLimit = 0.5 * Math.min(dx, dy) / maxSpeed;
  const dtau = opts.dtau ?? Math.min(diffLimit, convLimit) * 0.5;

  function poissonSolve() {
    const dx2 = dx * dx, dy2 = dy * dy;
    const denom = 2 * (dx2 + dy2);
    let maxDelta = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(i, j);
        const rhs = (psi[idx(i + 1, j)] + psi[idx(i - 1, j)]) * dy2
                  + (psi[idx(i, j + 1)] + psi[idx(i, j - 1)]) * dx2
                  + omega[k] * dx2 * dy2;
        const psiGS = rhs / denom;
        const delta = sorBeta * (psiGS - psi[k]);
        psi[k] += delta;
        if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
      }
    }
    for (let j = 0; j < ny; j++) psi[idx(nx - 1, j)] = psi[idx(nx - 2, j)]; // outlet: zero-gradient
    return maxDelta;
  }

  function updateWallVorticity() {
    const dy2 = dy * dy;
    for (let i = 1; i < nx - 1; i++) {
      omega[idx(i, 0)] = 2 * (psi[idx(i, 0)] - psi[idx(i, 1)]) / dy2 + 2 * U / dy;       // web, moving
      omega[idx(i, ny - 1)] = 2 * (psi[idx(i, ny - 1)] - psi[idx(i, ny - 2)]) / dy2;      // land, stationary
    }
    // outlet corners: same wall treatment as the interior wall columns
    omega[idx(nx - 1, 0)] = 2 * (psi[idx(nx - 1, 0)] - psi[idx(nx - 1, 1)]) / dy2 + 2 * U / dy;
    omega[idx(nx - 1, ny - 1)] = 2 * (psi[idx(nx - 1, ny - 1)] - psi[idx(nx - 1, ny - 2)]) / dy2;
    for (let j = 1; j < ny - 1; j++) omega[idx(nx - 1, j)] = omega[idx(nx - 2, j)]; // outlet interior: zero-gradient
  }

  function velocityAt(i, j) {
    const u = (psi[idx(i, Math.min(j + 1, ny - 1))] - psi[idx(i, Math.max(j - 1, 0))]) / ((Math.min(j + 1, ny - 1) - Math.max(j - 1, 0)) * dy);
    const v = -(psi[idx(Math.min(i + 1, nx - 1), j)] - psi[idx(Math.max(i - 1, 0), j)]) / ((Math.min(i + 1, nx - 1) - Math.max(i - 1, 0)) * dx);
    return [u, v];
  }

  let converged = false, lastResidual = Infinity, it = 0;
  for (it = 0; it < maxIter; it++) {
    poissonSolve();
    updateWallVorticity();

    let maxOmega = 1e-12;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const [u, v] = velocityAt(i, j);
        const k = idx(i, j);

        const dOmegaDx = u >= 0
          ? (omega[k] - omega[idx(i - 1, j)]) / dx
          : (omega[idx(i + 1, j)] - omega[k]) / dx;
        const dOmegaDy = v >= 0
          ? (omega[k] - omega[idx(i, j - 1)]) / dy
          : (omega[idx(i, j + 1)] - omega[k]) / dy;

        let diffTerm;
        if (nuField) {
          // Conservative (divergence-form) variable-coefficient diffusion,
          // div(nu*grad(omega)), face values by arithmetic mean -- the
          // standard discretization for spatially-varying diffusivity.
          // Reduces algebraically to nu*lap (the else branch) when nuField
          // is uniform, so the original Phase 1b path is unaffected.
          const nu0 = nuAt(i, j), nuE = 0.5 * (nu0 + nuAt(i + 1, j)), nuW = 0.5 * (nu0 + nuAt(i - 1, j)),
                nuN = 0.5 * (nu0 + nuAt(i, j + 1)), nuS = 0.5 * (nu0 + nuAt(i, j - 1));
          diffTerm = (nuE * (omega[idx(i + 1, j)] - omega[k]) - nuW * (omega[k] - omega[idx(i - 1, j)])) / (dx * dx)
                   + (nuN * (omega[idx(i, j + 1)] - omega[k]) - nuS * (omega[k] - omega[idx(i, j - 1)])) / (dy * dy);
        } else {
          const lap = (omega[idx(i + 1, j)] - 2 * omega[k] + omega[idx(i - 1, j)]) / (dx * dx)
                    + (omega[idx(i, j + 1)] - 2 * omega[k] + omega[idx(i, j - 1)]) / (dy * dy);
          diffTerm = nu * lap;
        }

        omegaNew[k] = omega[k] + dtau * (-u * dOmegaDx - v * dOmegaDy + diffTerm);
        if (Math.abs(omega[k]) > maxOmega) maxOmega = Math.abs(omega[k]);
      }
    }

    let maxChange = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = idx(i, j);
        const change = Math.abs(omegaNew[k] - omega[k]);
        if (change > maxChange) maxChange = change;
        omega[k] = omegaNew[k];
      }
    }
    lastResidual = maxChange / maxOmega;
    if (!Number.isFinite(lastResidual)) break;
    if (lastResidual < tol) { converged = true; it++; break; }
  }

  const u = new Float64Array(nx * ny), v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = j * dy;
    for (let i = 0; i < nx; i++) {
      const k = idx(i, j);
      if (j === 0) { u[k] = U; v[k] = 0; continue; }
      if (j === ny - 1) { u[k] = 0; v[k] = 0; continue; }
      if (i === 0) { u[k] = uIn(y); v[k] = 0; continue; }
      const [uu, vv] = velocityAt(i, j);
      u[k] = uu; v[k] = vv;
    }
  }

  return { nx, ny, dx, dy, psi, omega, u, v, iterations: it, converged, residual: lastResidual, uIn };
}

/** Linear interpolation of a sampled 1D function (xs strictly increasing) at x. */
function interp1D(xs, ys, x) {
  const nlast = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[nlast]) return ys[nlast];
  let lo = 0, hi = nlast;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

/**
 * Herschel-Bulkley-style apparent viscosity, mirroring physics.js's
 * muEff(gd) exactly (kept in sync deliberately -- this file stays
 * standalone/Node-testable per its own convention, so it can't import the
 * browser-global P/muEff from physics.js; see cfd-solver.channel.
 * validate.js for the same pattern).
 */
function muEffLocal(gd, muRef, ty, n) {
  gd = Math.max(gd, 1e-9);
  const base = Math.max(muRef - ty / 2.7, 0.05 * muRef);
  return ty / gd + base * Math.pow(gd / 2.7, n - 1);
}

/**
 * Invert the Herschel-Bulkley stress-shear-rate relation for gd given the
 * (signed magnitude of) shear stress: |tau| = mu(gd)*gd = ty + base*gd^n / 2.7^(n-1).
 * Returns gd=0 when |tau| <= ty (the unyielded/plug region -- a real
 * Herschel-Bulkley fluid does not shear at all below its yield stress).
 */
function shearRateFromStress(absTau, muRef, ty, n) {
  if (absTau <= ty) return 0;
  const base = Math.max(muRef - ty / 2.7, 0.05 * muRef);
  // Invert |tau| = ty + base*gd^n / 2.7^(n-1):
  //   gd = [(|tau|-ty)/base]^(1/n) * 2.7^((n-1)/n)
  return Math.pow((absTau - ty) / base, 1 / n) * Math.pow(2.7, (n - 1) / n);
}

/**
 * Exact 1D fully-developed generalized-Newtonian channel profile between a
 * moving wall (y=0, speed U, the web) and a stationary wall (y=Ly, the
 * land), under a constant favorable pressure gradient G (same sign
 * convention as physics.js's filmThickness(): G = Pup/L, positive assists
 * flow in +x).
 *
 * From the y-momentum balance alone (independent of the rheology model),
 * the total shear stress in fully-developed parallel channel flow is
 * exactly linear in y: tau(y) = tau0 - G*y, with the wall shear stress
 * tau0 unknown. Given tau(y), the local shear rate inverts pointwise via
 * shearRateFromStress() above, so du/dy = sign(tau)*gd(|tau|) is known
 * once tau0 is known; tau0 is found by bisection so that integrating
 * du/dy from u(0)=U lands on u(Ly)=0. residual(tau0)=u(Ly) is
 * monotonically increasing in tau0 (a larger wall stress drives more
 * +y-directed flow everywhere, since gd(|tau|) is monotone in |tau| for
 * any n>0), so a standard bisection applies.
 *
 * Reduces exactly to solveChannelNS's closed-form Couette-Poiseuille inlet
 * when n=1, ty=0 -- verified analytically (not just numerically): with
 * ty=0 the Newtonian stress is tau=muRef*du/dy, tau(y)=tau0-Gy integrates
 * to the same u(y) = U + (tau0/muRef)*y - (G/(2*muRef))*y^2, and solving
 * u(Ly)=0 for tau0 gives tau0 = G*Ly/2 - U*muRef/Ly, matching
 * solveChannelNS's Bc*muRef exactly.
 */
function solveFullyDeveloped1D(opts) {
  const Ly = opts.Ly, U = opts.U || 0, G = opts.G || 0;
  const muRef = opts.muRef, ty = opts.ty || 0, n = opts.n ?? 1;
  const ny = opts.ny ?? 401;
  const dy = Ly / (ny - 1);

  function residual(tau0) {
    let u = U;
    for (let j = 0; j < ny - 1; j++) {
      const y = j * dy;
      const tau = tau0 - G * y;
      const gd = shearRateFromStress(Math.abs(tau), muRef, ty, n);
      u += Math.sign(tau) * gd * dy;
    }
    return u; // target: u(Ly) = 0
  }

  const tau0Newton = G * Ly / 2 - U * muRef / Ly; // Newtonian closed-form estimate, used to center the bracket
  const scale = Math.abs(tau0Newton) + G * Ly + muRef * Math.abs(U) / Ly + ty + 1e-6;
  let lo = tau0Newton - 100 * scale, hi = tau0Newton + 100 * scale;
  let flo = residual(lo), fhi = residual(hi);
  for (let guard = 0; flo * fhi > 0 && guard < 40; guard++) {
    lo -= 100 * scale; hi += 100 * scale;
    flo = residual(lo); fhi = residual(hi);
  }

  let tau0 = tau0Newton;
  for (let it = 0; it < 100; it++) {
    tau0 = 0.5 * (lo + hi);
    const fm = residual(tau0);
    if (Math.abs(fm) < 1e-9 * Math.max(Math.abs(U), 1e-6)) break;
    if ((fm > 0) === (flo > 0)) { lo = tau0; flo = fm; } else { hi = tau0; fhi = fm; }
  }

  const y = new Float64Array(ny), u = new Float64Array(ny), gd = new Float64Array(ny), dudy = new Float64Array(ny);
  u[0] = U;
  for (let j = 0; j < ny; j++) y[j] = j * dy;
  for (let j = 0; j < ny - 1; j++) {
    const tau = tau0 - G * y[j];
    gd[j] = shearRateFromStress(Math.abs(tau), muRef, ty, n);
    dudy[j] = Math.sign(tau) * gd[j];
    u[j + 1] = u[j] + dudy[j] * dy;
  }
  const tauLast = tau0 - G * y[ny - 1];
  gd[ny - 1] = shearRateFromStress(Math.abs(tauLast), muRef, ty, n);
  dudy[ny - 1] = Math.sign(tauLast) * gd[ny - 1];

  return { y: Array.from(y), u, gd, dudy, tau0, dy, ny };
}

/**
 * Non-Newtonian extension of solveChannelNS via Picard (outer fixed-point)
 * iteration: solve with the current viscosity field frozen, recompute
 * viscosity from the resulting local shear-rate field via muEffLocal
 * (mirroring physics.js's muEff()), repeat until the viscosity field
 * itself stops changing. This is the standard approach for generalized-
 * Newtonian flow with a Navier-Stokes solver built for constant
 * viscosity -- freeze-solve-update instead of deriving the (much messier,
 * second-derivative-of-viscosity) exact variable-viscosity vorticity
 * transport equation. It neglects the small viscosity-gradient cross
 * terms that the exact formulation would carry; those vanish identically
 * in the Newtonian limit (n=1, ty=0), and are small elsewhere in this
 * thin-gap/low-Re regime for the same reason physics.js's own muEff()
 * already treats the cross-gap shear rate as effectively 1D (see its own
 * docstring).
 *
 * The 1D fully-developed profile (solveFullyDeveloped1D) supplies both
 * the physically self-consistent inlet boundary condition and the
 * starting viscosity field -- already very close to the converged answer
 * in this regime, since Phase 1b's validation showed the 2D field stays
 * within a fraction of a percent of the parallel-flow profile at every x
 * station even for the constant-viscosity case.
 *
 * @param {object} opts  everything solveChannelNS takes (nx, ny, Lx, Ly,
 *   U, dpdxFavorable), plus: rho (kg/m^3), muRef, ty, n (rheology, same
 *   convention as physics.js's P.mu/P.ty/P.n), maxOuter, outerTol.
 */
function solveChannelNSNonNewtonian(opts) {
  const { nx, ny, Lx, Ly, U, dpdxFavorable: G, rho, muRef, ty, n } = opts;
  const maxOuter = opts.maxOuter ?? 20;
  const outerTol = opts.outerTol ?? 1e-3;

  const prof1D = solveFullyDeveloped1D({ Ly, U, G, muRef, ty, n, ny: Math.max(ny * 4, 401) });
  const inletProfile = { y: prof1D.y, u: Array.from(prof1D.u), dudy: Array.from(prof1D.dudy) };

  const dy2D = Ly / (ny - 1);
  let nuField = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = j * dy2D;
    const gd = interp1D(prof1D.y, prof1D.gd, y);
    const nuHere = muEffLocal(gd, muRef, ty, n) / rho;
    for (let i = 0; i < nx; i++) nuField[j * nx + i] = nuHere;
  }

  let sol = null, outerResidual = Infinity, outerIterations = 0, outerConverged = false;
  let psi0 = null, omega0 = null;
  for (outerIterations = 0; outerIterations < maxOuter; outerIterations++) {
    // Early outer iterations only need a "good enough" field to compute
    // the next viscosity estimate from -- tighten the inner tolerance
    // only once the viscosity field itself is nearly settled. Combined
    // with the warm start below, this is what keeps the outer loop fast:
    // without it, every outer step re-converges the full 2D field from
    // scratch to full precision even though only the (slightly updated)
    // viscosity field changed.
    const nearlyDone = outerResidual < outerTol * 10;
    const innerTol = nearlyDone ? (opts.tol ?? 1e-6) : 1e-4;
    sol = solveChannelNS({ ...opts, nu: muRef / rho, mu: muRef, nuField, inletProfile, dpdxFavorable: G, tol: innerTol, psi0, omega0 });
    if (!sol.converged) break;
    psi0 = sol.psi; omega0 = sol.omega;

    const nuFieldNew = new Float64Array(nx * ny);
    let maxRel = 0, maxNu = 1e-12;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const jm = j - 1, jp = j + 1;
        const dudyLocal = (sol.u[jp * nx + i] - sol.u[jm * nx + i]) / (2 * dy2D);
        const dvdxLocal = (i === 0 || i === nx - 1) ? 0
          : (sol.v[j * nx + i + 1] - sol.v[j * nx + i - 1]) / (2 * (Lx / (nx - 1)));
        const dudxLocal = (i === 0 || i === nx - 1) ? 0
          : (sol.u[j * nx + i + 1] - sol.u[j * nx + i - 1]) / (2 * (Lx / (nx - 1)));
        const dvdyLocal = (sol.v[jp * nx + i] - sol.v[jm * nx + i]) / (2 * dy2D);
        const Dxx = dudxLocal, Dyy = dvdyLocal, Dxy = 0.5 * (dudyLocal + dvdxLocal);
        const gd = Math.sqrt(2 * (Dxx * Dxx + Dyy * Dyy + 2 * Dxy * Dxy));
        const nuNew = muEffLocal(gd, muRef, ty, n) / rho;
        nuFieldNew[k] = nuNew;
        maxNu = Math.max(maxNu, nuNew);
        maxRel = Math.max(maxRel, Math.abs(nuNew - nuField[k]));
      }
    }
    // wall rows (j=0, ny-1): copy the nearest interior row (no interior shear-rate estimate available there)
    for (let i = 0; i < nx; i++) { nuFieldNew[i] = nuFieldNew[nx + i]; nuFieldNew[(ny - 1) * nx + i] = nuFieldNew[(ny - 2) * nx + i]; }

    outerResidual = maxRel / maxNu;
    // Under-relax the update (standard fix for a Picard/fixed-point loop
    // whose raw update can overshoot and oscillate, as this one does at
    // coarse grids where the finite-difference shear-rate estimate is
    // noisier): blend toward the new field rather than replacing it
    // outright.
    const relax = opts.outerRelax ?? 0.5;
    for (let k = 0; k < nx * ny; k++) nuField[k] = nuField[k] + relax * (nuFieldNew[k] - nuField[k]);
    if (outerResidual < outerTol) {
      outerConverged = true; outerIterations++;
      // Guarantee the returned field meets the requested inner tolerance:
      // if this step itself ran loose (nearlyDone was false going in), redo
      // it once at full tolerance -- cheap, since it's warm-started from a
      // field already this close to converged.
      if (!nearlyDone) sol = solveChannelNS({ ...opts, nu: muRef / rho, mu: muRef, nuField, inletProfile, dpdxFavorable: G, tol: opts.tol ?? 1e-6, psi0, omega0 });
      break;
    }
  }

  return { ...sol, nuField, prof1D, outerIterations, outerResidual, outerConverged };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { solveCavityNS, solveChannelNS, solveFullyDeveloped1D, solveChannelNSNonNewtonian, muEffLocal };
