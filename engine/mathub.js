'use strict';
/*
 * mathub.js — the Material Hub (MH-5): the project's materials as records, the way a multiphysics code keeps them
 * (COMSOL's Materials node, Fluent's materials panel): one record per real material and per interface between two,
 * each with its identity, its property groups and every property's definition (a constant, a calculated value, a
 * built-in law in temperature, a second-order tensor, a stiffness), its unit, its provenance and its source, and the
 * solvers that read it.
 *
 * The records hold no copy of a value the solvers read: each property is bound to where the solvers take it from
 * (the stage cards' values in MAT, the inputs bar's P, the fibre web's CFDG, the pre heat's OVEN.peel), so a value
 * edited here is the value solved with, and every solver's inputs are exactly as before (bit-identical). The built-in
 * laws and constants (water, air, argon, graphite, aluminium, the fibre web's and the wet film's fixed ratios) are the
 * solvers' own; their records restate them, and mathub.validate.js checks each against the solver's function.
 *
 * Provenance per property (the spec's kinds): measured, fitted, from you, datasheet, published, assumed; calculated
 * and built-in for what is not typed. Kept on the card's value as prov, beside its flag (given / assumed / measured,
 * what the rest of the app counts): a kind always matches its flag; a flag changed elsewhere (a rheometer fit) wins.
 * The inputs bar's own (P) keep theirs in MAT.prov['in.' + k].
 *
 * Loaded after matlib.js, materials.js, drying.js and furnace.js (the laws it plots) and before process-ui.js.
 */

// ---- provenance ----
const HUB_PROV = {
  measured: { l: 'Measured', flag: 'measured', d: 'measured on this material (a test, your instrument)' },
  fitted: { l: 'Fitted', flag: 'measured', d: 'fitted to your measured data' },
  user: { l: 'From you', flag: 'given', d: 'you gave it (a process value, your knowledge)' },
  supplier: { l: 'Datasheet', flag: 'given', d: 'the supplier\'s datasheet or test report' },
  published: { l: 'Published', flag: 'assumed', d: 'a published value for a similar material' },
  assumed: { l: 'Assumed', flag: 'assumed', d: 'a typical value until measured' },
};
/** Provenance kinds a person can set (the select's), in order. */
const HUB_PROV_SET = ['measured', 'fitted', 'user', 'supplier', 'published', 'assumed'];
/** Read-only kinds. */
const HUB_PROV_RO = { calc: { l: 'Calculated', d: 'worked out from other properties' }, builtin: { l: 'Built-in', d: 'the solver\'s own law or constant' }, report: { l: 'Test report', d: 'the fibre\'s test report' } };
const HUB_FLAG_PROV = { given: 'user', measured: 'measured', assumed: 'assumed' };
/** A card value's provenance: its prov when it matches its flag, else the flag's. */
const hubProvOf = e => (e && e.prov && HUB_PROV[e.prov] && HUB_PROV[e.prov].flag === e.flag ? e.prov : HUB_FLAG_PROV[e && e.flag] || 'assumed');
const hubProvL = k => (HUB_PROV[k] || HUB_PROV_RO[k] || { l: k }).l;

// ---- the solvers (physics) ----
const HUB_PHYS = [
  { k: 'mix', l: 'Mixing 1D · 2D · 3D', s: 'the batch through its program (1D: composition, density, flow curve); its flow round the moving blades and disperser, the heat the shear makes, tracers (2D, 3D)', nav: ['mix'] },
  { k: 'coat', l: 'Coating flow 1D · 2D · 3D', s: 'generalized-Newtonian Stokes flow with a free surface and contact lines', nav: ['cfd2d'] },
  { k: 'align', l: 'Flake alignment', s: 'Doi–Hess or Folgar–Tucker along the 2D flow\'s streamlines', nav: ['flakes'] },
  { k: 'dry', l: 'Drying', s: 'heat and water through the film and the web, the skin, the isotherm', nav: ['dry', 'results'] },
  { k: 'mp5', l: 'Drying: multiphysics 1D · 2D · 3D', s: 'heat, water, the oven\'s air through the web and the drying stress', nav: ['dry2d'] },
  { k: 'film', l: 'Peel and wind', s: 'plane-strain FEM of the film on the web: stress, cracks, peel, curl', nav: ['peel', 'results'] },
  { k: 'stack', l: 'Pre heat: pressed stack', s: 'in-plane drying of the pieces, creep held flat, release buckling', nav: ['stack', 'results'] },
  { k: 'mp4', l: 'Peel and wind: multiphysics 2D', s: 'the peel front: the film\'s layers on the web, the hold giving way, the arm turning', nav: ['peel2d'] },
  { k: 'mp6', l: 'Peel and wind: the roll 1D · 3D', s: 'the roll wound turn by turn on its core: the turns\' pressure and pull, their water and heat at rest; in 3D its ends too', nav: ['peel1d', 'peel3d'] },
  { k: 'mp7', l: 'Cutting: the cut edge 1D · 2D · 3D', s: 'the film\'s layers at the cut: their stress, the energy to part them, the edge\'s peel and shear, the cut piece\'s curl', nav: ['cut2d'] },
  { k: 'mp1', l: 'Pre heat: multiphysics 1D · 2D · 3D', s: 'heat, water and stress in the stack under the aluminium plate', nav: ['stack2d'] },
  { k: 'furn', l: 'Furnace', s: 'conversion kinetics, gas and puffing, graphitization, the piece on its papers', nav: ['furn', 'results'] },
  { k: 'mp2', l: 'Furnace: multiphysics 1D · 2D · 3D', s: 'heat with the reaction heat in the holder, the papers and the pieces', nav: ['furn2d'] },
  { k: 'mp8', l: 'Graphene film: heat spreading 1D · 2D · 3D', s: 'a piece on a heater: its heat along it and through it, to the room\'s air from its faces', nav: ['gfilm2d'] },
];
const hubPhys = k => HUB_PHYS.find(p => p.k === k);
function hubGoPhys(k) {
  const p = hubPhys(k);
  if (!p) return;
  if (p.nav[0] === 'cfd2d') { tab = 4; FV.step = 'results'; render(); return; }
  navGo(...p.nav);
}

// ---- the card rows ----
const HUB_CARDS = { slurry: MAT_SLURRY, rheo: MAT_RHEO, orient: MAT_ORIENT, dry: MAT_DRY, film: MAT_FILM, furn: MAT_FURN, lib: MAT_LIB, xrec: MAT_XREC };
/** Each card's attribute and id prefix (the cards' own: help, undo and the tests find a value by them). */
const HUB_ATTR = { slurry: ['mk', 'mat'], rheo: ['mr', 'matr'], orient: ['mo', 'mato'], dry: ['mdr', 'matd'], film: ['mfl', 'matf'], furn: ['mfu', 'matu'], lib: ['mlb', 'matl'], xrec: ['mxr', 'matx'] };
/** The stage cards (the values' groups by stage, as the help and the report name them: "the Film card"). */
const HUB_CARD_T = { slurry: 'Slurry card', rheo: 'Rheology card', orient: 'Alignment card', dry: 'Drying card', film: 'Film card', furn: 'Furnace card', lib: 'Material constants card' };
const hubRow = (card, k) => HUB_CARDS[card].find(q => q[0] === k);

// ---- built-in laws and constants (the solvers' own: restated, checked against them in mathub.validate.js) ----
const HUB_LAW = {
  waterMu: { q: { kind: 'law', law: 'vogel', params: { A: 2.414e-5, B: 247.8, C: 140 } }, u: 'Pa·s', T: [0, 100], solver: 'drying.js drMuWater', src: 'Vogel equation for liquid water: within 2 % from 0 to 100 °C' },
  waterPsat: { q: { kind: 'law', law: 'iapwsPsat', params: { n: typeof DR_IF97 !== 'undefined' ? DR_IF97 : [] } }, u: 'Pa', T: [0, 150], solver: 'drying.js drPsat', src: 'IAPWS-IF97 (2007), region 4, eq. 30' },
  waterL: { q: { kind: 'law', law: 'linearT', params: { y0: 2.501e6, T0: 273.15, b: -2361 } }, u: 'J/kg', T: [0, 100], solver: 'drying.js drLatent', src: 'linear fit: within 0.4 % of the steam tables from 0 to 100 °C' },
  airMu: { q: { kind: 'law', law: 'sutherland', params: { y0: 1.716e-5, T0: 273.15, S: 110.4 } }, u: 'Pa·s', T: [0, 400], solver: 'drying.js drAir (and cfd-ui.js airProps: the same law)', src: 'Sutherland\'s law, μ0 1.716×10⁻⁵ Pa·s at 273.15 K, S 110.4 K (White, Viscous Fluid Flow)' },
  airK: { q: { kind: 'law', law: 'sutherland', params: { y0: 0.0241, T0: 273.15, S: 194 } }, u: 'W/(m·K)', T: [0, 400], solver: 'drying.js drAir', src: 'Sutherland form, k0 0.0241 W/(m·K) at 273.15 K, S 194 K (White, Viscous Fluid Flow)' },
  airRho: { q: { kind: 'law', law: 'idealGas', params: { M: 0.0289647 } }, u: 'kg/m³', T: [0, 400], p: 101325, solver: 'drying.js drAir', src: 'ideal gas, dry air M 28.9647 g/mol, at 1 atm' },
  airDv: { q: { kind: 'law', law: 'powerT', params: { y0: 2.26e-5, T0: 273.15, b: 1.81 } }, u: 'm²/s', T: [0, 400], solver: 'drying.js drAir', src: 'water vapour in air, 2.26×10⁻⁵ m²/s at 0 °C and 1 atm, ∝ T^1.81 / p' },
  arMu: { q: { kind: 'law', law: 'powerT', params: { y0: 2.27e-5, T0: 300, b: 0.67 } }, u: 'Pa·s', T: [20, 3000], solver: 'furnace-mp.js fmpArgon', src: 'argon 2.27×10⁻⁵ Pa·s at 300 K, ∝ T^0.67' },
  arRho: { q: { kind: 'law', law: 'idealGas', params: { M: 0.039948 } }, u: 'kg/m³', T: [20, 3000], p: 101325, solver: 'furnace-mp.js fmpArgon', src: 'ideal gas, M 39.948 g/mol, at 1 atm' },
  gCp: { q: { kind: 'law', law: 'butlandMaddison', params: { c: [0.54212, -2.42667e-6, -90.2725, -43449.3, 1.59309e7, -1.43688e9] } }, u: 'J/(kg·K)', T: [20, 3000], solver: 'furnace-mp.js fmpCg', src: 'Butland and Maddison, J. Nucl. Mater. 49 (1973) 45: 200–3500 K' },
};
/** The fluids' constants the solvers take (MC-1b: the material constants card's, MAT.lib, editable): where in the code. */
const HUB_CONST_CODE = { waterCp: 'drying.js DR_P.waterCp, stack-mp.js, furnace-mp.js FMP_P.waterCp', airCp: 'drying.js drAir', arCp: 'furnace-mp.js fmpArgon', arPr: 'furnace-mp.js fmpArgon' };
const HUB_CONST = Object.fromEntries(Object.entries(HUB_CONST_CODE).map(([id, solver]) => {
  const row = () => MAT_LIB.find(q => q[0] === id);
  return [id, { solver, get v() { return typeof MAT !== 'undefined' && MAT.lib && MAT.lib[id] ? MAT.lib[id].v : row()[7]; }, get u() { return row()[2]; }, get src() { return row()[9]; } }];
}));
/** A built-in law's parameters now (MC-1b): the project's edits (MAT.law) over its own. */
const hubLawParams = id => ({ ...HUB_LAW[id].q.params, ...((typeof MAT !== 'undefined' && MAT.law && MAT.law[id]) || {}) });
const hubLawQ = (id, params = hubLawParams(id)) => ({ ...HUB_LAW[id].q, params });
/** A built-in law's value at T (°C) in SI, with its parameters now. */
const hubLawAt = (id, Tc) => { const L = HUB_LAW[id]; return mlQEval(hubLawQ(id), { T: Tc + 273.15, p: L.p || 101325 }); };
/** Why a law's parameters cannot stand (or ''): every value finite and positive over its valid range, every 5 °C. */
function hubLawProblem(id, params) {
  const L = HUB_LAW[id], q = hubLawQ(id, params);
  for (const [k, x] of Object.entries(params)) if (Array.isArray(x) ? !x.every(Number.isFinite) : !Number.isFinite(x)) return `${k} is not a number`;
  for (let T = L.T[0]; T <= L.T[1] + 1e-9; T += Math.max(5, (L.T[1] - L.T[0]) / 600)) {
    let y; try { y = mlQEval(q, { T: T + 273.15, p: L.p || 101325 }); } catch (e) { return e.message; }
    if (!Number.isFinite(y) || y <= 0) return `it gives ${Number.isFinite(y) ? hubFmt(y, -3) : 'no number'} ${L.u} at ${+T.toFixed(1)} °C: it must stay positive from ${L.T[0]} to ${L.T[1]} °C`;
  }
  return '';
}
/** Set a law's parameter k (its i-th, for a list): refused (thrown, said why) when the law would not hold. */
function hubSetLawParam(id, k, i, v, inst = null) {
  if (inst) return hubInInst(inst, () => hubSetLawParam(id, k, i, v), true);
  const own = HUB_LAW[id].q.params, cur = hubLawParams(id);
  if (!(k in own)) throw new Error(`${id} has no parameter ${k}`);
  const x = Array.isArray(own[k]) ? cur[k].map((q, j) => (j === i ? v : q)) : v, next = { ...cur, [k]: x }, why = hubLawProblem(id, next);
  if (why) throw new Error(why);
  const edits = { ...((MAT.law || {})[id] || {}) };
  if (JSON.stringify(x) === JSON.stringify(own[k])) delete edits[k]; else edits[k] = x;
  MAT.law = { ...(MAT.law || {}) };
  if (Object.keys(edits).length) MAT.law[id] = edits; else delete MAT.law[id];
}
/**
 * The built-in laws and the fluids' constants as the solvers take them (their o.props, MC-1b): only what differs from
 * the solvers' own values (drying.js DR_PROPS, furnace-mp.js FMP_PROPS), so a project that edits none solves as before
 * (undefined then).
 */
function matSolverProps() {
  const out = {}, put = (k, v, own) => { if (JSON.stringify(v) !== JSON.stringify(own)) out[k] = v; }, L = id => hubLawParams(id), O = id => HUB_LAW[id].q.params;
  for (const id of ['waterMu', 'waterL', 'airMu', 'airK', 'airDv', 'arMu']) put(id, L(id), O(id));
  put('psat', L('waterPsat').n, O('waterPsat').n); put('airM', L('airRho').M, O('airRho').M); put('arM', L('arRho').M, O('arRho').M); put('gCp', L('gCp').c, O('gCp').c);
  for (const id of Object.keys(HUB_CONST_CODE)) put(id, MAT.lib[id].v, MAT_LIB.find(q => q[0] === id)[7]);
  return Object.keys(out).length ? out : undefined;
}

// ---- the records ----
// property: { id, l, sym, b (binding), phys: [solver keys], note?, show? (() => text when not used as set) }
// bindings: card value { t: 'card', card, k }; the inputs bar's { t: 'inp', k }; the fibre web's { t: 'cfdg', k, ... };
// the pre heat's { t: 'peel', k }; calculated { t: 'calc', f, u, d, how }; built-in { t: 'law', id } / { t: 'const', id };
// a tensor { t: 'tensor', form: 'ti', axial, trans (property ids), u }; a stiffness { t: 'stiff', ... }
const hC = (card, k) => ({ t: 'card', card, k });
const hI = k => ({ t: 'inp', k });
const hCalc = (f, u, d, how) => ({ t: 'calc', f, u, d, how });
const hG = (k, l, u, lo, hi, step, d) => ({ t: 'cfdg', k, l, u, lo, hi, step, d });
const rheoUsesNow = k => RHEO_MODELS[CFDG.model].uses.includes(k);
const rheoOffNote = k => (rheoUsesNow(k) ? '' : `not used by ${RHEO_MODELS[CFDG.model].l}`);
const cardOff = (card, k) => {
  const q = hubRow(card, k);
  if (card === 'rheo') return matRheoUsed(q) ? '' : matRheoNotUsed(q);
  if (card === 'orient') return orRowOff(q) || '';
  return '';
};
/** The water a dry film's pores hold at most (kg per kg of GO), as the film card's derived values take it. */
const hubXcap = () => { const pm = MAT.slurry.phiDry.v, em = (1 - pm) / pm; return 0.9 * em * MAT.slurry.rhoL.v / (MAT.slurry.rhoS.v * 1000); };
const HUB_RECORDS = [
  { id: 'slurry', name: 'GO slurry', cls: 'Fluid', sub: 'Non-Newtonian suspension', icon: 'drop',
    desc: 'Graphene oxide flakes dispersed in water, as mixed and coated.',
    domains: ['Coating: the gap under the blade, the free film and its meniscus (1D, 2D, 3D)', 'Mixing: the slurry stream', 'Drying: the wet film as it enters the oven (its solids and water)'],
    parts: [['flakes', 'phi'], ['water', null]], models: ['flow', 'struct', 'align'], measured: 'rheometer', cards: ['slurry', 'rheo', 'orient'],
    groups: [
      { l: 'Composition', props: [
        { id: 'phi', sym: 'φ', l: 'Solids volume fraction', b: hC('slurry', 'phi'), phys: ['mix', 'coat', 'dry', 'film'] },
        { id: 'rho', sym: 'ρ', l: 'Density', b: hCalc(() => slurryRho(), 'kg/m³', 0, () => `φ ρ_GO + (1 − φ) ρ_water: ${matPhiTxt()} % × ${MAT.slurry.rhoS.v * 1000} + ${+(100 - MAT.slurry.phi.v).toPrecision(4)} % × ${MAT.slurry.rhoL.v}; the flow models use it`), phys: ['mix', 'coat'] },
        { id: 'wm', sym: 'w', l: 'Solids mass fraction', b: hCalc(() => slurrySolidsMass() * 100, '%', 1, 'φ ρ_GO / ρ'), phys: ['mix'] },
        { id: 'X0', sym: 'X₀', l: 'Water per mass of GO', b: hCalc(() => (1 - MAT.slurry.phi.v / 100) * MAT.slurry.rhoL.v / (MAT.slurry.phi.v / 100 * MAT.slurry.rhoS.v * 1000), 'kg/kg', 2, '(1 − φ) ρ_water / (φ ρ_GO): the water the drying takes out'), phys: ['mix', 'dry'] },
      ] },
      { l: 'Flow law (generalized Newtonian)', key: 'flow', props: [
        { id: 'model', sym: '', l: 'Law', b: { t: 'model' }, phys: ['coat', 'mix'] },
        { id: 'mu', sym: 'μ', l: 'Viscosity', b: hI('mu'), law: true, phys: ['coat', 'mix'], off: () => (CFDG.model === 'newtonian' ? '' : 'the Newtonian law\'s: the others set their own parameters') },
        { id: 'K', sym: 'K', l: 'Consistency', b: hI('K'), law: true, phys: ['coat', 'mix'], off: () => rheoOffNote('K') },
        { id: 'eta0', sym: 'η₀', l: 'Zero-shear viscosity', b: hI('eta0'), law: true, phys: ['coat', 'mix'], off: () => rheoOffNote('eta0') },
        { id: 'n', sym: 'n', l: 'Flow index', b: hI('n'), law: true, phys: ['coat', 'mix'], off: () => rheoOffNote('n') },
        { id: 'ty', sym: 'τ_y', l: 'Yield stress', b: hI('ty'), law: true, phys: ['coat', 'mix'], off: () => rheoOffNote('ty') },
        { id: 'etaInf', sym: 'η∞', l: 'Infinite-shear viscosity', b: hC('rheo', 'etaInf'), law: true, phys: ['coat', 'mix'] },
        { id: 'lamT', sym: 'λ', l: 'Time constant', b: hC('rheo', 'lamT'), law: true, phys: ['coat', 'mix'] },
        { id: 'aCY', sym: 'a', l: 'Yasuda exponent', b: hC('rheo', 'aCY'), law: true, phys: ['coat', 'mix'] },
        { id: 'mu27', sym: 'η(2.7 s⁻¹)', l: 'Viscosity at 2.7 1/s, the law', b: hCalc(() => P.mu, 'Pa·s', 3, 'the law at 2.7 1/s: the form the solvers take (μref with τy and n), exact'), phys: ['coat', 'mix'] },
        { id: 'meas27', sym: 'η(2.7 s⁻¹)', l: 'Viscosity at 2.7 1/s, measured', b: { t: 'measured' }, phys: [] },
      ] },
      { l: 'Structure (thixotropy)', key: 'struct', props: [
        { id: 'structOn', sym: '', l: 'Structure model', b: { t: 'switch', get: () => MAT.rheo.structOn, set: v => { MAT.rheo.structOn = v; }, on: 'on: it breaks down under shear and rebuilds at rest', off: 'off: the steady flow curve everywhere', id: 'matStructOn' }, phys: ['coat'] },
        ...['tb', 'gdc', 'cy', 'ce'].map((k, i) => ({ id: k, sym: ['t_b', 'γ̇_c', 'c_y', 'c_η'][i], l: ['Rebuild time at rest', 'Shear rate halving the structure', 'Yield stress gain at rest', 'Viscosity gain at rest'][i], b: hC('rheo', k), phys: ['coat'] })),
      ] },
      { l: 'Flake alignment (liquid crystal)', key: 'align', props: [
        { id: 'orOn', sym: '', l: 'Alignment', b: { t: 'switch', get: () => MAT.orient.on, set: v => { MAT.orient.on = v; }, on: 'on: computed with each 2D run, along its flow to the film and on the web to the oven', off: 'off: the 2D computes no alignment', id: 'matOrOn' }, phys: ['align'] },
        { id: 'orModel', sym: '', l: 'Model', b: { t: 'orModel' }, phys: ['align'] },
        { id: 'U', sym: 'U', l: 'Ordering strength (Maier–Saupe)', b: hC('orient', 'U'), phys: ['align'], law: true },
        { id: 'Dr', sym: 'D_r', l: 'Rotary diffusivity', b: hC('orient', 'Dr'), phys: ['align'], law: true },
        { id: 'Ci', sym: 'C_i', l: 'Interaction coefficient', b: hC('orient', 'Ci'), law: true, phys: ['align'] },
        { id: 'Srest', sym: 'S₀', l: 'Order parameter at rest', b: hCalc(() => (MAT.orient.model === 'dh' ? orRestS(MAT.orient.U.v) : NaN), '', 3, 'the liquid crystal at rest (Maier–Saupe, from U): 1 all aligned, 0 isotropic'), law: true, phys: ['align'], off: () => (MAT.orient.model === 'dh' ? '' : 'the liquid crystal\'s (Doi–Hess)') },
      ] },
      { l: 'Transport in the wet film', props: [
        { id: 'mul', sym: 'f_D', l: 'Collective diffusion, × the hard-sphere law', b: hC('dry', 'mul'), phys: ['dry', 'film'] },
        { id: 'D0', sym: 'D₀', l: 'Brownian diffusivity of a flake (25 °C)', b: hCalc(() => drD0(25, MAT.slurry.dMean.v * 1e-6 / 2), 'm²/s', -3, () => `k_B T / (12 μ_water R): a thin disc ${MAT.slurry.dMean.v} µm across in water`), phys: ['dry'] },
        { id: 'Dc', sym: 'D_c', l: 'Collective diffusivity at the solids fraction (25 °C)', b: hCalc(() => drDcoll(MAT.slurry.phi.v / 100, 25, MAT.slurry.dMean.v * 1e-6 / 2, MAT.slurry.phiDry.v, MAT.dry.mul.v), 'm²/s', -3, 'f_D × the hard-sphere law (Routh–Russel, Carnahan–Starling), 25 °C: how fast the water spreads against the flakes; small, a skin forms'), phys: ['dry'] },
      ] },
    ] },
  { id: 'flakes', name: 'GO flakes', cls: 'Particles', sub: 'Graphene oxide platelets', icon: 'fibre',
    desc: 'The solid phase: graphene oxide sheets, a few µm across and about a nanometre thick.',
    domains: ['The slurry\'s solids (Mixing, Coating)', 'The films and pieces they pack into (Drying to the Furnace)'], cards: ['slurry', 'furn'],
    groups: [
      { l: 'Basic', props: [
        { id: 'rhoS', sym: 'ρ_GO', l: 'Density', b: hC('slurry', 'rhoS'), phys: ['mix', 'coat', 'dry', 'film'] },
        { id: 'co', sym: 'C/O', l: 'Carbon to oxygen atomic ratio', b: hC('slurry', 'co'), phys: ['furn', 'mp2'] },
        { id: 'hc', sym: 'H/C', l: 'Hydrogen to carbon atomic ratio', b: hC('furn', 'hc'), phys: ['furn', 'mp2'] },
      ] },
      { l: 'Size and shape', props: [
        { id: 'dMean', sym: 'd', l: 'Lateral size, mean', b: hC('slurry', 'dMean'), phys: ['dry', 'align'] },
        { id: 'dMin', sym: 'd_min', l: 'Lateral size, smallest', b: hC('slurry', 'dMin'), phys: ['mix'], note: 'shown on Mixing; no solver uses it' },
        { id: 'dMax', sym: 'd_max', l: 'Lateral size, largest', b: hC('slurry', 'dMax'), phys: ['mix'], note: 'shown on Mixing; no solver uses it' },
        { id: 'tFlake', sym: 't', l: 'Thickness', b: hC('slurry', 'tFlake'), phys: ['align'] },
        { id: 'ar', sym: 't/d', l: 'Aspect ratio', b: hCalc(() => matFlakeRatio(), '', -3, 'thickness / mean size'), phys: ['align'] },
        { id: 'beta', sym: 'β', l: 'Jeffery shape factor', b: hCalc(() => { const r = matFlakeRatio(); return (r * r - 1) / (r * r + 1); }, '', 6, '(r² − 1)/(r² + 1), r = t/d: −1 for a flat disc'), phys: ['align'] },
      ] },
    ] },
  { id: 'water', name: 'Water', cls: 'Fluid', sub: 'Liquid · Newtonian', icon: 'drop',
    desc: 'The slurry\'s liquid; the water the films hold and lose.',
    domains: ['The slurry\'s liquid (Mixing, Coating)', 'The water in the wet film and the pieces (Drying, Pre heat, Furnace)'], cards: ['slurry'], models: ['water'],
    groups: [
      { l: 'Basic', props: [
        { id: 'rhoL', sym: 'ρ_w', l: 'Density', b: hC('slurry', 'rhoL'), phys: ['mix', 'coat', 'dry', 'film'] },
        { id: 'cp', sym: 'c_p', l: 'Specific heat capacity', b: hC('lib', 'waterCp'), phys: ['dry', 'film', 'mp1', 'mp2'] },
      ] },
      { l: 'Temperature dependent', props: [
        { id: 'mu', sym: 'μ(T)', l: 'Viscosity', b: { t: 'law', id: 'waterMu' }, phys: ['dry', 'film'], note: 'the flakes\' Brownian and collective diffusion' },
        { id: 'psat', sym: 'p_sat(T)', l: 'Saturation pressure', b: { t: 'law', id: 'waterPsat' }, phys: ['dry', 'film', 'stack', 'mp1'] },
        { id: 'L', sym: 'L(T)', l: 'Latent heat of evaporation', b: { t: 'law', id: 'waterL' }, phys: ['dry', 'film', 'mp1'] },
      ] },
    ] },
  { id: 'air', name: 'Air', cls: 'Gas', sub: 'Dry air · ideal gas', icon: 'flow',
    desc: 'The room and the drying oven\'s air; the air through the fibre web.',
    domains: ['Drying: the oven\'s air above and below the web, through the web', 'Pre heat: the oven\'s air round the stack', 'Coating: the air through the web under the drying plenum (its pressure)'],
    note: 'In the coating flow the air is not solved: the free surface is stress-free at the ambient pressure, with surface tension (μ_air / μ_slurry ≈ 2×10⁻⁶).', cards: ['dry'], models: ['air'],
    groups: [
      { l: 'Temperature dependent', props: [
        { id: 'rho', sym: 'ρ(T)', l: 'Density', b: { t: 'law', id: 'airRho' }, phys: ['dry', 'film', 'mp1', 'coat'] },
        { id: 'mu', sym: 'μ(T)', l: 'Viscosity', b: { t: 'law', id: 'airMu' }, phys: ['dry', 'film', 'mp1', 'coat'] },
        { id: 'k', sym: 'k(T)', l: 'Thermal conductivity', b: { t: 'law', id: 'airK' }, phys: ['dry', 'film', 'mp1'] },
        { id: 'cp', sym: 'c_p', l: 'Specific heat capacity', b: hC('lib', 'airCp'), phys: ['dry', 'film', 'mp1'] },
        { id: 'Dv', sym: 'D_v(T)', l: 'Water vapour diffusivity in air', b: { t: 'law', id: 'airDv' }, phys: ['dry', 'film', 'mp1'] },
      ] },
      { l: 'The room (between the blade and the oven)', props: [
        { id: 'Troom', sym: 'T_room', l: 'Temperature', b: hC('dry', 'Troom'), phys: ['dry', 'film', 'furn'], note: 'a process condition' },
        { id: 'rhRoom', sym: 'RH', l: 'Relative humidity', b: hC('dry', 'rhRoom'), phys: ['dry', 'film'], note: 'a process condition' },
        { id: 'pRoom', sym: 'p_room', l: 'Air pressure', b: hC('dry', 'pRoom'), phys: ['dry', 'film', 'mp1'], note: 'a process condition' },
      ] },
    ] },
  { id: 'argon', name: 'Argon', cls: 'Gas', sub: 'Monatomic ideal gas', icon: 'flow',
    desc: 'The furnace\'s atmosphere.', domains: ['Furnace multiphysics: the gas round the holder and in its gaps'], models: ['argon'],
    groups: [
      { l: 'Temperature dependent', props: [
        { id: 'rho', sym: 'ρ(T)', l: 'Density', b: { t: 'law', id: 'arRho' }, phys: ['mp2'] },
        { id: 'mu', sym: 'μ(T)', l: 'Viscosity', b: { t: 'law', id: 'arMu' }, phys: ['mp2'] },
        { id: 'cp', sym: 'c_p', l: 'Specific heat capacity', b: hC('lib', 'arCp'), phys: ['mp2'] },
        { id: 'Pr', sym: 'Pr', l: 'Prandtl number', b: hC('lib', 'arPr'), phys: ['mp2'] },
        { id: 'k', sym: 'k(T)', l: 'Thermal conductivity', b: hCalc(() => hubLawAt('arMu', 20) * HUB_CONST.arCp.v / HUB_CONST.arPr.v, 'W/(m·K)', 4, 'μ(T) c_p / Pr (at 20 °C here)'), phys: ['mp2'] },
      ] },
    ] },
  { id: 'gel', name: 'Wet GO film', cls: 'Solid', sub: 'Soft gel under a skin · isotropic', icon: 'film',
    desc: 'The film while it still holds its water: a soft GO paste below the dry skin.', domains: ['Peel and wind: the wet layer under the dried skin'], cards: ['film'],
    groups: [
      { l: 'Mechanical', props: [
        { id: 'Eg', sym: 'E', l: 'Young\'s modulus', b: hC('film', 'Eg'), phys: ['film'] },
        { id: 'nu', sym: 'ν', l: 'Poisson\'s ratio', b: hC('lib', 'gelNu'), phys: ['film'] },
        { id: 'G', sym: 'G', l: 'Shear modulus', b: hCalc(() => MAT.film.Eg.v / (2 * (1 + MAT.lib.gelNu.v)), 'kPa', 1, 'E / (2 (1 + ν))'), phys: ['film'] },
      ] },
    ] },
  { id: 'gofilm', name: 'Dried GO film', cls: 'Solid', sub: 'Laminate · transversely isotropic (axis: the film\'s normal)', icon: 'film',
    desc: 'GO paper: the dried, packed flakes lying flat. Its axis of symmetry is the film\'s normal (3); 1 and 2 lie in its plane.',
    domains: ['Drying: the film and its skin', 'Peel and wind: the film on the web', 'Pre heat: the pieces in the pressed stack', 'Furnace: the pieces on their papers'],
    cards: ['slurry', 'dry', 'film', 'furn'], models: ['gab', 'kT', 'C', 'soft', 'conv'],
    groups: [
      { l: 'Basic', props: [
        { id: 'phiDry', sym: 'φ_dry', l: 'Packing (solids volume fraction)', b: hC('slurry', 'phiDry'), phys: ['dry', 'film', 'align'] },
        { id: 'rho', sym: 'ρ', l: 'Density (pores empty)', b: hCalc(() => MAT.slurry.phiDry.v * MAT.slurry.rhoS.v * 1000, 'kg/m³', 0, 'φ_dry ρ_GO: the dry film\'s packing × the GO density, its pores empty'), phys: ['dry', 'film'] },
        { id: 'rhoGauge', sym: 'ρ_gauge', l: 'Density as a gauge reads it', b: hC('slurry', 'rhoGauge'), phys: [], note: 'a weighed piece (its water in the room) over the thickness a gauge reads: its pores, its waviness and roughness under the gauge; shown as the dry film\'s gauge thickness' },
        { id: 'cS', sym: 'c_p', l: 'Specific heat capacity', b: hC('dry', 'cS'), phys: ['dry', 'film', 'mp1', 'mp2'], note: 'the furnace\'s multiphysics scales graphite\'s c_p(T) by c_p / c_p,graphite(20 °C)' },
        { id: 'emis', sym: 'ε', l: 'Emissivity', b: hC('dry', 'emis'), phys: ['dry', 'film', 'mp1'] },
        { id: 'irAbs', sym: 'α_IR', l: 'IR absorptance', b: hC('dry', 'irAbs'), phys: ['dry', 'film'] },
      ] },
      { l: 'Thermal conduction', props: [
        { id: 'k', sym: 'k', l: 'Thermal conductivity', b: { t: 'tensor', axial: 'kS', trans: 'kIn', u: 'W/(m·K)', what: 'heat' }, phys: ['dry', 'film', 'mp1', 'mp2'] },
        { id: 'kIn', sym: 'k₁₁ = k₂₂', l: 'in the plane', b: hC('dry', 'kIn'), phys: ['mp1', 'mp2'], sub: true },
        { id: 'kS', sym: 'k₃₃', l: 'through the thickness', b: hC('dry', 'kS'), phys: ['dry', 'film', 'mp1', 'mp2'], sub: true },
      ] },
      { l: 'Water', props: [
        { id: 'gabXm', sym: 'X_m', l: 'Sorption isotherm (GAB): monolayer', b: hC('dry', 'gabXm'), phys: ['dry', 'film'] },
        { id: 'gabC', sym: 'C', l: 'Sorption isotherm (GAB): C', b: hC('dry', 'gabC'), phys: ['dry', 'film'] },
        { id: 'gabK', sym: 'K', l: 'Sorption isotherm (GAB): K', b: hC('dry', 'gabK'), phys: ['dry', 'film'] },
        { id: 'gabT0', sym: 'T₀', l: 'Sorption isotherm (GAB): its temperature', b: hC('dry', 'gabT0'), phys: ['dry', 'film'] },
        { id: 'gabHc', sym: 'H_c', l: 'Sorption isotherm (GAB): first layer\'s binding heat', b: hC('dry', 'gabHc'), phys: ['dry', 'film'] },
        { id: 'Xroom', sym: 'X_room', l: 'Water held in the room', b: hCalc(() => matRoomWater() * 100, '% of its mass', 1, 'GO\'s own water between its layers at the room\'s humidity and temperature: the piece as cut and weighed'), phys: ['dry', 'film', 'stack', 'furn'] },
        { id: 'Xpre', sym: 'X_pre', l: 'Water held in the pre heat treatment', b: hCalc(() => { const T = OVEN.peel.dryT, a = Math.min(1, MAT.dry.rhRoom.v / 100 * drPsat(MAT.dry.Troom.v) / drPsat(T)); return matGabX(a, matGab(), T) * 100; }, '% of its mass', 1, 'the isotherm at the pre heat\'s temperature, its air the room\'s heated: what the pieces keep when dried through'), phys: ['stack', 'mp1'] },
        { id: 'Xlast', sym: 'X', l: 'Water held at the last oven zone\'s humidity', b: hCalc(() => { const z = OVEN.zones[OVEN.zones.length - 1]; return drGAB(z.rh / 100, matGab(), z.airT) * 100; }, '% of its mass', 1, 'the isotherm at the last zone\'s relative humidity: the water left in a dry film at the exit'), phys: ['dry'] },
        { id: 'Kv', sym: 'K_v', l: 'Water vapour permeability', b: { t: 'tensor', axial: 'skinK', trans: 'stackK', u: 'kg/(m·s·Pa)', what: 'water', scale: { skinK: 1e-12, stackK: 1e-7 } }, phys: ['dry', 'film', 'stack', 'mp1'] },
        { id: 'stackK', sym: 'K_v,11', l: 'in the plane (along the pieces in the stack)', b: hC('film', 'stackK'), phys: ['stack', 'mp1'], sub: true },
        { id: 'skinK', sym: 'K_v,33', l: 'through the thickness (the skin)', b: hC('dry', 'skinK'), phys: ['dry', 'film', 'mp1'], sub: true },
        { id: 'rollK', sym: 'K_v,roll', l: 'Water along the turns in the roll (their faces, to its ends)', b: hC('film', 'rollK'), phys: ['mp6'] },
        { id: 'beta', sym: 'β', l: 'Hygroscopic swelling in the plane', b: hC('film', 'beta'), phys: ['film', 'stack', 'furn', 'mp2'] },
        { id: 'betaT', sym: 'β₃', l: 'Hygroscopic swelling through the thickness', b: hC('film', 'betaT'), phys: [] },
        { id: 'swell', sym: 'β X_room', l: 'Swelling from dry to the room\'s water', b: hCalc(() => MAT.film.beta.v * matRoomWater() * 100, '%', 2, 'β × the water it holds in the room (in the plane): along the film, its water from none to the room\'s'), phys: ['film'] },
        { id: 'Xh', sym: 'X_h', l: 'Softening: water content that halves its stiffness', b: hC('film', 'Xh'), phys: ['film'] },
      ] },
      { l: 'Mechanical', props: [
        { id: 'C', sym: 'C', l: 'Stiffness', b: { t: 'stiff' }, phys: ['film', 'furn', 'mp2'] },
        { id: 'Ep', sym: 'E₁ = E₂', l: 'Young\'s modulus in the plane', b: hC('film', 'Ep'), phys: ['film', 'furn', 'mp2'], sub: true },
        { id: 'Et', sym: 'E₃', l: 'Young\'s modulus through the thickness', b: hC('film', 'Et'), phys: ['film'], sub: true },
        { id: 'nup', sym: 'ν₁₂', l: 'Poisson\'s ratio in the plane', b: hC('film', 'nup'), phys: ['film', 'furn', 'mp2'], sub: true },
        { id: 'nupt', sym: 'ν₁₃', l: 'Poisson\'s ratio, plane to thickness', b: hC('film', 'nupt'), phys: ['film'], sub: true },
        { id: 'Gpt', sym: 'G₁₃', l: 'Shear modulus between the layers', b: hC('film', 'Gpt'), phys: ['film'], sub: true },
        { id: 'alphaF', sym: 'α₁', l: 'Thermal expansion in the plane', b: hC('film', 'alphaF'), phys: ['film', 'mp1'] },
        { id: 'alphaT', sym: 'α₃', l: 'Thermal expansion through the thickness', b: hC('film', 'alphaT'), phys: [] },
        { id: 'creepTau', sym: 'τ_c', l: 'Creep time, wet', b: hC('film', 'creepTau'), phys: ['stack', 'mp1'] },
        { id: 'setFrac', sym: 's', l: 'Set: share of the roll\'s curl kept', b: hC('film', 'setFrac'), phys: ['film'] },
        { id: 'Ewet', sym: 'E₁(X_room)', l: 'Young\'s modulus in the plane, in the room', b: hCalc(() => MAT.film.Ep.v / (1 + matRoomWater() / MAT.film.Xh.v), 'GPa', 1, 'E₁ / (1 + X/X_h) at the water it holds in the room: softer with water, as its X_h sets'), phys: ['film'] },
      ] },
      { l: 'Wound on a roll', props: [
        { id: 'Er', sym: 'E_r', l: 'The turns\' stiffness through the roll', b: hC('film', 'Er'), phys: [] },
        { id: 'nuR', sym: 'ν_θr', l: 'A hoop stress thinning the turns', b: hC('film', 'nuR'), phys: [] },
      ] },
      { l: 'Strength and fracture', props: [
        { id: 'sigF', sym: 'σ_f', l: 'Tensile strength', b: hC('film', 'sigF'), phys: ['film', 'furn', 'mp1', 'mp2'] },
        { id: 'Gl', sym: 'G_l', l: 'Its layers\' hold on each other (interlayer toughness)', b: hC('film', 'Gl'), phys: ['mp7'] },
        { id: 'epsF', sym: 'ε_f', l: 'Failure strain', b: hCalc(() => MAT.film.sigF.v / (MAT.film.Ep.v * 1000) * 100, '%', 2, 'σ_f / E₁ (strength / stiffness): bent round a core of diameter D, its surface strains by its thickness / D'), phys: ['film'] },
        { id: 'GcF', sym: 'G_c', l: 'Fracture energy, through the film', b: hC('film', 'GcF'), phys: ['film'] },
        { id: 'Gil', sym: 'G_c,il', l: 'Fracture energy, between its layers', b: hC('film', 'Gil'), phys: ['film'] },
        { id: 'sigZ', sym: 'σ_z', l: 'Interlaminar cohesion', b: hC('furn', 'sigZ'), phys: ['furn', 'mp2'] },
      ] },
      { l: 'Conversion in the furnace (kinetics)', key: 'conv', props: [
        ...[['Tw', 'T_w', 'Water released: peak at 10 °C/min'], ['s1', 's₁', 'Labile oxygen (epoxide, hydroxyl): share'], ['T1', 'T₁', 'Labile oxygen: peak at 10 °C/min'], ['w1', 'σ₁', 'Labile oxygen: activation energy spread'],
          ['c1CO2', 'f_CO₂', 'Labile oxygen: share released as CO₂'], ['c1CO', 'f_CO', 'Labile oxygen: share released as CO'], ['s2', 's₂', 'Stable oxygen (carbonyl, ether): share'], ['T2', 'T₂', 'Stable oxygen: peak at 10 °C/min'],
          ['w2', 'σ₂', 'Stable oxygen: activation energy spread'], ['c2CO', 'f_CO,2', 'Stable oxygen: share released as CO'], ['T3', 'T₃', 'Remaining oxygen and hydrogen: peak'], ['w3', 'σ₃', 'Remaining oxygen and hydrogen: spread'],
          ['Hr', 'ΔH', 'Heat released with the labile oxygen']].map(([k, s, l]) => ({ id: k, sym: s, l, b: hC('furn', k), phys: k === 'Hr' ? ['mp2'] : ['furn', 'mp2'] })),
        { id: 'carbon', sym: 'w_C', l: 'Carbon in the dry GO', b: hCalc(() => hubChem().carbon, 'wt%', 1, () => `from its C/O (${MAT.slurry.co.v}, the slurry card) and H/C (${MAT.furn.hc.v}): 12.011 / (12.011 + 15.999 O/C + 1.008 H/C); the paste's spec gives 48–54 %`), phys: ['furn'] },
        { id: 'kept', sym: 'm/m₀', l: 'Mass kept, all its oxygen gone', b: hCalc(() => hubChem().kept, '% of the dry GO', 1, 'the carbon left: some leaves with the oxygen as CO and CO₂'), phys: ['furn'] },
        { id: 'cLost', sym: 'ΔC/C', l: 'Carbon lost with the oxygen', b: hCalc(() => hubChem().cLost, '% of its carbon', 1, 'as CO and CO₂ through the three stages: the film ends lighter than the carbon put in'), phys: ['furn'] },
        { id: 'co1', sym: 'C/O', l: 'C/O with its labile oxygen gone', b: hCalc(() => hubChem().co1, '', 1, 'after about 300 °C'), phys: ['furn'] },
        { id: 'co2', sym: 'C/O', l: 'C/O with its stable oxygen gone too', b: hCalc(() => hubChem().co2, '', 1, 'after about 1000 °C'), phys: ['furn'] },
        { id: 'split', sym: '', l: 'Labile oxygen out as CO₂ · CO · water', b: hCalc(() => hubChem().split, '%', 0, () => (hubChem().short ? 'its hydrogen runs short of the water set: the rest as CO' : 'as set')), phys: ['furn'] },
      ] },
      { l: 'Gas transport and puffing', props: [
        { id: 'Dgal', sym: 'D_gal', l: 'Gas diffusivity through its layers, open', b: hC('furn', 'Dgal'), phys: ['furn', 'mp2'] },
        { id: 'Dmin', sym: 'D_min', l: 'Gas diffusivity through its defects, closed', b: hC('furn', 'Dmin'), phys: ['furn', 'mp2'] },
        { id: 'es', sym: 'e_s', l: 'Puffed thickness that doubles its gas way out', b: hC('furn', 'es'), phys: ['furn', 'mp2'] },
        { id: 'dIn', sym: 'd₀₀₂', l: 'Interlayer spacing going in', b: hC('furn', 'dIn'), phys: ['furn', 'mp2'] },
      ] },
      { l: 'Shrinkage in the plane', props: [
        { id: 'bO', sym: 'ε_O', l: 'All its oxygen gone', b: hC('furn', 'bO'), phys: ['furn', 'mp2'] },
        { id: 'bG', sym: 'ε_G', l: 'As its layers order into graphite', b: hC('furn', 'bG'), phys: ['furn', 'mp2'] },
      ] },
      { l: 'Graphitization', props: [
        { id: 'Tg', sym: 'T_g', l: 'Graphitization: peak at 10 °C/min', b: hC('furn', 'Tg'), phys: ['furn', 'mp2'] },
        { id: 'wg', sym: 'σ_g', l: 'Graphitization: activation energy spread', b: hC('furn', 'wg'), phys: ['furn', 'mp2'] },
        { id: 'La0', sym: 'L_a,0', l: 'Crystallite size before graphitizing', b: hC('furn', 'La0'), phys: ['furn'] },
      ] },
    ] },
  { id: 'gfilm', name: 'Graphene film', cls: 'Solid', sub: 'Graphitized GO film', icon: 'bars',
    desc: 'The film after the furnace: graphitized, its crystallites grown.', domains: ['Furnace: the product (its heat conduction)', 'Furnace multiphysics: its heat capacity as it converts'], cards: ['furn'], models: ['gcp'],
    groups: [
      { l: 'Structure and heat conduction', props: [
        { id: 'La1', sym: 'L_a', l: 'Crystallite size, graphitized', b: hC('furn', 'La1'), phys: ['furn', 'mp8'] },
        { id: 'kG', sym: 'k_G', l: 'Graphite\'s conductivity along its layers', b: hC('furn', 'kG'), phys: ['furn', 'mp8'] },
        { id: 'ell', sym: 'ℓ', l: 'Crystallite size that halves it', b: hC('furn', 'ell'), phys: ['furn', 'mp8'] },
        { id: 'k', sym: 'k₁₁', l: 'In-plane conductivity, dense and graphitized', b: hCalc(() => MAT.furn.kG.v * 0.93 * MAT.furn.La1.v / (MAT.furn.La1.v + MAT.furn.ell.v), 'W/(m·K)', 0, 'k_G × 0.93 × L_a/(L_a + ℓ), at 2.1 g/cm³'), phys: ['furn', 'mp8'] },
        { id: 'cp', sym: 'c_p(T)', l: 'Specific heat capacity (graphite)', b: { t: 'law', id: 'gCp' }, phys: ['mp2', 'mp8'] },
      ] },
      { l: 'In use: spreading a heater\'s heat', props: [
        { id: 'kt', sym: 'k₃₃', l: 'Heat conduction through it', b: hC('furn', 'kt'), phys: ['mp8'] },
        { id: 'epsG', sym: 'ε', l: 'Emissivity of its faces', b: hC('furn', 'epsG'), phys: ['mp8'] },
        { id: 'EG', sym: 'E₁₁', l: 'Stiffness in its plane', b: hC('furn', 'EG'), phys: ['mp8'] },
        { id: 'nuG', sym: 'ν₁₂', l: 'Poisson\'s ratio in its plane', b: hC('furn', 'nuG'), phys: ['mp8'] },
        { id: 'aG', sym: 'α₁₁', l: 'Heat expansion in its plane', b: hC('furn', 'aG'), phys: ['mp8'] },
        { id: 'sigG', sym: 'σ_f', l: 'Strength in its plane', b: hC('furn', 'sigG'), phys: ['mp8'] },
      ] },
    ] },
  { id: 'web', name: 'Fibre web', cls: 'Porous solid', sub: 'Woven fabric · transversely isotropic', icon: 'fibre',
    desc: 'The carrier the slurry is coated onto, through the oven to the peel.',
    domains: ['Coating: the moving wall (a slip length over its weave)', 'Drying: the layer the oven\'s air blows up through', 'Peel and wind: the substrate under the film'], cards: ['dry', 'film'], models: ['webC'],
    groups: [
      { l: 'Identity', props: [
        { id: 'fibre', sym: '', l: 'Test report', b: { t: 'fibreSel' }, phys: ['coat', 'dry'] },
        { id: 'tUse', sym: 'T_use', l: 'Use temperature, continuous', b: hCalc(() => FIBRES[CFDG.fibre].tUse, '°C', 0, 'the test report'), phys: [], prov: 'report' },
      ] },
      { l: 'Structure', props: [
        { id: 'tf', sym: 't', l: 'Thickness', b: hI('tf'), phys: ['coat', 'dry', 'film'] },
        { id: 'gsm', sym: 'm_A', l: 'Basis weight', b: hG('gsm', 'Basis weight', 'g/m²', 10, 3000, 1, 0), phys: ['coat', 'dry', 'film'] },
        { id: 'rhoF', sym: 'ρ_f', l: 'Fibre density', b: hG('rhoF', 'Fibre density', 'kg/m³', 800, 3000, 5, 0), phys: ['coat', 'dry'] },
        { id: 'den', sym: '', l: 'Yarn linear density', b: hG('den', 'Yarn', 'denier', 5, 3000, 1, 0), phys: ['coat', 'dry'], off: () => (CFDG.dFrom === 'yarn' ? '' : 'the filament size is from the air permeability') },
        { id: 'nf', sym: '', l: 'Filaments per yarn', b: hG('nf', 'Filaments per yarn', '', 1, 1000, 1, 0), phys: ['coat', 'dry'], off: () => (CFDG.dFrom === 'yarn' ? '' : 'the filament size is from the air permeability') },
        { id: 'airPerm', sym: 'q_air', l: 'Air permeability (test)', b: hG('airPerm', 'Air permeability', '×10⁻³ m³/(m²·s)', 0.1, 5000, 0.5, 1), phys: ['coat', 'dry'] },
        { id: 'airDP', sym: 'Δp', l: 'Air permeability test pressure', b: hG('airDP', '… at test pressure', 'Pa', 0, 2000, 1, 0), phys: ['coat', 'dry'] },
        { id: 'kozeny', sym: 'K_K', l: 'Kozeny constant', b: hG('kozeny', 'Kozeny constant', '', 1, 20, 0.5, 1), phys: ['coat', 'dry'] },
        { id: 'airFrac', sym: 'a', l: 'Open (air) fraction of the top surface', b: hG('airFrac', 'Air fraction, top surface', '', 0.05, 0.95, 0.01, 2), phys: ['coat', 'dry'] },
        { id: 'eps', sym: 'ε', l: 'Porosity', b: hCalc(() => fibreStructure().eps, '', 3, '1 − m_A / (ρ_f t)'), phys: ['coat', 'dry'] },
        { id: 'd', sym: 'd_f', l: 'Filament diameter', b: hCalc(() => fibreStructure().d * 1e6, 'µm', 1, () => (CFDG.dFrom === 'yarn' ? `from the ${CFDG.den} denier yarn of ${CFDG.nf} filaments and the fibre density` : 'from the air permeability (Kozeny–Carman)')), phys: ['coat', 'dry'] },
        { id: 'kD', sym: 'k_D', l: 'Permeability (Kozeny–Carman)', b: hCalc(() => fibrePermeability(), 'm²', -3, 'd_f² ε³ / (16 K_K (1 − ε)²)'), phys: ['coat', 'dry'] },
      ] },
      { l: 'Thermal', props: [
        { id: 'cpWeb', sym: 'c_p', l: 'Specific heat capacity', b: hC('dry', 'cpWeb'), phys: ['dry', 'film'] },
        { id: 'kFib', sym: 'k_f', l: 'Thermal conductivity of its fibres', b: hC('dry', 'kFib'), phys: ['mp5'] },
        { id: 'kWeb', sym: 'k', l: 'Thermal conductivity, the web (fibres in air)', b: hCalc(() => { const e = fibreStructure().eps, ka = 0.0283, kf = MAT.dry.kFib.v; return ka * (2 * ka + kf - 2 * (1 - e) * (ka - kf)) / (2 * ka + kf + (1 - e) * (ka - kf)); }, 'W/(m·K)', 3, 'Maxwell–Eucken, the air around the fibres (air 0.028 W/(m·K) at 50 °C)'), phys: ['mp5'] },
        { id: 'alphaW', sym: 'α', l: 'Thermal expansion', b: hC('film', 'alphaW'), phys: ['film'] },
      ] },
      { l: 'Mechanical', props: [
        { id: 'C', sym: 'C', l: 'Stiffness', b: { t: 'stiffWeb' }, phys: ['film'] },
        { id: 'Ew', sym: 'E₁', l: 'Young\'s modulus along the line', b: hC('film', 'Ew'), phys: ['film'], sub: true },
        { id: 'soft', sym: 'E₃/E₁', l: 'Through the thickness and in shear, × E₁', b: hC('film', 'soft'), phys: ['film'], sub: true },
        { id: 'nuw', sym: 'ν₁₂', l: 'Poisson\'s ratio', b: hC('film', 'nuw'), phys: ['film'], sub: true },
        { id: 'nupt', sym: 'ν₁₃', l: 'Poisson\'s ratio, plane to thickness', b: hC('lib', 'webNupt'), phys: ['film'], sub: true },
        { id: 'Gpt', sym: 'G₁₃', l: 'Shear modulus through it', b: hCalc(() => MAT.film.Ew.v * MAT.film.soft.v / 2, 'GPa', 3, 'E₁ × (E₃/E₁) / 2: the solver\'s rule'), phys: ['film'], sub: true, prov: 'builtin' },
        { id: 'EA', sym: 'E₁ t', l: 'Tensile stiffness per width', b: hCalc(() => MAT.film.Ew.v * 1e9 * P.tf / 1000 / 1000, 'kN/m', 0, 'E₁ × its thickness, along it (the inputs bar\'s fibre thickness)'), phys: ['film'] },
      ] },
    ] },
  { id: 'paper', name: 'Graphite paper', cls: 'Solid', sub: 'Flexible graphite · transversely isotropic', icon: 'film',
    desc: 'The sheets between the pieces in the furnace\'s stack.', domains: ['Furnace: the papers between the pieces', 'Furnace multiphysics: the papers\' heat and gas'], cards: ['furn'], models: ['gcp', 'kT'],
    groups: [
      { l: 'Basic', props: [
        { id: 'rhoP', sym: 'ρ', l: 'Density', b: hC('furn', 'rhoP'), phys: ['furn', 'mp2'] },
        { id: 'cp', sym: 'c_p(T)', l: 'Specific heat capacity (graphite)', b: { t: 'law', id: 'gCp' }, phys: ['mp2'] },
      ] },
      { l: 'Thermal conduction', props: [
        { id: 'k', sym: 'k', l: 'Thermal conductivity', b: { t: 'tensor', axial: 'kPthr', trans: 'kPin', u: 'W/(m·K)', what: 'heat' }, phys: ['mp2'] },
        { id: 'kPin', sym: 'k₁₁ = k₂₂', l: 'in the plane', b: hC('furn', 'kPin'), phys: ['mp2'], sub: true },
        { id: 'kPthr', sym: 'k₃₃', l: 'through the thickness', b: hC('furn', 'kPthr'), phys: ['mp2'], sub: true },
      ] },
      { l: 'Mechanical and gas', props: [
        { id: 'Ez', sym: 'E₃', l: 'Young\'s modulus through the thickness', b: hC('furn', 'Ez'), phys: ['furn'] },
        { id: 'Dp', sym: 'D_p', l: 'Gas diffusivity along the paper', b: hC('furn', 'Dp'), phys: ['furn', 'mp2'] },
      ] },
    ] },
  { id: 'plate', name: 'Isostatic graphite', cls: 'Solid', sub: 'Holder plates · isotropic', icon: 'weight',
    desc: 'The holder\'s plates the stack sits between in the furnace.', domains: ['Furnace: the plates on the stack (weight, gas, sticking)', 'Furnace multiphysics: the holder\'s heat'], cards: ['furn'], models: ['gcp'],
    groups: [
      { l: 'Basic', props: [
        { id: 'rhoPl', sym: 'ρ', l: 'Density', b: hC('furn', 'rhoPl'), phys: ['mp2'] },
        { id: 'cp', sym: 'c_p(T)', l: 'Specific heat capacity (graphite)', b: { t: 'law', id: 'gCp' }, phys: ['mp2'] },
        { id: 'kPl', sym: 'k', l: 'Thermal conductivity', b: hC('furn', 'kPl'), phys: ['mp2'] },
        { id: 'epsF', sym: 'ε', l: 'Emissivity of its faces (to the hot zone)', b: hC('furn', 'epsF'), phys: ['mp2'] },
      ] },
      { l: 'Mechanical and gas', props: [
        { id: 'E', sym: 'E', l: 'Young\'s modulus', b: hC('lib', 'plE'), phys: ['furn'] },
        { id: 'Bpl', sym: 'B', l: 'Gas permeability coefficient', b: hC('furn', 'Bpl'), phys: ['furn', 'mp2'] },
      ] },
    ] },
  // (MC-2: materials the spec names that no solver reads at present -- their values empty until given, none made up)
  { id: 'paste', name: 'GO paste', cls: 'Fluid', sub: 'Concentrated GO, before dilution', icon: 'drop',
    desc: 'The paste the slurry is made from.', domains: ['Mixing: the paste the slurry is made from'], cards: ['xrec'],
    groups: [{ l: 'Basic', props: [
      { id: 'w', sym: 'w_s', l: 'Solids content', b: hC('xrec', 'paRhoS'), phys: [] },
      { id: 'rho', sym: 'ρ', l: 'Density', b: hC('xrec', 'paRho'), phys: [] },
      { id: 'mu', sym: 'μ', l: 'Viscosity', b: hC('xrec', 'paMu'), phys: [] },
      { id: 'ty', sym: 'τ_y', l: 'Yield stress', b: hC('xrec', 'paTy'), phys: [] }] },
    { l: 'Thermal', props: [
      { id: 'cp', sym: 'c_p', l: 'Specific heat capacity', b: hC('xrec', 'paCp'), phys: [] },
      { id: 'k', sym: 'k', l: 'Thermal conductivity', b: hC('xrec', 'paK'), phys: [] }] }] },
  { id: 'cfilm', name: 'Carbonized film', cls: 'Solid', sub: 'Laminate · between the furnace\'s runs', icon: 'bars',
    desc: 'The film after the first furnace run: its oxygen largely gone, before graphitizing.', domains: ['Furnace: the pieces between the two runs'], cards: ['xrec'],
    groups: [{ l: 'Basic', props: [
      { id: 'rho', sym: 'ρ', l: 'Density', b: hC('xrec', 'cfRho'), phys: [] },
      { id: 'co', sym: 'C/O', l: 'Carbon to oxygen ratio', b: hC('xrec', 'cfCO'), phys: [] }] },
    { l: 'Thermal', props: [
      { id: 'cp', sym: 'c_p', l: 'Specific heat capacity', b: hC('xrec', 'cfCp'), phys: [] },
      { id: 'kIn', sym: 'k_11', l: 'Thermal conductivity in the plane', b: hC('xrec', 'cfKin'), phys: [] },
      { id: 'kThr', sym: 'k_33', l: 'Thermal conductivity through the thickness', b: hC('xrec', 'cfKthr'), phys: [] }] },
    { l: 'Mechanical', props: [
      { id: 'E', sym: 'E_1', l: 'Young\'s modulus in the plane', b: hC('xrec', 'cfE'), phys: [] }] }] },
  { id: 'blade', name: 'Blade material', cls: 'Solid', sub: 'The coating blade · isotropic', icon: 'weight',
    desc: 'The blade the slurry flows under: a rigid wall in the coating\'s flow.', domains: ['Coating: the blade'], cards: ['xrec'],
    groups: [{ l: 'Basic', props: [
      { id: 'rho', sym: 'ρ', l: 'Density', b: hC('xrec', 'blRho'), phys: [] }] },
    { l: 'Thermal', props: [
      { id: 'cp', sym: 'c_p', l: 'Specific heat capacity', b: hC('xrec', 'blCp'), phys: [] },
      { id: 'k', sym: 'k', l: 'Thermal conductivity', b: hC('xrec', 'blK'), phys: [] },
      { id: 'alpha', sym: 'α', l: 'Thermal expansion', b: hC('xrec', 'blAlpha'), phys: [] }] },
    { l: 'Mechanical', props: [
      { id: 'E', sym: 'E', l: 'Young\'s modulus', b: hC('xrec', 'blE'), phys: [] },
      { id: 'nu', sym: 'ν', l: 'Poisson\'s ratio', b: hC('xrec', 'blNu'), phys: [] }] }] },
  { id: 'al', name: 'Aluminium', cls: 'Solid', sub: 'Pre heat plate · isotropic', icon: 'weight',
    desc: 'The plate pressing the stack in the pre heat treatment.', domains: ['Pre heat multiphysics: the plate on the stack'], cards: ['lib'],
    groups: [
      { l: 'Basic', props: [
        { id: 'rho', sym: 'ρ', l: 'Density', b: hC('lib', 'alRho'), phys: ['mp1'] },
        { id: 'c', sym: 'c_p', l: 'Specific heat capacity', b: hC('lib', 'alC'), phys: ['mp1'] },
        { id: 'k', sym: 'k', l: 'Thermal conductivity', b: hC('lib', 'alK'), phys: ['mp1'] },
        { id: 'epsPl', sym: 'ε', l: 'Emissivity', b: { t: 'peel', k: 'epsPl' }, phys: ['mp1'] },
      ] },
    ] },
];
/** The interfaces: a pair's own properties (surface tension, wetting, adhesion, friction, contact). */
// (MP-5: the drying's multiphysics reads what the drying reads, the film's and the web's mechanics and the GO's conduction along
//  the film -- marked here rather than on each row)
{
  const mp5 = { gofilm: ['kIn', 'beta', 'Xh', 'C', 'Ep', 'Et', 'nup', 'nupt', 'Gpt', 'alphaF', 'sigF'], web: ['alphaW', 'C', 'Ew', 'soft', 'nuw', 'nupt', 'Gpt'], gel: ['Eg', 'nu', 'G'] };
  for (const r of HUB_RECORDS) for (const g of r.groups || []) for (const q of g.props) if (q.phys && !q.phys.includes('mp5') && (q.phys.includes('dry') || (mp5[r.id] || []).includes(q.id))) q.phys.push('mp5');
}
// (MP-PEEL: the peel front's multiphysics reads the film's mechanics and its softening with water, the web's mechanics,
//  the gel's when the film is wet at the peel, the film's strength)
{
  const mp4 = { gofilm: ['Xh', 'Ep', 'Et', 'nup', 'nupt', 'Gpt', 'sigF'], web: ['Ew', 'soft', 'nuw', 'nupt', 'Gpt'], gel: ['Eg', 'nu', 'G'] };
  for (const r of HUB_RECORDS) for (const g of r.groups || []) for (const q of g.props) if (q.phys && !q.phys.includes('mp4') && (mp4[r.id] || []).includes(q.id)) q.phys.push('mp4');
}
// (MP-PEEL 1D: the roll reads the film's stiffness along it and its softening with water, its strength, how it swells along
//  and through it with water and heat, the roll's stiffness through its turns, the GO's isotherm, its vapour permeability
//  through it, its heat conduction through it and heat capacity; the 3D, its heat conduction along it and the water along
//  the turns)
{
  const mp6 = { gofilm: ['Xh', 'Ep', 'nup', 'sigF', 'beta', 'betaT', 'alphaF', 'alphaT', 'Er', 'nuR', 'gabXm', 'gabC', 'gabK', 'gabT0', 'gabHc', 'Kv', 'skinK', 'k', 'kS', 'kIn', 'cS', 'rho', 'phiDry'] };
  for (const r of HUB_RECORDS) for (const g of r.groups || []) for (const q of g.props) if (q.phys && !q.phys.includes('mp6') && (mp6[r.id] || []).includes(q.id)) q.phys.push('mp6');
}
// (MP-CUT: the cut edge reads the film's layers (their stiffness and its softening with water, Poisson's ratio, the
//  drying's stress in each), its strength, its layers' hold on each other, its weight and the roll's set (the 3D piece))
{
  const mp7 = { gofilm: ['Xh', 'Ep', 'nup', 'sigF', 'Gl', 'rho', 'phiDry'] };
  for (const r of HUB_RECORDS) for (const g of r.groups || []) for (const q of g.props) if (q.phys && !q.phys.includes('mp7') && (mp7[r.id] || []).includes(q.id)) q.phys.push('mp7');
}
const HUB_IFACES = [
  { id: 'i-slurry-air', name: 'Slurry | air', a: 'slurry', bb: 'air', sub: 'Free surface', icon: 'flow', domains: ['Coating: the meniscus and the free film (1D, 2D, 3D)'],
    groups: [{ l: 'Surface', props: [{ id: 'g', sym: 'γ', l: 'Surface tension', b: hI('g'), phys: ['coat'] }] }] },
  { id: 'i-slurry-blade', name: 'Slurry | blade', a: 'slurry', bb: null, sub: 'Wetting on the blade\'s exit face', icon: 'flow', domains: ['Coating: the contact line on the blade (2D, 3D)'],
    groups: [{ l: 'Wetting', props: [
      { id: 'th', sym: 'θ', l: 'Contact angle', b: hI('th'), phys: ['coat'], note: 'a location can set its own (Coating › 2D, its inputs)' },
      { id: 'dth', sym: 'Δθ', l: 'Contact angle variation (contamination, residue)', b: hI('dth'), phys: ['coat'] }] }] },
  { id: 'i-slurry-web', name: 'Slurry | fibre web', a: 'slurry', bb: 'web', sub: 'Wetting and slip on the weave', icon: 'fibre', domains: ['Coating: the moving wall (slip), the bare web beside the film (3D, open edges)'],
    groups: [{ l: 'Wetting and slip', props: [
      { id: 'thw', sym: 'θ_w', l: 'Contact angle on the bare web', b: hI('thw'), phys: ['coat'] },
      { id: 'bAlong', sym: 'b∥', l: 'Slip length along the stripes', b: hCalc(() => fibreSlip().along * 1e6, 'µm', 2, 'Philip (1972): (period/π) ln sec(π a / 2), shear-free (air) stripes of fraction a'), phys: ['coat'] },
      { id: 'bAcross', sym: 'b⊥', l: 'Slip length across the stripes', b: hCalc(() => fibreSlip().across * 1e6, 'µm', 2, 'half of along'), phys: ['coat'] },
      { id: 'b', sym: 'b', l: 'Slip length the flow sees', b: hCalc(() => fibreSlip().b * 1e6, 'µm', 2, 'the mean of the two: a plain weave shows warp and weft crowns equally'), phys: ['coat'] }] }] },
  { id: 'i-film-web', name: 'Dried GO film | fibre web', a: 'gofilm', bb: 'web', sub: 'Adhesion', icon: 'film', domains: ['Peel and wind: the film peeled off the web'], cards: ['film'],
    groups: [{ l: 'Adhesion', props: [{ id: 'Gi', sym: 'G_i', l: 'Adhesion energy', b: hC('film', 'Gi'), phys: ['film', 'mp4'] },
      { id: 'sigI', sym: 'σ̂_i', l: 'Adhesion strength (the most the hold pulls)', b: hC('film', 'sigI'), phys: ['mp4'] }] }] },
  { id: 'i-film-paper', name: 'GO film | graphite paper', a: 'gofilm', bb: 'paper', sub: 'Friction, sticking, contact', icon: 'film', domains: ['Furnace: each piece on its papers', 'Furnace multiphysics: the contact\'s heat'], cards: ['furn'],
    groups: [{ l: 'Contact', props: [
      { id: 'mu', sym: 'μ_f', l: 'Friction coefficient', b: hC('furn', 'mu'), phys: ['furn'] },
      { id: 'Tst', sym: 'T_st', l: 'Sticks from', b: hC('furn', 'Tst'), phys: ['furn'] },
      { id: 'pSt', sym: 'p_st', l: 'Sticks where pressed at least', b: hC('furn', 'pSt'), phys: ['furn'] },
      { id: 'tauB', sym: 'τ_b', l: 'Bond strength, stuck', b: hC('furn', 'tauB'), phys: ['furn'] },
      { id: 'am', sym: 'Δα', l: 'Thermal expansion mismatch (film − paper)', b: hC('furn', 'am'), phys: ['furn', 'mp2'] },
      { id: 'Rc', sym: 'R_c', l: 'Thermal contact resistance', b: hC('furn', 'Rc'), phys: ['mp2'] }] }] },
  { id: 'i-film-plate', name: 'GO film | holder plate', a: 'gofilm', bb: 'plate', sub: 'Friction, sticking', icon: 'weight', domains: ['Furnace: the top and bottom pieces on the plates'], cards: ['furn'],
    groups: [{ l: 'Contact', props: [
      { id: 'muPl', sym: 'μ_f', l: 'Friction coefficient', b: hC('furn', 'muPl'), phys: ['furn'] },
      { id: 'TstPl', sym: 'T_st', l: 'Sticks from', b: hC('furn', 'TstPl'), phys: ['furn'] },
      { id: 'tauPl', sym: 'τ_b', l: 'Bond strength, stuck', b: hC('furn', 'tauPl'), phys: ['furn'] }] }] },
];
const hubBaseAll = () => [...HUB_RECORDS, ...HUB_IFACES];
const hubProps = r => r.groups.flatMap(g => g.props);

// ---- copies of a material and the domains they are assigned to (MC-2) ----
/**
 * A copy is a material of its own made from another (MAT.inst[id]: { base, name, vals, law }): its card values and its
 * laws' parameters, edited apart from the project's; everything else (the inputs bar's, the fibre's test report) is the
 * project's. Assigned to a domain (MAT.assign[base][i]: the record's i-th domain), the solvers there take its values.
 */
/** Each record's domains (its r.domains, in order): the solvers in each. */
const HUB_DOMAIN_PHYS = {
  slurry: [['coat', 'align'], ['mix'], ['dry', 'film', 'mp5']], flakes: [['mix', 'coat', 'align'], ['dry', 'film', 'stack', 'mp1', 'furn', 'mp2', 'mp5']],
  water: [['mix', 'coat'], ['dry', 'film', 'stack', 'mp1', 'mp2', 'mp5']], air: [['dry', 'film', 'mp5'], ['mp1'], ['coat']], argon: [['mp2']], gel: [['film', 'mp5']],
  gofilm: [['dry', 'align', 'mp5'], ['film'], ['stack', 'mp1'], ['furn', 'mp2']], gfilm: [['furn', 'mp8'], ['mp2']], web: [['coat'], ['dry', 'mp5'], ['film']],
  paper: [['furn'], ['mp2']], plate: [['furn'], ['mp2']], al: [['mp1']], paste: [[]], cfilm: [[]], blade: [[]], 'i-slurry-air': [['coat']], 'i-slurry-blade': [['coat']], 'i-slurry-web': [['coat']],
  'i-film-web': [['film']], 'i-film-paper': [['furn'], ['mp2']], 'i-film-plate': [['furn']],
};
/** The solvers that take an assigned material: each builds its inputs in one function, run with the material (matRun). */
const HUB_SWAP = { dry: ['dryBase'], film: ['filmOpts'], stack: ['stackInputs'], mp1: ['mpStackInputs'], furn: ['furnInputs', 'furnDoeOpts'], mp2: ['fmpInputs'], mp5: ['dmpInputs'] };
const hubBaseRec = id => hubBaseAll().find(r => r.id === id);
/** A copy as a record: its base's, with its own name and id; its properties' bindings carry the copy's id. */
function hubInstRec(id) {
  const I = typeof MAT !== 'undefined' && MAT.inst && MAT.inst[id], B = I && hubBaseRec(I.base);
  if (!B) return null;
  return { ...B, id, inst: id, base: B.id, name: I.name, groups: B.groups.map(g => ({ ...g, props: g.props.map(p => ({ ...p, b: { ...p.b, inst: id } })) })) };
}
const hubInsts = base => Object.keys((typeof MAT !== 'undefined' && MAT.inst) || {}).filter(id => !base || MAT.inst[id].base === base);
const hubAll = () => [...hubBaseAll(), ...hubInsts().map(hubInstRec).filter(Boolean)];
const hubRec = id => hubBaseRec(id) || hubInstRec(id);
/** A binding without its copy's id (the base's own). */
const hubPlainB = b => { const { inst, ...q } = b; return q; };
/** The project's state with a copy's values in place of its base's: card values, laws' parameters (a new object; m kept). */
function hubOverlay(m, B, I) {
  const v = { ...m }, law = { ...(m.law || {}) };
  for (const p of hubProps(B)) {
    const b = p.b;
    if (b.t === 'card' && I.vals && I.vals[p.id]) { if (v[b.card] === m[b.card]) v[b.card] = { ...m[b.card] }; v[b.card][b.k] = I.vals[p.id]; }
    if (b.t === 'law') { if (I.law && I.law[b.id]) law[b.id] = I.law[b.id]; else delete law[b.id]; }
  }
  v.law = law;
  return v;
}
let HUB_IN = null;
/** Run f with a copy's values in place (write: what f changed in them goes back to the copy). */
function hubInInst(id, f, write = false) {
  if (HUB_IN === id) return f();
  const I = MAT.inst[id], B = hubBaseRec(I.base), real = MAT, outer = HUB_IN;
  const view = hubOverlay(real, B, I);
  MAT = view; HUB_IN = id;
  try { return f(); } finally {
    MAT = real; HUB_IN = outer;
    if (write) {
      const vals = {}, law = {};
      for (const p of hubProps(B)) { const b = p.b; if (b.t === 'card') vals[p.id] = view[b.card][b.k]; if (b.t === 'law' && view.law && view.law[b.id]) law[b.id] = view.law[b.id]; }
      MAT.inst = { ...MAT.inst, [id]: { ...MAT.inst[id], vals, law } };
    }
  }
}
/** Make a copy of a material (a copy's copy: of its values); its domains keep the material they had. */
function hubDuplicate(id) {
  const src = hubRec(id), B = hubBaseRec(src.base || src.id), vals = {}, law = {};
  const read = () => { for (const p of hubProps(B)) { const b = p.b; if (b.t === 'card') vals[p.id] = JSON.parse(JSON.stringify(MAT[b.card][b.k])); if (b.t === 'law' && MAT.law && MAT.law[b.id]) law[b.id] = JSON.parse(JSON.stringify(MAT.law[b.id])); } };
  if (src.inst) hubInInst(src.inst, read); else read();
  let n = 1; while ((MAT.inst || {})[`${B.id}~${n}`]) n++;
  const nid = `${B.id}~${n}`, name = `${hubName(src)} (copy${n > 1 ? ' ' + n : ''})`;
  MAT.inst = { ...(MAT.inst || {}), [nid]: { base: B.id, name, vals, law } };
  const m = { ...((MAT.meta || {})[src.id] || {}) }; delete m.name;
  MAT.meta = { ...(MAT.meta || {}), [nid]: m };
  return nid;
}
/** Remove a copy: the domains it was assigned to take their record's own again. */
function hubDeleteInst(id) {
  const I = MAT.inst[id]; if (!I) return;
  const inst = { ...MAT.inst }; delete inst[id]; MAT.inst = inst;
  const a = { ...((MAT.assign || {})[I.base] || {}) }; for (const k of Object.keys(a)) if (a[k] === id) delete a[k];
  MAT.assign = { ...(MAT.assign || {}), [I.base]: a };
  if (MAT.meta && MAT.meta[id]) { const mt = { ...MAT.meta }; delete mt[id]; MAT.meta = mt; }
}
/** Assign a material (a copy's id, or the record's own: null) to a record's i-th domain. */
function hubAssign(base, i, id) {
  const a = { ...((MAT.assign || {})[base] || {}) };
  if (id && id !== base) a[i] = id; else delete a[i];
  MAT.assign = { ...(MAT.assign || {}), [base]: a };
}
/** The copy a solver takes for a record (its domain's assignment), or null (the record's own). */
function hubAssignedFor(base, ph) {
  const doms = HUB_DOMAIN_PHYS[base] || [], a = (MAT.assign || {})[base] || {};
  for (let i = 0; i < doms.length; i++) if (doms[i].includes(ph) && a[i] && MAT.inst && MAT.inst[a[i]]) return a[i];
  return null;
}
/** A domain's material can be assigned when a solver there takes it (HUB_SWAP). */
const hubDomainSwaps = (base, i) => ((HUB_DOMAIN_PHYS[base] || [])[i] || []).filter(ph => HUB_SWAP[ph]);
let HUB_REAL = null;
/** Run a solver's input builder with the materials assigned to its domains in place (none: as it is). */
function matRun(ph, f) {
  if (typeof MAT === 'undefined' || !MAT.assign) return f();
  const base = HUB_REAL || MAT, swaps = hubBaseAll().map(r => [r, hubAssignedFor(r.id, ph)]).filter(([, id]) => id);
  if (!swaps.length && !HUB_REAL) return f();
  let v = base; for (const [r, id] of swaps) v = hubOverlay(v, r, base.inst[id]);
  const keep = MAT, outer = HUB_REAL; HUB_REAL = base; MAT = v;
  try { return f(); } finally { MAT = keep; HUB_REAL = outer; }
}

/** The GO's chemistry as the Furnace card has it (furnace.js fuChem): mass kept, C/O after the stages, the labile split. */
function hubChem() {
  const f = MAT.furn, c = fuChem({ co: MAT.slurry.co.v, hc: f.hc.v, s1: f.s1.v, c1CO2: f.c1CO2.v, c1CO: f.c1CO.v, s2: f.s2.v, c2CO: f.c2CO.v });
  const kept = n => (1 - c.stages.slice(0, n).reduce((s, q) => s + q.mass, 0) / c.mGO) * 100;
  const co = n => { const O = c.O0 - c.stages.slice(0, n).reduce((s, q) => s + q.O, 0), C = 1 - c.stages.slice(0, n).reduce((s, q) => s + q.C, 0); return O > 1e-9 ? C / O : Infinity; };
  return { c, kept: kept(3), co1: co(1), co2: co(2), carbon: FU_M.C / c.mGO * 100, cLost: c.stages.reduce((s, q) => s + q.C, 0) * 100, split: `${(c.split1.CO2 * 100).toFixed(0)} · ${(c.split1.CO * 100).toFixed(0)} · ${(c.split1.H2O * 100).toFixed(0)}`, short: c.split1.H2O < 1 - f.c1CO2.v - f.c1CO.v - 1e-9 };
}

// ---- a property's value, unit, provenance ----
/** What the property shows: { v (number or text), u, d (decimals; < 0: significant digits), prov, src, edit, lo, hi, step }. */
function hubVal(p) {
  if (p.b.inst) return hubInInst(p.b.inst, () => hubVal({ ...p, b: hubPlainB(p.b) }));
  const b = p.b;
  switch (b.t) {
    case 'card': {
      const q = hubRow(b.card, b.k), e = MAT[b.card][b.k];
      return { v: e.v, u: q[2], d: q[6], prov: hubProvOf(e), src: e.src, edit: !e.def, lo: q[3], hi: q[4], step: q[5], label: q[1], def: e.def || null };
    }
    case 'inp': {
      const c = CFG.find(q => q.k === b.k), pv = (MAT.prov || {})['in.' + b.k], fit = (MAT.rheo.side || {})[b.k], dflt = HUB_INP_PROV[b.k];
      const fitted = fit && fit.v === P[b.k] || ((b.k === 'K' || b.k === 'eta0') && (MAT.rheo.side || {}).mu && MAT.rheo.side.mu.v === P.mu);
      const prov = fitted ? 'fitted' : pv && HUB_PROV[pv.kind] ? pv.kind : dflt ? dflt[0] : /assumed/.test(c.h || '') ? 'assumed' : 'user';
      const src = fitted ? (fit || MAT.rheo.side.mu).src : pv && pv.src != null ? pv.src : dflt ? dflt[1] : c.h || 'you (the inputs bar)';
      const u = b.k === 'K' ? `Pa·s${P.n === 1 ? '' : `^${+P.n.toFixed(3)}`}` : c.u;
      return { v: P[b.k], u, d: c.d, prov, src, edit: true, lo: c.min, hi: c.max, step: c.step, label: c.l, exact: INPUT_EXACT.has(b.k) };
    }
    case 'cfdg': {
      const f = FIBRES[CFDG.fibre], same = f.set[b.k] === CFDG[b.k];
      return { v: CFDG[b.k], u: b.u, d: b.d, prov: same ? 'report' : 'user', src: same ? `the test report (${f.l})` : `you (the report: ${f.set[b.k]})`, edit: true, lo: b.lo, hi: b.hi, step: b.step, label: b.l };
    }
    case 'peel': {
      const q = OVEN_PEEL_FIELDS.find(f => f[0] === b.k);
      return { v: OVEN.peel[b.k], u: q[2], d: q[6], prov: OVEN.peel[q[7]] ? 'user' : 'assumed', src: typeof helpOf === 'function' && helpOf('oven.' + b.k) ? helpOf('oven.' + b.k).d : '', edit: true, lo: q[3], hi: q[4], step: q[5], label: q[1] };
    }
    case 'calc': {
      let v; try { v = b.f(); } catch (e) { v = NaN; }
      return { v, u: b.u, d: b.d, prov: p.prov || 'calc', src: typeof b.how === 'function' ? b.how() : b.how };
    }
    case 'const': { const c = HUB_CONST[b.id]; return { v: c.v, u: c.u, d: -4, prov: 'builtin', src: `${c.src} (${c.solver})` }; }
    case 'law': { const L = HUB_LAW[b.id]; let v; try { v = hubLawAt(b.id, 20); } catch (e) { v = NaN; } return { v, u: L.u, d: -4, prov: 'builtin', src: `${L.src} (${L.solver})`, at: '20 °C', law: true }; }
    case 'measured': return { v: RHEO_MEASURED.mu, u: 'Pa·s', d: 1, prov: 'measured', src: 'your measurement, the slurry at 2.7 1/s' };
    case 'model': return { v: RHEO_MODELS[CFDG.model].l, u: '', prov: 'user', src: ML_RHEO[CFDG.model] ? ML_RHEO[CFDG.model].formula : '' };
    case 'orModel': return { v: OR_MODELS[MAT.orient.model], u: '', prov: 'user', src: 'you' };
    case 'switch': return { v: b.get() ? 'On' : 'Off', u: '', prov: 'user', src: b.get() ? b.on : b.off };
    case 'fibreSel': return { v: FIBRES[CFDG.fibre].l, u: '', prov: 'report', src: FIBRES[CFDG.fibre].note };
    case 'tensor': {
      const r = hubTensorOf(p), [a, t] = [r.axial, r.trans];
      return { v: `${hubFmt(t, -3)} · ${hubFmt(t, -3)} · ${hubFmt(a, -3)}`, u: b.u, prov: 'calc', src: `transversely isotropic: k₁₁ = k₂₂ in the plane, k₃₃ through the thickness; anisotropy ${hubFmt(t / a, 3)}`, tensor: true };
    }
    case 'stiff': case 'stiffWeb': {
      const C = hubStiff(b.t === 'stiffWeb' ? 'web' : 'go'), bad = mlCCheck(C).length > 0;
      return { v: bad ? 'not positive definite' : `C₁₁ ${hubFmt(C[0][0] / 1e9, -3)} · C₃₃ ${hubFmt(C[2][2] / 1e9, -3)} · C₅₅ ${hubFmt(C[4][4] / 1e9, -3)}`, u: 'GPa', prov: 'calc', src: 'transversely isotropic, 6 × 6 (Voigt) from the moduli below', tensor: true, bad };
    }
    default: return { v: '', u: '' };
  }
}
/** The inputs bar's material values' first provenance, as their values came (until set otherwise). */
const HUB_INP_PROV = {
  mu: ['measured', 'your measurement: 10.5 Pa·s at 2.7 1/s'],
  K: ['assumed', 'from your measured 10.5 Pa·s at 2.7 1/s with the yield stress and n: K = (η₂.₇ − τy/2.7) 2.7^(1−n)'],
  eta0: ['assumed', 'from your measured 10.5 Pa·s at 2.7 1/s with η∞, λ, a and n'],
  n: ['assumed', '1: no shear thinning (a flow curve fit gives it)'],
  ty: ['assumed', 'a flow curve or an amplitude sweep gives it'],
  g: ['assumed', 'water 0.072 N/m at 25 °C (a pendant drop gives it)'],
  th: ['assumed', 'a sessile drop on the blade\'s steel gives it'],
  thw: ['assumed', 'a sessile drop on the web gives it'],
  dth: ['assumed', 'contamination, residue'],
  tf: ['supplier', 'the fibre\'s test report (0.20 mm)'],
};
/** A number for a table: d ≥ 0 decimals; d < 0: |d| significant digits (exponential when small or large). */
function hubFmt(v, d = 3) {
  if (typeof v !== 'number') return String(v ?? '');
  if (!Number.isFinite(v)) return '—';
  if (d >= 0) return v.toFixed(d);
  const a = Math.abs(v), n = -d;
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(n - 1);
  return String(+v.toPrecision(n));
}
/** A tensor property's two values in SI (axial: through the thickness; trans: in the plane). */
function hubTensorOf(p) {
  const b = p.b, card = k => { const pr = HUB_RECORDS.flatMap(hubProps).find(q => q.b.t === 'card' && q.b.k === k); return MAT[pr.b.card][k].v; };
  const sc = k => (b.scale && b.scale[k]) || 1;
  return { axial: card(b.axial) * sc(b.axial), trans: card(b.trans) * sc(b.trans) };
}
/** The 6 × 6 stiffness (Pa) of the dried film ('go') or the web ('web'), in the material frame (3: the normal). */
function hubStiff(which) {
  const f = MAT.film, v = k => f[k].v;
  if (which === 'web') return mlCEval({ form: 'ti', Ep: v('Ew') * 1e9, Et: v('Ew') * v('soft') * 1e9, nup: v('nuw'), nupt: MAT.lib.webNupt.v, Gpt: v('Ew') * v('soft') * 1e9 / 2, axis: 2 });
  return mlCEval({ form: 'ti', Ep: v('Ep') * 1e9, Et: v('Et') * 1e9, nup: v('nup'), nupt: v('nupt'), Gpt: v('Gpt') * 1e9, axis: 2 });
}
/** Whether a row is left out of the table: a parameter of a law or model not chosen (the chosen one's rows only; picking
 *  another brings its rows in, their values kept). A switch turned off only greys its rows. */
function hubHidden(p) {
  if (!p.law || !hubOff(p)) return false;
  return !(p.b.t === 'card' && p.b.card === 'orient' && !MAT.orient.on);
}
/** Whether a property is used as things are set (its law, its model, its switch): '' when it is, else why not. */
function hubOff(p) {
  if (p.b.inst) return hubInInst(p.b.inst, () => hubOff({ ...p, b: hubPlainB(p.b) }));
  if (p.off) { const o = p.off(); if (o) return o; }
  if (p.b.t === 'card') return cardOff(p.b.card, p.b.k);
  return '';
}

// ---- properties in temperature (MH-4b) ----
/**
 * The card values a solver can take in temperature: card.key → [the solvers that evaluate it at each point's
 * temperature, the range it is checked over (°C)]. The others (the drying, Peel and wind) take its value at 20 °C: the
 * value kept beside a definition.
 */
const HUB_TDEP = { 'dry.kIn': [['mp1', 'mp2'], [0, 3000]], 'dry.kS': [['mp1', 'mp2'], [0, 3000]], 'dry.cS': [['mp1'], [0, 300]], 'furn.kPin': [['mp2'], [0, 3000]],
  'furn.kPthr': [['mp2'], [0, 3000]], 'furn.kPl': [['mp2'], [0, 3000]], 'lib.alK': [['mp1'], [0, 300]], 'lib.alC': [['mp1'], [0, 300]] };
const hubTdep = p => (p.b.t === 'card' && HUB_TDEP[`${p.b.card}.${p.b.k}`]) || null;
/** A solver's inputs: { name: definition } of the card values given that have one (none: nothing added, the inputs as before). */
const hubDefsOf = m => Object.fromEntries(Object.entries(m).filter(([, e]) => e && e.def).map(([k, e]) => [k, e.def]));
/** A definition's value at T (°C). */
const hubDefAt = (q, Tc) => mlQEval(q, { T: Tc + 273.15 });
/** A definition's problems: matlib's own checks; an expression in T alone; its values finite and positive over the range. */
function hubDefCheck(q, range = [0, 3000]) {
  const out = mlQCheck(q).filter(c => c.level === 'error').map(c => c.msg);
  if (out.length) return out;
  if (q.kind === 'expr') { try { mlExpr(q.src, ['T'], q.params || {}); } catch (e) { return [e.message]; } }
  const lo = q.kind === 'table' && (q.extrap || 'error') === 'error' ? Math.max(range[0], q.x[0] - 273.15) : range[0], hi = q.kind === 'table' && (q.extrap || 'error') === 'error' ? Math.min(range[1], q.x[q.x.length - 1] - 273.15) : range[1];
  for (let i = 0; i <= 60; i++) {
    const T = lo + (hi - lo) * i / 60; let v;
    try { v = hubDefAt(q, T); } catch (e) { return [`at ${+T.toFixed(1)} °C: ${e.message}`]; }
    if (!Number.isFinite(v) || !(v > 0)) return [`at ${+T.toFixed(1)} °C it is ${Number.isFinite(v) ? +v.toPrecision(4) : 'not a number'}: a conductivity or a heat capacity must be positive`];
  }
  return [];
}
/** Set (q) or clear (null) a card value's definition in temperature; its value follows it at 20 °C. Throws when q cannot hold. */
function hubSetDef(p, q) {
  if (p.b.inst) return hubInInst(p.b.inst, () => hubSetDef({ ...p, b: hubPlainB(p.b) }, q), true);
  const b = p.b, e = MAT[b.card][b.k], n = { ...e };
  if (q) {
    const bad = hubDefCheck(q, hubTdep(p)[1]);
    if (bad.length) throw new Error(bad[0]);
    n.def = q; n.v = +hubDefAt(q, 20).toPrecision(12);
  } else delete n.def;
  MAT[b.card] = { ...MAT[b.card], [b.k]: n };
}

// ---- checks: a record's problems (blocking errors, warnings) ----
function hubChecks(r) {
  if (r.inst) return hubInInst(r.inst, () => hubChecks(hubBaseRec(r.base)));
  const out = [], c = MAT.slurry, add = (level, msg, prop) => out.push({ level, msg, prop });
  if (r.id === 'slurry') {
    const re = rheoError(); if (re) add('error', re, 'model');
    if (c.phiDry.v * 100 < c.phi.v) add('error', `The dry film's packing (${c.phiDry.v}) is below the slurry's solids fraction (${matPhiTxt()} vol%): the film would not shrink as it dries.`, 'phi');
    if (MAT.dry.mul.v > 1e5) add('warn', 'A collective diffusion over 10⁵ × the hard-sphere law is near what the drying solver resolves in double precision (10⁶ at most).', 'mul');
    const o = MAT.orient;
    if (o.on && o.model === 'dh' && o.U.v > 4.4 && o.U.v < 5.1) add('warn', `U = ${o.U.v} is at the edge of the liquid crystal (4.5 to 5): its order settles slowly and the result depends on it strongly.`, 'U');
    if (o.on && o.model === 'dh' && !(o.Dr.v > 0)) add('error', 'D_r = 0: the liquid crystal needs its rotary diffusion (its ordering acts through it); nothing would relax.', 'Dr');
    if (o.on && o.model === 'ft' && !(o.Ci.v > 0)) add('error', 'C_i = 0: no diffusion, the flakes only turn with the flow (Jeffery): they never settle to a steady state at the inlet.', 'Ci');
  }
  if (r.id === 'flakes' && !(c.dMin.v <= c.dMean.v && c.dMean.v <= c.dMax.v)) add('error', 'The flake sizes are out of order: smallest ≤ mean ≤ largest.', 'dMean');
  if (r.id === 'gofilm') {
    const z = OVEN.zones[OVEN.zones.length - 1], X = drGAB(z.rh / 100, matGab(), z.airT), em = (1 - c.phiDry.v) / c.phiDry.v;
    if (X * c.rhoS.v * 1000 / c.rhoL.v > 0.9 * em) add('warn', `At the last zone's ${z.rh} % humidity and ${z.airT} °C, GO holds more water than the dry film's pores: the drying keeps its film at the pores' water, so the water it leaves is at least what is shown (off the web the film takes GO's own).`, 'gabXm');
    for (const m of mlT2Check(hubT2(hubProps(r).find(p => p.id === 'k')), 'its thermal conductivity')) add(m.level, m.msg, 'k');
    for (const m of mlCCheck(hubStiff('go'), 'its stiffness')) add(m.level, m.msg, 'C');
    if (hubChem().short) add('warn', 'Its hydrogen runs short of the water set for the labile oxygen: the rest leaves as CO.', 'c1CO2');
  }
  if (r.id === 'web') {
    const st = fibreStructure();
    if (!st.ok) add('error', `Porosity ${hubFmt(st.eps, 3)}: not a porosity (the basis weight is too high for the thickness and the fibre density).`, 'eps');
    for (const m of mlCCheck(hubStiff('web'), 'its stiffness')) add(m.level, m.msg, 'C');
  }
  if (r.id === 'paper') for (const m of mlT2Check(hubT2(hubProps(r).find(p => p.id === 'k')), 'its thermal conductivity')) add(m.level, m.msg, 'k');
  return out;
}
/** A tensor property as Voigt 6 in the material frame (3: the normal). */
const hubT2 = p => { const t = hubTensorOf(p); return mlT2Eval({ form: 'ti', axial: t.axial, trans: t.trans, axis: [0, 0, 1] }); };

// ---- provenance counts and readiness ----
const HUB_PROV_ORDER = ['measured', 'fitted', 'user', 'supplier', 'report', 'published', 'assumed', 'builtin', 'calc'];
/** A record's typed values by provenance (the values a person can set or a solver fixes; not the calculated). */
/** The slurry's solids on the project's own record while they follow the Mixing recipe (MIX-1c): shown, not typed. */
const hubPhiMix = p => !!(p && p.b && p.b.t === 'card' && p.b.card === 'slurry' && p.b.k === 'phi' && !p.b.inst && MAT.mixLink);
/** A property's definition method, as the material card names it (the spec's: constant, equation, table, tensor ...). */
function hubMethod(p, v = hubVal(p)) {
  const b = p.b;
  if (hubPhiMix(p)) return 'From the Mixing recipe';
  if (['card', 'inp', 'cfdg', 'peel'].includes(b.t)) return v.def ? (v.def.kind === 'table' ? 'Table in T' : 'Equation in T') : 'Constant';
  return { calc: 'Calculated', law: 'Equation in T', const: 'Constant', tensor: 'Tensor', stiff: 'Tensor (6 × 6)', stiffWeb: 'Tensor (6 × 6)', model: 'Model',
    orModel: 'Model', switch: 'On / off', fibreSel: 'Test report', measured: 'Measured point' }[b.t] || 'Constant';
}
/** A property's validity range, as written on the card: an input's allowed range, a law's temperatures, a table's span. */
function hubValid(p, v = hubVal(p)) {
  const b = p.b, f = x => String(+(+x).toPrecision(6));
  if (['card', 'inp', 'cfdg', 'peel'].includes(b.t)) {
    if (v.def && v.def.kind === 'table') return `${f(v.def.x[0] - 273.15)} to ${f(v.def.x[v.def.x.length - 1] - 273.15)} °C`;
    if (v.def) { const t = hubTdep(p); return t ? `${t[1][0]} to ${t[1][1]} °C` : ''; }
    return Number.isFinite(v.lo) && Number.isFinite(v.hi) ? `${f(v.lo)} to ${f(v.hi)}` : '';
  }
  if (b.t === 'law') { const L = HUB_LAW[b.id]; return `${L.T[0]} to ${L.T[1]} °C${L.p ? ', 1 atm' : ''}`; }
  return '';
}
/** What happens outside a property's range: an input refuses a value out of it; a table by its policy; a law refuses. */
function hubOutside(p, v = hubVal(p)) {
  const b = p.b;
  if (['card', 'inp', 'cfdg', 'peel'].includes(b.t)) {
    if (v.def && v.def.kind === 'table') return { clamp: 'Held at end values', extrapolate: 'Linear extension', error: 'Refused (solve stops)' }[v.def.extrap || 'error'];
    return v.def ? 'Checked positive' : 'Refused';
  }
  if (b.t === 'law') return 'Not evaluated';
  return '';
}
/** A material's identity and metadata (the Overview tab): its own, as edited, over the record's built-in ones. */
const HUB_META_FIELDS = [['name', 'Material name'], ['desc', 'Description'], ['grade', 'Grade or formulation'], ['supplier', 'Material source'], ['dataSrc', 'Data source'], ['version', 'Version'], ['notes', 'Notes']];
function hubMeta(r) {
  const m = (MAT.meta || {})[r.id] || {};
  return { name: m.name || r.name, desc: m.desc ?? (r.desc || ''), grade: m.grade || '', supplier: m.supplier || '', dataSrc: m.dataSrc || '', version: m.version || '1', notes: m.notes || '' };
}
const hubName = r => hubMeta(r).name;
/** Set a material's metadata field (an empty name falls back to the record's own). */
function hubSetMeta(r, k, val) {
  const cur = { ...((MAT.meta || {})[r.id] || {}) };
  if (val === '' || val == null) delete cur[k]; else cur[k] = String(val);
  MAT.meta = { ...(MAT.meta || {}), [r.id]: cur };
}
/**
 * Per solver, the material properties it reads (spec 14), each: complete (a value it takes), missing (required, no value),
 * optional (not used as things are set: another law's parameter, a model switched off) or unsupported (defined in
 * temperature, but this solver takes its value at 20 °C); the checks that block it.
 */
function hubReadiness() {
  return HUB_PHYS.map(ph => {
    const rows = [], probs = [];
    // (each material as this solver takes it: the copy assigned to its domain, else the record's own, MC-2)
    for (const r0 of hubBaseAll()) {
      const a = hubAssignedFor(r0.id, ph.k), r = a ? hubInstRec(a) : r0;
      const ps = hubProps(r).filter(p => p.phys.includes(ph.k));
      if (!ps.length) continue;
      for (const p of ps) {
        if (['model', 'orModel', 'switch', 'fibreSel'].includes(p.b.t)) continue;
        const v = hubVal(p), off = hubOff(p), t = hubTdep(p);
        const missing = v.v == null || (typeof v.v === 'number' && !Number.isFinite(v.v));
        const st = off ? 'optional' : missing ? 'missing' : v.def && !(t && t[0].includes(ph.k)) ? 'unsupported' : 'complete';
        rows.push({ r, p, v, st, off });
      }
      // (the spec's not applicable: the material's other properties, which this solver does not read)
      for (const p of hubProps(r)) if (!p.phys.includes(ph.k) && !['model', 'orModel', 'switch', 'fibreSel'].includes(p.b.t)) rows.push({ r, p, v: hubVal(p), st: 'na', off: false });
      for (const c of hubChecks(r)) if (!c.prop || ps.some(p => p.id === c.prop && !hubOff(p))) probs.push({ r, ...c });
    }
    const n = { complete: 0, missing: 0, optional: 0, na: 0, unsupported: 0 };
    for (const q of rows) n[q.st]++;
    const st = probs.some(q => q.level === 'error') ? 'bad' : n.missing ? 'warn' : 'ok';
    return { ph, rows, probs, n, st, missing: rows.filter(q => q.st === 'missing') };
  });
}

// ---- export and import (the records' values: a material file) ----
const HUB_FILE = 'bcdl-materials';
function hubExport(ids = hubAll().map(r => r.id)) {
  const out = { format: HUB_FILE, version: 1, saved: new Date().toISOString(), app: 'Blade Coat Defect Lab', materials: [] };
  for (const id of ids) {
    const r = hubRec(id), props = {};
    for (const p of hubProps(r)) {
      // (a built-in law: its parameters as they are, MC-1b)
      if (p.b.t === 'law') { const L = HUB_LAW[p.b.id]; props[p.id] = { law: L.q.law, parameters: r.inst ? hubInInst(r.inst, () => hubLawParams(p.b.id)) : hubLawParams(p.b.id), unit: L.u, name: p.l }; continue; }
      if (!['card', 'inp', 'cfdg', 'peel'].includes(p.b.t)) continue;
      const v = hubVal(p);
      props[p.id] = { value: v.v, unit: v.u, source: v.src, name: p.l, ...(p.b.t === 'card' && MAT[p.b.card][p.b.k].def ? { definition: MAT[p.b.card][p.b.k].def } : {}) };
    }
    out.materials.push({ id, name: hubName(r), class: r.cls, kind: r.sub, ...(r.inst ? { base: r.base } : {}), meta: { ...((MAT.meta || {})[id] || {}) }, props });
  }
  return out;
}
/**
 * A file's unit to this app's: null when either is not a unit (a name), either is a share, or their dimensions differ; else the value's
 * conversion (affine: a temperature's offset too) and a definition's (a table's values each; an expression scaled, which an
 * offset cannot be). Rounded to 12 significant digits (the conversion's last bits).
 */
function hubUnitConv(from, to) {
  const tidy = u => String(u).replace('m³/m²·s', 'm³/(m²·s)');
  let a, b;
  try { a = mlParseUnit(tidy(from)); b = mlParseUnit(tidy(to)); } catch (e) { return null; }
  // (a share -- %, vol%, kg/kg, a fraction -- has no dimension to check it by: a volume share is not a mass share; never converted)
  if (!mlDimEq(a.dim, b.dim) || a.dim.every(d => !d)) return null;
  const v = x => +mlConvert(x, a, b).toPrecision(12), k = a.f / b.f;
  return {
    v, factor: k,
    def: q => (q.kind === 'table' ? { ...q, y: q.y.map(v) } : q.kind === 'expr' && !a.off && !b.off ? { ...q, src: k === 1 ? q.src : `(${q.src}) * ${+k.toPrecision(15)}` } : null),
  };
}
/**
 * A table in T from a CSV (MH-4b): two columns, temperature then value; separated by commas, semicolons, tabs or spaces; a
 * header line may name their units -- "T (K)" or "T [°C]", "k (mW/(m·K))" -- the temperature in °C unless its header says K,
 * the value in this app's unit unless its header names another of the same dimension (converted). Returns { x (kelvin), y }
 * or throws why it cannot be read.
 */
function hubParseTCsv(text, unit) {
  const rows = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const cellsOf = l => (/[,;\t]/.test(l) ? l.split(/[,;\t]/) : l.split(/\s+/)).map(c => c.trim());
  const unitIn = c => { const m = /[([]\s*(.+?)\s*[)\]]\s*$/.exec(c); return m ? m[1] : null; };
  let tK = false, conv = null; const pts = [];
  rows.forEach((l, i) => {
    const c = cellsOf(l), a = Number(c[0]), b = Number(c[1]);
    if (c.length >= 2 && c[0] !== '' && c[1] !== '' && Number.isFinite(a) && Number.isFinite(b)) { pts.push([a, b]); return; }
    if (pts.length || i > 0) throw new Error(`line ${i + 1} is not two numbers: "${l.slice(0, 40)}"`);
    const tu = unitIn(c[0] || ''), vu = unitIn(c[1] || '');
    if (tu && !['K', '°C', 'C', 'degC'].includes(tu)) throw new Error(`its temperature's unit ${tu}: K or °C only`);
    tK = tu === 'K';
    if (vu && vu !== unit) { conv = hubUnitConv(vu, unit); if (!conv) throw new Error(`its values' unit ${vu} is not ${unit} and does not convert to it`); }
  });
  if (pts.length < 2) throw new Error('two points at least');
  pts.sort((p, q) => p[0] - q[0]);
  return { x: pts.map(p => +(tK ? p[0] : p[0] + 273.15).toPrecision(12)), y: pts.map(p => (conv ? conv.v(p[1]) : p[1])) };
}
/** Read a material file: what it would change (and what it cannot), applied when apply is true. */
function hubImport(data, apply = false, { keepDefs = false } = {}) {
  const changes = [], skipped = [], metas = [], laws = [], copies = [];
  if (!data || data.format !== HUB_FILE || !Array.isArray(data.materials)) throw new Error('not a material file of this app (its format is not bcdl-materials)');
  for (const m of data.materials) {
    let r = hubRec(m && m.id);
    // (a copy in the file this project does not have, MC-2: made from its record -- its values then the file's)
    if (!r && m && m.base && hubBaseRec(m.base) && /^[\w-]+~\d+$/.test(m.id)) {
      copies.push(m.id);
      if (apply) {
        const B = hubBaseRec(m.base), vals = {};
        for (const p of hubProps(B)) if (p.b.t === 'card') vals[p.id] = JSON.parse(JSON.stringify(MAT[p.b.card][p.b.k]));
        MAT.inst = { ...(MAT.inst || {}), [m.id]: { base: B.id, name: typeof m.name === 'string' && m.name ? m.name : `${B.name} (copy)`, vals, law: {} } };
        r = hubRec(m.id);
      } else r = hubBaseRec(m.base);
    }
    if (!r) { skipped.push(`${m && m.name || m && m.id}: no such material here`); continue; }
    // (its identity and metadata, as written in the file: the fields this app keeps, as text)
    if (m.meta && typeof m.meta === 'object') for (const [k] of HUB_META_FIELDS) if (typeof m.meta[k] === 'string' && m.meta[k] !== hubMeta(r)[k]) metas.push({ r, k, val: m.meta[k] });
    for (const [pid, q] of Object.entries(m.props || {})) {
      const p = hubProps(r).find(x => x.id === pid);
      // (a built-in law's parameters, MC-1b: each one the law has, a number (a list as long as its own); the law then
      //  finite and positive over its range -- else none of them taken, said why)
      if (p && p.b.t === 'law' && q && q.parameters && typeof q.parameters === 'object') {
        const id = p.b.id, own = HUB_LAW[id].q.params, now = r.inst ? hubInInst(r.inst, () => hubLawParams(id)) : hubLawParams(id), next = { ...now };
        const bad = Object.entries(q.parameters).find(([k, x]) => !(k in own) || (Array.isArray(own[k]) ? !(Array.isArray(x) && x.length === own[k].length && x.every(Number.isFinite)) : !Number.isFinite(x)));
        if (bad) { skipped.push(`${r.name} · ${p.l}: its parameter ${bad[0]} is not one this law has, or not a number`); continue; }
        Object.assign(next, q.parameters);
        const why = hubLawProblem(id, next);
        if (why) { skipped.push(`${r.name} · ${p.l}: ${why}`); continue; }
        if (JSON.stringify(next) !== JSON.stringify(now)) laws.push({ r, p, id, params: next });
        continue;
      }
      if (!p || !['card', 'inp', 'cfdg', 'peel'].includes(p.b.t)) { skipped.push(`${r.name} · ${pid}: not an editable property here`); continue; }
      const cur = hubVal(p);
      // (a sheet's single number does not replace a definition in temperature: that is changed in its row)
      if (keepDefs && !q.definition && p.b.t === 'card' && MAT[p.b.card][p.b.k].def) { skipped.push(`${r.name} · ${p.l}: defined in temperature; change its table or expression in its row`); continue; }
      // (its unit: this app's, or another of the same dimension converted to it -- kPa to MPa, W/(m·K) to mW/(m·K)...; a
      // name or a share (no unit to parse) must be this app's)
      let value = q.value, unitConv = null;
      if (q.unit !== cur.u && !(p.b.k === 'K')) {
        unitConv = hubUnitConv(q.unit, cur.u);
        if (!unitConv) { skipped.push(`${r.name} · ${p.l}: its unit ${q.unit} is not this app's (${cur.u}) and does not convert to it`); continue; }
        value = Number.isFinite(q.value) ? unitConv.v(q.value) : q.value;
      }
      if (!Number.isFinite(value) || value < cur.lo || value > cur.hi) { skipped.push(`${r.name} · ${p.l}: ${q.value}${unitConv ? ` ${q.unit} (${hubFmt(value, -6)} ${cur.u})` : ''} is outside ${cur.lo}–${cur.hi} ${cur.u}`); continue; }
      const prov = HUB_PROV[q.provenance] ? q.provenance : null;
      // (a definition in temperature, MH-4b: taken when the property may have one and it holds; its value then follows it)
      let def;
      if (q.definition) {
        if (!hubTdep(p)) { skipped.push(`${r.name} · ${p.l}: a definition in temperature, which this property does not take`); continue; }
        def = unitConv ? unitConv.def(q.definition) : q.definition;
        if (!def) { skipped.push(`${r.name} · ${p.l}: its definition in ${q.unit} does not convert to ${cur.u}`); continue; }
        const bad = hubDefCheck(def, hubTdep(p)[1]); if (bad.length) { skipped.push(`${r.name} · ${p.l}: its definition ${bad[0]}`); continue; }
      }
      const curDef = p.b.t === 'card' ? MAT[p.b.card][p.b.k].def : undefined;
      if (value === cur.v && (!prov || prov === cur.prov) && (q.source == null || q.source === cur.src) && JSON.stringify(def) === JSON.stringify(curDef)) continue;
      changes.push({ r, p, from: cur.v, to: value, prov, src: q.source, def, unit: unitConv ? q.unit : null });
    }
  }
  if (apply) {
    for (const c of changes) { hubSet(c.p, c.to, { prov: c.prov, src: c.src }); if (hubTdep(c.p)) hubSetDef(c.p, c.def || null); }
    for (const q of metas) hubSetMeta(q.r, q.k, q.val);
    for (const q of laws) {
      const own = HUB_LAW[q.id].q.params, ed = Object.fromEntries(Object.entries(q.params).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(own[k])));
      const put = () => { MAT.law = { ...(MAT.law || {}) }; if (Object.keys(ed).length) MAT.law[q.id] = ed; else delete MAT.law[q.id]; };
      if (q.r.inst) hubInInst(q.r.inst, put, true); else put();
    }
  }
  return { changes, skipped, metas, laws, copies };
}
// ---- the material data sheet: every editable value, as a CSV to fill in and read back ----
const HUB_SHEET_COLS = ['Material id', 'Property id', 'Material', 'Property', 'Symbol', 'Value now', 'Unit', 'Allowed from', 'Allowed to', 'Data source',
  'Your value', 'Your unit', 'Your source'];
/** The data sheet's rows: every editable material value, each binding once. */
function hubSheetRows() {
  const out = [], seen = new Set();
  for (const r of hubAll()) for (const p of hubProps(r)) {
    if (!['card', 'inp', 'cfdg', 'peel'].includes(p.b.t)) continue;
    const key = JSON.stringify(p.b), v = hubVal(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([r.id, p.id, hubName(r), hubPropName(r, p), p.sym.replace(/_/g, ''), v.v, v.u, v.lo, v.hi, v.src || '', '', '', '']);
  }
  // (the built-in laws' parameters, MC-1b: one row each -- a list's coefficients each its own, "n.3"; their check is the law's)
  const lawSeen = new Set();
  for (const r of hubAll()) for (const p of hubProps(r)) {
    // (a law shared by several records once; a copy's laws its own rows)
    const lk = `${r.inst || ''}:${p.b.id}`;
    if (p.b.t !== 'law' || lawSeen.has(lk)) continue;
    lawSeen.add(lk);
    const L = HUB_LAW[p.b.id], law = ML_LAWS[L.q.law];
    for (const [k, x] of Object.entries(r.inst ? hubInInst(r.inst, () => hubLawParams(p.b.id)) : hubLawParams(p.b.id))) {
      const row = (key, val, lab) => out.push([r.id, `${p.id}:${key}`, hubName(r), `${hubPropName(r, p)}: ${lab}`, p.sym.replace(/_/g, ''), val, Array.isArray(x) ? '' : law.params[k] || '', '', '', L.src, '', '', '']);
      if (Array.isArray(x)) x.forEach((q, i) => row(`${k}.${i + 1}`, q, `${law.formula}, ${k}${i + 1}`)); else row(k, x, `${law.formula}, ${k}`);
    }
  }
  return out;
}
/** The sheet as CSV text (commas; quoted where needed). */
function hubSheetCSV() {
  const q = x => { const t = String(x ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [HUB_SHEET_COLS, ...hubSheetRows()].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
/** CSV text to rows (RFC 4180 quoting; the separator a comma, or a semicolon as some spreadsheets save it). */
function hubParseCSV(text) {
  const t = String(text).replace(/^\uFEFF/, ''), first = t.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c; continue; }
    if (c === '"') inQ = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows: rows.filter(r => r.some(x => x.trim() !== '')), sep };
}
/**
 * A filled data sheet to a material file (hubImport's): each row with "Your value" -- in "Your unit" (else the row's), with
 * "Your source" when given. Rows left empty are not read.
 */
function hubSheetToFile(text) {
  const { rows, sep } = hubParseCSV(text), head = (rows[0] || []).map(h => h.trim()), col = n => head.indexOf(n), skipped = [];
  for (const n of ['Material id', 'Property id', 'Unit', 'Your value']) if (col(n) < 0) throw new Error(`not this app's material data sheet (no "${n}" column)`);
  const mats = new Map(); let n = 0;
  rows.slice(1).forEach((r, i) => {
    const g = name => (col(name) < 0 ? '' : String(r[col(name)] ?? '').trim()), raw = g('Your value');
    if (raw === '') return;
    const num = Number(sep === ';' ? raw.replace(',', '.') : raw), what = `line ${i + 2} (${g('Material') || g('Material id')} · ${g('Property') || g('Property id')})`;
    if (!Number.isFinite(num)) { skipped.push(`${what}: "${raw}" is not a number`); return; }
    const id = g('Material id');
    if (!mats.has(id)) mats.set(id, { id, props: {} });
    // (a law's parameter, "mu:A" or "psat:n.3": into that law's parameters, its others as they are now)
    const lp = /^(\w+):(\w+)(?:\.(\d+))?$/.exec(g('Property id'));
    if (lp) {
      const r = hubRec(id), p = r && hubProps(r).find(x => x.id === lp[1] && x.b.t === 'law');
      if (!p) { skipped.push(`${what}: not a law of this material`); return; }
      const props = mats.get(id).props, cur = props[lp[1]] || (props[lp[1]] = { parameters: JSON.parse(JSON.stringify(r.inst ? hubInInst(r.inst, () => hubLawParams(p.b.id)) : hubLawParams(p.b.id))) });
      if (lp[3] != null && Array.isArray(cur.parameters[lp[2]]) && +lp[3] >= 1 && +lp[3] <= cur.parameters[lp[2]].length) cur.parameters[lp[2]][+lp[3] - 1] = num;
      else if (lp[3] == null && lp[2] in cur.parameters && !Array.isArray(cur.parameters[lp[2]])) cur.parameters[lp[2]] = num;
      else { skipped.push(`${what}: no parameter ${lp[2]}${lp[3] ? ' ' + lp[3] : ''}`); return; }
      n++; return;
    }
    mats.get(id).props[g('Property id')] = { value: num, unit: g('Your unit') || g('Unit'), ...(g('Your source') ? { source: g('Your source') } : {}) };
    n++;
  });
  return { file: { format: HUB_FILE, version: 1, materials: [...mats.values()] }, skipped, n };
}

/** Set a property (its value, and optionally its provenance and source), the way its own input would. */
function hubSet(p, v, { prov = null, src = null } = {}) {
  // (a copy: its own card values only; the rest is the project's, edited on its own record)
  if (p.b.inst) { if (p.b.t === 'card') hubInInst(p.b.inst, () => hubSet({ ...p, b: hubPlainB(p.b) }, v, { prov, src }), true); return; }
  const b = p.b;
  if (b.t === 'card') {
    const e = MAT[b.card][b.k], n = { ...e };
    if (v != null) n.v = v;
    if (prov) { n.prov = prov; n.flag = HUB_PROV[prov].flag; }
    if (src != null) n.src = String(src);
    MAT[b.card] = { ...MAT[b.card], [b.k]: n };
    if (b.card === 'rheo' && v != null) rheoSync('extras');
  } else if (b.t === 'inp') {
    if (v != null && v !== P[b.k]) setInput(b.k, v);
    if (prov || src != null) MAT.prov = { ...(MAT.prov || {}), ['in.' + b.k]: { kind: prov || hubVal(p).prov, src: src != null ? String(src) : hubVal(p).src } };
  } else if (b.t === 'cfdg') { if (v != null) CFDG[b.k] = v; }
  else if (b.t === 'peel') {
    const q = OVEN_PEEL_FIELDS.find(f => f[0] === b.k);
    if (v != null) OVEN.peel = { ...OVEN.peel, [b.k]: v, [q[7]]: true };
  }
}

/** A property's full name: a row under another (a tensor's component) with its parent's ("Thermal conductivity, in the plane"). */
function hubPropName(r, p) {
  if (!p.sub) return p.l;
  const ps = hubProps(r), i = ps.indexOf(p);
  for (let j = i - 1; j >= 0; j--) if (!ps[j].sub) return `${ps[j].l}, ${p.l}`;
  return p.l;
}
/** The card values defined in temperature (MH-4b), as rows: its name, its definition in words, the solvers that take it in T. */
function hubDefRows() {
  const out = [], seen = new Set();
  for (const r of HUB_RECORDS) for (const p of hubProps(r)) {
    const t = hubTdep(p), key = t && `${p.b.card}.${p.b.k}`, q = t && MAT[p.b.card][p.b.k].def;
    if (!q || seen.has(key)) continue;
    seen.add(key);
    const u = hubVal(p).u, f = x => String(+(+x).toPrecision(6));
    const how = q.kind === 'table'
      ? `table: ${q.x.map((x, i) => `${f(x - 273.15)} °C → ${f(q.y[i])}`).join('; ')} ${u}; ${q.interp === 'pchip' ? 'monotone cubic' : 'linear'} between, ${{ clamp: 'held at the ends', extrapolate: 'carried on', error: 'refused' }[q.extrap || 'error']} outside`
      : `${p.sym.replace(/_/g, '')}(T) = ${q.src} ${u}, T in kelvin`;
    out.push([`${r.name}: ${hubPropName(r, p).toLowerCase()}`, how, t[0].map(k => hubPhys(k).l).join(', ')]);
  }
  return out;
}
/** A built-in law's or constant's name: its material's and its property's. */
function hubLawName(id) {
  for (const r of HUB_RECORDS) for (const p of hubProps(r)) if ((p.b.t === 'law' || p.b.t === 'const') && p.b.id === id) return `${r.name}: ${p.l.toLowerCase()}`;
  return id;
}
/** The material constants card read-only (the report, MH-2). */
const libCardRows = () => MAT_LIB.map(([k, l, u, , , , dd]) => [l, (+MAT.lib[k].v).toFixed(dd), u, MAT.lib[k].flag, MAT.lib[k].src]);
/** A record's calculated values as rows (label, value, unit, how): the report's. */
const hubCalcRows = (id, only) => hubProps(hubRec(id)).filter(p => p.b.t === 'calc' && (!only || only.includes(p.id))).map(p => { const v = hubVal(p); return [p.l, typeof v.v === 'number' ? hubFmt(v.v, v.d) : String(v.v), v.u, v.src]; });

// (the solvers' input builders run with the materials assigned to their domains, MC-2: the page's, not Node's)
if (typeof window !== 'undefined') for (const [ph, names] of Object.entries(HUB_SWAP)) for (const n of names) {
  const f = window[n];
  if (typeof f === 'function' && !f.hubWrapped) { const g = function (...a) { return matRun(ph, () => f.apply(this, a)); }; g.hubWrapped = true; window[n] = g; }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { HUB_PROV, HUB_LAW, HUB_CONST, HUB_RECORDS, HUB_IFACES, HUB_PHYS, HUB_CARDS, hubProvOf, hubFmt };
