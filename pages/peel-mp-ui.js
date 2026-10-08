/*
 * peel-mp-ui.js — MP-PEEL on the Peel and wind stage: its 2D page (mp-bench-ui.js), in the steps Geometry › Mesh › Solve ›
 * Results: the peel front, a section along the line where the film leaves the web, solved in peel-mp.js (in
 * cfd-mp-worker.js) at the hand's angle and the winder's. The film as the drying left it at the peel (film.js's layers:
 * each its water and its stress on the web); the web under it, held; the hold between them a cohesive layer that gives
 * way; the arm turning through the angle. The Peel page itself (film.js) is the stage's Results. The 1D (the roll the
 * winder makes) is peel-roll-ui.js's, on the same adapter and solve state.
 */
const PMS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, again: null, ang: 0, view: 'front', fview: 'near', rollF: 'X' };
/** The mesh's settings' defaults (the Mesh step's, editable): elements through the film and the web, each next element's
 *  growth along, the elements along the arm per bending length. */
const PMP_MESH_DEF = { 2: { nzF: 4, nzW: 4, grow: 1.15, armN: 24 } };
const PMP_FILM_C = '--go-film', PMP_WEB_C = '--fibre', PMP_HOLD_C = '#c2255c';
const pmpSet = dim => (typeof swbSettings === 'function' && SWB_ADAPT['film:film'] ? swbSettings(SWB_ADAPT['film:film'], dim) : PMP_MESH_DEF[dim]);
/** The angles solved: the hand's, then the winder's lowest, middle and highest (each once, whole degrees). */
function pmpAngles() {
  const pl = OVEN.peel, a = [pl.peelDeg, pl.windLo, (pl.windLo + pl.windHi) / 2, pl.windHi].map(v => Math.round(v));
  return a.filter((v, i) => a.indexOf(v) === i);
}
/** The film run the 2D takes: the film the Peel page shows, the water leaving as the drying's multiphysics takes it. */
function pmpRunNow() {
  if (typeof filmCurrent !== 'function' || !filmCurrent() || !FILM.res) return null;
  const w = typeof dmpWhere === 'function' ? dmpWhere() : 'top', runs = FILM.res.runs;
  return runs.find(r => r.key === DRY.sel && r.where === w) || runs.find(r => r.key === 'web' && r.where === w) || null;
}
/**
 * The 2D's inputs: the film's layers at the peel from the web up (film.js's: each layer's thickness, its stiffness at
 * its water -- softer with water, the Film card's X_h -- and its natural strain from the bonded state, −σ/Q), the wet
 * gel between a bottom skin and a top one when the film is not dry at the peel; the web (the Film card's); the hold (its
 * energy and its strength); the angles; the mesh's settings.
 */
function pmpInputs(dim) {
  // (the 1D: the roll, peel-roll-ui.js)
  if (dim === 1) return typeof prlInputs === 'function' ? prlInputs() : null;
  // (the 3D: the roll with its ends, peel-roll3-ui.js)
  if (dim === 3) return typeof pr3Inputs === 'function' ? pr3Inputs() : null;
  if (dim !== 2) return null;
  const run = pmpRunNow();
  if (!run || !run.profile || !run.profile.cells.length) return null;
  const fo = filmOpts(), F = fo.film, W = fo.web, g = fo.gel, m = pmpSet(dim), nuG = g.nu ?? 0.45;
  const cells = [];
  let z = 0;
  for (const c of [...run.profile.cells].sort((a, b) => a.z0 - b.z0)) {
    if (c.z0 > z + 1e-12) cells.push({ t: c.z0 - z, Ep: g.Eg, Et: g.Eg, nup: nuG, nupt: nuG, Gpt: g.Eg / (2 * (1 + nuG)), en: 0, gel: 1 });
    const f = 1 / (1 + c.X / F.Xh), Ep = F.Ep * f;
    cells.push({ t: c.t, Ep, Et: F.Et * f, nup: F.nup, nupt: F.nupt, Gpt: F.Gpt * f, en: -c.sig / (Ep / (1 - F.nup)), X: c.X });
    z = c.z0 + c.t;
  }
  return { film: run.key, where: run.where, h: z, cells, web: { tw: W.tw, Ew: W.Ew, Et: W.Ew * W.soft, nuw: W.nuw, nupt: W.nupt ?? 0.1, G: W.Ew * W.soft / 2 },
    hold: { Gi: F.Gi, sig: MAT.film.sigI.v * 1e6 }, angles: pmpAngles(), mesh: { nzF: m.nzF, nzW: m.nzW, grow: m.grow, armN: m.armN } };
}
const pmpKeyNow = dim => { const o = pmpInputs(dim); return o ? JSON.stringify(o) : null; };
const pmpCurrent = dim => !!PMS.res[dim] && PMS.key[dim] === pmpKeyNow(dim);
const pmpFailed = dim => !!(PMS.error[dim] && PMS.key[dim] === pmpKeyNow(dim));

/** Solve a dimension (one at a time; a request while busy runs next). */
function pmpRequest(dim) {
  const key = pmpKeyNow(dim);
  if (!key) return;
  if (PMS.key[dim] === key && PMS.res[dim]) { solveTake('pmp' + dim); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('pmp' + dim)) return;
  if (PMS.busy) { if (PMS.pending !== key) PMS.again = dim; return; }
  solveTake('pmp' + dim);
  const o = pmpInputs(dim);
  PMS.busy = true; PMS.bdim = dim; PMS.pending = key; PMS.prog = null; PMS.again = null;
  const id = ++PMS.id;
  if (!PMS.worker) PMS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { PMS.busy = false; PMS.pending = null; PMS.bdim = null; if (PMS.again) { const a = PMS.again; PMS.again = null; pmpRequest(a); } if (typeof swbRefresh === 'function') swbRefresh('film:film'); };
  PMS.worker.onmessage = e => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.progress) { PMS.prog = msg.progress; if (typeof swbOn === 'function' && swbOn('film:film')) swbProgress(); return; }
    PMS.key[dim] = key;
    if (msg.ok) { PMS.res[dim] = { ...msg.res, ms: msg.ms }; PMS.error[dim] = null; } else { PMS.res[dim] = null; PMS.error[dim] = msg.error; }
    done();
  };
  PMS.worker.onerror = ev => { PMS.key[dim] = key; PMS.res[dim] = null; PMS.error[dim] = ev.message || 'the multiphysics worker failed'; PMS.worker = null; done(); };
  PMS.worker.postMessage({ id, kind: dim === 1 ? 'peel1' : dim === 3 ? 'peel3' : 'peel2', o });
}
/** Stop the solve (New, Open): its worker ended, what was asked next dropped. */
function pmpStop() {
  if (PMS.worker) { PMS.worker.terminate(); PMS.worker = null; }
  Object.assign(PMS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}
/** Wait for a dimension's solve (the report, the tests): true when solved. */
async function pmpWait(dim = 2) {
  if (typeof filmWait === 'function' && !(await filmWait())) return false;
  for (let k = 0; k < 12000; k++) {
    if (!PMS.busy) { if (pmpCurrent(dim)) return true; if (pmpFailed(dim)) return false; if (!solveAsked('pmp' + dim)) return false; pmpRequest(dim); }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- the section as the solve sets it up (peel-mp.js's pmpPlan and pmpMesh on the main thread: the same mesh) ----
const PMP_PLAN = new Map();
/** The set-up at an angle (the hand's by default): the film's numbers, the hold's law, the lengths, the mesh. */
function pmpPlanAt(o, deg = o.angles[0]) {
  const key = JSON.stringify([o, deg]);
  if (PMP_PLAN.has(key)) return PMP_PLAN.get(key);
  const cells = o.cells.map(c => ({ t: c.t, C: pmpTI(c.Ep, c.Et, c.nup, c.nupt, c.Gpt), en: c.en })), web = { tw: o.web.tw, C: pmpTI(o.web.Ew, o.web.Et, o.web.nuw, o.web.nupt, o.web.G) };
  const th = deg * Math.PI / 180, L = pmpLayers(cells), lam0 = Math.sqrt(L.Dn / Math.max(pmpSteady(L, th, o.hold.Gi) * 0.99, 1e-9));
  const P = pmpPlan({ layers: cells, web, hold: o.hold, theta: th, mesh: { nzF: o.mesh.nzF, nzW: o.mesh.nzW, grow: o.mesh.grow, capA: lam0 / o.mesh.armN } });
  const el = pmpElastica(P.fT, th, L.Dn, P.mo.La);
  // (the mesh laid out only when it is first read -- the Mesh step once meshed, the solve: the geometry needs none)
  let M = null;
  const out = { ...P, el, deg, web, get M() { return M || (M = pmpMesh(P.mo)); } };
  if (PMP_PLAN.size > 8) PMP_PLAN.clear();
  PMP_PLAN.set(key, out);
  return out;
}
/** Round ticks covering lo … hi (the first at or below lo, the last at or above hi), about n of them. */
function pmpTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo, lo + 1];
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(q => q * mag).find(q => (hi - lo) / q <= n) || 10 * mag;
  const out = []; for (let v = Math.floor(lo / step + 1e-9) * step; v < hi + step * (1 - 1e-9); v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  if (out[out.length - 1] < hi) out.push(+(out[out.length - 1] + step).toPrecision(12));
  return out;
}
const pmpUm = v => { const u = v * 1e6; return u >= 100 ? u.toFixed(0) : u >= 10 ? u.toFixed(1) : u.toFixed(2); };
const pmpMmTxt = v => { const m = v * 1000; return m >= 10 ? m.toFixed(1) : m >= 1 ? m.toFixed(2) : m.toFixed(3); };

// ---- drawing ----
/**
 * The section at an angle (geometry, solve): the web to scale, the film on it and its arm along the elastica the solve
 * starts from, drawn as a thick line (it is far thinner than the web); the hold along the bonded film; the domain's ends.
 * what 'solve': the faces, numbered as the table below.
 */
function pmpDrawWhole(cv, o, what) {
  const P = pmpPlanAt(o), { mo, el } = P, tw = o.web.tw, th = P.th;
  const { c, w, h } = setupCanvas(cv, 0.42), ink = cssVar('--ink'), mut = cssVar('--muted');
  c.clearRect(0, 0, w, h);
  // the arm's centre line (the elastica, true scale) and the box round everything
  const arm = []; for (let i = 0; i <= 200; i++) { const s = mo.La * i / 200, [x, z] = el.at(s); arm.push([x, z + P.L.zN]); }
  const xs = [-mo.Lb, mo.Lw, ...arm.map(p => p[0])], zs = [-tw, P.L.h, ...arm.map(p => p[1])];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const m = { l: 30, r: 30, t: 30, b: 52 }, s = Math.min((w - m.l - m.r) / (x1 - x0), (h - m.t - m.b) / (z1 - z0));
  const ox = m.l + ((w - m.l - m.r) - (x1 - x0) * s) / 2, oy = h - m.b - ((h - m.t - m.b) - (z1 - z0) * s) / 2;
  const X = x => ox + (x - x0) * s, Z = z => oy - (z - z0) * s;
  const webC = cssVar(PMP_WEB_C) || '#8a7a5c', filmC = cssVar(PMP_FILM_C) || '#6b4f2a';
  // the web (its thickness to scale)
  c.fillStyle = swbFill(PMP_WEB_C, 0.34); c.strokeStyle = swbFill(PMP_WEB_C, 0.95); c.lineWidth = 1.2;
  c.fillRect(X(-mo.Lb), Z(0), X(mo.Lw) - X(-mo.Lb), Z(-tw) - Z(0)); c.strokeRect(X(-mo.Lb), Z(0), X(mo.Lw) - X(-mo.Lb), Z(-tw) - Z(0));
  // the film: on the web behind the front, then the arm (drawn 5 px thick)
  const fw = 5;
  c.strokeStyle = filmC; c.lineWidth = fw; c.lineCap = 'butt';
  c.beginPath(); c.moveTo(X(-mo.Lb), Z(0) - fw / 2); c.lineTo(X(0), Z(0) - fw / 2);
  for (const [x, z] of arm) c.lineTo(X(x), Math.min(Z(z), Z(0) - fw / 2)); c.stroke();
  // the hold, under the bonded film
  c.strokeStyle = PMP_HOLD_C; c.lineWidth = 2; c.setLineDash([5, 3]); c.beginPath(); c.moveTo(X(-mo.Lb), Z(0)); c.lineTo(X(0), Z(0)); c.stroke(); c.setLineDash([]);
  // the pull at the arm's end
  const [ex, ez] = arm[arm.length - 1], ax = Math.cos(th), az = Math.sin(th), L0 = 34;
  const arrow = (xa, ya, dx, dy, col) => { const xb = xa + dx * L0, yb = ya - dy * L0; c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb); c.stroke();
    const a = Math.atan2(-(dy), dx); c.beginPath(); c.moveTo(xb, yb); c.lineTo(xb - 9 * Math.cos(a - 0.4), yb - 9 * Math.sin(a - 0.4)); c.lineTo(xb - 9 * Math.cos(a + 0.4), yb - 9 * Math.sin(a + 0.4)); c.closePath(); c.fill(); };
  arrow(X(ex), Z(ez), ax, az, ink);
  c.font = '600 12px ' + cssVar('--sans'); c.textAlign = 'left';
  outlinedText(c, `f, ${P.deg}°`, X(ex) + ax * L0 + (ax >= 0 ? 6 : -40), Z(ez) - az * L0 - 6, ink);
  // the angle at the front
  if (what === 'geometry') {
    c.strokeStyle = mut; c.lineWidth = 1; c.beginPath(); c.arc(X(0), Z(0), 26, -th, 0); c.stroke();
    c.font = '11.5px ' + cssVar('--mono'); c.fillStyle = mut; outlinedText(c, `θ ${P.deg}°`, X(0) + 30 * Math.cos(th / 2), Z(0) - 30 * Math.sin(th / 2) - 2, mut);
    // labels and sizes
    c.font = '600 12px ' + cssVar('--sans');
    outlinedText(c, 'fibre web', X(-mo.Lb) + 8, (Z(0) + Z(-tw)) / 2 + 4, ink);
    outlinedText(c, 'GO film on the web', X(-mo.Lb) + 8, Z(0) - fw - 6, ink);
    swbDimLine(c, [X(-mo.Lb), Z(-tw) + 22], [X(0), Z(-tw) + 22], `${pmpMmTxt(mo.Lb)} mm, the film on the web`, false, mut);
    if (mo.Lw > 0) swbDimLine(c, [X(0), Z(-tw) + 22], [X(mo.Lw), Z(-tw) + 22], `${pmpMmTxt(mo.Lw)} mm bare web`, false, mut);
  }
  if (what === 'solve') {
    const faces = pmpFaces(o), at = [[X(-mo.Lb * 0.5), Z(-tw) + 14], [X(-mo.Lb), Z(0) - fw - 4], [X(ex) + ax * L0 * 0.5 + 14, Z(ez) - az * L0 * 0.5], [X(-mo.Lb * 0.3), Z(0) + 12], [X(-mo.Lb * 0.7), Z(0) - fw - 14], [X(mo.Lw * 0.6), Z(0) - 12]];
    faces.forEach((f, i) => { const [px, py] = at[i]; c.fillStyle = f.c; c.beginPath(); c.arc(px, py, 9, 0, 7); c.fill(); c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), px, py + 4); });
    // the held underside, hatched
    c.strokeStyle = ink; c.lineWidth = 1; c.beginPath(); for (let x = X(-mo.Lb); x < X(mo.Lw); x += 10) { c.moveTo(x, Z(-tw)); c.lineTo(x - 6, Z(-tw) + 6); } c.stroke();
  }
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
  c.fillText(`To scale; the film drawn thicker than it is (${pmpUm(o.h)} µm on a ${pmpUm(tw)} µm web). The arm as the solve first takes it (a clamped elastica).`, 8, h - 8);
  return { X, Z };
}
/** The mesh (reference shape): near the front, true scale; or the whole section with the heights in bands. */
function pmpDrawMesh(cv, o) {
  const P = pmpPlanAt(o), M = P.M, tw = o.web.tw, hF = P.L.h, near = PMS.view !== 'whole';
  const { c, w, h } = setupCanvas(cv, near ? 0.4 : 0.36), ink = cssVar('--ink'), mut = cssVar('--muted');
  c.clearRect(0, 0, w, h);
  const m = { l: 60, r: 24, t: 20, b: 40 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  let X, Z, xa, xb;
  if (near) {
    // (a window round the front: the hold's zone and the film's thickness both seen, one scale both ways)
    const half = Math.max(2.2 * P.lz, 6 * hF); xa = -1.6 * half; xb = 0.8 * half;
    const za = -Math.min(tw, (xb - xa) * ph / pw * 0.7), zb = hF + ((xb - xa) * ph / pw - (hF - za));
    const sx = pw / (xb - xa); X = x => m.l + (x - xa) * sx; Z = z => m.t + ph - (z - za) * sx;
    void zb;
  } else {
    xa = M.xs[0]; xb = M.xs[M.xs.length - 1];
    // (heights in bands: the web 60 %, the film 40 %)
    X = x => m.l + (x - xa) / (xb - xa) * pw;
    Z = z => (z <= 0 ? m.t + ph - (z + tw) / tw * ph * 0.6 : m.t + ph * 0.4 - z / hF * ph * 0.4);
  }
  c.save(); c.beginPath(); c.rect(m.l, m.t, pw, ph); c.clip();
  const quad = (E, col) => {
    const k = [0, 2, 8, 6].map(a => E.n[a]);
    c.beginPath(); k.forEach((id, i) => { const px = X(M.X[id]), pz = Z(M.Z[id]); if (i) c.lineTo(px, pz); else c.moveTo(px, pz); }); c.closePath();
    c.fillStyle = col; c.fill(); c.stroke();
  };
  c.strokeStyle = swbFill(ink, 0.55); c.lineWidth = 0.6;
  for (const E of M.elems) { if (near && (E.X9[8] < xa || E.X9[0] > xb)) continue; quad(E, E.part === 'web' ? swbFill(PMP_WEB_C, 0.16) : swbFill(PMP_FILM_C, 0.2)); }
  // the hold (between the web's top and the film's bottom: one layer of springs), the front
  c.strokeStyle = PMP_HOLD_C; c.lineWidth = 1.6; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(X(Math.max(xa, M.xs[0])), Z(0)); c.lineTo(X(0), Z(0)); c.stroke(); c.setLineDash([]);
  c.restore();
  c.strokeStyle = mut; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(X(0), m.t); c.lineTo(X(0), m.t + ph); c.stroke(); c.setLineDash([]);
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'center'; outlinedText(c, 'the front (x = 0)', X(0), m.t + 12, mut);
  c.textAlign = 'right'; c.font = '11.5px ' + cssVar('--mono');
  outlinedText(c, 'film', m.l - 6, (Z(0) + Z(hF)) / 2 + 4, ink); outlinedText(c, 'web', m.l - 6, Math.min((Z(0) + Z(-tw)) / 2, (Z(0) + m.t + ph) / 2) + 4, ink);
  c.textAlign = 'left'; c.fillStyle = mut;
  c.fillText(near ? `Near the front, true scale (${pmpUm(xb - xa)} µm along): the hold gives way over about ${pmpUm(P.lz)} µm.` : `The whole section (${pmpMmTxt(M.xs[M.xs.length - 1] - M.xs[0])} mm along), the heights in bands; the arm still flat on the web: the mesh is the film as it lay.`, 8, h - 8);
}
/** The faces and what holds there (the Solve step's table; numbered on the drawing). */
function pmpFaces(o) {
  const ink = cssVar('--ink'), mut = cssVar('--muted');
  return [
    { t: 'The web\'s underside', c: ink, bc: ['held: no slip, flat (on a roller or a table)'] },
    { t: 'Behind the front (the film far behind)', c: '#1c7ed6', bc: ['pulled by the bonded film\'s own stress, its layers\' −Qb ε* (as if the film went on); the web free'] },
    { t: 'The arm\'s end', c: cssVar('--heat') || '#e8590c', bc: ['pulled along θ by the far arm\'s stress: the force f per width and the moment that holds it straight against its natural curl'] },
    { t: 'The hold (film | web)', c: PMP_HOLD_C, bc: [`bilinear: stiff up to its strength ${MAT.film.sigI.v} MPa, then softening to nothing once it has taken ${MAT.film.Gi.v} J/m²; pressed together, it pushes back`] },
    { t: 'The film\'s top and the arm', c: mut, bc: ['free'] },
    { t: 'The web\'s top past the front', c: mut, bc: ['free; the arm pressed on it pushes back'] },
  ];
}

// ---- the adapter ----
SWB_ADAPT['film:film'] = {
  key: 'peel', sk: 'film:film', t: 'Peel and wind', ready: 'mp4', sid: 'pmp',
  S: () => PMS,
  inputs: dim => pmpInputs(dim),
  current: dim => pmpCurrent(dim),
  failed: dim => pmpFailed(dim),
  request: dim => { PMS.dim = dim; solveArm('pmp' + dim); },
  auto: dim => { PMS.dim = dim; if (!pmpCurrent(dim) && !pmpFailed(dim)) pmpRequest(dim); },
  stop: () => pmpStop(),
  why: () => 'The peel front is solved after the film to the peel (Peel and wind: the film on the web from the oven).',
  slow3: '',
  dofs: () => 2, coupled: 'the displacements along and up',
  axisNames: () => ['Along the line (x)', 'Up through the web and the film (z)'],
  meshFields: dim => [
    { k: 'nzF', t: 'Elements through the film', min: 2, max: 12, step: 1, int: true, def: PMP_MESH_DEF[2].nzF },
    { k: 'nzW', t: 'Elements through the web', min: 2, max: 12, step: 1, int: true, def: PMP_MESH_DEF[2].nzW },
    { k: 'grow', t: 'Each element along at most this × the last', min: 1.02, max: 1.6, step: 0.01, def: PMP_MESH_DEF[2].grow },
    { k: 'armN', t: 'Elements along the arm per bending length', min: 6, max: 96, step: 1, int: true, def: PMP_MESH_DEF[2].armN },
  ],
  meshHow: () => 'Nine-node elements (quadratic), 3 × 3 Gauss points, the layers\' stiffness and natural strain taken at each point. Along the line: even near the front (the hold\'s zone, its elements half the film\'s thickness or a twelfth of the zone), growing away from it; along the arm at most its bending length √(D/f) over the number set. The hold: a spring pair at each node along the bonded film (Simpson\'s weights).',
  meshStats: (dim, o) => { const M = pmpPlanAt(o).M; return { nodes: M.N, elems: M.elems.length, unknowns: 2 * M.N, band: M.bw }; },
  meshTiles: (dim, o) => {
    const P = pmpPlanAt(o), M = P.M, fine = P.mo.fine, bw = M.bw, mb = 2 * M.N * (bw + 1) * 8 / 1048576;
    return [['Nodes', M.N.toLocaleString('en'), 'two unknowns at each (along, up)', 'mesh'], ['Elements', M.elems.length.toLocaleString('en'), 'nine-node quadrilaterals', 'grading'],
      ['Hold', `${M.pairs.length.toLocaleString('en')} springs`, 'film to web, along the line', 'film'], ['Smallest', `${pmpUm(fine)} µm`, `at the front; the film ${pmpUm(o.h)} µm thick`, 'ratio'],
      ['Matrix', `${mb < 10 ? mb.toFixed(1) : mb.toFixed(0)} MB`, `banded, ${bw} wide`, 'table']];
  },
  meshHTML: (dim, o) => {
    const P = pmpPlanAt(o), M = P.M, set = swbSettings(SWB_ADAPT['film:film'], dim), F = SWB_ADAPT['film:film'].meshFields(dim);
    const xE = M.xe.slice(1).map((x, i) => x - M.xe[i]), zf = M.zFe.slice(1).map((z, i) => z - M.zFe[i]), zw = M.zWe.slice(1).map((z, i) => z - M.zWe[i]);
    const row = (t, n, a, L) => `<tr><th scope="row">${t}</th><td>${n}</td><td>${pmpUm(Math.min(...a))} µm</td><td>${pmpUm(Math.max(...a))} µm</td><td>${L}</td></tr>`;
    return `<div class="swb-tables">
      <section class="swb-card"><h4>${uiBadge('tune')}Mesh</h4>
        <table class="swb-t swb-set"><tbody>${F.map(f => `<tr><th scope="row"><label for="swbm_${f.k}">${f.t}</label></th><td><input type="number" id="swbm_${f.k}" data-swbm="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${set[f.k]}" aria-label="${f.t}"></td><td class="swb-u"></td><td class="swb-def">${set[f.k] === f.def ? '' : `default ${f.def}`}</td></tr>`).join('')}</tbody></table>
        <p class="fv-why">${SWB_ADAPT['film:film'].meshHow(dim)}</p></section>
      <section class="swb-card"><h4>${uiBadge('grading')}Along each axis <span class="acr-sub">at the hand's angle, ${P.deg}°</span></h4>
        <table class="swb-t"><thead><tr><th scope="col">Axis</th><th scope="col">Elements</th><th scope="col">Smallest</th><th scope="col">Largest</th><th scope="col">Length</th></tr></thead>
        <tbody>${row('Along the line', xE.length, xE, `${pmpMmTxt(P.mo.Lb)} mm behind the front, ${pmpMmTxt(P.mo.La)} mm of arm`)}${row('Through the film', zf.length, zf, `${pmpUm(o.h)} µm`)}${row('Through the web', zw.length, zw, `${pmpUm(o.web.tw)} µm`)}</tbody></table>
        <p class="fv-why">The lengths it is sized by: the film's bending length √(D/f) ${pmpMmTxt(P.lam)} mm; the hold's zone (D δ_f / σ̂)^¼ ${pmpUm(P.lz)} µm; the shear lag √(A t_web / G_web) ${pmpMmTxt(P.ls)} mm (the film behind the front is six of them long). Each angle is meshed for its own force.</p></section>
    </div>`;
  },
  extraMeshes: () => '',
  paneTitles: () => ({ geometry: 'The section at the peel, to scale', mesh: 'The mesh', solve: 'The faces and what holds there' }),
  layout: () => ({ parts: [{ k: 'film', t: 'GO film', c: PMP_FILM_C, rects: [] }, { k: 'web', t: 'Fibre web', c: PMP_WEB_C, rects: [] }, { k: 'hold', t: 'The hold', c: PMP_HOLD_C, rects: [] }] }),
  draw: (cv, dim, o, step) => { if (step === 'mesh') pmpDrawMesh(cv, o); else pmpDrawWhole(cv, o, step); },
  domain: () => 'a section along the line where the film leaves the web, through the web and the film',
  domainShort: (dim, o) => { const P = pmpPlanAt(o); return `${pmpMmTxt(P.mo.Lb)} mm + the arm, ${pmpUm(o.h)} µm film`; },
  parts: (dim, o) => {
    const nG = o.cells.filter(c => c.gel).length, P = pmpPlanAt(o);
    return [{ t: 'GO film', c: PMP_FILM_C, mat: 'Dried GO film', rec: 'gofilm', size: `${pmpUm(o.h)} µm, ${o.cells.length - nG} layers${nG ? ' and wet gel' : ''}`, how: `${o.mesh.nzF} elements through it; each layer's stiffness at its water and its natural strain` },
      { t: 'Fibre web', c: PMP_WEB_C, mat: 'Fibre web', rec: 'web', size: `${pmpUm(o.web.tw)} µm`, how: `${o.mesh.nzW} elements through it, its underside held` },
      { t: 'The hold', c: PMP_HOLD_C, mat: 'GO film | fibre web', rec: null, size: `${MAT.film.Gi.v} J/m², ${MAT.film.sigI.v} MPa`, how: `gives way over about ${pmpUm(P.lz)} µm ahead of the front` }];
  },
  domainRows: (dim, o) => {
    const P = pmpPlanAt(o), run = pmpRunNow();
    return [['Domain', SWB_ADAPT['film:film'].domain()], ['The film', `${run ? dryFilmName(run.key) : ''}, the water leaving ${o.where === 'both' ? 'from the top and the underside' : 'from the top only'}`],
      ['Along the line', `${pmpMmTxt(P.mo.Lb)} mm of film on the web behind the front; the arm ${pmpMmTxt(P.mo.La)} mm (seven bending lengths)`], ['Angles', `${o.angles.map(a => a + '°').join(', ')} (by hand first, then the winder's)`],
      ['Width', 'plane strain: the film is wide, its width held as on the web']];
  },
  geoTiles: (dim, o) => {
    const P = pmpPlanAt(o), wet = o.cells.some(c => c.gel), Xm = o.cells.filter(c => !c.gel).reduce((a, c) => a + c.X * c.t, 0) / o.cells.filter(c => !c.gel).reduce((a, c) => a + c.t, 0);
    return [['Film', `${pmpUm(o.h)} µm`, wet ? 'a wet gel between its skins' : 'dry at the peel', 'film'], ['Its water', `${(Xm * 100).toFixed(1)} %`, 'of its GO, through it', 'drop'],
      ['Web', `${pmpUm(o.web.tw)} µm`, 'fibre web, held under', 'weight'], ['Hold', `${MAT.film.Gi.v} J/m²`, `strength ${MAT.film.sigI.v} MPa`, 'film'], ['Angles', o.angles.map(a => a + '°').join(' · '), 'by hand, the winder\'s', 'section']];
  },
  geoNote: (dim, o) => `The film's layers as the drying left them at the peel (Peel and wind's film, ${o.cells.length} layers): each set stress-free as a skin's front passed it, its stress on the web since from its water and its temperature. Here they are its natural strains; the web holds them flat until the film leaves it.`,
  meshNote: () => 'The mesh is the film as it lay on the web; the arm turns through the angle as the solve goes (finite rotations).',
  physics: (dim, o) => {
    const F = MAT.film;
    return [['Stress and strain', 'Div(F S) = 0;  S = C(X) : (E − E*),  E = ½ (FᵀF − I)', `film: E along ${F.Ep.v} GPa, through ${F.Et.v} GPa, shear ${F.Gpt.v} GPa, each ÷ (1 + X/${F.Xh.v}); web: ${F.Ew.v} GPa along, × ${F.soft.v} through and in shear`],
      ['The film\'s natural strain', 'E* = ε*(X, T) along and across it (from the drying: −σ/Q of each layer on the web)', 'its water and temperature since it set, film.js\'s'],
      ['The hold', 't = (1 − d) K δ;  d from the largest separation: 0 up to σ̂/K, 1 at 2 Gi/σ̂', `Gi ${F.Gi.v} J/m², σ̂ ${F.sigI.v} MPa; K 50 × the web's through-stiffness / its thickness`]];
  },
  coupling: () => 'the film\'s water sets each layer\'s stiffness and natural strain (one way: the drying\'s state at the peel); the hold\'s damage and the displacements in one Newton iteration.',
  bcCols: ['What holds'],
  faces: (dim, o) => pmpFaces(o),
  timeTitle: 'Load steps', timeCols: ['Stage', 'To', 'Conditions', 'Steps'],
  time: (dim, o) => [['The film\'s natural strains', 'all of them', 'brought in at 30 % of the force (the arm\'s first guess an elastica without its curl)', o.cells.some(c => c.en) ? '4' : '—'],
    ['The pull', '99 % of the steady peel\'s', 'f raised: 30, 60, 80, 90, 95, 97.5, 100 % of 0.99 f_ss; a step that fails is halved', '7'],
    ['The angles', o.angles.map(a => a + '°').join(', '), 'each its own mesh and solve', String(o.angles.length)]],
  solver: (dim, o, r) => [['Method', 'total Lagrangian, St Venant–Kirchhoff about the bonded state (finite rotations, small strains)'], ['Newton', 'on the displacements and the hold\'s damage together, a line search on the residual'],
    ['Linear solve', 'banded L D Lᵀ (symmetric; indefinite where the hold softens)'], ['Converged', 'residual 10⁻⁹ of the load, or the step 10⁻¹⁰ of the displacements'],
    ['Steady peel', 'the force where the far field\'s energy f (1 − cos θ) + (f + Aₙ)²/(2A) reaches Gi; solved to 99 % of it'],
    ...(r ? [['Last solve', `${(r.ms / 1000).toFixed(1)} s, ${r.angles.reduce((a, q) => a + q.iters, 0)} Newton iterations in all`]] : [])],
  solveTiles: (dim, o, r) => {
    const P = pmpPlanAt(o);
    return [['Steady peel (hand)', `${P.fSS.toFixed(2)} N/m`, `at ${P.deg}°, from the energy balance`, 'cut'], ['Bending length', `${pmpMmTxt(P.lam)} mm`, '√(D/f): the arm turns over it', 'length'],
      ['Hold\'s zone', `${pmpUm(P.lz)} µm`, '(D δ_f/σ̂)^¼', 'film'], ['Solve', r ? `${(r.ms / 1000).toFixed(1)} s` : '—', r ? `${o.angles.length} angles` : 'not solved', 'tune']];
  },
  resultsHTML: () => pmpHTML(),
  renderResults: () => pmpRender(),
  csv: () => pmpCsv(),
  openInputs: () => { setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } },
  viewer: true,
  viewNames: dim => (dim === 1 ? { prl1: 'Pressure between the turns', prl2: 'Pull along the turns', prl3: 'Through the roll at times', prl4: 'The core\'s pressure in time', prlCompare: 'Against independent answers' }
    : dim === 2 ? { pmp1: 'The front, as it peels', pmp2: 'Stress along the film at the front', pmp3: 'The hold along the front', pmp4: 'Peel force against the angle', pmp5: 'Stress at the front against the angle', pmpCompare: 'Against the Peel page' }
      : { pr31: 'Its water in time', pr32: 'Along its width', pr33: 'On its section', pr34: 'Its temperature in time', pr3Compare: 'Against the 1D roll' }),
  tools: (dim, step) => {
    const where = (step === 'solve' || step === 'results') && typeof dmpWhere === 'function' ? `<div class="seg seg-sm" role="tablist" aria-label="Where the water left the film" id="pmpWhere">${[['top', 'Water: top'], ['both', 'Top and underside']].map(([k, t]) => `<button type="button" role="tab" data-pmpwhere="${k}" aria-selected="${dmpWhere() === k}">${t}</button>`).join('')}</div>` : '';
    const view = step === 'mesh' ? `<div class="seg seg-sm" role="tablist" aria-label="The mesh shown" id="pmpView">${[['front', 'Near the front'], ['whole', 'Whole section']].map(([k, t]) => `<button type="button" role="tab" data-pmpview="${k}" aria-selected="${(PMS.view === 'whole' ? 'whole' : 'front') === k}">${t}</button>`).join('')}</div>` : '';
    return where + view;
  },
  wire: () => {
    document.querySelectorAll('[data-pmpwhere]').forEach(b => { b.onclick = () => { if (dmpWhere() === b.dataset.pmpwhere) return; dmpSetWhere(b.dataset.pmpwhere); undoCommit(); render(); }; });
    document.querySelectorAll('[data-pmpview]').forEach(b => { b.onclick = () => { PMS.view = b.dataset.pmpview; render(); }; });
  },
};

// ---- the answers (the Results step) ----
function pmpHTML() {
  const pane = (id, icon, title, aria) => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="mp-sec mp-bench" id="pmpSec" aria-label="The peel front: its answers">
    <div class="stats mp-stats" id="pmpStats"></div>
    <figure class="pane mp-field"><figcaption>${uiBadge('section')}<span id="pmpFieldT">The front, as it peels</span>
        <span class="vp-spacer"></span>
        <span class="seg seg-sm" role="tablist" aria-label="How near" id="pmpFView"></span>
        <span class="seg seg-sm" role="tablist" aria-label="The angle shown" id="pmpAng"></span></figcaption>
      <canvas id="pmp1" role="img" aria-label="The film leaving the web at the front: the film coloured by its stress along itself"></canvas><div class="pane-legend" id="pmp1Lg"></div></figure>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('pmp2', 'cut', 'The film\'s stress along itself at the front', 'The stress along the film on its underside and its top against the distance from the front')}
      ${pane('pmp3', 'film', 'The hold along the front', 'The hold\'s pull on the film, opening and sliding, against the distance from the front')}
    </div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('pmp4', 'cut', 'Peel force against the angle', 'The peel force per width at each angle solved, with the Peel page\'s')}
      ${pane('pmp5', 'cut', 'The film\'s stress at the front against the angle', 'The largest stress along the film at the front at each angle, with the Peel page\'s and the film\'s strength')}
    </div>
    <div class="mp-compare" id="pmpCompare"></div>
  </section>`;
}
function pmpWireSec(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (t && t.dataset.pmpang != null) { PMS.ang = +t.dataset.pmpang; pmpRender(); }
    if (t && t.dataset.pmpfview) { PMS.fview = t.dataset.pmpfview; pmpRender(); }
  });
}
/** The Peel page's own run (film.js: the steady peel's energy balance and the beam at the front) for the 2D's film. */
const pmpRef = o => { const run = pmpRunNow(); return run && o && run.key === o.film && run.where === o.where ? run : null; };
function pmpRender() {
  const sec = document.getElementById('pmpSec');
  if (!sec) return;
  if (!sec.dataset.wired) pmpWireSec(sec);
  const o = pmpInputs(2), r = pmpCurrent(2) ? PMS.res[2] : null, ids = ['pmp1', 'pmp2', 'pmp3', 'pmp4', 'pmp5'];
  if (!o || !r) {
    paneEmptyIds(ids, paneWhy('pmp2'));
    for (const id of ids) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    const st = document.getElementById('pmpStats');
    if (st) st.innerHTML = pmpFailed(2) ? `<p class="dry-msg">${pill(`The 2D could not be solved: ${dryEsc(PMS.error[2])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${PMS.busy ? 'Solving the 2D: its answers here when it is done.' : 'Not solved for the inputs as they are.'}</p>`;
    ['pmpCompare', 'pmpAng', 'pmpFView'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    return;
  }
  if (!(PMS.ang < r.angles.length)) PMS.ang = 0;
  pmpTiles(o, r); pmpFrontDraw(o, r); pmpFaceChart(o, r); pmpHoldChart(o, r); pmpAngleCharts(o, r); pmpCompare(o, r);
}
const pmpSigF = () => MAT.film.sigF.v;
function pmpTiles(o, r) {
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const a = r.angles[0], sF = pmpSigF(), sA = a.sBot.s / 1e6, win = r.angles.slice(1), tear = win.filter(q => q.sBot.s / 1e6 >= sF).map(q => q.deg);
  const chk = Math.max(...r.angles.map(q => Math.max(Math.abs(q.J.outer - q.G), Math.abs(q.Phi - q.G)) / q.G));
  const tiles = [
    tile(`Peel force by hand (${a.deg}°)`, `${a.fSS.toFixed(2)} N/m`, 'the steady peel: where the far field gives up the hold\'s energy', 'cut'),
    tile('The film at the front', `${sA.toFixed(0)} MPa`, `its underside, along it; strength ${sF} MPa`, 'cut', sA >= sF ? 'bad' : sA >= 0.8 * sF ? 'warn' : ''),
    win.length ? tile('At the winder', tear.length ? `tears at ${tear.join(', ')}°` : 'holds', `${win.map(q => `${q.deg}° ${(q.sBot.s / 1e6).toFixed(0)}`).join(' · ')} MPa`, 'cut', tear.length ? 'bad' : '') : '',
    tile('The root turns', `${(a.rootPhi * 180 / Math.PI).toFixed(1)}°`, 'where the hold has given way (a clamped root: 0°)', 'section'),
    tile('The hold gives way over', `${pmpUm(a.zone)} µm`, `${(100 * a.PhiN / a.Phi).toFixed(0)} % of its energy in opening`, 'film'),
    tile('Energy balance', `${(chk * 100).toFixed(2)} %`, 'J and the hold\'s energy against Gi\'s balance, worst angle', 'tolerance', chk > 0.01 ? 'warn' : ''),
  ].filter(Boolean);
  document.getElementById('pmpStats').innerHTML = tiles.join('');
}
/** The front at the angle chosen: the film and the web as they are, the film coloured by its stress along itself. */
function pmpFrontDraw(o, r) {
  const cv = document.getElementById('pmp1'), lg = document.getElementById('pmp1Lg'), a = r.angles[PMS.ang];
  if (!cv) return;
  document.getElementById('pmpAng').innerHTML = r.angles.map((q, i) => `<button type="button" role="tab" data-pmpang="${i}" aria-selected="${i === PMS.ang}" title="${i ? 'the winder' : 'by hand'}">${q.deg}°${i ? '' : ' hand'}</button>`).join('');
  document.getElementById('pmpFView').innerHTML = [['near', 'Near the front'], ['arm', 'The arm']].map(([k, t]) => `<button type="button" role="tab" data-pmpfview="${k}" aria-selected="${PMS.fview === k}">${t}</button>`).join('');
  const { c, w, h } = setupCanvas(cv, 0.44), ink = cssVar('--ink'), mut = cssVar('--muted');
  c.clearRect(0, 0, w, h);
  const pts = []; for (const col of a.cols) for (const q of [...col.film, ...col.web]) pts.push(q);
  // (the window: near the front, a few of the hold's zones and the film's thickness each side, the web's top below; or the
  //  whole arm as it turns; one scale both ways)
  const tip = a.tipX, m = { l: 18, r: 18, t: 18, b: 40 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  let x0, x1, z0, z1;
  if (PMS.fview === 'arm') { const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]); x0 = Math.min(...xs); x1 = Math.max(...xs); z0 = Math.min(...zs); z1 = Math.max(...zs); }
  else { const span = Math.max(4.5 * a.zone, 14 * o.h); x0 = tip - 0.7 * span; x1 = tip + 0.3 * span; const hh = (x1 - x0) * ph / pw; z0 = -0.35 * hh; z1 = 0.65 * hh; }
  const s = Math.min(pw / (x1 - x0), ph / (z1 - z0));
  const ox = m.l + (pw - (x1 - x0) * s) / 2, oy = h - m.b - (ph - (z1 - z0) * s) / 2;
  const X = x => ox + (x - x0) * s, Z = z => oy - (z - z0) * s;
  c.save(); c.beginPath(); c.rect(m.l, m.t, pw, ph); c.clip();
  const lut = getLut('div'), sMax = Math.max(1, ...a.cols.flatMap(col => col.film.map(q => Math.abs(q[2])))), sc = { min: -sMax, max: sMax, levels: 0 };
  // quads between neighbouring columns: the web's plain, the film's coloured (its corners' mean); then outlines
  const fill = (A, B, k, part) => {
    const a0 = A[part][k], a1 = A[part][k + 1], b0 = B[part][k], b1 = B[part][k + 1];
    c.beginPath(); c.moveTo(X(a0[0]), Z(a0[1])); c.lineTo(X(b0[0]), Z(b0[1])); c.lineTo(X(b1[0]), Z(b1[1])); c.lineTo(X(a1[0]), Z(a1[1])); c.closePath();
    c.fillStyle = part === 'web' ? swbFill(PMP_WEB_C, 0.3) : lutColor(lut, scaleT(sc, (a0[2] + a1[2] + b0[2] + b1[2]) / 4)); c.fill();
    if (part === 'film') { c.strokeStyle = c.fillStyle; c.lineWidth = 0.6; c.stroke(); }
  };
  for (let i = 0; i + 1 < a.cols.length; i++) { const A = a.cols[i], B = a.cols[i + 1]; if (A.web.length && B.web.length) for (let k = 0; k + 1 < A.web.length; k++) fill(A, B, k, 'web'); }
  for (let i = 0; i + 1 < a.cols.length; i++) { const A = a.cols[i], B = a.cols[i + 1]; for (let k = 0; k + 1 < A.film.length; k++) fill(A, B, k, 'film'); }
  // the film's outline (its underside and top), the web's top
  c.strokeStyle = ink; c.lineWidth = 1;
  for (const part of ['film']) for (const k of [0, a.cols[0][part].length - 1]) { c.beginPath(); a.cols.forEach((col, i) => { const q = col[part][k]; if (i) c.lineTo(X(q[0]), Z(q[1])); else c.moveTo(X(q[0]), Z(q[1])); }); c.stroke(); }
  c.strokeStyle = swbFill(PMP_WEB_C, 0.95); c.beginPath(); a.cols.filter(col => col.web.length).forEach((col, i) => { const q = col.web[col.web.length - 1]; if (i) c.lineTo(X(q[0]), Z(q[1])); else c.moveTo(X(q[0]), Z(q[1])); }); c.stroke();
  // the front (where the hold has given way) and the hold's zone along the web
  c.strokeStyle = PMP_HOLD_C; c.lineWidth = 3; c.beginPath(); c.moveTo(X(tip - a.zone), Z(0)); c.lineTo(X(tip), Z(0)); c.stroke();
  c.restore();
  c.font = '11.5px ' + cssVar('--sans'); c.textAlign = 'left'; outlinedText(c, `the hold gives way (${pmpUm(a.zone)} µm)`, Math.max(m.l + 4, X(tip - a.zone)), Math.min(h - m.b + 14, Z(0) + 16), PMP_HOLD_C);
  c.fillStyle = mut; c.fillText(`To scale: ${(x1 - x0) * 1000 >= 1 ? pmpMmTxt(x1 - x0) + ' mm' : pmpUm(x1 - x0) + ' µm'} along. The film ${pmpUm(o.h)} µm thick on its ${pmpUm(o.web.tw)} µm web, peeled at ${a.deg}° by ${a.f.toFixed(2)} N/m.`, 8, h - 8);
  lg.innerHTML = `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${(-sMax).toFixed(0)}</span><span>the film's stress along itself (MPa, tension +)</span><span>${sMax.toFixed(0)}</span></span></div>`
    + `<p class="fv-why">Bent where it leaves the web: its underside stretched (the outside of the bend), its top pressed. The web lifts a little under the front; the hold gives way over the stretch marked.</p>`;
}
/** The film's stress along itself on its underside and its top against the distance from the front. */
function pmpFaceChart(o, r) {
  const cv = document.getElementById('pmp2'), lg = document.getElementById('pmp2Lg'), a = r.angles[PMS.ang];
  if (!cv) return;
  const tip = a.tipX, win = Math.max(8 * a.zone, 0.4 * a.lam), F = a.face.filter(q => q[0] > tip - win && q[0] < tip + win);
  const bad = cssVar('--bad').trim(), go = cssVar(PMP_FILM_C).trim() || '#6b4f2a', sF = pmpSigF();
  const S = [{ p: F.map(q => [(q[0] - tip) * 1e3, q[1]]), c: bad, w: 2, l: 'its underside (the outside of the bend)' }, { p: F.map(q => [(q[0] - tip) * 1e3, q[2]]), c: go, w: 2, dash: [5, 3], l: 'its top' }];
  const ys = S.flatMap(q => q.p.map(p => p[1])), yt = pmpTicks(Math.min(...ys, 0), Math.max(...ys, sF * 1.05), 5), xt = pmpTicks(-win * 1e3, win * 1e3, 5);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(3)), yf: v => String(+v.toPrecision(4)), xl: 'from the front (mm; on the web ←, the arm →)', yl: 'stress along the film (MPa)',
    hl: [{ y: sF, c: pmpMut(), t: `its strength (${sF} MPa)`, left: true }], vl: [{ x: 0, c: pmpMut(), t: 'the front' }], s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">At ${a.deg}°. On the web far behind the front: the film's own stress from the drying. At the front the bend: its underside ${(a.sBot.s / 1e6).toFixed(0)} MPa at most.</p>`;
}
const pmpMut = () => cssVar('--muted');
/** The hold's pull on the film along the front: opening and sliding. */
function pmpHoldChart(o, r) {
  const cv = document.getElementById('pmp3'), lg = document.getElementById('pmp3Lg'), a = r.angles[PMS.ang];
  if (!cv) return;
  const tip = a.tipX, win = Math.max(6 * a.zone, 6 * a.lz), H = a.hold.filter(q => q[0] > tip - win && q[0] < tip + 0.25 * win);
  const S = [{ p: H.map(q => [(q[0] - tip) * 1e6, q[1]]), c: PMP_HOLD_C, w: 2, l: 'opening (pulls the film down)' }, { p: H.map(q => [(q[0] - tip) * 1e6, q[2]]), c: '#1c7ed6', w: 2, dash: [5, 3], l: 'sliding (along the line)' }];
  const ys = S.flatMap(q => q.p.map(p => p[1])), yt = pmpTicks(Math.min(...ys, 0), Math.max(...ys, MAT.film.sigI.v) * 1.05, 5), xt = pmpTicks(-win * 1e6, 0.25 * win * 1e6, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(3)), yf: v => String(+v.toPrecision(3)), xl: 'from the front (µm)', yl: 'the hold\'s pull (MPa)',
    hl: [{ y: MAT.film.sigI.v, c: pmpMut(), t: `its strength (${MAT.film.sigI.v} MPa)`, left: true }], bands: [{ x0: -a.zone * 1e6, x1: 0, c: cssVar('--soft') }], s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">Shaded: where it gives way (${pmpUm(a.zone)} µm). Its energy there ${a.Phi.toFixed(2)} J/m², ${(100 * a.PhiN / a.Phi).toFixed(0)} % of it in opening; Gi ${a.Gi} J/m².</p>`;
}
/** Against the angle: the 2D's points and the Peel page's curves (film.js: the steady peel's energy balance; the beam at a clamped front). */
function pmpAngleCharts(o, r) {
  const ref = pmpRef(o), bad = cssVar('--bad').trim(), ink = cssVar('--ink');
  const pts = r.angles.map(q => [q.deg, q.f]), pS = r.angles.map(q => [q.deg, q.sBot.s / 1e6]);
  const refF = ref ? ref.peel.byAngle.filter(q => Number.isFinite(q.f) && q.f > 0).map(q => [q.deg, q.f]) : [], refS = ref ? ref.peel.byAngle.filter(q => Number.isFinite(q.sFront)).map(q => [q.deg, q.sFront / 1e6]) : [];
  const cv4 = document.getElementById('pmp4'), cv5 = document.getElementById('pmp5');
  if (cv4) {
    const ys = [...pts, ...refF].map(p => p[1]), lo = Math.max(1e-3, Math.min(...ys)), hi = Math.max(...ys);
    const lg = v => Math.log10(v), y0 = Math.floor(lg(lo)), y1 = Math.ceil(lg(hi) + 1e-9) || y0 + 1;
    plotChart(cv4, FILM_ASPECT, { x0: 0, x1: 180, y0, y1: Math.max(y1, y0 + 1), xl: 'peel angle (°)', yl: 'force per width (N/m)', xd: 0, yticks: Array.from({ length: Math.max(y1, y0 + 1) - y0 + 1 }, (_, i) => y0 + i), yf: v => String(+Math.pow(10, v).toPrecision(2)),
      xticks: [0, 30, 60, 90, 120, 150, 180], s: [...(refF.length ? [{ p: refF.map(p => [p[0], lg(p[1])]), c: pmpMut(), w: 1.6, dash: [6, 4] }] : []), { p: pts.map(p => [p[0], lg(p[1])]), c: ink, line: false, dots: true }] });
    document.getElementById('pmp4Lg').innerHTML = oneDLegend([['this 2D (the hold giving way, finite rotation)', ink, 'dot'], ...(refF.length ? [['the Peel page (the steady peel\'s energy balance)', pmpMut(), 'dash']] : [])]) + '<p class="fv-why">The 2D\'s force is its steady peel\'s, solved to 99 %; the energy balance sets it. Log scale.</p>';
  }
  if (cv5) {
    const sF = pmpSigF(), ys = [...pS, ...refS].map(p => p[1]), yt = pmpTicks(0, Math.max(...ys, sF) * 1.05, 5);
    plotChart(cv5, FILM_ASPECT, { x0: 0, x1: 180, y0: 0, y1: yt[yt.length - 1], yticks: yt, yf: v => String(+v.toPrecision(4)), xl: 'peel angle (°)', yl: 'stress along the film at the front (MPa)', xd: 0, xticks: [0, 30, 60, 90, 120, 150, 180],
      hl: [{ y: sF, c: bad, t: `its strength (${sF} MPa)`, left: true }], s: [...(refS.length ? [{ p: refS, c: pmpMut(), w: 1.6, dash: [6, 4] }] : []), { p: pS, c: ink, line: false, dots: true }] });
    document.getElementById('pmp5Lg').innerHTML = oneDLegend([['this 2D: its underside at the front', ink, 'dot'], ...(refS.length ? [['the Peel page: a beam clamped at the front', pmpMut(), 'dash']] : [])]) + '<p class="fv-why">Above the strength the film tears where it leaves the web. The 2D lets the hold give way and the root turn; the beam holds it clamped.</p>';
  }
}
/** The same answers, this 2D against the Peel page (film.js). */
function pmpCompare(o, r) {
  const el = document.getElementById('pmpCompare'), ref = pmpRef(o);
  if (!el) return;
  const a = r.angles[0], rows = [
    [`Peel force by hand (${a.deg}°)`, ref ? `${ref.peel.hand.f.toFixed(2)} N/m` : '—', `${a.fSS.toFixed(2)} N/m`],
    ['The film at the front, by hand', ref ? `${(ref.peel.hand.sFront / 1e6).toFixed(0)} MPa` : '—', `${(a.sBot.s / 1e6).toFixed(0)} MPa`],
    ['Tears by hand', ref ? (ref.peel.hand.tears ? 'yes' : 'no') : '—', a.sBot.s / 1e6 >= pmpSigF() ? 'yes' : 'no'],
    ['The root', 'clamped (0°)', `turns ${(a.rootPhi * 180 / Math.PI).toFixed(1)}°`],
    ['Its stiffness along it', 'E/(1 − ν²) layer by layer', 'plane strain, the width held; the shear between its layers'],
  ];
  el.innerHTML = `<h4 class="mp-h">Against the Peel page</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Peel page <small>film.js: energy balance, a beam at the front</small></th><th scope="col">This 2D <small>the section, the hold giving way</small></th></tr></thead>
    <tbody>${rows.map(([p, q, s]) => `<tr><th scope="row">${p}</th><td>${q}</td><td>${s}</td></tr>`).join('')}</tbody></table>
    <p class="fv-why">The same film and hold. The forces agree (the steady peel's energy balance sets both); the stress at the front differs by how far the root turns where the hold gives way.</p>`;
}
function pmpCsv() {
  const r = pmpCurrent(2) ? PMS.res[2] : null;
  if (!r) return;
  const rows = [['angle (°)', 'force (N/m)', 'steady force (N/m)', 'G (J/m²)', 'J inner (J/m²)', 'J outer (J/m²)', 'hold energy (J/m²)', 'opening share', 'film underside at the front (MPa)', 'film top (MPa)', 'root turned (°)', 'hold gives way over (µm)', 'Newton iterations']];
  for (const a of r.angles) rows.push([a.deg, a.f, a.fSS, a.G, a.J.inner, a.J.outer, a.Phi, a.PhiN / a.Phi, a.sBot.s / 1e6, a.sTop.s / 1e6, a.rootPhi * 180 / Math.PI, a.zone * 1e6, a.iters]);
  rows.push([]); rows.push(['angle (°)', 'from the front (mm)', 'film underside (MPa)', 'film top (MPa)']);
  for (const a of r.angles) for (const q of a.face) rows.push([a.deg, (q[0] - a.tipX) * 1e3, q[1], q[2]]);
  downloadCSV(`peel-front-2D-${csvStamp()}.csv`, rows);
}
