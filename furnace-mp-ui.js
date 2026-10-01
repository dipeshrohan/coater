/*
 * furnace-mp-ui.js — MP-2 on the Furnace page: its fourth step, Multiphysics. The furnace's stack solved in 1D, 2D or 3D
 * (furnace-mp.js in cfd-mp-worker.js): its heat from the hot zone (the holder's plates, the papers, the pieces), the GO's
 * chemistry at every point at its own temperature with its heat, each piece's gas along its paper and across it, and each
 * followed piece's pull where it converts unevenly -- together.
 *
 * The page: the solver's bar (the dimension, Solve, where it stands), the model (domain, mesh, equations, faces, coupling,
 * balance), the answers (tiles), a run's temperatures, oxygen, gas and pull against time, a field on a section at a chosen
 * moment, and the same answers against the Results step (furnace.js: every piece at the program's temperature). 1D and 2D
 * solve by themselves when shown; 3D on Solve (about two minutes: the GO's runaway is followed in short steps).
 */
const FMS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, field: 'T', snap: null, run: 0, again: null };

/** The key moments of the runs (s from the first run's start): run 1 as its program passes 150, 200, 250 and 300 °C and
 *  reaches its top; run 2 at 1000 °C, 2000 °C and its top. */
function fmpSnapTimes(runs) {
  const out = []; let off = 0;
  runs.forEach((pts, r) => {
    const Tmax = Math.max(...pts.map(p => p[1])) - 273.15, marks = (r === 0 ? [150, 200, 250, 300] : [1000, 2000]).filter(m => m < Tmax - 1).concat([Tmax]);
    for (const Tc of marks) for (let i = 1; i < pts.length; i++) {
      const [ta, Ta] = pts[i - 1], [tb, Tb] = pts[i], K = Tc + 273.15 - 1e-6;
      if (Ta < K && Tb >= K) { out.push(off + ta + (K - Ta) / (Tb - Ta) * (tb - ta)); break; }
    }
    off += pts[pts.length - 1][0];
  });
  return out;
}
/** The furnace's multiphysics inputs for a dimension: the furnace's own (its runs, holder, chemistry, gas, the piece going
 *  in), the Furnace card's heat rows, the Drying card's GO. */
function fmpInputs(dim) {
  const q = typeof furnInputs === 'function' ? furnInputs() : null;
  if (!q) return null;
  const fo = q.o, P = q.P, v = k => MAT.furn[k].v, d = MAT.dry, N = Math.max(1, Math.round(OVEN.furn.N)), mid = Math.floor((N - 1) / 2);
  return { dim, Lx: fo.Lx, Ly: fo.Ly, margin: fo.margin, N, h: P.h, tp: fo.paper.t, ends: fo.ends, plateT: fo.plate.t,
    go: { rho: P.rhoG, c: d.cS.v, kIn: d.kIn.v, kThr: d.kS.v, Xin: P.Xroom, ...hubDefsOf({ kInT: d.kIn, kThrT: d.kS }) },
    paper: { rho: fo.paper.rho, kIn: v('kPin'), kThr: v('kPthr'), D: fo.paper.D, ...hubDefsOf({ kInT: MAT.furn.kPin, kThrT: MAT.furn.kPthr }) }, plate: { rho: v('rhoPl') * 1000, k: v('kPl'), B: fo.plate.B, ...hubDefsOf({ kT: MAT.furn.kPl }) }, Rc: v('Rc') * 1e-4,
    runs: fo.runs, chem: fo.chem, stages: fo.stages, Hr: v('Hr') * 1e6, furnace: { eps: v('epsF'), gas: true },
    gas: { Dgal: fo.Dgal, Dmin: fo.Dmin, dIn: fo.dIn, sigZ: fo.sigZ, plateP: fo.plateP },
    plane: { Ep: fo.plane.Ep, nu: fo.plane.nu, bO: fo.plane.bO, bG: fo.plane.bG, am: fo.plane.am },
    mesh: dim === 3 ? { nx: 5, ny: 5, nm: 1, nz: 6, nPlate: 1 } : { nx: 8, nm: 2, nz: 12, nPlate: 2 },
    dT: dim === 3 ? 4 : 2, dTHigh: dim === 3 ? 20 : 10, jumpMax: dim === 3 ? 200 : 100, tol: 1e-7, follow: [0, mid, N - 1], snapUneven: true, snapTimes: fmpSnapTimes(fo.runs) };
}
const fmpKeyNow = dim => { const o = fmpInputs(dim); return o ? JSON.stringify(o) : null; };
const fmpCurrent = dim => !!FMS.res[dim] && FMS.key[dim] === fmpKeyNow(dim);
/** The followed pieces' names (0 the bottom). */
const fmpPieceName = (i, N) => (i === 0 ? (N > 1 ? 'bottom piece' : 'the piece') : i === N - 1 ? 'top piece' : 'middle piece');

/** Solve a dimension (one at a time; a request while busy runs next). */
function fmpRequest(dim) {
  const key = fmpKeyNow(dim);
  if (!key || FMS.key[dim] === key && FMS.res[dim]) return;
  if (FMS.busy) { if (FMS.pending !== key) FMS.again = dim; return; }
  const o = fmpInputs(dim);
  FMS.busy = true; FMS.bdim = dim; FMS.pending = key; FMS.prog = null; FMS.again = null;
  const id = ++FMS.id;
  if (!FMS.worker) FMS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { FMS.busy = false; FMS.pending = null; FMS.bdim = null; if (FMS.again) { const a = FMS.again; FMS.again = null; fmpRequest(a); } fmpRender(); };
  FMS.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) { FMS.prog = m.progress; fmpStatus(); return; }
    FMS.key[dim] = key;
    if (m.ok) { FMS.res[dim] = m.res; FMS.error[dim] = null; } else { FMS.res[dim] = null; FMS.error[dim] = m.error; }
    done();
  };
  FMS.worker.onerror = ev => { FMS.key[dim] = key; FMS.res[dim] = null; FMS.error[dim] = ev.message || 'the multiphysics worker failed'; FMS.worker = null; done(); };
  FMS.worker.postMessage({ id, kind: 'furnace', o });
  fmpStatus();
}
/** Stop the multiphysics solve (New, Open): its worker ended, what was asked next dropped. */
function fmpStop() {
  if (FMS.worker) { FMS.worker.terminate(); FMS.worker = null; }
  Object.assign(FMS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}
/** Wait for a dimension's solve (the report, the tests): true when solved. */
async function fmpWait(dim = FMS.dim) {
  if (typeof sheetWait === 'function' && !(await sheetWait())) return false;
  for (let k = 0; k < 12000; k++) {
    if (!FMS.busy) { if (fmpCurrent(dim)) return true; if (!fmpKeyNow(dim)) return false; if (FMS.error[dim] && FMS.key[dim] === fmpKeyNow(dim)) return false; fmpRequest(dim); }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- the page ----
function fmpHTML() {
  const pane = (id, icon, title, aria) => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="mp-sec" id="fmpSec" aria-labelledby="fmpH">
    <header class="mp-bar">
      <h4 id="fmpH">${uiBadge('mesh')}Multiphysics solver <small>heat · chemistry · gas · stress, solved together</small></h4>
      <div class="seg" role="tablist" aria-label="The solver's dimension" id="fmpDim">${Object.entries(MP_DIMS).map(([k, t]) => `<button type="button" role="tab" data-fmdim="${k}" aria-selected="${+k === FMS.dim}">${t}</button>`).join('')}</div>
      <span class="vp-spacer"></span>
      <span class="mp-state" id="fmpState" role="status"></span>
      <button type="button" class="btn btn-primary btn-sm" id="fmpSolve">${uiIco('play')}Solve</button>
      <button type="button" class="btn btn-secondary btn-sm" id="fmpCsv">Export CSV</button>
    </header>
    <div class="mp-prog" id="fmpProg" hidden><span class="mp-prog-bar"><i id="fmpProgFill"></i></span><span id="fmpProgT"></span></div>
    <div class="mp-model" id="fmpModel"></div>
    <div class="stats mp-stats" id="fmpStats"></div>
    <div class="mp-runbar"><span class="mp-runbar-l">The charts for</span><span class="seg seg-sm" role="tablist" aria-label="Which run the charts show" id="fmpRun">${FURN_RUNS.map((t, r) => `<button type="button" role="tab" data-fmrun="${r}" aria-selected="${r === FMS.run}">${t}</button>`).join('')}</span><span class="fv-why" id="fmpRunWhat"></span></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('fmp1', 'temp', 'Temperatures', 'The followed pieces\' temperatures against time in the run, with the program')}
      ${pane('fmp2', 'drop', 'Its oxygen gone', 'The share of the GO\'s oxygen gone at the followed pieces against time, with the program\'s temperature\'s')}
      ${pane('fmp3', 'weight', 'The gas against its hold', 'The gas in each followed piece\'s middle over its layers\' hold against time: past 1 they part')}
      ${pane('fmp4', 'cut', 'The pull, converting unevenly', 'The largest pull in each followed piece against time, with its strength')}
    </div>
    <figure class="pane mp-field"><figcaption>${uiBadge('mesh')}<span id="fmpFieldT">The field</span>
        <span class="vp-spacer"></span>
        <span class="seg seg-sm" role="tablist" aria-label="The field shown" id="fmpField"></span>
        <span class="seg seg-sm" role="tablist" aria-label="When" id="fmpSnap"></span></figcaption>
      <canvas id="fmp5" role="img" aria-label="The field chosen at the moment chosen"></canvas><div class="pane-legend" id="fmp5Lg"></div></figure>
    <div class="mp-compare" id="fmpCompare"></div>
  </section>`;
}
function fmpWire(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.fmdim) { FMS.dim = +t.dataset.fmdim; FMS.snap = null; fmpRender(); return; }
    if (t.dataset.fmrun) { FMS.run = +t.dataset.fmrun; fmpRender(); return; }
    if (t.dataset.fmfield) { FMS.field = t.dataset.fmfield; fmpField(); return; }
    if (t.dataset.fmsnap) { FMS.snap = +t.dataset.fmsnap; fmpField(); return; }
    if (t.id === 'fmpSolve') { fmpRequest(FMS.dim); fmpRender(); return; }
    if (t.id === 'fmpCsv') { fmpCsv(); return; }
    // (the materials it reads: the hub's readiness, the multiphysics' own opened -- MH-5)
    if (t.dataset.mat === 'furn') hubShow({ view: 'ready', ready: 'mp2' });
  });
}
function fmpStatus() {
  const el = document.getElementById('fmpState'), pr = document.getElementById('fmpProg');
  if (!el) return;
  const dim = FMS.dim, cur = fmpCurrent(dim), err = FMS.error[dim] && FMS.key[dim] === fmpKeyNow(dim), busyHere = FMS.busy && FMS.bdim === dim;
  el.innerHTML = busyHere ? pill(`Solving ${MP_DIMS[dim]}…`, '') : cur ? pill(`Solved in ${(FMS.res[dim].ms / 1000).toFixed(1)} s`, 'ok') : err ? pill('Failed', 'bad') : FMS.busy ? pill(`Solving ${MP_DIMS[FMS.bdim]} first…`, '') : pill('Not solved', 'warn');
  const sb = document.getElementById('fmpSolve');
  if (sb) { sb.disabled = busyHere || cur || !fmpKeyNow(dim); sb.title = cur ? 'Solved for the inputs as they are' : dim === 3 ? 'The 3D takes about two minutes' : ''; }
  if (pr) {
    pr.hidden = !busyHere;
    if (busyHere) { const f = FMS.prog ? FMS.prog.k / FMS.prog.n : 0; document.getElementById('fmpProgFill').style.width = `${(f * 100).toFixed(1)}%`; document.getElementById('fmpProgT').textContent = FMS.prog ? `program step ${FMS.prog.k} of ${FMS.prog.n}` : 'setting up the mesh…'; }
  }
}
/** The model: its domain and mesh, the physics solved and their faces, the coupling, the balance. */
function fmpModelHTML(o, r) {
  const fu = OVEN.furn, f = MAT.furn, d = MAT.dry, dim = o.dim, mm = v => (v * 1000).toFixed(v * 1000 < 10 ? 2 : 1);
  // (the top and bottom pieces on the holder's plates: their gas through the plate there; the 1D follows the middle piece only)
  const onPlates = o.ends === 'plates' && dim > 1 && o.plate && Number.isFinite(o.plate.B), fmpPlateB = () => `${f.Bpl.v} × 10⁻⁶ m²/s, ${mm(o.plateT)} mm thick`;
  const Hs = o.N * o.h + (o.ends === 'plates' ? o.N - 1 : o.N + 1) * o.tp;
  const dom = { 1: `Along the pieces at the stack's middle height: from the middle of a piece to its paper's edge, ${mm(o.Lx / 2 + o.margin)} mm (a tall stack's middle, heated from its side)`,
    2: `A section through the holder from the middle to its side, ${mm(o.Lx / 2 + o.margin)} × ${mm(Hs + 2 * o.plateT)} mm: the ${o.N} pieces and their papers (${mm(Hs)} mm) between two ${mm(o.plateT)} mm plates, the stack taken long across`,
    3: `A quarter of the holder, ${mm(o.Lx / 2 + o.margin)} × ${mm(o.Ly / 2 + o.margin)} × ${mm(Hs + 2 * o.plateT)} mm, on its two mirror planes` }[dim];
  const rows = [
    ['Heat', '∂H/∂t = ∇·(k ∇T) + q_chem', `the stack as its layers combined: GO k ${d.kIn.v} along, ${d.kS.v} through; paper ${f.kPin.v} along, ${f.kPthr.v} through W/(m·K); a piece's face ${f.Rc.v} × 10⁻⁴ m²·K/W; plates k ${f.kPl.v}; graphite's heat capacity with temperature`,
      dim === 1 ? `the paper's edge sees the hot zone at the program's temperature (ε ${f.epsF.v}) and the argon (natural convection); above and below, the stack goes on` : `every outer face sees the hot zone at the program's temperature (ε ${f.epsF.v}) and the argon (natural convection); between the runs the stack cools to the room`],
    ['Chemistry', 'dα/dt = Σ w A e^(−E/RT) (1 − α)', `furnace.js's stages at every point at its own temperature; the labile oxygen gives ${f.Hr.v} kJ/g, the water takes its latent heat`, 'q_chem into the heat, Newton at the nodes: a runaway followed'],
    ['Gas', '∇·(κ(T) ∇u) + G = 0,  u ≤ the load', `each piece's gas (furnace.js's moles per stage) along its paper (furnace.js's conductance) and across the piece (G R T h / 8D)${onPlates ? `; the top and bottom pieces' face on a plate: through the plate (its permeability ${fmpPlateB()})` : ''}`, `the paper's edges at the argon's pressure; where the gas passes the load the paper lifts${onPlates ? ', and a piece lifts off its plate' : ''}`],
    ['Stress', dim === 3 ? 'plane stress in each piece: σ = C (ε − ε*)' : 'along each piece\'s edge: σ_yy = E (ε̄ − ε*)', `ε* its shrink as its oxygen leaves (${f.bO.v} %) and it graphitizes (${f.bG.v} %)`, 'free in its plane (the papers\' friction: the Results step)'],
  ];
  const E = r ? r.energy : null, bal = E ? Math.abs(E.faces + E.reaction + E.between - E.held) / Math.max(1e-30, Math.abs(E.faces)) : null;
  const per = dim === 1 ? '/m²' : dim === 2 ? '/m' : '';
  const balT = E ? `heat in through the faces ${(E.faces / 1e6).toPrecision(4)} MJ${per} + the chemistry's ${(E.reaction / 1e6).toPrecision(4)} MJ${per} + given up between the runs ${(E.between / 1e6).toPrecision(4)} MJ${per} = held ${(E.held / 1e6).toPrecision(4)} MJ${per} (${bal < 1e-6 ? 'closes' : 'off by ' + (bal * 100).toFixed(4) + ' %'})` : '';
  const mesh = r ? `${r.mesh.nodes} nodes (the GO at ${r.mesh.goNodes}), each its chemistry; ${r.series.length} program steps${r.substeps > r.series.length ? `, ${r.substeps} with the runaway's` : ''}${r.mesh.stressNodes ? `; each piece's stress on ${r.mesh.stressNodes} nodes` : ''}; solved in ${(r.ms / 1000).toFixed(1)} s` : `${dim === 3 ? 'about 450' : dim === 2 ? 'about 190' : '11'} nodes`;
  return `<table class="mp-kv"><tbody>
      <tr><th>Domain</th><td colspan="3">${dom}</td></tr>
      <tr><th>Mesh and time</th><td colspan="3">${mesh}; linear elements, the heat stored as enthalpy; implicit in time, the program in steps of at most ${o.dT} K (${o.dTHigh} K above 400 °C)</td></tr>
    </tbody></table>
    <table class="mp-phys"><thead><tr><th scope="col">Physics</th><th scope="col">Equation</th><th scope="col">Materials</th><th scope="col">Faces</th></tr></thead>
      <tbody>${rows.map(([a, b, c, e]) => `<tr><th scope="row">${a}</th><td class="mp-eq">${b}</td><td>${c}</td><td>${e}</td></tr>`).join('')}</tbody></table>
    <p class="mp-couple"><b>Coupling</b> heat ⇄ chemistry in one system at every node (its heat and its rate at the local temperature) → the gas each step → each piece's stress.${balT ? ` <b>Balance</b> ${balT}.` : ''} <button type="button" class="linkish" data-mat="furn">What it reads (Materials)</button></p>`;
}
function fmpClear() {
  for (const id of ['fmp1', 'fmp2', 'fmp3', 'fmp4', 'fmp5']) { const cv = document.getElementById(id); if (cv) { const { c, w, h } = setupCanvas(cv, id === 'fmp5' ? 0.42 : FILM_ASPECT); c.clearRect(0, 0, w, h); } const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
  ['fmpStats', 'fmpCompare', 'fmpField', 'fmpSnap', 'fmpRunWhat'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  const ft = document.getElementById('fmpFieldT'); if (ft) ft.textContent = 'The field';
}
function fmpRender() {
  const sec = document.getElementById('fmpSec');
  if (!sec) return;
  if (!sec.dataset.wired) fmpWire(sec);
  sec.querySelectorAll('[data-fmdim]').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.fmdim === FMS.dim)));
  sec.querySelectorAll('[data-fmrun]').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.fmrun === FMS.run)));
  const dim = FMS.dim, o = fmpInputs(dim), model = document.getElementById('fmpModel');
  if (!o) { model.innerHTML = '<p class="fv-why">After the film and its cut piece are solved (the Film stage).</p>'; fmpClear(); fmpStatus(); return; }
  if (!fmpCurrent(dim) && dim < 3 && !(FMS.error[dim] && FMS.key[dim] === fmpKeyNow(dim))) fmpRequest(dim);
  fmpStatus();
  const r = fmpCurrent(dim) ? FMS.res[dim] : null;
  model.innerHTML = fmpModelHTML(o, r);
  if (!r) {
    fmpClear();
    const err = FMS.error[dim] && FMS.key[dim] === fmpKeyNow(dim);
    document.getElementById('fmpStats').innerHTML = err ? `<p class="dry-msg">${pill(`The ${MP_DIMS[dim]} could not be solved: ${dryEsc(FMS.error[dim])}`, 'bad')}</p>` : dim === 3 && !(FMS.busy && FMS.bdim === 3) ? '<p class="fv-why mp-empty">The 3D solves a quarter of the holder through both runs in about two minutes: press Solve.</p>' : '';
    return;
  }
  fmpTiles(o, r); fmpCharts(o, r); fmpField(); fmpCompare(o, r);
}
const fmpK = v => `${v < 10 ? v.toFixed(1) : v.toFixed(0)} K`;
/** Per run: the gas's largest share of the hold over the followed pieces, the piece and the program's temperature then. */
function fmpGasByRun(r) {
  return FURN_RUNS.map((_, run) => {
    let best = { ratio: 0, i: null, T: null };
    for (const s of r.series) if (s.run === run) for (const i of r.follow) { const p = s.pieces[i]; if (p.hold > 0 && p.middle / p.hold > best.ratio) best = { ratio: p.middle / p.hold, i, T: s.Tprog }; }
    return best;
  });
}
function fmpTiles(o, r) {
  const s = r.summary, R = s.runs, N = o.N, F = MAT.film;
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const lagMax = R.reduce((a, q, k) => (q.lag > a.v ? { v: q.lag, k, at: q.lagAt } : a), { v: 0, k: 0, at: null });
  const spr = R.reduce((a, q, k) => (q.spread > a.v ? { v: q.spread, k, at: q.spreadAt } : a), { v: 0, k: 0, at: null });
  const over = R[0].over, gas = fmpGasByRun(r), gMax = gas.reduce((a, g, k) => (g.ratio > a.ratio ? { ...g, k } : a), { ratio: 0, k: 0 });
  const lm = s.labileMid, lref = s.labileRef;
  document.getElementById('fmpStats').innerHTML = [
    tile('Behind the program, heating', fmpK(lagMax.v), lagMax.at ? `${FURN_RUNS[lagMax.k]}, the program at ${lagMax.at.T.toFixed(0)} °C` : '—', 'temp', lagMax.v > 50 ? 'warn' : ''),
    tile('Its own heat: above the program', over >= 1 ? fmpK(over) : 'none', over >= 1 ? `${FURN_RUNS[0]}, the program at ${R[0].overAt.T.toFixed(0)} °C: the labile oxygen's heat` : 'its heat gets out as fast as it is made', 'oven', over >= 20 ? 'bad' : over >= 5 ? 'warn' : ''),
    tile('Across the stack at once', fmpK(spr.v), spr.at ? `${FURN_RUNS[spr.k]}, the program at ${spr.at.T.toFixed(0)} °C` : '—', 'mesh', spr.v >= 50 ? 'warn' : ''),
    tile('Labile oxygen half gone', lm ? `${lm.T.toFixed(0)} °C` : '—', lm ? `the middle piece's middle, the program then ${lm.Tprog.toFixed(0)} °C${lref ? `; at the program's own: ${lref.Tprog.toFixed(0)} °C` : ''}` : 'not in these runs', 'period'),
    tile('Gas against the layers\' hold', `${gMax.ratio.toFixed(gMax.ratio >= 10 ? 0 : 2)}×`, gMax.i != null ? `the ${fmpPieceName(gMax.i, N)}, ${FURN_RUNS[gMax.k]} at ${gMax.T.toFixed(0)} °C; past 1 they part` : '—', 'weight', gMax.ratio >= 1 ? 'bad' : gMax.ratio >= 0.5 ? 'warn' : ''),
    tile('Pull, converting unevenly', `${s.pull.toFixed(s.pull >= 10 ? 0 : 2)} MPa`, `its strength ${F.sigF.v} MPa; free in its plane`, 'cut', s.pull >= F.sigF.v ? 'bad' : ''),
  ].join('');
}
function fmpCharts(o, r) {
  const run = FMS.run, ser = r.series.filter(s => s.run === run), N = o.N, heat = cssVar('--heat').trim(), mut = cssVar('--muted'), bad = cssVar('--bad').trim();
  document.getElementById('fmpRunWhat').textContent = `${FURN_RUN_WHAT[run]}; time from the run's start`;
  if (ser.length < 2) { fmpClear(); return; }
  const t0 = ser[0].t, T = s => s.t - t0, fol = r.follow, n = fol.length;
  const shade = (c, k) => mpShade(c, k, n), name = i => fmpPieceName(i, N);
  const midI = fol[Math.floor((n - 1) / 2)];
  const prog = { p: ser.map(s => [T(s), s.Tprog]), c: mut, w: 1.5, dash: [6, 4], l: 'the program (the hot zone)' };
  // temperatures: the followed pieces' middles light to dark up the stack; the middle piece's edge dotted
  const tl = fol.map((i, k) => ({ p: ser.map(s => [T(s), s.pieces[i].mid]), c: shade(heat, k), w: 2, l: `${name(i)}, its middle` }));
  tl.push({ p: ser.map(s => [T(s), s.pieces[midI].edge]), c: heat, w: 2, dash: [2, 3], l: `${name(midI)}, its edge` });
  const Ts = [...prog.p, ...tl.flatMap(s => s.p)].map(p => p[1]);
  const tEnd = T(ser[ser.length - 1]);
  plotChart(document.getElementById('fmp1'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: Math.ceil(Math.max(...Ts) / 100) * 100, xl: 'time (h)', yl: 'temperature (°C)', xd: 0, yd: 0, s: [prog, ...tl] });
  document.getElementById('fmp1Lg').innerHTML = oneDLegend([...tl.map(s => [s.l, s.c, s.dash ? 'dash' : '']), [prog.l, mut, 'dash']]);
  // its oxygen gone: the pieces' middles, the middle piece's edge; the program's temperature's (the Results step)
  const ol = fol.map((i, k) => ({ p: ser.map(s => [T(s), s.pieces[i].oM * 100]), c: shade('#1c7ed6', k), w: 2, l: name(i) }));
  ol.push({ p: ser.map(s => [T(s), s.pieces[midI].oE * 100]), c: '#1c7ed6', w: 2, dash: [2, 3], l: `${name(midI)}, its edge` });
  const oref = { p: ser.map(s => [T(s), s.oRef * 100]), c: mut, w: 1.5, dash: [6, 4], l: 'at the program\'s temperature (the Results step)' };
  plotChart(document.getElementById('fmp2'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: 100, xl: 'time (h)', yl: 'oxygen gone (% of the GO\'s)', xd: 0, yd: 0, s: [oref, ...ol] });
  document.getElementById('fmp2Lg').innerHTML = oneDLegend([...ol.map(s => [s.l, s.c, s.dash ? 'dash' : '']), [oref.l, mut, 'dash']]);
  // the gas in each piece's middle over its hold, on a log scale (it spans decades): past 1 its layers part (it puffs)
  const lg10 = v => Math.log10(Math.max(v, 1e-3));
  const gl = fol.map((i, k) => ({ p: ser.map(s => [T(s), lg10(s.pieces[i].hold > 0 ? s.pieces[i].middle / s.pieces[i].hold : 0)]), c: shade('#7048e8', k), w: 2, l: name(i) }));
  const gHi = Math.max(1, Math.ceil(Math.max(...gl.flatMap(s => s.p.map(p => p[1]))))), gLo = Math.min(-2, gHi - 5);
  const decades = Array.from({ length: gHi - gLo + 1 }, (_, j) => gLo + j);
  plotChart(document.getElementById('fmp3'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: gLo, y1: gHi, xl: 'time (h)', yl: 'gas in its middle ÷ its hold (log)', xd: 0, yticks: decades, yf: v => { const x = Math.pow(10, v); return x >= 1 ? Math.round(x).toLocaleString('en-US').replace(/,/g, ' ') : String(+x.toPrecision(1)); },
    hl: [{ y: 0, c: bad, t: 'its layers part', left: true }], s: gl });
  document.getElementById('fmp3Lg').innerHTML = oneDLegend(gl.map(s => [s.l, s.c])) + '<p class="fv-why">The gas at the middle of each piece, held down: the paper lifts past the load and lets it by; across the piece it builds as it is made faster (hotter).</p>';
  // the pull
  const pl = fol.map((i, k) => ({ p: ser.map(s => [T(s), s.pieces[i].pull || 0]), c: shade('#c2255c', k), w: 2, l: name(i) }));
  const pMax = Math.max(MAT.film.sigF.v * 1.1, ...pl.flatMap(s => s.p.map(p => p[1]))), pT = niceTicks(0, pMax, 4);
  plotChart(document.getElementById('fmp4'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: pT[pT.length - 1] < pMax ? pMax : pT[pT.length - 1], yticks: pT, xl: 'time (h)', yl: 'largest pull (MPa)', xd: 0, yd: 0, hl: [{ y: MAT.film.sigF.v, c: bad, t: `its strength (${MAT.film.sigF.v} MPa)`, left: true }], s: pl });
  document.getElementById('fmp4Lg').innerHTML = oneDLegend(pl.map(s => [s.l, s.c])) + '<p class="fv-why">Where a piece converts ahead of the rest of it (hotter) it shrinks first and pulls on itself; free in its plane (the Results step adds the papers\' hold).</p>';
}
/** The snapshot chips: the program's key moments, its own heat's peak and the most uneven moment. */
function fmpSnapLabel(s) {
  if (s.mark === 'over') return `its own heat, ${FURN_RUNS[s.run].toLowerCase()}`;
  if (s.mark === 'uneven') return `most uneven, ${FURN_RUNS[s.run].toLowerCase()}`;
  return `${FURN_RUNS[s.run]} · ${s.Tprog.toFixed(0)} °C`;
}
function fmpField() {
  const r = fmpCurrent(FMS.dim) ? FMS.res[FMS.dim] : null, cv = document.getElementById('fmp5'), lg = document.getElementById('fmp5Lg');
  if (!r || !cv) return;
  const dim = r.dim, snaps = r.snaps;
  if (FMS.snap === null || !snaps[FMS.snap]) { const i = snaps.findIndex(s => s.mark === 'over'); FMS.snap = i >= 0 ? i : 0; }
  const fields = [['T', 'Temperature'], ['O', 'Oxygen gone'], ['gas', 'Gas']];
  if (!fields.some(f => f[0] === FMS.field)) FMS.field = 'T';
  document.getElementById('fmpField').innerHTML = fields.map(([k, t]) => `<button type="button" role="tab" data-fmfield="${k}" aria-selected="${k === FMS.field}">${t}</button>`).join('');
  document.getElementById('fmpSnap').innerHTML = snaps.map((s, i) => `<button type="button" role="tab" data-fmsnap="${i}" aria-selected="${i === FMS.snap}" title="${FURN_RUNS[s.run]}, ${s.t.toFixed(2)} h in, the program at ${s.Tprog.toFixed(0)} °C">${fmpSnapLabel(s)}</button>`).join('');
  const sn = snaps[FMS.snap], title = document.getElementById('fmpFieldT'), N = OVEN.furn.N;
  const when = `${FURN_RUNS[sn.run]}, the program at ${sn.Tprog.toFixed(0)} °C${sn.mark === 'over' ? ' (where the stack\'s own heat takes it furthest above the program)' : sn.mark === 'uneven' ? ' (the stack at its most uneven)' : ''}`;
  const bar = (lut, sc, unit, fmtv) => `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${fmtv(sc.min)}</span><span>${unit}</span><span>${fmtv(sc.max)}</span></span></div>`;
  const xs = r.mesh.x.map(v => v * 1000), Lp = (r.mesh.x[r.mesh.x.length - 1] - (OVEN.furn.margin || 0) / 1000) * 1000;
  // the gas: along each followed piece (1D, 2D: lines to the paper's edge; 3D: the quarter pieces' planes)
  if (FMS.field === 'gas') {
    title.textContent = 'The gas in each piece\'s middle, over its hold';
    const fol = r.follow;
    if (dim < 3) {
      const gx = r.mesh.gx.map(v => v * 1000), lines = fol.map((i, k) => ({ p: gx.map((x, j) => [x, sn.pieces[i].gas[j] / sn.pieces[i].hold]).filter(p => p[0] <= Lp + 1e-6), c: mpShade('#7048e8', k, fol.length), w: 2, l: fmpPieceName(i, N) }));
      const top = Math.max(1.2, ...lines.flatMap(s => s.p.map(p => p[1])));
      plotChart(cv, 0.42, { x0: 0, x1: Lp, y0: 0, y1: top * 1.05, xl: 'from the piece\'s middle to its edge (mm)', yl: 'gas ÷ its hold', xd: 0, yd: 1, hl: [{ y: 1, c: cssVar('--bad'), t: 'its layers part', left: true }], s: lines.map(s => ({ p: s.p, c: s.c, w: 2 })) });
      lg.innerHTML = oneDLegend(lines.map(s => [s.l, s.c])) + `<p class="fv-why">${when}.</p>`;
      return;
    }
    const { c, w, h } = setupCanvas(cv, 0.42), sx = r.mesh.gx.map(v => v * 1000), sy = r.mesh.gy.map(v => v * 1000), n1 = sx.length, lut = getLut('seq');
    c.clearRect(0, 0, w, h);
    const all = fol.flatMap(i => sn.pieces[i].gas.map(v => v / sn.pieces[i].hold)), sc = { min: 0, max: Math.max(1, ...all), levels: 0 };
    mpPlanes(c, w, h, sx, sy, fol.map(i => ({ t: fmpPieceName(i, N), v: (k, j) => sn.pieces[i].gas[k * n1 + j] / sn.pieces[i].hold })), lut, sc);
    lg.innerHTML = bar(lut, sc, 'gas ÷ its hold (past 1: its layers part)', v => v.toFixed(2)) + `<p class="fv-why">${when}. Each quarter piece and its paper's margin from its middle (lower left).</p>`;
    return;
  }
  const isT = FMS.field === 'T', lut = isT ? mpHeatLut() : getLut('seq'), key = isT ? 'secT' : 'secO', k = isT ? 1 : 100;
  // 1D: a profile along the piece and its paper
  if (dim === 1) {
    const vals = sn[key][0].map(v => v * k), pts = xs.map((x, j) => [x, vals[j]]).filter(p => Number.isFinite(p[1]));
    const ys = pts.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.1 || 1;
    title.textContent = `${isT ? 'Temperature' : 'Oxygen gone'} along the stack's middle`;
    plotChart(cv, 0.42, { x0: 0, x1: xs[xs.length - 1], y0: lo - pad, y1: hi + pad, xl: 'from the middle to the paper\'s edge (mm)', yl: isT ? 'temperature (°C)' : 'oxygen gone (%)', xd: 0, yd: isT ? 0 : 1,
      vl: [{ x: Lp, c: cssVar('--muted'), t: 'the piece\'s edge' }], s: [{ p: pts, c: isT ? cssVar('--heat').trim() : '#1c7ed6', w: 2 }] });
    lg.innerHTML = `<p class="fv-why">${when}. ${isT ? `The program ${sn.Tprog.toFixed(0)} °C.` : 'Beyond the piece\'s edge only its paper.'}</p>`;
    return;
  }
  // 2D / 3D: the section through the holder (its middle across in 3D), not to scale: the plates, the stack, the margin
  const { c, w, h } = setupCanvas(cv, 0.42), m = { l: 56, r: 16, t: 12, b: 34 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  c.clearRect(0, 0, w, h); c.font = '12px ' + cssVar('--mono');
  const zs = r.mesh.z.map(v => v * 1000), H = zs[zs.length - 1], X1 = xs[xs.length - 1], vals = sn[key];
  const all = vals.flat().filter(Number.isFinite).map(v => v * k), sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 };
  if (sc.max - sc.min < 0.05) { sc.min -= 0.5; sc.max += 0.5; }
  const X = x => m.l + x / X1 * pw, Z = z => m.t + ph - z / H * ph;
  for (let kz = 0; kz < zs.length - 1; kz++) for (let i = 0; i < xs.length - 1; i++) {
    const q = [vals[kz][i], vals[kz][i + 1], vals[kz + 1][i], vals[kz + 1][i + 1]].filter(Number.isFinite);
    if (!q.length) { c.fillStyle = cssVar('--soft'); } else c.fillStyle = lutColor(lut, scaleT(sc, q.reduce((a, b) => a + b, 0) / q.length * k));
    c.fillRect(Math.floor(X(xs[i])), Math.floor(Z(zs[kz + 1])), Math.ceil(X(xs[i + 1]) - X(xs[i])) + 1, Math.ceil(Z(zs[kz]) - Z(zs[kz + 1])) + 1);
  }
  const plT = r.mesh.plT * 1000, ink = cssVar('--ink');
  c.strokeStyle = ink; c.setLineDash([4, 3]);
  for (const zz of [plT, H - plT]) { c.beginPath(); c.moveTo(m.l, Z(zz)); c.lineTo(m.l + pw, Z(zz)); c.stroke(); }
  c.beginPath(); c.moveTo(X(Lp), Z(plT)); c.lineTo(X(Lp), Z(H - plT)); c.stroke(); c.setLineDash([]);
  c.strokeStyle = cssVar('--line'); c.strokeRect(m.l, m.t, pw, ph); c.fillStyle = cssVar('--muted');
  const tk = v => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(+v.toFixed(1)));
  c.textAlign = 'center'; for (const v of niceTicks(0, X1, 6)) c.fillText(tk(v), X(v), h - m.b + 16);
  c.textAlign = 'right'; for (const v of niceTicks(0, H, 4)) c.fillText(tk(v), m.l - 6, Z(v) + 4);
  c.textAlign = 'right'; c.fillText('from the middle out (mm)', w - m.r, h - 4); c.textAlign = 'left'; c.fillText('height (mm)', 4, m.t + 2);
  title.textContent = `${isT ? 'Temperature' : 'Oxygen gone'} on a section through the holder${dim === 3 ? ' (its middle across)' : ''}`;
  lg.innerHTML = bar(lut, sc, isT ? '°C' : '% of the GO\'s oxygen', v => v.toFixed(isT ? 0 : 1)) + `<p class="fv-why">${when}. The plates above and below the dashed lines, the ${N} pieces and their papers between; the pieces end at the dashed upright, their papers' margin beyond${isT ? '' : ' (no GO: grey)'}. Heights drawn to fit.</p>`;
}
/** The same answers, this model against the Results step (furnace.js: every piece at the program's temperature). */
function fmpCompare(o, r) {
  const el = document.getElementById('fmpCompare'), res = typeof furnCurrent === 'function' && furnCurrent() ? FURN.res : null;
  const s = r.summary, R = s.runs, gas = fmpGasByRun(r), lm = s.labileMid, lref = s.labileRef;
  const fjGas = k => { if (!res) return '—'; const L = res.pos || [res]; const v = Math.max(...L.map(q => (q.runs[k] ? q.runs[k].peak.idx : 0))); return Number.isFinite(v) ? `${v.toFixed(2)}×` : '—'; };
  const spread = OVEN.furn.dTload;
  const rows = [
    ['The pieces\' temperature', 'the program\'s, all through', `behind it up to ${fmpK(R[0].lag)} (${FURN_RUNS[0].toLowerCase()}) and ${fmpK(R[1] ? R[1].lag : 0)} (${FURN_RUNS[1].toLowerCase()}); ${R[0].over >= 1 ? `its own heat takes it up to ${fmpK(R[0].over)} above` : 'never above it'}`],
    ['The labile oxygen half gone', lref ? `at ${lref.Tprog.toFixed(0)} °C, ${lref.t / 3600 < 10 ? (lref.t / 3600).toFixed(1) : (lref.t / 3600).toFixed(0)} h in` : '—', lm ? `the middle piece's middle at ${lm.T.toFixed(0)} °C, ${(lm.t / 3600).toFixed(1)} h in (the program then ${lm.Tprog.toFixed(0)} °C)` : '—'],
    ['Across the load at once', Number.isFinite(spread) && spread > 0 ? `${spread} K (yours, the load's spread)` : 'none (every piece alike)', `${fmpK(Math.max(...R.map(q => q.spread)))} across one stack`],
    [`Gas against the hold, ${FURN_RUNS[0].toLowerCase()}`, `${fjGas(0)} <small>with the paper lifting and the layers parting</small>`, `${gas[0].ratio.toFixed(gas[0].ratio >= 10 ? 0 : 2)}× <small>held down, at the piece's own temperature</small>`],
    [`Gas against the hold, ${FURN_RUNS[1].toLowerCase()}`, fjGas(1), `${gas[1].ratio.toFixed(gas[1].ratio >= 10 ? 0 : 2)}×`],
  ];
  el.innerHTML = `<h4 class="mp-h">Against the Results step</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Results step <small>furnace.js: every piece at the program's temperature</small></th><th scope="col">This ${MP_DIMS[o.dim]} <small>heat, chemistry, gas and stress together</small></th></tr></thead>
    <tbody>${rows.map(([a, b, cc]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${cc}</td></tr>`).join('')}</tbody></table>
    <p class="fv-why">The same chemistry and gas physics (at the program's temperature all through this solver gives furnace.js's chemistry exactly: furnace-mp checks). The difference is the heat: here the holder heats from the hot zone by radiation and the argon, the papers carry it in along the pieces, and the GO's own heat as its oxygen leaves goes back in.</p>`;
}
function fmpCsv() {
  const r = fmpCurrent(FMS.dim) ? FMS.res[FMS.dim] : null;
  if (!r) return;
  const N = OVEN.furn.N, name = i => fmpPieceName(i, N);
  const rows = [['dimension', 'run', 'time (h)', 'program (°C)', 'coldest GO (°C)', 'hottest GO (°C)', 'oxygen gone at the program\'s temperature',
    ...r.follow.flatMap(i => [`${name(i)} middle (°C)`, `${name(i)} edge (°C)`, `${name(i)} oxygen gone, middle`, `${name(i)} gas ÷ hold`, `${name(i)} pull (MPa)`])]];
  for (const q of r.series) rows.push([MP_DIMS[r.dim], q.run + 1, q.t, q.Tprog, q.lo, q.hi, q.oRef, ...r.follow.flatMap(i => { const p = q.pieces[i]; return [p.mid, p.edge, p.oM, p.hold > 0 ? p.middle / p.hold : '', p.pull]; })]);
  downloadCSV(`furnace-multiphysics-${MP_DIMS[r.dim]}-${csvStamp()}.csv`, rows);
}
