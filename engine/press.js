/*
 * press.js — the cut pieces dried in a pressed stack (GO-4f): 20 pieces directly on each other under an aluminium
 * plate in the pre heat treatment (Q72–Q78). Pressed, a piece's water can leave only through the stack's edges: along the
 * piece (its own pores and the gaps between the pieces) to its edges. The water in the piece's plane, 2D, on a quarter
 * with its two mirror lines:
 *   ρS ∂X/∂t = ∇·(K psat(T) ∇a(X)),  a(X) the GAB isotherm inverted (1 where the pores hold more than it gives),
 * X the water per GO (kg/kg), ρS the GO's mass per film volume, K the in-plane vapour permeability (kg/(m s Pa)),
 * the edges at the oven air's activity. Cell-centred finite volumes, implicit Euler with Newton (the capacity is the
 * isotherm's), a banded Cholesky; steps growing geometrically (the edges dry fast at first).
 */

// ---- the GAB isotherm, its slope and its inverse ----
// (at a temperature T (°C): the isotherm with its C as exp(Hc/RT) from its value at T0 -- warm GO holds less at the
//  same humidity; no T, or no Hc (J/mol): the isotherm as it is)
const prGabAt = (g, T) => (g && g.Hc && Number.isFinite(T) ? { Xm: g.Xm, K: g.K, C: g.C * Math.exp(g.Hc / 8.314462618 * (1 / (T + 273.15) - 1 / ((Number.isFinite(g.T0) ? g.T0 : 25) + 273.15))) } : g);
const prGAB = (a, g) => { const u = g.K * Math.min(Math.max(a, 0), 1); return g.Xm * g.C * u / ((1 - u) * (1 - u + g.C * u)); };
const prGABslope = (a, g) => {
  const u = g.K * Math.min(Math.max(a, 0), 1), f = (1 - u) * (1 - u + g.C * u), df = -(1 - u + g.C * u) + (1 - u) * (g.C - 1);
  return g.K * g.Xm * g.C * (f - u * df) / (f * f);
};
/** The activity at water X: GAB solved for a (a quadratic in K a); 1 at and above what it gives at a = 1. */
function prActivity(X, g) {
  if (!(X > 0)) return 0;
  if (X >= prGAB(1, g)) return 1;
  const A = X * (1 - g.C), B = X * (g.C - 2) - g.Xm * g.C, Cc = X;
  let u;
  if (Math.abs(A) < 1e-14) u = -Cc / B;
  else { const d = Math.sqrt(Math.max(0, B * B - 4 * A * Cc)), r1 = (-B - d) / (2 * A), r2 = (-B + d) / (2 * A); u = [r1, r2].filter(r => r >= -1e-12 && r <= 1 + 1e-12).sort((p, q) => p - q)[0]; }
  return Math.min(1, Math.max(0, u / g.K));
}

/** A symmetric banded Cholesky solve (lower band), in place on a copy. */
function prBandSolve(n, bw, a, rhs) {
  const w = bw + 1, L = Float64Array.from(a);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = L[i * w + (i - j)];
      for (let k = Math.max(j0, j - bw); k < j; k++) s -= L[i * w + (i - k)] * L[j * w + (j - k)];
      if (j === i) { if (!(s > 0)) throw new Error('press: the drying matrix is not positive definite'); L[i * w] = Math.sqrt(s); }
      else L[i * w + (i - j)] = s / L[j * w];
    }
  }
  const y = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) { let s = y[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= L[i * w + (i - k)] * y[k]; y[i] = s / L[i * w]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= L[k * w + (k - i)] * y[k]; y[i] = s / L[i * w]; }
  return y;
}

/** n cell widths over [0, L] graded toward L (the last one `ratio` times smaller than the first; 1: even). */
function prWidths(L, n, ratio) {
  if (!(ratio > 1)) return Array(n).fill(L / n);
  const q = Math.pow(1 / ratio, 1 / (n - 1)), w0 = L * (1 - q) / (1 - Math.pow(q, n));
  return Array.from({ length: n }, (_, i) => w0 * Math.pow(q, i));
}

/**
 * The water in a pressed piece through its time in the oven. o: { Lx, Ly (m, the piece), nx, ny (cells on the
 * quarter), grade (the first cell over the last toward the edges; 1 even), X0 (its water at the start, kg/kg,
 * uniform), aEdge (the oven air's activity at the edges), psat (Pa, at the oven's temperature), K (kg/(m s Pa)),
 * rhoS (kg/m³), gab { Xm, C, K, T0, Hc }, T (°C, the stage's: the isotherm there), Xcap (the most its pores hold, if any), tEnd (s), steps, D (instead of K, psat and the isotherm: a constant diffusivity,
 * m²/s, X itself the potential -- the checks' linear case), saveAt (times to keep the field at) }.
 * Crank–Nicolson after four implicit Euler steps (Rannacher's start); steps growing geometrically, the last at most a
 * twentieth of the time. Returns the water on the quarter's cells at the end, the cells' centres and widths, its mean
 * over time, the water lost through the edges (for the balance).
 */
function prDry(o) {
  const nx = o.nx || 30, ny = o.ny || 30, N = nx * ny, bw = nx;
  const wx = prWidths(o.Lx / 2, nx, o.grade), wy = prWidths(o.Ly / 2, ny, o.grade);
  const cx = []; { let a = 0; for (const w of wx) { cx.push(a + w / 2); a += w; } }
  const cy = []; { let a = 0; for (const w of wy) { cy.push(a + w / 2); a += w; } }
  const id = (i, j) => j * nx + i, lin = Number.isFinite(o.D), gab = prGabAt(o.gab, o.T);
  const pot = X => lin ? X : prActivity(X, gab), dpot = X => { if (lin) return 1; if (X >= prGAB(1, gab)) return 0; return 1 / prGABslope(prActivity(X, gab), gab); };
  // (the pieces hold at most Xcap -- their pores full: air wetter than that fills them to it and no more)
  const cap = Number.isFinite(o.Xcap) ? o.Xcap : Infinity;
  const G = lin ? o.D : o.K * o.psat / o.rhoS, pEdge = lin ? (o.XEdge || 0) : Math.min(o.aEdge, cap < Infinity ? prActivity(cap, gab) : 1), XE = lin ? (o.XEdge || 0) : Math.min(prGAB(o.aEdge, gab), cap);
  // (X0: the water at the start, uniform, or on the cells -- a stage before this one)
  const X = typeof o.X0 === 'number' ? new Float64Array(N).fill(o.X0) : Float64Array.from(o.X0);
  const Xs = Math.max(XE, X.reduce((a, v) => Math.max(a, v), 0));
  const steps = o.steps || 100, tEnd = o.tEnd;
  // (steps growing by r, the last a twentieth of the time: r from (r − 1) r^(n−1) / (r^n − 1) = 1/20)
  let r = 1.0; { let lo = 1, hi = 2; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, f = (m - 1) * Math.pow(m, steps - 1) / (Math.pow(m, steps) - 1); if (f > 0.05) hi = m; else lo = m; } r = (lo + hi) / 2; }
  // (twenty steps or fewer: even ones -- none can be a twentieth)
  if (steps <= 20) r = 1;
  const s0 = r > 1 ? tEnd * (r - 1) / (Math.pow(r, steps) - 1) : tEnd / steps, dts = Array.from({ length: steps }, (_, k) => s0 * Math.pow(r, k));
  // (the fluxes out of each cell for a field: to its right and upper neighbours, and to the oven's air at the edges)
  const faces = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = id(i, j);
    if (i < nx - 1) faces.push([k, id(i + 1, j), G * wy[j] / (cx[i + 1] - cx[i])]); else faces.push([k, -1, G * wy[j] / (wx[i] / 2)]);
    if (j < ny - 1) faces.push([k, id(i, j + 1), G * wx[i] / (cy[j + 1] - cy[j])]); else faces.push([k, -1, G * wx[i] / (wy[j] / 2)]);
  }
  const flux = (P, R, sc) => { let out = 0; for (const [k, k2, g] of faces) { const f = g * (P[k] - (k2 < 0 ? pEdge : P[k2])) * sc; R[k] += f; if (k2 >= 0) R[k2] -= f; else out += f; } return out; };
  const area = Float64Array.from({ length: N }, (_, k) => wx[k % nx] * wy[Math.floor(k / nx)]);
  const mean = [], saveAt = (o.saveAt || []).slice().sort((p, q) => p - q), saved = [];
  const meanOf = () => { let s = 0, a = 0; for (let k = 0; k < N; k++) { s += X[k] * area[k]; a += area[k]; } return s / a; };
  let t = 0, lost = 0;
  mean.push([0, meanOf()]);
  // (Newton on the potential P -- the activity, or X itself in the linear case: the fluxes are linear in it and the
  //  water X(P) is each cell's own, so the Jacobian is exact and symmetric: Cholesky, and Newton converges quadratically.
  //  P stays within [0, the highest potential about] -- the edges' and the start's -- where the isotherm is below the cap)
  const Xof = P => lin ? P : prGAB(P, gab), dXof = P => lin ? 1 : prGABslope(P, gab);
  const Pv = Float64Array.from(X, pot), Ptop = Math.max(pEdge, ...Pv);
  dts.forEach((dt, step) => {
    const th = step < 4 ? 1 : 0.5, Xold = Float64Array.from(X), Rold = new Float64Array(N);
    const outOld = th < 1 ? flux(Pv, Rold, 1 - th) : 0;
    let outNew = 0;
    for (let it = 0; it < 40; it++) {
      const R = Float64Array.from(Rold), Kb = new Float64Array(N * (bw + 1));
      for (let k = 0; k < N; k++) { const c = area[k] / dt; R[k] += c * (Xof(Pv[k]) - Xold[k]); Kb[k * (bw + 1)] += c * dXof(Pv[k]); }
      outNew = flux(Pv, R, th);
      for (const [k, k2, g] of faces) { Kb[k * (bw + 1)] += th * g; if (k2 >= 0) { Kb[k2 * (bw + 1)] += th * g; Kb[k2 * (bw + 1) + (k2 - k)] -= th * g; } }
      let rn = 0; for (let k = 0; k < N; k++) rn = Math.max(rn, Math.abs(R[k]) * dt / area[k]);
      if (rn < 1e-12 * Math.max(1e-6, Xs)) break;
      const d = prBandSolve(N, bw, Kb, R.map(v => -v));
      for (let k = 0; k < N; k++) Pv[k] = Math.min(Ptop, Math.max(lin ? -Infinity : 0, Pv[k] + d[k]));
    }
    for (let k = 0; k < N; k++) X[k] = Xof(Pv[k]);
    t += dt; lost += (outNew + outOld) * dt;
    mean.push([t, meanOf()]);
    while (saveAt.length && saveAt[0] <= t + 1e-9) { saveAt.shift(); saved.push({ t, X: Float64Array.from(X) }); }
    if (o.onStep) o.onStep({ t, dt, step, X, cx, cy, XE });
  });
  return { nx, ny, wx, wy, cx, cy, X, XE, mean, saved, lost, area: o.Lx * o.Ly / 4, t };
}

/**
 * The water at (x, y) on the quarter from the cells: bilinear between the cells' centres, the edges at the oven air's
 * water, flat toward the mirror lines.
 */
function prSampler(r, Lx, Ly) {
  const xs = [...r.cx, Lx / 2], ys = [...r.cy, Ly / 2], nx = r.nx, ny = r.ny;
  const at = (X, i, j) => (i >= nx || j >= ny) ? r.XE : X[j * nx + i];
  const find = (v, a) => { if (v <= a[0]) return [0, 0]; for (let i = 0; i < a.length - 1; i++) if (v <= a[i + 1]) return [i, (v - a[i]) / (a[i + 1] - a[i])]; return [a.length - 2, 1]; };
  return (X, x, y) => {
    const [i, fx] = find(Math.abs(x), xs), [j, fy] = find(Math.abs(y), ys);
    return (1 - fx) * (1 - fy) * at(X, i, j) + fx * (1 - fy) * at(X, i + 1, j) + (1 - fx) * fy * at(X, i, j + 1) + fx * fy * at(X, i + 1, j + 1);
  };
}

/** The plate at a uniform water X from a table of rows [X, A, D, e, k] (linear between rows, held past its ends). */
function prProps(tab, X) {
  if (X <= tab[0][0]) return tab[0];
  for (let i = 0; i < tab.length - 1; i++) if (X <= tab[i + 1][0]) { const f = (X - tab[i][0]) / (tab[i + 1][0] - tab[i][0]); return tab[i].map((v, c) => v + f * (tab[i + 1][c] - v)); }
  return tab[tab.length - 1];
}

/**
 * The pieces pressed in the stack (GO-4f): their water and, each held flat, the stress the uneven water leaves in it
 * and the creep that eases it, through stages -- in the pre heat treatment, then under the plate in the room. o: { Lx, Ly,
 * nx, ny, grade (the water's cells), X0 (the water as cut, uniform), rhoS, gab, Xcap, K, tab (the plate at a uniform water:
 * rows [X, A, D, e, k] -- stretch and bending stiffness, natural stretch and curvature), nu, kSet (the roll's set
 * along the line, 1/m), tau (the creep time at the water X0, s; the creep's rate goes as the water: dry, none),
 * n, pgrade (the plate's mesh on the quarter), stages: [{ tEnd (s), psat (Pa), T (°C), aEdge, creep (on or off), steps, saveAt }],
 * Xstart (the water on the cells at the start, if not X0 all over) }.
 * No friction between the pieces (under a light plate it is far below the stresses): each is held flat but free in
 * its plane. The stress: plane, the natural stretch its water's (from as cut); each Gauss point a Maxwell body -- its
 * creep strain's rate the elastic strain over τ X0 / X, the curvature alike -- by the θ-method with the water's θ.
 * Returns per stage the drying's result, and per Gauss point of the mesh: the water, the creep strain and curvature and
 * the forces in the plane [Nx, Ny, Nxy] (N/m) at the stage's end; the peak stress over time (the largest principal
 * force, N/m) and where; the size pressed flat along the middles through time.
 */
function prPress(o) {
  const S = typeof shMesh === 'function' ? { shMesh, shGaussXY, shFlat } : require('./sheet.js');
  const n = o.n || 8, m = S.shMesh(o.Lx, o.Ly, n, n, { grade: o.pgrade, flat: true });
  const G = S.shGaussXY(m), ng = G.length, tau = o.tau > 0 ? o.tau : Infinity;
  const p0 = prProps(o.tab, o.X0), A0 = p0[1], e0 = p0[3];
  const ec = new Float64Array(3 * ng), kc = new Float64Array(3 * ng), el = new Float64Array(3 * ng), kel = new Float64Array(3 * ng);
  const Xg = new Float64Array(ng).fill(o.X0), sA = new Float64Array(ng), eb = new Float64Array(3 * ng), kN = new Float64Array(3 * ng), rg = new Float64Array(ng);
  const d = new Float64Array(m.ndof), hist = [], stages = [], Nf = new Float64Array(3 * ng);
  let peak = { N: 0 }, tAll = 0, Xcells = o.Xstart || o.X0;
  const ex = m.id(m.nx, 0) * 12, ey = m.id(0, m.ny) * 12;
  for (const [si, st] of o.stages.entries()) {
    let sample = null;
    const onStep = ({ t, dt, step, X, cx, cy, XE }) => {
      if (!sample) sample = prSampler({ cx, cy, nx: o.nx || 30, ny: o.ny || 30, XE }, o.Lx, o.Ly);
      const th = step < 4 ? 1 : 0.5;
      for (let g = 0; g < ng; g++) {
        const Xv = Xg[g] = sample(X, G[g][0], G[g][1]), P = prProps(o.tab, Xv);
        const r = rg[g] = st.creep && Number.isFinite(tau) ? dt / tau * Math.max(0, Xv) / o.X0 : 0;
        sA[g] = P[1] / A0 / (1 + r * th);
        const es = P[3] - e0, kb = [P[4] + (o.kSet || 0), P[4], 0];
        for (let c = 0; c < 3; c++) {
          eb[3 * g + c] = (c < 2 ? es : 0) + ec[3 * g + c] + r * (1 - th) * el[3 * g + c];
          kN[3 * g + c] = kb[c] + kc[3 * g + c] + r * (1 - th) * kel[3 * g + c];
        }
      }
      const fl = S.shFlat(m, { A: A0, nu: o.nu, eb, sA }), stn = fl.st;
      d.set(fl.d);
      let big = 0, at = -1;
      for (let g = 0; g < ng; g++) {
        const r = rg[g], Am = A0 * prProps(o.tab, Xg[g])[1] / A0 / (1 - o.nu * o.nu);
        for (let c = 0; c < 3; c++) {
          const eNew = (stn[7 * g + c] - eb[3 * g + c]) / (1 + r * th), kNew = -kN[3 * g + c] / (1 + r * th);
          ec[3 * g + c] += r * (th * eNew + (1 - th) * el[3 * g + c]); el[3 * g + c] = eNew;
          kc[3 * g + c] += r * (th * kNew + (1 - th) * kel[3 * g + c]); kel[3 * g + c] = kNew;
        }
        // (the largest principal force in the plane: tension at a drying edge, N/m)
        const N1 = Am * (el[3 * g] + o.nu * el[3 * g + 1]), N2 = Am * (el[3 * g + 1] + o.nu * el[3 * g]), N3 = Am * (1 - o.nu) / 2 * el[3 * g + 2];
        const Np = (N1 + N2) / 2 + Math.hypot((N1 - N2) / 2, N3);
        Nf[3 * g] = N1; Nf[3 * g + 1] = N2; Nf[3 * g + 2] = N3;
        if (Np > big) { big = Np; at = g; }
      }
      if (big > peak.N) peak = { N: big, t: tAll + t, stage: si, x: G[at][0], y: G[at][1], X: Xg[at] };
      hist.push({ t: tAll + t, stage: si, sizeX: 2 * d[ex] / o.Lx, sizeY: 2 * d[ey + 4] / o.Ly, N: big, Xmid: X[0] });
    };
    const dry = prDry({ Lx: o.Lx, Ly: o.Ly, nx: o.nx, ny: o.ny, grade: o.grade, X0: Xcells, aEdge: st.aEdge, psat: st.psat, T: st.T, K: o.K, rhoS: o.rhoS, gab: o.gab, Xcap: o.Xcap, tEnd: st.tEnd, steps: st.steps || 100, saveAt: st.saveAt, onStep });
    Xcells = dry.X; tAll += st.tEnd;
    stages.push({ dry, Xg: Float64Array.from(Xg), ec: Float64Array.from(ec), kc: Float64Array.from(kc), N: Float64Array.from(Nf), sizeX: hist[hist.length - 1].sizeX, sizeY: hist[hist.length - 1].sizeY });
  }
  return { m, G, stages, peak, hist, A0, e0, t: tAll };
}

if (typeof module !== 'undefined') module.exports = { prGabAt, prGAB, prGABslope, prActivity, prBandSolve, prWidths, prDry, prSampler, prProps, prPress };
