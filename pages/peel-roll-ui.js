/*
 * peel-roll-ui.js — MP-PEEL on the Peel and wind stage: its 1D page (mp-bench-ui.js), the roll the winder makes, in the
 * steps Geometry › Mesh › Solve › Results. The film as the drying left it at the peel (its thickness, its water, its
 * layers' stiffness and natural strain), wound turn by turn on the winder's core with the winder's pull (peel-mp.js's
 * pmpRoll, in cfd-mp-worker.js): the pressure between the turns and the pull along them; then the roll at rest until it
 * is cut, its heat and water through the turns and the stress their change gives; each turn bent round the roll.
 * It shares the stage's adapter with the 2D (peel-mp-ui.js): each hook goes to the roll's here for the 1D.
 */
/** The 1D's mesh and time settings' defaults (the Mesh step's, editable): turns in an element, time steps on the roll. */
PMP_MESH_DEF[1] = { turns: 1, rsteps: 200 };
const PRL_CORE_C = '#868e96';
/**
 * The roll's inputs: the film at the peel (Peel and wind's film: its thickness, its water, its layers -- each its stiffness
 * at its water and its natural strain from the bonded state, −σ/Q); the roll (the winder's pull, the film on a roll, the
 * core); the time on the roll and the room; the mesh's settings.
 */
function prlInputs() {
  const run = pmpRunNow();
  if (!run || !run.profile || !run.profile.cells.length) return null;
  const fo = filmOpts(), F = fo.film, pl = OVEN.peel, f = MAT.film, d = MAT.dry, m = pmpSet(1);
  const layers = [];
  let z = 0, xt = 0, tt = 0, EA = 0;
  for (const c of [...run.profile.cells].sort((a, b) => a.z0 - b.z0)) {
    const s = 1 / (1 + c.X / F.Xh), Ep = F.Ep * s, Q = Ep / (1 - F.nup);
    layers.push({ t: c.t, Q, en: -c.sig / Q });
    xt += c.X * c.t; tt += c.t; EA += Ep * c.t; z = c.z0 + c.t;
  }
  // (the turn: the film's whole thickness, its wet gel too when it is not dry at the peel; the roll's turns from its length)
  const h = z, R0 = pl.core / 2000, L = pl.rollL, R1 = Math.sqrt(R0 * R0 + L * h / Math.PI), n = Math.max(1, Math.round((R1 - R0) / h));
  const rhoD = MAT.slurry.phiDry.v * MAT.slurry.rhoS.v * 1000, tEnd = pl.rollRest * 3600;
  return { film: run.key, where: run.where, R0, core: { E: pl.coreE * 1e9, nu: pl.coreNu, Ri: Math.max(0, R0 - pl.coreWall / 1000) }, h, n, per: m.turns, Tw: pl.windT,
    Er: f.Er.v * 1e6, Eth: EA / h, nuTr: f.nuR.v, tEnd, steps: tEnd > 0 ? m.rsteps : 0,
    heat: { T0: fo.Troom, k: d.kS.v, rhoc: rhoD * d.cS.v, hOut: pl.rollH, Troom: fo.Troom },
    water: { X0: xt / tt, gab: fo.gab, rhoD, Kv: fo.skinK, rhRoom: fo.rhRoom },
    beta: F.beta, betaT: f.betaT.v, alpha: F.alphaF, alphaT: f.alphaT.v * 1e-6, layers, sigF: F.sigF, len: L, wet: run.wetAtPeel };
}
/** The roll's sizes as the solve takes them: its elements, its outer radius, the core's spring. */
function prlSizes(o) {
  const per = Math.max(1, Math.round(o.per)), nE = Math.ceil(o.n / per), H = per * o.h, R1 = o.R0 + nE * H;
  return { per, nE, H, R1, kC: pmpCoreK(o.core.E, o.core.nu, o.R0, Math.min(o.core.Ri, o.R0 * 0.999)) };
}
const prlMm = v => { const m = v * 1000; return m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2); };
const prlKPa = v => { const k = v / 1000; return (Math.abs(k) >= 100 ? k.toFixed(0) : Math.abs(k) >= 10 ? k.toFixed(1) : k.toFixed(2)).replace(/^-/, '−'); };
const prlH = s => { const hr = s / 3600; return hr >= 10 ? hr.toFixed(0) : hr >= 1 ? hr.toFixed(1) : hr.toFixed(2); };
const prlNeg = t => t.replace(/^-/, '−');
/** The water the room's air leaves in the film: GO's own, the isotherm at the room's humidity and temperature. */
const prlXroom = o => Math.min(pmpGAB(o.water.rhRoom, o.water.gab, o.heat ? o.heat.Troom : undefined), o.water.Xcap ?? Infinity);

// ---- drawing: the roll's end, to scale, and the line out through it (the 1D's domain) drawn wide ----
/**
 * Left, the roll's end to scale: the core (its bore), the turns, the line out through them (the domain) marked; right,
 * that line drawn wide: the core's wall, then the turns to the outer one. what: 'geometry' | 'mesh' | 'solve'.
 */
function prlDraw(cv, o, what) {
  const S = prlSizes(o), { c, w, h } = setupCanvas(cv, 0.42), ink = cssVar('--ink'), mut = cssVar('--muted'), acc = cssVar('--accent') || '#1c7ed6';
  c.clearRect(0, 0, w, h);
  const filmC = cssVar(PMP_FILM_C) || '#6b4f2a', R1 = S.R1, R0 = o.R0, Ri = o.core.Ri;
  // the end view
  const ew = Math.min(w * 0.38, h - 70), cx = 16 + ew / 2 + 8, cy = 20 + ew / 2, sc = ew / 2 / R1;
  const ring = (ra, rb, fill, line) => { c.beginPath(); c.arc(cx, cy, rb * sc, 0, 7); if (ra > 0) c.arc(cx, cy, ra * sc, 7, 0, true); c.fillStyle = fill; c.fill('evenodd'); if (line) { c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, rb * sc, 0, 7); c.stroke(); } };
  ring(R0, R1, swbFill(PMP_FILM_C, 0.34), swbFill(PMP_FILM_C, 0.95));
  ring(Ri, R0, swbFill(PRL_CORE_C, 0.45), swbFill(PRL_CORE_C, 0.95));
  if (Ri > 0) { c.strokeStyle = swbFill(PRL_CORE_C, 0.95); c.beginPath(); c.arc(cx, cy, Ri * sc, 0, 7); c.stroke(); }
  // (the turns where they show apart; else a few rings, faint)
  const px = o.h * sc, step = px >= 3 ? 1 : Math.ceil(o.n / 10);
  c.strokeStyle = swbFill(PMP_FILM_C, 0.5); c.lineWidth = 0.6; c.beginPath();
  for (let k = step; k < o.n; k += step) { const r = (R0 + k * o.h) * sc; c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, 7); }
  c.stroke();
  // the line out through it (the 1D)
  c.strokeStyle = acc; c.lineWidth = 2.4; c.beginPath(); c.moveTo(cx + Ri * sc, cy); c.lineTo(cx + R1 * sc, cy); c.stroke();
  c.font = '11.5px ' + cssVar('--mono'); c.textAlign = 'center';
  outlinedText(c, `Ø ${prlMm(2 * R1)} mm`, cx, cy + ew / 2 + 16, mut);
  // the strip: the line drawn wide (the core's wall a sixth, the turns the rest)
  const x0 = cx + ew / 2 + 46, x1 = w - 24, ys = cy - 26, ye = cy + 26, wc = Ri > 0 ? (x1 - x0) / 6 : 0;
  const Xs = r => (r <= R0 ? x0 + (Ri < R0 ? (r - Ri) / (R0 - Ri) : 1) * wc : x0 + wc + (r - R0) / (R1 - R0) * (x1 - x0 - wc));
  c.fillStyle = swbFill(PRL_CORE_C, 0.45); c.fillRect(x0, ys, wc, ye - ys); c.strokeStyle = swbFill(PRL_CORE_C, 0.95); c.lineWidth = 1.2; c.strokeRect(x0, ys, wc, ye - ys);
  c.fillStyle = swbFill(PMP_FILM_C, what === 'mesh' ? 0.14 : 0.34); c.fillRect(x0 + wc, ys, x1 - x0 - wc, ye - ys); c.strokeStyle = swbFill(PMP_FILM_C, 0.95); c.strokeRect(x0 + wc, ys, x1 - x0 - wc, ye - ys);
  // (the end view's line to the strip: dashed guides)
  c.save(); c.setLineDash([4, 4]); c.strokeStyle = mut; c.lineWidth = 1; c.beginPath(); c.moveTo(cx + R1 * sc, cy); c.lineTo(x0, ys); c.moveTo(cx + R1 * sc, cy); c.lineTo(x0, ye); c.stroke(); c.restore();
  c.font = '600 12px ' + cssVar('--sans'); c.textAlign = 'left';
  if (what === 'mesh') {
    // the elements' ends (every one where they show apart, else every k-th: said below)
    const room = (x1 - x0 - wc) / S.nE, k = room >= 4 ? 1 : Math.ceil(4 / room);
    c.strokeStyle = ink; c.globalAlpha = 0.6; c.lineWidth = 0.7; c.beginPath();
    for (let e = 0; e <= S.nE; e += k) { const x = Xs(R0 + e * S.H); c.moveTo(x, ys); c.lineTo(x, ye); }
    c.stroke(); c.globalAlpha = 1;
    c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut;
    c.fillText(`${S.nE.toLocaleString('en')} elements of ${S.per} turn${S.per > 1 ? 's' : ''} (${pmpUm(S.H)} µm)${k > 1 ? `; every ${k}th end drawn` : ''}. The core: a spring.`, x0, ye + 20);
  } else if (what === 'solve') {
    const faces = prlFaces(o), at = [[Xs(R0), ys - 14], [x1, ys - 14], [cx + R1 * sc * Math.cos(-0.9) + 16, cy + R1 * sc * Math.sin(-0.9) - 10]];
    // (the winder's pull on the outer turn: along it, at the top of the end view)
    const a = -0.9, rx = cx + R1 * sc * Math.cos(a), ry = cy + R1 * sc * Math.sin(a), tx = -Math.sin(a), ty = Math.cos(a);
    c.strokeStyle = faces[2].c; c.fillStyle = faces[2].c; c.lineWidth = 2; c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx - tx * 30, ry - ty * 30); c.stroke();
    const ex = rx - tx * 30, ey = ry - ty * 30, an = Math.atan2(-ty, -tx); c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - 9 * Math.cos(an - 0.4), ey - 9 * Math.sin(an - 0.4)); c.lineTo(ex - 9 * Math.cos(an + 0.4), ey - 9 * Math.sin(an + 0.4)); c.closePath(); c.fill();
    c.lineWidth = 3.2; c.strokeStyle = faces[0].c; c.beginPath(); c.moveTo(Xs(R0), ys); c.lineTo(Xs(R0), ye); c.stroke();
    c.strokeStyle = faces[1].c; c.beginPath(); c.moveTo(x1, ys); c.lineTo(x1, ye); c.stroke();
    faces.forEach((q, i) => { const [qx, qy] = at[i]; c.fillStyle = q.c; c.beginPath(); c.arc(qx, qy, 9, 0, 7); c.fill(); c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), qx, qy + 4); });
  } else {
    if (wc > 34) outlinedText(c, 'core', x0 + 6, cy + 4, ink);
    outlinedText(c, `${o.n.toLocaleString('en')} turns of ${pmpUm(o.h)} µm film`, x0 + wc + 8, cy + 4, ink);
    swbDimLine(c, [Xs(R0), ye + 22], [x1, ye + 22], `${prlMm(R1 - R0)} mm of turns`, false, mut);
    if (wc > 0) swbDimLine(c, [x0, ye + 22], [x0 + wc, ye + 22], `${prlMm(R0 - Ri)} mm`, false, mut);
  }
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
  c.fillText(what === 'mesh' ? 'Right: the line out through the roll, drawn wide; the elements along it.' : `Left: the roll's end to scale (core Ø ${prlMm(2 * R0)} mm). Right: the line out through it (the 1D), drawn wide.`, 8, h - 8);
}
/** The faces and what holds there (the Solve step's table; numbered on the drawing). */
function prlFaces(o) {
  const pl = OVEN.peel;
  return [
    { t: 'The core under the first turn', c: PRL_CORE_C, bc: [`a spring: the core's tube (${pl.coreE} GPa, Ø ${pl.core} mm, its wall ${pl.coreWall} mm) pressed in by the turns; sealed: no water, no heat through it`] },
    { t: 'The outer turn', c: cssVar('--heat') || '#e8590c', bc: [`free: no pressure on it; the room's air: heat to it at ${pl.rollH} W/(m²·K) (${o.heat.Troom} °C), its water to the room's ${(o.water.rhRoom * 100).toFixed(0)} %`] },
    { t: 'Each turn as it is wound', c: '#1c7ed6', bc: [`the winder's pull ${pl.windT} N/m: its hoop stress Tw/h ${(pl.windT / o.h / 1e6).toFixed(2)} MPa, pressing on the turns under it by Tw/r`] },
  ];
}

// ---- the roll's hooks (the stage's adapter sends the 1D's here) ----
const PRL = {
  why: () => 'The roll is solved after the film to the peel (Peel and wind: the film on the web from the oven).',
  dofs: () => 1, coupled: 'the displacement out through the roll',
  axisNames: () => ['Out through the roll (r)'],
  meshFields: () => [
    { k: 'turns', t: 'Turns in an element', min: 1, max: 200, step: 1, int: true, def: PMP_MESH_DEF[1].turns },
    { k: 'rsteps', t: 'Time steps on the roll', min: 10, max: 5000, step: 10, int: true, def: PMP_MESH_DEF[1].rsteps },
  ],
  meshHow: () => 'Linear elements out through the roll, two Gauss points; an element holds this many turns. Winding: each element\'s turns added in turn, their pull pressing on the roll under them (one solve of the roll beneath each). At rest: the heat and the water by finite volumes on the same elements, implicit in time; each step\'s change a natural strain the roll takes.',
  meshStats: (dim, o) => { const S = prlSizes(o); return { nodes: S.nE + 1, elems: S.nE, unknowns: S.nE + 1, band: 1 }; },
  meshTiles: (dim, o) => {
    const S = prlSizes(o);
    return [['Nodes', (S.nE + 1).toLocaleString('en'), 'one unknown at each (out through the roll)', 'mesh'], ['Elements', S.nE.toLocaleString('en'), `linear, ${S.per} turn${S.per > 1 ? 's' : ''} each`, 'grading'],
      ['Element', `${pmpUm(S.H)} µm`, `the film ${pmpUm(o.h)} µm a turn`, 'ratio'], ['Winding', `${S.nE.toLocaleString('en')} solves`, 'one as each element\'s turns go on', 'tune'],
      ['Time steps', o.steps ? String(o.steps) : '—', o.steps ? `${prlH(o.tEnd / o.steps)} h each` : 'no time on the roll', 'period']];
  },
  meshHTML: (dim, o) => {
    const S = prlSizes(o), A = SWB_ADAPT['film:film'], set = swbSettings(A, 1), F = A.meshFields(1);
    return `<div class="swb-tables">
      <section class="swb-card"><h4>${uiBadge('tune')}Mesh and time steps</h4>
        <table class="swb-t swb-set"><tbody>${F.map(f => `<tr><th scope="row"><label for="swbm_${f.k}">${f.t}</label></th><td><input type="number" id="swbm_${f.k}" data-swbm="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${set[f.k]}" aria-label="${f.t}"></td><td class="swb-u"></td><td class="swb-def">${set[f.k] === f.def ? '' : `default ${f.def}`}</td></tr>`).join('')}</tbody></table>
        <p class="fv-why">${PRL.meshHow()}</p></section>
      <section class="swb-card"><h4>${uiBadge('grading')}Out through the roll</h4>
        <table class="swb-t"><thead><tr><th scope="col">Part</th><th scope="col">Elements</th><th scope="col">Each</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
        <tbody><tr><th scope="row">The turns</th><td>${S.nE.toLocaleString('en')}</td><td>${pmpUm(S.H)} µm</td><td>r ${prlMm(o.R0)} mm</td><td>r ${prlMm(S.R1)} mm</td></tr>
          <tr><th scope="row">The core</th><td>—</td><td>a spring, ${(S.kC / 1e9).toFixed(2)} GPa</td><td>r ${prlMm(o.core.Ri)} mm</td><td>r ${prlMm(o.R0)} mm</td></tr></tbody></table>
        <p class="fv-why">Checked: two turns to an element against one give the core's pressure within 0.4 % (2000 turns); the time steps against Crank's series and the slab's for the water and the heat (peel-mp.validate.js).</p></section>
    </div>`;
  },
  extraMeshes: () => '',
  paneTitles: () => ({ geometry: 'The roll, to scale', mesh: 'The mesh', solve: 'The faces and what holds there' }),
  layout: () => ({ parts: [{ k: 'film', t: 'GO film (the turns)', c: PMP_FILM_C, rects: [] }, { k: 'core', t: 'The winder\'s core', c: PRL_CORE_C, rects: [] }] }),
  draw: (cv, dim, o, step) => prlDraw(cv, o, step),
  domain: () => 'the line out through the roll, from the core to the outer turn',
  domainShort: (dim, o) => `${o.n.toLocaleString('en')} turns, Ø ${prlMm(2 * prlSizes(o).R1)} mm`,
  parts: (dim, o) => [
    { t: 'GO film (the turns)', c: PMP_FILM_C, mat: 'Dried GO film', rec: 'gofilm', size: `${o.n.toLocaleString('en')} turns of ${pmpUm(o.h)} µm, ${OVEN.peel.rollL} m`, how: `its stiffness along it ${(o.Eth / 1e9).toFixed(1)} GPa (its layers' at their water), through the roll ${MAT.film.Er.v} MPa` },
    { t: 'The winder\'s core', c: PRL_CORE_C, mat: 'the core (the inputs bar)', rec: null, size: `Ø ${OVEN.peel.core} mm, wall ${OVEN.peel.coreWall} mm`, how: `a spring under the first turn, ${(prlSizes(o).kC / 1e9).toFixed(2)} GPa` }],
  domainRows: (dim, o) => {
    const run = pmpRunNow(), S = prlSizes(o), U = P.U;
    return [['Domain', PRL.domain()], ['The film', `${run ? dryFilmName(run.key) : ''}, the water leaving ${o.where === 'both' ? 'from the top and the underside' : 'from the top only'}; ${pmpUm(o.h)} µm${o.wet ? ', wet inside at the peel' : ''}`],
      ['The roll', `${OVEN.peel.rollL} m of film on a ${OVEN.peel.core} mm core: ${o.n.toLocaleString('en')} turns, Ø ${prlMm(2 * S.R1)} mm${U > 0 ? `, wound in ${prlH(OVEN.peel.rollL / U * 60)} h at ${U} m/min` : ''}`],
      ['On the roll', `${OVEN.peel.rollRest} h until it is cut, in the room (${o.heat.Troom} °C, ${(o.water.rhRoom * 100).toFixed(0)} %)`],
      ['Along its axis', 'free (plane stress): the roll\'s ends are not followed in 1D; the heat and the water go in and out through the outer turn only']];
  },
  geoTiles: (dim, o) => {
    const S = prlSizes(o);
    return [['Roll', `Ø ${prlMm(2 * S.R1)} mm`, `${OVEN.peel.rollL} m on a ${OVEN.peel.core} mm core`, 'section'], ['Turns', o.n.toLocaleString('en'), `of ${pmpUm(o.h)} µm film`, 'film'],
      ['Winder\'s pull', `${OVEN.peel.windT} N/m`, `${(OVEN.peel.windT / o.h / 1e6).toFixed(2)} MPa in a turn`, 'cut'], ['Its water', `${(o.water.X0 * 100).toFixed(1)} %`, `as peeled; the room's ${(prlXroom(o) * 100).toFixed(1)} %`, 'drop'],
      ['On the roll', `${OVEN.peel.rollRest} h`, 'until it is cut', 'period']];
  },
  geoNote: () => 'The film wound top out, as it comes off the web. The 1D follows a line out through the roll: the turns pressed together by the pull of those wound over them, the core pushing back.',
  meshNote: () => 'The roll as it is when wound; while it winds, each element\'s turns are added on the outside in turn.',
  physics: (dim, o) => {
    const f = MAT.film;
    return [['Winding (each turn added)', 'Δp = T_w / r on the roll beneath;  d(r σ_r)/dr − σ_θ = 0;  the new turn σ_θ = T_w / h', `along the turns ${(o.Eth / 1e9).toFixed(1)} GPa, through the roll ${f.Er.v} MPa, ν_θr ${f.nuR.v}; the core a spring`],
      ['Heat', 'ρc ∂T/∂t = (1/r) ∂/∂r (r k ∂T/∂r)', `GO: k ${MAT.dry.kS.v} W/(m·K) through it, c ${MAT.dry.cS.v} J/(kg·K)`],
      ['Water (vapour through the turns)', 'ρ_GO ∂X/∂t = (1/r) ∂/∂r (r K_v ∂(a p_sat)/∂r);  X = GAB(a, T)', `K_v ${MAT.dry.skinK.v}×10⁻¹² kg/(m·s·Pa); GAB X_m ${MAT.dry.gabXm.v}, C ${MAT.dry.gabC.v} at ${MAT.dry.gabT0 ? MAT.dry.gabT0.v : 25} °C (its binding heat ${MAT.dry.gabHc ? MAT.dry.gabHc.v : 0} kJ/mol), K ${MAT.dry.gabK.v}`],
      ['Stress at rest', 'the same equilibrium; natural strain along β ΔX + α ΔT, through β_t ΔX + α_t ΔT', `β ${f.beta.v}, β_t ${f.betaT.v} per kg/kg; α ${f.alphaF.v}, α_t ${f.alphaT.v} ×10⁻⁶/K`],
      ['A turn bent round the roll', 'σ(z) = Q (e₀ + z / r − ε*(z)), its force the roll\'s hoop force', 'each layer\'s Q = E/(1 − ν) at its water, as the Peel page\'s roll']];
  },
  coupling: () => 'the winding first (the roll as wound), then each time step: the heat, the water at that heat, the stress their change gives; the stiffnesses held (linear).',
  faces: (dim, o) => prlFaces(o),
  time: (dim, o) => [['Winding', `${o.n.toLocaleString('en')} turns`, `each element's turns added in turn (${prlSizes(o).nE.toLocaleString('en')} solves)`, String(prlSizes(o).nE)],
    ['On the roll', `${OVEN.peel.rollRest} h`, o.steps ? 'the heat and the water through the turns; the outer turn to the room' : 'none: cut as wound', o.steps ? String(o.steps) : '—']],
  solver: (dim, o, r) => [['Method', 'linear elements out through the roll (two Gauss points); a tridiagonal solve each'], ['Winding', 'Hakiel\'s accretion, linear: each turn\'s pull on the roll beneath, the stiffnesses held'],
    ['Heat and water', 'finite volumes on the elements, implicit Euler; the water by Newton on its activity (the GAB isotherm)'], ['Converged', 'the water: its activity\'s change below 10⁻¹¹ a step'],
    ['Checked', 'the winding against the closed form summed turn by turn; the water and the heat against the slab\'s series; swelling against Lamé'],
    ...(r ? [['Last solve', `${(r.ms / 1000).toFixed(2)} s`]] : [])],
  solveTiles: (dim, o, r) => {
    const S = prlSizes(o);
    return [['Core', `${(S.kC / 1e9).toFixed(2)} GPa`, 'its spring under the first turn', 'weight'], ['Outer turn', `${(OVEN.peel.windT / o.h / 1e6).toFixed(2)} MPa`, 'its hoop stress, T_w / h', 'cut'],
      ['Room\'s water', `${(prlXroom(o) * 100).toFixed(1)} %`, `the film's at ${(o.water.rhRoom * 100).toFixed(0)} % humidity`, 'drop'], ['Solve', r ? `${(r.ms / 1000).toFixed(2)} s` : '—', r ? `${S.nE} elements, ${o.steps} steps` : 'not solved', 'tune']];
  },
  resultsHTML: () => prlHTML(),
  renderResults: () => prlRender(),
  csv: () => prlCsv(),
  tools: (dim, step) => (step === 'solve' || step === 'results') && typeof dmpWhere === 'function' ? `<div class="seg seg-sm" role="tablist" aria-label="Where the water left the film" id="pmpWhere">${[['top', 'Water: top'], ['both', 'Top and underside']].map(([k, t]) => `<button type="button" role="tab" data-pmpwhere="${k}" aria-selected="${dmpWhere() === k}">${t}</button>`).join('')}</div>` : '',
};
// (the stage's adapter: each hook to the roll's for the 1D, the peel front's for the 2D)
{
  const A = SWB_ADAPT['film:film'], two = { ...A };
  const byDim = ['dofs', 'axisNames', 'meshFields', 'meshHow', 'meshStats', 'meshTiles', 'meshHTML', 'extraMeshes', 'paneTitles', 'layout', 'domain', 'domainShort', 'parts', 'domainRows', 'geoTiles', 'geoNote', 'meshNote',
    'physics', 'coupling', 'faces', 'time', 'solver', 'solveTiles', 'resultsHTML', 'renderResults', 'csv', 'tools'];
  for (const k of byDim) A[k] = (dim, ...a) => (dim === 1 ? PRL[k] : two[k])(dim, ...a);
  A.draw = (cv, dim, o, step) => (dim === 1 ? PRL.draw : two.draw)(cv, dim, o, step);
  A.why = () => (PMS.dim === 1 ? PRL.why() : two.why());
  for (const [k, one] of [['coupled', PRL.coupled], ['ready', 'mp6'], ['timeTitle', 'Time'], ['timeCols', ['Stage', 'For', 'Conditions', 'Steps']]]) Object.defineProperty(A, k, { get: () => (PMS.dim === 1 ? one : two[k]), configurable: true });
}

// ---- the answers (the Results step) ----
function prlHTML() {
  const pane = (id, icon, title, aria) => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="mp-sec mp-bench" id="prlSec" aria-label="The roll: its answers">
    <div class="stats mp-stats" id="prlStats"></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('prl1', 'weight', 'The pressure between the turns', 'The pressure between the turns against the radius, as wound and at the end of the time on the roll')}
      ${pane('prl2', 'cut', 'The pull along the turns', 'The hoop stress along the turns against the radius, as wound and at the end, and the film\'s largest stress bent round the roll')}
    </div>
    <div class="dry-grid mp-grid mp-grid2">
      <figure class="pane mp-pane"><figcaption>${uiBadge('drop')}<span>Through the roll at times</span><span class="vp-spacer"></span><span class="seg seg-sm" role="tablist" aria-label="What is shown" id="prlField"></span></figcaption>
        <canvas id="prl3" role="img" aria-label="The water or the temperature through the roll at times on the roll"></canvas><div class="pane-legend" id="prl3Lg"></div></figure>
      ${pane('prl4', 'period', 'On the roll: the core\'s pressure against time', 'The pressure on the core against time on the roll')}
    </div>
    <div class="mp-compare" id="prlCompare"></div>
  </section>`;
}
function prlWireSec(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (t && t.dataset.prlfield) { PMS.rollF = t.dataset.prlfield; prlRender(); }
  });
}
/** Each turn's surface stress bent round the roll at its radius, its hoop force the roll's (at the end; as wound). */
function prlTurns(o, st) {
  return st.map((s, e) => {
    const r = o.R0 + (e + 0.5) * prlSizes(o).H;
    return pmpTurnStress(o.layers, 1 / r, s * o.h);
  });
}
function prlRender() {
  const sec = document.getElementById('prlSec');
  if (!sec) return;
  if (!sec.dataset.wired) prlWireSec(sec);
  const o = pmpInputs(1), r = pmpCurrent(1) ? PMS.res[1] : null, ids = ['prl1', 'prl2', 'prl3', 'prl4'];
  if (!o || !r) {
    paneEmptyIds(ids, paneWhy('prl1'));
    for (const id of ids) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    const st = document.getElementById('prlStats');
    if (st) st.innerHTML = pmpFailed(1) ? `<p class="dry-msg">${pill(`The 1D could not be solved: ${dryEsc(PMS.error[1])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${PMS.busy ? 'Solving the 1D: its answers here when it is done.' : 'Not solved for the inputs as they are.'}</p>`;
    ['prlCompare', 'prlField'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    return;
  }
  const tw = prlTurns(o, r.end.st);
  prlTiles(o, r, tw); prlPressure(o, r); prlPull(o, r, tw); prlField(o, r); prlCore(o, r); prlCompare(o, r);
}
function prlTiles(o, r, tw) {
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const sF = o.sigF / 1e6, smax = Math.max(...tw.map(q => q.max)) / 1e6, kmax = tw.findIndex(q => q.max / 1e6 === smax), pMax = Math.max(...r.end.sr.map(v => -v));
  const stMin = Math.min(...r.end.st), slack = r.end.st.filter(v => v < 0).length * r.per, last = r.series.length ? r.series[r.series.length - 1] : null;
  const Xm = last ? last.X.reduce((a, v, i) => a + v * r.r[i], 0) / r.r.reduce((a, v) => a + v, 0) : o.water.X0;
  const gaps = (r.gaps || []).reduce((a, v) => a + v, 0), firstGap = (r.gaps || []).findIndex(v => v);
  document.getElementById('prlStats').innerHTML = [
    tile('Pressure on the core', `${prlKPa(r.coreP.wound)} kPa`, r.series.length ? `as wound; ${prlKPa(r.coreP.end)} kPa after ${OVEN.peel.rollRest} h` : 'as wound', 'weight'),
    tile('Most between turns', `${prlKPa(pMax)} kPa`, 'at the end, anywhere in the roll', 'weight'),
    tile('Inner turns', stMin < 0 ? prlNeg(`${(stMin / 1e6).toFixed(2)} MPa`) : 'in tension', stMin < 0 ? `${slack.toLocaleString('en')} turns pressed along: they may buckle (star)` : 'every turn still pulled along', 'cut', stMin < 0 ? 'warn' : ''),
    tile('The film bent round the roll', `${smax.toFixed(0)} MPa`, `largest, ${kmax <= 0 ? 'at the core' : `${(kmax * r.per).toLocaleString('en')} turns out`}; strength ${sF.toFixed(0)} MPa`, 'cut', smax >= sF ? 'bad' : smax >= 0.8 * sF ? 'warn' : ''),
    tile('Turns apart', gaps ? `${gaps.toLocaleString('en')} gaps` : r.onCore === 0 ? 'off the core' : 'none', gaps ? `from ${(firstGap * r.per).toLocaleString('en')} turns out: the turns there lifted apart (a loose roll)${r.onCore === 0 ? '; off the core' : ''}` : r.onCore === 0 ? 'the roll lifted off its core' : 'every turn pressed on the next', 'section', gaps || r.onCore === 0 ? 'warn' : ''),
    tile('Its water', `${(Xm * 100).toFixed(2)} %`, `${r.series.length ? `after ${OVEN.peel.rollRest} h; ` : ''}${(o.water.X0 * 100).toFixed(2)} % as peeled, the room's ${(prlXroom(o) * 100).toFixed(2)} %`, 'drop'),
  ].join('');
}
const prlRmm = r => r.r.map(v => v * 1000);
/** The pressure between the turns against the radius: as wound, at the end. */
function prlPressure(o, r) {
  const cv = document.getElementById('prl1'), lg = document.getElementById('prl1Lg');
  if (!cv) return;
  const x = prlRmm(r), ink = cssVar('--ink'), acc = cssVar('--accent') || '#1c7ed6';
  const S = [{ p: x.map((v, i) => [v, -r.wound.sr[i] / 1000]), c: ink, w: 2, l: 'as wound' }];
  if (r.series.length) S.push({ p: x.map((v, i) => [v, -r.end.sr[i] / 1000]), c: acc, w: 2, dash: [5, 3], l: `after ${OVEN.peel.rollRest} h on the roll` });
  const ys = S.flatMap(q => q.p.map(p => p[1])), yt = pmpTicks(Math.min(0, ...ys), Math.max(...ys), 5), xt = pmpTicks(x[0] - (x[1] - x[0]) / 2, x[x.length - 1], 5);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'radius (mm; the core at the left)', yl: 'pressure between the turns (kPa)',
    vl: [{ x: o.R0 * 1000, c: pmpMut(), t: 'the core' }], s: S });
  const gaps = (r.gaps || []).reduce((a, v) => a + v, 0);
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">Each turn pressed by the pull of every turn wound over it; the core gives a little under them (${(prlSizes(o).kC / 1e9).toFixed(2)} GPa). None at the outer turn.${gaps ? ` On the roll, where the turns lifted apart (${gaps.toLocaleString('en')} gaps), none: they cannot pull on each other.` : ''}</p>`;
}
/** The hoop stress along the turns, and the film's largest (bent round the roll, its top out) at the end. */
function prlPull(o, r, tw) {
  const cv = document.getElementById('prl2'), lg = document.getElementById('prl2Lg');
  if (!cv) return;
  const x = prlRmm(r), ink = cssVar('--ink'), bad = cssVar('--bad').trim(), go = cssVar(PMP_FILM_C).trim() || '#6b4f2a', sF = o.sigF / 1e6;
  const S = [{ p: x.map((v, i) => [v, r.wound.st[i] / 1e6]), c: ink, w: 2, l: 'along the turns, as wound' }];
  if (r.series.length) S.push({ p: x.map((v, i) => [v, r.end.st[i] / 1e6]), c: cssVar('--accent') || '#1c7ed6', w: 2, dash: [5, 3], l: `along the turns, after ${OVEN.peel.rollRest} h` });
  S.push({ p: x.map((v, i) => [v, tw[i].max / 1e6]), c: go, w: 2, l: 'the film\'s largest, bent round the roll' });
  // (the strength drawn when it is near enough the stresses to read them both; else said)
  const ys = S.flatMap(q => q.p.map(p => p[1])), hiD = Math.max(...ys), showF = sF <= 3 * Math.max(hiD, 1e-9), yt = pmpTicks(Math.min(0, ...ys), showF ? Math.max(hiD, sF * 1.05) : hiD, 5), xt = pmpTicks(x[0] - (x[1] - x[0]) / 2, x[x.length - 1], 5);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'radius (mm)', yl: 'stress along the film (MPa)',
    hl: [...(showF ? [{ y: sF, c: bad, t: `its strength (${sF.toFixed(0)} MPa)`, left: true }] : []), { y: 0, c: pmpMut(), t: '' }], s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">${showF ? '' : `Its strength, ${sF.toFixed(0)} MPa, is far above: ${(hiD / sF * 100).toFixed(0)} % of it at most. `}Each turn keeps the pull it was wound with less what the turns over it take back as they press it in; below zero a turn is pushed along and can buckle. Bent round the roll, the film's top is stretched more the nearer the core.</p>`;
}
/** The water (or the temperature) through the roll at times on the roll. */
function prlField(o, r) {
  const cv = document.getElementById('prl3'), lg = document.getElementById('prl3Lg'), seg = document.getElementById('prlField');
  if (!cv) return;
  const fk = PMS.rollF === 'T' ? 'T' : 'X';
  seg.innerHTML = [['X', 'Water'], ['T', 'Temperature']].map(([k, t]) => `<button type="button" role="tab" data-prlfield="${k}" aria-selected="${fk === k}">${t}</button>`).join('');
  if (!r.series.length) { paneEmptyIds(['prl3'], 'No time on the roll: it is cut as wound.'); lg.innerHTML = ''; return; }
  const x = prlRmm(r), cols = ['#adb5bd', '#74c0fc', '#339af0', '#1c7ed6', '#1864ab'];
  const S = r.series.map((q, i) => ({ p: x.map((v, k) => [v, fk === 'X' ? q[fk][k] * 100 : q[fk][k]]), c: cols[Math.min(i, cols.length - 1)], w: 2, l: `${prlH(q.t)} h` }));
  const ys = S.flatMap(q => q.p.map(p => p[1])), lo = Math.min(...ys), hi = Math.max(...ys), pad = hi - lo < 1e-9 ? Math.max(0.05 * Math.abs(hi), 0.01) : 0;
  const yt = pmpTicks(lo - pad, hi + pad, 5), xt = pmpTicks(x[0] - (x[1] - x[0]) / 2, x[x.length - 1], 5);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'radius (mm)', yl: fk === 'X' ? 'water (% of its GO)' : 'temperature (°C)', s: S });
  const Xr = prlXroom(o) * 100;
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, ''])) + `<p class="fv-why">${fk === 'X' ? `As peeled ${(o.water.X0 * 100).toFixed(2)} %; the room's air would leave ${Xr.toFixed(2)} %. It goes in and out through the outer turn only: through ${o.n.toLocaleString('en')} turns it is slow.` : `The film reaches the winder at the room's temperature; it stays there unless the room changes.`}</p>`;
}
/** The pressure on the core against time on the roll (and the largest between any turns). */
function prlCore(o, r) {
  const cv = document.getElementById('prl4'), lg = document.getElementById('prl4Lg');
  if (!cv) return;
  if (!r.hist || !r.hist.length) { paneEmptyIds(['prl4'], 'No time on the roll: it is cut as wound.'); lg.innerHTML = ''; return; }
  const ink = cssVar('--ink'), H = r.hist, S = [{ p: H.map(q => [q.t / 3600, q.coreP / 1000]), c: ink, w: 2, l: 'on the core' }, { p: H.map(q => [q.t / 3600, q.pMax / 1000]), c: cssVar('--accent') || '#1c7ed6', w: 2, dash: [5, 3], l: 'the most between any turns' }];
  const ys = S.flatMap(q => q.p.map(p => p[1])), lo = Math.min(0, ...ys), hi = Math.max(...ys), yt = pmpTicks(lo, hi * 1.02, 5), xt = pmpTicks(0, H[H.length - 1].t / 3600, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'time on the roll (h)', yl: 'pressure (kPa)', s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + '<p class="fv-why">As the turns take up water they thicken (pressing the roll tighter) and lengthen (loosening it: the outer turns lift apart); as they dry, the other way.</p>';
}
/** The same answers against independent ones: the closed-form winding (summed turn by turn) and the Peel page's roll. */
function prlCompare(o, r) {
  const el = document.getElementById('prlCompare');
  if (!el) return;
  const S = prlSizes(o), rows = [];
  // the closed form at the first element's middle: each element's pull Tw/r on the roll beneath, summed (ν_θr = 0 only)
  if (!(o.nuTr > 0)) {
    let sr = 0; const r0 = r.r[0];
    for (let e = 0; e < S.nE; e++) { const rIn = o.R0 + e * S.H; let p = 0; for (let j = 0; j < S.per; j++) p += o.Tw / (rIn + (j + 0.5) * o.h); sr += e === 0 ? -p / 2 : pmpRollIncrement(o.R0, rIn, o.Er, o.Eth, S.kC, p, r0).sr; }
    rows.push(['Pressure next to the core, as wound', `${prlKPa(-sr)} kPa`, `${prlKPa(-r.wound.sr[0])} kPa`, 'u = C₁ r^g + C₂ r^−g each turn on the roll beneath, summed']);
  } else rows.push(['Pressure next to the core, as wound', '—', `${prlKPa(-r.wound.sr[0])} kPa`, 'the closed form holds for ν_θr = 0']);
  rows.push(['The outer turn\'s pull', `${(o.Tw / o.h / 1e6).toFixed(3)} MPa`, `${(r.wound.st[r.wound.st.length - 1] / 1e6).toFixed(3)} MPa`, 'T_w / h: wound with it, nothing over it']);
  const ref = pmpRunNow(), core = pmpTurnStress(o.layers, 2 / (OVEN.peel.core / 1000), 0);
  if (ref && ref.roll) rows.push(['The film at the core, bent only', `${(ref.roll.sMax / 1e6).toFixed(1)} MPa`, `${(core.max / 1e6).toFixed(1)} MPa`, 'the Peel page\'s roll (film.js): its layers bent round the core']);
  el.innerHTML = `<h4 class="mp-h">Against independent answers</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Independent</th><th scope="col">This 1D</th><th scope="col">How</th></tr></thead>
    <tbody>${rows.map(([p, q, s, t]) => `<tr><th scope="row">${p}</th><td>${q}</td><td>${s}</td><td>${t}</td></tr>`).join('')}</tbody></table>`;
}
function prlCsv() {
  const r = pmpCurrent(1) ? PMS.res[1] : null, o = pmpInputs(1);
  if (!r || !o) return;
  const tw = prlTurns(o, r.end.st), last = r.series.length ? r.series[r.series.length - 1] : null;
  const rows = [['radius (mm)', 'pressure as wound (kPa)', 'hoop as wound (MPa)', 'pressure at the end (kPa)', 'hoop at the end (MPa)', 'film largest bent (MPa)', 'water at the end (%)', 'temperature at the end (°C)', 'a gap under it (1)']];
  r.r.forEach((v, i) => rows.push([v * 1000, -r.wound.sr[i] / 1000, r.wound.st[i] / 1e6, -r.end.sr[i] / 1000, r.end.st[i] / 1e6, tw[i].max / 1e6, last ? last.X[i] * 100 : '', last ? last.T[i] : '', r.gaps ? r.gaps[i] : '']));
  rows.push([]); rows.push(['time (h)', 'pressure on the core (kPa)', 'most between turns (kPa)', 'mean water (%)', 'mean temperature (°C)', 'gaps', 'on the core (1)']);
  for (const q of r.hist || []) rows.push([q.t / 3600, q.coreP / 1000, q.pMax / 1000, q.X * 100, q.T, q.gaps, q.onCore]);
  downloadCSV(`roll-1D-${csvStamp()}.csv`, rows);
}
