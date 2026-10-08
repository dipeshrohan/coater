'use strict';
/*
 * DOE module: a full-factorial design over one to three inputs (2-5 levels each) at one location,
 * solved with the CFD worker, several runs at a time. Results: a table (CSV), response plots (an
 * output against a factor, a line per level of the second factor, a panel per level of the third),
 * a response map (two factors) and main effects (each factor's mean output at each level).
 * Everything not varied is the base case: the inputs bar, the 2D CFD setup, and the
 * location's own inputs.
 */

// factors: where each lives (a location input, the blade geometry, the land length, a solver setting)
const DOE_FACTORS = [
  { k: 'U', l: 'Web speed', u: 'm/min', kind: 'loc', g: 'Process and slurry', d: 2, lo: 0.02, hi: 5 },
  { k: 'gap', l: 'Gap at the edge', u: 'mm', kind: 'loc', g: 'Process and slurry', d: 3, lo: 0.05, hi: 10 },
  { k: 'Pup', l: 'Bead pressure', u: 'kPa', kind: 'loc', g: 'Process and slurry', d: 2, lo: 0, hi: 20 },
  { k: 'mu', l: 'Viscosity at 2.7 1/s', u: 'Pa·s', kind: 'loc', g: 'Process and slurry', d: 2, lo: 0.05, hi: 500 },
  // (MH-3: the laws' own parameters: K kept while τy or n vary, η0 for Carreau–Yasuda and Cross)
  { k: 'K', l: 'Consistency K', u: 'Pa·sⁿ', kind: 'loc', g: 'Process and slurry', d: 3, lo: 0.001, hi: 1000, uses: 'K' },
  { k: 'eta0', l: 'Zero-shear viscosity η0', u: 'Pa·s', kind: 'loc', g: 'Process and slurry', d: 2, lo: 0.001, hi: 1e5, uses: 'eta0' },
  { k: 'n', l: 'Shear-thinning n', u: '', kind: 'loc', g: 'Process and slurry', d: 2, lo: 0.1, hi: 1.5, uses: 'n' },
  { k: 'ty', l: 'Yield stress', u: 'Pa', kind: 'loc', g: 'Process and slurry', d: 1, lo: 0, hi: 500, uses: 'ty' },
  { k: 'g', l: 'Surface tension', u: 'N/m', kind: 'loc', g: 'Process and slurry', d: 3, lo: 0.01, hi: 0.1 },
  { k: 'th', l: 'Contact angle', u: '°', kind: 'loc', g: 'Process and slurry', d: 1, lo: 5, hi: 175 },
  { k: 'R', l: 'Entry radius', u: 'mm', kind: 'geo', g: 'Blade geometry', d: 0, lo: 10, hi: 500, shape: 'round' },
  { k: 'pool', l: 'Pool edge upstream', u: 'mm', kind: 'geo', g: 'Blade geometry', d: 0, lo: 5, hi: 150, shape: 'round' },
  { k: 'exitAngle', l: 'Exit face to the web', u: '°', kind: 'geo', g: 'Blade geometry', d: 0, lo: 30, hi: 150, shape: ['round', 'flat', 'bevel', 'radius', 'wedge', 'twostep'] },
  { k: 'L', l: 'Land length', u: 'mm', kind: 'land', g: 'Blade geometry', d: 1, lo: 1, hi: 100, shape: ['flat', 'bevel', 'radius', 'wedge', 'twostep'] },
  ...BLADE_DIMS.map(b => ({ k: b.k, l: b.l, u: b.u, kind: 'geo', g: 'Blade geometry', d: b.step < 0.1 ? 2 : b.step < 1 ? 1 : 0, lo: b.lo, hi: b.hi, shape: b.shapes })),
  // (the blade across the web: set for the run, the location's gap follows; the film across the web from the 1D)
  { k: 'bowUm', l: 'Bow at the middle (typed)', u: 'µm', kind: 'acr', g: 'Blade across the web', d: 1, lo: -500, hi: 500 },
  { k: 'tilt', l: 'Blade tilt across the web', u: 'µm', kind: 'p', g: 'Blade across the web', d: 0, lo: -500, hi: 500 },
  { k: 'endD', l: 'Chamfer depth (both ends)', u: 'µm', kind: 'acr', g: 'Blade across the web', d: 1, lo: 0, hi: 500 },
  { k: 'endC', l: 'Chamfer length (both ends)', u: 'mm', kind: 'acr', g: 'Blade across the web', d: 1, lo: 0.5, hi: 150 },
  { k: 'mesh', l: 'Mesh', u: '', kind: 'solver', g: 'Mesh and solver', cat: ['coarse', 'medium', 'fine'], cl: v => MESH_PRESETS[v].l },
  { k: 'tol', l: 'Newton tolerance', u: '', kind: 'solver', g: 'Mesh and solver', cat: SOLVER_TOLS, cl: v => fmtTol(v) },
];
const DOE_OUTPUTS = [
  { k: 'film', l: 'Wet film thickness, Q/U', u: 'mm', g: 'Film and flow', d: 4 },
  { k: 'Q', l: 'Through-flow Q', u: 'mm²/s', g: 'Film and flow', d: 3 },
  { k: 'hEnd', l: 'Film at the end of the 2D domain', u: 'mm', g: 'Film and flow', d: 4 },
  { k: 'cl', l: 'Contact line up the exit face', u: 'mm (0 = pinned)', g: 'Meniscus', d: 3 },
  { k: 'leave', l: 'Surface angle at the contact line', u: '°', g: 'Meniscus', d: 1 },
  { k: 'pMax', l: 'Peak pressure', u: 'Pa', g: 'Pressure and shear', d: 1 },
  { k: 'dpdx', l: '−dp/dx along the web under the edge', u: 'kPa/m', g: 'Pressure and shear', d: 2 },
  { k: 'shear', l: 'Max shear rate away from the corner', u: '1/s', g: 'Pressure and shear', d: 2 },
  { k: 'rev', l: 'Reverse flow', u: '% of area', g: 'Flow quality', d: 2 },
  { k: 'recirc', l: 'Recirculation area', u: 'mm²', g: 'Flow quality', d: 3 },
  { k: 'stag', l: 'Stagnation points', u: '', g: 'Flow quality', d: 0 },
  { k: 'tres', l: 'Mean residence time to the edge', u: 's', g: 'Flow quality', d: 2 },
  { k: 'filmAcross', l: 'Film range across the web (1D)', u: 'µm', g: 'Across the web', d: 2 },
  // (the flakes' alignment, when it is on: Materials › Flakes; computed with each run)
  { k: 'flatOut', l: 'Flake flatness leaving the blade', u: '1 flat, 0 random', g: 'Flakes (alignment)', d: 3 },
  { k: 'flatOven', l: 'Flake flatness at the oven', u: '1 flat, 0 random', g: 'Flakes (alignment)', d: 3 },
  { k: 'mdSpread', l: 'SEM spread, cut along the web', u: '°', g: 'Flakes (alignment)', d: 1 },
  { k: 'cdSpread', l: 'SEM spread, cut across the web', u: '°', g: 'Flakes (alignment)', d: 1 },
  // (dried: the film collapsed as it dries, GO-3 -- the film an SEM sees)
  { k: 'flatDried', l: 'Flake flatness, dried film', u: '1 flat, 0 random', g: 'Flakes (alignment)', d: 3 },
  { k: 'mdSpreadD', l: 'SEM spread along the web, dried film', u: '°', g: 'Flakes (alignment)', d: 1 },
  { k: 'cdSpreadD', l: 'SEM spread across the web, dried film', u: '°', g: 'Flakes (alignment)', d: 1 },
  // (the drying in the oven, GO-3: this run's film, the water leaving from the top only and from the top and the bottom)
  { k: 'waterTop', l: 'Water left at the oven\'s exit, top only', u: '% of the GO', g: 'Drying (oven)', d: 1 },
  { k: 'waterBoth', l: 'Water left at the oven\'s exit, top and bottom', u: '% of the GO', g: 'Drying (oven)', d: 1 },
  { k: 'dryAtTop', l: 'Dry at, top only', u: 'm into the oven (— not dry)', g: 'Drying (oven)', d: 2 },
  { k: 'dryAtBoth', l: 'Dry at, top and bottom', u: 'm into the oven (— not dry)', g: 'Drying (oven)', d: 2 },
  // (the film followed on to the peel, GO-4: this run's film, both ways the water leaves)
  { k: 'crackTop', l: 'Crack risk, top only', u: '× its toughness (1 and above: cracks)', g: 'Film (peeled off)', d: 2 },
  { k: 'crackBoth', l: 'Crack risk, top and bottom', u: '× its toughness (1 and above: cracks)', g: 'Film (peeled off)', d: 2 },
  { k: 'peelTop', l: 'Peel by hand (180°), top only', u: 'N/m', g: 'Film (peeled off)', d: 2 },
  { k: 'peelBoth', l: 'Peel by hand (180°), top and bottom', u: 'N/m', g: 'Film (peeled off)', d: 2 },
  { k: 'curlTop', l: 'Curl settled, top only', u: '1/m (+ away from its top, − toward it)', g: 'Film (peeled off)', d: 2 },
  { k: 'curlBoth', l: 'Curl settled, top and bottom', u: '1/m (+ away from its top, − toward it)', g: 'Film (peeled off)', d: 2 },
  { k: 'rollTop', l: 'Stress on the roll, top only', u: 'MPa', g: 'Film (peeled off)', d: 0 },
  { k: 'rollBoth', l: 'Stress on the roll, top and bottom', u: 'MPa', g: 'Film (peeled off)', d: 0 },
  { k: 'blisterTop', l: 'Blister risk, top only', u: '× its hold (1 and above: blisters)', g: 'Film (peeled off)', d: 2 },
  { k: 'blisterBoth', l: 'Blister risk, top and bottom', u: '× its hold (1 and above: blisters)', g: 'Film (peeled off)', d: 2 },
  { k: 'sizeTop', l: 'A piece\'s size change in the pre heat treatment, top only', u: '% of as cut', g: 'Film (peeled off)', d: 2 },
  { k: 'sizeBoth', l: 'A piece\'s size change in the pre heat treatment, top and bottom', u: '% of as cut', g: 'Film (peeled off)', d: 2 },
  // (the furnace, GO-5: this run's film's piece, its water leaving from the top only, through both runs)
  { k: 'furnH', l: 'Graphene film\'s thickness, the batch\'s mean', u: 'µm', g: 'Furnace (graphene film)', d: 1 },
  { k: 'furnRatio', l: 'Graphene film over the GO piece, thickness', u: '×', g: 'Furnace (graphene film)', d: 2 },
  { k: 'furnRho', l: 'Graphene film\'s density', u: 'g/cm³', g: 'Furnace (graphene film)', d: 2 },
  { k: 'furnKappa', l: 'Graphene film\'s heat along it', u: 'W/(m·K)', g: 'Furnace (graphene film)', d: 0 },
  { k: 'furnGas1', l: 'Gas against its hold, run 1, the stack\'s most', u: '% (100: puffs up)', g: 'Furnace (graphene film)', d: 0 },
  { k: 'furnGas2', l: 'Gas against its hold, run 2, the stack\'s most', u: '% (100: puffs up)', g: 'Furnace (graphene film)', d: 0 },
  { k: 'furnEven', l: 'Graphene film\'s thickness range over the stack\'s pieces', u: '% of its mean', g: 'Furnace (graphene film)', d: 1 },
  { k: 'furnSD', l: 'Graphene film\'s thickness, standard deviation over the batch', u: 'µm', g: 'Furnace (graphene film)', d: 1 },
  { k: 'furnCrack', l: 'Its pull against its strength, the stack\'s worst piece', u: '% (100: cracks)', g: 'Furnace (graphene film)', d: 0 },
  { k: 'furnWave', l: 'Its squeeze against what buckles it, the stack\'s worst piece', u: '% (100: waves)', g: 'Furnace (graphene film)', d: 0 },
  { k: 'furnStuck', l: 'Stuck to its paper or plate, the stack\'s most', u: '% of the piece', g: 'Furnace (graphene film)', d: 0 },
  { k: 'furnSize', l: 'Its size after the furnace, free', u: '% (along itself)', g: 'Furnace (graphene film)', d: 2 },
  // (the mixer, task 7: the batch at the program's end, the 1D batch model)
  { k: 'mixD50', l: 'Flake size, the median', u: 'µm', g: 'Mixing', d: 2 },
  { k: 'mixLumps', l: 'Lumps left', u: '% of the GO', g: 'Mixing', d: 3 },
  { k: 'mixPH', l: 'pH at the end', u: '', g: 'Mixing', d: 2 },
  { k: 'mixT', l: 'Batch temperature at the end', u: '°C', g: 'Mixing', d: 1 },
];
const DOE = {
  loc: 0,
  workers: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)),
  factors: null,                 // the design being edited: [{ k, min, max, n } | { k, vals }]
  design: null, runs: [], status: 'idle', key: null, t0: 0, t1: 0, active: new Set(),
  plot: 'response', out: 'film', x: 0, mx: 0, my: 1, dock: 'design', dockH: null,
  mode: 'coat',                  // 'coat': the coating's DOE (the 2D CFD); 'furn': the furnace's (GO-6); 'mix': the mixer's (task 7)
};
/**
 * The furnace's DOE (GO-6, Q122): the furnace's settings and its card's uncertain values varied for the film's piece as
 * it is (the flow not solved again): each run a furnace run, a few seconds. kind: 'fx' the run's heating rates times a
 * factor, 'ftop' / 'fhold' run 2's last step, 'fstack' the stack in its holder, 'fcard' a Furnace card value.
 */
const DOE_FURN_FACTORS = [
  { k: 'r1x', l: 'Run 1: its heating rates ×', u: '', kind: 'fx', run: 0, g: 'The runs', d: 2, lo: 0.05, hi: 20 },
  { k: 'r2x', l: 'Run 2: its heating rates ×', u: '', kind: 'fx', run: 1, g: 'The runs', d: 2, lo: 0.05, hi: 20 },
  { k: 'r2top', l: 'Run 2: its top temperature', u: '°C', kind: 'ftop', run: 1, g: 'The runs', d: 0, lo: 1000, hi: 3300 },
  { k: 'r2hold', l: 'Run 2: its hold at the top', u: 'min', kind: 'fhold', run: 1, g: 'The runs', d: 0, lo: 0, hi: 2000 },
  { k: 'N', l: 'Pieces in a stack', u: '', kind: 'fstack', g: 'The stack in its holder', d: 0, lo: 1, hi: 1000 },
  { k: 'plateW', l: 'A plate resting on the stack', u: 'kg', kind: 'fstack', g: 'The stack in its holder', d: 1, lo: 0, hi: 1000 },
  { k: 'gap', l: 'Gap above the stack', u: 'mm', kind: 'fstack', g: 'The stack in its holder', d: 0, lo: 0, hi: 1000 },
  { k: 'paperT', l: 'Graphite paper\'s thickness', u: 'mm', kind: 'fstack', g: 'The stack in its holder', d: 2, lo: 0.01, hi: 10 },
  // (GO-7e: the holder's plates the top and bottom pieces touch)
  { k: 'plateT', l: 'The holder\'s plates\' thickness', u: 'mm', kind: 'fstack', g: 'The stack in its holder', d: 0, lo: 1, hi: 500 },
  // (the card's rows that follow on from the one above them, "…", named whole here; the pressure it sticks from, GO-7c)
  ...['sigZ', 'es', 'Dgal', 'bO', 'bG', 'mu', 'Tst', 'pSt', 'tauB', 'Bpl', 'muPl'].map(k => { const q = MAT_FURN.find(r => r[0] === k), whole = { bG: 'Shrinks along it as its layers order into graphite', pSt: 'It sticks where pressed at least' };
    return { k: 'c_' + k, card: k, l: whole[k] || q[1], u: q[2], kind: 'fcard', g: 'The Furnace card', d: q[6], lo: q[3], hi: q[4] }; }),
];
/**
 * The mixer's DOE (task 7): the program's steps varied -- each step's disc and arm speeds and its minutes -- the batch
 * solved again in the 1D (under a second a run). kind 'mx': a step's field, its step by its place in the program.
 */
const DOE_MIX_FIELDS = [['Nd', 'disc speed', 'rpm', 0, 0, 5000], ['No', 'arm speed', 'rpm', 0, 1, 200], ['min', 'time', 'min', 1, 0.5, 600]];
function doeMixFactors() {
  const st = (typeof mixIn === 'function' && mixIn().steps) || [];
  return st.flatMap((q, i) => DOE_MIX_FIELDS.map(([fld, l, u, d, lo, hi]) => ({ k: `mx${fld}${i}`, l: `${q.name || `Step ${i + 1}`}: ${l}`, u, kind: 'mx', step: i, field: fld, g: 'The program', d, lo, hi })));
}
/** The DOE shown: the coating's (the 2D CFD at a location) or the furnace's; the other's design and runs kept aside. */
const DOE_STASH = { coat: null, furn: null, mix: null };
const DOE_KEEP = ['factors', 'design', 'runs', 'status', 'key', 't0', 't1', 'out', 'x', 'mx', 'my'];
const doeFactors = () => DOE.mode === 'furn' ? DOE_FURN_FACTORS : DOE.mode === 'mix' ? doeMixFactors() : DOE_FACTORS;
const doeOutputsNow = () => DOE.mode === 'furn' ? DOE_OUTPUTS.filter(o => o.g === 'Furnace (graphene film)') : DOE.mode === 'mix' ? DOE_OUTPUTS.filter(o => o.g === 'Mixing') : DOE_OUTPUTS.filter(o => o.g !== 'Mixing');
/** A factor by its key: in the DOE shown, else the others' (a mixer step's that is no longer in the program: its own
 *  words, not varied). */
const doeFactor = k => doeFactors().find(f => f.k === k) || DOE_FACTORS.find(f => f.k === k) || DOE_FURN_FACTORS.find(f => f.k === k) || doeMixFactors().find(f => f.k === k)
  || (/^mx(Nd|No|min)\d+$/.test(k) ? (([, fld, i]) => { const q = DOE_MIX_FIELDS.find(x => x[0] === fld); return { k, l: `Step ${+i + 1}: ${q[1]}`, u: q[2], kind: 'mx', step: +i, field: fld, g: 'The program', d: q[3], lo: q[4], hi: q[5], gone: true }; })(k.match(/^mx(Nd|No|min)(\d+)$/)) : undefined);
function doeSetMode(m) {
  if (m === DOE.mode || DOE.status === 'running' || !['coat', 'furn', 'mix'].includes(m)) return;
  DOE_STASH[DOE.mode] = Object.fromEntries(DOE_KEEP.map(k => [k, DOE[k]]));
  const back = DOE_STASH[m];
  if (back) DOE_KEEP.forEach(k => { DOE[k] = back[k]; });
  else Object.assign(DOE, { factors: null, design: null, runs: [], status: 'idle', key: null, t0: 0, t1: 0, out: { furn: 'furnH', mix: 'mixLumps' }[m] || 'film', x: 0, mx: 0, my: 1 });
  DOE.mode = m;
  render();
}
/** The key of what the DOE's base case is, as the inputs are (its results go stale when it changes). */
const doeBaseKey = () => (typeof sensAsSet === 'function' ? sensAsSet(doeBaseKeyNow) : doeBaseKeyNow());
const doeBaseKeyNow = () => DOE.mode === 'furn' ? (typeof furnKeyNow === 'function' ? furnKeyNow() : null) : DOE.mode === 'mix' ? (typeof mixKeyNow === 'function' ? mixKeyNow() : null) : cfdInputsKey(cfdGeometry(DOE.loc));
/** The furnace's options for a run of its DOE: the settings as they are, the run's factors set. */
function doeFurnOpts(set) {
  const q = furnInputs();
  if (!q) return null;
  const keepF = OVEN.furn, keepM = MAT.furn, fu = JSON.parse(JSON.stringify(OVEN.furn)), card = { ...MAT.furn }, L = FURN_STEP_LIMITS;
  for (const { f, v } of set) {
    if (f.kind === 'fx') fu.runs[f.run].steps.forEach(st => { st.rate = Math.min(L.rate[1], Math.max(L.rate[0], st.rate * v)); });
    else if (f.kind === 'ftop') fu.runs[f.run].steps[fu.runs[f.run].steps.length - 1].to = v;
    else if (f.kind === 'fhold') fu.runs[f.run].steps[fu.runs[f.run].steps.length - 1].hold = v;
    else if (f.kind === 'fstack') { fu[f.k] = f.k === 'N' ? Math.round(v) : v; if (f.k === 'gap' && v > 0) fu.room = 'gap'; }
    else if (f.kind === 'fcard') card[f.card] = { ...card[f.card], v };
  }
  try { OVEN.furn = fu; MAT = { ...MAT, furn: card }; return furnOpts(q.P, q.o.Lx, q.o.Ly); }
  finally { OVEN.furn = keepF; MAT = { ...MAT, furn: keepM }; }
}
/** A furnace run's outputs (as the DOE lists them). */
function doeFurnOutputs(res, P) {
  // (GO-7: the batch's thickness and spread; each check at the stack's worst piece, the coldest and hottest stacks' too)
  const e = res.end, pl = res.plane, L = res.pos || [res], B = res.batch || { hMean: e.h, hSD: e.hSD }, sp = res.stacks;
  const S = sp ? [...sp.cold.pos, ...sp.hot.pos] : [];
  const mx = (f, g) => Math.max(...L.map(f), ...(g ? S.map(g) : []));
  const hMin = Math.min(...L.map(q => q.end.hMin)), hMax = Math.max(...L.map(q => q.end.hMax));
  return { furnH: B.hMean * 1e6, furnRatio: B.hMean / P.h, furnRho: e.mEnd / B.hMean / 1000, furnKappa: e.kappa * e.h / B.hMean,
    furnGas1: mx(q => q.runs[0].peak.idx, p => p.puff[0]) * 100, furnGas2: res.runs[1] ? mx(q => q.runs[1].peak.idx, p => p.puff[1]) * 100 : NaN,
    furnEven: (hMax - hMin) / B.hMean * 100, furnSD: B.hSD * 1e6, furnCrack: pl ? mx(q => q.plane.ratioMax, p => p.ratioMax) * 100 : NaN, furnWave: pl ? mx(q => q.plane.waveMax, p => p.waveMax) * 100 : NaN,
    furnStuck: pl ? mx(q => q.plane.stuckFrac, p => p.stuckFrac) * 100 : NaN, furnSize: pl ? pl.size.free * 100 : NaN };
}
function doeStartFurn(run) {
  const o = doeFurnOpts(DOE.design.map((d, m) => ({ f: d.f, v: run.vals[m] }))), q = furnInputs();
  if (!o || !q) { Object.assign(run, { status: 'error', error: 'the furnace needs the film\'s piece solved (Cutting)', ms: 0 }); return; }
  const w = makeWorker('cfd-furnace-worker.js'), t0 = performance.now();
  const used = new Set([...DOE.active].map(r => r.slot));
  Object.assign(run, { status: 'running', worker: w, progress: null, slot: [0, 1, 2, 3, 4, 5, 6, 7].find(k => !used.has(k)) ?? 0, live: null });
  DOE.active.add(run);
  const end = () => { w.terminate(); run.worker = null; DOE.active.delete(run); run.ms = performance.now() - t0; };
  w.onmessage = e => {
    if (run.worker !== w || e.data.progress) return;   // (stopped: its late events ignored)
    end();
    if (!e.data.ok) Object.assign(run, { status: 'error', error: e.data.error });
    else Object.assign(run, { status: 'done', out: doeFurnOutputs(e.data.res, q.P) });
    doePump(); renderDOE();
  };
  w.onerror = e => { if (run.worker !== w) return; end(); Object.assign(run, { status: 'error', error: e.message || 'worker error' }); doePump(); renderDOE(); };
  w.postMessage({ id: 1, kind: 'run', o });
}
/** The mixer's options for a run of its DOE: the program as it is, the run's factors set in it (the page's units). */
function doeMixOpts(set) {
  const keep = OVEN.mix, m = JSON.parse(JSON.stringify(mixIn()));
  for (const { f, v } of set) if (f.kind === 'mx' && m.steps[f.step]) m.steps[f.step][f.field] = v;
  try { OVEN.mix = m; return mixOpts(); } finally { OVEN.mix = keep; }
}
/** The mixer's first design: the disc's speed and the time of the step it turns fastest in. */
function doeMixFirst() {
  const st = mixIn().steps || [], i = st.reduce((b, q, k) => (q.Nd > (st[b] ? st[b].Nd : -1) ? k : b), 0);
  return st.length ? [doeNewFactor(`mxNd${i}`, 0), doeNewFactor(`mxmin${i}`, 0)] : [];
}
/** A mixer run's outputs (as the DOE lists them): the batch at the program's end. */
const doeMixOutputs = e => ({ mixD50: e.d50 * 1e6, mixLumps: e.lumps * 100, mixPH: e.pH, mixT: e.T });
/** A mixer run: the 1D batch on this page (under a second), one after another (the DOE's own pace: no worker). */
function doeStartMix(run) {
  const set = DOE.design.map((d, m) => ({ f: d.f, v: run.vals[m] }));
  Object.assign(run, { status: 'running', worker: null, progress: null, slot: 0, live: null });
  DOE.active.add(run);
  setTimeout(() => {
    if (!DOE.active.has(run)) return;   // (stopped before it started)
    const t0 = performance.now(), keep = DR_P;
    let r;
    try { if (typeof drUse === 'function') drUse(mixProps()); r = mixRun(doeMixOpts(set)); } catch (e) { r = { error: e.message || String(e) }; } finally { DR_P = keep; }
    DOE.active.delete(run); run.ms = performance.now() - t0;
    if (run.status !== 'running') return;   // (stopped while it solved)
    if (r.error) Object.assign(run, { status: 'error', error: r.error });
    else Object.assign(run, { status: 'done', out: doeMixOutputs(r.end) });
    doePump(); renderDOE();
  }, 20);
}
/** A factor can be varied with the current model and blade shape. */
const doeAvailable = f => f.kind === 'mx' ? !f.gone && !!(mixIn().steps || [])[f.step] : f.kind && f.kind[0] === 'f' && f.kind !== 'fcard' && f.kind !== 'fstack' ? !(OVEN.furn.runs[f.run] && OVEN.furn.runs[f.run].file) : (!f.shape || (Array.isArray(f.shape) ? f.shape.includes(CFDG.shape) : f.shape === CFDG.shape)) && (!f.uses || RHEO_MODELS[CFDG.model].uses.includes(f.uses));
/** A factor's value in the base case at location i. */
function doeBase(f, i) {
  if (f.kind === 'mx') { const q = (mixIn().steps || [])[f.step]; return q ? q[f.field] : NaN; }
  if (f.kind === 'fx') return 1;
  if (f.kind === 'ftop' || f.kind === 'fhold') { const st = OVEN.furn.runs[f.run].steps; return st[st.length - 1][f.kind === 'ftop' ? 'to' : 'hold']; }
  if (f.kind === 'fstack') return OVEN.furn[f.k];
  if (f.kind === 'fcard') return MAT.furn[f.card].v;
  if (f.kind === 'loc') return locInput(i, f.k);
  if (f.kind === 'geo') return CFDG[f.k];
  if (f.kind === 'land') return P.L;
  if (f.kind === 'p') return P[f.k];
  if (f.kind === 'acr') return { bowUm: ACR.bow.on && ACR.bow.mode === 'typed' ? ACR.bow.um : 0, endD: ACR.ends.on ? ACR.ends.left.d : 0, endC: ACR.ends.left.c }[f.k];
  return solverOf(i)[f.k];
}
/** A factor of the blade across the web set (the settings as they were are given back by the caller). */
function doeSetAcross(f, v) {
  if (f.k === 'bowUm') ACR.bow = { ...ACR.bow, on: true, mode: 'typed', um: v };
  else if (f.k === 'endD') ACR.ends = { on: true, left: { ...ACR.ends.left, d: v }, right: { ...ACR.ends.right, d: v } };
  else if (f.k === 'endC') ACR.ends = { on: true, left: { ...ACR.ends.left, c: v }, right: { ...ACR.ends.right, c: v } };
}
/** A new factor row: levels around the base value (categories: all of them). */
/** A new factor row, its range about the project's own value (while the ranking of the assumed values runs: the value it
 *  is changing put back first -- a range taken from it would stay). */
const doeNewFactor = (k, i) => (typeof sensAsSet === 'function' ? sensAsSet(() => doeNewFactorNow(k, i)) : doeNewFactorNow(k, i));
function doeNewFactorNow(k, i) {
  const f = doeFactor(k);
  if (f.cat) return { k, vals: f.cat.slice() };
  const v = doeBase(f, i), span = f.k === 'th' || f.k === 'exitAngle' ? 20 : null;
  const r = x => +Math.min(f.hi, Math.max(f.lo, x)).toFixed(f.d);
  let min = span ? r(v - span) : r(v * 0.5), max = span ? r(v + span) : r(v * 1.5);
  if (!(max > min)) { min = r(f.lo); max = r(Math.max(f.lo + 1, v * 2 || 1)); }
  return { k, min, max, n: 3 };
}
/** A factor row's levels. */
const doeLevels = fs => fs.vals ? fs.vals.slice() : Array.from({ length: fs.n }, (_, j) => +(fs.min + (fs.max - fs.min) * j / (fs.n - 1)).toPrecision(6));
const doeFmt = (f, v) => f.cat ? f.cl(v) : String(+(+v).toPrecision(4));
const doeLabel = f => f.l + (f.u ? ` (${f.u})` : '');
const doeRunCount = () => DOE.factors.filter(fs => doeAvailable(doeFactor(fs.k))).reduce((a, fs) => a * doeLevels(fs).length, 1);

/** The geometry of location i with the factors set to given values (the base case otherwise). */
function doeGeometry(i, set, across = false) {
  const loc = CFD_LOCS[i], keep = { over: { ...loc.over }, solver: { ...loc.solver }, cfdg: { ...CFDG }, L: P.L, p: { ...P }, acr: JSON.stringify(ACR) };
  try {
    for (const { f, v } of set) {
      if (f.kind === 'loc') loc.over[f.k] = v;
      else if (f.kind === 'geo') CFDG[f.k] = v;
      else if (f.kind === 'land') P.L = v;
      else if (f.kind === 'p') P[f.k] = v;
      else if (f.kind === 'acr') doeSetAcross(f, v);
      else loc.solver[f.k] = v;
    }
    // (across: also the 1D's inputs at every position across the web, as Coating › 1D › Across the web solves them)
    return across ? { geo: cfdGeometry(i), across: acrossPositions().map(oneDGeoAt), ripple: oneDRipple() } : cfdGeometry(i);
  } finally { loc.over = keep.over; loc.solver = keep.solver; Object.assign(CFDG, keep.cfdg); P.L = keep.L; Object.assign(P, keep.p); applyAcross(JSON.parse(keep.acr)); }
}
/** A run's outputs from its solution. */
function doeOutputs(r, geo) {
  const f = makeFlowField(r, { rho: geo.rho, ty: geo.ty }), m = flowMetrics(f), i = r.iCorner;
  let gd = 0;
  for (let k = 0; k < f.shear.length; k++) if (!(f.cornerZone && f.cornerZone[k]) && f.shear[k] > gd) gd = f.shear[k];
  const res = residenceTimes(f, r.xe);
  return {
    film: r.Q / geo.U * 1000, Q: r.Q * 1e6, hEnd: r.hEnd * 1000,
    cl: r.mode === 'climbed' || (r.shaped && r.shaped.k) ? r.sCL * 1000 : 0, leave: r.leaveDeg,
    pMax: r.pMax, dpdx: -(r.pWeb[i + 1] - r.pWeb[i - 1]) / (r.xWeb[i + 1] - r.xWeb[i - 1]) / 1000, shear: gd,
    rev: m.reverseFraction * 100, recirc: m.recircArea * 1e6, stag: m.stagnation.length, tres: res.n ? res.mean : NaN,
    flatOut: r.orient ? r.orient.film.out.Sy : NaN, flatOven: r.orient ? r.orient.film.oven.Sy : NaN,
    mdSpread: r.orient ? r.orient.cuts.md.spread : NaN, cdSpread: r.orient ? r.orient.cuts.cd.spread : NaN,
    flatDried: r.orient && r.orient.film.dried ? r.orient.film.dried.Sy : NaN,
    mdSpreadD: r.orient && r.orient.cuts.dried ? r.orient.cuts.dried.md.spread : NaN, cdSpreadD: r.orient && r.orient.cuts.dried ? r.orient.cuts.dried.cd.spread : NaN,
    ...(() => { const d = r.drying && !r.drying.error ? r.drying : null, at = q => q && q.dry ? q.dryAt : NaN;
      return { waterTop: d ? d.top.waterPct : NaN, waterBoth: d ? d.both.waterPct : NaN, dryAtTop: d ? at(d.top) : NaN, dryAtBoth: d ? at(d.both) : NaN }; })(),
    ...(() => { const m = r.peeled && !r.peeled.error ? r.peeled : null, v = (w, f) => m ? f(m[w]) : NaN;
      return { crackTop: v('top', q => q.crack), crackBoth: v('both', q => q.crack), peelTop: v('top', q => q.peelHand), peelBoth: v('both', q => q.peelHand),
        curlTop: v('top', q => q.curl), curlBoth: v('both', q => q.curl), rollTop: v('top', q => q.roll / 1e6), rollBoth: v('both', q => q.roll / 1e6),
        blisterTop: v('top', q => q.blister), blisterBoth: v('both', q => q.blister), sizeTop: v('top', q => q.size), sizeBoth: v('both', q => q.size) }; })(),
    ...(() => { const f = r.furn && !r.furn.error ? r.furn : null, v = k => f ? f[k] : NaN;
      return { furnH: v('h'), furnRatio: v('ratio'), furnRho: v('rho'), furnKappa: v('kappa'), furnGas1: v('gas1'), furnGas2: v('gas2'), furnEven: v('even'),
        furnSD: v('sd'), furnCrack: v('crack'), furnWave: v('wave'), furnStuck: v('stuck'), furnSize: v('size') }; })(),
  };
}

// ---------------------------------------------------------------------
// Running: a queue of runs, DOE.workers solving at a time
// ---------------------------------------------------------------------
function runDOE() {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: its inputs are not the project's)
  if (DOE.status === 'running') return;
  const design = DOE.factors.map(fs => ({ ...fs, f: doeFactor(fs.k) })).filter(d => doeAvailable(d.f)).map(d => ({ ...d, levels: doeLevels(d) }));
  if (!design.length) return;
  undoCommit();
  let combos = [[]];
  for (const d of design) combos = combos.flatMap(c => d.levels.map((_, j) => [...c, j]));
  Object.assign(DOE, {
    design, key: doeBaseKey(), status: 'running', t0: Date.now(), t1: 0, active: new Set(),
    runs: combos.map((idx, n) => ({ n, idx, vals: idx.map((j, m) => design[m].levels[j]), status: 'pending' })),
  });
  DOE.x = Math.min(DOE.x, design.length - 1); DOE.mx = 0; DOE.my = Math.min(1, design.length - 1);
  undoSync();   // (the plot axes follow the new design: not a step)
  logCFD(DOE.loc, `DOE started: ${DOE.runs.length} runs, ${design.map(d => `${d.f.l.toLowerCase()} ${d.levels.map(v => doeFmt(d.f, v)).join(' / ')}`).join('; ')}`);
  doePump();
  renderDOE();
}
function doePump() {
  if (DOE.status !== 'running') return;
  while (DOE.active.size < DOE.workers) {
    const run = DOE.runs.find(r => r.status === 'pending');
    if (!run) break;
    doeStart(run);
  }
  if (!DOE.active.size) {
    DOE.status = 'done'; DOE.t1 = Date.now();
    const bad = DOE.runs.filter(r => r.status === 'error').length;
    logCFD(DOE.loc, `DOE finished: ${DOE.runs.length - bad} of ${DOE.runs.length} runs solved in ${doeClock(DOE.t1 - DOE.t0)}`, bad ? 'warn' : '');
  }
}
function doeStart(run) {
  if (DOE.mode === 'furn') { doeStartFurn(run); return; }
  if (DOE.mode === 'mix') { doeStartMix(run); return; }
  const G = doeGeometry(DOE.loc, DOE.design.map((d, m) => ({ f: d.f, v: run.vals[m] })), true), geo = G.geo;
  // (inputs outside what the solver can do: the run is not solved)
  const errs = checkGeometry(geo, null).filter(p => p.level === 'error');
  if (errs.length) { Object.assign(run, { status: 'error', error: `not solved: ${errs.map(p => p.text).join(' ')}`, ms: 0 }); return; }
  const w = makeWorker('cfd-worker.js'), t0 = performance.now();
  // (a colour slot per run while it solves: the lowest one free)
  const used = new Set([...DOE.active].map(r => r.slot));
  Object.assign(run, { status: 'running', worker: w, progress: null, slot: [0, 1, 2, 3, 4, 5, 6, 7].find(k => !used.has(k)) ?? 0, live: { r: [], solves: [], t0: performance.now(), tol: geo.solver.tol } });
  DOE.active.add(run);
  const end = () => { w.terminate(); run.worker = null; DOE.active.delete(run); run.ms = performance.now() - t0; };
  const settle = () => { doePump(); renderDOE(); };
  w.onmessage = e => {
    if (run.worker !== w) return;   // (stopped: its late events ignored)
    if (e.data.progress) { run.progress = e.data.progress; liveAdd(run.live, run.progress); doeStatusLine(); drawDOELive(); return; }
    const r = e.data.ok ? e.data.result : null;
    if (!r) { end(); Object.assign(run, { status: 'error', error: e.data.error }); settle(); return; }
    if (!r.converged && !(r.stalled && r.residual < 1e-4)) { end(); Object.assign(run, { status: 'error', error: `did not converge (residual ${r.residual.toExponential(1)})` }); settle(); return; }
    let out;
    try { out = doeOutputs(r, geo); } catch (err) { end(); Object.assign(run, { status: 'error', error: err.message }); settle(); return; }
    // then the film across the web: the 1D at every position (in the run's own slot, a 1D worker)
    w.terminate();
    const w1 = makeWorker('cfd-1d-worker.js');
    run.worker = w1;
    w1.onmessage = e1 => {
      if (run.worker !== w1) return;
      end1();
      const A = e1.data.ok && e1.data.across;
      out.filmAcross = A ? (Math.max(...A.map(q => q.film)) - Math.min(...A.map(q => q.film))) * 1e6 : NaN;
      Object.assign(run, { status: 'done', out });
      settle();
    };
    w1.onerror = () => { if (run.worker !== w1) return; end1(); Object.assign(run, { status: 'done', out: { ...out, filmAcross: NaN } }); settle(); };
    const end1 = () => { w1.terminate(); run.worker = null; DOE.active.delete(run); run.ms = performance.now() - t0; };
    w1.postMessage({ id: 1, locs: [], across: G.across, ripple: G.ripple });
  };
  w.onerror = e => { if (run.worker !== w) return; end(); Object.assign(run, { status: 'error', error: e.message || 'worker error' }); settle(); };
  w.postMessage(cfdWorkerMessage(geo, geo.solver, true, true));
}
function stopDOE() {
  if (DOE.status !== 'running') return;
  for (const r of DOE.runs) {
    if (r.worker) { r.worker.terminate(); r.worker = null; }
    if (r.status === 'running' || r.status === 'pending') r.status = 'stopped';
  }
  DOE.active.clear(); DOE.status = 'stopped'; DOE.t1 = Date.now();
  logCFD(DOE.loc, `DOE stopped: ${DOE.runs.filter(r => r.status === 'done').length} of ${DOE.runs.length} runs solved`, 'warn');
  renderDOE();
}
const doeClock = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
/** A run's time here: the locations' last solves, else 9 s. */
const doeRunSeconds = () => { if (DOE.mode === 'furn') return typeof FURN !== 'undefined' && FURN.ms ? FURN.ms / 1000 : 5; if (DOE.mode === 'mix') return typeof MIX !== 'undefined' && MIX.ms ? MIX.ms / 1000 : 1; const t = cfdRuns.filter(r => r.elapsedMs).map(r => r.elapsedMs / 1000); return t.length ? t.reduce((a, b) => a + b, 0) / t.length : 9; };

// ---------------------------------------------------------------------
// The module: base case in the model tree; toolbar, plots in the viewport, design and runs in the dock
// ---------------------------------------------------------------------
function viewDOE() {
  // (the first visit makes the default design: not an unsaved change)
  if (!DOE.factors) { const clean = PROJ.savedKey != null && !projDirty(); DOE.factors = DOE.mode === 'furn' ? [doeNewFactor('r2x', DOE.loc), doeNewFactor('plateW', DOE.loc)] : DOE.mode === 'mix' ? doeMixFirst() : [doeNewFactor('U', DOE.loc), doeNewFactor('mu', DOE.loc)]; if (clean) PROJ.savedKey = projKey(); }
  const i = DOE.loc, s = solverOf(i), own = Object.keys(CFD_LOCS[i].over);
  const row = (l, v) => `<div class="prop prop-ro"><span class="prop-l">${l}</span><span class="prop-v">${v}</span></div>`;
  document.getElementById('setupExtra').innerHTML = `
    <div class="tree-sep">DOE base case</div>
    <details class="grp cfd-grp" open><summary>From 2D CFD</summary>
      ${row('Location', `L${i + 1} · z ${CFD_LOCS[i].z} mm`)}
      ${row('Gap at the edge', `${locInput(i, 'gap').toFixed(3)} mm`)}
      ${row('Contact angle', `${locInput(i, 'th').toFixed(1)}°`)}
      ${row('Blade', CFDG.shape === 'round' ? `round entry R ${CFDG.R} mm, pool ${CFDG.pool} mm` : bladeText())}
      ${row('Exit face', `${CFDG.exitAngle}°`)}
      ${row('Rheology', RHEO_MODELS[CFDG.model].l)}
      ${row('Fibre', FIBRES[CFDG.fibre].l)}
      ${row('Mesh', `${MESH_PRESETS[s.mesh].l}, tolerance ${fmtTol(s.tol)}`)}
      <p class="prop-note">The inputs above the line and these settings are the base case: every run uses them except the factors it varies.${own.length ? ` Location ${i + 1} has its own ${own.map(k => LOC_INPUTS.find(q => q.k === k).l.toLowerCase()).join(', ')}.` : ''}</p>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="doeToCfd">${uiIco(4)}Edit in 2D CFD</button></div>
    </details>`;
  document.getElementById('doeToCfd').onclick = () => { tab = 4; render(); };
  if (DOE.mode === 'mix') {
    // (the mixer's base case: the recipe and the program on the Mixing tab, the slurry and its flow law on Materials)
    const m = mixIn(), st = m.steps || [];
    document.getElementById('setupExtra').innerHTML = `<div class="tree-sep">DOE base case</div>
      <details class="grp cfd-grp" open><summary>From the mixer</summary>
        ${row('The batch', `${(+m.mPaste).toFixed(1)} kg GO paste, ${(+m.mWat + +m.mSoak).toFixed(1)} kg water`)}
        ${st.map((q, k) => row(q.name || `Step ${k + 1}`, `${q.min} min · arm ${q.No} rpm · disc ${q.Nd ? `${q.Nd} rpm` : 'off'}`)).join('')}
        <p class="prop-note">Every run is the mixer's 1D batch, its factors set; everything else as on the Mixing tab and Materials.</p>
        <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="doeToMix">${uiIco('drop')}Open the mixer</button></div>
      </details>`;
    document.getElementById('doeToMix').onclick = () => navGo('mix');
    const tn = document.getElementById('treeNote'); if (tn) tn.textContent = 'The mixer\'s DOE starts from the mixer as set on the Mixing tab (its base case) and varies its program\'s steps: their disc and arm speeds and their times.';
  }
  if (DOE.mode === 'furn') {
    // (the furnace's base case: the film's piece, the runs and the stack as set on Process, the Furnace card)
    const q = typeof furnInputs === 'function' ? furnInputs() : null, fu = OVEN.furn;
    document.getElementById('setupExtra').innerHTML = `<div class="tree-sep">DOE base case</div>
      <details class="grp cfd-grp" open><summary>From the furnace</summary>
        ${row('The piece', q ? `${dryFilmName(q.key).replace(/^the /, '')}, ${(q.P.h * 1e6).toFixed(0)} µm` : 'not solved yet (Cutting)')}
        ${[0, 1].map(r => row(FURN_RUNS[r], fu.runs[r].file ? `your file ${dryEsc(fu.runs[r].file.name)}` : fu.runs[r].steps.map(st => `${st.rate} °C/min to ${st.to} °C`).join(', '))).join('')}
        ${row('The stack', `${fu.N} pieces, ${fu.plateW} kg on it, ${fu.room === 'gap' ? `${fu.gap} mm gap` : 'the plate above on it'}, ${fu.ends === 'papers' ? 'its ends on papers' : `its ends on the plates (${fu.plateT} mm)`}`)}
        <p class="prop-note">Every run is the furnace for the film's piece as it is (the flow is not solved again), its factors set; everything else as on the Furnace tab and the Furnace card.</p>
        <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="doeToFurn">${uiIco(12)}Open the furnace</button></div>
      </details>`;
    document.getElementById('doeToFurn').onclick = () => navGo('furn', 'setup');
    const tn = document.getElementById('treeNote'); if (tn) tn.textContent = 'The furnace\'s DOE starts from the furnace as set on the Furnace tab (its base case) and varies the factors of its Design tab, for the film\'s piece as it is.';
  }
  const dockTab = (k, t) => `<button type="button" role="tab" data-dock="${k}" aria-selected="${DOE.dock === k}" aria-controls="doe-${k}">${uiIco(DOCK_ICON[k])}${t}${['problems', 'history', 'msgs'].includes(k) ? `<span class="tab-n" data-n="${k}"></span>` : ''}</button>`;
  view.innerHTML = `
    <div class="cfd-wb doe-wb" id="doeWb" style="--dock-h: ${dockHCss(DOE.dockH)}">
      <div class="vp-bar" role="toolbar" aria-label="DOE">${subTabs()}
        <button id="doeRun" class="btn btn-primary btn-sm tool-run" type="button" title="Solve every combination of the factor levels"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10l8-5z" fill="currentColor"/></svg>Run DOE</button>
        <button id="doeStop" class="tool-btn tool-stop" type="button" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg>Stop</button>
        <span class="vp-sep" aria-hidden="true"></span>
        <div class="seg seg-sm" role="tablist" aria-label="Which DOE" id="doeMode">${[['mix', 'Mixing DOE'], ['coat', 'Coating DOE'], ['furn', 'Furnace DOE']].map(([k, t]) => `<button type="button" role="tab" data-doemode="${k}" aria-selected="${k === DOE.mode}">${t}</button>`).join('')}</div>
        <label class="vp-ctl"${DOE.mode !== 'coat' ? ' hidden' : ''}>Location <select id="doeLoc">${CFD_LOCS.map((l, k) => `<option value="${k}"${k === DOE.loc ? ' selected' : ''}>L${l.id} · z ${l.z} mm</option>`).join('')}</select></label>
        <label class="vp-ctl" title="Runs solved at the same time (each uses one processor core)"${DOE.mode === 'mix' ? ' hidden' : ''}>At a time <select id="doeWorkers">${[1, 2, 3, 4, 6, 8].map(n => `<option value="${n}"${n === DOE.workers ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <span class="doe-status" id="doeStatus" role="status"></span>
        <span class="vp-spacer"></span>
        <button class="tool-btn" type="button" id="doeCsv" title="Export the runs as CSV"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>CSV</button>
        ${aboutButton()}
      </div>
      <div class="viewport" id="doeViewport">
        <div class="fv-bar doe-plotbar" id="doePlotBar"></div>
        <div class="live-res" id="doeLive" hidden><div class="xl-chart"><canvas role="img" aria-label="Newton residuals of the runs solving"></canvas></div><div class="xl-legend" id="doeLiveLegend"></div></div>
        <div class="doe-plots" id="doePlots"></div>
        <div class="xl-legend mod-legend" id="doeLegend"></div>
      </div>
      <div class="split split-h" id="doeSplit" role="separator" aria-orientation="horizontal" aria-label="Resize the DOE panel" tabindex="0"></div>
      <section class="dock" aria-label="DOE design and runs">
        <div class="dock-tabs" role="tablist" aria-label="DOE">${dockTab('design', 'Design')}${dockTab('runs', 'Runs')}${dockTab('problems', 'Problems')}${dockTab('msgs', 'Messages')}${dockTab('history', 'History')}</div>
        <div class="dock-body">
          <div class="dock-panel" id="doe-design" role="tabpanel"${DOE.dock === 'design' ? '' : ' hidden'}></div>
          <div class="dock-panel" id="doe-runs" role="tabpanel"${DOE.dock === 'runs' ? '' : ' hidden'}></div>
          <div class="dock-panel" id="doe-problems" role="tabpanel"${DOE.dock === 'problems' ? '' : ' hidden'}><div class="problems-host"></div></div>
          <div class="dock-panel" id="doe-msgs" role="tabpanel"${DOE.dock === 'msgs' ? '' : ' hidden'}>${msgsBar()}<div class="msg-log" role="log"></div></div>
          <div class="dock-panel" id="doe-history" role="tabpanel"${DOE.dock === 'history' ? '' : ' hidden'}><div class="history-host"></div></div>
        </div>
      </section>
    </div>`;
  document.getElementById('doeRun').onclick = runDOE;
  document.getElementById('doeStop').onclick = stopDOE;
  document.getElementById('doeLoc').onchange = e => { DOE.loc = +e.target.value; viewDOE(); };
  document.querySelectorAll('#doeMode [data-doemode]').forEach(b => { b.onclick = () => doeSetMode(b.dataset.doemode); });
  document.getElementById('doeWorkers').onchange = e => { DOE.workers = +e.target.value; doePump(); renderDOE(); };
  document.getElementById('doeCsv').onclick = exportDOE;
  document.querySelectorAll('#doeWb .dock-tabs button').forEach(b => {
    b.onclick = () => {
      DOE.dock = b.dataset.dock;
      document.querySelectorAll('#doeWb .dock-tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
      document.querySelectorAll('#doeWb .dock-panel').forEach(p => { p.hidden = p.id !== 'doe-' + DOE.dock; });
    };
  });
  const sp = document.getElementById('doeSplit'), wb = document.getElementById('doeWb');
  const setH = h => { DOE.dockH = Math.round(Math.max(140, Math.min(wb.clientHeight - 220, h))); wb.style.setProperty('--dock-h', DOE.dockH + 'px'); };
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = dockHNow(DOE.dockH, wb);
    const move = ev => setH(h0 - (ev.clientY - y0));
    const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); renderDOEPlots(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setH(dockHNow(DOE.dockH, wb) + (e.key === 'ArrowUp' ? 30 : -30)); renderDOEPlots(); } });
  renderDOE();
}

/** Everything that follows the DOE's state (the module showing, else nothing). */
function renderDOE() {
  if (!document.getElementById('doeWb')) return;
  const running = DOE.status === 'running';
  document.getElementById('doeRun').hidden = running;
  document.getElementById('doeStop').hidden = !running;
  document.getElementById('doeLoc').disabled = running;
  doeStatusLine();
  renderDOEDesign();
  renderDOERuns();
  renderDOEPlots();
  renderProblems();
  renderHistory();
  renderMessages(); renderDockCounts();
  markInvalidInputs();
  applyHelp();
  updateProjectTitle();
}
function doeStatusLine() {
  const el = document.getElementById('doeStatus');
  if (!el) return;
  const n = DOE.runs.length, done = DOE.runs.filter(r => r.status === 'done').length, bad = DOE.runs.filter(r => r.status === 'error').length;
  const stale = DOE.key && DOE.key !== doeBaseKey();
  if (DOE.status === 'running') {
    const el0 = Date.now() - DOE.t0, per = done + bad ? el0 / (done + bad) : doeRunSeconds() * 1000 / DOE.workers;
    el.innerHTML = `<i class="spin" aria-hidden="true"></i>${done + bad} of ${n} runs · ${DOE.active.size} solving${bad ? ` · <span class="warn-text">${bad} failed</span>` : ''} · ${doeClock(el0)}, about ${doeClock(per * (n - done - bad))} left`;
  } else if (n) {
    el.innerHTML = `${done} of ${n} runs solved${bad ? ` · <span class="warn-text">${bad} failed</span>` : ''}${DOE.status === 'stopped' ? ' · stopped' : ''} · ${doeClock(DOE.t1 - DOE.t0)}${stale ? ' · <span class="warn-text">the base case has changed since</span>' : ''}`;
  } else el.textContent = `${doeRunCount()} runs planned`;
  // (the runs table's status cells, while solving)
  for (const r of DOE.runs) { const c = document.querySelector(`#doe-runs [data-rs="${r.n}"]`); if (c) c.textContent = doeRunState(r); }
}
const doeRunState = r => r.status === 'running' ? `${r.live ? `${((performance.now() - r.live.t0) / 1000).toFixed(0)} s · ` : ''}${r.progress ? `solving · ${cfdStageText(r.progress.stage)}` : 'starting…'}`
  : r.status === 'done' ? `${(r.ms / 1000).toFixed(1)} s` : r.status === 'error' ? `failed: ${r.error}` : r.status === 'stopped' ? 'stopped' : 'waiting';

function renderDOEDesign() {
  const host = document.getElementById('doe-design');
  if (!host) return;
  const running = DOE.status === 'running', used = new Set(DOE.factors.map(fs => fs.k));
  const FS = doeFactors(), groups = [...new Set(FS.map(f => f.g))];
  const pickOpts = cur => groups.map(g => `<optgroup label="${g}">${FS.filter(f => f.g === g).map(f => `<option value="${f.k}"${f.k === cur ? ' selected' : ''}${(f.k !== cur && used.has(f.k)) || !doeAvailable(f) ? ' disabled' : ''}>${f.l}${f.u ? ` (${f.u})` : ''}${doeAvailable(f) ? '' : ' — not used now'}</option>`).join('')}</optgroup>`).join('');
  const rows = DOE.factors.map((fs, m) => {
    const f = doeFactor(fs.k), off = !doeAvailable(f), dis = running ? ' disabled' : '';
    const levels = doeLevels(fs).map(v => doeFmt(f, v)).join(' · ');
    const mid = f.cat
      ? `<td colspan="3">${f.cat.map(v => `<label class="fv-chk"><input type="checkbox" data-fcat="${m}" value="${v}"${fs.vals.includes(v) ? ' checked' : ''}${dis}> ${f.cl(v)}</label>`).join(' ')}</td>`
      : `<td><input type="number" data-fmin="${m}" id="doe_fmin_${m}" step="any" min="${f.lo}" max="${f.hi}" value="${fs.min}"${dis} aria-label="${f.l}: from"></td>
         <td><input type="number" data-fmax="${m}" id="doe_fmax_${m}" step="any" min="${f.lo}" max="${f.hi}" value="${fs.max}"${dis} aria-label="${f.l}: to"></td>
         <td><select data-fn="${m}"${dis} aria-label="${f.l}: levels">${[2, 3, 4, 5].map(n => `<option value="${n}"${n === fs.n ? ' selected' : ''}>${n}</option>`).join('')}</select></td>`;
    return `<tr${off ? ' class="is-off"' : ''}><th scope="row"><select data-fk="${m}"${dis} aria-label="Factor ${m + 1}">${pickOpts(fs.k)}</select>${off ? '<small class="warn-text">not used by the current model or blade: left out</small>' : ''}</th>${mid}
      <td class="mono doe-levels">${levels}</td>
      <td class="case-act"><button type="button" class="btn btn-secondary btn-sm" data-fdel="${m}"${DOE.factors.length < 2 || running ? ' disabled' : ''}>${uiIco('trash')}Remove</button></td></tr>`;
  }).join('');
  const N = doeRunCount(), t = doeRunSeconds(), est = DOE.mode === 'mix' ? N * t : N * t / Math.min(DOE.workers, N) * (DOE.workers > 1 ? 1.25 : 1);
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table doe-ftable"><thead><tr><th>Factor</th><th>From</th><th>To</th><th>Levels</th><th>Values</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="fv-bar doe-addbar"><button type="button" class="btn btn-secondary btn-sm" id="doeAdd"${DOE.factors.length >= 3 || running ? ' disabled' : ''}>${uiIco('plus')}Add factor</button>
      <span class="fv-why"><b>${N} runs</b> (every combination) ${DOE.mode === 'furn' ? 'of the furnace, for the film\'s piece as it is' : DOE.mode === 'mix' ? 'of the mixer\'s batch' : `at location ${DOE.loc + 1}`}: about ${doeClock(est * 1000)}${DOE.mode === 'mix' ? ', one after another' : ` with ${DOE.workers} at a time`}, a run taking about ${t.toFixed(0)} s here. Up to three factors, 2 to 5 levels each, evenly spaced.</span></div>`;
  host.querySelectorAll('[data-fk]').forEach(el => el.addEventListener('change', () => { DOE.factors[+el.dataset.fk] = doeNewFactor(el.value, DOE.loc); renderDOE(); }));
  const num = (sel, key) => host.querySelectorAll(sel).forEach(el => el.addEventListener('change', () => {
    const fs = DOE.factors[+el.dataset[key]], f = doeFactor(fs.k);
    guardNumber(el, { label: `${f.l}, ${key === 'fmin' ? 'from' : 'to'}`, lo: f.lo, hi: f.hi, unit: f.u }, v => { fs[key === 'fmin' ? 'min' : 'max'] = +v.toFixed(f.d + 2); });
    if (!(fs.max > fs.min)) { const t2 = fs.min; fs.min = Math.min(t2, fs.max); fs.max = Math.max(t2, fs.max); if (fs.max === fs.min) fs.max = +(fs.min + Math.max(1e-3, Math.abs(fs.min) * 0.1)).toFixed(f.d + 2); }
    renderDOE();
  }));
  num('[data-fmin]', 'fmin'); num('[data-fmax]', 'fmax');
  host.querySelectorAll('[data-fn]').forEach(el => el.addEventListener('change', () => { DOE.factors[+el.dataset.fn].n = +el.value; renderDOE(); }));
  host.querySelectorAll('[data-fcat]').forEach(el => el.addEventListener('change', () => {
    const fs = DOE.factors[+el.dataset.fcat], f = doeFactor(fs.k);
    const vals = [...host.querySelectorAll(`[data-fcat="${el.dataset.fcat}"]:checked`)].map(x => f.cat.find(c => String(c) === x.value));
    if (vals.length >= 2) fs.vals = vals; else el.checked = true;   // (at least two levels)
    renderDOE();
  }));
  host.querySelectorAll('[data-fdel]').forEach(b => { b.onclick = () => { DOE.factors.splice(+b.dataset.fdel, 1); renderDOE(); }; });
  const add = host.querySelector('#doeAdd');
  if (add) add.onclick = () => {
    const f = doeFactors().find(x => doeAvailable(x) && !DOE.factors.some(fs => fs.k === x.k));
    if (f) { DOE.factors.push(doeNewFactor(f.k, DOE.loc)); renderDOE(); }
  };
}

function renderDOERuns() {
  const host = document.getElementById('doe-runs');
  if (!host) return;
  if (!DOE.runs.length) { host.innerHTML = '<p class="cap">No runs yet: set the factors in Design, then Run DOE.</p>'; return; }
  const d = DOE.design;
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table doe-rtable"><thead><tr><th>Run</th>${d.map(x => `<th>${x.f.l}${x.f.u ? `<small>${x.f.u}</small>` : ''}</th>`).join('')}${doeOutputsNow().map(o => `<th>${o.l}${o.u ? `<small>${o.u}</small>` : ''}</th>`).join('')}<th>Status</th></tr></thead><tbody>
    ${DOE.runs.map(r => `<tr><th scope="row">${r.n + 1}</th>${r.vals.map((v, m) => `<td>${doeFmt(d[m].f, v)}</td>`).join('')}${doeOutputsNow().map(o => `<td>${r.out && Number.isFinite(r.out[o.k]) ? r.out[o.k].toFixed(o.d) : '—'}</td>`).join('')}<td data-rs="${r.n}"${r.status === 'error' ? ' class="warn-text"' : ''}>${doeRunState(r)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function exportDOE() {
  if (!DOE.runs.length) return;
  const d = DOE.design, unit = u => u ? `_${u.replace(/[^A-Za-z0-9]+/g, '_')}` : '';
  const OS = doeOutputsNow(), rows = [['run', ...d.map(x => x.f.k + unit(x.f.u)), ...OS.map(o => o.k + unit(o.u)), 'status', 'seconds']];
  for (const r of DOE.runs) rows.push([r.n + 1, ...r.vals, ...OS.map(o => r.out ? r.out[o.k] : ''), r.status === 'error' ? `failed: ${r.error}` : r.status, r.ms ? r.ms / 1000 : '']);
  downloadCSV(`doe-${DOE.mode === 'furn' ? 'furnace' : DOE.mode === 'mix' ? 'mixer' : `L${DOE.loc + 1}`}-${csvStamp()}.csv`, rows);
}

// ---------------------------------------------------------------------
// Plots: response (lines), response map (cells), main effects
// ---------------------------------------------------------------------
const doeColor = n => n < 4 ? locColor(n) : CUT_COLORS[isDarkTheme() ? 'dark' : 'light'][n - 4];
function renderDOEPlots() {
  const bar = document.getElementById('doePlotBar'), host = document.getElementById('doePlots'), lg = document.getElementById('doeLegend');
  if (!bar) return;
  const d = DOE.design, done = DOE.runs.filter(r => r.status === 'done');
  const OS = doeOutputsNow();
  if (!OS.some(x => x.k === DOE.out)) DOE.out = OS[0].k;
  const o = OS.find(x => x.k === DOE.out);
  const opt = (v, t, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`;
  const outSel = `<label class="fv-ctl">Output <select id="doeOut">${[...new Set(OS.map(x => x.g))].map(g => `<optgroup label="${g}">${OS.filter(x => x.g === g).map(x => opt(x.k, x.l, DOE.out)).join('')}</optgroup>`).join('')}</select></label>`;
  const seg = `<div class="seg" role="tablist" aria-label="Plot" id="doePlotSeg">${[['response', 'Response'], ['map', 'Response map'], ['effects', 'Main effects']].map(([k, t]) => `<button type="button" role="tab" data-p="${k}" aria-selected="${DOE.plot === k}"${k === 'map' && d && d.length < 2 ? ' disabled title="needs two factors"' : ''}>${t}</button>`).join('')}</div>`;
  const facSel = (id, cur, label) => d ? `<label class="fv-ctl">${label} <select id="${id}">${d.map((x, m) => opt(m, x.f.l, cur)).join('')}</select></label>` : '';
  if (DOE.plot === 'map' && d && d.length < 2) DOE.plot = 'response';
  bar.innerHTML = seg + outSel + (DOE.plot === 'response' ? facSel('doeX', DOE.x, 'Along') : DOE.plot === 'map' ? facSel('doeMX', DOE.mx, 'Across') + facSel('doeMY', DOE.my, 'Up') : '');
  bar.querySelectorAll('#doePlotSeg button').forEach(b => { b.onclick = () => { DOE.plot = b.dataset.p; renderDOEPlots(); }; });
  bar.querySelector('#doeOut').onchange = e => { DOE.out = e.target.value; renderDOEPlots(); };
  const bind = (id, key) => { const el = bar.querySelector('#' + id); if (el) el.onchange = () => { DOE[key] = +el.value; if (key === 'mx' && DOE.mx === DOE.my) DOE.my = DOE.mx ? 0 : 1; if (key === 'my' && DOE.my === DOE.mx) DOE.mx = DOE.my ? 0 : 1; renderDOEPlots(); }; };
  bind('doeX', 'x'); bind('doeMX', 'mx'); bind('doeMY', 'my');
  lg.innerHTML = '';
  drawDOELive();
  if (!d || !done.length) {
    host.innerHTML = DOE.status === 'running' ? '' : emptyHint('No DOE results yet',
      `Choose 1 to 3 factors and their levels in the Design tab below: every combination is solved ${DOE.mode === 'furn' ? 'in the furnace, for the film\'s piece as it is' : DOE.mode === 'mix' ? 'in the mixer\'s 1D batch' : `in the CFD at location ${DOE.loc + 1}`} (${doeRunCount()} runs now, ${DOE.mode === 'mix' ? 'about a second each, one after another' : `a few seconds each, ${DOE.workers} at a time`}).`,
      `<button type="button" class="btn btn-primary btn-sm" data-hint-doe>${uiIco('play')}Run DOE</button><button type="button" class="btn btn-secondary btn-sm" data-hint-design>${uiIco('doe')}Open the design</button>`);
    const r = host.querySelector('[data-hint-doe]'); if (r) r.onclick = runDOE;
    const g = host.querySelector('[data-hint-design]'); if (g) g.onclick = () => { DOE.dock = 'design'; setPanelHidden('dock', false); };
    return;
  }
  const val = r => r.out[o.k], ok = done.filter(r => Number.isFinite(val(r)));
  if (!ok.length) { host.innerHTML = `<p class="cap fv-empty">No run has a value for ${o.l.toLowerCase()}.</p>`; return; }
  let lo = Math.min(...ok.map(val)), hi = Math.max(...ok.map(val));
  if (!(hi > lo)) { const m = Math.abs(lo) || 1; lo -= 0.05 * m; hi += 0.05 * m; }
  const pad = 0.08 * (hi - lo), y0 = lo >= 0 && lo - pad < 0 ? 0 : lo - pad, y1 = hi + pad;
  const yd = Math.max(0, Math.min(4, 2 - Math.floor(Math.log10(hi - lo || 1))));
  const xpos = (x, v) => x.f.cat ? x.levels.indexOf(v) : v;
  const xspan = x => { const p = x.levels.map(v => xpos(x, v)), a = Math.min(...p), b = Math.max(...p), m = (b - a) * 0.06 || 0.5; return [a - m, b + m]; };
  const yLabel = `${o.l}${o.u ? ` (${o.u})` : ''}`;
  const figs = cap => `<figure class="pane"><figcaption>${uiBadge(DOE_PLOT_ICON[DOE.plot] || 7)}${cap}</figcaption><div class="xl-chart"><canvas role="img" aria-label="${cap}"></canvas><div class="xl-guide" hidden></div><div class="fv-tip" hidden></div></div></figure>`;
  const layout = (n, caps) => {
    const cols = Math.min(n, 3), rows = Math.ceil(n / cols);
    host.style.setProperty('--cols', cols);
    host.innerHTML = caps.map(figs).join('');
    // (the room a canvas has: the pane's padding, caption and gaps taken off)
    const avail = (host.clientHeight - 10 * (rows - 1)) / rows - 62, w = host.querySelector('.xl-chart').clientWidth || 400;
    return { aspect: Math.max(0.25, Math.min(0.62, avail / w)), cvs: [...host.querySelectorAll('canvas')] };
  };
  if (DOE.plot === 'response') {
    const xi = Math.min(DOE.x, d.length - 1), x = d[xi], others = d.filter((_, m) => m !== xi);
    const sf = others[0], pf = others[1], sfi = d.indexOf(sf), pfi = d.indexOf(pf), xiI = xi;
    const panels = pf ? pf.levels : [null];
    const { aspect, cvs } = layout(panels.length, panels.map(pv => pf ? `${pf.f.l} ${doeFmt(pf.f, pv)}${pf.f.u ? ' ' + pf.f.u : ''}` : yLabel));
    const [x0, x1] = xspan(x);
    panels.forEach((pv, k) => {
      const inPanel = ok.filter(r => !pf || r.vals[pfi] === pv);
      const series = (sf ? sf.levels : [null]).map((sv, n) => {
        const pts = inPanel.filter(r => !sf || r.vals[sfi] === sv).map(r => [xpos(x, r.vals[xiI]), val(r)]).sort((a, b) => a[0] - b[0]);
        return { pts, color: sf ? doeColor(n) : cssVar('--accent'), name: sf ? `${sf.f.l} ${doeFmt(sf.f, sv)}${sf.f.u ? ' ' + sf.f.u : ''}` : o.l, short: sf ? doeFmt(sf.f, sv) : '' };
      }).filter(s => s.pts.length);
      const map = plotChart(cvs[k], aspect, { x0, x1, y0, y1, xl: doeLabel(x.f), yl: yLabel, yd, xticks: x.levels.map(v => xpos(x, v)), xf: p => doeFmt(x.f, x.f.cat ? x.levels[Math.round(p)] : p),
        s: series.map(s => ({ p: s.pts, c: s.color, w: 2, dots: true })) });
      if (sf) endLabels(cvs[k], map, series);
      doeHover(cvs[k], map, x, series.map(s => ({ ...s, get: p => (s.pts.find(q => Math.abs(q[0] - p) < 1e-9) || [])[1] })), o);
    });
    if (sf) lg.innerHTML = (sf.levels.map((sv, n) => `<span class="lg"><i class="xl-sw" style="background:${doeColor(n)}"></i>${sf.f.l} ${doeFmt(sf.f, sv)}${sf.f.u ? ' ' + sf.f.u : ''}</span>`).join(''));
  } else if (DOE.plot === 'map') {
    const mx = Math.min(DOE.mx, d.length - 1), my = DOE.my === mx ? (mx ? 0 : 1) : Math.min(DOE.my, d.length - 1);
    const X = d[mx], Y = d[my], pf = d.find((_, m) => m !== mx && m !== my), pfi = d.indexOf(pf);
    const panels = pf ? pf.levels : [null];
    const { aspect, cvs } = layout(panels.length, panels.map(pv => pf ? `${pf.f.l} ${doeFmt(pf.f, pv)}${pf.f.u ? ' ' + pf.f.u : ''}` : yLabel));
    panels.forEach((pv, k) => drawDOEMap(cvs[k], aspect, X, Y, ok.filter(r => !pf || r.vals[pfi] === pv), d.indexOf(X), d.indexOf(Y), val, lo, hi, o));
  } else {
    // main effects: each factor's mean output at each of its levels, over all the other factors' levels
    const { aspect, cvs } = layout(d.length, d.map(x => x.f.l));
    const grand = ok.reduce((a, r) => a + val(r), 0) / ok.length;
    const means = d.map((x, m) => x.levels.map(v => { const at = ok.filter(r => r.vals[m] === v); return at.length ? [xpos(x, v), at.reduce((a, r) => a + val(r), 0) / at.length] : null; }).filter(Boolean));
    const mlo = Math.min(...means.flat().map(p => p[1]), grand), mhi = Math.max(...means.flat().map(p => p[1]), grand), mp = 0.1 * (mhi - mlo || Math.abs(mhi) || 1);
    d.forEach((x, m) => {
      const [x0, x1] = xspan(x), s = [{ pts: means[m], color: cssVar('--accent'), name: `mean ${o.l.toLowerCase()}` }];
      const map = plotChart(cvs[m], aspect, { x0, x1, y0: mlo - mp, y1: mhi + mp, xl: doeLabel(x.f), yl: m === 0 ? yLabel : '', yd, xticks: x.levels.map(v => xpos(x, v)), xf: p => doeFmt(x.f, x.f.cat ? x.levels[Math.round(p)] : p),
        hl: [{ y: grand, c: cssVar('--muted'), t: 'mean of all runs' }], s: [{ p: means[m], c: cssVar('--accent'), w: 2, dots: true }] });
      doeHover(cvs[m], map, x, s.map(q => ({ ...q, get: p => (q.pts.find(t => Math.abs(t[0] - p) < 1e-9) || [])[1] })), o);
    });
    lg.innerHTML = `<span class="fv-why">Each point: the mean of “${o.l}” over the runs at that level (all the other factors' levels). The steeper the line, the stronger the factor.</span>`;
  }
}
/** The runs solving: their residuals so far, over the plots (in their place before the first result). */
function drawDOELive() {
  const box = document.getElementById('doeLive');
  if (!box) return;
  const runs = DOE.status === 'running' ? DOE.runs.filter(r => r.status === 'running' && r.live) : [];
  const was = box.hidden;
  box.hidden = !runs.length;
  if (!runs.length) return;
  const big = !DOE.runs.some(r => r.status === 'done');
  box.classList.toggle('big', big);
  if (was) return renderDOEPlots();   // (it takes room from the plots: lay them out again)
  const name = r => `run ${r.n + 1}: ${r.vals.map((v, m) => doeFmt(DOE.design[m].f, v) + (DOE.design[m].f.u ? ' ' + DOE.design[m].f.u : '')).join(', ')}`;
  const w = box.clientWidth || 600, h = big ? Math.max(160, box.clientHeight - 30) : 130;
  drawLiveResiduals(box.querySelector('canvas'), h / w, runs.map(r => ({ name: name(r), short: `#${r.n + 1}`, color: doeColor(r.slot), live: r.live })));
  document.getElementById('doeLiveLegend').innerHTML = runs.map(r => `<span class="lg"><i class="xl-sw" style="background:${doeColor(r.slot)}"></i>${name(r)} · ${((performance.now() - r.live.t0) / 1000).toFixed(0)} s</span>`).join('');
}
/** Hover: the level nearest the pointer and each line's value there. */
function doeHover(cv, map, x, series, o) {
  const wrap = cv.parentElement, tip = wrap.querySelector('.fv-tip'), guide = wrap.querySelector('.xl-guide');
  const pos = x.levels.map(v => x.f.cat ? x.levels.indexOf(v) : v);
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < map.rect.l || px > map.rect.r || py < map.rect.t || py > map.rect.b) { tip.hidden = guide.hidden = true; return; }
    const t = map.invX(px), j = pos.reduce((b, p, k) => Math.abs(p - t) < Math.abs(pos[b] - t) ? k : b, 0), p = pos[j];
    const rows = series.map(s => { const v = s.get(p); return v == null ? '' : `<span><i class="xl-sw" style="background:${s.color}"></i>${s.name}: ${v.toFixed(o.d)} ${o.u}</span>`; }).join('');
    if (!rows) { tip.hidden = guide.hidden = true; return; }
    tip.innerHTML = `<b>${x.f.l} ${doeFmt(x.f, x.levels[j])}${x.f.u ? ' ' + x.f.u : ''}</b>${rows}`;
    tip.hidden = guide.hidden = false;
    const gx = map.X(p);
    Object.assign(guide.style, { left: gx + 'px', width: '1px', top: map.rect.t + 'px', height: (map.rect.b - map.rect.t) + 'px' });
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (gx + 14 + tw > cv.clientWidth ? gx - tw - 14 : gx + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(py + 14, cv.clientHeight - th)) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = guide.hidden = true; });
}
/** Response map: a cell per pair of levels, coloured on one sequential scale (shared by the panels), its value printed. */
function drawDOEMap(cv, aspect, X, Y, runs, xi, yi, val, lo, hi, o) {
  const { c, w, h } = setupCanvas(cv, aspect);
  const muted = cssVar('--muted'), mono = cssVar('--mono');
  const m = { l: 86, r: 70, t: 12, b: 40 }, pw = w - m.l - m.r, ph = h - m.t - m.b, nx = X.levels.length, ny = Y.levels.length;
  const cw = pw / nx, ch = ph / ny, lut = getLut('seq'), sc = { min: lo, max: hi, levels: 0 };
  c.font = `11px ${mono}`;
  const cells = [];
  X.levels.forEach((xv, a) => Y.levels.forEach((yv, b) => {
    const r = runs.find(q => q.vals[xi] === xv && q.vals[yi] === yv), x = m.l + a * cw, y = m.t + (ny - 1 - b) * ch;
    cells.push({ x, y, r, xv, yv });
    if (!r) { c.fillStyle = cssVar('--soft'); c.fillRect(x + 1, y + 1, cw - 2, ch - 2); c.fillStyle = muted; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('—', x + cw / 2, y + ch / 2); return; }
    const t = scaleT(sc, val(r)), n = Math.round(t * (LUT_N - 1)) * 3;
    c.fillStyle = `rgb(${lut[n]},${lut[n + 1]},${lut[n + 2]})`; c.fillRect(x + 1, y + 1, cw - 2, ch - 2);   // (2 px surface gaps between cells)
    const lum = (0.2126 * lut[n] + 0.7152 * lut[n + 1] + 0.0722 * lut[n + 2]) / 255;
    c.fillStyle = lum < 0.5 ? '#fff' : '#141a23'; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (cw > 40 && ch > 16) c.fillText(val(r).toFixed(o.d), x + cw / 2, y + ch / 2);
  }));
  // axes: the levels
  c.fillStyle = muted; c.textBaseline = 'alphabetic';
  X.levels.forEach((v, a) => { c.textAlign = 'center'; c.fillText(doeFmt(X.f, v), m.l + (a + 0.5) * cw, m.t + ph + 15); });
  Y.levels.forEach((v, b) => { c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(doeFmt(Y.f, v), m.l - 6, m.t + (ny - 1 - b + 0.5) * ch); });
  c.textBaseline = 'alphabetic'; c.textAlign = 'right'; c.fillText(doeLabel(X.f), m.l + pw, h - 4);
  c.save(); c.translate(12, m.t + ph / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText(doeLabel(Y.f), 0, 0); c.restore();
  // colour bar
  const bx = w - m.r + 14, bw = 10;
  for (let k = 0; k < ph; k++) { const t = 1 - k / ph, n = Math.round(t * (LUT_N - 1)) * 3; c.fillStyle = `rgb(${lut[n]},${lut[n + 1]},${lut[n + 2]})`; c.fillRect(bx, m.t + k, bw, 1.5); }
  c.fillStyle = muted; c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(hi.toFixed(o.d), bx + bw + 4, m.t + 5); c.fillText(lo.toFixed(o.d), bx + bw + 4, m.t + ph - 5);
  // hover: the cell's run
  const wrap = cv.parentElement, tip = wrap.querySelector('.fv-tip');
  cv.addEventListener('pointermove', e => {
    const rr = cv.getBoundingClientRect(), px = e.clientX - rr.left, py = e.clientY - rr.top;
    const cell = cells.find(q => px >= q.x && px < q.x + cw && py >= q.y && py < q.y + ch);
    if (!cell) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${X.f.l} ${doeFmt(X.f, cell.xv)} · ${Y.f.l} ${doeFmt(Y.f, cell.yv)}</b><span>${cell.r ? `${o.l}: ${val(cell.r).toFixed(o.d)} ${o.u} (run ${cell.r.n + 1})` : 'not solved'}</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (px + 14 + tw > cv.clientWidth ? px - tw - 14 : px + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(py + 14, cv.clientHeight - th)) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
}
