/*
 * furnace.js — the GO pieces in the furnace (GO-5): each piece between two graphite papers (bigger than it), the stack
 * in a graphite holder (plates and screw rods, snug), heated in argon in two runs: to about 1000 °C, then to 2800 °C
 * (Q87–Q108). The film's water and oxygen leave as gas (CO₂, CO, H₂O, then H₂), its layers close up as they go and
 * order into graphite; the gas held in a piece pushes its layers apart where it beats their hold, and the piece puffs up
 * (grows thicker, Q100) -- in the second run (Q101), where the gas pressure across the piece is highest (Q102).
 *
 *  - The film's chemistry by stages, each a first-order reaction with a spread of activation energies (a distributed
 *    activation energy model, Gaussian): its water, the labile oxygen (epoxide, hydroxyl), the stable oxygen (carbonyl,
 *    ether, the carboxyl's rest), the last oxygen and the hydrogen; and graphitization. Integrated exactly over each
 *    straight piece of the program (the temperature integral, through the exponential integral).
 *  - The gas through the film: across its thickness to its faces by Knudsen diffusion in the galleries between its
 *    layers (a diffusivity that falls as the layers close up, to a floor through its defects: at the middle
 *    p_m − p_f = G R T h / (8 D)); then along the graphite paper to the paper's edges (∇·(κ_p ∇p_f) + G = 0, 2D, a
 *    quarter with its mirror lines, finite volumes); where the gas under a paper beats the load on it, the paper lifts
 *    and lets it by (an obstacle problem, by active sets).
 *  - Where the middle's gas beats the layers' hold (their cohesion and the load on them), the layers part: the gas held
 *    there at the hold, its volume the piece's growth (kept: the layers do not close again). With the holder's plates on
 *    the stack, the stack's growth presses the graphite papers and the load rises.
 *  - The graphene film: its thickness (the layers' own, from their spacing, plus the growth), density, C/O, the
 *    crystallites' size and its heat conduction along it (a correlation: graphite's × its density's share × La/(La + ℓ)).
 */

const FU_R = 8.314462618, FU_K0 = 273.15, FU_G = 9.81, FU_DG = 0.3354, FU_DT = 0.344;
const FU_M = { C: 12.011, O: 15.999, H: 1.008, CO: 28.010, CO2: 44.009, H2O: 18.015, H2: 2.016 };

// ---- the program ----
/**
 * A run's program as points [t (s), T (K)]: from the room it heats (or cools) at each step's rate (°C/min) to its
 * temperature and holds there (min); then it cools to the room at `cool` (°C/min).
 */
function fuProgram(steps, Troom, cool) {
  const pts = [[0, Troom + FU_K0]];
  let t = 0, T = Troom;
  for (const s of steps) {
    if (Math.abs(s.to - T) > 1e-9) { t += Math.abs(s.to - T) / (Math.abs(s.rate) / 60); T = s.to; pts.push([t, T + FU_K0]); }
    if (s.hold > 0) { t += s.hold * 60; pts.push([t, T + FU_K0]); }
  }
  if (cool > 0 && T > Troom) { t += (T - Troom) / (cool / 60); pts.push([t, Troom + FU_K0]); }
  return pts;
}
/** A program's temperature at t (s): straight between its points. */
function fuTempAt(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, T0] = pts[i - 1], [t1, T1] = pts[i]; return t1 > t0 ? T0 + (T1 - T0) * (t - t0) / (t1 - t0) : T1; }
  return pts[pts.length - 1][1];
}
/**
 * A furnace cycle from a file: two columns, time and temperature (°C; K if the header says so), separated by commas,
 * semicolons, tabs or spaces; header lines skipped. The time's unit from the header ('h', 'min', 's') if it names one,
 * else `unit` (given, never guessed: null leaves it to be chosen). Returns { pts (s, K), unit, named, n, err }.
 */
function fuParseCycle(text, unit) {
  const rows = [], heads = [];
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const parts = s.split(/[,;\t]|\s+/).map(v => v.trim()).filter(v => v !== '');
    const nums = parts.map(v => Number(v.replace(/^"|"$/g, '')));
    if (parts.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) rows.push([nums[0], nums[1]]);
    else if (!rows.length) heads.push(s);
  }
  const head = heads.join(' ').toLowerCase();
  let named = null;
  if (/\bmin\b|minute|\(min\)|\[min\]/.test(head)) named = 'min';
  else if (/\bh\b|hour|\(h\)|\[h\]|\bhr\b|\bhrs\b/.test(head)) named = 'h';
  else if (/\bs\b|sec|\(s\)|\[s\]/.test(head)) named = 's';
  const kelvin = /\(k\)|\[k\]|\bkelvin\b/.test(head) && !/°c|\bc\b|celsius|\(c\)|\[c\]/.test(head);
  const u = named || unit || null;
  if (rows.length < 2) return { pts: null, unit: u, named, n: rows.length, err: 'At least two rows of time and temperature are needed.' };
  if (!u) return { pts: null, unit: null, named, n: rows.length, err: 'The time\'s unit is not named in the file: choose hours, minutes or seconds.' };
  const f = u === 'h' ? 3600 : u === 'min' ? 60 : 1;
  const pts = rows.map(([t, T]) => [t * f, kelvin ? T : T + FU_K0]);
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i - 1][0]) return { pts: null, unit: u, named, n: rows.length, err: `The time goes back at row ${i + 1}.` };
  if (pts.some(p => !(p[1] > 0) || p[1] > 4000 + FU_K0)) return { pts: null, unit: u, named, n: rows.length, err: 'A temperature is out of range (above absolute zero, at most 4000 °C).' };
  const t0 = pts[0][0];
  return { pts: pts.map(p => [p[0] - t0, p[1]]), unit: u, named, n: rows.length, err: null };
}

// ---- the temperature integral ----
/** e^x E₁(x), x > 0: the series below 1, Lentz's continued fraction above. */
function fuExE1(x) {
  if (!(x > 0)) return Infinity;
  if (x < 1) {
    let s = 0, t = 1;
    for (let k = 1; k < 80; k++) { t *= -x / k; const d = t / k; s += d; if (Math.abs(d) < 1e-18) break; }
    return Math.exp(x) * (-0.5772156649015329 - Math.log(x) - s);
  }
  let b = x + 1, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) { const an = -i * i; b += 2; d = 1 / (an * d + b); c = b + an / c; const del = c * d; h *= del; if (Math.abs(del - 1) < 1e-16) break; }
  return h;
}
/** e^x p(x), p(x) = ∫ₓ^∞ e^(−u)/u² du: 1/x − e^x E₁(x). */
const fuPq = x => 1 / x - fuExE1(x);
const FU_GL = [[0.0694318442029737, 0.1739274225687269], [0.3300094782075719, 0.3260725774312731], [0.6699905217924281, 0.3260725774312731], [0.9305681557970263, 0.1739274225687269]];
/** ∫ exp(−E/(R T)) dt over a step with T straight from T0 to T1 (K) in dt (s): exact; Gauss–Legendre where T barely changes. */
function fuArrInt(E, T0, T1, dt) {
  if (!(dt > 0)) return 0;
  const x0 = E / (FU_R * T0), x1 = E / (FU_R * T1), xm = Math.min(x0, x1);
  if (xm > 740) return 0;
  if (Math.abs(x0 - x1) < 0.02) { let s = 0; for (const [u, w] of FU_GL) s += w * Math.exp(-E / (FU_R * (T0 + (T1 - T0) * u))); return s * dt; }
  const beta = (T1 - T0) / dt;
  return E / FU_R * Math.exp(-xm) * (Math.exp(xm - x1) * fuPq(x1) - Math.exp(xm - x0) * fuPq(x0)) / beta;
}

// ---- a stage: first order, its activation energies spread (Gaussian) ----
/** The activation energy (J/mol) of a first-order reaction whose rate peaks at Tp (°C) heated at 10 °C/min (Kissinger's condition, exact for one energy). */
function fuE0(Tp, A) {
  const T = Tp + FU_K0, c = A * T / (10 / 60), lc = Math.log(c);
  let x = lc - Math.log(lc);
  for (let i = 0; i < 60; i++) { const f = x + Math.log(x) - lc; x -= f / (1 + 1 / x); if (Math.abs(f) < 1e-14) break; }
  return x * FU_R * T;
}
/** A stage: { A (1/s), Tp (°C, its middle energy's peak at 10 °C/min), sig (J/mol) } → its energies and weights (±5σ). */
function fuStage(s) {
  const A = s.A || 1e13, E0 = fuE0(s.Tp, A), sig = s.sig || 0, n = sig > 0 ? (s.nodes || 161) : 1;
  const E = new Float64Array(n), w = new Float64Array(n);
  if (n === 1) { E[0] = E0; w[0] = 1; }
  else {
    let sum = 0;
    for (let k = 0; k < n; k++) { const z = -5 + 10 * k / (n - 1); E[k] = Math.max(1e3, E0 + sig * z); w[k] = Math.exp(-z * z / 2); sum += w[k]; }
    for (let k = 0; k < n; k++) w[k] /= sum;
  }
  return { A, E0, sig, E, w, I: new Float64Array(n) };
}
/** The stage's conversion (0–1) from its integrals. */
function fuConv(st) { let a = 0; for (let k = 0; k < st.E.length; k++) a -= st.w[k] * Math.expm1(-st.I[k]); return a; }
/** The stage over a step: its integrals advanced, its conversion's rise returned. */
function fuAdvance(st, T0, T1, dt) {
  const a0 = fuConv(st);
  // (a node past e^−40 is done: its rest is skipped)
  for (let k = 0; k < st.E.length; k++) if (st.I[k] < 40) st.I[k] += st.A * fuArrInt(st.E[k], T0, T1, dt);
  return fuConv(st) - a0;
}

// ---- the film's chemistry ----
/**
 * Per mol of the GO's carbon: its oxygen 1/co and hydrogen hc; what each stage takes out (whole): the labile oxygen (a
 * share s1 of it, each atom out in CO₂ with c1CO2, CO with c1CO, the rest in H₂O -- as far as the hydrogen goes, the
 * rest as CO), the stable (s2: in CO with c2CO, the rest CO₂), the last (the rest of the oxygen, in CO; the hydrogen
 * left, as H₂). Each: gas (mol), mass (g), O, C, H (mol).
 */
function fuChem(c) {
  const O0 = 1 / c.co, H0 = c.hc, mGO = FU_M.C + FU_M.O * O0 + FU_M.H * H0;
  const st = (nCO2, nCO, nH2O, nH2) => ({ gas: nCO2 + nCO + nH2O + nH2, mass: FU_M.CO2 * nCO2 + FU_M.CO * nCO + FU_M.H2O * nH2O + FU_M.H2 * nH2,
    O: 2 * nCO2 + nCO + nH2O, C: nCO2 + nCO, H: 2 * nH2O + 2 * nH2 });
  const s1 = Math.min(1, Math.max(0, c.s1)), s2 = Math.min(1 - s1, Math.max(0, c.s2)), s3 = 1 - s1 - s2;
  let f2 = Math.max(0, c.c1CO2), f1 = Math.max(0, c.c1CO);
  if (f1 + f2 > 1) { const k = 1 / (f1 + f2); f1 *= k; f2 *= k; }
  let fw = 1 - f1 - f2;
  const nO1 = s1 * O0;
  if (nO1 > 0 && 2 * fw * nO1 > H0) { const fw2 = H0 / (2 * nO1); f1 += fw - fw2; fw = fw2; }
  const S1 = st(nO1 * f2 / 2, nO1 * f1, nO1 * fw, 0);
  const nO2 = s2 * O0, c2 = Math.min(1, Math.max(0, c.c2CO)), S2 = st(nO2 * (1 - c2) / 2, nO2 * c2, 0, 0);
  const S3 = st(0, s3 * O0, 0, Math.max(0, H0 - S1.H) / 2);
  return { O0, H0, mGO, stages: [S1, S2, S3], split1: { CO2: f2, CO: f1, H2O: fw } };
}

// ---- a banded Cholesky, factored once and solved many times ----
function fuFactor(n, bw, a) {
  const w = bw + 1, L = Float64Array.from(a);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = L[i * w + (i - j)];
      for (let k = Math.max(j0, j - bw); k < j; k++) s -= L[i * w + (i - k)] * L[j * w + (j - k)];
      if (j === i) { if (!(s > 0)) throw new Error('furnace: the gas matrix is not positive definite'); L[i * w] = Math.sqrt(s); }
      else L[i * w + (i - j)] = s / L[j * w];
    }
  }
  return { n, bw, L };
}
function fuSolve(F, rhs) {
  const { n, bw, L } = F, w = bw + 1, y = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) { let s = y[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= L[i * w + (i - k)] * y[k]; y[i] = s / L[i * w]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= L[k * w + (k - i)] * y[k]; y[i] = s / L[i * w]; }
  return y;
}

// ---- the graphite paper under a piece: the gas along it ----
/**
 * The quarter of a paper (the piece's half-sizes lx, ly plus the margin m it is bigger by): cell-centred finite volumes,
 * nP cells over the piece's half each way and nM over the margin; the mirror lines closed, the paper's edges open.
 * Returns the cells (x, y, area, inside the piece), the faces' conductances (per unit κ) and the geometric matrix.
 */
function fuPaperGrid(lx, ly, m, nP, nM) {
  const widths = (l) => { const w = []; for (let i = 0; i < nP; i++) w.push(l / nP); if (m > 0) for (let i = 0; i < nM; i++) w.push(m / nM); return w; };
  const wx = widths(lx), wy = widths(ly), nx = wx.length, ny = wy.length, n = nx * ny;
  const cx = [], cy = []; let s = 0; for (const w of wx) { cx.push(s + w / 2); s += w; } s = 0; for (const w of wy) { cy.push(s + w / 2); s += w; }
  const id = (i, j) => i + nx * j, bw = nx;
  const area = new Float64Array(n), inside = new Uint8Array(n), faces = [], edge = new Float64Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = id(i, j); area[k] = wx[i] * wy[j]; inside[k] = i < nP && j < nP ? 1 : 0;
    if (i + 1 < nx) faces.push([k, id(i + 1, j), wy[j] / ((wx[i] + wx[i + 1]) / 2)]); else edge[k] += wy[j] / (wx[i] / 2);
    if (j + 1 < ny) faces.push([k, id(i, j + 1), wx[i] / ((wy[j] + wy[j + 1]) / 2)]); else edge[k] += wx[i] / (wy[j] / 2);
  }
  const nb = Array.from({ length: n }, () => []);
  for (const [p, q, c] of faces) { nb[p].push([q, c]); nb[q].push([p, c]); }
  return { nx, ny, n, bw, cx, cy, wx, wy, area, inside, faces, nb, edge, id };
}
/** The matrix with the cells in `fixed` held (Dirichlet), lower band. */
function fuPaperMatrix(g, fixed) {
  const w = g.bw + 1, a = new Float64Array(g.n * w);
  for (let k = 0; k < g.n; k++) a[k * w] = fixed && fixed[k] ? 1 : g.edge[k];
  for (const [p, q, c] of g.faces) {
    if (fixed && (fixed[p] || fixed[q])) { if (!(fixed && fixed[p])) a[p * w] += c; if (!(fixed && fixed[q])) a[q * w] += c; continue; }
    a[p * w] += c; a[q * w] += c; a[q * w + (q - p)] -= c;
  }
  return fuFactor(g.n, g.bw, a);
}
/**
 * The gas under the paper above its surroundings' pressure (Pa): κ·(matrix) u = the sources (mol/s per cell), u ≤ the
 * load on the paper where it lifts. Active sets from the last step's; refactored only when they change.
 */
function fuPaperSolve(g, cache, src, kap, cap) {
  let fixed = cache.fixed || new Uint8Array(g.n), u;
  for (let it = 0; it < 60; it++) {
    if (!cache.F || !cache.fixed || cache.fixed.some((v, k) => v !== fixed[k])) { cache.F = fuPaperMatrix(g, fixed); cache.fixed = fixed; }
    const rhs = new Float64Array(g.n);
    for (let k = 0; k < g.n; k++) {
      if (fixed[k]) { rhs[k] = cap[k]; continue; }
      let r = src[k] / kap; for (const [j, c] of g.nb[k]) if (fixed[j]) r += c * cap[j]; rhs[k] = r;
    }
    u = fuSolve(cache.F, rhs);
    // (free cells above their cap join the held; a held cell whose gas would drain faster than it comes at its cap --
    //  the paper would settle again -- leaves them)
    const next = Uint8Array.from(fixed); let changed = false;
    for (let k = 0; k < g.n; k++) if (!fixed[k] && u[k] > cap[k] * (1 + 1e-12)) { next[k] = 1; changed = true; }
    if (!changed) for (let k = 0; k < g.n; k++) if (fixed[k]) {
      let out = g.edge[k] * cap[k];
      for (const [j, c] of g.nb[k]) out += c * (cap[k] - u[j]);
      if (out * kap > src[k] * (1 + 1e-9) + 1e-30) { next[k] = 0; changed = true; }
    }
    if (!changed) break;
    fixed = next;
  }
  return u;
}

/**
 * The pieces through the furnace's runs. o: {
 *   runs: [pts, ...] (each a program, [t s, T K]); Lx, Ly (m, the piece); margin (m, the paper bigger by, each side);
 *   h0 (m, the GO piece going in), rhoG (kg of GO per m³ of it), Xin (its water, kg/kg), Tin (K, the room's);
 *   chem { co, hc, s1, c1CO2, c1CO, s2, c2CO }; stages { water, labile, stable, last, graph } each { Tp, sig, A };
 *   dIn (nm, its layers' spacing going in); Dgal, Dmin (m²/s at 20 °C: the galleries' open, the floor); sigZ (Pa, the
 *   layers' cohesion); paper { t (m), rho (kg/m³), D (m²/s at 20 °C, the gas along it), Ez (Pa, its stiffness through
 *   it) }; N (pieces in the stack), room ('gap' | 'plates'), gap (m, above the stack; with the plates on it, 0);
 *   pa (Pa); La0, La1 (nm), ell (nm), kG (W/(m K)); nP, nM (cells); dT (K, the largest step), dtMax (s) }.
 */
function fuRun(o) {
  const pa = o.pa || 101325, T20 = 293.15, g = fuPaperGrid(o.Lx / 2, o.Ly / 2, o.margin || 0, o.nP || 16, o.margin > 0 ? (o.nM || 2) : 0);
  const chem = fuChem(o.chem), perKg = 1000 / chem.mGO;
  const mA = o.rhoG * o.h0, Xin = o.Xin || 0;
  // (per kg of dry GO: each stage's gas (mol), mass (kg), O, C (mol) whole; the water first)
  const nu = [Xin / (FU_M.H2O / 1000), ...chem.stages.map(s => s.gas * perKg)];
  const ms = [Xin, ...chem.stages.map(s => s.mass * perKg / 1000)];
  const Os = [0, ...chem.stages.map(s => s.O)], Cs = [0, ...chem.stages.map(s => s.C)];
  const ST = ['water', 'labile', 'stable', 'last'].map(k => fuStage(o.stages[k])), GR = fuStage(o.stages.graph);
  const spacerAll = Xin + chem.O0 * FU_M.O * perKg / 1000;
  // (the holder: the top piece -- the least load -- under one paper; with the plates on the stack, the papers pressed as it grows)
  const Ws = o.paper.rho * FU_G * o.paper.t, N = Math.max(1, o.N || 1);
  const kP = o.room === 'plates' || o.room === 'gap' ? o.paper.Ez * N / ((N + 1) * o.paper.t) : 0, g0 = o.room === 'gap' ? (o.gap || 0) / N : 0;
  const n = new Float64Array(g.n), V = new Float64Array(g.n), u = new Float64Array(g.n), cache = {};
  const hist = [], runs = [];
  let t0 = 0, alpha = new Float64Array(ST.length), gdeg = 0;
  const state = () => {
    const O = chem.O0 * (1 - alpha.slice(1).reduce((s, a, i) => s + a * chem.stages[i].O, 0) / chem.O0);
    const C = 1 - alpha.slice(1).reduce((s, a, i) => s + a * chem.stages[i].C, 0);
    const kept = 1 - alpha.slice(1).reduce((s, a, i) => s + a * ms[i + 1], 0);
    const spacer = (Xin * (1 - alpha[0]) + O * FU_M.O * perKg / 1000) / Math.max(1e-30, spacerAll);
    const d = FU_DG + (FU_DT - FU_DG) * (1 - gdeg) + (o.dIn - FU_DT) * spacer;
    return { O, C, kept, d, hc: o.h0 * d / o.dIn };
  };
  const Dof = (d, T) => (o.Dmin + o.Dgal * Math.pow(Math.max(0, d - FU_DG) / (o.dIn - FU_DG), 2)) * Math.sqrt(T / T20);
  for (let r = 0; r < o.runs.length; r++) {
    const pts = o.runs[r];
    // (the steps: at most dT kelvin and dtMax seconds each)
    const steps = [];
    for (let i = 1; i < pts.length; i++) {
      const [ta, Ta] = pts[i - 1], [tb, Tb] = pts[i], m = Math.max(1, Math.ceil(Math.abs(Tb - Ta) / (o.dT || 1)), Math.ceil((tb - ta) / (o.dtMax || 600)));
      for (let k = 0; k < m; k++) steps.push([ta + (tb - ta) * k / m, Ta + (Tb - Ta) * k / m, ta + (tb - ta) * (k + 1) / m, Ta + (Tb - Ta) * (k + 1) / m]);
    }
    let peak = { idx: 0, t: 0, T: pts[0][1], where: null }, puffAt = null, gasMax = 0, made = 0, out = 0;
    const areaP = o.Lx * o.Ly / 4, heldOf = () => { let s = 0; for (let k = 0; k < g.n; k++) if (g.inside[k]) s += n[k] * g.area[k]; return s / areaP; }, held0 = heldOf();
    for (const [ta, Ta, tb, Tb] of steps) {
      const dt = tb - ta;
      if (!(dt > 0)) continue;
      // the chemistry, exact over the step: the gas it makes per area
      let dN = 0;
      for (let s = 0; s < ST.length; s++) { const da = fuAdvance(ST[s], Ta, Tb, dt); alpha[s] += da; dN += mA * nu[s] * da; }
      gdeg += fuAdvance(GR, Ta, Tb, dt);
      const G = dN / dt, S = state(), T = Tb, RT = FU_R * T;
      const D = Dof(S.d, T), a = 8 * D / (RT * S.hc), es = o.es || Infinity;
      // the paper's conductance along it (viscous, µ ∝ T^0.7, the gas near the surroundings' pressure; per unit gradient of u)
      const kap = o.paper.D * Math.pow(T20 / T, 0.7) * o.paper.t / RT;
      const nOld = Float64Array.from(n), VOld = Float64Array.from(V);
      const src = new Float64Array(g.n), cap = new Float64Array(g.n), idx = new Float64Array(g.n);
      for (let it = 0; it < 3; it++) {
        for (let k = 0; k < g.n; k++) {
          const Wp = kP * Math.max(0, VOld[k] - g0);
          cap[k] = Ws + (g.inside[k] ? Wp : 0);
          if (!g.inside[k]) { src[k] = 0; continue; }
          const base = pa + o.sigZ + Ws, pHof = v => base + kP * Math.max(0, v - g0), pf = pa + u[k];
          const aOf = v => a * (1 + Math.pow(v / (S.hc * es), 3));
          let nk = nOld[k], Vk = VOld[k];
          // (the gas at the step's end held at V1, if its layers part further: V1·pH(V1) = (n + (G − a(V1)(pH(V1) − p_f)) dt) R T,
          //  rising in V1; > 0 at V: they stay as they are)
          const f = v => v * pHof(v) - (nk + (G - aOf(v) * (pHof(v) - pf)) * dt) * RT;
          const pq = G > 0 ? pf + G / a : pf;
          if (!(Vk > 0) && pq <= pHof(0)) { nk = 0; idx[k] = (pq - pa) / (pHof(0) - pa); }
          else if (f(Vk) < 0) {
            let lo = Vk, hi = Math.max(Vk * 2, (nk + G * dt) * RT / base + Vk + 1e-12);
            while (f(hi) < 0) hi *= 2;
            for (let i = 0; i < 100 && hi - lo > 1e-13 * hi; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
            Vk = hi; nk = Vk * pHof(Vk) / RT; idx[k] = 1;
          } else {
            // (held where they are: the gas leaks through the film as it comes, e^(−c t) to its balance)
            const aV = aOf(Vk), c = aV * RT / Vk;
            if (c > 0) { const neq = (G + aV * pf) / c; nk = neq + (nk - neq) * Math.exp(-c * dt); } else nk += G * dt;
            idx[k] = (nk * RT / Vk - pa) / (pHof(Vk) - pa);
          }
          n[k] = nk; V[k] = Vk;
          // (what leaves the film here goes under the paper: made less held)
          src[k] = (G - (nk - nOld[k]) / dt) * g.area[k];
        }
        if (!src.some(v => v > 0)) { u.fill(0); break; }
        const un = fuPaperSolve(g, cache, src, kap, cap);
        let du = 0; for (let k = 0; k < g.n; k++) { du = Math.max(du, Math.abs(un[k] - u[k])); u[k] = un[k]; }
        if (du < 1e-6 * (1 + Math.max(...cap))) break;
      }
      // (the gas made and what left the film, per area of the piece: made = out + the change held)
      made += G * dt; for (let k = 0; k < g.n; k++) out += src[k] * dt / areaP;
      let iMax = 0, kMax = 0; for (let k = 0; k < g.n; k++) if (g.inside[k] && idx[k] > iMax) { iMax = idx[k]; kMax = k; }
      if (iMax > peak.idx) peak = { idx: iMax, t: t0 + tb, T: T, k: kMax };
      if (iMax >= 1 && !puffAt) puffAt = { t: t0 + tb, T };
      gasMax = Math.max(gasMax, G);
      const mid = 0, edgeK = g.id(g.nx > (o.nP || 16) ? (o.nP || 16) - 1 : g.nx - 1, 0);
      hist.push({ run: r, t: t0 + tb, T, kept: S.kept, CO: S.C / Math.max(1e-30, S.O), g: gdeg, d: S.d, G, D, idxMid: idx[mid], idxMax: iMax,
        Vmid: V[mid], Vedge: V[edgeK], uMid: u[mid], hold: o.sigZ + Ws + kP * Math.max(0, V[mid] - g0), hc: S.hc,
        lifted: cache.fixed ? cache.fixed.reduce((s, v, k) => s + (v && g.inside[k] ? g.area[k] : 0), 0) / (o.Lx * o.Ly / 4) : 0 });
    }
    runs.push({ peak, puffAt, gasMax, tEnd: t0 + pts[pts.length - 1][0], gas: { made, out, held0, held: heldOf() } });
    t0 += pts[pts.length - 1][0];
    // (between runs the gas held leaks out as it cools and the gap takes the surroundings' gas: at their pressure;
    //  the gap stays)
    const Tl = pts[pts.length - 1][1];
    for (let k = 0; k < g.n; k++) n[k] = pa * V[k] / (FU_R * Tl);
    u.fill(0);
  }
  // the graphene film
  const S = state(), La = o.La0 * Math.pow(o.La1 / o.La0, gdeg);
  let aSum = 0, hSum = 0, hMin = Infinity, hMax = -Infinity;
  const thick = new Float64Array(g.n);
  for (let k = 0; k < g.n; k++) if (g.inside[k]) { const h = S.hc + V[k]; thick[k] = h; aSum += g.area[k]; hSum += h * g.area[k]; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }
  const hMean = hSum / aSum, mEnd = mA * S.kept, rho = mEnd / hMean;
  const kappa = o.kG * (rho / 2260) * La / (La + o.ell);
  return { hist, runs, grid: g, thick, V: Float64Array.from(V), chem, alpha: Array.from(alpha), g: gdeg, d: S.d, La, kept: S.kept, CO: S.C / Math.max(1e-30, S.O),
    O: S.O, C: S.C, hc: S.hc, hMean, hMin, hMax, rho, kappa, mA, mEnd, stages: ST.map(s => ({ E0: s.E0, sig: s.sig })), graph: { E0: GR.E0, sig: GR.sig } };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  FU_R, FU_K0, FU_M, fuProgram, fuTempAt, fuParseCycle, fuExE1, fuPq, fuArrInt, fuE0, fuStage, fuConv, fuAdvance, fuChem,
  fuFactor, fuSolve, fuPaperGrid, fuPaperMatrix, fuPaperSolve, fuRun,
};
