/*
 * furnace-mp.js — MP-2: the furnace's stack in 1D, 2D and 3D, its heat, its chemistry, its gas and its stress solved
 * together (mp-core.js). Pure computation, no DOM: the furnace worker and Node.
 *
 * The holder (Q89, GO-7e): N pieces, each between graphite papers bigger than it (a margin all round), the stack between
 * two isostatic graphite plates the papers' size; heated in argon by the program (the hot zone's temperature). What
 * furnace.js takes as given -- every piece at the program's temperature, all through -- is solved here:
 *
 *  - Heat: the stack as a layered medium (the pieces and papers each far thinner than the stack: their conductivities
 *    along and through combined as layers in parallel and in series, a contact resistance at each piece's faces; checked
 *    against the layers resolved one by one), the plates solid graphite. Its heat stored as enthalpy (graphite's heat
 *    capacity with temperature, Butland and Maddison 1973: 0.7 kJ/(kg K) at the room to 2 at 2000 K; the GO's scaled to
 *    its card's value at the room; its water's). The faces see the hot zone at the program's temperature (radiation) and
 *    the argon (natural convection: Churchill–Chu on the sides, the horizontal plates' correlations on the top and the
 *    underside, argon's properties at the film temperature).
 *  - Chemistry at every node, at its own temperature: furnace.js's stages (its water, the labile, stable and last oxygen,
 *    graphitizing; first order, spread activation energies, integrated exactly over each step's straight change of
 *    temperature). Their heat goes back into the heat equation: the labile oxygen's leaving releases heat (GO's exotherm),
 *    the water's leaving takes its latent heat -- solved by Newton at the nodes (mp-core's Qn), so a runaway is followed.
 *  - Gas: each piece's gas (furnace.js's moles per stage) leaves by its papers and flows along them to their edges (Darcy
 *    in the paper, furnace.js's conductance), at every level and every point at the local temperature: the pressure
 *    under the paper and, across the piece, in its middle (furnace.js's G R T h / (8 D)). Held down: where it passes the
 *    load the paper would lift and let it by, where it passes the layers' hold they would part (furnace.js follows both).
 *  - Stress: each followed piece free in its plane, its natural size shrinking as its oxygen leaves and it graphitizes
 *    (furnace.js's bO, bG), plus the heat's (its expansion less the paper's): where it converts unevenly it pulls on itself.
 *
 * The dimensions (the same physics, fewer directions):
 *  - 1D: along the pieces at the stack's middle height (x, from the middle to the paper's edge): a tall stack's middle,
 *    heated from its side through the papers. Its stress: the piece as a strip (σ_yy; σ_xx = 0).
 *  - 2D: a section (x, z) through the plates and the stack, from the middle to the side, the stack taken long across (y).
 *  - 3D: a quarter of the holder (x, y, z; its mirror planes). Each followed piece's stress in its plane (plane stress).
 * SI inside (m, s, kg, Pa, mol); temperatures in °C (the programs in K, as furnace.js's).
 */
const FMP = typeof mpMesh === 'function' ? { mpMesh, mpTransport, mpElastic, mpAt, MP_SIGMA } : require('./mp-core.js');
const FMP_ML = typeof mlQEval === 'function' ? { mlQEval } : require('./matlib.js');
/** A property in temperature (MH-4b): its definition q (matlib's, in kelvin) at T (°C), else its constant v. */
const fmpAtT = (q, v) => (q ? T => FMP_ML.mlQEval(q, { T: T + 273.15 }) : () => v);
const FMP_FU = typeof fuStage === 'function' ? { fuStage, fuArrInt, fuChem, fuTempAt, fuAdvance, fuConv, FU_R, FU_M, FU_K0 } : require('./furnace.js');

const FMP_K0 = 273.15, FMP_G = 9.80665, FMP_CW = 4180, FMP_DG = 0.3354, FMP_DT = 0.344;
// graphite's heat capacity, cal/(g K) from T (K), 200–3500 K (Butland and Maddison, J. Nucl. Mater. 49 (1973) 45):
// a + b T + c/T + d/T² + e/T³ + f/T⁴
const FMP_CG = [0.54212, -2.42667e-6, -90.2725, -43449.3, 1.59309e7, -1.43688e9];
// The built-in material laws' parameters (MC-1b), as the material hub edits them: argon's viscosity (power law in T),
// molar mass, specific heat and Prandtl number; graphite's heat capacity (the coefficients above); water's specific
// heat. These are the laws' own values; a solve takes its options' (o.props) through fmpUse.
const FMP_PROPS = Object.freeze({ arMu: { y0: 2.27e-5, T0: 300, b: 0.67 }, arM: 0.039948, arCp: 520.3, arPr: 2 / 3, gCp: FMP_CG, waterCp: FMP_CW });
let FMP_P = FMP_PROPS;
/** The laws the next solve takes: props (the hub's, where they differ from these), else the built-in ones. */
function fmpUse(props) { FMP_P = props ? { ...FMP_PROPS, ...props } : FMP_PROPS; }
/** Graphite's heat capacity, J/(kg K), at T (°C). */
function fmpCg(T) { const K = Math.max(200, T + FMP_K0), [a, b, c, d, e, f] = FMP_P.gCp; return 4184 * (a + b * K + c / K + d / (K * K) + e / (K * K * K) + f / (K * K * K * K)); }
/** Graphite's enthalpy, J/kg, from 0 °C to T (°C): the integral of fmpCg (exact). */
function fmpHg(T) {
  const H = K => { const [a, b, c, d, e, f] = FMP_P.gCp; return 4184 * (a * K + b * K * K / 2 + c * Math.log(K) - d / K - e / (2 * K * K) - f / (3 * K * K * K)); };
  const K = T + FMP_K0;
  return K >= 200 ? H(K) - H(FMP_K0) : H(200) - H(FMP_K0) + fmpCg(-73.15) * (K - 200);
}
/** Argon at 1 atm and T (°C): viscosity (Pa s; 2.27 × 10⁻⁵ at 300 K, ∝ T^0.67), conductivity (μ c_p / Pr), density, Pr = ⅔ (monatomic). */
function fmpArgon(T, p = 101325) {
  const q = FMP_P, K = T + FMP_K0, mu = q.arMu.y0 * Math.pow(K / q.arMu.T0, q.arMu.b), cp = q.arCp, Pr = q.arPr;
  return { mu, k: mu * cp / Pr, rho: p * q.arM / (8.314462618 * K), cp, Pr };
}
/**
 * Natural convection in argon on a face at Ts in gas at Tg (°C), W/(m² K): 'side' a vertical face of height L
 * (Churchill–Chu); 'up' / 'down' a horizontal face facing up or down of length L (area / perimeter): 0.54 Ra^¼ (0.15 Ra^⅓
 * past 10⁷) where the flow rises from it freely (hot facing up, cold facing down), 0.27 Ra^¼ where it cannot.
 */
function fmpNat(kind, Ts, Tg, L, p) {
  if (Math.abs(Ts - Tg) < 1e-6) Ts = Tg + 1e-6;
  const Tf = (Ts + Tg) / 2, a = fmpArgon(Tf, p), nu = a.mu / a.rho, alpha = a.k / (a.rho * a.cp);
  const Ra = FMP_G / (Tf + FMP_K0) * Math.abs(Ts - Tg) * L * L * L / (nu * alpha);
  let Nu;
  if (kind === 'side') Nu = Math.pow(0.825 + 0.387 * Math.pow(Ra, 1 / 6) / Math.pow(1 + Math.pow(0.492 / a.Pr, 9 / 16), 8 / 27), 2);
  else {
    const free = (kind === 'up') === (Ts > Tg);
    Nu = free ? (Ra < 1e7 ? 0.54 * Math.pow(Ra, 0.25) : 0.15 * Math.cbrt(Ra)) : 0.27 * Math.pow(Ra, 0.25);
  }
  return Nu * a.k / L;
}

/**
 * The stack through the furnace's runs. o: {
 *   dim: 1 | 2 | 3, Lx, Ly (m, a piece), margin (m, the paper beyond the piece each side), N (pieces), h (m, a piece),
 *   tp (m, a paper), ends: 'plates' (the top and bottom pieces on the plates: N − 1 papers) | 'papers' (N + 1),
 *   plateT (m), plates (false: none, the top and bottom insulated -- the checks'), resolve (true: every piece and paper
 *   its own layer of elements -- the check of the layered medium; no contact resistance),
 *   go: { rho (kg of dry GO per m³ of piece), c (J/(kg K) at the room), kIn, kThr (W/(m K)), Xin (kg water / kg GO) },
 *   paper: { rho, kIn, kThr, D (m²/s: the gas along it, furnace.js's) }, plate: { rho, k }, Rc (m² K/W, a piece's face on
 *   a paper), runs: [[t (s), T (K)] points, each run from the room], chem, stages (furnace.js's), bins (energies per stage;
 *   default 41), Hr (J per kg of GO: the labile oxygen's heat), Lw (J/kg: the water's), furnace: { eps (the faces to the
 *   hot zone), gas (true: argon's natural convection), p (Pa) },
 *   gas: { Dgal, Dmin (m²/s), dIn (nm), sigZ (Pa), plateP (Pa, the plate's weight on the stack) },
 *   plane: { Ep (Pa), nu, bO, bG (the shrink, all the oxygen gone and graphitized), am (1/K, less the paper's) },
 *   mesh: { nx, ny, nm (the margin's), nz (the stack's), nPlate, grade }, dT (K per step below 400 °C; default 2),
 *   dTHigh (above; default 10), dtMax (s; default 600), jumpMax (K a step at most; default 100), follow (piece indices,
 *   0 the bottom), snapTimes (s), snapUneven (true: snapshots too where the stack is most uneven and where its own heat is furthest above the program), onProgress ({ k, n });
 *   the checks': isothermal (the program's temperature everywhere,
 *   no heat solved), adiabatic (no heat through the faces), sides (false: the sides insulated), sealY (3D: the y side
 *   insulated and sealed to the gas, no margin there: the stack as long across as the 2D takes it), noChem (no chemistry) }.
 * Between the runs the stack cools to the room (it is taken out), its chemistry kept.
 * Returns { dim, series, snaps, summary, follow, energy { faces, reaction, between (the heat given up between the
 * runs), held (= faces + reaction + between, step by step) }, mesh, ms }.
 */
/**
 * The holder's domain and mesh (MP-W: the solve's and the page's drawing alike): x (and y) the piece then the paper's
 * margin, graded to the piece's edge; z the plates and the stack (one layered medium graded to its faces, or each piece
 * and paper resolved). o: fmpStack's (dim, Lx, Ly, margin, N, h, tp, ends, plateT, plates, resolve, sealY, mesh).
 * Returns { hx, hy, mg, Hs (the stack's height), plT (a plate's, 0 without), H, zi, nPap, nStackSeg, layers, xAxis, yAxis,
 * zAxis, axes (mpMesh's), mat (ijk, seg) → 0 the plates, 1 the stack over the pieces, 2 over the margin (resolved: 3 a
 * piece, 4 a paper, 5 a gap in the margin), and the mesh's numbers }.
 */
function fmpAxes(o) {
  const dim = o.dim, N = Math.max(1, Math.round(o.N)), h = o.h, tp = o.tp;
  const hx = o.Lx / 2, hy = o.Ly / 2, mg = o.margin || 0, ms = o.mesh || {}, nx = ms.nx || 8, ny = ms.ny || nx, nm = ms.nm || 2;
  const grade = ms.grade || 4, nPl = ms.nPlate || 3, resolve = !!o.resolve && dim > 1;
  const plates = o.plates !== false && dim > 1, onPl = (o.ends || 'plates') === 'plates';
  const nPap = onPl ? N - 1 : N + 1, Hs = N * h + nPap * tp, plT = plates ? o.plateT : 0, H = Hs + 2 * plT, zi = dim - 1;
  const xAxis = [{ L: hx, n: nx, grade, end: 'hi' }].concat(mg > 0 ? [{ L: mg, n: nm }] : []);
  const yAxis = [{ L: hy, n: ny, grade, end: 'hi' }].concat(mg > 0 && !o.sealY ? [{ L: mg, n: nm }] : []);   // (sealed: the stack long across, no margin there)
  // (resolved: from the bottom, [paper] piece paper piece … [paper]; each layer one element through)
  const layers = [];
  if (resolve) { if (!onPl) layers.push('P'); for (let i = 0; i < N; i++) { layers.push('G'); if (i < N - 1 || !onPl) layers.push('P'); } }
  const nz = ms.nz || Math.min(24, Math.max(4, 2 * Math.ceil(Math.sqrt(N))));
  const stackZ = resolve ? layers.map(k => ({ L: k === 'G' ? h : tp, n: 1 })) : [{ L: Hs, n: nz, grade: ms.gradeZ || 2, end: 'both' }];
  const nStackSeg = stackZ.length, zAxis = plates ? [{ L: plT, n: nPl }, ...stackZ, { L: plT, n: nPl }] : stackZ;
  const axes = dim === 1 ? [xAxis] : dim === 2 ? [xAxis, zAxis] : [xAxis, yAxis, zAxis];
  const mat = (ijk, seg) => {
    const zs = dim === 1 ? (plates ? 1 : 0) : seg[zi], s = plates ? zs - 1 : zs;
    if (s < 0 || s >= nStackSeg) return 0;
    const margin = seg[0] === 1 || (dim === 3 && seg[1] === 1);
    if (!resolve) return margin ? 2 : 1;
    return layers[s] === 'P' ? 4 : margin ? 5 : 3;
  };
  return { hx, hy, mg, ms, nx, ny, nm, nz, grade, nPl, resolve, plates, onPl, nPap, Hs, plT, H, zi, nStackSeg, layers, xAxis, yAxis, zAxis, axes, mat };
}
function fmpStack(o) {
  fmpUse(o.props);
  const t0 = Date.now(), dim = o.dim, N = Math.max(1, Math.round(o.N)), h = o.h, tp = o.tp, go = o.go, P = o.paper;
  const { hx, hy, mg, ms, nx, ny, nm, grade, nPl, resolve, plates, onPl, nPap, Hs, plT, H, zi, layers, xAxis, yAxis, axes, mat } = fmpAxes(o);
  const iso = !!o.isothermal;
  const plT0 = o.plateT || 0;   // (a plate's thickness, for its gas)
  const fGO = N * h / Hs, fP = nPap * tp / Hs, nC = 2 * N;   // (the GO's and the papers' shares of the stack; its contacts)
  const Rc = resolve ? 0 : (o.Rc || 0), pa = (o.furnace && o.furnace.p) || 101325;
  const epsF = o.furnace ? o.furnace.eps : 0.8, useGas = !(o.furnace && o.furnace.gas === false);
  const M = FMP.mpMesh({ dim, p: 1, axes, mat });
  const zOf = x => (dim === 1 ? plT + Hs / 2 : x[zi]);
  // ---- the materials: conductivities (along, through), enthalpy per volume ----
  const kAr = T => fmpArgon(T, pa).k, epsGap = epsF;
  const kGap = T => kAr(T) + 4 * FMP.MP_SIGMA * epsGap / (2 - epsGap) * Math.pow(T + FMP_K0, 3) * h;   // (a gap a piece thick: argon and radiation across)
  // (the GO's, the papers' and the plates' conductivities at the temperature when defined in it, MH-4b; else constants)
  const gIn = fmpAtT(go.kInT, go.kIn), gThr = fmpAtT(go.kThrT, go.kThr), pIn = fmpAtT(P.kInT, P.kIn), pThr = fmpAtT(P.kThrT, P.kThr), plk = fmpAtT(o.plate.kT, o.plate.k);
  const kxS = u => fGO * gIn(u) + fP * pIn(u), kzS = u => Hs / (N * h / gThr(u) + nPap * tp / pThr(u) + nC * Rc);
  const rc = go.c / fmpCg(20);   // (the GO's heat capacity: graphite's scaled to its card's at the room)
  const vecK = (kx, kz) => (dim === 1 ? [kx, kx, kx] : dim === 2 ? [kx, kz, kz] : [kx, kx, kz]);
  const K = (m, u) => {
    if (m === 0) return plk(u);
    if (m === 1) return vecK(kxS(u), kzS(u));
    if (m === 2) return vecK(fP * pIn(u) + (1 - fP) * kAr(u), Hs / (nPap * tp / pThr(u) + N * h / kGap(u)));
    if (m === 3) return vecK(gIn(u), gThr(u));
    if (m === 4) return vecK(pIn(u), pThr(u));
    return vecK(kAr(u), kGap(u) * 1);
  };
  const goS = (u, f) => go.rho * (f.kept * rc * fmpHg(u) + f.wleft * go.Xin * FMP_P.waterCp * u), goC = (u, f) => go.rho * (f.kept * rc * fmpCg(u) + f.wleft * go.Xin * FMP_P.waterCp);
  const S = (m, u, x, f) => (m === 0 ? o.plate.rho * fmpHg(u) : m === 1 ? fGO * goS(u, f) + fP * P.rho * fmpHg(u) : m === 2 ? fP * P.rho * fmpHg(u) : m === 3 ? goS(u, f) : m === 4 ? P.rho * fmpHg(u) : 0);
  const C = (m, u, x, f) => (m === 0 ? o.plate.rho * fmpCg(u) : m === 1 ? fGO * goC(u, f) + fP * P.rho * fmpCg(u) : m === 2 ? fP * P.rho * fmpCg(u) : m === 3 ? goC(u, f) : m === 4 ? P.rho * fmpCg(u) : 1e-3);
  const phiOf = m => (m === 1 ? fGO : m === 3 ? 1 : 0);   // (the GO per volume of the material, as a share of a piece's)
  // ---- the chemistry at the nodes that hold GO ----
  const goNode = new Int32Array(M.N).fill(-1);
  let nGo = 0;
  for (let e = 0; e < M.E; e++) if (phiOf(M.mat[e]) > 0) for (let a = 0; a < M.npe; a++) { const n = M.conn[e * M.npe + a]; if (goNode[n] < 0) goNode[n] = nGo++; }
  const chem = FMP_FU.fuChem(o.chem), perKg = 1000 / chem.mGO, Xin = go.Xin || 0;
  const bins = o.bins || 41, stN = ['water', 'labile', 'stable', 'last', 'graph'];
  const ST = stN.map(k => FMP_FU.fuStage({ ...o.stages[k], nodes: bins }));
  // (per kg of dry GO: each stage's gas (mol), mass (kg), oxygen (mol); its heat (J): the water's latent heat taken, the labile oxygen's given)
  const nuG = [Xin / (FMP_FU.FU_M.H2O / 1000), ...chem.stages.map(s => s.gas * perKg), 0];
  const mS = [Xin, ...chem.stages.map(s => s.mass * perKg / 1000), 0], oS = [0, ...chem.stages.map(s => s.O), 0];
  const heatS = [-(o.Lw == null ? 2.26e6 : o.Lw) * Xin, o.Hr || 0, 0, 0, 0];
  const heatIdx = o.noChem ? [] : heatS.map((q, s) => (q ? s : -1)).filter(s => s >= 0);
  const I = ST.map(st => new Float64Array(nGo * st.E.length));
  const alpha = ST.map(() => new Float64Array(nGo));
  // (an energy whose integral over a step of dt is below 10⁻¹⁴ even at the step's hotter end: E / (R T) past this)
  const xCutOf = (st, dt) => Math.log(Math.max(st.A * dt, 1e-300)) + 32.24;
  const GL = [[0.0694318442029737, 0.1739274225687269], [0.3300094782075719, 0.3260725774312731], [0.6699905217924281, 0.3260725774312731], [0.9305681557970263, 0.1739274225687269]];
  /** A stage's rise at node g over the step (T0 → T1, K, in dt): [dα, ∂dα/∂T1] (the slope by Gauss–Legendre: only Newton's). */
  const rise = (s, g, TK0, TK1, dt, slope) => {
    const st = ST[s], nb = st.E.length, base = g * nb, R = FMP_FU.FU_R, xCut = xCutOf(st, dt) * R * Math.max(TK0, TK1);
    let da = 0, dd = 0;
    for (let k = 0; k < nb; k++) {
      const Ik = I[s][base + k];
      if (Ik >= 40 || st.E[k] > xCut) continue;   // (done, or too slow to move it by 10⁻¹⁴ over the step)
      const E = st.E[k], dI = st.A * FMP_FU.fuArrInt(E, TK0, TK1, dt);
      if (!(dI > 0)) continue;
      const left = st.w[k] * Math.exp(-Ik);
      da += left * -Math.expm1(-dI);
      if (slope) {
        let d = 0; for (const [sG, wG] of GL) { const T = TK0 + (TK1 - TK0) * sG; d += wG * sG * Math.exp(-E / (R * T)) * E / (R * T * T); }
        dd += left * Math.exp(-dI) * st.A * d * dt;
      }
    }
    return [da, dd];
  };
  // (per Newton iterate: the heat at each node, cached by its temperature)
  let dtNow = 1, Told = new Float64Array(M.N);
  const qT = new Float64Array(nGo).fill(NaN), qV = new Float64Array(nGo), qD = new Float64Array(nGo);
  const Qn = (m, n, u) => {
    const ph = phiOf(m), g = goNode[n];
    if (!(ph > 0) || g < 0 || !heatIdx.length) return [0, 0];
    if (qT[g] !== u) {
      let q = 0, d = 0;
      for (const s of heatIdx) { const [da, dd] = rise(s, g, Told[n] + FMP_K0, u + FMP_K0, dtNow, true); q += heatS[s] * da; d += heatS[s] * dd; }
      qT[g] = u; qV[g] = go.rho * q / dtNow; qD[g] = go.rho * d / dtNow;
    }
    return [ph * qV[g], ph * qD[g]];
  };
  // the fields the enthalpy uses (per node: the GO's mass kept, its water left), from the chemistry
  const kept = new Float64Array(M.N).fill(1), wleft = new Float64Array(M.N).fill(1);
  const fieldsNow = () => {
    for (let n = 0; n < M.N; n++) { const g = goNode[n]; if (g < 0) continue; let k = 1; for (let s = 1; s <= 3; s++) k -= alpha[s][g] * mS[s]; kept[n] = k; wleft[n] = 1 - alpha[0][g]; }
    return { kept: Float64Array.from(kept), wleft: Float64Array.from(wleft) };
  };
  // ---- the faces: the hot zone (radiation) and the argon (natural convection) ----
  let Tprog = 20;
  const Lh = (hx + mg) * (hy + mg) / (hx + mg + hy + mg), Hh = dim === 1 ? Hs : H;
  const sideF = dim === 1 ? ['x1'] : dim === 2 ? ['x1'] : o.sealY ? ['x1'] : ['x1', 'y1'];
  const topF = dim === 2 ? 'y1' : dim === 3 ? 'z1' : null, botF = dim === 2 ? 'y0' : dim === 3 ? 'z0' : null;
  const faces = [];
  if (!o.adiabatic) {
    for (const f of (o.sides === false ? [] : sideF)) faces.push([f, 'side']);
    if (plates) faces.push([topF, 'up'], [botF, 'down']);
  }
  const bc = [];
  for (const [f, kind] of faces) {
    bc.push({ face: f, type: 'rad', eps: () => epsF, uInf: () => Tprog });
    if (useGas) bc.push({ face: f, type: 'robin', h: (x, t, u) => fmpNat(kind, u, Tprog, kind === 'side' ? Hh : Lh, pa), uInf: () => Tprog });
  }
  const f0 = fieldsNow();
  // (the conduction at each step's start -- only the margin's gaps depend on the temperature, weakly -- so it is built
  //  once a step; Newton follows the capacity, the chemistry's heat and the faces)
  const Tr = iso ? null : FMP.mpTransport(M, { K, C, S, lump: true, Kstep: true, fields: f0, Qn, bc, u0: o.runs[0][0][1] - FMP_K0, picard: 40, tol: o.tol || 1e-9 });
  const Tn = iso ? new Float64Array(M.N).fill(o.runs[0][0][1] - FMP_K0) : Tr.u;
  // ---- sampling: the followed pieces (0 the bottom) at their middle plane ----
  const follow = dim === 1 ? [Math.floor((N - 1) / 2)] : (o.follow || [0, Math.floor((N - 1) / 2), N - 1]).filter((v, k, a) => v >= 0 && v < N && a.indexOf(v) === k);
  const zPiece = i => {
    if (resolve) { let z = plT; const idx = layers.reduce((acc, k, j) => (k === 'G' ? acc.concat(j) : acc), [])[i]; for (let j = 0; j < idx; j++) z += layers[j] === 'G' ? h : tp; return z + h / 2; }
    return plT + (onPl ? 0 : tp) + i * (h + tp) + h / 2;
  };
  const at = (f, xy, z) => FMP.mpAt(M, f, dim === 1 ? [xy[0]] : dim === 2 ? [xy[0], z] : [xy[0], xy[1], z]);
  // (the chemistry's fields at the nodes: the labile oxygen's conversion, the oxygen gone (share), graphitized)
  const nodal = (fn) => { const f = new Float64Array(M.N); for (let n = 0; n < M.N; n++) { const g = goNode[n]; f[n] = g < 0 ? NaN : fn(g); } return f; };
  const oGone = g => (alpha[1][g] * oS[1] + alpha[2][g] * oS[2] + alpha[3][g] * oS[3]) / chem.O0;
  // the gas along a paper: the in-plane mesh (the x (and y) of the heat's mesh), steady Darcy at each level
  const Mp = dim === 3 ? FMP.mpMesh({ dim: 2, p: 1, axes: [xAxis, yAxis] }) : FMP.mpMesh({ dim: 1, p: 1, axes: [xAxis] });
  const T20 = 293.15, R = FMP_FU.FU_R, gs = o.gas || {};
  const kapOf = T => P.D * Math.pow(T20 / (T + FMP_K0), 0.7) * tp / (R * (T + FMP_K0));
  // (the holder's plates, the top and bottom pieces on them (furnace.js's GO-7e): a plate's conductance through it per area of
  //  the piece, Darcy across its thickness to the surroundings, µ ∝ T^0.7 as the paper's -- given its permeability coefficient
  //  o.plate.B (m²/s at 20 °C); without one, every face a paper's, as before)
  const plB = o.plate && Number.isFinite(o.plate.B) ? o.plate.B : null;
  const plateFaces = i => (plB == null || !onPl ? 0 : N === 1 ? 2 : i === 0 || i === N - 1 ? 1 : 0);
  const cPlOf = TK => (plB > 0 && plT0 > 0 ? plB * Math.pow(T20 / TK, 0.7) / (R * TK * plT0) : 0);
  const inPiece = x => x[0] <= hx * (1 + 1e-9) && (Mp.dim === 1 || x[1] <= hy * (1 + 1e-9));
  const gasEdge = Mp.dim === 1 || o.sealY ? ['x1'] : ['x1', 'y1'];
  const dOf = g => { const spacerAll = Xin + chem.O0 * FMP_FU.FU_M.O * perKg / 1000, O = chem.O0 * (1 - oGone(g)), sp = (Xin * (1 - alpha[0][g]) + O * FMP_FU.FU_M.O * perKg / 1000) / Math.max(1e-30, spacerAll);
    return FMP_DG + (FMP_DT - FMP_DG) * (1 - alpha[4][g]) + ((gs.dIn || 0.8) - FMP_DT) * sp; };
  const Dof = (d, TK) => ((gs.Dmin || 0) + (gs.Dgal || 0) * Math.pow(Math.max(0, d - FMP_DG) / ((gs.dIn || 0.8) - FMP_DG), 2)) * Math.sqrt(TK / T20);
  const mA = go.rho * h;   // (dry GO per area of a piece, kg/m²)
  // (the load on piece i's papers, above the surroundings: the plate's weight, the papers and the pieces above it --
  //  spread over the paper's area; furnace.js's WsOf, the pieces counted from the top there)
  const paperW = P.rho * FMP_G * tp, shareA = o.Lx * o.Ly / ((o.Lx + 2 * mg) * (o.Ly + 2 * mg));
  const loadOf = (i, keptMean) => { const mTop = N - 1 - i; return paperW * (onPl ? mTop : mTop + 1) + (gs.plateP || 0) + mTop * mA * keptMean * FMP_G * shareA; };
  /**
   * The gas at piece i's level over the last step (Gstep: mol per m² of piece per s at each heat node), on the in-plane
   * mesh: under its paper (Darcy along the paper to its edges; where the gas passes the load the paper lifts and lets it
   * by -- u ≤ the load, as a stiff leak past it: Newton on it is the active set) and in the piece's middle, across it.
   */
  function gasAt(i, Gstep) {
    const z = zPiece(i), Tp = new Float64Array(Mp.N), Gp = new Float64Array(Mp.N), dp = new Float64Array(Mp.N), kp = new Float64Array(Mp.N);
    let km = 0, kc = 0;
    for (let k = 0; k < Mp.N; k++) {
      const xy = Array.from(Mp.X.subarray(k * Mp.dim, k * Mp.dim + Mp.dim));
      Tp[k] = at(Tn, xy, z); Gp[k] = inPiece(xy) ? Math.max(0, at(Gstep, xy, z)) : 0;
      kp[k] = at(kept, xy, z); if (inPiece(xy)) { km += kp[k]; kc++; }
    }
    // (its faces against the holder's plates: none between papers, one for the top and bottom pieces, both for a stack of one)
    const nPl = plateFaces(i), cap = loadOf(i, kc ? km / kc : 1);
    const G = { u: nPl === 2 ? new Float64Array(Mp.N) : fmpGasLevel(Mp, { T: Tp, G: Gp, cap, kap: kapOf, edges: gasEdge }) };
    // (across the piece, its middle above its faces: G R T h / (8 D) between papers, D its galleries' (their spacing from its
    //  chemistry); against a plate the slab with that face's own pressure, fmpSlabPeak)
    let uMax = 0, pMax = 0, plMax = 0, at_ = null;
    for (let k = 0; k < Mp.N; k++) {
      const xy = Array.from(Mp.X.subarray(k * Mp.dim, k * Mp.dim + Mp.dim)); if (!inPiece(xy)) continue;
      const TK = Tp[k] + FMP_K0, dd = dOfAt(xy, z), D = Dof(dd, TK), hc = h * dd / (gs.dIn || 0.8), w1 = Math.min(G.u[k], cap);
      if (!nPl || !(D > 0)) dp[k] = w1 + (D > 0 ? Gp[k] * R * TK * hc / (8 * D) : 0);
      else { const sl = fmpSlabPeak(Gp[k], D / (R * TK * hc), w1, nPl, cPlOf(TK), cap); dp[k] = sl.p; if (sl.w2 > plMax) plMax = sl.w2; }
      if (nPl < 2 && G.u[k] > uMax) uMax = w1;
      if (dp[k] > pMax) { pMax = dp[k]; at_ = xy; }
    }
    return { under: nPl === 2 ? plMax : uMax, ...(nPl ? { plate: plMax } : {}), middle: pMax, hold: (gs.sigZ || 0) + cap, load: cap, at: at_, u: Float64Array.from(G.u), p: dp };
  }
  let dField = null;
  const dOfAt = (xy, z) => at(dField, xy, z);
  // the stress in a followed piece: free in its plane; its natural size from its oxygen gone, graphitized and its heat
  const pl = o.plane || null;
  const Ms = !pl ? null : dim === 3 ? FMP.mpMesh({ dim: 2, p: 1, axes: [[{ L: hx, n: 2 * nx, grade, end: 'hi' }], [{ L: hy, n: 2 * ny, grade, end: 'hi' }]] })
    : FMP.mpMesh({ dim: 1, p: 1, axes: [[{ L: hx, n: 2 * nx, grade, end: 'hi' }]] });
  const Tref = o.runs[0][0][1] - FMP_K0;
  function pieceStress(i, eigF) {
    if (!Ms) return null;
    const z = zPiece(i), eps = new Float64Array(Ms.N);
    for (let k = 0; k < Ms.N; k++) { const xy = Array.from(Ms.X.subarray(k * Ms.dim, k * Ms.dim + Ms.dim)); eps[k] = at(eigF, xy, z); }
    if (Ms.dim === 1) {
      // the strip: σ_yy = E (ε̄ − ε*), ε̄ from no net force along its edge; σ_xx = 0
      let A = 0, B = 0; const g = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)], pts = [];
      for (let e = 0; e < Ms.E; e++) for (const s of g) {
        const a = Ms.conn[e * 2], b = Ms.conn[e * 2 + 1], w = (Ms.X[b] - Ms.X[a]) / 2, ev = ((1 - s) * eps[a] + (1 + s) * eps[b]) / 2;
        A += w; B += ev * w; pts.push([(Ms.X[a] + Ms.X[b]) / 2 + s * w, ev]);
      }
      const eb = B / A; let peak = -Infinity; const strip = pts.map(([x, ev]) => { const sg = pl.Ep * (eb - ev); if (sg > peak) peak = sg; return [x, sg]; });
      return { peak, strip };
    }
    const r = FMP.mpElastic(Ms, { mats: [{ E: pl.Ep, nu: pl.nu }], plane: 'stress', fields: { e: eps }, eig: (m, x, f) => [f.e, f.e, 0, 0, 0, 0], bc: [{ face: 'x0', fix: [0] }, { face: 'y0', fix: [1] }] });
    let peak = -Infinity; for (let k = 0; k < Ms.N; k++) if (r.s1[k] > peak) peak = r.s1[k];
    return { peak, s1: r.s1 };
  }
  // ---- the steps: each run's program in steps of at most dT kelvin (dTHigh above 400 °C) and dtMax seconds ----
  const dTlo = o.dT || 2, dThi = o.dTHigh || 10, dtMax = o.dtMax || 600;
  const plan = [];
  let tAbs = 0;
  for (const [r, pts] of o.runs.entries()) {
    const tStart = tAbs;
    for (let j = 1; j < pts.length; j++) {
      const [ta, Ta] = pts[j - 1], [tb, Tb] = pts[j], dT = Math.max(Ta, Tb) - FMP_K0 < 400 ? dTlo : dThi;
      const m = Math.max(1, Math.ceil(Math.abs(Tb - Ta) / dT), Math.ceil((tb - ta) / dtMax));
      for (let k = 1; k <= m; k++) plan.push({ run: r, t: tStart + ta + (tb - ta) * k / m, T: (Ta + (Tb - Ta) * k / m) - FMP_K0 });
    }
    tAbs = tStart + pts[pts.length - 1][0];
  }
  // (the snapshots' times: steps split to land on them)
  for (const ts of (o.snapTimes || [])) {
    const j = plan.findIndex(s => s.t >= ts - 1e-9);
    if (j < 0 || Math.abs(plan[j].t - ts) < 1e-9) continue;
    const prev = j ? plan[j - 1] : { t: 0, T: o.runs[0][0][1] - FMP_K0 }, w = (ts - prev.t) / (plan[j].t - prev.t);
    plan.splice(j, 0, { run: plan[j].run, t: ts, T: prev.T + (plan[j].T - prev.T) * w, snap: true });
  }
  const series = [], snaps = [], snapAt = new Set((o.snapTimes || []).map(t => +t.toFixed(6)));
  let aRef = 0, oRef = 0, Eface = 0, Ereact = 0, Eheld = 0, Ebetween = 0, tNow = 0, run = 0, Gnode = new Float64Array(M.N), eig = new Float64Array(M.N);
  const gasPk = follow.map(() => ({ ratio: 0, under: 0, middle: 0, hold: null, t: null, T: null, Tprog: null, run: null }));
  const record = (t, T) => {
    const pc = {}, aNod = nodal(g => alpha[1][g]), oNod = nodal(oGone);
    for (const [j, i] of follow.entries()) {
      const z = zPiece(i), mid = at(Tn, [0, 0], z), edge = at(Tn, [hx, hy], z);
      const aM = at(aNod, [0, 0], z), aE = at(aNod, [hx, hy], z), oM = at(oNod, [0, 0], z), oE = at(oNod, [hx, hy], z);
      const gz = gasAt(i, Gnode);
      if (gz && gz.middle / gz.hold > gasPk[j].ratio) Object.assign(gasPk[j], { ratio: gz.middle / gz.hold, middle: gz.middle, hold: gz.hold, under: gz.under, ...(gz.plate != null ? { plate: gz.plate } : {}), t, T: mid, Tprog: T, run });
      const stv = pieceStress(i, eig);
      pc[i] = { mid, edge, aM, aE, oM, oE, under: gz ? gz.under : null, middle: gz ? gz.middle : null, hold: gz ? gz.hold : null, pull: stv ? stv.peak / 1e6 : null };
    }
    // (over the GO: its coldest and hottest)
    let lo = Infinity, hi = -Infinity;
    for (let n = 0; n < M.N; n++) if (goNode[n] >= 0) { lo = Math.min(lo, Tn[n]); hi = Math.max(hi, Tn[n]); }
    series.push({ t, run, Tprog: T, lo, hi, aRef, oRef, pieces: pc });
    // (the stack at its most uneven, kept as a snapshot: where the runaway's front is)
    if (o.snapUneven && hi - lo > uneven.d + 1e-9) { uneven.d = hi - lo; uneven.snap = makeSnap(t, T); }
    // (and where its own heat takes it furthest above the program, heating: the runaway)
    const heating = series.length < 2 || T >= series[series.length - 2].Tprog - 1e-9;
    if (o.snapUneven && heating && hi - T > Math.max(1, over.d) + 1e-9) { over.d = hi - T; over.snap = makeSnap(t, T); }
  };
  const uneven = { d: 0, snap: null }, over = { d: 0, snap: null };
  const nzN = dim > 1 ? M.coord[zi].length : 1, nxN = M.coord[0].length;
  const section = f => Array.from({ length: nzN }, (_, kz) => Array.from({ length: nxN }, (_, kx) => f[M.node(dim === 1 ? [kx] : dim === 2 ? [kx, kz] : [kx, 0, kz])]));
  const makeSnap = (t, T) => ({ t, run, Tprog: T, secT: section(Tn), secA: section(nodal(g => alpha[1][g])), secO: section(nodal(oGone)),
    T: Float64Array.from(Tn), pieces: Object.fromEntries(follow.map(i => { const gz = gasAt(i, Gnode), sv = pieceStress(i, eig); return [i, { gas: gz.p, hold: gz.hold, s1: sv && sv.s1 ? Float64Array.from(sv.s1) : null, strip: sv ? sv.strip : null }]; })) });
  const snap = (t, T) => snaps.push(makeSnap(t, T));
  dField = nodal(dOf);
  record(0, Tn[0]);
  // one step of the heat and the chemistry (tA → tB, the program TpA → TpB); split in two where it fails or its
  // temperature jumps (GO's exotherm running away: its heat's slope beats the heat capacity over a long step)
  let molStep = null;
  function heatStep(tA, TpA, tB, TpB, depth) {
    const dt = tB - tA; Tprog = TpB; dtNow = dt; Told = Float64Array.from(Tn); qT.fill(NaN);
    let ok = true, Eb = 0, Er = 0, Eh = 0;
    if (iso) Tn.fill(TpB);
    else {
      Tr.setFields(fieldsNow());
      const before = Tr.stored(), it0 = Tr.iters;
      const guess = prevStep && prevStep.t === tA ? Told.map((v, n) => v + (v - prevStep.T[n]) * dt / prevStep.dt) : null;
      try { Tr.step(tB, dt, null, guess); } catch (e) { ok = false; splits.fail++; }
      if (ok) {
        // (Newton converged, and no node jumped more than jumpMax: a runaway is followed in steps of that much, its heat exact)
        let jump = 0; for (let n = 0; n < M.N; n++) if (goNode[n] >= 0) jump = Math.max(jump, Math.abs(Tn[n] - Told[n]));
        if (Tr.iters - it0 >= 40) { ok = false; splits.iters++; }
        else if (!(jump <= Math.max(jumpMax, 2 * Math.abs(TpB - TpA) + 5)) || !Tn.every(Number.isFinite)) { ok = false; splits.jump++; }
      }
      if (!ok && depth < 40) {
        deepest = Math.max(deepest, depth + 1);
        Tn.set(Told);
        const tm = (tA + tB) / 2, Tpm = (TpA + TpB) / 2;
        heatStep(tA, TpA, tm, Tpm, depth + 1); heatStep(tm, Tpm, tB, TpB, depth + 1);
        return;
      }
      if (!ok) throw new Error('furnace-mp: a step did not converge');
      let fin = 0; for (const [fc] of faces) fin += Tr.faceIn(fc);   // (every condition on the face: radiation and gas)
      Eb = fin * dt; Er = Tr.nodalIn() * dt; Eh = Tr.stored() - before;
    }
    Eface += Eb; Ereact += Er; Eheld += Eh; nSub++;
    prevStep = { t: tB, dt, T: Told };
    // the chemistry advanced at each node over the step (T0 → T1): the gas it made
    if (!o.noChem) for (let n = 0; n < M.N; n++) {
      const g = goNode[n]; if (g < 0) continue;
      const T0 = Told[n] + FMP_K0, T1 = Tn[n] + FMP_K0; let dN = 0;
      for (let s = 0; s < ST.length; s++) {
        const st_ = ST[s], nb = st_.E.length, base = g * nb, xCut = xCutOf(st_, dt) * FMP_FU.FU_R * Math.max(T0, T1); let a = 0;
        for (let kk = 0; kk < nb; kk++) { if (I[s][base + kk] < 40 && st_.E[kk] <= xCut) I[s][base + kk] += st_.A * FMP_FU.fuArrInt(st_.E[kk], T0, T1, dt); a -= st_.w[kk] * Math.expm1(-I[s][base + kk]); }
        dN += nuG[s] * (a - alpha[s][g]); alpha[s][g] = a;
      }
      molStep[n] += mA * dN;
      // (its natural size: shrunk as its oxygen leaves and it graphitizes, its heat's expansion less the paper's)
      if (pl) eig[n] = -(pl.bO || 0) * oGone(g) - (pl.bG || 0) * alpha[4][g] + (pl.am || 0) * (Tn[n] - Tref);
    }
  }
  let nSub = 0, TpNow = o.runs[0][0][1] - FMP_K0, prevStep = null;
  const splits = { fail: 0, iters: 0, jump: 0 };
  let level = 0, deepest = 0;
  const refST = ['water', 'labile', 'stable', 'last'].map(k => FMP_FU.fuStage({ ...o.stages[k], nodes: bins }));
  const jumpMax = o.jumpMax || 100;
  for (const [k, st] of plan.entries()) {
    const dt = st.t - tNow;
    if (!(dt > 0)) continue;
    run = st.run; molStep = new Float64Array(M.N);
    // (a new run: the stack cooled to the room between the runs, its chemistry as the last left it -- the heat it gave
    //  up then counted apart)
    const fresh = st.run !== (k ? plan[k - 1].run : 0), TpA = fresh ? o.runs[st.run][0][1] - FMP_K0 : TpNow;
    if (fresh && !iso) {
      Tr.setFields(fieldsNow()); const before = Tr.stored();
      Tn.fill(TpA); const after = Tr.stored();
      Ebetween += after - before; Eheld += after - before;
    } else if (fresh) Tn.fill(TpA);
    // (the step split as finely as the last one needed, less a level: a runaway then costs few failed tries)
    const nPart = 1 << level; deepest = level;
    for (let j = 0; j < nPart; j++) heatStep(tNow + (st.t - tNow) * j / nPart, TpA + (st.T - TpA) * j / nPart, tNow + (st.t - tNow) * (j + 1) / nPart, TpA + (st.T - TpA) * (j + 1) / nPart, level);
    level = Math.min(6, Math.max(0, deepest - 1));
    // (the labile oxygen at the program's own temperature: furnace.js's case, alongside)
    for (const q of refST) FMP_FU.fuAdvance(q, TpA + FMP_K0, st.T + FMP_K0, dt);
    aRef = FMP_FU.fuConv(refST[1]); oRef = (aRef * oS[1] + FMP_FU.fuConv(refST[2]) * oS[2] + FMP_FU.fuConv(refST[3]) * oS[3]) / chem.O0;
    Gnode = molStep.map(v => v / dt);
    dField = nodal(dOf);
    tNow = st.t; TpNow = st.T;
    record(st.t, st.T);
    if (snapAt.has(+st.t.toFixed(6))) snap(st.t, st.T);
    if (o.onProgress && (k % 20 === 0 || k === plan.length - 1)) o.onProgress({ k: k + 1, n: plan.length });
  }
  if (over.snap) snaps.push({ ...over.snap, mark: 'over' });
  if (uneven.snap) snaps.push({ ...uneven.snap, mark: 'uneven' });
  return { dim, series, snaps, follow, summary: fmpSummary(series, follow, o, gasPk),
    energy: { faces: Eface, reaction: Ereact, between: Ebetween, held: Eheld }, substeps: nSub, splits, iters: Tr ? Tr.iters : 0,
    // (the stages' conversions at the end at the middle piece's middle: water, labile, stable, last, graphitized)
    chemEnd: ST.map((_, s) => at(nodal(g => alpha[s][g]), [0, 0], zPiece(follow[0]))),
    mesh: { nodes: M.N, elems: M.E, goNodes: nGo, H, Hs, plT, coord: M.coord, zPiece: follow.map(zPiece), stressNodes: Ms ? Ms.N : 0, stressCoord: Ms ? Ms.coord : null, gasCoord: Mp.coord }, ms: Date.now() - t0 };
}

/**
 * The peak pressure above the surroundings inside a piece (Pa) that makes gas G evenly through it (mol/(m² s)), across which
 * the gas goes at K (mol/(m² s Pa), D/(R T h)): one face at w1 (its paper's) and the other against a plate (nPl 1), or both
 * against plates (nPl 2). A plate face lets the gas out through the plate at cPl (mol/(m² s Pa)); beyond the load cap the
 * piece lifts off it and that face is held at the load. The slab −K p″ = G exactly: p = w1 + (w2 − w1) ξ + B ξ (1 − ξ),
 * B = G/(2K), its peak w1 + B ξ*² at ξ* = ½ + (w2 − w1)/(2B), the plate face's flux G/2 − K (w2 − w1) = cPl w2 (furnace.js's
 * plate face, GO-7e). Returns { p, w1, w2 } (the faces' pressures).
 */
function fmpSlabPeak(G, K, w1, nPl, cPl, cap) {
  if (nPl === 2) { let w = cPl > 0 ? G / (2 * cPl) : Infinity; if (!(w < cap)) w = cap; return { p: w + G / (8 * K), w1: w, w2: w }; }
  let w2 = (G / 2 + K * w1) / (K + cPl); if (!(w2 < cap)) w2 = cap;
  if (!(G > 0)) return { p: Math.max(w1, w2), w1, w2 };
  const B = G / (2 * K), xs = 0.5 + (w2 - w1) / (2 * B);
  return { p: xs > 0 && xs < 1 ? w1 + B * xs * xs : Math.max(w1, w2), w1, w2 };
}

/**
 * The gas under a paper at one level of the stack (Darcy along the paper, steady: ∇·(κ(T) ∇u) + G = 0, u the pressure
 * above the surroundings, 0 at the paper's edges), where it passes the load `cap` the paper lifts and lets it by: u ≤ cap
 * (the obstacle problem; a stiff leak past the cap, 10⁴ times the largest source over it, Newton on it being the active
 * set). o: { T, G (nodal: °C, mol/(m² s)), cap (Pa), kap (T) → κ (mol/(s Pa)), edges (faces held at 0) }. Returns u.
 */
function fmpGasLevel(Mp, o) {
  let Gmax = 0; for (let k = 0; k < Mp.N; k++) Gmax = Math.max(Gmax, o.G[k]);
  const cap = o.cap, beta = Number.isFinite(cap) ? 1e4 * Math.max(Gmax, 1e-30) / Math.max(cap, 1) : 0;
  const G = FMP.mpTransport(Mp, { K: (m, u, x, f) => o.kap(f.T), Q: (m, u, x, t, f) => f.G, fields: { T: o.T, G: o.G },
    Qn: (m, n, u) => (u > cap ? [-beta * (u - cap), -beta] : [0, 0]), bc: o.edges.map(face => ({ face, type: 'value', u: 0 })), u0: 0, picard: 40, tol: 1e-12 });
  G.steady();
  return Float64Array.from(G.u);
}

/** The answers from a run's series: the lag behind the program, the overshoot, the spread across the GO, the labile oxygen's leaving, the gas, the pull. */
function fmpSummary(series, follow, o, gasPk) {
  const N = Math.max(1, Math.round(o.N)), mid = follow.includes(Math.floor((N - 1) / 2)) ? Math.floor((N - 1) / 2) : follow[0];
  const byRun = r => series.filter(s => s.run === r);
  const runs = o.runs.map((_, r) => {
    const S = byRun(r);
    // (heating and holding: how far the coldest GO is behind the program, the hottest above it (its own heat); cooling:
    //  how far the hottest is behind; all the time: the spread across the GO)
    let lag = 0, lagAt = null, over = 0, overAt = null, cool = 0, coolAt = null, spread = 0, spreadAt = null;
    for (let k = 0; k < S.length; k++) {
      const s = S[k], prev = k ? S[k - 1].Tprog : s.Tprog, cooling = s.Tprog < prev - 1e-9;
      if (!cooling) {
        const l = s.Tprog - s.lo; if (l > lag) { lag = l; lagAt = { t: s.t, T: s.Tprog }; }
        const v = s.hi - s.Tprog; if (v > over) { over = v; overAt = { t: s.t, T: s.Tprog }; }
      } else { const c = s.hi - s.Tprog; if (c > cool) { cool = c; coolAt = { t: s.t, T: s.Tprog }; } }
      const d = s.hi - s.lo; if (d > spread) { spread = d; spreadAt = { t: s.t, T: s.Tprog }; }
    }
    return { lag, lagAt, over, overAt, cool, coolAt, spread, spreadAt };
  });
  // (the labile oxygen half gone: the middle piece's middle and edge -- the time and the program's temperature)
  const half = key => { for (let k = 1; k < series.length; k++) { const a = series[k - 1].pieces[mid], b = series[k].pieces[mid]; if (a[key] < 0.5 && b[key] >= 0.5) { const w = (0.5 - a[key]) / (b[key] - a[key]); return { t: series[k - 1].t + w * (series[k].t - series[k - 1].t), T: series[k - 1].pieces[mid][key === 'aM' ? 'mid' : 'edge'] + w * (b[key === 'aM' ? 'mid' : 'edge'] - a[key === 'aM' ? 'mid' : 'edge']), Tprog: series[k - 1].Tprog + w * (series[k].Tprog - series[k - 1].Tprog) }; } } return null; };
  // (at the program's own temperature: furnace.js's case)
  let labileRef = null;
  for (let k = 1; k < series.length && !labileRef; k++) { const a = series[k - 1].aRef, b = series[k].aRef; if (a < 0.5 && b >= 0.5) { const w = (0.5 - a) / (b - a); labileRef = { t: series[k - 1].t + w * (series[k].t - series[k - 1].t), Tprog: series[k - 1].Tprog + w * (series[k].Tprog - series[k - 1].Tprog) }; } }
  let pull = 0, pullAt = null;
  for (const s of series) for (const i of follow) { const p = s.pieces[i].pull; if (p != null && p > pull) { pull = p; pullAt = { t: s.t, piece: i, T: s.Tprog }; } }
  return { runs, labileMid: half('aM'), labileEdge: half('aE'), labileRef, gas: follow.map((i, j) => ({ i, ...gasPk[j] })), pull, pullAt, mid };
}

if (typeof module !== 'undefined') module.exports = { fmpStack, fmpAxes, fmpSummary, fmpGasLevel, fmpSlabPeak, fmpCg, fmpHg, fmpArgon, fmpNat, fmpUse, FMP_PROPS };
