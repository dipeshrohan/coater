/*
 * stack-mp-ui.js — MP-1 on the Pre heat treatment page: its third step, Multiphysics. The pressed stack solved in 1D, 2D
 * or 3D (stack-mp.js in cfd-mp-worker.js): its heat (the plate, the pieces, the oven's air and walls), its water (along
 * the pieces, through them, the latent heat) and each followed piece's stress, together.
 *
 * The page: the solver's bar (the dimension, Solve, where it stands), the model (its domain, mesh, equations, faces,
 * coupling and balances, as a table), the answers (tiles), the temperatures and the water against time, a field (a
 * section, a piece's plane, a profile) at a chosen time, and the same answers against the Results step's (press.js: the
 * pieces at the oven's temperature from the start). 1D and 2D solve by themselves when shown; 3D on Solve (about a
 * minute).
 */
const MPS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, field: 'T', snap: null, again: null };
const MP_DIMS = { 1: '1D', 2: '2D', 3: '3D' };
/** The pieces in a stack (the Pre heat's input, Q77: 20), the ones followed (its bottom, middle and top), their names. */
const mpN = () => Math.max(2, Math.round(OVEN.peel.stackN || 20));
const mpMid = () => Math.floor(mpN() / 2);
const mpFollow = () => [0, mpMid(), mpN() - 1];
const mpPiece = i => (i === 0 ? 'bottom piece' : i === mpMid() ? 'middle piece' : i === mpN() - 1 ? 'top piece' : `piece ${i + 1}`);

/** The stack's multiphysics inputs for a dimension: the film's piece (the way shown), the Materials cards, the stack's own. */
function mpStackInputs(dim) {
  const q = typeof stackInputs === 'function' ? stackInputs() : null;
  if (!q) return null;
  const pc = q.pieces.find(p => p.where === SHEET.way) || q.pieces[0], P = pc.plate, pl = OVEN.peel, d = MAT.dry, S = q.stack;
  const tOven = S.tOven, tRest = S.tRest;
  const stages = [{ tEnd: tOven, Tair: pl.dryT, creep: true }];
  if (tRest > 0) stages.push({ tEnd: tRest, Tair: P.Troom, creep: false });
  const snapMin = [5, 15, 30, 60].filter(m => m * 60 < tOven - 1);
  return { dim, Lx: q.Lx, Ly: q.Ly, N: mpN(), h: P.h, plateT: pl.plateT / 1000, X0: P.Xcut, Troom: P.Troom, rhRoom: P.rhRoom,
    XdryTo: P.Xdry + 0.1 * (P.Xcut - P.Xdry), stages, air: { fan: pl.stackAirU, p: (MAT.dry.pRoom ? MAT.dry.pRoom.v * 1000 : 101325) }, shelf: pl.shelf, epsPlate: pl.epsPl, epsGO: d.emis.v, al: { k: MAT.lib.alK.v, rho: MAT.lib.alRho.v, c: MAT.lib.alC.v, ...hubDefsOf({ kT: MAT.lib.alK, cT: MAT.lib.alC }) },
    go: { kIn: d.kIn.v, kThr: d.kS.v, c: d.cS.v, ...hubDefsOf({ kInT: d.kIn, kThrT: d.kS, cT: d.cS }), rhoS: P.rhoG, gab: P.gab, K: S.K, Kthr: d.skinK.v * 1e-12, alpha: MAT.film.alphaF.v * 1e-6, nu: P.nu, tab: P.tab, tau: S.tau },
    ...mpStackMesh(dim), follow: mpFollow(),
    ...(typeof matSolverProps === 'function' && matSolverProps() ? { props: matSolverProps() } : {}),
    snapTimes: [...snapMin.map(m => m * 60), tOven, ...(tRest > 0 ? [tOven + tRest] : [])] };
}
/** The stack's mesh and time steps for a dimension (MP-W: the Mesh step's settings, editable; at their defaults the solve
 *  is as before MP-W, to the last bit): the elements from the middle to the edge (and across, 3D), their grading, the
 *  plate's elements, the pieces an element holds through the stack, the time steps a stage. */
function mpStackMesh(dim) {
  const m = typeof swbSettings === 'function' ? swbSettings(SWB_ADAPT['film:stack'], dim) : MP_MESH_DEF[dim];
  const mesh = dim === 1 ? { nPlate: m.nPlate, per: m.per } : dim === 2 ? { nx: m.nx, grade: m.grade, nPlate: m.nPlate, per: m.per } : { nx: m.nx, ny: m.ny, grade: m.grade, nPlate: m.nPlate, per: m.per };
  return { mesh, steps: m.steps };
}
/** The defaults: the solves' as they were before MP-W. */
const MP_MESH_DEF = { 1: { nPlate: 4, per: 1, steps: 60 }, 2: { nx: 16, grade: 16, nPlate: 4, per: 1, steps: 60 }, 3: { nx: 8, ny: 8, grade: 12, nPlate: 4, per: 1, steps: 30 } };
const mpKeyNow = dim => { const o = mpStackInputs(dim); return o ? JSON.stringify({ o, way: SHEET.way, film: DRY.sel }) : null; };
const mpCurrent = dim => !!MPS.res[dim] && MPS.key[dim] === mpKeyNow(dim);

/** Solve a dimension (one at a time; a request while busy runs next). */
function mpStackRequest(dim) {
  const key = mpKeyNow(dim);
  if (!key) return;
  if (MPS.key[dim] === key && MPS.res[dim]) { solveTake('mps' + dim); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('mps' + dim)) return;
  if (MPS.busy) { if (MPS.pending !== key) MPS.again = dim; return; }
  solveTake('mps' + dim);
  const o = mpStackInputs(dim);
  MPS.busy = true; MPS.bdim = dim; MPS.pending = key; MPS.prog = null; MPS.again = null;
  const id = ++MPS.id;
  if (!MPS.worker) MPS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { MPS.busy = false; MPS.pending = null; MPS.bdim = null; if (MPS.again) { const a = MPS.again; MPS.again = null; mpStackRequest(a); } if (typeof swbRefresh === 'function' && swbRefresh('film:stack')) return; mpStackRender(); };
  MPS.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) { MPS.prog = m.progress; if (typeof swbOn === 'function' && swbOn('film:stack')) swbProgress(); else mpStackStatus(); return; }
    MPS.key[dim] = key;
    if (m.ok) { MPS.res[dim] = m.res; MPS.error[dim] = null; } else { MPS.res[dim] = null; MPS.error[dim] = m.error; }
    done();
  };
  MPS.worker.onerror = ev => { MPS.key[dim] = key; MPS.res[dim] = null; MPS.error[dim] = ev.message || 'the multiphysics worker failed'; MPS.worker = null; done(); };
  MPS.worker.postMessage({ id, kind: 'stack', o });
  if (!(typeof swbOn === 'function' && swbOn('film:stack'))) mpStackStatus();
}
/** Stop the multiphysics solve (New, Open): its worker ended, what was asked next dropped. */
function mpStackStop() {
  if (MPS.worker) { MPS.worker.terminate(); MPS.worker = null; }
  Object.assign(MPS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}
/** Wait for a dimension's solve (the report, the tests): true when solved. */
async function mpStackWait(dim = MPS.dim) {
  if (typeof stackWait === 'function' && !(await stackWait())) return false;
  for (let k = 0; k < 6000; k++) {
    if (!MPS.busy) { if (mpCurrent(dim)) return true; if (MPS.error[dim] && MPS.key[dim] === mpKeyNow(dim)) return false; if (!solveAsked('mps' + dim)) return false; mpStackRequest(dim); }   // (Phase 0: only when asked for)
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- the page ----
function mpStackHTML(bench = false) {
  const pane = (id, icon, title, aria, extra = '') => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}${title}${extra}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="mp-sec${bench ? ' mp-bench' : ''}" id="mpSec" ${bench ? 'aria-label="The stack\'s multiphysics: its answers"' : 'aria-labelledby="mpH"'}>
    ${bench ? '' : `<header class="mp-bar">
      <h4 id="mpH">${uiBadge('mesh')}Multiphysics solver <small>heat · water · stress, solved together</small></h4>
      <div class="seg" role="tablist" aria-label="The solver's dimension" id="mpDim">${Object.entries(MP_DIMS).map(([k, t]) => `<button type="button" role="tab" data-mpdim="${k}" aria-selected="${+k === MPS.dim}">${t}</button>`).join('')}</div>
      <span class="vp-spacer"></span>
      <span class="mp-state" id="mpState" role="status"></span>
      <button type="button" class="btn btn-primary btn-sm" id="mpSolve">${uiIco('play')}Solve</button>
      <button type="button" class="btn btn-secondary btn-sm" id="mpCsv">Export CSV</button>
    </header>
    <div class="mp-prog" id="mpProg" hidden><span class="mp-prog-bar"><i id="mpProgFill"></i></span><span id="mpProgT"></span></div>
    <div class="mp-model" id="mpModel"></div>`}
    <div class="stats mp-stats" id="mpStats"></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('mp1', 'temp', 'Temperatures', 'The temperatures of the plate and the followed pieces against time, with the oven\'s air')}
      ${pane('mp2', 'drop', 'Water in the pieces', 'The mean water of the followed pieces against time, with the Results step\'s middle piece')}
    </div>
    <figure class="pane mp-field"><figcaption>${uiBadge('mesh')}<span id="mpFieldT">The field</span>
        <span class="vp-spacer"></span>
        <span class="seg seg-sm" role="tablist" aria-label="The field shown" id="mpField"></span>
        <span class="seg seg-sm" role="tablist" aria-label="When" id="mpSnap"></span></figcaption>
      <canvas id="mp3" role="img" aria-label="The field chosen at the time chosen"></canvas><div class="pane-legend" id="mp3Lg"></div></figure>
    ${bench && MPS.dim === 3 ? `<figure class="pane mp-field"><figcaption>${uiBadge(9)}<span id="mpIsoT">The quarter in 3D</span></figcaption><canvas id="mpIso" role="img" aria-label="The quarter of the stack in 3D: the field chosen on its outer faces at the time chosen"></canvas><div class="pane-legend" id="mpIsoLg"></div></figure>` : ''}
    <div class="mp-compare" id="mpCompare"></div>
  </section>`;
}
function mpStackWire(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.mpdim) { MPS.dim = +t.dataset.mpdim; MPS.snap = null; if (MPS.field === 'pull' && MPS.dim === 1) MPS.field = 'T'; mpStackRender(); return; }
    if (t.dataset.mpfield) { MPS.field = t.dataset.mpfield; mpStackField(); return; }
    if (t.dataset.mpsnap) { MPS.snap = +t.dataset.mpsnap; mpStackField(); return; }
    if (t.id === 'mpSolve') { solveArm('mps' + MPS.dim); mpStackRender(); return; }
    if (t.id === 'mpCsv') mpStackCsv();
  });
}
function mpStackStatus() {
  const el = document.getElementById('mpState'), pr = document.getElementById('mpProg');
  if (!el) return;
  const dim = MPS.dim, cur = mpCurrent(dim), err = MPS.error[dim] && MPS.key[dim] === mpKeyNow(dim);
  const busyHere = MPS.busy && MPS.bdim === dim;
  el.innerHTML = busyHere ? pill(`Solving ${MP_DIMS[dim]}…`, '') : cur ? pill(`Solved in ${(MPS.res[dim].ms / 1000).toFixed(1)} s`, 'ok') : err ? pill('Failed', 'bad') : MPS.busy ? pill(`Solving ${MP_DIMS[MPS.bdim]} first…`, '') : pill('Not solved', 'warn');
  const sb = document.getElementById('mpSolve');
  if (sb) { sb.disabled = busyHere || cur || !mpKeyNow(dim); sb.title = cur ? 'Solved for the inputs as they are' : dim === 3 ? 'The 3D takes about a minute' : ''; }
  if (pr) {
    pr.hidden = !busyHere;
    if (busyHere) { const f = MPS.prog ? MPS.prog.k / MPS.prog.n : 0; document.getElementById('mpProgFill').style.width = `${(f * 100).toFixed(1)}%`; document.getElementById('mpProgT').textContent = MPS.prog ? `time step ${MPS.prog.k} of ${MPS.prog.n}` : 'setting up the mesh…'; }
  }
}
/** The model: its domain and mesh, the physics solved and their faces, the coupling, the balances. */
function mpStackModelHTML(o, r) {
  const pl = OVEN.peel, d = MAT.dry, dim = o.dim, mm = v => (v * 1000).toFixed(v * 1000 < 10 ? 2 : 1);
  const dom = { 1: `Through the stack at its middle: ${mpN()} pieces of ${mm(o.h)} mm under the ${pl.plateT} mm plate`, 2: `A section from the stack's middle to its edge, ${mm(o.Lx / 2)} × ${mm(o.N * o.h + o.plateT)} mm, the stack taken long across`, 3: `A quarter of the stack, ${mm(o.Lx / 2)} × ${mm(o.Ly / 2)} × ${mm(o.N * o.h + o.plateT)} mm, on its two mirror planes` }[dim];
  const air = pl.stackAirU > 0 ? `a fan's air at ${pl.stackAirU} m/s along it` : 'still air (natural convection)';
  const shelf = pl.shelf === 'solid' ? 'the underside on a solid shelf at the oven\'s temperature, sealed' : 'the underside on a wire shelf: air and radiation below, its vapour to the air';
  const rows = [
    ['Heat', 'ρc ∂T/∂t = ∇·(k ∇T) − L ∂S/∂t', `plate: aluminium, k 200 W/(m·K); pieces: k ${d.kIn.v} along, ${d.kS.v} through W/(m·K)`, `the oven's air at ${pl.dryT} °C, ${air}; radiation to its walls (plate ε ${pl.epsPl}, GO ε ${d.emis.v}); ${shelf}; after the oven, the room's air`],
    ['Water', '∂S/∂t = ∇·(K_v ∇p),  S = ρS · GAB(p / p_sat(T))', `along the pieces K ${(o.go.K * 1e7).toPrecision(3)} × 10⁻⁷, through them ${d.skinK.v} × 10⁻¹² kg/(m·s·Pa); the isotherm at the local temperature`, dim === 1 ? 'the stack\'s middle: none leaves along the pieces; the underside to the air (wire shelf)' : 'the stack\'s edges at the air\'s vapour pressure (the room\'s air heated); the underside to the air (wire shelf)'],
    ['Stress', dim === 3 ? 'plane stress in each piece: σ = C(X) (ε − ε*(X, T) − ε_c)' : dim === 2 ? 'along each piece\'s edge: σ_yy = E(X) (ε̄ − ε*(X, T) − ε_c)' : '—', dim === 1 ? 'a piece\'s middle is even: no stress' : 'held flat by the plate, free in its plane; creep as the Results step\'s (its rate with the water)', dim === 1 ? '—' : `the ${mpFollow().map(mpPiece).join(', ')}`],
  ];
  const bal = r ? `Heat in ${(r.energy.in / 1e3).toPrecision(4)} kJ = held ${(r.energy.held / 1e3).toPrecision(4)} kJ (${Math.abs(r.energy.in - r.energy.held) / Math.max(1e-30, Math.abs(r.energy.in)) < 1e-6 ? 'closes' : 'off by ' + (Math.abs(r.energy.in - r.energy.held) / Math.abs(r.energy.in) * 100).toFixed(3) + ' %'}); water out ${(r.water.out * 1e3).toPrecision(4)} g = lost ${(r.water.lostHeld * 1e3).toPrecision(4)} g${dim === 2 ? ' (per m across)' : dim === 1 ? ' (per m²)' : ' (the quarter)'}` : '';
  const mesh = r ? `${r.mesh.nodes} nodes, ${r.mesh.unknowns} unknowns (T and p at each)${r.mesh.stressNodes ? `; each piece's stress on ${r.mesh.stressNodes} nodes` : ''}` : `${dim === 3 ? '9 × 9' : dim === 2 ? '17' : '1'} nodes across × ${mpN() + 1 + 4} through`;
  return `<table class="mp-kv"><tbody>
      <tr><th>Domain</th><td colspan="3">${dom}</td></tr>
      <tr><th>Mesh and time</th><td colspan="3">${mesh}; linear elements, the flows at the nodes (no overshoot); BDF2 in time, ${o.steps} steps a stage; heat and water solved together (Newton)${r ? `; solved in ${(r.ms / 1000).toFixed(1)} s` : ''}</td></tr>
    </tbody></table>
    <table class="mp-phys"><thead><tr><th scope="col">Physics</th><th scope="col">Equation</th><th scope="col">Materials</th><th scope="col">Faces</th></tr></thead>
      <tbody>${rows.map(([a, b, c, e]) => `<tr><th scope="row">${a}</th><td class="mp-eq">${b}</td><td>${c}</td><td>${e}</td></tr>`).join('')}</tbody></table>
    <p class="mp-couple"><b>Coupling</b> heat ⇄ water in one system (the latent heat where the water leaves; p_sat at the local temperature) → each piece's stress every step.${bal ? ` <b>Balances</b> ${bal}.` : ''}</p>`;
}
function mpStackClear() {
  paneEmptyIds(['mp1', 'mp2', 'mp3'], paneWhy('mps' + MPS.dim));
  for (const id of ['mp1', 'mp2', 'mp3']) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
  ['mpStats', 'mpCompare'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  ['mpField', 'mpSnap'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  const ft = document.getElementById('mpFieldT'); if (ft) ft.textContent = 'The field';
}
function mpStackRender() {
  const sec = document.getElementById('mpSec');
  if (!sec) return;
  if (!sec.dataset.wired) mpStackWire(sec);
  sec.querySelectorAll('[data-mpdim]').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.mpdim === MPS.dim)));
  const dim = MPS.dim, o = mpStackInputs(dim), model = document.getElementById('mpModel');
  if (!o) { if (model) model.innerHTML = `<p class="fv-why">After the film and the pressed stack are solved.</p>`; mpStackClear(); mpStackStatus(); return; }
  // (1D and 2D solve by themselves when shown; 3D on Solve)
  if (!mpCurrent(dim) && dim < 3 && !(MPS.error[dim] && MPS.key[dim] === mpKeyNow(dim))) mpStackRequest(dim);
  mpStackStatus();
  const r = mpCurrent(dim) ? MPS.res[dim] : null;
  if (model) model.innerHTML = mpStackModelHTML(o, r);
  if (!r) {
    mpStackClear();
    const err = MPS.error[dim] && MPS.key[dim] === mpKeyNow(dim);
    document.getElementById('mpStats').innerHTML = err ? `<p class="dry-msg">${pill(`The ${MP_DIMS[dim]} could not be solved: ${dryEsc(MPS.error[dim])}`, 'bad')}</p>` : dim === 3 && !(MPS.busy && MPS.bdim === 3) ? `<p class="fv-why mp-empty">The 3D solves the quarter stack in about a minute: press Solve.</p>` : MPS.busy && MPS.bdim === dim ? `<p class="fv-why mp-empty">Solving the ${MP_DIMS[dim]}: its answers here when it is done.</p>` : '';
    return;
  }
  mpStackTiles(o, r); mpStackCharts(o, r); mpStackField(); mpStackCompare(o, r);
}
const mpMin = t => (t == null ? '—' : t < 10 ? `${t.toFixed(1)} min` : t < 120 ? `${t.toFixed(0)} min` : `${(t / 60).toFixed(1)} h`);
const mpPct = x => `${(x * 100).toFixed(1)} %`;
function mpStackTiles(o, r) {
  const s = r.summary, mid = mpMid(), F = MAT.film, pl = OVEN.peel;
  const xo = s.Xoven.find(q => q.i === mid), xt = s.Xout.find(q => q.i === mid);
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  document.getElementById('mpStats').innerHTML = [
    tile('Middle piece at the oven\'s end', `${s.ovenEnd.mid.toFixed(1)} °C`, `the oven's air ${pl.dryT} °C`, 'temp'),
    tile('Middle piece within 2 °C of the air', s.midWithin2 != null ? mpMin(s.midWithin2 / 60) : 'not in the oven', `in ${pl.tOven} h`, 'period'),
    tile('Middle piece\'s middle dry after', s.dryThrough != null ? mpMin(s.dryThrough / 60) : 'not in the oven', `at ${mpPct(o.XdryTo)} water`, 'oven'),
    tile('Middle piece out of the oven', mpPct(xo.mean), `its middle ${mpPct(xo.middle)}; as cut ${mpPct(o.X0)}`, 'drop'),
    tile('Middle piece when taken out', mpPct(xt.mean), pl.tRest > 0 ? `after ${pl.tRest} h under the plate` : 'straight from the oven', 'drop'),
    tile('Largest pull, held flat', o.dim === 1 ? 'none' : `${s.pull.toFixed(0)} MPa`, o.dim === 1 ? 'a piece\'s middle is even' : `its strength ${F.sigF.v} MPa`, 'cut', o.dim > 1 && s.pull >= F.sigF.v ? 'warn' : ''),
  ].join('');
}
/** One hue light to dark over an ordered set (the stack's heights): the colour at an opacity -- plain rgba for the image export. */
const mpShade = (c, k, n) => { const a = 0.35 + 0.65 * (n > 1 ? k / (n - 1) : 1), m = /^#([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return c; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a.toFixed(2)})`; };
function mpStackCharts(o, r) {
  const ser = r.series, tEnd = ser[ser.length - 1].t, heat = cssVar('--heat').trim(), blue = '#1c7ed6', mut = cssVar('--muted'), soft = cssVar('--soft'), tOv = o.stages[0].tEnd / 60;
  const band = [{ x0: 0, x1: tOv, c: soft }], vl = o.stages.length > 1 ? [{ x: tOv, c: mut, t: 'out of the oven' }] : [];
  // temperatures: up the stack light to dark (bottom, middle, top piece, the plate's top); the middle piece's edge dashed; the air
  const probes = [['bottom', 'bottom piece'], ['mid', 'middle piece'], ['top', 'top piece'], ['plateTop', 'plate\'s top']];
  const Ts = ser.flatMap(q => [q.Tair, ...probes.map(([k]) => q.T[k]), q.T.midEdge].filter(Number.isFinite));
  const lines = probes.map(([k, l], i) => ({ p: ser.map(q => [q.t, q.T[k]]), c: mpShade(heat, i, probes.length), w: 2, l }));
  if (o.dim > 1) lines.push({ p: ser.map(q => [q.t, q.T.midEdge]), c: heat, w: 2, dash: [2, 3], l: 'middle piece at the edge' });
  const air = { p: ser.flatMap((q, i) => i && ser[i - 1].Tair !== q.Tair ? [[q.t - 1e-6, ser[i - 1].Tair], [q.t, q.Tair]] : [[q.t, q.Tair]]), c: mut, w: 1.5, dash: [6, 4], l: 'the air' };
  plotChart(document.getElementById('mp1'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: Math.floor(Math.min(...Ts) / 10) * 10, y1: Math.ceil(Math.max(...Ts) / 10) * 10, xl: 'time (min)', yl: 'temperature (°C)', xd: 0, yd: 0, bands: band, vl, s: [air, ...lines] });
  document.getElementById('mp1Lg').innerHTML = oneDLegend([...lines.map(s => [s.l, s.c, s.dash ? 'dash' : '']), ['the air', mut, 'dash']]) + `<p class="fv-why">At the middle of each piece${o.dim > 1 ? '; the middle piece also at the stack\'s edge' : ''}. Shaded: in the oven.</p>`;
  // water: the followed pieces' means, light to dark up the stack; the Results step's middle piece (the pieces at the oven's temperature)
  const ws = mpFollow().map((i, k) => ({ p: ser.map(q => [q.t, q.X[i][0] * 100]), c: mpShade(blue, k, 3), w: 2, l: mpPiece(i) }));
  const run = typeof stackCurrent === 'function' && stackCurrent() ? STACK.res.runs.find(x => x.where === SHEET.way) : null;
  const ref = run ? { p: run.stack.mean.map(([t, X]) => [t, X * 100]), c: mut, w: 1.5, dash: [6, 4], l: 'the Results step (at the oven\'s temperature)' } : null;
  const Xs = [...ws.flatMap(s => s.p.map(p => p[1])), ...(ref ? ref.p.map(p => p[1]) : [])];
  plotChart(document.getElementById('mp2'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: Math.max(...Xs) * 1.08, xl: 'time (min)', yl: 'water (% of the GO)', xd: 0, yd: 1, bands: band, vl, s: [...(ref ? [ref] : []), ...ws] });
  document.getElementById('mp2Lg').innerHTML = oneDLegend([...ws.map(s => [s.l, s.c]), ...(ref ? [[ref.l, mut, 'dash']] : [])]) + `<p class="fv-why">Each piece's mean${o.dim === 1 ? ' at the stack\'s middle' : ''}. ${o.dim === 1 ? 'Far from the edges only the bottom piece loses water, through its underside.' : ''}</p>`;
}
/** A temperature scale: light to the heat's hue (sequential, one hue), built once per theme. */
function mpHeatLut() {
  const key = 'mpheat' + (isDarkTheme() ? ':d' : ':l');
  if (LUTS[key]) return LUTS[key];
  const hot = rgbToOklab(hexRgb(normalizeHex(cssVar('--heat')))), cold = withL(hot, isDarkTheme() ? 0.3 : 0.96);
  return (LUTS[key] = buildLut([cold, mixLab(cold, hot, 0.5), hot]));
}
function mpStackField() {
  const r = mpCurrent(MPS.dim) ? MPS.res[MPS.dim] : null, cv = document.getElementById('mp3'), lg = document.getElementById('mp3Lg');
  if (!r || !cv) return;
  const dim = r.dim, snaps = r.snaps;
  if (MPS.snap === null || !snaps[MPS.snap]) MPS.snap = snaps.findIndex(s => s.stage === 0 && Math.abs(s.t - OVEN.peel.tOven * 60) < 1e-3) >= 0 ? snaps.findIndex(s => s.stage === 0 && Math.abs(s.t - OVEN.peel.tOven * 60) < 1e-3) : snaps.length - 1;
  const fields = [['T', 'Temperature'], ['X', 'Water'], ...(dim > 1 ? [['pull', 'Pull']] : [])];
  if (!fields.some(f => f[0] === MPS.field)) MPS.field = 'T';
  document.getElementById('mpField').innerHTML = fields.map(([k, t]) => `<button type="button" role="tab" data-mpfield="${k}" aria-selected="${k === MPS.field}">${t}</button>`).join('');
  const tOvMin = OVEN.peel.tOven * 60;
  document.getElementById('mpSnap').innerHTML = snaps.map((s, i) => `<button type="button" role="tab" data-mpsnap="${i}" aria-selected="${i === MPS.snap}" title="${s.stage ? `under the plate in the room, ${mpMin(s.t - tOvMin)} after the oven` : 'in the oven'}">${s.stage ? `out +${mpMin(s.t - tOvMin)}` : mpMin(s.t)}</button>`).join('');
  const sn = snaps[MPS.snap], mid = mpMid();
  if (dim === 3) mpStackIso(r, sn);
  const title = document.getElementById('mpFieldT');
  const bar = (lut, sc, unit, fmtv) => `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${fmtv(sc.min)}</span><span>${unit}</span><span>${fmtv(sc.max)}</span></span></div>`;
  const when = sn.stage ? `under the plate in the room, ${mpMin(sn.t - OVEN.peel.tOven * 60)} after the oven` : `in the oven, ${mpMin(sn.t)}`;
  // 1D: a profile up the stack
  if (dim === 1) {
    const z = r.mesh.z.map(v => v * 1000), isX = MPS.field === 'X', vals = sn[isX ? 'secX' : 'secT'].map(row => row[0] * (isX ? 100 : 1));
    // (the pieces' nodes are the first N + 1 up the stack: the plate's above hold no water)
    const pts = z.map((zz, k) => [vals[k], zz]).filter((p, k) => !isX || k <= mpN());
    const xs = pts.map(p => p[0]), lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.1 || 1;
    title.textContent = `${isX ? 'Water' : 'Temperature'} up the stack at its middle`;
    plotChart(cv, 0.34, { x0: lo - pad, x1: hi + pad, y0: 0, y1: isX ? r.mesh.Hs * 1000 : r.mesh.H * 1000, xl: isX ? 'water (% of the GO)' : 'temperature (°C)', yl: 'height (mm)', xd: isX ? 1 : 0, yd: 1,
      hl: isX ? [] : [{ y: r.mesh.Hs * 1000, c: cssVar('--muted'), t: 'the plate', left: true }], s: [{ p: pts, c: isX ? '#1c7ed6' : cssVar('--heat').trim(), w: 2, dots: false }] });
    lg.innerHTML = `<p class="fv-why">${when}. ${isX ? 'Only the pieces hold water; the plate above is dry.' : `The stack's ${mpN()} pieces below ${(r.mesh.Hs * 1000).toFixed(1)} mm, the aluminium plate above.`}</p>`;
    return;
  }
  // 2D / 3D: a colour map -- the temperature on the section (to scale), the water in the pieces (the stack's height stretched,
  // 2D) or in the middle piece's plane (3D), the pull along the pieces (2D) or in the middle piece's plane (3D)
  const { c, w, h } = setupCanvas(cv, 0.34), m = { l: 56, r: 16, t: 12, b: 34 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  const ink = cssVar('--muted'), line = cssVar('--line');
  c.clearRect(0, 0, w, h); c.font = '12px ' + cssVar('--mono');
  const drawGrid = (xs, zs, val, lut, sc, X0, X1, Z0, Z1) => {
    const X = x => m.l + (x - X0) / (X1 - X0) * pw, Z = z => m.t + ph - (z - Z0) / (Z1 - Z0) * ph;
    for (let k = 0; k < zs.length - 1; k++) for (let i = 0; i < xs.length - 1; i++) {
      const v = (val(k, i) + val(k, i + 1) + val(k + 1, i) + val(k + 1, i + 1)) / 4;
      if (!Number.isFinite(v)) continue;
      c.fillStyle = lutColor(lut, scaleT(sc, v));
      const x0 = X(xs[i]), x1 = X(xs[i + 1]), z0 = Z(zs[k + 1]), z1 = Z(zs[k]);
      c.fillRect(Math.floor(x0), Math.floor(z0), Math.ceil(x1 - x0) + 1, Math.ceil(z1 - z0) + 1);
    }
    return { X, Z };
  };
  const axes = (X0, X1, Z0, Z1, xl, zl, xt, zt) => {
    const tk = v => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(+v.toFixed(1)));
    c.strokeStyle = line; c.strokeRect(m.l, m.t, pw, ph); c.fillStyle = ink;
    c.textAlign = 'center'; for (const v of xt) c.fillText(tk(v), m.l + (v - X0) / (X1 - X0) * pw, h - m.b + 16);
    c.textAlign = 'right'; for (const v of zt) c.fillText(tk(v), m.l - 6, m.t + ph - (v - Z0) / (Z1 - Z0) * ph + 4);
    c.textAlign = 'right'; c.fillText(xl, w - m.r, h - 4); c.textAlign = 'left'; c.fillText(zl, 4, m.t + 2);
  };
  const xs = r.mesh.x.map(v => v * 1000), zs = r.mesh.z.map(v => v * 1000), Hs = r.mesh.Hs * 1000, H = r.mesh.H * 1000;
  if (MPS.field === 'T') {
    const vals = sn.secT, all = vals.flat(), sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 }, lut = mpHeatLut();
    if (sc.max - sc.min < 0.05) { sc.min -= 0.5; sc.max += 0.5; }
    drawGrid(xs, zs, (k, i) => vals[k][i], lut, sc, 0, xs[xs.length - 1], 0, H);
    c.strokeStyle = cssVar('--ink'); c.setLineDash([4, 3]); const zy = m.t + ph - Hs / H * ph; c.beginPath(); c.moveTo(m.l, zy); c.lineTo(m.l + pw, zy); c.stroke(); c.setLineDash([]);
    axes(0, xs[xs.length - 1], 0, H, 'from the middle out (mm)', 'height (mm)', niceTicks(0, xs[xs.length - 1], 6), niceTicks(0, H, 4));
    title.textContent = `Temperature on a section through the stack${dim === 3 ? ' (its middle across)' : ''}`;
    lg.innerHTML = bar(lut, sc, '°C', v => v.toFixed(1)) + `<p class="fv-why">${when}. To scale: the ${mpN()} pieces below the dashed line (${Hs.toFixed(1)} mm), the aluminium plate above; the stack's edge at the right.</p>`;
    return;
  }
  if (MPS.field === 'X') {
    const lut = getLut('seq');
    if (dim === 2) {
      const nz = zs.findIndex(z => z >= Hs - 1e-9) + 1, vals = sn.secX.slice(0, nz), all = vals.flat().map(v => v * 100), sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 };
      drawGrid(xs, zs.slice(0, nz), (k, i) => vals[k][i] * 100, lut, sc, 0, xs[xs.length - 1], 0, Hs);
      axes(0, xs[xs.length - 1], 0, Hs, 'from the middle out (mm)', 'height in the stack (mm)', niceTicks(0, xs[xs.length - 1], 6), niceTicks(0, Hs, 4));
      title.textContent = 'Water in the pieces, a section through the stack';
      lg.innerHTML = bar(lut, sc, '% of the GO', v => v.toFixed(1)) + `<p class="fv-why">${when}. The stack's ${Hs.toFixed(1)} mm drawn tall (its height stretched); the stack's edge at the right, where the water leaves.</p>`;
    } else {
      const sx = r.mesh.sx.map(v => v * 1000), sy = r.mesh.sy.map(v => v * 1000), n1 = sx.length;
      const all = mpFollow().flatMap(i => sn.pieces[i].X.map(v => v * 100)), sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 };
      if (sc.max - sc.min < 1e-4) { sc.min -= 0.05; sc.max += 0.05; }
      mpPlanes(c, w, h, sx, sy, mpFollow().map(i => ({ t: mpPiece(i), v: (k, j) => sn.pieces[i].X[k * n1 + j] * 100 })), lut, sc);
      title.textContent = 'Water in the pieces\' planes (a quarter each)';
      lg.innerHTML = bar(lut, sc, '% of the GO', v => v.toFixed(1)) + `<p class="fv-why">${when}. Each quarter piece from its middle (lower left) to its edges (right and top), where the water leaves.</p>`;
    }
    return;
  }
  // the pull
  if (dim === 2) {
    const strips = mpFollow().map((i, k) => ({ i, p: (sn.pieces[i].strip || []).map(([x, s]) => [x * 1000, s]), c: mpShade('#c2255c', k, 3) }));
    const all = strips.flatMap(s => s.p.map(p => p[1])), lo = Math.min(0, ...all), hi = Math.max(1, ...all);
    plotChart(cv, 0.34, { x0: 0, x1: xs[xs.length - 1], y0: lo * 1.1, y1: hi * 1.1, xl: 'from the middle out (mm)', yl: 'pull along the edge σ_yy (MPa)', xd: 0, yd: 0, hl: [{ y: MAT.film.sigF.v, c: cssVar('--bad'), t: `its strength (${MAT.film.sigF.v} MPa)`, left: true }], s: strips.map(s => ({ p: s.p, c: s.c, w: 2 })) });
    title.textContent = 'The pull along each piece';
    lg.innerHTML = oneDLegend(strips.map(s => [mpPiece(s.i), s.c])) + `<p class="fv-why">${when}. Held flat and free along x, each piece pulls along its edge where it has dried and shrunk (tension) against its wetter middle (compression).</p>`;
    return;
  }
  const sx = r.mesh.sx.map(v => v * 1000), sy = r.mesh.sy.map(v => v * 1000), n1 = sx.length, lut = getLut('div');
  const all = mpFollow().flatMap(i => Array.from(sn.pieces[i].s1 || [])), mx = Math.max(1e-6, ...all.map(Math.abs)), sc = { min: -mx, max: mx, levels: 0 };
  mpPlanes(c, w, h, sx, sy, mpFollow().map(i => ({ t: mpPiece(i), v: (k, j) => (sn.pieces[i].s1 ? sn.pieces[i].s1[k * n1 + j] : 0) })), lut, sc);
  title.textContent = 'The largest principal pull in the pieces (a quarter each)';
  lg.innerHTML = bar(lut, sc, 'MPa (− compression, + tension)', v => v.toFixed(v >= 10 ? 0 : 1)) + `<p class="fv-why">${when}. Held flat by the plate, free in their planes. The film's strength is ${MAT.film.sigF.v} MPa.</p>`;
}
/** The quarter in 3D (MP-W): the temperature (or, the water chosen, the pieces' water) on its outer faces at the moment chosen. */
function mpStackIso(r, sn) {
  const cv = document.getElementById('mpIso'), lg = document.getElementById('mpIsoLg'), A = SWB_ADAPT['film:stack'];
  if (!cv || !sn.T3 || !A) return;
  const o = mpStackInputs(3), isX = MPS.field === 'X', vals = isX ? sn.X3 : sn.T3;
  const { M } = swbMesh(A, 3, o), Hs = r.mesh.Hs, zs = M.coord[2];
  // (the water only in the pieces: the plate's nodes hold none -- the faces there drawn plain)
  const inPieces = id => zs[Math.floor(id / M.stride[2]) % M.nn[2]] <= Hs * (1 + 1e-9);
  const f = id => (isX ? (inPieces(id) ? vals[id] * 100 : NaN) : vals[id]);
  const all = []; for (let k = 0; k < vals.length; k++) { const v = f(k); if (Number.isFinite(v)) all.push(v); }
  const sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 }; if (sc.max - sc.min < 1e-3) { sc.min -= 0.5; sc.max += 0.5; }
  const lut = isX ? getLut('seq') : mpHeatLut();
  swbDrawIso(cv, A, o, 'results', { f, sc, lut });
  const when = sn.stage ? `under the plate in the room, ${mpMin(sn.t - OVEN.peel.tOven * 60)} after the oven` : `in the oven, ${mpMin(sn.t)}`;
  document.getElementById('mpIsoT').textContent = `The quarter in 3D: ${isX ? 'the pieces\' water' : 'temperature'} on its faces`;
  lg.innerHTML = `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${sc.min.toFixed(1)}</span><span>${isX ? '% of the GO' : '°C'}</span><span>${sc.max.toFixed(1)}</span></span></div><p class="fv-why">${when}. Seen from the stack's outer corner: its top (the plate), its two outer sides; its middle, on the mirror planes, behind (dashed edges).</p>`;
}
/** Quarter pieces' planes side by side (x along the line, y across, each from its middle at the lower left), one shared scale. */
function mpPlanes(c, w, h, sx, sy, planes, lut, sc) {
  const X1 = sx[sx.length - 1], Y1 = sy[sy.length - 1], gap = 44, mt = 26, mb = 34, ml = 44;
  const side = Math.max(60, Math.min((w - ml - gap * (planes.length - 1) - 8) / planes.length / Math.max(1, X1 / Y1), h - mt - mb));
  const pw = side * X1 / Y1, ink = cssVar('--ink'), mut = cssVar('--muted');
  const x0s = planes.map((_, n) => ml + n * (pw + gap)), total = ml + planes.length * pw + (planes.length - 1) * gap, off = Math.max(0, (w - total) / 2);
  c.font = '12px ' + cssVar('--mono');
  planes.forEach((pl, n) => {
    const L = x0s[n] + off, X = x => L + x / X1 * pw, Y = y => mt + side - y / Y1 * side;
    for (let k = 0; k < sy.length - 1; k++) for (let i = 0; i < sx.length - 1; i++) {
      const v = (pl.v(k, i) + pl.v(k, i + 1) + pl.v(k + 1, i) + pl.v(k + 1, i + 1)) / 4;
      c.fillStyle = lutColor(lut, scaleT(sc, v));
      const a = X(sx[i]), b = X(sx[i + 1]), y0 = Y(sy[k + 1]), y1 = Y(sy[k]);
      c.fillRect(Math.floor(a), Math.floor(y0), Math.ceil(b - a) + 1, Math.ceil(y1 - y0) + 1);
    }
    c.strokeStyle = cssVar('--line'); c.lineWidth = 1; c.strokeRect(L, mt, pw, side);
    c.fillStyle = ink; c.textAlign = 'left'; c.font = '600 12px ' + cssVar('--sans'); c.fillText(pl.t, L, mt - 8);
    c.font = '12px ' + cssVar('--mono'); c.fillStyle = mut;
    c.textAlign = 'center'; for (const v of niceTicks(0, X1, 3)) c.fillText(fmtNum(v), X(v), mt + side + 15);
    if (n === 0) { c.textAlign = 'right'; for (const v of niceTicks(0, Y1, 3)) c.fillText(fmtNum(v), L - 6, Y(v) + 4); }
  });
  c.fillStyle = mut; c.textAlign = 'center'; c.fillText('along the line from the middle (mm) · across it upward', w / 2, h - 4);
}
/** The same answers, this model against the Results step (press.js: the pieces at the oven's temperature from the start). */
function mpStackCompare(o, r) {
  const el = document.getElementById('mpCompare'), run = typeof stackCurrent === 'function' && stackCurrent() ? STACK.res.runs.find(x => x.where === SHEET.way).stack : null;
  if (!run) { el.innerHTML = ''; return; }
  const s = r.summary, mid = mpMid(), pl = OVEN.peel, xo = s.Xoven.find(q => q.i === mid), xt = s.Xout.find(q => q.i === mid);
  const rows = [
    ['The pieces\' temperature', `the oven's, ${pl.dryT} °C, from the start`, `heats up: the middle piece ${s.ovenEnd.mid.toFixed(1)} °C at the oven's end`],
    ['Middle piece\'s middle dry after', run.dryThrough != null ? mpMin(run.dryThrough) : `over ${pl.tOven} h`, s.dryThrough != null ? mpMin(s.dryThrough / 60) : `not in ${pl.tOven} h`],
    ['Water out of the oven (mean)', mpPct(run.Xend[0]), `${mpPct(xo.mean)} (middle piece)`],
    ['Water when taken out (mean)', mpPct(run.Xend[run.Xend.length - 1]), `${mpPct(xt.mean)} (middle piece)`],
    ['Largest pull, held flat', `${run.peak.MPa.toFixed(0)} MPa`, o.dim === 1 ? 'none at the middle' : `${s.pull.toFixed(0)} MPa`],
  ];
  el.innerHTML = `<h4 class="mp-h">Against the Results step</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Results step <small>press.js: the piece at the oven's temperature</small></th><th scope="col">This ${MP_DIMS[o.dim]} <small>heat, water and stress together</small></th></tr></thead>
    <tbody>${rows.map(([a, b, cc]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${cc}</td></tr>`).join('')}</tbody></table>
    <p class="fv-why">Both models use the same water physics (at the oven's temperature all through, this solver gives the Results step's water: mp-core checks). The difference is the heat: here the stack and its plate heat up from the room, and drying cools them.</p>`;
}
function mpStackCsv() {
  const r = mpCurrent(MPS.dim) ? MPS.res[MPS.dim] : null;
  if (!r) return;
  const rows = [['dimension', 'time (min)', 'stage', 'air (°C)', 'plate top (°C)', 'top piece (°C)', 'middle piece (°C)', 'bottom piece (°C)', 'middle piece at the edge (°C)',
    ...mpFollow().flatMap(i => [`${mpPiece(i)} water, mean (kg/kg)`, `${mpPiece(i)} water, its middle (kg/kg)`, `${mpPiece(i)} pull (MPa)`])]];
  for (const q of r.series) rows.push([MP_DIMS[r.dim], q.t, q.stage ? 'room' : 'oven', q.Tair, q.T.plateTop, q.T.top, q.T.mid, q.T.bottom, q.T.midEdge ?? '', ...mpFollow().flatMap(i => [q.X[i][0], q.X[i][1], q.pull[i]])]);
  downloadCSV(`stack-multiphysics-${MP_DIMS[r.dim]}-${csvStamp()}.csv`, rows);
}

// ---- MP-W: the stack's pages 1D, 2D, 3D (mp-bench-ui.js): its domain, mesh, faces and answers ----
const MP_AL_C = '#8d96a3';   // (the aluminium plate, drawn: a mid grey that reads in either theme)
SWB_ADAPT['film:stack'] = {
  key: 'stack', sk: 'film:stack', t: 'Pre heat treatment', ready: 'mp1', sid: 'mps',
  S: () => MPS,
  inputs: dim => mpStackInputs(dim),
  current: dim => mpCurrent(dim),
  failed: dim => !!(MPS.error[dim] && MPS.key[dim] === mpKeyNow(dim)),
  request: dim => solveArm('mps' + dim),
  // (1D and 2D solve by themselves when their page is shown, as before; 3D on Solve)
  auto: dim => { if (dim < 3 && !mpCurrent(dim) && !(MPS.error[dim] && MPS.key[dim] === mpKeyNow(dim))) mpStackRequest(dim); },
  stop: () => mpStackStop(),
  why: () => 'The stack is solved after the film and the piece cut from it (Peel and wind, Cutting).',
  slow3: 'The 3D takes about a minute',
  dofs: () => 2, coupled: 'temperature and vapour pressure',
  axes: (dim, o) => smpAxes(o),
  axisNames: dim => (dim === 1 ? ['Up the stack (z)'] : dim === 2 ? ['From the middle out (x)', 'Up the stack (z)'] : ['Along the line (x)', 'Across it (y)', 'Up the stack (z)']),
  meshFields: dim => [
    ...(dim > 1 ? [{ k: 'nx', t: dim === 3 ? 'Elements along, middle to edge' : 'Elements from the middle to the edge', min: 2, max: dim === 3 ? 30 : 80, step: 1, int: true, def: MP_MESH_DEF[dim].nx }] : []),
    ...(dim === 3 ? [{ k: 'ny', t: 'Elements across, middle to edge', min: 2, max: 30, step: 1, int: true, def: MP_MESH_DEF[3].ny }] : []),
    ...(dim > 1 ? [{ k: 'grade', t: 'Grading to the edge (largest / smallest)', min: 1, max: 100, step: 1, def: MP_MESH_DEF[dim].grade }] : []),
    { k: 'per', t: 'Pieces in an element, through the stack', min: 1, max: 1000, step: 1, int: true, def: 1 },
    { k: 'nPlate', t: 'Elements through the plate', min: 1, max: 20, step: 1, int: true, def: 4 },
    { k: 'steps', t: 'Time steps a stage (the oven, the room)', min: 5, max: 400, step: 5, int: true, def: MP_MESH_DEF[dim].steps },
  ],
  meshHow: dim => `Linear elements, the flows taken at the nodes (no overshoot); each piece one element through (or the pieces an element holds), the plate graded to its faces${dim > 1 ? ', the pieces\' planes graded toward the stack\'s edges where the water leaves' : ''}. The default is the mesh the solve has always used.`,
  extraMeshes: (dim, o) => (dim === 1 ? 'A piece\'s middle is even: no stress solved in 1D.' : dim === 2 ? `Each followed piece's stress on its own line along it: ${2 * mpStackMesh(2).mesh.nx + 1} nodes.` : `Each followed piece's stress on its own plane: ${(mpStackMesh(3).mesh.nx + 1) * (mpStackMesh(3).mesh.ny + 1)} nodes, plane stress.`),
  layout: (dim, o) => {
    const { hx, hy, Hs, H } = smpAxes(o), W1 = dim === 1 ? H * 0.12 : hx;
    const parts = [{ k: 'go', t: `Pieces (${o.N})`, c: '--go-film', rects: [[0, 0, W1, Hs]], layers: { n: o.N }, label: { t: `${o.N} pieces`, at: dim === 1 ? 'out' : 'in' } },
      { k: 'al', t: 'Aluminium plate', c: MP_AL_C, rects: [[0, Hs, W1, H]], label: { t: 'aluminium plate', at: dim === 1 ? 'out' : 'in' } }];
    if (dim === 3) return { parts, partAt: (x, y, z) => (z <= Hs ? parts[0] : parts[1]), zLines: [Hs], kz: 1 };
    return { x0: 0, x1: W1, z0: 0, z1: H, parts, bands: [{ z0: 0, z1: Hs, share: 0.62 }, { z0: Hs, z1: H, share: 0.38 }],
      mirrors: dim === 2 ? [{ x0: 0, z0: 0, x1: 0, z1: H }] : [],
      dims: dim === 1 ? [{ v: true, at: 0, a: 0, b: Hs, t: `${swbMm(Hs)} mm`, off: -14 }, { v: true, at: 0, a: Hs, b: H, t: `${swbMm(H - Hs)} mm`, off: -14 }]
        : [{ at: 0, a: 0, b: hx, t: `${swbMm(hx)} mm, the middle to the edge`, off: 22 }, { v: true, at: 0, a: 0, b: Hs, t: `${swbMm(Hs)} mm`, off: -14 }, { v: true, at: 0, a: Hs, b: H, t: `${swbMm(H - Hs)} mm`, off: -14 }] };
  },
  domain: (dim, o) => ({ 1: 'the line up through the stack at its middle', 2: 'a section from the stack\'s middle to its edge, the stack taken long across', 3: 'a quarter of the stack, on its two mirror planes' }[dim]),
  domainShort: (dim, o) => { const { hx, hy, H } = smpAxes(o); return dim === 1 ? `${swbMm(H)} mm up the stack` : dim === 2 ? `${swbMm(hx)} × ${swbMm(H)} mm` : `${swbMm(hx)} × ${swbMm(hy)} × ${swbMm(H)} mm`; },
  parts: (dim, o) => {
    const { hx, hy, Hs, H, nEl, nPl } = smpAxes(o);
    return [{ t: 'Pieces', c: '--go-film', mat: 'Dried GO film', rec: 'gofilm', size: `${o.N} × ${swbMm(o.h)} mm thick, ${swbMm(o.Lx)} × ${swbMm(o.Ly)} mm`, how: `${o.N} pieces stacked, ${nEl} element${nEl === 1 ? '' : 's'} through them` },
      { t: 'Plate', c: MP_AL_C, mat: 'Aluminium', rec: 'al', size: `${swbMm(o.plateT)} mm thick, the pieces' size`, how: `on the stack, ${nPl} elements through it` }];
  },
  domainRows: (dim, o) => {
    const { hx, hy, Hs, H } = smpAxes(o);
    return [['Domain', SWB_ADAPT['film:stack'].domain(dim, o)], ['Size', dim === 1 ? `${swbMm(H)} mm high` : dim === 2 ? `${swbMm(hx)} mm (the middle to the edge) × ${swbMm(H)} mm high` : `${swbMm(hx)} × ${swbMm(hy)} mm (a quarter) × ${swbMm(H)} mm high`],
      ['The stack', `${swbMm(Hs)} mm of pieces under ${swbMm(H - Hs)} mm of aluminium`], ['Mirror planes', dim === 1 ? 'none: a line at the middle' : dim === 2 ? 'the stack\'s middle (x = 0)' : 'its middle along and across (x = 0, y = 0)'],
      ['Stands on', OVEN_SHELVES[OVEN.peel.shelf]]];
  },
  geoTiles: (dim, o) => { const { hx, hy, Hs, H } = smpAxes(o); return [['Pieces', `${o.N} × ${swbMm(o.h)} mm`, `${swbMm(Hs)} mm in all`, 'film'], ['Plate', `${swbMm(o.plateT)} mm`, 'aluminium', 'weight'],
    ['Domain', dim === 1 ? `${swbMm(H)} mm` : dim === 2 ? `${swbMm(hx)} × ${swbMm(H)} mm` : `${swbMm(hx)} × ${swbMm(hy)} × ${swbMm(H)}`, dim === 3 ? 'mm, a quarter' : dim === 2 ? 'the section' : 'the line', 'section'], ['Water as cut', `${(o.X0 * 100).toFixed(1)} %`, 'of the GO', 'drop']]; },
  geoNote: (dim, o) => (dim === 1 ? 'Far from the stack\'s edges the water cannot leave along the pieces: the 1D follows it through them, to the underside.' : dim === 2 ? 'The pieces are thin against the plate: Layers stretched draws them taller.' : 'The quarter seen from the stack\'s outer corner: its middle is on the two mirror planes behind.'),
  meshNote: (dim, o) => (dim === 3 ? 'The mesh on the quarter\'s outer faces: the pieces one element each through, the plate graded to its faces.' : 'The pieces one element each through, the plate graded to its faces' + (dim === 2 ? '; along the pieces graded toward the stack\'s edge.' : '.')),
  physics: (dim, o) => {
    const d = MAT.dry, pl = OVEN.peel;
    return [['Heat', 'ρc ∂T/∂t = ∇·(k ∇T) − L ∂S/∂t', `plate: aluminium, k ${o.al.k} W/(m·K); pieces: k ${d.kIn.v} along, ${d.kS.v} through W/(m·K)`],
      ['Water', '∂S/∂t = ∇·(K_v ∇p),  S = ρS · GAB(p / p_sat(T))', `along the pieces K ${(o.go.K * 1e7).toPrecision(3)} × 10⁻⁷, through them ${d.skinK.v} × 10⁻¹² kg/(m·s·Pa); the isotherm at the local temperature`],
      ['Stress', dim === 3 ? 'plane stress in each piece: σ = C(X) (ε − ε*(X, T) − ε_c)' : dim === 2 ? 'along each piece\'s edge: σ_yy = E(X) (ε̄ − ε*(X, T) − ε_c)' : '— (a piece\'s middle is even)', dim === 1 ? '—' : `the film's stiffness and stretch by its water, its expansion ${MAT.film.alphaF.v} × 10⁻⁶ /K; creep at the rate its water sets; held flat by the plate, free in its plane`]];
  },
  coupling: dim => `heat ⇄ water in one system, Newton on both (the latent heat where the water leaves; p_sat at the local temperature)${dim > 1 ? ' → each followed piece\'s stress every step' : ''}.`,
  bcCols: ['Heat', 'Water', 'Stress'],
  faces: (dim, o) => {
    const { hx, hy, Hs, H } = smpAxes(o), pl = OVEN.peel, d = MAT.dry, air = pl.stackAirU > 0 ? `a fan's air at ${pl.stackAirU} m/s` : 'still air', W1 = dim === 1 ? H * 0.12 : hx;
    const heat = '--heat', water = '#1c7ed6', sym = cssVar('--muted'), ink = cssVar('--ink');
    const F = [];
    F.push({ t: 'Plate\'s top', c: cssVar(heat), kind: 'conv', segs: [[[0, H], [W1, H]]], side: 'top', face3: 'z1', at3: (X, Y, Z) => [X * 0.55, Y * 0.55, Z],
      bc: [`the oven's air at ${pl.dryT} °C (${air}, natural convection facing up) + radiation to the walls, ε ${pl.epsPl}; after it, the room's`, 'none (the plate holds no water)', '—'] });
    F.push(pl.shelf === 'solid'
      ? { t: 'Underside', c: ink, kind: 'value', segs: [[[0, 0], [W1, 0]]], side: 'bottom', bc: [`on a solid shelf at the oven's temperature, ${pl.dryT} °C`, 'sealed by the shelf', '—'] }
      : { t: 'Underside', c: cssVar(heat), kind: 'conv', segs: [[[0, 0], [W1, 0]]], side: 'bottom', bc: [`on a wire shelf: the air below (facing down) + radiation, GO ε ${d.emis.v}`, 'its vapour to the air below (by the heat\'s analogy)', '—'] });
    if (dim > 1) {
      F.push({ t: dim === 3 ? 'The stack\'s edges (along and across)' : 'The stack\'s edge', c: water, kind: 'open', segs: [[[hx, 0], [hx, Hs]]], side: 'right', face3: ['x1', 'y1'], where: (x, y, z) => z <= Hs * (1 + 1e-9), at3: (X, Y, Z) => [X, Y * 0.5, Hs * 0.5],
        bc: [`the air (a vertical face, Churchill–Chu) + radiation, GO ε ${d.emis.v}`, 'the room\'s air heated: its vapour pressure', 'free'] });
      F.push({ t: dim === 3 ? 'The plate\'s edges' : 'The plate\'s edge', c: cssVar(heat), kind: 'conv', segs: [[[hx, Hs], [hx, H]]], side: 'right', face3: ['x1', 'y1'], where: (x, y, z) => z > Hs * (1 + 1e-9), at3: (X, Y, Z) => [X * 0.5, Y, (Hs + Z) / 2],
        bc: [`the air (a vertical face) + radiation, ε ${pl.epsPl}`, 'none', '—'] });
      F.push({ t: dim === 3 ? 'Mirror planes (x = 0, y = 0)' : 'Mirror plane (x = 0)', c: sym, kind: 'sym', segs: [[[0, 0], [0, H]]], side: 'left', bc: ['no heat across (symmetry)', 'no water across', 'symmetry'] });
    }
    return F;
  },
  time: (dim, o) => o.stages.map((g, i) => [i === 0 ? 'In the oven' : 'In the room, under the plate', `${(g.tEnd / 3600).toFixed(2)} h`, `the air at ${g.Tair} °C${g.creep ? '; the pieces creep as their water lets them' : ''}`, `${o.steps}`]),
  solver: (dim, o, r) => [['Elements', `linear (${dim === 1 ? 'lines' : dim === 2 ? 'quadrilaterals' : 'hexahedra'}), the flows at the nodes`], ['In time', `BDF2, ${o.steps} steps a stage`],
    ['Heat and water', 'one system, Newton (the matrix banded, Cholesky)'], ['Start', `the room's ${o.Troom} °C; the pieces' water as cut, ${(o.X0 * 100).toFixed(1)} %`],
    ...(r ? [['Balances', mpStackBal(r)], ['Solved in', `${(r.ms / 1000).toFixed(1)} s`]] : [])],
  solveTiles: (dim, o, r) => [['Stages', `${o.stages.length}`, o.stages.map(g => `${(g.tEnd / 3600).toFixed(1)} h`).join(' + '), 'period'], ['Time steps', `${o.steps * o.stages.length}`, `${o.steps} a stage`, 'conv'],
    ['Oven\'s air', `${OVEN.peel.dryT} °C`, OVEN.peel.stackAirU > 0 ? `${OVEN.peel.stackAirU} m/s along it` : 'still air', 'temp'], ['Solved in', r ? `${(r.ms / 1000).toFixed(1)} s` : '—', r ? 'for the inputs as they are' : 'not solved yet', 'play']],
  resultsHTML: dim => mpStackHTML(true),
  renderResults: dim => mpStackRender(),
  csv: dim => { MPS.dim = dim; mpStackCsv(); },
  openInputs: () => { setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } },
};
/** The balances of a solve, in words. */
function mpStackBal(r) {
  const e = Math.abs(r.energy.in - r.energy.held) / Math.max(1e-30, Math.abs(r.energy.in)), u = r.dim === 2 ? ' per m across' : r.dim === 1 ? ' per m²' : ' (the quarter)';
  return `heat in ${(r.energy.in / 1e3).toPrecision(4)} kJ = held ${(r.energy.held / 1e3).toPrecision(4)} kJ (${e < 1e-6 ? 'closes' : `off by ${(e * 100).toFixed(3)} %`}); water out ${(r.water.out * 1e3).toPrecision(4)} g = lost ${(r.water.lostHeld * 1e3).toPrecision(4)} g${u}`;
}
