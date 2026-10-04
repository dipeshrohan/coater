/*
 * stack-mp.js — MP-1: the pressed stack in the pre heat treatment in 1D, 2D and 3D, its heat, its water and its stress
 * solved together (mp-core.js). Pure computation, no DOM: the sheet worker and Node.
 *
 * The stack (Q77, Q78): N pieces directly on each other under an aluminium plate the pieces' size, put in the oven at
 * the room's temperature; after the oven it stays under the plate in the room. What press.js takes as given -- the pieces
 * at the oven's temperature from the start -- is solved here: the stack heats up, and its drying cools it.
 *
 *  - Heat and water together (mpHeatMoisture): the temperature T and the vapour's pressure p in the plate and the
 *    pieces; the water a piece holds S = ρS X, X = GAB(p / p_sat(T)) up to its pores' cap (press.js's isotherm); the
 *    vapour moves along the pieces at their in-plane permeability (press.js's K: the Film card) and through them at the
 *    GO laminate's (the Drying card's skin permeability); drying takes its latent heat where the water leaves:
 *      ∂(ρc T − L S)/∂t = ∇·(k ∇T),   ∂S/∂t = ∇·(K_v ∇p).
 *    At the air's temperature all through this is press.js's equation (checked against it).
 *  - The faces: the oven's air (natural convection from the correlations: the plate's top facing up and the stack's
 *    underside facing down (drying.js's drNat), the sides vertical (Churchill–Chu); or a fan's air along them, a flat
 *    plate) and radiation to the walls at the air's temperature; the underside on a wire shelf (air and radiation
 *    below it; its vapour to the air by the analogy's coefficient) or on a solid shelf at the air's temperature (sealed).
 *    At the stack's edges the air's vapour pressure (the room's air heated: the same in the oven and the room).
 *  - Stress: each followed piece held flat by the plate but free in its plane (press.js: no friction under a light
 *    plate), its natural stretch its water's (the film's rows by water, press.js's) and its heat's (α_f), its stiffness
 *    its water's; each point a Maxwell body whose creep's rate goes as its water (press.js's creep), stepped implicitly.
 *
 * The dimensions (the same physics, fewer directions):
 *  - 1D: through the stack at its middle (z). Far from the edges the water cannot leave along the pieces: only through
 *    them (the laminate's permeability) at the underside on a wire shelf. No stress: a piece's middle is even.
 *  - 2D: a section from the stack's middle to an edge (x, z), the stack taken long across (y). Each piece's stress along
 *    its edge (σ_yy; σ_xx = 0: free along x, even along y).
 *  - 3D: a quarter of the stack (x, y, z; its mirror planes). Each piece's stress in its plane (plane stress).
 * SI inside (m, s, kg, Pa); temperatures in °C.
 */
const SMP = typeof mpMesh === 'function' ? { mpMesh, mpHeatMoisture, mpElastic, mpAt } : require('./mp-core.js');
const SMP_DR = typeof drPsat === 'function' ? { drPsat, drLatent, drNat, drAir, drUse } : require('./drying.js');
const SMP_PR = typeof prGAB === 'function' ? { prGAB, prGABslope, prActivity, prProps } : require('./press.js');
const SMP_ML = typeof mlQEval === 'function' ? { mlQEval } : require('./matlib.js');
/** A property in temperature (MH-4b): its definition q (matlib's, in kelvin) at T (°C), else its constant v. */
const smpAtT = (q, v) => (q ? T => SMP_ML.mlQEval(q, { T: T + 273.15 }) : () => v);

const SMP_AL = { k: 200, rho: 2700, c: 900 };   // aluminium (plate): W/(m K) (alloys 150–235), kg/m³, J/(kg K)
const SMP_CW = 4180;                            // liquid water's specific heat, J/(kg K)
const SMP_G = 9.80665, SMP_R = 8.314462618, SMP_MW = 0.018015268;

/**
 * The air's coefficients on a face at Ts in air at Ta: heat h (W/(m² K)) and the vapour's transfer coefficient per
 * pressure beta (kg/(m² s Pa)). Natural convection (up: the plate's top; down: the underside, drying.js's drNat; side:
 * a vertical face of height L, Churchill–Chu) or a fan's air along it (a flat plate of length air.Lfan: Nu = 0.664
 * Re^½ Pr^⅓, turbulent past Re 5 × 10⁵: 0.037 Re^0.8 Pr^⅓); the vapour by the analogy, Sh = Nu (Sc/Pr)^⅓.
 */
function smpAir(kind, Ts, Ta, L, air) {
  if (Math.abs(Ts - Ta) < 1e-6) Ts = Ta + 1e-6;
  const pa = air.p || 101325, Tf = (Ts + Ta) / 2, a = SMP_DR.drAir(Tf, pa), beta = km => km * SMP_MW / (SMP_R * (Tf + 273.15));
  if (air.fan > 0) {
    const Lf = air.Lfan, Re = air.fan * Lf / a.nu;
    const Nu = Re < 5e5 ? 0.664 * Math.sqrt(Re) * Math.cbrt(a.Pr) : 0.037 * Math.pow(Re, 0.8) * Math.cbrt(a.Pr);
    return { h: Nu * a.k / Lf, beta: beta(Nu * Math.cbrt(a.Sc / a.Pr) * a.Dv / Lf) };
  }
  if (kind === 'side') {
    const Ra = SMP_G / (Tf + 273.15) * Math.abs(Ts - Ta) * L * L * L / (a.nu * a.alpha);
    const Nu = Math.pow(0.825 + 0.387 * Math.pow(Ra, 1 / 6) / Math.pow(1 + Math.pow(0.492 / a.Pr, 9 / 16), 8 / 27), 2);
    return { h: Nu * a.k / L, beta: beta(Nu * Math.cbrt(a.Sc / a.Pr) * a.Dv / L) };
  }
  const n = SMP_DR.drNat(Ts, Ta, air.pv, air.pv, L, pa, kind);
  return { h: n.h, beta: beta(n.km) };
}

/**
 * The stack's domain and mesh (MP-W: the solve's and the page's drawing alike): the pieces one element each through (or
 * per pieces an element), the plate graded toward its faces; in their plane graded to the stack's edges. o: smpStack's
 * (dim, Lx, Ly, N, h, plateT, mesh). Returns { hx, hy (the half sizes), Hs (the pieces' height), H (with the plate), zi
 * (the axis up), nEl (the elements through the pieces), nPl (through the plate), per, nx, ny, grade, ms, axes (mpMesh's),
 * mat (ijk, seg) → 0 the pieces, 1 the plate }.
 */
function smpAxes(o) {
  const dim = o.dim, N = o.N, hp = o.h, hx = o.Lx / 2, hy = o.Ly / 2, ms = o.mesh || {}, nx = ms.nx || 8, ny = ms.ny || nx, grade = ms.grade || 12, nPl = ms.nPlate || 4;
  const Hs = N * hp, H = Hs + o.plateT, zi = dim - 1;
  // (per: the pieces an element holds through the stack -- the heat and water vary smoothly across a few)
  const per = Math.max(1, Math.min(N, ms.per || 1)), nEl = Math.ceil(N / per);
  const zAxis = [...Array(nEl)].map((_, k) => ({ L: hp * Math.min(per, N - k * per), n: 1 })).concat([{ L: o.plateT, n: nPl, grade: 3, end: 'both' }]);
  const xAxis = [{ L: hx, n: nx, grade, end: 'hi' }], yAxis = [{ L: hy, n: ny, grade, end: 'hi' }];
  const axes = dim === 1 ? [zAxis] : dim === 2 ? [xAxis, zAxis] : [xAxis, yAxis, zAxis];
  return { hx, hy, Hs, H, zi, nEl, nPl, per, nx, ny, grade, ms, axes, mat: (ijk, seg) => (seg[zi] < nEl ? 0 : 1) };
}
/**
 * The stack in the pre heat treatment and after it. o: {
 *   dim: 1 | 2 | 3, Lx, Ly (m, the pieces), N (pieces), h (m, a piece), plateT (m, the plate), X0 (the water as cut),
 *   Troom (°C: the stack at the start, the room), rhRoom, stages: [{ tEnd (s), Tair (°C), creep (bool) }] (the oven,
 *   then the room under the plate), air: { fan (m/s; 0: still air) }, shelf: 'wire' | 'solid', epsPlate, epsGO,
 *   al: { k, rho, c } (the plate's aluminium; MH-2: the Materials' constants, SMP_AL when not given); go's kIn, kThr, c
 *   and al's k, c each with its definition in temperature when it has one (kInT, kThrT, cT, kT: matlib quantities in K, MH-4b),
 *   go: { kIn, kThr (W/(m K)), c (J/(kg K)), rhoS (kg/m³, the GO per film volume), gab, Xcap, K (along a piece),
 *   Kthr (through it; kg/(m s Pa)), alpha (1/K, in its plane), nu, tab (the film's rows [X, A, D, eFlat, κ]), tau (s,
 *   the creep time at X0) },
 *   mesh: { nx, ny (in-plane elements on the quarter, graded to the edges), grade, nPlate, ns (the stress mesh's), per
 *   (the pieces in an element through the stack; default 1) },
 *   steps (per stage), follow: [piece indices, 0 the bottom], isothermal: true (the air's temperature everywhere from
 *   the start, no heat solved: press.js's case), sides: false (the stack's sides sealed and insulated: the checks'),
 *   XdryTo (the water the middle piece's middle is dry at),
 *   snapTimes (s: the fields kept), onProgress ({ k, n }) }.
 * Returns { dim, series [{ t, stage, Tair, T: { plateTop, top, mid, bottom, midEdge, bottomEdge }, X: { i: [mean,
 *   middle] }, pull: { i: MPa } }], snaps [{ t, stage, T, X (at the mesh's nodes), pieces: { i: { s1 | strip, X, T } } }],
 *   summary, energy { in, held, rise }, water { out, lostHeld, lost, start } (held: the scheme's count of the change,
 *   equal to what flowed in and out, exactly; rise, lost: start to end), mesh, ms }.
 */
function smpStack(o) {
  // (the built-in laws, the material hub's when edited: the air's and water's through drying.js, MC-1b)
  if (SMP_DR.drUse) SMP_DR.drUse(o.props);
  const SMP_CWo = o.props && Number.isFinite(o.props.waterCp) ? o.props.waterCp : SMP_CW;
  const t0 = Date.now(), dim = o.dim, N = o.N, hp = o.h, go = o.go, AL = o.al || SMP_AL;
  // (each conductivity and heat capacity at the point's temperature when defined in T, MH-4b; else its constant)
  const kInT = smpAtT(go.kInT, go.kIn), kThrT = smpAtT(go.kThrT, go.kThr), cT = smpAtT(go.cT, go.c), alkT = smpAtT(AL.kT, AL.k), alcT = smpAtT(AL.cT, AL.c);
  const { hx, hy, ms, nx, ny, grade, Hs, H, zi, nEl, axes, mat } = smpAxes(o);
  const pvAir = o.rhRoom * SMP_DR.drPsat(o.Troom);   // the room's air, heated in the oven: the same vapour pressure
  const air = { fan: (o.air && o.air.fan) || 0, pv: pvAir, Lfan: o.Lx };
  const M = SMP.mpMesh({ dim, p: 1, axes, mat });   // 0 the pieces, 1 the plate
  // ---- the pieces' water: the isotherm at the local temperature, capped at the pores' ----
  const GAB = a => SMP_PR.prGAB(a, go.gab), dGAB = a => SMP_PR.prGABslope(a, go.gab);
  const aCap = go.Xcap < GAB(1) ? SMP_PR.prActivity(go.Xcap, go.gab) : 1, Xc = GAB(aCap), sl = 1e-3 * dGAB(aCap);
  const Xa = a => (a <= aCap ? GAB(Math.max(0, a)) : Xc + sl * (a - aCap));   // (past the cap a tiny slope: the step stays solvable)
  const dXa = a => (a <= aCap ? dGAB(Math.max(0, a)) : sl);
  const XofPT = (p, T) => Xa(p / SMP_DR.drPsat(T));
  const S = (m, p, T) => go.rhoS * XofPT(p, T);
  const dS = (m, p, T) => {
    const ps = SMP_DR.drPsat(T), a = p / ps, d = dXa(a), dps = (SMP_DR.drPsat(T + 1e-3) - SMP_DR.drPsat(T - 1e-3)) / 2e-3;
    return [go.rhoS * d / ps, -go.rhoS * d * a * dps / ps];
  };
  const iso = !!o.isothermal, Tstart = iso ? o.stages[0].Tair : o.Troom;
  const p0 = Math.min(SMP_PR.prActivity(o.X0, go.gab), aCap) * SMP_DR.drPsat(Tstart);   // (its water as cut, at the stack's start temperature)
  let stage = 0, Tair = o.stages[0].Tair;
  // ---- the faces ----
  const Lh = hx * hy / (hx + hy);   // a horizontal face's area / perimeter (the whole piece's)
  const top = dim === 1 ? 'x1' : dim === 2 ? 'y1' : 'z1', bot = dim === 1 ? 'x0' : dim === 2 ? 'y0' : 'z0';
  const sides = dim === 2 ? ['x1'] : dim === 3 ? ['x1', 'y1'] : [];
  const inStack = x => x[zi] <= Hs * (1 + 1e-9);
  const bcT = [{ face: top, type: 'robin', h: (x, t, u) => smpAir('up', u, Tair, Lh, air).h, uInf: () => Tair },
    { face: top, type: 'rad', eps: () => o.epsPlate, uInf: () => Tair }];
  const bcV = [];
  if (o.shelf === 'solid') bcT.push({ face: bot, type: 'value', u: () => Tair });
  else {
    bcT.push({ face: bot, type: 'robin', h: (x, t, u) => smpAir('down', u, Tair, Lh, air).h, uInf: () => Tair }, { face: bot, type: 'rad', eps: () => o.epsGO, uInf: () => Tair });
    bcV.push({ face: bot, type: 'robin', h: (x, t, T) => smpAir('down', T, Tair, Lh, air).beta, uInf: () => pvAir });
  }
  for (const f of (o.sides === false ? [] : sides)) {
    bcT.push({ face: f, type: 'robin', h: (x, t, u) => smpAir('side', u, Tair, H, air).h, uInf: () => Tair }, { face: f, type: 'rad', eps: x => (inStack(x) ? o.epsGO : o.epsPlate), uInf: () => Tair });
    bcV.push({ face: f, type: 'value', u: () => pvAir, where: inStack });
  }
  // ---- the solver (isothermal: every face held at the air's temperature and no heat through the stack -- the check's case) ----
  const vec3 = (a, b) => (dim === 1 ? b : dim === 2 ? [a, b] : [a, a, b]);
  const faces = dim === 1 ? ['x0', 'x1'] : dim === 2 ? ['x0', 'x1', 'y0', 'y1'] : ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'];
  const hm = SMP.mpHeatMoisture(M, {
    kT: (m, T) => (iso ? 1e6 : m === 1 ? alkT(T) : vec3(kInT(T), kThrT(T))),
    // (a piece's heat capacity with its water as cut)
    CT: (m, T) => (m === 1 ? AL.rho * alcT(T) : go.rhoS * (cT(T) + o.X0 * SMP_CWo)),
    Kv: () => vec3(go.K, go.Kthr), S, dS, L: iso ? 0 : T => SMP_DR.drLatent(T), wet: m => m === 0,
    T0: Tstart, p0: x => (inStack(x) ? p0 : pvAir),
    bcT: iso ? faces.map(face => ({ face, type: 'value', u: () => Tair })) : bcT,
    bcV, iters: 40, tol: o.tol || 1e-6, nodal: true, bdf2: true });
  // ---- sampling: a piece's middle plane ----
  const zmid = i => (i + 0.5) * hp;
  const at = (f, xy, z) => SMP.mpAt(M, f, dim === 1 ? [z] : dim === 2 ? [xy[0], z] : [xy[0], xy[1], z]);
  const Xfield = () => { const X = new Float64Array(M.N); for (let n = 0; n < M.N; n++) X[n] = hm.wetNode[n] ? XofPT(hm.p[n], hm.T[n]) : 0; return X; };
  // the stress mesh (a piece's plane, or its strip), finer than the heat's in its plane
  const ns = ms.ns || 2 * nx;
  const Ms = dim === 3 ? SMP.mpMesh({ dim: 2, p: 1, axes: [[{ L: hx, n: ns, grade, end: 'hi' }], [{ L: hy, n: ns, grade, end: 'hi' }]] })
    : dim === 2 ? SMP.mpMesh({ dim: 1, p: 1, axes: [[{ L: hx, n: ns, grade, end: 'hi' }]] }) : null;
  const follow = (o.follow || [0, Math.floor(N / 2), N - 1]).filter((v, k, a) => v >= 0 && v < N && a.indexOf(v) === k);
  const p0r = SMP_PR.prProps(go.tab, o.X0), A0 = p0r[1], E0 = A0 / hp, e0 = p0r[3];
  const sOf = (X, T) => { const P = SMP_PR.prProps(go.tab, X); return { E: P[1] / hp, eps: P[3] - e0 + (go.alpha || 0) * (T - o.Troom) }; };
  const tauAt = X => (go.tau > 0 ? go.tau * o.X0 / Math.max(X, 1e-6) : Infinity);
  const planeOf = (i, X) => {
    const z = zmid(i);
    if (!Ms) return { X: [at(X, [0, 0], z)], T: [at(hm.T, [0, 0], z)] };
    const pX = new Float64Array(Ms.N), pT = new Float64Array(Ms.N);
    for (let k = 0; k < Ms.N; k++) { const xy = Array.from(Ms.X.subarray(k * Ms.dim, k * Ms.dim + Ms.dim)); pX[k] = at(X, xy, z); pT[k] = at(hm.T, xy, z); }
    return { X: pX, T: pT };
  };
  const meanOn = f => {   // the mean over the piece's plane (the stress mesh's elements)
    if (!Ms) return f[0];
    let s = 0, a = 0;
    for (let e = 0; e < Ms.E; e++) {
      const c = Array.from(Ms.conn.subarray(e * Ms.npe, (e + 1) * Ms.npe)), xs = c.map(n => Ms.X[n * Ms.dim]), ys = Ms.dim === 2 ? c.map(n => Ms.X[n * 2 + 1]) : [0, 1];
      const w = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      let v = 0; for (const n of c) v += f[n] / c.length;
      s += v * w; a += w;
    }
    return s / a;
  };
  const st = {}; for (const i of follow) st[i] = { ec: null, peak: 0, s1: null, strip: null };
  function pieceStress(i, pl, dt, creep) {
    const S_ = st[i];
    if (!Ms) { S_.peak = 0; return; }
    if (Ms.dim === 1) {
      // the strip: σ_xx = 0; σ_yy = E' (ε̄ − ε* − ε_c), E' = E / (1 + r), ε̄ from no net force along its edge
      const g = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
      if (!S_.ec) S_.ec = new Float64Array(Ms.E * 2);
      const pts = []; let A = 0, B = 0;
      for (let e = 0; e < Ms.E; e++) for (let q = 0; q < 2; q++) {
        const a = Ms.conn[e * 2], b = Ms.conn[e * 2 + 1], w = (Ms.X[b] - Ms.X[a]) / 2, s = g[q];
        const X = ((1 - s) * pl.X[a] + (1 + s) * pl.X[b]) / 2, T = ((1 - s) * pl.T[a] + (1 + s) * pl.T[b]) / 2;
        const { E, eps } = sOf(X, T), r = creep && dt > 0 ? dt / tauAt(X) : 0, Ep = E / (1 + r), k = e * 2 + q;
        A += Ep * w; B += Ep * (eps + S_.ec[k]) * w;
        pts.push({ k, Ep, eps, r, x: (Ms.X[a] + Ms.X[b]) / 2 + s * w });
      }
      const eb = B / A; let peak = -Infinity; S_.strip = [];
      for (const p of pts) {
        const el = eb - p.eps - S_.ec[p.k], sig = p.Ep * el;   // ((1 + r) times the step's elastic strain: the creep takes r of it)
        S_.ec[p.k] += p.r * el / (1 + p.r);
        S_.strip.push([p.x, sig]); if (sig > peak) peak = sig;
      }
      S_.peak = peak; return;
    }
    if (!S_.ec) S_.ec = new Float64Array(Ms.E * 4 * 3);
    const rAt = new Float64Array(Ms.E * 4);
    const r = SMP.mpElastic(Ms, { mats: [{ E: E0, nu: go.nu }], plane: 'stress', fields: { X: pl.X, T: pl.T },
      scale: (m, x, f, e, qi) => { const k = e * 4 + qi, rr = creep && dt > 0 ? dt / tauAt(f.X) : 0; rAt[k] = rr; return sOf(f.X, f.T).E / E0 / (1 + rr); },
      eig: (m, x, f, e, qi) => { const k = e * 4 + qi, es = sOf(f.X, f.T).eps; return [es + S_.ec[3 * k], es + S_.ec[3 * k + 1], 0, 0, 0, S_.ec[3 * k + 2]]; },
      bc: [{ face: 'x0', fix: [0] }, { face: 'y0', fix: [1] }] });
    let peak = -Infinity;
    for (const gp of r.gp) {
      const k = gp.e * 4 + gp.qi, el = gp.elastic, f = rAt[k] / (1 + rAt[k]);
      S_.ec[3 * k] += f * el[0]; S_.ec[3 * k + 1] += f * el[1]; S_.ec[3 * k + 2] += f * el[5];
      const s = gp.stress, s1 = (s[0] + s[1]) / 2 + Math.hypot((s[0] - s[1]) / 2, s[5]);
      if (s1 > peak) peak = s1;
    }
    S_.peak = peak; S_.s1 = r.s1;
  }
  // ---- the steps: press.js's (each stage geometric, its last a twentieth of it) ----
  const stepsOf = (tEnd, steps) => {
    let rr = 1; { let lo = 1, hi = 2; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, f = (m - 1) * Math.pow(m, steps - 1) / (Math.pow(m, steps) - 1); if (f > 0.05) hi = m; else lo = m; } rr = (lo + hi) / 2; }
    if (steps <= 20) rr = 1;
    const s0 = rr > 1 ? tEnd * (rr - 1) / (Math.pow(rr, steps) - 1) : tEnd / steps;
    return Array.from({ length: steps }, (_, k) => s0 * Math.pow(rr, k));
  };
  const nSteps = o.steps || 60, mid = Math.floor(N / 2), total = o.stages.length * nSteps + (o.snapTimes || []).length;
  const series = [], snaps = [], snapAt = (o.snapTimes || []).slice().sort((a, b) => a - b);
  let X = Xfield();
  const planes = {};
  const record = t => {
    const T = { plateTop: at(hm.T, [0, 0], H), top: at(hm.T, [0, 0], zmid(N - 1)), mid: at(hm.T, [0, 0], zmid(mid)), bottom: at(hm.T, [0, 0], zmid(0)),
      midEdge: dim > 1 ? at(hm.T, [hx, hy], zmid(mid)) : null, bottomEdge: dim > 1 ? at(hm.T, [hx, hy], zmid(0)) : null };
    const Xs = {}, pull = {};
    for (const i of follow) { const pl = planes[i]; Xs[i] = [meanOn(pl.X), pl.X[0]]; pull[i] = st[i].peak / 1e6; }
    series.push({ t, stage, Tair, T, X: Xs, pull });
  };
  // (a section through the stack at its middle across (y = 0): rows up the stack (z), columns from its middle out (x))
  const nzN = M.coord[zi].length, nxN = dim > 1 ? M.coord[0].length : 1;
  const section = f => Array.from({ length: nzN }, (_, kz) => Array.from({ length: nxN }, (_, kx) => f[M.node(dim === 1 ? [kz] : dim === 2 ? [kx, kz] : [kx, 0, kz])]));
  const snap = t => snaps.push({ t, stage, secT: section(hm.T), secX: section(X), T: Float64Array.from(hm.T), X: Float64Array.from(X),
    pieces: Object.fromEntries(follow.map(i => [i, { s1: st[i].s1 ? Float64Array.from(st[i].s1) : null, strip: st[i].strip, X: Float64Array.from(planes[i].X), T: Float64Array.from(planes[i].T) }])) });
  for (const i of follow) planes[i] = planeOf(i, X);
  // the balances: the heat in through the faces and the water out, against what the stack holds
  const W0 = hm.water(), H0 = hm.enthalpy();
  let Qin = 0, Vin = 0, heldH = 0, heldW = 0, t = 0, k = 0;
  const heatFaces = [...new Set(bcT.map(b => b.face))], vapFaces = [...new Set(bcV.map(b => b.face))];
  record(0);
  if (snapAt.length && snapAt[0] <= 0) { snapAt.shift(); snap(0); }
  for (const [si, Sg] of o.stages.entries()) {
    stage = si; Tair = Sg.Tair;
    // (the stage's steps, split where a snapshot falls inside one: the fields at exactly its time)
    const tS = t, ends = []; let acc = tS;
    for (const d of stepsOf(Sg.tEnd, nSteps)) { acc += d; ends.push(acc); }
    ends[ends.length - 1] = tS + Sg.tEnd;
    for (const ts of snapAt) if (ts > tS + 1e-9 && ts < tS + Sg.tEnd - 1e-9 && !ends.some(e => Math.abs(e - ts) < 1e-9)) ends.push(ts);
    ends.sort((p, q) => p - q);
    for (const te of ends) {
      const dt = te - t; t = te; k++;
      hm.step(t, dt);
      if (!iso) for (const f of heatFaces) Qin += (o.shelf === 'solid' && f === bot ? hm.heatInHeld(f) : hm.heatIn(f)) * dt;
      Vin += hm.vapourIn(vapFaces) * dt;
      heldH += hm.stepHeld.H; heldW += hm.stepHeld.W;
      X = Xfield();
      for (const i of follow) { planes[i] = planeOf(i, X); pieceStress(i, planes[i], dt, Sg.creep); }
      record(t);
      while (snapAt.length && snapAt[0] <= t + 1e-9) { snapAt.shift(); snap(t); }
      if (o.onProgress) o.onProgress({ k, n: total });
    }
  }
  if (!snaps.length || snaps[snaps.length - 1].t !== t) snap(t);
  return { dim, series, snaps, summary: smpSummary(series, o, follow), follow,
    // (the balances as the scheme counts what is held (BDF2), exact; and the change of what is held, start to end)
    energy: { in: Qin, held: heldH, rise: hm.enthalpy() - H0 }, water: { out: -Vin, lostHeld: -heldW, lost: W0 - hm.water(), start: W0 },
    mesh: { nodes: M.N, elems: M.E, unknowns: 2 * M.N, stressNodes: Ms ? Ms.N : 0, H, Hs, coord: M.coord, stressCoord: Ms ? Ms.coord : null }, ms: Date.now() - t0 };
}

/** The answers from a run's series: when the middle piece is within 2 °C of the air, the temperatures at the oven's end, dry-through, the water out, the pull. */
function smpSummary(series, o, follow) {
  const oven = series.filter(s => s.stage === 0), last0 = oven[oven.length - 1], Tset = o.stages[0].Tair, mid = Math.floor(o.N / 2);
  const within = oven.find(s => s.T.mid >= Tset - 2);
  const dry = o.XdryTo != null && follow.includes(mid) ? oven.find(s => s.X[mid][1] <= o.XdryTo) : null;
  const end = series[series.length - 1];
  let pull = 0, pullAt = null;
  for (const s of series) for (const i of follow) if (s.pull[i] > pull) { pull = s.pull[i]; pullAt = { t: s.t, piece: i }; }
  return {
    midWithin2: within ? within.t : null, ovenEnd: last0.T,
    dryThrough: dry ? dry.t : null, Xoven: follow.map(i => ({ i, mean: last0.X[i][0], middle: last0.X[i][1] })), Xout: follow.map(i => ({ i, mean: end.X[i][0], middle: end.X[i][1] })), pull, pullAt,
  };
}

if (typeof module !== 'undefined') module.exports = { smpStack, smpAxes, smpAir, smpSummary, SMP_AL };
