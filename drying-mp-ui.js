/*
 * drying-mp-ui.js — MP-5 on the Drying stage: its pages 1D, 2D and 3D (mp-bench-ui.js), each in the steps Geometry ›
 * Mesh › Solve › Results: the wet film drying on its fibre web through the room and the oven, solved in drying-mp.js (in
 * cfd-mp-worker.js): its heat, its water (drying.js's, place by place), the oven's air through the web and the drying
 * stress, together. The Drying page itself (drying.js) is the stage's Results.
 *
 * 1D: through the web and the film at one place (the film the Drying page shows); 2D: a section across the web, its
 * full width (the wet film across it as the coating leaves it); 3D: a piece of the line across the web's width. 1D and
 * 2D solve by themselves when shown; 3D on Solve.
 */
const DMS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, field: 'T', snap: null, again: null };
const DMP_DIMS = { 1: '1D', 2: '2D', 3: '3D' };
/** The mesh and time settings' defaults (the Mesh step's, editable). */
const DMP_MESH_DEF = {
  1: { dnw: 6, dM: 40, dN: 80, ddt: 1 },
  2: { dny: 32, dnyb: 4, dgrade: 100, dnw: 6, dM: 40, dN: 80, ddt: 1, dsN: 48 },
  3: { dnx: 4, dLx: 100, dny: 16, dnyb: 3, dgrade: 100, dnw: 4, dM: 30, dN: 60, ddt: 1, dsN: 32 },
};
const DMP_WATER = '#1c7ed6', DMP_WEB_C = '--fibre', DMP_FILM_C = '--go-film';
/** Where the water leaves the film (the Drying page computes both): its setting, saved with the project. */
const dmpWhere = () => (OVEN.mp && OVEN.mp.dry && OVEN.mp.dry.where === 'both' ? 'both' : 'top');
function dmpSetWhere(w) {
  OVEN.mp = OVEN.mp || {};
  const S = { ...(OVEN.mp.dry || {}) };
  if (w === 'both') S.where = 'both'; else delete S.where;
  if (Object.keys(S).length) OVEN.mp = { ...OVEN.mp, dry: S }; else { const m = { ...OVEN.mp }; delete m.dry; OVEN.mp = m; }
}
const dmpSet = dim => (typeof swbSettings === 'function' && SWB_ADAPT.dry ? swbSettings(SWB_ADAPT.dry, dim) : DMP_MESH_DEF[dim]);
/** The film's line positions where the fields are kept: the room's middle, each zone's end. */
function dmpSnapX(base) {
  const out = []; if (base.room.len > 0) out.push(-base.room.len / 2);
  let x = 0; for (const z of base.zones) { x += z.len; out.push(+x.toFixed(6)); }
  return out;
}
/** The drying's multiphysics inputs for a dimension: drying.js's (the Drying card, the line, the room, the oven), the
 *  wet film (1D: the one the Drying page shows; 2D, 3D: across the web), the fibre web, the Film card's stiffness. */
function dmpInputs(dim) {
  if (typeof dryBase !== 'function' || typeof processWeb !== 'function') return null;
  const films = dryFilms(), web = processWeb();
  if (!films.length || !web) return null;
  const fs = fibreStructure(), kD = fibrePermeability();
  if (!fs.ok || !(kD > 0)) return null;
  const base = dryBase(), m = dmpSet(dim), fo = filmOpts(), sel = films.find(f => f.key === DRY.sel) || films.find(f => f.key === 'web') || films[0];
  const mesh = { nw: m.dnw, M: m.dM, ...(dim > 1 ? { ny: m.dny, nyb: m.dnyb, grade: m.dgrade } : {}), ...(dim === 3 ? { nx: m.dnx, Lx: m.dLx / 1000 } : {}) };
  const o = { ...base, dim, where: dmpWhere(), kIn: MAT.dry.kIn.v, kFib: MAT.dry.kFib.v, webT: P.tf / 1000, webEps: fs.eps, webK: kD, N: m.dN, mesh, dtScale: m.ddt,
    stress: { film: fo.film, web: fo.web, gel: fo.gel, gab: fo.gab, rhoS: fo.rhoS, rhoL: fo.rhoL, skinK: fo.skinK, K: 60 }, stressN: m.dsN || 0, snapX: dmpSnapX(base) };
  if (dim === 1) { o.h0 = sel.h0; o.film = sel.key; }
  else { o.W = ACROSS_W / 1000; o.prof = { y: web.A.map(r => r.z / 1000), h: web.A.map(r => r.film) }; }
  return o;
}
const dmpKeyNow = dim => { const o = dmpInputs(dim); return o ? JSON.stringify(o) : null; };
const dmpCurrent = dim => !!DMS.res[dim] && DMS.key[dim] === dmpKeyNow(dim);
const dmpFailed = dim => !!(DMS.error[dim] && DMS.key[dim] === dmpKeyNow(dim));

/** Solve a dimension (one at a time; a request while busy runs next). */
function dmpRequest(dim) {
  const key = dmpKeyNow(dim);
  if (!key || DMS.key[dim] === key && DMS.res[dim]) return;
  if (DMS.busy) { if (DMS.pending !== key) DMS.again = dim; return; }
  const o = dmpInputs(dim);
  DMS.busy = true; DMS.bdim = dim; DMS.pending = key; DMS.prog = null; DMS.again = null;
  const id = ++DMS.id;
  if (!DMS.worker) DMS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { DMS.busy = false; DMS.pending = null; DMS.bdim = null; if (DMS.again) { const a = DMS.again; DMS.again = null; dmpRequest(a); } if (typeof swbRefresh === 'function' && swbRefresh('dry')) return; dmpRender(); };
  DMS.worker.onmessage = e => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.progress) { DMS.prog = msg.progress; if (typeof swbOn === 'function' && swbOn('dry')) swbProgress(); return; }
    DMS.key[dim] = key;
    if (msg.ok) { DMS.res[dim] = msg.res; DMS.error[dim] = null; } else { DMS.res[dim] = null; DMS.error[dim] = msg.error; }
    done();
  };
  DMS.worker.onerror = ev => { DMS.key[dim] = key; DMS.res[dim] = null; DMS.error[dim] = ev.message || 'the multiphysics worker failed'; DMS.worker = null; done(); };
  DMS.worker.postMessage({ id, kind: 'dry', o });
}
/** Stop the solve (New, Open): its worker ended, what was asked next dropped. */
function dmpStop() {
  if (DMS.worker) { DMS.worker.terminate(); DMS.worker = null; }
  Object.assign(DMS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}
/** Wait for a dimension's solve (the report, the tests): true when solved. */
async function dmpWait(dim = DMS.dim) {
  if (typeof dryWait === 'function' && !(await dryWait())) return false;
  for (let k = 0; k < 12000; k++) {
    if (!DMS.busy) { if (dmpCurrent(dim)) return true; if (dmpFailed(dim)) return false; dmpRequest(dim); }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- the domain: the places across the web and the nodes up each (dmpAxes, as the solver builds it) ----
/** The domain's nodes before a solve: the wet film as it arrives (its nodes even through it). */
function dmpGeo(dim, o) {
  const ax = dmpAxes(o), { nz, nw, M, nCol, nxN } = ax, z = new Float32Array(nCol * nz), active = new Uint8Array(nCol * nz);
  for (let c = 0; c < nCol; c++) {
    const iy = Math.floor(c / nxN), h0 = ax.h0[iy];
    for (let k = 0; k < nz; k++) { const n = c * nz + k; z[n] = k <= nw ? ax.zw[k] : ax.zw[nw] + ax.sF[k - nw] * h0; active[n] = k <= nw || h0 > 0 ? 1 : 0; }
  }
  return { ax, z, active };
}
const dmpMmTxt = v => (v * 1000 >= 10 ? (v * 1000).toFixed(0) : (v * 1000).toFixed(2));

/**
 * A section across the web (2D; the 3D's at the piece's middle along the line), through the web and the film: the web's
 * height and the film's drawn in bands (the web 0.2 mm, the film a millimetre or so, the web 300 mm wide), the film's own
 * thickness at each place. what: 'geometry' | 'mesh' | 'solve' | a field { v (node) → value, lut, sc }.
 * z: the nodes' heights (the snapshot's, or the wet film's as it arrives).
 */
function dmpDrawSection(cv, o, what, z, field, aspect = 0.42) {
  const ax = dmpAxes(o), { nz, nw, M, nyN, nxN, ys } = ax, ix = Math.floor((nxN - 1) / 2), node = (iy, k) => (ix + nxN * iy) * nz + k;
  const { c, w, h } = setupCanvas(cv, aspect), ink = cssVar('--ink'), mut = cssVar('--muted');
  c.clearRect(0, 0, w, h);
  const m = { l: 112, r: 26, t: 22, b: 46 }, pw = w - m.l - m.r, ph = h - m.t - m.b, tf = ax.zw[nw];
  let Hf = 0; for (let iy = 0; iy < nyN; iy++) if (ax.h0[iy] > 0) Hf = Math.max(Hf, z[node(iy, nz - 1)] - tf);
  Hf = Math.max(Hf, 1e-6);
  const W = ys[ys.length - 1] || 1, X = y => m.l + y / W * pw;
  const shareW = 0.32, Z = v => (v <= tf ? m.t + ph - shareW * ph * v / tf : m.t + ph - shareW * ph - (1 - shareW) * ph * Math.min(1, (v - tf) / Hf));
  const act = (iy, k) => k <= nw || ax.h0[iy] > 0;
  const quad = (iy, k) => [[X(ys[iy]), Z(z[node(iy, k)])], [X(ys[iy + 1]), Z(z[node(iy + 1, k)])], [X(ys[iy + 1]), Z(z[node(iy + 1, k + 1)])], [X(ys[iy]), Z(z[node(iy, k + 1)])]];
  const poly = (pts, fill, stroke, lw) => { c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) c.lineTo(...p); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); } };
  for (let iy = 0; iy < nyN - 1; iy++) for (let k = 0; k < nz - 1; k++) {
    if (!(act(iy, k + 1) && act(iy + 1, k + 1))) continue;
    let fill;
    if (field && typeof field === 'object') {
      const vs = [node(iy, k), node(iy + 1, k), node(iy + 1, k + 1), node(iy, k + 1)].map(field.v).filter(Number.isFinite);
      fill = vs.length ? lutColor(field.lut, scaleT(field.sc, vs.reduce((a, b) => a + b, 0) / vs.length)) : cssVar('--soft');
    } else fill = swbFill(k < nw ? DMP_WEB_C : DMP_FILM_C, what === 'mesh' ? 0.14 : 0.36);
    poly(quad(iy, k), fill, what === 'mesh' ? swbFill(ink, 0.5) : null, 0.5);
  }
  // the outlines: the web, the film (its top and its ends)
  c.lineWidth = 1.3; c.strokeStyle = swbFill(ink, 0.85);
  c.strokeRect(X(0), Z(tf), X(W) - X(0), Z(0) - Z(tf));
  c.beginPath();
  let started = false;
  for (let iy = 0; iy < nyN; iy++) {
    if (!(ax.h0[iy] > 0)) { started = false; continue; }
    const p = [X(ys[iy]), Z(z[node(iy, nz - 1)])];
    if (!started) { c.moveTo(X(ys[iy]), Z(tf)); c.lineTo(...p); started = true; } else c.lineTo(...p);
    if (iy === nyN - 1 || !(ax.h0[iy + 1] > 0)) c.lineTo(X(ys[iy]), Z(tf));
  }
  c.stroke();
  // the faces and their conditions (numbered as the table below)
  if (what === 'solve') {
    const F = SWB_ADAPT.dry.faces(o.dim, o);
    F.forEach((f, i) => {
      if (!f.seg2) return;
      const pts = f.seg2(ax, z, node, X, Z);
      c.save(); c.strokeStyle = f.c || ink; c.lineWidth = f.kind === 'sym' ? 1.6 : 3.2; if (f.kind === 'sym') c.setLineDash([6, 4]);
      c.beginPath(); for (const [a, b] of pts) { c.moveTo(...a); c.lineTo(...b); } c.stroke(); c.restore();
      const [a, b] = pts[Math.floor(pts.length / 2)], mx = (a[0] + b[0]) / 2 + (f.dx || 0) + (f.k === 'under' ? pw * 0.13 : 0), my = (a[1] + b[1]) / 2 + (f.dy || 0);
      c.fillStyle = f.c || ink; c.beginPath(); c.arc(mx, my, 9, 0, 7); c.fill();
      c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), mx, my + 4);
    });
  }
  // the axes: across the web (mm), up through it (the web's band and the film's)
  c.font = '11.5px ' + cssVar('--mono'); c.fillStyle = mut; c.textAlign = 'center';
  for (const v of niceTicks(0, W * 1000, 6)) c.fillText(fmtNum(v), X(v / 1000), h - m.b + 30);
  c.textAlign = 'right'; c.fillText('across the web (mm)', w - m.r, h - 6);
  c.textAlign = 'right';
  outlinedText(c, `web ${dmpMmTxt(tf)} mm`, m.l - 8, (Z(0) + Z(tf)) / 2 + 4, mut);
  outlinedText(c, `film ${dmpMmTxt(Hf)} mm`, m.l - 8, (Z(tf) + Z(tf + Hf)) / 2 + 4, mut);
  // (the note above the drawing: shorter where the canvas is narrow, a phone's)
  c.textAlign = 'left'; c.fillStyle = mut;
  const note = ['heights drawn in bands: the web and the film', 'heights drawn in bands'].find(t => c.measureText(t).width <= w - m.l - 6) || '';
  if (note) c.fillText(note, m.l, m.t - 8);
  return { X, Z, node, w, h };
}

/** The line through the web and the film (1D), drawn as a column: its parts, its nodes, its faces. */
function dmpDrawLine(cv, o, what, z) {
  const ax = dmpAxes(o), { nz, nw } = ax, { c, w, h } = setupCanvas(cv, 0.42), ink = cssVar('--ink'), mut = cssVar('--muted');
  c.clearRect(0, 0, w, h);
  const tf = ax.zw[nw], Hf = z[nz - 1] - tf, x0 = w * 0.42, x1 = w * 0.58, top = 34, bot = h - 34, ph = bot - top, shareW = 0.32;
  const Z = v => (v <= tf ? bot - shareW * ph * v / tf : bot - shareW * ph - (1 - shareW) * ph * (v - tf) / Hf);
  c.fillStyle = swbFill(DMP_WEB_C, what === 'mesh' ? 0.14 : 0.36); c.fillRect(x0, Z(tf), x1 - x0, Z(0) - Z(tf));
  c.fillStyle = swbFill(DMP_FILM_C, what === 'mesh' ? 0.14 : 0.36); c.fillRect(x0, Z(tf + Hf), x1 - x0, Z(tf) - Z(tf + Hf));
  c.strokeStyle = swbFill(ink, 0.85); c.lineWidth = 1.3; c.strokeRect(x0, Z(tf + Hf), x1 - x0, Z(0) - Z(tf + Hf));
  if (what === 'mesh') { c.strokeStyle = swbFill(ink, 0.55); c.lineWidth = 0.7; c.beginPath(); for (let k = 0; k < nz; k++) { c.moveTo(x0, Z(z[k])); c.lineTo(x1, Z(z[k])); } c.stroke(); }
  c.font = '600 12px ' + cssVar('--sans'); c.textAlign = 'left';
  outlinedText(c, 'wet film', x1 + 10, (Z(tf) + Z(tf + Hf)) / 2 + 4, ink); outlinedText(c, 'fibre web', x1 + 10, (Z(0) + Z(tf)) / 2 + 4, ink);
  c.font = '11.5px ' + cssVar('--mono'); c.textAlign = 'right';
  outlinedText(c, `${dmpMmTxt(Hf)} mm`, x0 - 10, (Z(tf) + Z(tf + Hf)) / 2 + 4, mut); outlinedText(c, `${dmpMmTxt(tf)} mm`, x0 - 10, (Z(0) + Z(tf)) / 2 + 4, mut);
  if (what === 'solve') {
    const F = SWB_ADAPT.dry.faces(1, o);
    F.forEach((f, i) => {
      const y = f.k === 'top' ? Z(tf + Hf) : Z(0);
      c.save(); c.strokeStyle = f.c || ink; c.lineWidth = 3.2; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.restore();
      const my = y + (f.k === 'top' ? -14 : 16);
      c.fillStyle = f.c || ink; c.beginPath(); c.arc((x0 + x1) / 2, my, 9, 0, 7); c.fill();
      c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), (x0 + x1) / 2, my + 4);
    });
  }
  c.fillStyle = mut; c.font = '11.5px ' + cssVar('--sans'); c.textAlign = 'left';
  c.fillText(o.film ? `at ${dryFilmName(o.film)}; heights drawn in bands` : 'heights drawn in bands', 8, h - 8);
}

// ---- the stage's pages (mp-bench-ui.js) ----
SWB_ADAPT.dry = {
  key: 'dry', sk: 'dry', t: 'Drying', ready: 'mp5',
  S: () => DMS,
  inputs: dim => dmpInputs(dim),
  current: dim => dmpCurrent(dim),
  failed: dim => dmpFailed(dim),
  request: dim => { DMS.dim = dim; dmpRequest(dim); },
  auto: dim => { DMS.dim = dim; if (dim < 3 && !dmpCurrent(dim) && !dmpFailed(dim)) dmpRequest(dim); },
  stop: () => dmpStop(),
  why: () => 'The drying is solved after the coating: the wet film across the web (Coating, 1D Across the web).',
  slow3: 'The 3D takes about a minute',
  dofs: () => 1, coupled: 'the temperature; each place\'s water on its own grid',
  axes: (dim, o) => {
    const ax = dmpAxes(o), ms = o.mesh;
    const zAxis = [{ L: o.webT, n: ax.nw }, { L: Math.max(...ax.h0), n: ax.M, grade: 1 }];
    const yAxis = (() => { const s = []; if (ax.a > 1e-9) s.push({ L: ax.a, n: ms.nyb, grade: ms.grade, end: 'hi' }); s.push({ L: ax.b - ax.a, n: ms.ny, grade: ms.grade, end: 'both' }); if (ax.W - ax.b > 1e-9) s.push({ L: ax.W - ax.b, n: ms.nyb, grade: ms.grade, end: 'lo' }); return s; })();
    const axes = dim === 1 ? [zAxis] : dim === 2 ? [yAxis, zAxis] : [[{ L: ax.Lx, n: ms.nx }], yAxis, zAxis];
    return { axes, mat: (ijk, seg) => (seg[dim - 1] === 0 ? 0 : 1) };
  },
  axisNames: dim => (dim === 1 ? ['Up through the web and the film (z)'] : dim === 2 ? ['Across the web (y)', 'Up through the web and the film (z)'] : ['Along the line (x)', 'Across the web (y)', 'Up through the web and the film (z)']),
  meshFields: dim => [
    ...(dim === 3 ? [{ k: 'dLx', t: 'The piece\'s length along the line', u: 'mm', min: 5, max: 1000, step: 5, def: DMP_MESH_DEF[3].dLx }, { k: 'dnx', t: 'Elements along the line', min: 1, max: 20, step: 1, int: true, def: DMP_MESH_DEF[3].dnx }] : []),
    ...(dim > 1 ? [{ k: 'dny', t: 'Elements across the film', min: 2, max: 120, step: 1, int: true, def: DMP_MESH_DEF[dim].dny },
      { k: 'dnyb', t: 'Elements across each bare margin', min: 1, max: 40, step: 1, int: true, def: DMP_MESH_DEF[dim].dnyb },
      { k: 'dgrade', t: 'Grading to the film\'s ends (largest / smallest)', min: 1, max: 500, step: 1, def: DMP_MESH_DEF[dim].dgrade }] : []),
    { k: 'dnw', t: 'Elements through the web', min: 1, max: 40, step: 1, int: true, def: DMP_MESH_DEF[dim].dnw },
    { k: 'dM', t: 'Elements through the film (the heat\'s)', min: 4, max: 200, step: 2, int: true, def: DMP_MESH_DEF[dim].dM },
    { k: 'dN', t: 'Cells through the wet film (the water\'s)', min: 10, max: 400, step: 2, int: true, def: DMP_MESH_DEF[dim].dN },
    { k: 'ddt', t: 'Time step, × the automatic', min: 0.05, max: 4, step: 0.05, def: 1 },
    ...(dim > 1 ? [{ k: 'dsN', t: 'Stress solves along the line', min: 4, max: 200, step: 1, int: true, def: DMP_MESH_DEF[dim].dsN }] : []),
  ],
  meshHow: dim => `The heat on linear elements, the flows taken at the nodes (no overshoot): through the web evenly, through the film clustered at both faces (where the skins form); ${dim > 1 ? 'across the web graded toward the film\'s ends and the web\'s edges, ' : ''}the film's nodes move with it as it shrinks (the GO's own coordinate). The water at each place on drying.js's own grid: cells clustered at the wet film's two fronts, the thinnest a hundredth of the thinnest compaction layer. The time step chosen as drying.js's (the water and the temperatures changing a little each step), this many times it.`,
  extraMeshes: (dim, o) => (dim === 1 ? 'The stress: film.js\'s laminate, its cells through the film (60).' : `The stress on the same mesh (${dim === 3 ? 'the film\'s levels every second of the heat\'s, ' : ''}linear elements), solved ${dmpSet(dim).dsN} times along the line and at each snapshot.`),
  paneTitles: dim => (dim === 3 ? { geometry: 'The piece of the line in 3D', mesh: 'The mesh on the piece\'s outer faces', solve: 'The faces and what holds there' }
    : dim === 2 ? { geometry: 'The section across the web', mesh: 'The mesh on the section', solve: 'The faces and what holds there' } : { geometry: 'The line through the web and the film', mesh: 'The mesh through them', solve: 'The faces and what holds there' }),
  layout: (dim, o) => {
    const ax = dmpAxes(o), H = Math.max(...ax.h0), tf = o.webT;
    const parts = [{ k: 'web', t: 'Fibre web', c: DMP_WEB_C, rects: [[0, 0, dim === 1 ? H * 0.2 : ax.W, tf]] }, { k: 'film', t: 'Wet film', c: DMP_FILM_C, rects: [[ax.a, tf, dim === 1 ? H * 0.2 : ax.b, tf + H]] }];
    if (dim === 3) return { parts, partAt: (x, y, z) => (z <= tf * (1 + 1e-9) || y < ax.a - 1e-12 || y > ax.b + 1e-12 ? parts[0] : parts[1]), zLines: [tf], kz: Math.max(1, Math.round(0.25 * Math.min(ax.W, ax.Lx) / (tf + H))) };
    // (no true-scale drawing to toggle: 300 mm across a film a millimetre thick -- the heights always in bands)
    return { x0: 0, x1: dim === 1 ? H * 0.2 : ax.W, z0: 0, z1: tf + H, parts };
  },
  draw: (cv, dim, o, step) => {
    if (dim === 3) { swbDrawIso(cv, SWB_ADAPT.dry, o, step); return; }
    const g = dmpGeo(dim, o);
    if (dim === 1) dmpDrawLine(cv, o, step, g.z); else dmpDrawSection(cv, o, step, g.z);
  },
  domain: (dim, o) => ({ 1: `the line through the web and the film at ${o.film ? dryFilmName(o.film) : 'one place'}`, 2: 'a section across the web, its full width, through the web and the film', 3: 'a piece of the line across the web\'s width, through the web and the film' }[dim]),
  domainShort: (dim, o) => { const ax = dmpAxes(o), H = Math.max(...ax.h0) + o.webT; return dim === 1 ? `${dmpMmTxt(o.webT + o.h0)} mm through` : dim === 2 ? `${dmpMmTxt(ax.W)} × ${dmpMmTxt(H)} mm` : `${dmpMmTxt(ax.Lx)} × ${dmpMmTxt(ax.W)} × ${dmpMmTxt(H)} mm`; },
  parts: (dim, o) => {
    const ax = dmpAxes(o), hs = ax.h0.filter(v => v > 0), lo = Math.min(...hs), hi = Math.max(...hs), fs = fibreStructure();
    return [{ t: 'Wet film', c: DMP_FILM_C, mat: 'GO slurry, drying to the GO film', rec: 'slurry', size: dim === 1 ? `${dmpMmTxt(o.h0)} mm wet` : `${dmpMmTxt(lo)}–${dmpMmTxt(hi)} mm wet, ${dmpMmTxt(ax.b - ax.a)} mm across`, how: `${ax.M} elements through it (the heat); the water ${o.N} cells at each place` },
      { t: 'Fibre web', c: DMP_WEB_C, mat: 'Fibre web', rec: 'web', size: `${dmpMmTxt(o.webT)} mm, ${dim === 1 ? '' : `${dmpMmTxt(ax.W)} mm wide, `}porosity ${fs.eps.toFixed(2)}`, how: `${ax.nw} elements through it; the oven's air through its pores` }];
  },
  domainRows: (dim, o) => {
    const ax = dmpAxes(o), U = lineSpeed(), len = o.zones.reduce((a, z) => a + z.len, 0);
    return [['Domain', SWB_ADAPT.dry.domain(dim, o)], ['Size', dim === 1 ? `${dmpMmTxt(o.webT)} mm of web under ${dmpMmTxt(o.h0)} mm of wet film` : dim === 2 ? `${dmpMmTxt(ax.W)} mm across × ${dmpMmTxt(o.webT)} mm of web and the film` : `${dmpMmTxt(ax.Lx)} mm along × ${dmpMmTxt(ax.W)} mm across`],
      ...(dim > 1 ? [['The film across', `${dmpMmTxt(ax.a)} to ${dmpMmTxt(ax.b)} mm${ax.a > 1e-9 || ax.W - ax.b > 1e-9 ? ', bare web beyond' : ', the web\'s full width'}`]] : []),
      ['The line', `${P.U} m/min: the room ${o.room.len} m, the oven ${+len.toFixed(2)} m (${o.zones.length} zones), ${((o.room.len + len) / U / 60).toFixed(1)} min`],
      ['Water leaves', dmpWhere() === 'both' ? 'from the top and from the underside' : 'from the top only (the underside sealed)']];
  },
  geoTiles: (dim, o) => { const ax = dmpAxes(o), hs = ax.h0.filter(v => v > 0); return [['Wet film', `${dmpMmTxt(hs.reduce((a, b) => a + b, 0) / hs.length)} mm`, dim === 1 ? (o.film ? dryFilmName(o.film) : '') : `${dmpMmTxt(Math.min(...hs))}–${dmpMmTxt(Math.max(...hs))} mm across`, 'film'],
    ['Fibre web', `${dmpMmTxt(o.webT)} mm`, `porosity ${o.webEps.toFixed(2)}`, 'fibre'], ['Domain', SWB_ADAPT.dry.domainShort(dim, o), dim === 3 ? 'along × across × up' : dim === 2 ? 'across × up' : 'up through it', 'section'],
    ['Line', `${P.U} m/min`, `${((o.room.len + o.zones.reduce((a, z) => a + z.len, 0)) / lineSpeed() / 60).toFixed(1)} min to the oven's exit`, 'speed']]; },
  geoNote: (dim, o) => (dim === 1 ? 'One place: the film and the web under it; the air the zones blow from below passes up through the web and leaves under the film.' : dim === 2 ? 'The film\'s thickness at each place across as the coating leaves it; the heights drawn in bands (the web, the film), the width to scale.' : 'The piece seen from its far corner: its top the film, its near end the section across the web.'),
  meshNote: (dim, o) => (dim === 3 ? 'The mesh on the piece\'s outer faces.' : 'The heat\'s mesh: through the film its nodes move with it as it dries; the water has its own cells at each place.'),
  meshTiles: (dim, o) => {
    const ax = dmpAxes(o), nf = ax.h0.filter(v => v > 0).length * ax.nxN, act = ax.nCol * (ax.nw + 1) + nf * ax.M, r = dmpCurrent(dim) ? DMS.res[dim] : null;
    return [['Places', `${ax.nCol}`, dim === 1 ? 'one' : `${nf} with film`, 'mesh'], ['Heat nodes', act.toLocaleString('en'), `${ax.nw + 1} through the web, ${ax.M + 1} through the film`, 'grading'],
      ['Water cells', (nf * o.N).toLocaleString('en'), `${o.N} at each place with film`, 'drop'], ['Air', dim === 1 ? 'up through it' : `${(ax.nCol * (ax.nw + 1)).toLocaleString('en')} nodes`, dim === 1 ? 'the zone\'s air speed' : 'the web\'s, Darcy', 'flow'],
      ['Solve', r ? `${r.nSteps} steps` : '—', r ? `${r.stats.picard} heat–water iterations` : 'not solved yet', 'tune']];
  },
  physics: (dim, o) => {
    const d = MAT.dry;
    return [['Heat', 'C ∂T/∂t + ρ_a c_a u·∇T = ∇·(k ∇T) − L ṁ', `film: GO k ${d.kS.v} through, ${d.kIn.v} along W/(m·K) with its water (flakes flat: in series through, side by side along); web: fibres k ${d.kFib.v} in the air (Maxwell–Eucken), c_p ${d.cpWeb.v} J/(kg·K)`],
      ['Water', '∂e/∂t = ∂/∂ζ (D(φ) φ² ∂e/∂ζ);  skin: ṁ = K_v (p_f − p_i) / δ', `the flakes' collective diffusion (× ${d.mul.v}), the skin's vapour permeability ${d.skinK.v} × 10⁻¹² kg/(m·s·Pa), GAB (X_m ${d.gabXm.v}, C ${d.gabC.v}, K ${d.gabK.v})`],
      ['Air through the web', dim === 1 ? 'u = the zone\'s air speed, up through the web' : '∇·(k_D/μ ∇p) = 0,  u = −(k_D/μ) ∇p', `permeability k_D ${o.webK.toExponential(2)} m² (the fibre web); the air's viscosity at its temperature`],
      ['Stress', dim === 1 ? 'the laminate held flat: σ = Q(X) (ε₀ − ε_set − α ΔT − β ΔX)' : '∇·σ = 0,  σ = C(X) (ε − ε_set − α ΔT − β ΔX)', `the Film card: E ${MAT.film.Ep.v} GPa along (softer with water), β ${MAT.film.beta.v}, α ${MAT.film.alphaF.v} × 10⁻⁶/K; the wet film a gel, E ${MAT.film.Eg.v} kPa; the web E ${MAT.film.Ew.v} GPa, α ${MAT.film.alphaW.v} × 10⁻⁶/K`]];
  },
  coupling: dim => `each step the water at every place (Newton, the temperatures held) and the heat (the water held; the evaporation's latent heat at the surfaces and fronts) in turn until they agree${dim > 1 ? '; the air through the web solved first at the step\'s temperatures' : ''}; the stress after, from the drying's history (a layer sets where a skin's front passes it).`,
  bcCols: ['Heat', 'Water', 'Air', 'Stress'],
  faces: (dim, o) => {
    const heat = cssVar('--heat'), water = DMP_WATER, ink = cssVar('--ink'), air = '#2b8a3e', both = dmpWhere() === 'both', ax = dmpAxes(o);
    const top = { k: 'top', t: 'The film\'s top', c: heat, kind: 'conv', bc: ['each stretch\'s air above (still air or slot jets), the walls\' radiation at the air\'s temperature, IR', 'evaporation (Stefan) into the air above, through the skin once it forms', '—', 'free'],
      seg2: (A, z, node, X, Z) => { const s = []; for (let iy = 0; iy < A.nyN - 1; iy++) if (A.h0[iy] > 0 && A.h0[iy + 1] > 0) s.push([[X(A.ys[iy]), Z(z[node(iy, A.nz - 1)])], [X(A.ys[iy + 1]), Z(z[node(iy + 1, A.nz - 1)])]]); return s; }, dy: -14, face3: 'z1', where: (x, y) => y >= ax.a && y <= ax.b, at3: (X1, Y1, Z1) => [X1 * 0.5, (ax.a + ax.b) / 2, Z1] };
    const under = { k: 'under', t: 'The web\'s underside', c: air, kind: 'conv', bc: [`the plenum's air in at the zone's temperature where it blows, natural convection under it`, both ? 'the film\'s underside dries into the air below it and through the web\'s pores' : 'sealed (the water leaves from the top only)',
      dim === 1 ? 'the zone\'s air speed, up through the web' : 'the plenum\'s pressure: Δp = μ u t / k_D (the zone\'s air speed through the bare web)', 'held flat'],
      seg2: (A, z, node, X, Z) => [[[X(0), Z(0)], [X(A.W), Z(0)]]], dy: 13, face3: null };
    if (dim === 1) return [top, under];
    const F = [top];
    if (ax.a > 1e-9 || ax.W - ax.b > 1e-9) F.push({ k: 'bare', t: 'The bare web\'s top', c: heat, kind: 'conv', bc: ['the air above, the walls\' radiation, IR', '—', 'open: the air leaves (p = 0)', 'free'],
      seg2: (A, z, node, X, Z) => [[[X(0), Z(A.zw[A.nw])], [X(A.a), Z(A.zw[A.nw])]], [[X(A.b), Z(A.zw[A.nw])], [X(A.W), Z(A.zw[A.nw])]]], dy: -14, face3: 'z1', where: (x, y) => y < ax.a || y > ax.b, at3: (X1, Y1, Z1) => [X1 * 0.5, ax.a * 0.5, Z1] });
    F.push(under);
    F.push({ k: 'ends', t: 'The film\'s ends', c: heat, kind: 'conv', bc: ['the oven\'s air and walls (no IR)', 'sealed: a skin grows in from a side face no further than from the top', '—', 'free'],
      seg2: (A, z, node, X, Z) => { const s = []; for (let iy = 0; iy < A.nyN; iy++) { if (!(A.h0[iy] > 0)) continue; const isEnd = iy === 0 || iy === A.nyN - 1 || !(A.h0[iy - 1] > 0) || !(A.h0[iy + 1] > 0); if (isEnd) s.push([[X(A.ys[iy]), Z(A.zw[A.nw])], [X(A.ys[iy]), Z(z[node(iy, A.nz - 1)])]]); } return s; }, dx: 0, dy: 0, face3: 'y1', where: (x, y, z) => z > o.webT, at3: (X1, Y1, Z1) => [X1 * 0.5, Y1, (o.webT + Z1) / 2] });
    F.push({ k: 'edges', t: 'The web\'s edges', c: '#e8590c', kind: 'open', bc: ['the oven\'s air and walls', '—', 'open: the air leaves (p = 0)', 'free'],
      seg2: (A, z, node, X, Z) => [[[X(0), Z(0)], [X(0), Z(A.zw[A.nw])]], [[X(A.W), Z(0)], [X(A.W), Z(A.zw[A.nw])]]], dx: 0, dy: 0, face3: 'y1', where: (x, y, z) => z <= o.webT, at3: (X1, Y1, Z1) => [X1 * 0.3, Y1, o.webT / 2] });
    if (dim === 3) F.push({ k: 'pend', t: 'The piece\'s ends (along the line)', c: cssVar('--muted'), kind: 'sym', bc: ['no heat along (the line continues)', 'none along', 'none along', 'a common strain along, no net force'], face3: 'x1', at3: (X1, Y1, Z1) => [X1, Y1 * 0.7, Z1 * 0.5] });
    return F;
  },
  time: (dim, o) => {
    const U = lineSpeed(), rows = [], tops = { none: 'still air above', air: 'slot jets above', ir: 'IR above', 'air+ir': 'slot jets and IR above' };
    if (o.room.len > 0) rows.push(['The room', `${o.room.len} m, ${(o.room.len / U / 60).toFixed(1)} min`, `${o.room.T} °C, ${(o.room.rh * 100).toFixed(0)} % RH, still air`, 'as needed']);
    o.zones.forEach((z, i) => rows.push([`Zone ${i + 1}`, `${z.len} m, ${(z.len / U / 60).toFixed(1)} min`, `${z.airT} °C, ${(z.rh * 100).toFixed(0)} % RH; ${tops[z.top] || tops.none}; ${z.airU > 0 ? `${z.airU} m/s up through the web` : 'no air from below'}`, 'as needed']));
    return rows;
  },
  solver: (dim, o, r) => [['The water', 'each place: Newton on its cells and fronts (drying.js\'s), implicit'], ['The heat', `implicit Euler; ${dim === 1 ? 'tridiagonal' : 'GMRES, each place\'s tridiagonal solve its preconditioner'}`],
    ...(dim > 1 ? [['The air', 'Darcy on the web\'s nodes, each step (banded Cholesky)']] : []), ['Coupling', 'water ⇄ heat each step until the temperatures agree to 10⁻⁴ K'],
    ['The time step', `drying.js's rule, × ${o.dtScale}`], ['The stress', dim === 1 ? 'film.js\'s laminate on the place\'s history' : `${o.stressN} solves along the line, placed where the film sets, and at each snapshot; each layer from its strain where it set; plane strain + no net force along`],
    ...(r ? [['Balances', dmpBal(r)], ['Solved in', `${(r.ms / 1000).toFixed(1)} s`]] : [])],
  solveTiles: (dim, o, r) => {
    const len = o.zones.reduce((a, z) => a + z.len, 0), dp = o.zones.map(z => (z.airU > 0 ? drAir(z.airT, 101325).mu * z.airU * o.webT / o.webK : 0));
    return [['Stretches', `${o.zones.length + (o.room.len > 0 ? 1 : 0)}`, `the room and ${o.zones.length} zones, ${+(o.room.len + len).toFixed(2)} m`, 'period'],
      ['Water leaves', dmpWhere() === 'both' ? 'both sides' : 'the top', dmpWhere() === 'both' ? 'top and underside' : 'the underside sealed', 'drop'],
      ['Plenum', dim === 1 ? `${Math.max(...o.zones.map(z => z.airU))} m/s` : `${Math.max(...dp).toFixed(0)} Pa`, dim === 1 ? 'up through the web' : 'drives the zone\'s air through the bare web', 'flow'],
      ['Solved in', r ? `${(r.ms / 1000).toFixed(1)} s` : '—', r ? `${r.nSteps} steps` : 'not solved yet', 'play']];
  },
  resultsHTML: dim => dmpHTML(true),
  renderResults: dim => dmpRender(),
  csv: dim => { DMS.dim = dim; dmpCsv(); },
  openInputs: () => { setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } },
  tools: (dim, step) => (step === 'solve' || step === 'results' ? `<div class="seg seg-sm" role="tablist" aria-label="Where the water leaves the film" id="dmpWhere">${[['top', 'Water: top'], ['both', 'Top and underside']].map(([k, t]) => `<button type="button" role="tab" data-dmpwhere="${k}" aria-selected="${dmpWhere() === k}">${t}</button>`).join('')}</div>` : ''),
  wire: () => { document.querySelectorAll('[data-dmpwhere]').forEach(b => { b.onclick = () => { if (dmpWhere() === b.dataset.dmpwhere) return; dmpSetWhere(b.dataset.dmpwhere); undoCommit(); render(); }; }); },
};
/** A solve's balances, in words. */
function dmpBal(r) {
  const e = r.energy, w = r.water, eb = e ? Math.abs(e.H - e.H0 - (e.Qin + (e.Qcoat || 0) - e.Qlat - e.Qsens)) / Math.max(1e-30, Math.abs(e.Qin)) : null;
  const wb = Math.abs(w.start - w.end - w.out) / Math.max(1e-30, Math.abs(w.out)), u = r.dim === 1 ? ' per m²' : r.dim === 2 ? ' per m of line' : ' (the piece)';
  return `water out ${(w.out * 1e3).toPrecision(4)} g = lost ${((w.start - w.end) * 1e3).toPrecision(4)} g${u} (${wb < 1e-6 ? 'closes' : `off by ${(wb * 100).toFixed(4)} %`})${e ? `; heat in less the latent and sensible heat out = the heat gained, within ${(eb * 100).toFixed(2)} % of the heat in` : ''}`;
}

// ---- the answers (the Results step of a dimension page; the report's Drying section) ----
function dmpHTML(bench = false) {
  const pane = (id, icon, title, aria) => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="mp-sec${bench ? ' mp-bench' : ''}" id="dmpSec" aria-label="The drying's multiphysics: its answers">
    ${bench ? '' : `<h4 class="mp-h">${uiBadge('mesh')}The drying's multiphysics (${DMP_DIMS[DMS.dim]}, MP-5)</h4>`}
    <div class="stats mp-stats" id="dmpStats"></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('dmp1', 'temp', 'Temperatures along the line', 'The film\'s top and bottom temperatures along the line, with the air of each stretch')}
      ${pane('dmp2', 'drop', 'Water along the line', 'The film\'s water along the line, with the Drying page\'s')}
    </div>
    <figure class="pane mp-field"><figcaption>${uiBadge('mesh')}<span id="dmpFieldT">The field</span>
        <span class="vp-spacer"></span>
        <span class="seg seg-sm" role="tablist" aria-label="The field shown" id="dmpField"></span>
        <span class="seg seg-sm" role="tablist" aria-label="Where on the line" id="dmpSnap"></span></figcaption>
      <canvas id="dmp3" role="img" aria-label="The field chosen at the place on the line chosen"></canvas><div class="pane-legend" id="dmp3Lg"></div></figure>
    ${DMS.dim === 3 ? `<figure class="pane mp-field"><figcaption>${uiBadge(9)}<span id="dmpIsoT">The piece in 3D</span></figcaption><canvas id="dmpIso" role="img" aria-label="The piece of the line in 3D: the field chosen on its outer faces"></canvas><div class="pane-legend" id="dmpIsoLg"></div></figure>` : ''}
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('dmp4', 'cut', 'Drying stress along the line', 'The set film\'s in-plane stress along the line against its strength')}
      <div class="mp-compare" id="dmpCompare"></div>
    </div>
  </section>`;
}
function dmpWireSec(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.dmpfield) { DMS.field = t.dataset.dmpfield; dmpField(); return; }
    if (t.dataset.dmpsnap) { DMS.snap = +t.dataset.dmpsnap; dmpField(); }
  });
}
function dmpRender() {
  const sec = document.getElementById('dmpSec');
  if (!sec) return;
  if (!sec.dataset.wired) dmpWireSec(sec);
  const dim = DMS.dim, o = dmpInputs(dim), r = dmpCurrent(dim) ? DMS.res[dim] : null;
  if (!o || !r) {
    for (const id of ['dmp1', 'dmp2', 'dmp3', 'dmp4']) { const cv = document.getElementById(id); if (cv) { const { c, w, h } = setupCanvas(cv, id === 'dmp3' ? 0.42 : FILM_ASPECT); c.clearRect(0, 0, w, h); } const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    const st = document.getElementById('dmpStats');
    if (st) st.innerHTML = dmpFailed(dim) ? `<p class="dry-msg">${pill(`The ${DMP_DIMS[dim]} could not be solved: ${dryEsc(DMS.error[dim])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${DMS.busy && DMS.bdim === dim ? `Solving the ${DMP_DIMS[dim]}: its answers here when it is done.` : dim === 3 ? 'The 3D solves the piece of the line in about a minute: press Solve.' : 'Not solved for the inputs as they are.'}</p>`;
    ['dmpCompare', 'dmpField', 'dmpSnap'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    return;
  }
  dmpTiles(o, r); dmpCharts(o, r); dmpField(); dmpStressChart(o, r); dmpCompare(o, r);
}
const dmpX = x => `${x < 0 ? `${(-x).toFixed(2)} m before the oven` : `${x.toFixed(2)} m into the oven`}`;
/** The water of a place (kg/m²) as a share of its GO (%). */
const dmpPct = (r, ci, row) => { const c = r.cols[ci], mGO = r.phi0 * c.h0 * r.rhoS; return row ? 100 * (row.wet + row.bound) / mGO : null; };
function dmpTiles(o, r) {
  const s = r.summary, F = MAT.film, tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const mid = s.mid, dim = r.dim, peak = r.stress && r.stress.peak != null ? r.stress.peak / 1e6 : null;
  const tiles = [
    tile('Skin forms (the film\'s middle)', mid.skin != null ? `${Math.abs(mid.skin).toFixed(2)} m` : 'none', mid.skin != null ? (mid.skin < 0 ? 'before the oven, in the room' : 'into the oven') : 'its top stays wet', 'film'),
    tile(mid.dry != null ? 'Dry (the film\'s middle)' : 'Water at the exit (the middle)', mid.dry != null ? `${mid.dry.toFixed(2)} m` : `${mid.waterPct.toFixed(1)} %`, mid.dry != null ? 'into the oven' : `of its GO; ${(mid.h * 1e3).toFixed(2)} mm thick`, 'drop', mid.dry == null ? 'warn' : ''),
    dim === 1 ? tile('Air up through the web', `${Math.max(...o.zones.map(z => z.airU))} m/s`, 'the zones\', leaving under the film', 'flow')
      : tile('Air under the film', `${(s.under * 1000).toFixed(2)} mm/s`, `its mean; the zones blow ${Math.max(...o.zones.map(z => z.airU))} m/s, ${r.follow.bare != null ? `the bare web passes ${(r.series.reduce((m, q) => Math.max(m, q.bare ? q.bare.uIn : 0), 0)).toFixed(2)} m/s` : 'out at the web\'s edges only'}`, 'flow', s.under < 0.1 * Math.max(...o.zones.map(z => z.airU)) ? 'warn' : ''),
    ...(dim > 1 ? [tile('Film\'s ends at the exit', s.endL ? `${s.endL.waterPct.toFixed(1)} %` : '—', s.endL && s.endL.dry != null ? `dry at ${s.endL.dry.toFixed(2)} m` : 'water, of its GO', 'drop')] : []),
    tile('Hottest film', `${s.Tmax.toFixed(1)} °C`, `water boils at ${r.Tboil.toFixed(1)} °C`, 'temp', s.Tmax >= r.Tboil - 0.05 ? 'warn' : ''),
    tile('Drying stress, largest', peak != null ? `${peak.toFixed(2)} MPa` : 'none', peak != null ? `the set film's top; its strength ${F.sigF.v} MPa` : 'no layer set', 'cut', peak != null && peak >= F.sigF.v ? 'bad' : ''),
  ];
  document.getElementById('dmpStats').innerHTML = tiles.join('');
}
/** The stretches' air temperatures along the line (a stair), for the charts. */
const dmpAir = o => { const out = []; let x = -o.room.len; if (o.room.len > 0) { out.push([x, o.room.T], [0, o.room.T]); x = 0; } for (const z of o.zones) { out.push([x, z.airT], [x + z.len, z.airT]); x += z.len; } return out; };
function dmpCharts(o, r) {
  const ser = r.series, heat = cssVar('--heat').trim(), mut = cssVar('--muted'), soft = cssVar('--soft'), dim = r.dim;
  const x0 = ser[0].x, x1 = ser[ser.length - 1].x, band = [{ x0: 0, x1: r.xOven, c: soft }];
  const L = [{ p: ser.map(q => [q.x, q.mid.Ts]), c: heat, w: 2, l: 'the film\'s top (its middle)' }, { p: ser.map(q => [q.x, q.mid.Tb]), c: mpShade(heat, 0, 3), w: 2, l: 'its bottom, on the web' }];
  if (dim > 1 && ser[0].endL) L.push({ p: ser.map(q => [q.x, q.endL.Ts]), c: heat, w: 1.6, dash: [3, 3], l: 'the film\'s top at its end' });
  if (dim > 1 && ser[0].bare) L.push({ p: ser.map(q => [q.x, q.bare.Ts]), c: '#2b8a3e', w: 1.6, l: 'the bare web' });
  const air = { p: dmpAir(o), c: mut, w: 1.5, dash: [6, 4], l: 'the air of each stretch' };
  const Ts = [...L.flatMap(s => s.p.map(p => p[1])), ...air.p.map(p => p[1])];
  plotChart(document.getElementById('dmp1'), FILM_ASPECT, { x0, x1, y0: Math.floor(Math.min(...Ts) / 10) * 10, y1: Math.ceil(Math.max(...Ts) / 10) * 10, xl: 'position on the line (m; the oven from 0)', yl: 'temperature (°C)', xd: 1, yd: 0, bands: band, s: [air, ...L] });
  document.getElementById('dmp1Lg').innerHTML = oneDLegend([...L.map(s => [s.l, s.c, s.dash ? 'dash' : '']), [air.l, mut, 'dash']]) + `<p class="fv-why">Shaded: the oven. ${dim === 1 ? 'At one place through the film.' : 'The film\'s middle across the web, its end, and the bare web where there is one.'}</p>`;
  // water: the middle, the ends, the film's mean; the Drying page's own (drying.js) for the same film
  const blue = DMP_WATER, W = [{ p: ser.map(q => [q.x, dmpPct(r, r.follow.mid, q.mid)]), c: blue, w: 2, l: dim === 1 ? 'the film' : 'the film\'s middle' }];
  if (dim > 1 && ser[0].endL) W.push({ p: ser.map(q => [q.x, dmpPct(r, r.follow.endL, q.endL)]), c: blue, w: 1.6, dash: [3, 3], l: 'its end' });
  const runs = typeof dryCurrent === 'function' && dryCurrent() ? DRY.res.runs : null, rk = dim === 1 ? o.film : 'web', ref = runs ? runs.find(q => q.key === rk && q.where === o.where) : null;
  const refL = ref ? { p: ref.series.map(q => [q.x, 100 * (q.wet + q.bound) / ref.mGO]), c: mut, w: 1.5, dash: [6, 4], l: `the Drying page (1D, ${dim === 1 ? 'this film' : 'the web\'s mean film'})` } : null;
  const Ws = [...W.flatMap(s => s.p.map(p => p[1])), ...(refL ? refL.p.map(p => p[1]) : [])];
  plotChart(document.getElementById('dmp2'), FILM_ASPECT, { x0, x1, y0: 0, y1: Math.ceil(Math.max(...Ws) * 1.04 / 10) * 10, xl: 'position on the line (m; the oven from 0)', yl: 'water (% of its GO)', xd: 1, yd: 0, bands: band, s: [...(refL ? [refL] : []), ...W] });
  document.getElementById('dmp2Lg').innerHTML = oneDLegend([...W.map(s => [s.l, s.c, s.dash ? 'dash' : '']), ...(refL ? [[refL.l, mut, 'dash']] : [])]) + `<p class="fv-why">Free water and the water the skins hold, as a share of the GO there.${dim > 1 && r.summary.under < 0.1 ? ' Under the wet film the plenum\'s air hardly passes the web: the film dries as with no air from below, unlike the 1D, where it passes up under the film.' : ''}</p>`;
}
function dmpStressChart(o, r) {
  const cv = document.getElementById('dmp4'), lg = document.getElementById('dmp4Lg'), S = r.stress, sigF = MAT.film.sigF.v;
  if (!cv || !S) return;
  const mag = cssVar('--bad').trim(), mut = cssVar('--muted');
  const lines = r.dim === 1 ? [{ p: S.series.filter(q => q.mid != null).map(q => [q.x, q.mid / 1e6]), c: mag, w: 2, l: 'the set film\'s largest (film.js\'s laminate)' }]
    : [{ p: S.series.filter(q => q.mid != null).map(q => [q.x, q.mid / 1e6]), c: mag, w: 2, l: 'the film\'s middle: its top layer' },
      { p: S.series.filter(q => q.endL != null).map(q => [q.x, q.endL / 1e6]), c: mag, w: 1.6, dash: [3, 3], l: 'its end: its top layer' }];
  const all = lines.flatMap(s => s.p.map(p => p[1])), x0 = r.series[0].x, x1 = r.series[r.series.length - 1].x;
  if (!all.length) { const { c, w, h } = setupCanvas(cv, FILM_ASPECT); c.clearRect(0, 0, w, h); lg.innerHTML = '<p class="fv-why">No layer of the film sets on the line: no stress.</p>'; return; }
  const hi = Math.max(...all, 0), lo = Math.min(...all, 0);
  plotChart(cv, FILM_ASPECT, { x0, x1, y0: lo * 1.1, y1: Math.max(hi * 1.15, 0.1), xl: 'position on the line (m; the oven from 0)', yl: 'in-plane stress (MPa)', xd: 1, yd: 1, bands: [{ x0: 0, x1: r.xOven, c: cssVar('--soft') }], hl: hi > 0.5 * sigF ? [{ y: sigF, c: mut, t: `its strength (${sigF} MPa)`, left: true }] : [], s: lines });
  lg.innerHTML = oneDLegend(lines.map(s => [s.l, s.c, s.dash ? 'dash' : ''])) + `<p class="fv-why">${r.dim === 1 ? 'Each layer set where a skin\'s front passed it, its stress from its water and temperature since; the web and the bonded film held flat, a skin over wet film free on it.' : 'Held flat on the web; along the line the film is continuous, so a skin over the wet film is held along it too; across, free at its ends.'} Tension positive.</p>`;
}
/** The fields kept at the snapshots, and the one shown. */
function dmpField() {
  const r = dmpCurrent(DMS.dim) ? DMS.res[DMS.dim] : null, cv = document.getElementById('dmp3'), lg = document.getElementById('dmp3Lg');
  if (!r || !cv) return;
  const dim = r.dim, snaps = r.snaps, o = dmpInputs(dim);
  if (DMS.snap == null || !snaps[DMS.snap]) DMS.snap = Math.max(0, snaps.findIndex(s => Math.abs(s.x - r.xOven) < 1e-6));
  const sn = snaps[DMS.snap], sf = r.stress && r.stress.fields ? r.stress.fields.find(f => Math.abs(f.x - sn.x) < 1e-9) : null;
  const fields = [['T', 'Temperature'], ['X', 'Water'], ['phi', 'Solids'], ...(dim > 1 ? [['p', 'Air pressure']] : []), ...(sf ? [['sx', 'Stress across'], ['sz', 'Stress along']] : [])];
  if (!fields.some(f => f[0] === DMS.field)) DMS.field = 'T';
  document.getElementById('dmpField').innerHTML = fields.map(([k, t]) => `<button type="button" role="tab" data-dmpfield="${k}" aria-selected="${k === DMS.field}">${t}</button>`).join('');
  const lab = s => (s.x < 0 ? 'room' : Math.abs(s.x - r.xOven) < 1e-6 ? 'exit' : s.zone);
  document.getElementById('dmpSnap').innerHTML = snaps.map((s, i) => `<button type="button" role="tab" data-dmpsnap="${i}" aria-selected="${i === DMS.snap}" title="${dmpX(s.x)}">${lab(s)}</button>`).join('');
  const ax = r.ax, { nz, nw, nxN, nyN } = ax, f = DMS.field, title = document.getElementById('dmpFieldT');
  const names = { T: ['Temperature', '°C', mpHeatLut(), v => v.toFixed(1)], X: ['Water', '% of its GO', getLut('seq'), v => v.toFixed(1)], phi: ['Solids', 'volume fraction', getLut('seq'), v => v.toFixed(3)], p: ['The air\'s pressure in the web', 'Pa over the room\'s', getLut('seq'), v => v.toFixed(0)], sx: ['Stress across the web', 'MPa', getLut('div'), v => v.toFixed(2)], sz: ['Stress along the line', 'MPa', getLut('div'), v => v.toFixed(2)] };
  const [tName, unit, lut, fmt] = names[f];
  // the value at a node (the snapshot's arrays; the air's pressure on the web's nodes; the stress from the elements' mesh)
  let val;
  if (f === 'T') val = n => sn.T[n];
  else if (f === 'X') val = n => (Number.isFinite(sn.X[n]) ? sn.X[n] * 100 : NaN);
  else if (f === 'phi') val = n => sn.phi[n];
  else if (f === 'p') val = n => { const c = Math.floor(n / nz), k = n % nz; return k <= nw ? sn.p[c * (nw + 1) + k] : NaN; };
  else {
    const comp = f === 'sx' ? 0 : 1, V = new Float32Array(ax.nCol * nz).fill(NaN), lev = sf.lev, nn = sf.nn, st = sf.stride;
    for (let c = 0; c < ax.nCol; c++) {
      const ix = c % nxN, iy = Math.floor(c / nxN);
      const fe = kk => { const id = dim === 2 ? iy * st[0] + kk * st[1] : ix * st[0] + iy * st[1] + kk * st[2]; return sf.used[id] ? sf.s[id * 2 + comp] / 1e6 : NaN; };
      for (let kk = 0; kk < lev.length; kk++) {
        V[c * nz + lev[kk]] = fe(kk);
        if (kk + 1 < lev.length) for (let k = lev[kk] + 1; k < lev[kk + 1]; k++) { const t = (k - lev[kk]) / (lev[kk + 1] - lev[kk]); V[c * nz + k] = (1 - t) * fe(kk) + t * fe(kk + 1); }
      }
      void nn;
    }
    val = n => V[n];
  }
  const all = []; for (let n = 0; n < ax.nCol * nz; n++) { const v = val(n); if (Number.isFinite(v)) all.push(v); }
  let sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 };
  if (f === 'sx' || f === 'sz') { const mx = Math.max(Math.abs(sc.min), Math.abs(sc.max), 1e-3); sc = { min: -mx, max: mx, levels: 0 }; }
  if (sc.max - sc.min < 1e-9) { sc.min -= 0.5; sc.max += 0.5; }
  const bar = `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${fmt(sc.min)}</span><span>${unit}</span><span>${fmt(sc.max)}</span></span></div>`;
  const where = dmpX(sn.x);
  if (dim === 1) {
    // through the web and the film: the field against the height
    const pts = []; for (let k = 0; k < nz; k++) { const v = val(k); if (Number.isFinite(v)) pts.push([v, sn.z[k] * 1000]); }
    const xs = pts.map(p => p[0]), lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.1 || 1;
    plotChart(cv, 0.42, { x0: lo - pad, x1: hi + pad, y0: 0, y1: sn.z[nz - 1] * 1000 * 1.02, xl: `${tName.toLowerCase()} (${unit})`, yl: 'height (mm)', xd: f === 'phi' ? 2 : 1, yd: 2,
      hl: [{ y: ax.zw[nw] * 1000, c: cssVar('--muted'), t: 'the web\'s top', left: true }], s: [{ p: pts, c: f === 'T' ? cssVar('--heat').trim() : DMP_WATER, w: 2 }] });
    title.textContent = `${tName} through the web and the film`;
    lg.innerHTML = `<p class="fv-why">${where}. The web below ${(ax.zw[nw] * 1000).toFixed(2)} mm, the film above (${(sn.z[nz - 1] * 1000 - ax.zw[nw] * 1000).toFixed(2)} mm now).</p>`;
    return;
  }
  dmpDrawSection(cv, o, 'field', sn.z, { v: val, lut, sc });
  title.textContent = `${tName} on a section across the web${dim === 3 ? ' (the piece\'s middle)' : ''}`;
  lg.innerHTML = bar + `<p class="fv-why">${where}. The heights drawn in bands (the web, the film as thick as it is there and then).${f === 'p' ? ' Under the wet film the plenum\'s pressure holds: the air goes out only near the bare web and the web\'s edges.' : ''}</p>`;
  if (dim === 3) dmpIso(r, sn, val, lut, sc, unit, fmt, where);
}
/** The piece in 3D: the field on its outer faces (its top, its far side, its end: the section across). */
function dmpIso(r, sn, val, lut, sc, unit, fmt, where) {
  const cv = document.getElementById('dmpIso'), lg = document.getElementById('dmpIsoLg'), A = SWB_ADAPT.dry;
  if (!cv) return;
  const o = dmpInputs(3), { M } = swbMesh(A, 3, o), nz = r.ax.nz, nxN = r.ax.nxN;
  const f = id => { const ix = Math.floor(id / M.stride[0]) % M.nn[0], iy = Math.floor(id / M.stride[1]) % M.nn[1], k = Math.floor(id / M.stride[2]) % M.nn[2]; return val((ix + nxN * iy) * nz + k); };
  swbDrawIso(cv, A, o, 'results', { f, sc, lut });
  lg.innerHTML = `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${fmt(sc.min)}</span><span>${unit}</span><span>${fmt(sc.max)}</span></span></div><p class="fv-why">${where}. The piece drawn as a block, its height stretched: its top the film's (the bare web's beyond the film's ends), its near end the section across.</p>`;
}
/** The same answers, this model against the Drying page (drying.js: one place through the film, the air up through the web). */
function dmpCompare(o, r) {
  const el = document.getElementById('dmpCompare');
  if (!el) return;
  const runs = typeof dryCurrent === 'function' && dryCurrent() ? DRY.res.runs : null, rk = r.dim === 1 ? o.film : 'web', ref = runs ? runs.find(q => q.key === rk && q.where === o.where) : null;
  if (!ref) { el.innerHTML = ''; return; }
  const s = r.summary, m = (v, f = 2) => (v == null ? '—' : `${v.toFixed(f)} m`), mid = r.cols[r.follow.mid];
  const rows = [
    ['Skin forms at', m(ref.events.skinTop), m(s.mid.skin)],
    ['Dry at', ref.events.dry != null ? m(ref.events.dry) : 'not in the oven', s.mid.dry != null ? m(s.mid.dry) : 'not in the oven'],
    ['Water at the exit', `${ref.exit.waterPct.toFixed(1)} %`, `${mid.exit.waterPct.toFixed(1)} %`],
    ['Hottest film', `${ref.Tmax.toFixed(1)} °C`, `${s.Tmax.toFixed(1)} °C`],
    ['Air from below', `${Math.max(...o.zones.map(z => z.airU))} m/s up under the film`, r.dim === 1 ? 'as the Drying page' : `${(s.under * 1000).toFixed(2)} mm/s under the film`],
  ];
  el.innerHTML = `<h4 class="mp-h">Against the Drying page</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Drying page <small>drying.js, 1D, ${r.dim === 1 ? 'this film' : 'the web\'s mean film'}</small></th><th scope="col">This ${DMP_DIMS[r.dim]} <small>${r.dim === 1 ? 'the web resolved' : 'the film\'s middle'}</small></th></tr></thead>
    <tbody>${rows.map(([a, b, cc]) => `<tr><th scope="row">${a}</th><td>${b}</td><td>${cc}</td></tr>`).join('')}</tbody></table>
    <p class="fv-why">The same water physics (drying.js's, at each place). ${r.dim === 1 ? 'Here the web is resolved and the air coming up through it is followed through its pores.' : 'In 1D the plenum\'s air passes up through the web and leaves under the film; across the web the wet film seals it, and the air leaves through the bare web and the web\'s edges.'}</p>`;
}
function dmpCsv() {
  const r = dmpCurrent(DMS.dim) ? DMS.res[DMS.dim] : null;
  if (!r) return;
  const keys = Object.keys(r.follow).filter(k => r.follow[k] != null), name = { mid: 'middle', endL: 'left end', endR: 'right end', bare: 'bare web' };
  const rows = [['dimension', 'line position (m)', 'time (s)', 'stretch', ...keys.flatMap(k => (k === 'bare' ? [`${name[k]} top (°C)`, `${name[k]} air in (m/s)`] : [`${name[k]} top (°C)`, `${name[k]} bottom (°C)`, `${name[k]} water (% of GO)`, `${name[k]} skin on top (mm)`, `${name[k]} film (mm)`])), 'air under the film (m/s)']];
  for (const q of r.series) rows.push([DMP_DIMS[r.dim], q.x, q.t, q.zone, ...keys.flatMap(k => { const v = q[k]; if (!v) return k === 'bare' ? ['', ''] : ['', '', '', '', '']; return k === 'bare' ? [v.Ts, v.uIn] : [v.Ts, v.Tb, dmpPct(r, r.follow[k], v), v.skinT * 1000, v.h * 1000]; }), q.under]);
  downloadCSV(`drying-multiphysics-${DMP_DIMS[r.dim]}-${csvStamp()}.csv`, rows);
}
