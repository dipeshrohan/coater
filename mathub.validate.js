/*
 * mathub.validate.js — checks of the material hub's records (mathub.js) against the solvers they describe.
 * Run: node mathub.validate.js
 *  1. Bindings: every value on the six stage cards (106) is a property of exactly one record, with no other binding
 *     to a card value; every record's property ids are unique; each solver key a property names is a solver.
 *  2. Built-in laws: each equals the solver's own function, at temperatures across its range (water: drying.js
 *     drMuWater, drPsat, drLatent; air: drying.js drAir; argon: furnace-mp.js fmpArgon; graphite: fmpCg).
 *  3. Constants: the built-in ones equal to the solvers' (water's c_p in drying.js, stack-mp.js and furnace-mp.js, air's,
 *     argon's c_p and Pr); the material constants card's first values the solvers' fallbacks (aluminium's in stack-mp.js,
 *     the plates' E in furnace.js, the web's ν₁₃ and the gel's ν in film.js), and the solvers given the card's.
 *  4. Stiffness: the hub's transversely isotropic C (matlib) gives Peel and wind's plane-strain block (film.js
 *     fmTransIso: C11, C13, C33, C55) for the film card's values and for the web's; positive definite.
 *  5. Tensors: the conduction and vapour-permeability tensors in the material frame are the cards' two values on the
 *     diagonal, as the solvers take them (k_zz = kS through the film; kIn along it).
 *  6. Provenance: each kind maps to its flag; a kind is kept only while it matches its flag.
 */
const vm = require('vm'), fs = require('fs');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const fmt = x => (typeof x === 'number' ? x.toExponential(2) : String(x));

// the page's scripts the records need, in one context (as the page loads them), with the solvers' own constants out
const ctx = vm.createContext({ console, Math, JSON, Object, Array, Number, String, Set, Map, Float64Array, Infinity, NaN, isFinite, parseFloat });
const load = (f, extra = '') => vm.runInContext(fs.readFileSync(f, 'utf8') + '\n' + extra, ctx, { filename: f });
load('materials.js'); load('matlib.js');
load('drying.js', ';this.__dr = { DR_CL, DR_IF97, DR_MA, DR_R, drAir, drMuWater, drPsat, drLatent };');
load('furnace.js', ';this.__fu = { FU_EPL };');
load('mathub.js', ';this.__hub = { HUB_RECORDS, HUB_IFACES, HUB_PHYS, HUB_CARDS, HUB_LAW, HUB_CONST, HUB_PROV, hubProvOf, hubLawAt, hubStiff, hubT2: typeof hubT2 === "function" ? hubT2 : null, hubLawParams, hubSetLawParam, hubLawProblem, matSolverProps };');
const H = ctx.__hub, DRc = ctx.__dr, FUc = ctx.__fu, L = require('./matlib.js');
const SM = require('./stack-mp.js'), FM = require('./furnace-mp.js'), FL = require('./film.js');
const smpSrc = fs.readFileSync('stack-mp.js', 'utf8'), fmpSrc = fs.readFileSync('furnace-mp.js', 'utf8'), filmSrc = fs.readFileSync('film.js', 'utf8');
const all = [...H.HUB_RECORDS, ...H.HUB_IFACES], props = r => r.groups.flatMap(g => g.props);

// 1. bindings
{
  const seen = new Map();
  for (const r of all) for (const p of props(r)) if (p.b.t === 'card') { const k = `${p.b.card}.${p.b.k}`; seen.set(k, [...(seen.get(k) || []), `${r.id}.${p.id}`]); }
  const cards = Object.entries(H.HUB_CARDS).flatMap(([c, rows]) => rows.map(q => `${c}.${q[0]}`));
  const missing = cards.filter(k => !seen.has(k)), twice = [...seen].filter(([, v]) => v.length > 1), extra = [...seen.keys()].filter(k => !cards.includes(k));
  check(`bindings: the ${cards.length} card values (the six stage cards' 114, the material constants' 10, the spec's three materials' 18) each a property of exactly one record`, cards.length === 142 && !missing.length && !twice.length && !extra.length,
    `missing ${missing.join(', ') || 'none'}; twice ${twice.map(([k, v]) => `${k} (${v.join(', ')})`).join('; ') || 'none'}; unknown ${extra.join(', ') || 'none'}`);
  const dup = all.filter(r => new Set(props(r).map(p => p.id)).size !== props(r).length).map(r => r.id);
  check('  property ids unique within each record; record ids unique', !dup.length && new Set(all.map(r => r.id)).size === all.length, dup.join(', '));
  const phys = new Set(H.HUB_PHYS.map(p => p.k)), badPh = all.flatMap(r => props(r).flatMap(p => p.phys.filter(k => !phys.has(k)).map(k => `${r.id}.${p.id}: ${k}`)));
  check('  every solver a property names is one of the solvers', !badPh.length, badPh.join(', '));
  const inp = new Set(all.flatMap(r => props(r).filter(p => p.b.t === 'inp').map(p => p.b.k)));
  check('  the inputs bar\'s material values are all in a record: μ, K, η0, n, τy, γ, θ, θw, Δθ, the fibre\'s thickness', ['mu', 'K', 'eta0', 'n', 'ty', 'g', 'th', 'thw', 'dth', 'tf'].every(k => inp.has(k)), [...inp].join(' '));
  const tens = all.flatMap(r => props(r).filter(p => p.b.t === 'tensor').map(p => [r, p])), okT = tens.every(([r, p]) => [p.b.axial, p.b.trans].every(k => props(r).some(q => q.b.t === 'card' && q.b.k === k)));
  check(`  each tensor's two components are properties of its own record (${tens.length} tensors)`, tens.length === 3 && okT);
}

// 2. built-in laws = the solvers' functions
{
  const cases = [
    ['waterMu', T => DRc.drMuWater(T)], ['waterPsat', T => DRc.drPsat(T)], ['waterL', T => DRc.drLatent(T)],
    ['airMu', T => DRc.drAir(T, 101325).mu], ['airK', T => DRc.drAir(T, 101325).k], ['airRho', T => DRc.drAir(T, 101325).rho], ['airDv', T => DRc.drAir(T, 101325).Dv],
    ['arMu', T => FM.fmpArgon(T).mu], ['arRho', T => FM.fmpArgon(T).rho], ['gCp', T => FM.fmpCg(T)],
  ];
  for (const [id, f] of cases) {
    const Lw = H.HUB_LAW[id], n = 25; let e = 0;
    for (let i = 0; i <= n; i++) { const T = Lw.T[0] + (Lw.T[1] - Lw.T[0]) * i / n; e = Math.max(e, rel(H.hubLawAt(id, T), f(T))); }
    check(`built-in law ${id} = ${Lw.solver} over ${Lw.T[0]}–${Lw.T[1]} °C`, e < 1e-14, `max rel ${fmt(e)}`);
  }
  let e = 0;
  for (const T of [20, 500, 1500, 2800]) e = Math.max(e, rel(H.hubLawAt('arMu', T) * H.HUB_CONST.arCp.v / H.HUB_CONST.arPr.v, FM.fmpArgon(T).k));
  check('  argon\'s k = μ(T) c_p / Pr = fmpArgon\'s k', e < 1e-14, fmt(e));
  check('  the gas constant and air\'s molar mass the drying\'s (ideal gas)', L.ML_CONST.R === DRc.DR_R && H.HUB_LAW.airRho.q.params.M === DRc.DR_MA);
  check('  water\'s saturation line: IAPWS-IF97 coefficients the drying\'s own array', H.HUB_LAW.waterPsat.q.params.n === DRc.DR_IF97 || JSON.stringify(H.HUB_LAW.waterPsat.q.params.n) === JSON.stringify(DRc.DR_IF97));
}

// 3. built-in constants = the solvers'
{
  const C = H.HUB_CONST;
  const lib = vm.runInContext('matDefaults().lib', ctx), lv = k => lib[k].v;
  check('constants (MH-2): the material constants card\'s first values the solvers\' own -- aluminium k, ρ, c = stack-mp.js SMP_AL', lv('alK') === SM.SMP_AL.k && lv('alRho') === SM.SMP_AL.rho && lv('alC') === SM.SMP_AL.c, JSON.stringify(SM.SMP_AL));
  const cw = [DRc.DR_CL, +/const SMP_CW = ([\d.]+)/.exec(smpSrc)[1], +/FMP_CW = ([\d.]+)/.exec(fmpSrc)[1]];
  check('  water\'s c_p = drying.js DR_CL = stack-mp.js SMP_CW = furnace-mp.js FMP_CW', cw.every(v => v === C.waterCp.v), cw.join(', '));
  check('  the holder plates\' E = furnace.js FU_EPL (its fallback)', lv('plE') * 1e9 === FUc.FU_EPL && /PL\.E \|\| FU_EPL/.test(fs.readFileSync('furnace.js', 'utf8')), `${FUc.FU_EPL}`);
  const ar = FM.fmpArgon(300);
  check('  argon c_p and Pr = fmpArgon\'s', C.arCp.v === ar.cp && C.arPr.v === ar.Pr);
  check('  air c_p = drAir\'s', C.airCp.v === DRc.drAir(20, 101325).cp);
  const web = /fmTransIso\(W\.Ew, W\.Ew \* W\.soft, W\.nuw, W\.nupt \?\? ([\d.]+), W\.Ew \* W\.soft \/ 2\)/.exec(filmSrc), gel = /fmIso\(o\.gel\.Eg, o\.gel\.nu \?\? ([\d.]+)\)/.exec(filmSrc);
  check('  the web\'s ν₁₃ (G₁₃ = E₁ soft / 2) and the gel\'s ν: film.js\'s fallbacks', web && +web[1] === lv('webNupt') && gel && +gel[1] === lv('gelNu'), `${web && web[1]}, ${gel && gel[1]}`);
  const ui = ['stack-mp-ui.js', 'furnace-ui.js', 'film-ui.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  check('  and the solvers given the card\'s: the plate\'s aluminium (MP-1), the holder plates\' E (the furnace), the web\'s ν₁₃ and the gel\'s ν (Peel and wind)', /al: \{ k: MAT\.lib\.alK\.v, rho: MAT\.lib\.alRho\.v, c: MAT\.lib\.alC\.v, \.\.\.hubDefsOf\(\{ kT: MAT\.lib\.alK, cT: MAT\.lib\.alC \}\) \}/.test(ui) && /E: MAT\.lib\.plE\.v \* 1e9/.test(ui) && /nupt: MAT\.lib\.webNupt\.v/.test(ui) && /nu: MAT\.lib\.gelNu\.v/.test(ui));
}

// 4. stiffness = Peel and wind's plane-strain block
{
  ctx.MAT = ctx.matDefaults ? vm.runInContext('matDefaults()', ctx) : null;
  vm.runInContext('MAT = matDefaults()', ctx);
  const f = vm.runInContext('MAT.film', ctx), v = k => f[k].v;
  const C = H.hubStiff('go'), ref = FL.fmTransIso(v('Ep') * 1e9, v('Et') * 1e9, v('nup'), v('nupt'), v('Gpt') * 1e9);
  const e = Math.max(rel(C[0][0], ref.C11), rel(C[0][2], ref.C13), rel(C[2][2], ref.C33), rel(C[4][4], ref.C55));
  check('stiffness: the dried film\'s C (matlib, transversely isotropic about its normal) gives film.js\'s C11, C13, C33, C55', e < 1e-12, `max rel ${fmt(e)}; C11 ${fmt(C[0][0])} Pa`);
  const W = H.hubStiff('web'), rw = FL.fmTransIso(v('Ew') * 1e9, v('Ew') * v('soft') * 1e9, v('nuw'), vm.runInContext('MAT.lib.webNupt.v', ctx), v('Ew') * v('soft') * 1e9 / 2);
  const ew = Math.max(rel(W[0][0], rw.C11), rel(W[0][2], rw.C13), rel(W[2][2], rw.C33), rel(W[4][4], rw.C55));
  check('  the web\'s the same (its ν₁₃ and G₁₃ the solver\'s)', ew < 1e-12, fmt(ew));
  check('  both positive definite (Cholesky)', !L.mlCCheck(C).length && !L.mlCCheck(W).length);
  const S = L.mlInv6(C), Ep = 1 / S[0][0], Et = 1 / S[2][2], nup = -S[0][1] * Ep, nupt = -S[0][2] * Ep, Gpt = 1 / S[4][4];
  const eb = Math.max(rel(Ep, v('Ep') * 1e9), rel(Et, v('Et') * 1e9), rel(nup, v('nup')), rel(nupt, v('nupt')), rel(Gpt, v('Gpt') * 1e9));
  check('  its compliance gives back the card\'s moduli (E₁, E₃, ν₁₂, ν₁₃ with ε₃ = −ν₁₃ σ₁/E₁, G₁₃)', eb < 1e-12, fmt(eb));
}

// 5. tensors
{
  const rec = H.HUB_RECORDS.find(r => r.id === 'gofilm'), k = props(rec).find(p => p.id === 'k'), Kv = props(rec).find(p => p.id === 'Kv');
  const d = vm.runInContext('MAT.dry', ctx), fl = vm.runInContext('MAT.film', ctx);
  const V = vm.runInContext('hubT2', ctx)(k), W = vm.runInContext('hubT2', ctx)(Kv);
  check('tensors: the film\'s conduction in its frame diag(kIn, kIn, kS), no off-diagonal (what the drying, MP-1 and MP-2 take)', V[0] === d.kIn.v && V[1] === d.kIn.v && V[2] === d.kS.v && V.slice(3).every(x => x === 0), JSON.stringify(V));
  check('  its vapour permeability diag(stackK × 10⁻⁷, …, skinK × 10⁻¹²) kg/(m·s·Pa) (MP-1\'s K along, Kthr through)', W[0] === fl.stackK.v * 1e-7 && W[2] === d.skinK.v * 1e-12, JSON.stringify(W));
  const P = L.mlT2Proj(V, [0, 2]);
  check('  projected to a 2D section (x and the thickness): diag(kIn, kS), the solvers\' fast path', Array.isArray(P) && P[0] === d.kIn.v && P[1] === d.kS.v, JSON.stringify(P));
}

// 6. provenance
{
  const P = H.HUB_PROV, ok = Object.entries(P).every(([, q]) => ['given', 'assumed', 'measured'].includes(q.flag));
  check('provenance: each kind maps to a card flag (measured, fitted → measured; from you, datasheet → given; published, assumed → assumed)', ok && P.fitted.flag === 'measured' && P.supplier.flag === 'given' && P.published.flag === 'assumed');
  check('  a kind kept only while it matches its flag; else the flag\'s own', H.hubProvOf({ flag: 'assumed', prov: 'published' }) === 'published' && H.hubProvOf({ flag: 'measured', prov: 'published' }) === 'measured'
    && H.hubProvOf({ flag: 'given' }) === 'user' && H.hubProvOf({ flag: 'measured', prov: 'fitted' }) === 'fitted' && H.hubProvOf({ flag: 'assumed', prov: 'bogus' }) === 'assumed');
}
// 7. a property in temperature (MH-4b): mp-core with a matlib expression k(T) solves steady conduction exactly at its nodes
//    (Kirchhoff: θ = T + b T²/2 is linear in x for k = k0 (1 + b T)), on any mesh
{
  const C = require('./mp-core.js'), k0 = 1, b = 2e-3, T0 = 20, T1 = 600, Lx = 0.01;
  const q = { kind: 'expr', src: 'k0*(1 + b*(T - 273.15))', params: { k0, b } }, th = T => T + b * T * T / 2, inv = t => (-1 + Math.sqrt(1 + 2 * b * t)) / b;
  let e = 0;
  for (const n of [10, 40]) {
    const M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L: Lx, n }]] });
    const r = C.mpScalar(M, { K: (m, u) => L.mlQEval(q, { T: u + 273.15 }), steady: true, picard: 60, tol: 1e-13, bc: [{ face: 'x0', type: 'value', u: T0 }, { face: 'x1', type: 'value', u: T1 }] });
    for (let i = 0; i < M.N; i++) e = Math.max(e, Math.abs(r.u[i] - inv(th(T0) + (th(T1) - th(T0)) * M.X[i] / Lx)));
  }
  check('a conductivity in temperature (MH-4b): k = k0 (1 + b T) from 20 to 600 °C, mp-core\'s steady conduction = Kirchhoff\'s exact profile at the nodes', e < 1e-9, `max ${fmt(e)} K`);
}
// 7. the built-in laws and the fluids' constants as inputs (MC-1b): their first values the solvers' own (drying.js DR_PROPS,
//    furnace-mp.js FMP_PROPS); nothing passed to the solvers until one differs; a parameter that would make a law
//    non-positive over its range refused; what is passed is what was set
{
  const DRm = require('./drying.js'), own = H.HUB_LAW, D0 = DRm.DR_PROPS, F0 = FM.FMP_PROPS, j = JSON.stringify;
  const same = j(own.waterMu.q.params) === j(D0.waterMu) && j(own.waterL.q.params) === j(D0.waterL) && j(own.airMu.q.params) === j(D0.airMu) && j(own.airK.q.params) === j(D0.airK)
    && j(own.airDv.q.params) === j(D0.airDv) && own.airRho.q.params.M === D0.airM && j(own.waterPsat.q.params.n) === j(D0.psat) && j(own.arMu.q.params) === j(F0.arMu)
    && own.arRho.q.params.M === F0.arM && j(own.gCp.q.params.c) === j(F0.gCp);
  const lib = vm.runInContext('matDefaults().lib', ctx);
  const cs = lib.waterCp.v === D0.waterCp && lib.waterCp.v === F0.waterCp && lib.airCp.v === D0.airCp && lib.arCp.v === F0.arCp && lib.arPr.v === F0.arPr;
  check('laws as inputs (MC-1b): the hub\'s laws and constants at first the solvers\' own (DR_PROPS, FMP_PROPS: Vogel, IAPWS, latent heat, Sutherland, M, D_v, argon, graphite; c_p of water, air, argon, Pr)', same && cs);
  vm.runInContext('this.MAT = matDefaults();', ctx);
  check('  nothing passed to the solvers at first (a project solves as before)', H.matSolverProps() === undefined);
  let why = ''; try { H.hubSetLawParam('waterMu', 'A', null, -1e-5); } catch (e) { why = e.message; }
  let why2 = ''; try { H.hubSetLawParam('arMu', 'b', null, NaN); } catch (e) { why2 = e.message; }
  check('  a parameter that makes its law non-positive over its range refused, said why; not a number refused', /positive/.test(why) && /not a number/.test(why2) && H.matSolverProps() === undefined, `${why} | ${why2}`);
  H.hubSetLawParam('airMu', 'S', null, 120); H.hubSetLawParam('gCp', 'c', 0, 0.55); vm.runInContext('MAT.lib = { ...MAT.lib, waterCp: { ...MAT.lib.waterCp, v: 4200 } };', ctx);
  const pr = H.matSolverProps();
  check('  set: air\'s S 120 K, graphite\'s a 0.55, water\'s c_p 4200 -- exactly these passed, the rest the solvers\' own', j(Object.keys(pr).sort()) === j(['airMu', 'gCp', 'waterCp']) && pr.airMu.S === 120 && pr.airMu.y0 === D0.airMu.y0 && pr.gCp[0] === 0.55 && pr.gCp[1] === F0.gCp[1] && pr.waterCp === 4200
    && Math.abs(H.hubLawAt('airMu', 20) - 1.716e-5 * Math.pow(293.15 / 273.15, 1.5) * (273.15 + 120) / (293.15 + 120)) < 1e-20, j(pr).slice(0, 200));
  H.hubSetLawParam('airMu', 'S', null, 110.4); H.hubSetLawParam('gCp', 'c', 0, F0.gCp[0]); vm.runInContext('MAT.lib = matDefaults().lib;', ctx);
  check('  set back to their own: nothing passed again, no edit kept', H.matSolverProps() === undefined && j(vm.runInContext('MAT.law', ctx)) === '{}');
}
// 8. copies of a material and their domains (MC-2): a copy's values its own; the solvers in a domain it is assigned to take
//    them, every other solver the project's; nothing assigned, the solvers' inputs exactly as before; a copy removed, its
//    domains back to the record's
{
  const R = code => vm.runInContext(code, ctx);
  R('MAT = matDefaults();');
  const id = R("hubDuplicate('gofilm')"), r = R(`hubRec('${id}')`);
  const kS = R(`hubProps(hubRec('${id}')).find(p => p.id === 'kS')`);
  R(`hubSet(hubProps(hubRec('${id}')).find(p => p.id === 'kS'), 0.35)`);
  const a1 = R(`({ copy: hubVal(hubProps(hubRec('${id}')).find(p => p.id === 'kS')).v, own: MAT.dry.kS.v, name: hubName(hubRec('${id}')), vals: Object.keys(MAT.inst['${id}'].vals).length })`);
  check('a copy (Dried GO film): its own values -- its k₃₃ set to 0.35, the project\'s still 0.2; named "(copy)"', id === 'gofilm~1' && r && r.inst === id && kS.b.inst === id && a1.copy === 0.35 && a1.own === 0.2 && /\(copy\)$/.test(a1.name) && a1.vals > 40, JSON.stringify(a1));
  const none = R("[matRun('mp1', () => MAT), matRun('dry', () => MAT)].every(m => m === MAT)");
  check('  not assigned: every solver\'s inputs from the project\'s own state, the same object', none);
  R(`hubAssign('gofilm', 2, '${id}')`);   // (the pre heat's stack)
  const a2 = R("({ mp1: matRun('mp1', () => MAT.dry.kS.v), stack: matRun('stack', () => MAT.dry.kS.v), dry: matRun('dry', () => MAT.dry.kS.v), furn: matRun('mp2', () => MAT.dry.kS.v), nested: matRun('mp1', () => [MAT.dry.kS.v, matRun('dry', () => MAT.dry.kS.v), MAT.dry.kS.v]), after: MAT.dry.kS.v })");
  check('  assigned to the pre heat\'s stack: its two solvers take 0.35; the drying and the furnace 0.2; nested, each its own; the project untouched', a2.mp1 === 0.35 && a2.stack === 0.35 && a2.dry === 0.2 && a2.furn === 0.2 && JSON.stringify(a2.nested) === '[0.35,0.2,0.35]' && a2.after === 0.2, JSON.stringify(a2));
  const rd = R("(() => { const a = hubAssignedFor('gofilm', 'mp1'); return { r: a, v: hubVal(hubProps(hubInstRec(a)).find(p => p.id === 'kS')).v, dry: hubAssignedFor('gofilm', 'dry') }; })()");
  check('  the material each solver takes: the pre heat\'s multiphysics the copy (k₃₃ 0.35), the drying its record', rd.r === id && rd.v === 0.35 && rd.dry === null, JSON.stringify(rd));
  const lawId = R("hubDuplicate('water')");
  R(`hubSetLawParam('waterMu', 'C', null, 135, '${lawId}')`);
  const a3 = R(`({ copy: hubInInst('${lawId}', () => hubLawParams('waterMu').C), own: hubLawParams('waterMu').C, props: matSolverProps() })`);
  check('  a copy\'s law (water\'s viscosity, C 135 K): its own; the project\'s and what the solvers take unchanged until assigned', a3.copy === 135 && a3.own === 140 && a3.props === undefined, JSON.stringify(a3));
  R(`hubDeleteInst('${id}')`);
  const a4 = R("({ inst: Object.keys(MAT.inst), assign: JSON.stringify(MAT.assign.gofilm), mp1: matRun('mp1', () => MAT.dry.kS.v) })");
  check('  the copy deleted: its domain takes the record\'s own again', !a4.inst.includes(id) && a4.assign === '{}' && a4.mp1 === 0.2, JSON.stringify(a4));
  const xr = R("['paste', 'cfilm', 'blade'].map(i => { const r = hubRec(i); return [i, hubProps(r).length, hubProps(r).every(p => hubVal(p).v === null && p.phys.length === 0)]; })");
  check('the spec\'s GO paste, carbonized film and blade material: records with their properties, no value made up, read by no solver at present', xr.every(([, n, ok]) => n >= 6 && ok), JSON.stringify(xr));
  R('MAT = matDefaults();');
}
// 9. the GO's carbon (the paste spec: 48–54 % of the dry GO) and the carbon lost with its oxygen
{
  vm.runInContext('MAT = matDefaults()', ctx);
  const q = vm.runInContext('hubChem()', ctx), co = vm.runInContext('MAT.slurry.co.v', ctx), hc = vm.runInContext('MAT.furn.hc.v', ctx);
  const wC = 12.011 / (12.011 + 15.999 / co + 1.008 * hc) * 100;
  check(`carbon: the dry GO's carbon from its C/O ${co} and H/C ${hc} by atomic masses, ${wC.toFixed(2)} %, within the paste spec 48–54 %`, rel(q.carbon, wC) < 1e-3 && q.carbon >= 48 && q.carbon <= 54, `${q.carbon.toFixed(3)} %`);
  check('  all its oxygen and hydrogen gone, the mass kept is its carbon less the carbon lost: m/m₀ = w_C (1 − ΔC/C)', rel(q.kept, q.carbon * (1 - q.cLost / 100)) < 1e-9 && q.cLost > 0 && q.cLost < 100, `kept ${q.kept.toFixed(2)} %, carbon ${q.carbon.toFixed(2)} %, lost ${q.cLost.toFixed(2)} %`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
