/*
 * peel-roll3-ui.js — MP-PEEL on the Peel and wind stage: its 3D page (mp-bench-ui.js), the roll the winder makes in 3D, in
 * the steps Geometry › Mesh › Solve › Results. The roll as the 1D winds it (its turns, the core, the room), now with its
 * width: a quarter of its end and half its width (roll3-mp.js in cfd-mp-worker.js). Its heat and its water at rest until it
 * is cut, out through the turns (as the 1D) and along them from the roll's ends (the film in its plane, the water along
 * the turns' faces). It shares the stage's adapter with the 1D (peel-roll-ui.js) and the 2D (peel-mp-ui.js).
 */
// (20 × 16 elements and 80 steps: the roll's water and heat as 30 × 24 and 120 give them to 4–5 digits, in a sixth of the time)
PMP_MESH_DEF[3] = { r3nr: 20, r3gr: 50, r3nth: 4, r3nz: 16, r3gz: 20, r3steps: 80 };
/** The roll's 3D inputs: the 1D's roll (its turns, the core, its heat and water through the turns, the room, the time on
 *  the roll) with its width (the web's), the film's heat conduction and its water along the turns; the mesh's settings. */
function pr3Inputs() {
  const b = typeof prlInputs === 'function' ? prlInputs() : null;
  if (!b || !(b.tEnd > 0)) return null;
  const m = pmpSet(3), W = webWidth() / 1000;
  return { R0: b.R0, n: b.n, h: b.h, W, film: b.film, where: b.where,
    heat: { T0: b.heat.T0, k: b.heat.k, kIn: MAT.dry.kIn.v, rhoc: b.heat.rhoc, hOut: b.heat.hOut, Troom: b.heat.Troom },
    water: { X0: b.water.X0, gab: b.water.gab, rhoD: b.water.rhoD, Kv: b.water.Kv, KvIn: MAT.film.rollK.v * 1e-7, rhRoom: b.water.rhRoom },
    tEnd: b.tEnd, steps: m.r3steps, snapAt: [0, 0.01, 0.1, 1].map(f => f * b.tEnd), latent: true,
    mesh: { nr: m.r3nr, gr: m.r3gr, nth: m.r3nth, nz: m.r3nz, gz: m.r3gz } };
}
const pr3R1 = o => o.R0 + o.n * o.h;
const pr3Node = (nn, i, j, k) => { const order = [0, 1, 2].sort((a, b) => nn[a] - nn[b]), st = [0, 0, 0]; let s = 1; for (const d of order) { st[d] = s; s *= nn[d]; } return i * st[0] + j * st[1] + k * st[2]; };

// ---- drawing: the roll from its end (the quarter) and its section along its axis (r up, z along, drawn wide) ----
function pr3Draw(cv, o, what) {
  const { c, w, h } = setupCanvas(cv, 0.42), ink = cssVar('--ink'), mut = cssVar('--muted'), acc = cssVar('--accent') || '#1c7ed6';
  c.clearRect(0, 0, w, h);
  const R0 = o.R0, R1 = pr3R1(o), Ri = Math.max(0, R0 - OVEN.peel.coreWall / 1000);
  // the end view: the roll's annulus, the quarter solved shaded
  const ew = Math.min(w * 0.3, h - 70), cx = 16 + ew / 2 + 8, cy = 22 + ew / 2, sc = ew / 2 / R1;
  c.beginPath(); c.arc(cx, cy, R1 * sc, 0, 7); c.arc(cx, cy, R0 * sc, 7, 0, true); c.fillStyle = swbFill(PMP_FILM_C, 0.2); c.fill('evenodd');
  c.beginPath(); c.moveTo(cx + R0 * sc, cy); c.lineTo(cx + R1 * sc, cy); c.arc(cx, cy, R1 * sc, 0, -Math.PI / 2, true); c.lineTo(cx, cy - R0 * sc); c.arc(cx, cy, R0 * sc, -Math.PI / 2, 0, false); c.closePath(); c.fillStyle = swbFill(PMP_FILM_C, 0.55); c.fill();
  c.beginPath(); c.arc(cx, cy, R0 * sc, 0, 7); c.arc(cx, cy, Ri * sc, 7, 0, true); c.fillStyle = swbFill(PRL_CORE_C, 0.45); c.fill('evenodd');
  c.strokeStyle = swbFill(PMP_FILM_C, 0.95); c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, R1 * sc, 0, 7); c.stroke();
  c.font = '11.5px ' + cssVar('--mono'); c.textAlign = 'center'; outlinedText(c, `Ø ${prlMm(2 * R1)} mm, ${(o.W * 1000).toFixed(0)} mm wide`, cx, cy + ew / 2 + 16, mut);
  // the section: z (the width, from its middle to its end) across, r (the core to the outer turn) up, drawn tall
  const x0 = cx + ew / 2 + 50, x1 = w - 28, yb = h - 60, yt = 30, Z = z => x0 + z / (o.W / 2) * (x1 - x0), Rr = r => yb - (r - R0) / (R1 - R0) * (yb - yt);
  c.fillStyle = swbFill(PRL_CORE_C, 0.45); c.fillRect(x0, yb, x1 - x0, 10);
  c.fillStyle = swbFill(PMP_FILM_C, what === 'mesh' ? 0.14 : 0.34); c.fillRect(x0, yt, x1 - x0, yb - yt); c.strokeStyle = swbFill(PMP_FILM_C, 0.95); c.lineWidth = 1.2; c.strokeRect(x0, yt, x1 - x0, yb - yt);
  c.save(); c.setLineDash([5, 4]); c.strokeStyle = mut; c.beginPath(); c.moveTo(x0, yt - 10); c.lineTo(x0, yb + 14); c.stroke(); c.restore();
  if (what === 'mesh') {
    const A = r3Axes({ ...o, R1 }), rs = mpAxisEdges(A.axes[0], R0).edges, zs = mpAxisEdges(A.axes[2]).edges;
    c.strokeStyle = ink; c.globalAlpha = 0.55; c.lineWidth = 0.7; c.beginPath();
    let last = -1e9; for (const r of rs) { const y = Rr(r); if (Math.abs(y - last) < 2.5 && r !== rs[rs.length - 1]) continue; last = y; c.moveTo(x0, y); c.lineTo(x1, y); }
    last = -1e9; for (const z of zs) { const x = Z(z); if (x - last < 2.5 && z !== zs[zs.length - 1]) continue; last = x; c.moveTo(x, yt); c.lineTo(x, yb); }
    c.stroke(); c.globalAlpha = 1;
    c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
    c.fillText(`${o.mesh.nr} elements out through the turns (finer to the outer turn), ${o.mesh.nz} along the width (finer to the end), ${o.mesh.nth} round the quarter.`, x0, yb + 30);
  } else if (what === 'solve') {
    const F = pr3Faces(o), at = [[(x0 + x1) / 2, yt - 14], [x1 + 14, (yt + yb) / 2], [(x0 + x1) / 2, yb + 22], [x0 - 14, (yt + yb) / 2]];
    c.lineWidth = 3.2;
    const seg = (q, xa, ya, xb, yb2) => { c.strokeStyle = q.c; c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb2); c.stroke(); };
    seg(F[0], x0, yt, x1, yt); seg(F[1], x1, yt, x1, yb); seg(F[2], x0, yb, x1, yb);
    F.forEach((q, i) => { const [qx, qy] = at[i]; c.fillStyle = q.c; c.beginPath(); c.arc(qx, qy, 9, 0, 7); c.fill(); c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), qx, qy + 4); });
  } else {
    c.font = '600 12px ' + cssVar('--sans'); c.textAlign = 'left';
    outlinedText(c, `${o.n.toLocaleString('en')} turns, ${prlMm(R1 - R0)} mm`, x0 + 8, (yt + yb) / 2 + 4, ink);
    swbDimLine(c, [x0, yb + 26], [x1, yb + 26], `${(o.W * 500).toFixed(0)} mm: the middle to the roll's end`, false, mut);
    outlinedText(c, 'core', x0 + 8, yb + 9, ink);
  }
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
  c.fillText(`Left: the roll from its end, the quarter solved dark. Right: its section along the axis, the turns drawn ${Math.round((yb - yt) / ((R1 - R0) / (o.W / 2) * (x1 - x0)))}× taller.`, 8, h - 8);
}
function pr3Faces(o) {
  const pl = OVEN.peel, heat = cssVar('--heat').trim() || '#e8590c';
  const room = `the room's air: heat at ${pl.rollH} W/(m²·K) to ${o.heat.Troom} °C; its water held at the room's ${(o.water.rhRoom * 100).toFixed(0)} % humidity`;
  return [{ t: 'The outer turn', c: heat, bc: [room] }, { t: 'The roll\'s end (the film\'s edges)', c: '#1c7ed6', bc: [room + ' (the turns\' edges)'] },
    { t: 'The core under the first turn', c: PRL_CORE_C, bc: ['sealed: no heat, no water through it'] }, { t: 'Mirror planes (the width\'s middle; the quarter\'s sides)', c: cssVar('--muted'), bc: ['nothing across (symmetry)'] }];
}

// ---- the hooks (the stage's adapter sends the 3D's here) ----
const PR3 = {
  why: () => 'The roll in 3D is solved after the film to the peel (Peel and wind), with time on the roll (the inputs bar: After the oven).',
  dofs: () => 2, coupled: 'temperature and vapour pressure',
  axisNames: () => ['Out through the turns (r)', 'Round the roll (θ, a quarter)', 'Along its width (z, middle to end)'],
  meshFields: () => [
    { k: 'r3nr', t: 'Elements out through the turns', min: 4, max: 200, step: 1, int: true, def: PMP_MESH_DEF[3].r3nr },
    { k: 'r3gr', t: 'Grading to the outer turn (largest / smallest)', min: 1, max: 1000, step: 1, def: PMP_MESH_DEF[3].r3gr },
    { k: 'r3nth', t: 'Elements round the quarter', min: 2, max: 24, step: 1, int: true, def: PMP_MESH_DEF[3].r3nth },
    { k: 'r3nz', t: 'Elements along the width, middle to end', min: 2, max: 200, step: 1, int: true, def: PMP_MESH_DEF[3].r3nz },
    { k: 'r3gz', t: 'Grading to the roll\'s end (largest / smallest)', min: 1, max: 1000, step: 1, def: PMP_MESH_DEF[3].r3gz },
    { k: 'r3steps', t: 'Time steps on the roll', min: 10, max: 2000, step: 10, int: true, def: PMP_MESH_DEF[3].r3steps },
  ],
  meshHow: () => 'Linear hexahedra on the quarter of the roll\'s end (a block bent round the axis), half its width; the heat stored and the water held at the nodes (lumped). Graded to the outer turn and to the roll\'s end, where the room reaches in. Time: second order (BDF2), the first step a thousandth of the time on the roll, each the same factor longer.',
  meshStats: (dim, o) => { const n = (o.mesh.nr + 1) * (o.mesh.nth + 1) * (o.mesh.nz + 1); return { nodes: n, elems: o.mesh.nr * o.mesh.nth * o.mesh.nz, unknowns: 2 * n, band: 2 * (o.mesh.nr + 1) * (o.mesh.nth + 1) }; },
  meshTiles: (dim, o) => {
    const s = PR3.meshStats(3, o), A = r3Axes({ ...o, R1: pr3R1(o) }), rs = mpAxisEdges(A.axes[0], o.R0).edges, zs = mpAxisEdges(A.axes[2]).edges;
    return [['Nodes', s.nodes.toLocaleString('en'), 'temperature and vapour pressure at each', 'mesh'], ['Elements', s.elems.toLocaleString('en'), 'linear hexahedra', 'grading'],
      ['At the outer turn', `${((rs[rs.length - 1] - rs[rs.length - 2]) / o.h).toFixed(1)} turns`, 'its smallest element', 'ratio'], ['At the end', `${prlMm(zs[zs.length - 1] - zs[zs.length - 2])} mm`, 'its smallest along the width', 'ratio'],
      ['Time steps', String(o.steps), `${prlH(o.tEnd)} h on the roll`, 'period']];
  },
  meshHTML: (dim, o) => {
    const A = SWB_ADAPT['film:film'], set = swbSettings(A, 3), F = A.meshFields(3);
    return `<div class="swb-tables"><section class="swb-card"><h4>${uiBadge('tune')}Mesh and time steps</h4>
      <table class="swb-t swb-set"><tbody>${F.map(f => `<tr><th scope="row"><label for="swbm_${f.k}">${f.t}</label></th><td><input type="number" id="swbm_${f.k}" data-swbm="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${set[f.k]}" aria-label="${f.t}"></td><td class="swb-u"></td><td class="swb-def">${set[f.k] === f.def ? '' : `default ${f.def}`}</td></tr>`).join('')}</tbody></table>
      <p class="fv-why">${PR3.meshHow()}</p></section>
      <section class="swb-card"><h4>${uiBadge('grading')}Checked</h4><p class="fv-why">roll3-mp.validate.js: along the width against Crank's slab series (0.04 %), out through the turns against a fine radial finite-volume solve (0.3 %), the roll's own water and heat with its ends sealed against the 1D roll (within the water half a turn gives up; 1 % of the temperature), nothing made or lost sealed.</p></section></div>`;
  },
  extraMeshes: () => '',
  paneTitles: () => ({ geometry: 'The roll, from its end and along it', mesh: 'The mesh on its section', solve: 'The faces and what holds there' }),
  layout: () => ({ parts: [{ k: 'film', t: 'GO film (the turns)', c: PMP_FILM_C, rects: [] }, { k: 'core', t: 'The winder\'s core', c: PRL_CORE_C, rects: [] }] }),
  draw: (cv, dim, o, step) => pr3Draw(cv, o, step),
  domain: () => 'a quarter of the roll\'s end and half its width, from the core to the outer turn',
  domainShort: (dim, o) => `Ø ${prlMm(2 * pr3R1(o))} × ${(o.W * 1000).toFixed(0)} mm`,
  parts: (dim, o) => [
    { t: 'GO film (the turns)', c: PMP_FILM_C, mat: 'Dried GO film', rec: 'gofilm', size: `${o.n.toLocaleString('en')} turns of ${pmpUm(o.h)} µm, ${(o.W * 1000).toFixed(0)} mm wide`, how: `heat through ${o.heat.k}, along ${o.heat.kIn} W/(m·K); water through ${(o.water.Kv * 1e12).toPrecision(3)}×10⁻¹², along the turns ${(o.water.KvIn * 1e7).toPrecision(3)}×10⁻⁷ kg/(m·s·Pa)` },
    { t: 'The winder\'s core', c: PRL_CORE_C, mat: 'the core (the inputs bar)', rec: null, size: `Ø ${OVEN.peel.core} mm`, how: 'sealed: no heat, no water through it' }],
  domainRows: (dim, o) => [['Domain', PR3.domain()], ['The roll', `${OVEN.peel.rollL} m of film on a ${OVEN.peel.core} mm core: ${o.n.toLocaleString('en')} turns, Ø ${prlMm(2 * pr3R1(o))} mm`], ['Its width', `${(o.W * 1000).toFixed(0)} mm (the web's: Coating's inputs)`],
    ['On the roll', `${OVEN.peel.rollRest} h until it is cut, in the room (${o.heat.Troom} °C, ${(o.water.rhRoom * 100).toFixed(0)} %)`], ['Round the roll', 'nothing changes (the turns alike all round): the quarter, its sides mirrors']],
  geoTiles: (dim, o) => [['Roll', `Ø ${prlMm(2 * pr3R1(o))} mm`, `${(o.W * 1000).toFixed(0)} mm wide`, 'section'], ['Turns', o.n.toLocaleString('en'), `of ${pmpUm(o.h)} µm film`, 'film'],
    ['Its water', `${(o.water.X0 * 100).toFixed(1)} %`, `as peeled; the room's ${(prlXroom(o) * 100).toFixed(1)} %`, 'drop'], ['On the roll', `${OVEN.peel.rollRest} h`, 'until it is cut', 'period']],
  geoNote: () => 'The 1D follows a line out through the roll far from its ends; the 3D adds the ends, where the room reaches the film\'s edges.',
  meshNote: () => 'Out through the turns (up) and along the width (across), on the section at the quarter\'s side.',
  physics: (dim, o) => [['Heat', 'ρc ∂T/∂t = ∇·(K ∇T) + L ∂S/∂t;  K = diag(k_r, k_r, k_z)', `through the turns ${o.heat.k}, along them ${o.heat.kIn} W/(m·K); the water's latent heat`],
    ['Water (vapour)', '∂S/∂t = ∇·(K_v ∇p);  S = ρ_D X(p / p_sat(T)) (GAB)', `through the turns ${(o.water.Kv * 1e12).toPrecision(3)}×10⁻¹², along the turns' faces ${(o.water.KvIn * 1e7).toPrecision(3)}×10⁻⁷ kg/(m·s·Pa) (the Film card)`]],
  coupling: () => 'heat ⇄ water in one system, Newton on both each step (the isotherm at the local temperature, the latent heat).',
  faces: (dim, o) => pr3Faces(o),
  time: (dim, o) => [['On the roll', `${prlH(o.tEnd)} h`, 'from as wound (the 1D\'s start): the room at the outer turn and the ends', String(o.steps)]],
  solver: (dim, o, r) => [['Method', 'FE (linear hexahedra), heat and vapour pressure together, Newton; banded Cholesky'], ['In time', `BDF2, ${o.steps} steps from ${prlH(o.tEnd / 1000)} h`],
    ['Checked', 'Crank\'s slab along the width; a radial finite-volume solve; the 1D roll (roll3-mp.validate.js)'], ...(r ? [['Solved in', `${(r.ms / 1000).toFixed(2)} s`]] : [])],
  solveTiles: (dim, o, r) => [['Room', `${o.heat.Troom} °C`, `${(o.water.rhRoom * 100).toFixed(0)} % humidity`, 'temp'], ['Along the turns', `${(o.water.KvIn * 1e7).toPrecision(3)}`, '×10⁻⁷ kg/(m·s·Pa)', 'drop'],
    ['Time', `${prlH(o.tEnd)} h`, `${o.steps} steps`, 'period'], ['Solve', r ? `${(r.ms / 1000).toFixed(2)} s` : '—', r ? 'for the inputs as they are' : 'not solved', 'tune']],
  resultsHTML: () => pr3HTML(),
  renderResults: () => pr3Render(),
  csv: () => pr3Csv(),
  tools: (dim, step) => PRL.tools(dim, step),
};
// (the stage's adapter: the 3D's hooks beside the 1D's and the 2D's)
{
  const A = SWB_ADAPT['film:film'];
  const byDim = ['dofs', 'axisNames', 'meshFields', 'meshHow', 'meshStats', 'meshTiles', 'meshHTML', 'extraMeshes', 'paneTitles', 'layout', 'domain', 'domainShort', 'parts', 'domainRows', 'geoTiles', 'geoNote', 'meshNote',
    'physics', 'coupling', 'faces', 'time', 'solver', 'solveTiles', 'resultsHTML', 'renderResults', 'csv', 'tools'];
  for (const k of byDim) { const before = A[k]; A[k] = (dim, ...a) => (dim === 3 ? PR3[k] : before)(dim, ...a); }
  const draw = A.draw; A.draw = (cv, dim, o, step) => (dim === 3 ? PR3.draw : draw)(cv, dim, o, step);
  const why = A.why; A.why = () => (PMS.dim === 3 ? PR3.why() : why());
  for (const [k, three] of [['coupled', PR3.coupled], ['ready', 'mp6'], ['timeTitle', 'Time'], ['timeCols', ['Stage', 'For', 'Conditions', 'Steps']]]) {
    const d = Object.getOwnPropertyDescriptor(A, k), prev = d && d.get ? d.get : () => d && d.value;
    Object.defineProperty(A, k, { get: () => (PMS.dim === 3 ? three : prev()), configurable: true });
  }
}

// ---- the answers ----
function pr3HTML() {
  const pane = (id, icon, title, aria, extra = '') => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}<span id="${id}T">${title}</span>${extra}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  const chips = '<span class="vp-spacer"></span><span class="seg seg-sm" role="tablist" aria-label="The moment shown" id="pr3Snap"></span><span class="seg seg-sm" role="tablist" aria-label="What the map shows" id="pr3F"></span>';
  return `<section class="mp-sec mp-bench" id="pr3Sec" aria-label="The roll in 3D: its answers"><div class="stats mp-stats" id="pr3Stats"></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('pr31', 'drop', 'Its water against time', 'The roll\'s water against time on it: its mean, at the middle of its width and at its end')}
      ${pane('pr32', 'section', 'Along its width', 'The water along the roll\'s width at the end of the time: at the outer turn and halfway through the turns')}
    </div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('pr33', 'section', 'On its section', 'A map of the water or the temperature on the roll\'s section along its axis at the moment chosen', chips)}
      ${pane('pr34', 'temp', 'Its temperature against time', 'The roll\'s temperature against time: its mean, at the middle and at its end')}
    </div><div class="mp-compare" id="pr3Compare"></div></section>`;
}
function pr3Render() {
  const sec = document.getElementById('pr3Sec');
  if (!sec) return;
  if (!sec.dataset.wired) { sec.dataset.wired = '1'; sec.addEventListener('click', e => { const t = e.target.closest && e.target.closest('button'); if (!t) return; if (t.dataset.pr3snap != null) { PMS.r3snap = +t.dataset.pr3snap; pr3Render(); } else if (t.dataset.pr3f) { PMS.r3f = t.dataset.pr3f; pr3Render(); } }); }
  const o = pr3Inputs(), r = pmpCurrent(3) ? PMS.res[3] : null, ids = ['pr31', 'pr32', 'pr33', 'pr34'];
  if (!o || !r) {
    paneEmptyIds(ids, paneWhy('pr31'));
    for (const id of ids) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    const st = document.getElementById('pr3Stats');
    if (st) st.innerHTML = pmpFailed(3) ? `<p class="dry-msg">${pill(`The 3D could not be solved: ${dryEsc(PMS.error[3])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${PMS.busy ? 'Solving the 3D: its answers here when it is done.' : 'Not solved for the inputs as they are.'}</p>`;
    return;
  }
  const H = r.hist, last = H[H.length - 1], Xr = prlXroom(o);
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  // (how far in from the end the water moved: along the width at mid-radius, where it changed by over a tenth of the end's change)
  const nn = r.mesh.nn, zs = r.mesh.coord[2], iM = Math.floor((nn[0] - 1) / 2), sn = r.snaps[r.snaps.length - 1], X0 = o.water.X0;
  const dEnd = sn.X[pr3Node(nn, iM, 0, nn[2] - 1)] - X0; let zIn = 0;
  for (let k = nn[2] - 1; k >= 0; k--) { if (Math.abs(sn.X[pr3Node(nn, iM, 0, k)] - X0) > 0.1 * Math.abs(dEnd)) zIn = zs[zs.length - 1] - zs[k]; }
  document.getElementById('pr3Stats').innerHTML = [
    tile('Its water, mean', `${(last.Xmean * 100).toFixed(3)} %`, `after ${prlH(o.tEnd)} h; ${(X0 * 100).toFixed(3)} % as wound, the room's ${(Xr * 100).toFixed(2)} %`, 'drop'),
    tile('At its middle', `${(last.Xmid * 100).toFixed(3)} %`, 'halfway through the turns, the width\'s middle', 'drop'),
    tile('At its end', `${(last.Xend * 100).toFixed(3)} %`, 'halfway through the turns, at the film\'s edge', 'drop', Math.abs(last.Xend - last.Xmid) > 0.01 ? 'warn' : ''),
    tile('From the end in', Math.abs(dEnd) > 1e-9 ? `${prlMm(zIn)} mm` : '—', 'where its water moved (over a tenth of the end\'s change)', 'section'),
    tile('Its temperature', `${last.Tmean.toFixed(2)} °C`, `mean, after ${prlH(o.tEnd)} h; the room's ${o.heat.Troom} °C`, 'temp'),
  ].join('');
  // against time (a log scale)
  const lg10 = Math.log10, Hs = H.filter(q => q.t > 0), th = q => lg10(q.t / 3600), d0 = Math.floor(th(Hs[0])), d1 = Math.ceil(lg10(o.tEnd / 3600)), xt = []; for (let d = d0; d <= d1; d++) xt.push(d);
  const tf = v => { const s = Math.pow(10, v); return s >= 1 ? String(+s.toPrecision(3)) : s.toPrecision(1); };
  const chart = (id, keys, yl, f, note) => {
    const cv = document.getElementById(id), lg = document.getElementById(id + 'Lg');
    const S = keys.map(([k, l, col, dash]) => ({ p: Hs.map(q => [th(q), f(q[k])]), c: col, w: 2, l, ...(dash ? { dash: [5, 3] } : {}) }));
    const ys = S.flatMap(q => q.p.map(p => p[1])), lo = Math.min(...ys), hi = Math.max(...ys), pad = hi - lo < 1e-9 ? Math.max(Math.abs(hi) * 0.01, 1e-3) : 0, yt = pmpTicks(lo - pad, hi + pad, 5);
    plotChart(cv, FILM_ASPECT, { x0: d0, x1: d1, y0: yt[0], y1: yt[yt.length - 1], xticks: xt, yticks: yt, xf: tf, yf: v => String(+v.toPrecision(4)), xl: 'time on the roll (h, a log scale)', yl, s: S });
    lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">${note}</p>`;
  };
  // (does the water along the turns reach the width's middle in the time on the roll? then the 1D, which has no ends,
  //  does not stand for this roll's middle)
  const reach = Math.abs(dEnd) > 1e-9 && zIn >= 0.9 * zs[zs.length - 1];
  chart('pr31', [['Xmean', 'the roll, mean', cssVar('--ink')], ['Xmid', 'the width\'s middle', '#1c7ed6', true], ['Xend', 'the roll\'s end', cssVar('--heat').trim()]], 'water (% of its GO)', v => v * 100,
    `Halfway through the turns. The water goes in and out through the outer turn and along the turns from the roll's ends. ${reach ? `Along the turns it reaches the width's middle within the ${prlH(o.tEnd)} h: the whole roll follows its ends.` : `Along the turns it moves ${prlMm(zIn)} mm in from the ends in ${prlH(o.tEnd)} h: the middle beyond that follows the 1D.`}`);
  chart('pr34', [['Tmean', 'the roll, mean', cssVar('--ink')], ['Tmid', 'the width\'s middle', '#1c7ed6', true], ['Tend', 'the roll\'s end', cssVar('--heat').trim()]], 'temperature (°C)', v => v, 'The film reaches the winder at the room\'s temperature; with the latent heat of the water it takes up or gives off.');
  // along the width at the end
  const cv2 = document.getElementById('pr32'), lg2 = document.getElementById('pr32Lg'), zmm = zs.map(z => z * 1000);
  const line = i => zmm.map((z, k) => [z, sn.X[pr3Node(nn, i, 0, k)] * 100]);
  const S2 = [{ p: line(nn[0] - 1), c: cssVar('--heat').trim(), w: 2, l: 'the outer turn' }, { p: line(iM), c: '#1c7ed6', w: 2, l: 'halfway through the turns' }, { p: line(0), c: cssVar('--ink'), w: 2, dash: [5, 3], l: 'next to the core' }];
  const ys2 = S2.flatMap(q => q.p.map(p => p[1])), lo2 = Math.min(...ys2), hi2 = Math.max(...ys2), pad2 = hi2 - lo2 < 1e-9 ? 0.01 : 0, yt2 = pmpTicks(lo2 - pad2, hi2 + pad2, 5), xt2 = pmpTicks(0, zmm[zmm.length - 1], 5);
  plotChart(cv2, FILM_ASPECT, { x0: 0, x1: xt2[xt2.length - 1], y0: yt2[0], y1: yt2[yt2.length - 1], xticks: xt2, yticks: yt2, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'from the width\'s middle to the roll\'s end (mm)', yl: 'water (% of its GO)', s: S2 });
  lg2.innerHTML = oneDLegend(S2.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">After ${prlH(o.tEnd)} h on the roll. The room's air would leave ${(Xr * 100).toFixed(2)} %.</p>`;
  // the section map
  const snaps = r.snaps; if (!(PMS.r3snap >= 0 && PMS.r3snap < snaps.length)) PMS.r3snap = snaps.length - 1;
  const fk = PMS.r3f === 'T' ? 'T' : 'X';
  document.getElementById('pr3Snap').innerHTML = snaps.map((s, i) => `<button type="button" role="tab" data-pr3snap="${i}" aria-selected="${i === PMS.r3snap}">${prlH(s.t)} h</button>`).join('');
  document.getElementById('pr3F').innerHTML = [['X', 'Water'], ['T', 'Temperature']].map(([k, t]) => `<button type="button" role="tab" data-pr3f="${k}" aria-selected="${k === fk}">${t}</button>`).join('');
  const s3 = snaps[PMS.r3snap], rs = r.mesh.coord[0], val = (i, k) => (fk === 'X' ? s3.X[pr3Node(nn, i, 0, k)] * 100 : s3.T[pr3Node(nn, i, 0, k)]);
  let lo3 = Infinity, hi3 = -Infinity; for (let i = 0; i < nn[0]; i++) for (let k = 0; k < nn[2]; k++) { const v = val(i, k); lo3 = Math.min(lo3, v); hi3 = Math.max(hi3, v); }
  if (hi3 - lo3 < 1e-6) { lo3 -= 0.01; hi3 += 0.01; }
  const lut = fk === 'X' ? getLut('seq') : mpHeatLut(), sc = { min: lo3, max: hi3, levels: 0 };
  const cv3 = document.getElementById('pr33'), { c, w, h } = setupCanvas(cv3, 0.42), m = { l: 56, r: 16, t: 14, b: 34 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  c.clearRect(0, 0, w, h);
  const X = z => m.l + z / zs[zs.length - 1] * pw, Y = rr => m.t + ph - (rr - rs[0]) / (rs[rs.length - 1] - rs[0]) * ph;
  for (let i = 0; i < nn[0] - 1; i++) for (let k = 0; k < nn[2] - 1; k++) {
    const v = (val(i, k) + val(i + 1, k) + val(i, k + 1) + val(i + 1, k + 1)) / 4;
    c.fillStyle = lutColor(lut, scaleT(sc, v)); c.fillRect(Math.floor(X(zs[k])), Math.floor(Y(rs[i + 1])), Math.ceil(X(zs[k + 1]) - X(zs[k])) + 1, Math.ceil(Y(rs[i]) - Y(rs[i + 1])) + 1);
  }
  c.strokeStyle = cssVar('--line'); c.strokeRect(m.l, m.t, pw, ph);
  c.font = '12px ' + cssVar('--mono'); c.fillStyle = cssVar('--muted'); c.textAlign = 'center';
  for (const v of niceTicks(0, zmm[zmm.length - 1], 5)) c.fillText(fmtNum(v), X(v / 1000), h - m.b + 18);
  c.textAlign = 'right'; c.fillText('outer', m.l - 6, m.t + 10); c.fillText('core', m.l - 6, m.t + ph); c.fillText('from the width\'s middle to the end (mm)', w - m.r, h - 2);
  document.getElementById('pr33T').textContent = `On its section: ${fk === 'X' ? 'water' : 'temperature'}, ${prlH(s3.t)} h`;
  document.getElementById('pr33Lg').innerHTML = `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${lo3.toFixed(fk === 'X' ? 3 : 2)}</span><span>${fk === 'X' ? '% of its GO' : '°C'}</span><span>${hi3.toFixed(fk === 'X' ? 3 : 2)}</span></span></div><p class="fv-why">The turns from the core (bottom) to the outer turn (top), drawn tall; the roll's end at the right.</p>`;
  // against the 1D
  const el = document.getElementById('pr3Compare'), one = pmpCurrent(1) ? PMS.res[1] : null;
  const rows = [];
  if (one && one.hist && one.hist.length) { const q1 = one.hist[one.hist.length - 1]; rows.push(['The roll\'s mean water at the end', `${(q1.X * 100).toFixed(3)} % (the 1D, no ends)`, `${(last.Xmean * 100).toFixed(3)} %; at the width's middle ${(last.Xmid * 100).toFixed(3)} %`, reach ? 'the water along the turns reaches the width\'s middle: the roll follows its ends, not the 1D' : `the middle, beyond ${prlMm(zIn)} mm from the ends, follows the 1D; the ends add what reaches in along the turns`]); }
  else rows.push(['The 1D roll', 'solve the 1D for the same inputs to set it beside this', '—', '']);
  el.innerHTML = `<h4 class="mp-h">Against the 1D roll</h4><table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">1D</th><th scope="col">This 3D</th><th scope="col">How</th></tr></thead><tbody>${rows.map(([a, b, cc, d]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${cc}</td><td>${d}</td></tr>`).join('')}</tbody></table>`;
}
function pr3Csv() {
  const r = pmpCurrent(3) ? PMS.res[3] : null;
  if (!r) return;
  const rows = [['time (h)', 'mean water (%)', 'middle water (%)', 'end water (%)', 'mean temperature (°C)', 'middle (°C)', 'end (°C)']];
  for (const q of r.hist) rows.push([q.t / 3600, q.Xmean * 100, q.Xmid * 100, q.Xend * 100, q.Tmean, q.Tmid, q.Tend]);
  const sn = r.snaps[r.snaps.length - 1], nn = r.mesh.nn; rows.push([]); rows.push(['r (mm)', 'z (mm)', 'water at the end (%)', 'temperature at the end (°C)']);
  for (let i = 0; i < nn[0]; i++) for (let k = 0; k < nn[2]; k++) { const n = pr3Node(nn, i, 0, k); rows.push([r.mesh.coord[0][i] * 1000, r.mesh.coord[2][k] * 1000, sn.X[n] * 100, sn.T[n]]); }
  downloadCSV(`roll-3D-${csvStamp()}.csv`, rows);
}
