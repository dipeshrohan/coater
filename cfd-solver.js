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

  const dx = Lx / (nx - 1), dy = Ly / (ny - 1);
  const idx = (i, j) => j * nx + i;

  const psi = new Float64Array(nx * ny);
  const omega = new Float64Array(nx * ny);
  const omegaNew = new Float64Array(nx * ny);

  // Exact Couette-Poiseuille profile for this gap (see file header). Bc is
  // the linear coefficient of u(y) = U + Bc*y - (G/(2*mu))*y^2, fixed by
  // u(0)=U (web) and u(Ly)=0 (land).
  const Bc = -U / Ly + G * Ly / (2 * mu);
  const uIn = y => U + Bc * y - (G / (2 * mu)) * y * y;
  const dudyIn = y => Bc - (G / mu) * y;

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
  // Seed the interior/outlet with a copy of the inlet profile as the
  // initial guess; every column but i=0 is then free to evolve.
  for (let j = 0; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      psi[idx(i, j)] = psi[idx(0, j)];
      omega[idx(i, j)] = omega[idx(0, j)];
    }
  }

  const diffLimit = 0.25 / (nu * (1 / (dx * dx) + 1 / (dy * dy)));
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

if (typeof module !== 'undefined' && module.exports) module.exports = { solveCavityNS, solveChannelNS };
