/*
 * mix-mp-ui.js — MP-MIX on the Mixing stage: its pages 2D and 3D (mp-bench-ui.js), each in the steps Geometry › Mesh ›
 * Solve › Results; its 1D is the batch through its program (mixer.js, the Mixing page). The 2D and the 3D take the batch
 * as the 1D leaves it at the end of a step of the program (its flow curve, density, level and temperature, the arm's and
 * the disperser's speeds) and solve its flow with the parts moving through it (mix-mp.js in cfd-mp-worker.js):
 *  2D: a horizontal slice of the batch in time over the arm's turns: the paste's flow with its inertia, its viscosity from
 *      its shear rate, the heat the shear makes carried by the paste to the jacket, and tracers (where the paste goes, the
 *      shear it sees, how far it mixes).
 *  3D: the whole batch at moments over the blades' cycle (creeping), the power and torque of each part, the shear over
 *      the batch (dead zones, where lumps break), tracers through the cycle's flow over the arm's turns.
 * Their own inputs (the step solved, the slice, what they count) are on the inputs bar's "2D and 3D" group; the mesh and
 * time on the Mesh step.
 */
const XMS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, again: null, snap: -1, field: 'speed', lev: 1, ang: 0 };
/** The mesh's and the time's defaults (the Mesh step's, editable): cells across the vessel (and up it, 3D), time steps per
 *  arm turn, arm turns, the moments over the blades' cycle (3D), samples per face side, the least gap in cells, tracers. */
const XM_MESH_DEF = { 2: { xmN: 128, xmSteps: 240, xmTurns: 1, xmSub: 3, xmGap: 1.5, xmTr: 2000 }, 3: { xmN: 48, xmNz: 40, xmAng: 4, xmTurns: 1, xmSteps: 60, xmSub: 2, xmGap: 1.5, xmTr: 2000 } };
const XM_C = { paste: '--go-film', wall: '--graphite', blade: '--accent', disc: '--ink' };
const xmSet = dim => (typeof swbSettings === 'function' && SWB_ADAPT.slurry ? swbSettings(SWB_ADAPT.slurry, dim) : XM_MESH_DEF[dim]);
/** The step of the program the 2D and 3D solve (its index): the one chosen, else the step with the disperser at its fastest. */
function xmStepOf() {
  const L = MIX.res && MIX.res.laws;
  if (!L || !L.length) return null;
  const k = Math.round(mixIn().mpStep || 0);
  if (k >= 1 && k <= L.length) return k - 1;
  let best = 0; L.forEach((q, i) => { if (q.Nd > L[best].Nd || (q.Nd === L[best].Nd && q.No > L[best].No)) best = i; });
  return best;
}
/**
 * A dimension's inputs: the mixer (the inputs bar, SI), the batch at the end of the step solved (the 1D's: its flow curve,
 * density, heat capacity, level, temperature, the speeds), the mesh's settings; null before the batch is solved.
 */
function xmInputs(dim) {
  if (typeof mixCurrent !== 'function' || !mixCurrent() || !MIX.res.laws) return null;
  const i = xmStepOf(), L = MIX.res.laws[i], q = mixSetup(), G = mixGeom({ ...q, V: L.V }), m = xmSet(dim), d = mixIn();
  if (G.err) return null;
  const o = { dim, step: i, stepName: (d.steps[i] && d.steps[i].name) || `Step ${i + 1}`, D: q.D, ro: q.ro, rs: G.rs, nBlade: q.nBlade, nBar: q.nBar, w: q.w, t: q.t, db: q.db, dw: q.dw,
    ratio: q.ratio, dir: q.dir, phB: q.phB, rD: q.rD, Dd: q.Dd, tD: q.tD, hD: q.hD, hT: q.hT, nT: q.nT, dS: q.dS, discAlways: true,
    No: L.No, Nd: L.Nd, rho: L.rho, tab: L.tab, H: L.H, T: L.T, one: { PB: L.PB, PD: L.PD, TqB: L.TqB, TqD: L.TqD, Hb: G.Hb } };
  if (dim === 2) return { ...o, zs: q.zsF * L.H, heat: { T0: L.T, Tj: q.Tj, hJ: q.UA / G.Awet, k: q.kP, cp: L.cp }, tracers: { n: m.xmTr, tauC: q.sig },
    mesh: { N: m.xmN, steps: m.xmSteps, turns: m.xmTurns, sub: m.xmSub, gapCells: m.xmGap, snaps: 8 } };
  return { ...o, gdDead: q.gdDead, strainLow: q.sLow, tracers: { n: m.xmTr, tauC: q.sig }, levels: [q.db / 2, q.hD, L.H / 2],
    mesh: { N: m.xmN, Nz: m.xmNz, nAng: m.xmAng, turns: m.xmTurns, steps: m.xmSteps, sub: m.xmSub, gapCells: m.xmGap, picard: 3 } };
}
const xmKeyNow = dim => { const o = xmInputs(dim); return o ? JSON.stringify(o) : null; };
const xmCurrent = dim => !!XMS.res[dim] && XMS.key[dim] === xmKeyNow(dim);
const xmFailed = dim => !!(XMS.error[dim] && XMS.key[dim] === xmKeyNow(dim));
/** Solve a dimension (one at a time; a request while busy runs next). */
function xmRequest(dim) {
  const key = xmKeyNow(dim);
  if (!key) return;
  if (XMS.key[dim] === key && XMS.res[dim]) { solveTake('xmp' + dim); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('xmp' + dim)) return;
  if (XMS.busy) { if (XMS.pending !== key) XMS.again = dim; return; }
  solveTake('xmp' + dim);
  const o = xmInputs(dim);
  XMS.busy = true; XMS.bdim = dim; XMS.pending = key; XMS.prog = null; XMS.again = null;
  const id = ++XMS.id;
  if (!XMS.worker) XMS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { XMS.busy = false; XMS.pending = null; XMS.bdim = null; if (XMS.again) { const a = XMS.again; XMS.again = null; xmRequest(a); } if (typeof swbRefresh === 'function') swbRefresh('slurry'); };
  XMS.worker.onmessage = e => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.progress) { XMS.prog = msg.progress; if (typeof swbOn === 'function' && swbOn('slurry')) swbProgress(); return; }
    XMS.key[dim] = key;
    if (msg.ok) { XMS.res[dim] = { ...msg.res, ms: msg.ms }; XMS.error[dim] = null; XMS.snap = -1; } else { XMS.res[dim] = null; XMS.error[dim] = msg.error; }
    done();
  };
  XMS.worker.onerror = ev => { XMS.key[dim] = key; XMS.res[dim] = null; XMS.error[dim] = ev.message || 'the multiphysics worker failed'; XMS.worker = null; done(); };
  XMS.worker.postMessage({ id, kind: dim === 2 ? 'mix2' : 'mix3', o });
}
/** Stop the solve (New, Open): its worker ended, what was asked next dropped. */
function xmStop() {
  if (XMS.worker) { XMS.worker.terminate(); XMS.worker = null; }
  Object.assign(XMS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}
/** Wait for a dimension's solve (the report, the tests): true when solved. */
async function xmWait(dim) {
  for (let k = 0; k < 24000; k++) {
    if (!XMS.busy) { if (xmCurrent(dim)) return true; if (xmFailed(dim)) return false; if (!solveAsked('xmp' + dim)) return false; xmRequest(dim); }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- numbers in words ----
const xmMm = v => { const m = v * 1000; return Math.abs(m) >= 100 ? m.toFixed(0) : Math.abs(m) >= 10 ? m.toFixed(1) : m.toFixed(2); };
const xmSig = v => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));
const xmRpm = n => `${+(n * 60).toFixed(1)} rpm`;
const xmTurn = o => (o.No > 0 ? 1 / o.No : 1);
/** The parts' names by owner (0 the vessel's wall, 1 … the blades, then the disc). */
const xmOwner = (o, k) => (k === 0 ? 'Vessel wall' : k <= o.nBlade ? `Blade ${k}` : 'Disperser');
/** The paste's viscosity from the 1D's table (log–log) at a shear rate. */
const xmMu = (o, gd) => (typeof mxLaw === 'function' ? mxLaw(o.tab)(gd) : NaN);
/** The cells' size (m) and the gaps the grid keeps (the bars held gapCells cells off the wall and the floor at least). */
function xmGrid(o) {
  const h = o.D / (o.mesh.N - 4), hz = o.dim === 3 ? o.H / o.mesh.Nz : null, c = o.mesh.gapCells;
  return { h, hz, gapW: Math.max(o.dw, c * h), gapF: hz ? Math.max(o.db, c * hz) : o.db, x0: -o.mesh.N * h / 2 };
}
/** The 2D's slice cuts the disc (or its teeth): there the 2D takes the disc as a cylinder through the slice's height. */
const xmCutsDisc = o => o.zs >= o.hD - Math.max(o.tD / 2, o.nT > 0 ? o.hT : 0) && o.zs <= o.hD + Math.max(o.tD / 2, o.nT > 0 ? o.hT : 0);
/** The batch's Reynolds number at the blades' bars: ρ V t / μ(V/t). */
function xmRe(o) {
  const Wa = 2 * Math.PI * o.No, Wb = Wa * (1 + o.dir * o.ratio), V = Math.abs(Wa) * o.ro + Math.abs(Wb) * o.rs, mu = xmMu(o, Math.max(1e-3, V / o.t));
  return { V, mu, Re: o.rho * V * o.t / mu };
}

// ---- drawings: the batch from above and from the side ----
/** The solids drawn from above at a moment (their true outlines): the bars, the disc and its teeth, the shaft. which:
 *  'slice' (those the 2D's slice cuts) or 'all' (seen from above, the lower ones lighter). */
function xmDrawSolids(c, P, o, t, which, ghost, outline) {
  const S = mxSolids({ ...o, gapW: ghost ? ghost.gapW : 0, gapF: ghost ? ghost.gapF : 0 }, t);
  const list = which === 'slice' ? mxSlice(S, o.zs) : S, acc = cssVar(XM_C.blade), ink = cssVar(XM_C.disc);
  for (const s of list) {
    if (!s.own) continue;
    const blade = s.own <= o.nBlade, col = blade ? acc : ink, low = which === 'all' && blade && Number.isFinite(s.z1);
    c.globalAlpha = low ? 0.35 : 0.9; c.fillStyle = col; c.strokeStyle = col; c.lineWidth = outline ? 1.4 : 1;
    if (outline) {
      // (the mesh step: the parts' true outlines over the cells the grid fills)
      c.beginPath();
      if (s.poly) { s.poly.forEach(([x, y], n) => (n ? c.lineTo(...P(x, y)) : c.moveTo(...P(x, y)))); c.closePath(); }
      else if (s.circ) { const [cx, cy, r] = s.circ, [px, py] = P(cx, cy); c.arc(px, py, Math.max(1, P(cx + r, cy)[0] - px), 0, 7); }
      c.stroke(); continue;
    }
    if (s.poly) { c.beginPath(); s.poly.forEach(([x, y], n) => (n ? c.lineTo(...P(x, y)) : c.moveTo(...P(x, y)))); c.closePath(); c.fill(); }
    else if (s.circ) { const [cx, cy, r] = s.circ, [px, py] = P(cx, cy), pr = P(cx + r, cy)[0] - px; c.beginPath(); c.arc(px, py, Math.max(1, pr), 0, 7); if (s.shaft) c.fill(); else { c.globalAlpha = 0.25; c.fill(); c.globalAlpha = 0.9; c.stroke(); } }
    else if (s.tooth) { const [cx, cy, r0, r1, a0, a1] = s.tooth, [px, py] = P(cx, cy), k = P(cx + 1, cy)[0] - px; c.beginPath(); c.arc(px, py, r1 * k, -a0, -a1, true); c.arc(px, py, r0 * k, -a1, -a0, false); c.closePath(); c.fill(); }
  }
  c.globalAlpha = 1;
}
/** The plan's frame: the vessel centred in a square box of side s at (x0, y0); returns P(x, y) -> canvas (y up). */
function xmPlan(c, o, box, opts = {}) {
  const [bx, by, bs] = box, R = o.D / 2, k = (bs - 8) / (2 * R), cx = bx + bs / 2, cy = by + bs / 2, P = (x, y) => [cx + x * k, cy - y * k];
  if (!opts.noPaste) { c.fillStyle = swbFill(XM_C.paste, 0.16); c.beginPath(); c.arc(cx, cy, R * k, 0, 7); c.fill(); }
  c.strokeStyle = cssVar(XM_C.wall); c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R * k, 0, 7); c.stroke();
  return { P, k, cx, cy };
}
/** The side: the vessel cut through its axis (x across, z up), the batch's level; a blade's frame square on (its axis at
 *  −ro) and the disperser (its axis at +rD), turned into the one plane: their heights and widths to scale. */
function xmSide(c, o, box, dim, opts = {}) {
  const [bx, by, bw, bh] = box, R = o.D / 2, top = Math.max(o.H * 1.12, o.hD + o.hT + 0.02), k = Math.min((bw - 8) / (2 * R), (bh - 8) / top);
  const ox = bx + bw / 2, oy = by + bh - 4 - (bh - 8 - top * k) / 2, X = x => ox + x * k, Z = z => oy - z * k;
  c.fillStyle = swbFill(XM_C.paste, dim === 3 && !opts.light ? 0.3 : 0.16); c.fillRect(X(-R), Z(o.H), 2 * R * k, o.H * k);
  c.strokeStyle = cssVar(XM_C.wall); c.lineWidth = 2; c.beginPath(); c.moveTo(X(-R), Z(top)); c.lineTo(X(-R), Z(0)); c.lineTo(X(R), Z(0)); c.lineTo(X(R), Z(top)); c.stroke();
  c.strokeStyle = cssVar('--muted'); c.setLineDash([5, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(X(-R), Z(o.H)); c.lineTo(X(R), Z(o.H)); c.stroke(); c.setLineDash([]);
  const g = opts.ghost || { gapW: 0, gapF: 0 }, acc = cssVar(XM_C.blade), ink = cssVar(XM_C.disc), rsE = Math.min(o.rs, R - o.ro - g.gapW), dbE = Math.max(o.db, g.gapF), up = o.H * 1.08;
  const bar = (x0, x1, z0, z1, col, a) => { c.globalAlpha = a; c.fillStyle = col; c.fillRect(X(Math.min(x0, x1)), Z(z1), Math.max(1, Math.abs(x1 - x0) * k), (z1 - z0) * k); c.globalAlpha = 1; };
  // (a blade's frame: its bars square on out to the wall's gap, edge on across; its bottom bar from its axis out)
  const ax = -o.ro;
  for (let q = 0; q < o.nBar; q++) {
    const ex = Math.cos(2 * Math.PI * q / o.nBar);
    if (Math.abs(ex) > 0.3) { bar(ax + (o.rs - o.w) * ex, ax + rsE * ex, dbE, up, acc, 0.85); bar(ax, ax + (o.rs - o.w) * ex, dbE, dbE + o.w, acc, 0.85); }
    else bar(ax - o.t / 2, ax + o.t / 2, dbE, up, acc, 0.45);
  }
  c.save(); c.setLineDash([3, 3]); c.strokeStyle = cssVar('--muted'); c.lineWidth = 1; c.beginPath(); c.moveTo(X(ax), Z(0)); c.lineTo(X(ax), Z(top)); c.moveTo(X(o.rD), Z(0)); c.lineTo(X(o.rD), Z(top)); c.stroke(); c.restore();
  // (the disperser: its disc, the teeth at its rim, the shaft up out of the batch)
  bar(o.rD - o.Dd / 2, o.rD + o.Dd / 2, o.hD - o.tD / 2, o.hD + o.tD / 2, ink, 0.9);
  if (o.nT > 0) for (const sg of [-1, 1]) bar(o.rD + sg * o.Dd / 2 - sg * o.tD, o.rD + sg * o.Dd / 2, o.hD - o.hT, o.hD + o.hT, ink, 0.55);
  if (o.dS > 0) bar(o.rD - o.dS / 2, o.rD + o.dS / 2, o.hD, up, ink, 0.9);
  c.font = '11.5px ' + cssVar('--mono'); c.textAlign = 'center';
  outlinedText(c, 'a blade', X(ax), Z(top) + 12, cssVar('--ink')); outlinedText(c, 'disperser', X(o.rD), Z(top) + 12, cssVar('--ink'));
  return { X, Z, k };
}
/**
 * Geometry, Mesh, Solve: left the batch from above (2D: the slice; 3D: everything, seen from above), right from the side
 * (the slice's height, or the sections' levels). The mesh: the grid's lines and the cells it sees as solid at t = 0.
 */
function xmDraw(cv, dim, o, step) {
  const { c, w, h } = setupCanvas(cv, 0.5), mut = cssVar('--muted'), ink = cssVar('--ink');
  c.clearRect(0, 0, w, h);
  const gs = xmGrid(o), ghost = step === 'geometry' ? null : gs, side = Math.min(h - 56, w * 0.46), plan = [12, 26, side];
  const { P, k } = xmPlan(c, o, plan);
  if (step === 'mesh') { xmMeshPlan(c, o, P, k, gs); xmDrawSolids(c, P, o, 0, dim === 2 ? 'slice' : 'all', ghost, true); }
  else xmDrawSolids(c, P, o, 0, dim === 2 ? 'slice' : 'all', ghost);
  // (the arm: its axis to the blades', dashed)
  c.save(); c.setLineDash([3, 4]); c.strokeStyle = mut; c.lineWidth = 1; c.beginPath(); c.arc(...P(0, 0), o.ro * k, 0, 7); c.stroke(); c.restore();
  const sb = [plan[0] + side + 36, 22, w - plan[0] - side - 48, side];
  const S = xmSide(c, o, sb, dim, { ghost });
  if (step === 'mesh') xmMeshSide(c, o, S, gs, sb);
  c.font = '11.5px ' + cssVar('--mono'); c.fillStyle = mut; c.textAlign = 'left';
  if (dim === 2) {
    c.strokeStyle = cssVar('--bad'); c.lineWidth = 2; c.beginPath(); c.moveTo(S.X(-o.D / 2) - 6, S.Z(o.zs)); c.lineTo(S.X(o.D / 2) + 6, S.Z(o.zs)); c.stroke();
    outlinedText(c, `the slice, ${xmMm(o.zs)} mm up`, S.X(-o.D / 2) + 4, S.Z(o.zs) - 6, cssVar('--bad'));
  } else {
    o.levels.forEach((z, i) => { c.save(); c.setLineDash([2, 3]); c.strokeStyle = cssVar('--bad'); c.lineWidth = 1; c.beginPath(); c.moveTo(S.X(-o.D / 2), S.Z(z)); c.lineTo(S.X(o.D / 2), S.Z(z)); c.stroke(); c.restore(); outlinedText(c, `${['A', 'B', 'C'][i] || i + 1}`, S.X(o.D / 2) + 6, S.Z(z) + 4, cssVar('--bad')); });
  }
  if (step === 'solve') xmFaceMarks(c, o, dim, P, S);
  c.fillStyle = mut; c.textAlign = 'center';
  c.fillText(dim === 2 ? `from above: the slice at t = 0` : 'from above: every part at t = 0 (the bottom bars lighter)', plan[0] + side / 2, 14);
  c.fillText(`from the side: the batch ${xmMm(o.H)} mm deep`, sb[0] + sb[2] / 2, 14);
  c.textAlign = 'left'; c.fillStyle = ink;
  c.fillText(`D ${xmMm(o.D)} mm · arm ${xmRpm(o.No)} · blades ×${o.ratio} ${o.dir > 0 ? 'with' : 'against'} it · disc ${xmRpm(o.Nd)}`, 12, h - 8);
}
/** The mesh from above: the grid's lines (every few when dense) and the cells the solids fill at t = 0 (the grid's view). */
function xmMeshPlan(c, o, P, k, gs) {
  const N = o.mesh.N, h = gs.h, x0 = gs.x0, step = Math.max(1, Math.ceil(3 / (h * k)));
  const G = mx2Grid(N, h), zs = o.dim === 2 ? o.zs : o.H / 2, mk = mx2Mark(G, mxSlice(mxSolids({ ...o, gapW: gs.gapW, gapF: gs.gapF }, 0), zs), o.mesh.sub);
  c.fillStyle = cssVar('--graphite'); c.globalAlpha = 0.45;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = (mk.chiU[i + (N + 1) * j] + mk.chiU[i + 1 + (N + 1) * j] + mk.chiV[i + N * j] + mk.chiV[i + N * (j + 1)]) / 4;
    if (s >= 0.5) { const [px, py] = P(x0 + i * h, x0 + (j + 1) * h); c.fillRect(px, py, h * k + 0.5, h * k + 0.5); }
  }
  c.globalAlpha = 0.3; c.strokeStyle = cssVar('--muted'); c.lineWidth = 0.5; c.beginPath();
  for (let i = 0; i <= N; i += step) { const [a, b] = P(x0 + i * h, x0), [, d] = P(x0 + i * h, x0 + N * h); c.moveTo(a, b); c.lineTo(a, d); const [e, f] = P(x0, x0 + i * h), [g2] = P(x0 + N * h, x0 + i * h); c.moveTo(e, f); c.lineTo(g2, f); }
  c.stroke(); c.globalAlpha = 1;
}
/** The mesh from the side (3D): the layers up the batch and the columns across. */
function xmMeshSide(c, o, S, gs, sb) {
  if (o.dim !== 3) return;
  const N = o.mesh.N, Nz = o.mesh.Nz, R = o.D / 2, stepX = Math.max(1, Math.ceil(3 / (gs.h * S.k))), stepZ = Math.max(1, Math.ceil(3 / (gs.hz * S.k)));
  c.globalAlpha = 0.5; c.strokeStyle = cssVar('--muted'); c.lineWidth = 0.5; c.beginPath();
  for (let kz = 0; kz <= Nz; kz += stepZ) { c.moveTo(S.X(-R), S.Z(kz * gs.hz)); c.lineTo(S.X(R), S.Z(kz * gs.hz)); }
  for (let i = 0; i <= N; i += stepX) { const x = gs.x0 + i * gs.h; if (Math.abs(x) > R) continue; c.moveTo(S.X(x), S.Z(0)); c.lineTo(S.X(x), S.Z(o.H)); }
  c.stroke(); c.globalAlpha = 1;
}
/** The faces' numbers on the drawing (Solve), keyed to the boundary conditions' table. */
function xmFaceMarks(c, o, dim, P, S) {
  const F = xmFaces(dim, o), R = o.D / 2, dx = o.rD * Math.cos(Math.PI / o.nBlade), dy = o.rD * Math.sin(Math.PI / o.nBlade);
  const at = [P(-R * 0.72, -R * 0.72), P(o.ro + o.rs * 0.6, o.rs * 0.15), P(dx, dy), P(R * 0.95, R * 0.75)];
  if (dim === 3) at.push([S.X(-R * 0.6), S.Z(0) - 10], [S.X(-R * 0.6), S.Z(o.H) - 10]);
  F.forEach((f, i) => { const p = at[i]; if (!p) return; c.fillStyle = f.c; c.beginPath(); c.arc(p[0], p[1], 9, 0, 7); c.fill(); c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), p[0], p[1] + 4); });
}
/** The faces and what holds there, in the drawing's order. */
function xmFaces(dim, o) {
  const wall = cssVar(XM_C.wall).trim() || '#3b4048', blade = cssVar(XM_C.blade).trim() || '#1f5bd8', disc = cssVar('--bad').trim() || '#c92a2a', mut = cssVar('--muted');
  const H = dim === 2 ? o.heat : null, Wa = 2 * Math.PI * o.No, Wb = Wa * (1 + o.dir * o.ratio), Wd = Wa + 2 * Math.PI * o.Nd;
  const F = [
    { t: 'Vessel wall', c: wall, bc: ['no slip: still', H ? `the jacket: ${xmSig(H.hJ)} W/(m²·K) to ${H.Tj} °C (UA over the wetted area)` : 'still'] },
    { t: 'Blades\' bars', c: blade, bc: [`move with the blade: the arm ${xmSig(Wa)} rad/s about the vessel's axis, the blade ${xmSig(Wb - Wa)} rad/s more about its own`, H ? 'carried with the paste (no heat of their own)' : 'their power and torque'] },
    { t: dim === 2 && !xmCutsDisc(o) ? (o.zs > o.hD ? 'Disperser\'s shaft' : 'Disperser (not in the slice)') : 'Disperser (disc, teeth, shaft)', c: disc, bc: [`spins at ${xmSig(Wd - Wa)} rad/s on the arm (${xmRpm(o.Nd)})${o.Nd > 0 ? '' : ': still on the arm, carried round'}`, H ? 'carried with the paste' : 'its power and torque'] },
    { t: 'Outside the vessel', c: mut, bc: ['the box beyond the wall: held still', '—'] },
  ];
  if (dim === 3) F.push({ t: 'Floor', c: wall, bc: ['no slip: still', 'the grid\'s own face'] }, { t: 'The batch\'s top', c: '#1c7ed6', bc: ['a flat free surface: nothing through it, no shear along it', 'its level from the 1D'] });
  return F;
}

// ---- the stage's adapter ----
SWB_ADAPT.slurry = {
  key: 'mix', sk: 'slurry', t: 'Mixing', ready: 'mix', sid: 'xmp',
  S: () => XMS,
  inputs: dim => (dim === 1 ? null : xmInputs(dim)),
  current: dim => xmCurrent(dim),
  failed: dim => xmFailed(dim),
  request: dim => solveArm('xmp' + dim),
  stop: () => xmStop(),
  why: () => 'The 2D and 3D take the batch as the 1D leaves it at a step of the program: Mixing › 1D solves the batch first.',
  slow3: 'The 3D takes about a minute',
  dofs: dim => (dim === 3 ? 4 : 3), coupled: 'the velocity and the pressure',
  axisNames: dim => (dim === 2 ? ['Across the vessel (x)', 'Across the vessel (y)'] : ['Across the vessel (x)', 'Across the vessel (y)', 'Up the batch (z)']),
  meshFields: dim => (dim === 2 ? [
    { k: 'xmN', t: 'Cells across the vessel', min: 32, max: 384, step: 8, int: true, def: XM_MESH_DEF[2].xmN },
    { k: 'xmSteps', t: 'Time steps per arm turn', min: 24, max: 2000, step: 12, int: true, def: XM_MESH_DEF[2].xmSteps },
    { k: 'xmTurns', t: 'Arm turns solved', min: 0.1, max: 20, step: 0.1, def: XM_MESH_DEF[2].xmTurns },
    { k: 'xmSub', t: 'Samples per face side (the solids\' share)', min: 1, max: 6, step: 1, int: true, def: XM_MESH_DEF[2].xmSub },
    { k: 'xmGap', t: 'Least gap to the wall, in cells', min: 0, max: 4, step: 0.5, def: XM_MESH_DEF[2].xmGap },
    { k: 'xmTr', t: 'Tracers', min: 0, max: 20000, step: 100, int: true, def: XM_MESH_DEF[2].xmTr },
  ] : [
    { k: 'xmN', t: 'Cells across the vessel', min: 16, max: 96, step: 8, int: true, def: XM_MESH_DEF[3].xmN },
    { k: 'xmNz', t: 'Cells up the batch', min: 8, max: 96, step: 4, int: true, def: XM_MESH_DEF[3].xmNz },
    { k: 'xmAng', t: 'Moments over the blades\' cycle', min: 1, max: 24, step: 1, int: true, def: XM_MESH_DEF[3].xmAng },
    { k: 'xmTurns', t: 'Arm turns for the tracers', min: 0, max: 20, step: 0.5, def: XM_MESH_DEF[3].xmTurns },
    { k: 'xmSteps', t: 'Tracer steps per arm turn', min: 12, max: 1000, step: 12, int: true, def: XM_MESH_DEF[3].xmSteps },
    { k: 'xmSub', t: 'Samples per cell side (the solids\' share)', min: 1, max: 4, step: 1, int: true, def: XM_MESH_DEF[3].xmSub },
    { k: 'xmGap', t: 'Least gap to the wall and the floor, in cells', min: 0, max: 4, step: 0.5, def: XM_MESH_DEF[3].xmGap },
    { k: 'xmTr', t: 'Tracers', min: 0, max: 20000, step: 100, int: true, def: XM_MESH_DEF[3].xmTr },
  ]),
  meshHow: dim => `A fixed staggered (MAC) grid of square cells over the vessel${dim === 3 ? ', layers up the batch' : ''}: the velocity on the cells' faces, the pressure at their centres. The wall, the blades' bars and the disperser move through it (nothing is remeshed): each face's share of solid, sampled, gives it a drag toward the solid's own velocity (Brinkman penalization). A gap narrower than the least gap set is opened to it (a grid that cannot see a gap would close it and the bar would scrape the wall); refined, it comes back to the true gap.`,
  meshStats: (dim, o) => {
    // (nodes: the grid's corners; elements: its cells; unknowns: the velocity on the faces and the pressure in the cells)
    const N = o.mesh.N, Nz = dim === 3 ? o.mesh.Nz : 1, cells = N * N * Nz, faces = dim === 3 ? 3 * N * N * Nz + 2 * N * Nz + N * N : 2 * N * (N + 1);
    return { nodes: (N + 1) * (N + 1) * (dim === 3 ? Nz + 1 : 1), elems: cells, unknowns: faces + cells, band: 0 };
  },
  meshTiles: (dim, o) => {
    const g = xmGrid(o), st = SWB_ADAPT.slurry.meshStats(dim, o), cut = g.gapW > o.dw * (1 + 1e-9);
    return [['Cells', st.elems.toLocaleString('en'), dim === 3 ? `${o.mesh.N} × ${o.mesh.N} × ${o.mesh.Nz}` : `${o.mesh.N} × ${o.mesh.N}, square`, 'mesh'],
      ['Cell size', `${xmMm(g.h)} mm`, dim === 3 ? `across; ${xmMm(g.hz)} mm up` : 'across the vessel', 'grading'],
      ['Unknowns', st.unknowns.toLocaleString('en'), 'velocity on the faces, pressure in the cells', 'tune'],
      ['Wall gap', `${(o.dw / g.h).toFixed(2)} cells`, cut ? `${xmMm(o.dw)} mm opened to ${xmMm(g.gapW)} mm on this grid` : `${xmMm(o.dw)} mm: resolved`, 'ratio', cut ? 'warn' : ''],
      ...(dim === 3 ? [['Floor gap', `${(o.db / g.hz).toFixed(2)} cells`, g.gapF > o.db * (1 + 1e-9) ? `${xmMm(o.db)} mm opened to ${xmMm(g.gapF)} mm` : `${xmMm(o.db)} mm: resolved`, 'ratio']] : [['Time step', `${xmSig(xmTurn(o) / o.mesh.steps * 1000)} ms`, `${o.mesh.steps} per arm turn`, 'period']])];
  },
  meshHTML: (dim, o) => {
    const A = SWB_ADAPT.slurry, set = swbSettings(A, dim), F = A.meshFields(dim), g = xmGrid(o);
    const card = `<section class="swb-card"><h4>${uiBadge('tune')}Mesh, time and tracers</h4><table class="swb-t swb-set"><tbody>${F.map(f => `<tr><th scope="row"><label for="swbm_${f.k}">${f.t}</label></th><td><input type="number" id="swbm_${f.k}" data-swbm="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${set[f.k]}" aria-label="${f.t}"></td><td class="swb-u"></td><td class="swb-def">${set[f.k] === f.def ? '' : `default ${f.def}`}</td></tr>`).join('')}</tbody></table><p class="fv-why">${A.meshHow(dim)}</p></section>`;
    const res = [['Wall gap (bars to the wall)', `${xmMm(o.dw)} mm`, `${(o.dw / g.h).toFixed(2)}`, g.gapW > o.dw * (1 + 1e-9) ? `opened to ${xmMm(g.gapW)} mm` : 'as it is'],
      ...(dim === 3 ? [['Floor gap (bottom bars to the floor)', `${xmMm(o.db)} mm`, `${(o.db / g.hz).toFixed(2)}`, g.gapF > o.db * (1 + 1e-9) ? `opened to ${xmMm(g.gapF)} mm` : 'as it is']] : []),
      ['Bar thickness', `${xmMm(o.t)} mm`, `${(o.t / g.h).toFixed(2)}`, 'sampled'], ['Disc thickness', `${xmMm(o.tD)} mm`, `${(o.tD / (dim === 3 ? g.hz : g.h)).toFixed(2)}`, dim === 3 ? 'sampled through its layers' : 'only in a slice through it'],
      ['Disc clear of the blades\' sweep', `${xmMm(mixGeom({ ...mixSetup(), V: Math.PI * o.D * o.D / 4 * o.H }).cB)} mm`, `${(mixGeom({ ...mixSetup(), V: Math.PI * o.D * o.D / 4 * o.H }).cB / g.h).toFixed(2)}`, 'sampled']];
    const tab = `<section class="swb-card"><h4>${uiBadge('grading')}What the grid sees</h4><table class="swb-t"><thead><tr><th scope="col">Feature</th><th scope="col">Size</th><th scope="col">Cells</th><th scope="col">On this grid</th></tr></thead><tbody>${res.map(r => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>
      <p class="fv-why">Under a cell, a feature is felt through the share of its cells' faces it covers. The gaps' own shear is the 1D's wall and floor zones; here they are ${dim === 3 ? 'opened to the least gap: refine (Cells across, up) to close them' : 'opened to the least gap: refine (Cells across) to close it'}.</p></section>`;
    return `<div class="swb-tables">${card}${tab}</div>`;
  },
  extraMeshes: () => '',
  paneTitles: dim => ({ geometry: dim === 2 ? 'The slice and where it is' : 'The batch, from above and from the side', mesh: 'The grid and the cells the parts fill', solve: 'The faces and what holds there' }),
  layout: (dim, o) => ({ noMirror: true, parts: [{ k: 'paste', t: 'The batch (paste)', c: XM_C.paste, rects: [] }, { k: 'wall', t: 'Vessel wall', c: XM_C.wall, rects: [] }, { k: 'blade', t: 'Blades\' bars', c: XM_C.blade, rects: [] }, { k: 'disc', t: 'Disperser', c: XM_C.disc, rects: [] }] }),
  draw: (cv, dim, o, step) => xmDraw(cv, dim, o, step),
  domain: dim => ({ 2: 'a horizontal slice of the batch, the parts cutting it moving through it', 3: 'the whole batch from the floor to its level, every part moving through it' }[dim]),
  domainShort: (dim, o) => (dim === 2 ? `the slice ${xmMm(o.zs)} mm up, ${xmMm(o.D)} mm across` : `${xmMm(o.D)} mm across, ${xmMm(o.H)} mm deep`),
  parts: (dim, o) => [
    { t: 'The batch', c: XM_C.paste, mat: 'GO slurry', rec: 'slurry', size: `${(Math.PI * o.D * o.D / 4 * o.H * 1000).toFixed(1)} L, ${xmMm(o.H)} mm deep`, how: `${o.stepName}'s end (the 1D): ${o.rho.toFixed(0)} kg/m³, its flow curve, ${o.T.toFixed(1)} °C` },
    { t: 'Vessel', c: XM_C.wall, mat: 'stainless steel (still)', rec: null, size: `${xmMm(o.D)} mm inside`, how: dim === 2 ? 'the slice\'s outer wall, the jacket behind it' : 'its wall and floor' },
    { t: `Blades (${o.nBlade}, ${o.nBar} bars each)`, c: XM_C.blade, mat: 'moving solids', rec: null, size: `bars ${xmMm(o.w)} × ${xmMm(o.t)} mm, axes ${xmMm(o.ro)} mm out`, how: `the arm ${xmRpm(o.No)}, each blade ×${o.ratio} ${o.dir > 0 ? 'with' : 'against'} it` },
    { t: 'Disperser', c: XM_C.disc, mat: 'moving solid', rec: null, size: `disc ${xmMm(o.Dd)} × ${xmMm(o.tD)} mm, ${o.nT} teeth, shaft ${xmMm(o.dS)} mm`, how: `${xmRpm(o.Nd)} on the arm, ${xmMm(o.rD)} mm out, ${xmMm(o.hD)} mm up` }],
  domainRows: (dim, o) => {
    const R = xmRe(o);
    return [['Domain', SWB_ADAPT.slurry.domain(dim)], ['Step solved', `${o.step + 1}. ${o.stepName}: arm ${xmRpm(o.No)}, disperser ${xmRpm(o.Nd)} (the inputs bar: 2D and 3D)`],
      ['The batch', `as the 1D leaves it at the step's end: ${xmMm(o.H)} mm deep, ${o.rho.toFixed(0)} kg/m³, ${o.T.toFixed(1)} °C; ${xmSig(xmMu(o, 1))} Pa·s at 1 1/s, ${xmSig(xmMu(o, 100))} at 100`],
      ...(dim === 2 ? [['The slice', `${xmMm(o.zs)} mm above the floor (${Math.round(o.zs / o.H * 100)} % of the batch's depth): ${xmCutsDisc(o) ? 'through the disc -- the 2D takes it as a cylinder as tall as the slice, not the thin disc it is (the 3D sees the disc)' : o.zs > o.hD ? 'through the bars and the disperser\'s shaft' : 'through the bars, under the disc'}`]] : [['Sections shown', `A ${xmMm(o.levels[0])} mm (the floor gap's layer), B ${xmMm(o.levels[1])} mm (the disc), C ${xmMm(o.levels[2])} mm (the middle); and up through the arm`]]),
      ['Reynolds number at the bars', `${xmSig(R.Re)} (ρ V t / μ, V ${xmSig(R.V)} m/s): ${R.Re < 10 ? 'slow, viscous flow' : 'inertia matters'}`]];
  },
  geoTiles: (dim, o) => [['Vessel', `${xmMm(o.D)} mm`, `the batch ${xmMm(o.H)} mm deep`, 'section'], ['Step', `${o.step + 1} of ${mixIn().steps.length}`, `${o.stepName}: the batch at its end`, 'period'],
    ['Arm', xmRpm(o.No), `blades ×${o.ratio} ${o.dir > 0 ? 'with' : 'against'} it`, 'flow'], ['Disperser', xmRpm(o.Nd), `${xmMm(o.Dd)} mm disc`, 'flow'],
    dim === 2 ? ['Slice', `${xmMm(o.zs)} mm`, 'above the floor', 'cut'] : ['Batch', `${(Math.PI * o.D * o.D / 4 * o.H * 1000).toFixed(1)} L`, `${o.rho.toFixed(0)} kg/m³`, 'weight']],
  geoNote: (dim, o) => (dim === 2 ? 'Left, the slice at the start: what it cuts of the parts (the bars, and the disperser\'s shaft above the disc or the disc at its height). Right, its height in the batch.' : 'Left, every part seen from above at the start. Right, the batch from the side: blade 1 square on, the others edge on; the sections A, B and C the results show.'),
  meshNote: (dim, o) => `Shaded: the cells the parts fill at the start (${dim === 3 ? 'at mid-depth' : 'in the slice'}), as the grid sees them.`,
  physics: (dim, o) => {
    const muRow = `μ(γ̇) the batch's at the step's end (the 1D: its flow curve with its lumps, flakes and temperature), log–log between ${xmSig(MIX_LAW_GD[0])} and ${xmSig(MIX_LAW_GD[MIX_LAW_GD.length - 1])} 1/s; ρ ${o.rho.toFixed(0)} kg/m³`;
    if (dim === 2) return [['Flow (slice)', 'ρ (∂u/∂t + u·∇u) = −∇p + ∇·(2 μ(γ̇) D) + λ χ (u_s − u),  ∇·u = 0', muRow],
      ['Heat', 'ρ c (∂T/∂t + u·∇T) = ∇·(k ∇T) + μ γ̇²', `c ${o.heat.cp.toFixed(0)} J/(kg·K) (the 1D's), k ${o.heat.k} W/(m·K); from ${o.heat.T0.toFixed(1)} °C`],
      ['Tracers', 'dx/dt = u;  strain ∫ γ̇ dt;  time where μ γ̇ ≥ the lumps\' strength', `${o.tracers.n} seeded over the slice; the lumps' strength ${(o.tracers.tauC).toFixed(0)} Pa (a piece at 1 mm)`]];
    return [['Flow (creeping, at each moment)', '0 = −∇p + ∇·(2 μ(γ̇) D) + λ χ (u_s − u),  ∇·u = 0', muRow],
      ['Heat made', 'q = μ γ̇² (where the shear heats the batch; its temperature: the 1D and the 2D)', 'from the flow at each moment'],
      ['Tracers', 'dx/dt = u(x, t): the cycle\'s flow repeated, turned with the arm', `${o.tracers.n} seeded through the batch; strain ∫ γ̇ dt`]];
  },
  coupling: dim => (dim === 2 ? 'velocity and pressure together each step; the viscosity from the extrapolated shear rate (BDF2); the heat carried by the step\'s velocity; tracers by the midpoint rule. One way: the heat does not change the viscosity within the turns solved (a few mK).' : 'velocity and pressure together; the viscosity by Picard passes on the shear rate at each moment; tracers through the moments\' flows.'),
  bcCols: ['Flow', 'Heat / note'],
  faces: (dim, o) => xmFaces(dim, o),
  timeTitle: 'Time', timeCols: ['Run', 'For', 'Conditions', 'Steps'],
  time: (dim, o) => (dim === 2 ? [['Arm turns', `${o.mesh.turns} × ${xmSig(xmTurn(o))} s`, `from the creeping flow at the start; the parts moving at the step's speeds`, String(Math.round(o.mesh.turns * o.mesh.steps))]]
    : [['Moments', `over ${xmSig(360 / (o.ratio * o.nBar))}° of the arm's turn`, 'the blades\' frames come back to the same place against the arm after it', String(o.mesh.nAng)],
      ['Tracers', o.mesh.turns > 0 ? `${o.mesh.turns} arm turns (${xmSig(o.mesh.turns * xmTurn(o))} s)` : 'none', 'the cycle\'s flow repeated, turned with the arm', String(Math.round(o.mesh.turns * o.mesh.steps))]]),
  solver: (dim, o, r) => {
    const g = xmGrid(o);
    return [['Grid', `staggered (MAC), ${dim === 3 ? `${o.mesh.N} × ${o.mesh.N} × ${o.mesh.Nz}` : `${o.mesh.N} × ${o.mesh.N}`}, ${xmMm(g.h)} mm cells`],
      ['Moving parts', `Brinkman penalization: λ = 10³ μ_ref / h², each face's solid share from ${o.mesh.sub}${dim === 3 ? '³' : '²'} samples; least gap ${o.mesh.gapCells} cells`],
      ['In time', dim === 2 ? `BDF2, ${o.mesh.steps} steps per arm turn (${xmSig(xmTurn(o) / o.mesh.steps * 1000)} ms), convection linearized about the extrapolated velocity, upwinded where a cell's Péclet number passes 2` : 'creeping at each moment (no inertia): the flow follows from where the parts are'],
      ['Linear solve', 'FGMRES (restart 30), preconditioned by a multigrid V-cycle with Vanka\'s coupled cell smoother; to 10⁻⁶'],
      ['Checked', 'Couette and power-law Couette exact torques; a cylinder\'s exact drag; the off-axis cylinder against OpenFOAM; spin-up against its Bessel series; the heat against the power; tracers in solid-body turning; a sphere\'s exact torque and drag in 3D (mix-mp.validate.js)'],
      ...(r ? [['Balance', xmBal(dim, r)], ['Solved in', `${(r.ms / 1000).toFixed(1)} s`]] : [])];
  },
  solveTiles: (dim, o, r) => [['Step', `${o.step + 1} of ${mixIn().steps.length}`, o.stepName, 'period'], ['Arm', xmRpm(o.No), `disperser ${xmRpm(o.Nd)}`, 'flow'],
    ['Reynolds', xmSig(xmRe(o).Re), 'at the bars', 'ratio'], ['Solved in', r ? `${(r.ms / 1000).toFixed(1)} s` : '—', r ? 'for the inputs as they are' : 'not solved yet', 'play']],
  resultsHTML: dim => xmHTML(dim),
  renderResults: dim => xmRender(dim),
  csv: dim => xmCsv(dim),
  openInputs: () => { setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="mx-mp"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('select, input'); if (f) f.focus(); } },
};
/** The energy kept, in words: the heat the shear makes against the power the parts put in. */
function xmBal(dim, r) {
  if (dim === 2) { const H = r.hist.slice(1), P = H.reduce((s, q) => s + q.P.reduce((a, b) => a + b, 0), 0) / H.length, D = H.reduce((s, q) => s + q.Dis, 0) / H.length; return `the shear's heat ∫ μ γ̇² ${xmSig(D)} W/m against the parts' ${xmSig(P)} W/m (${(D / P * 100).toFixed(0)} %; the rest in the parts' drag layer)`; }
  const P = r.moments.reduce((s, q) => s + q.P.reduce((a, b) => a + b, 0), 0) / r.moments.length, D = r.moments.reduce((s, q) => s + q.Dis, 0) / r.moments.length;
  return `the shear's heat ∫ μ γ̇² ${xmSig(D)} W against the parts' ${xmSig(P)} W (${(D / P * 100).toFixed(0)} %; the rest in the parts' drag layer)`;
}

// ---- the answers (the Results step) ----
const XM_FIELDS = { speed: ['Speed', 'm/s'], gd: ['Shear rate', '1/s'], mu: ['Viscosity', 'Pa·s'], q: ['Heat made', 'kW/m³'], p: ['Pressure', 'kPa'], dT: ['Temperature rise', 'mK'], uz: ['Up-flow', 'mm/s'] };
function xmHTML(dim) {
  const pane = (id, icon, title, aria, extra = '') => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}<span id="${id}T">${title}</span>${extra}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  const chips = (id, label) => `<span class="vp-spacer"></span><span class="seg seg-sm" role="tablist" aria-label="${label}" id="${id}"></span>`;
  if (dim === 2) return `<section class="mp-sec mp-bench" id="xmSec" aria-label="The mixer's slice in 2D: its answers">
    <div class="stats mp-stats" id="xmStats"></div>
    <div class="mp-chipbar"><span class="seg seg-sm" role="tablist" aria-label="What the map shows" id="xmField"></span><span class="seg seg-sm" role="tablist" aria-label="The moment shown" id="xmSnap"></span></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('xm1', 'section', 'On the slice', 'A map of the slice: the field chosen at the moment chosen, the parts drawn over it')}
      ${pane('xm3', 'fibre', 'Tracers after the turns', 'Where the tracers are at the end, coloured by the half of the slice they started in')}
    </div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('xm2', 'flow', 'Power against time', 'Each part\'s power per height of the slice against time, and the 1D\'s')}
      ${pane('xm4', 'ratio', 'Mixing against time', 'The intensity of segregation of the tracers against time: 1 unmixed, 0 evenly mixed')}
    </div>
    <div class="mp-compare" id="xmCompare"></div>
  </section>`;
  return `<section class="mp-sec mp-bench" id="xmSec" aria-label="The mixer's batch in 3D: its answers">
    <div class="stats mp-stats" id="xmStats"></div>
    <div class="mp-chipbar"><span class="seg seg-sm" role="tablist" aria-label="What the sections show" id="xmField"></span><span class="seg seg-sm" role="tablist" aria-label="The moment shown" id="xmSnap"></span><span class="seg seg-sm" role="tablist" aria-label="The horizontal section's level" id="xmLev"></span></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('xm1', 'section', 'Across the batch', 'A horizontal section of the batch at the level chosen: the field chosen at the moment chosen')}
      ${pane('xm5', 'cut', 'Up through the arm', 'A vertical section through the vessel\'s axis and the blades\' axes: the field chosen at the moment chosen')}
    </div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('xm2', 'flow', 'Power over the cycle', 'Each part\'s power at each moment over the blades\' cycle, and the 1D\'s')}
      ${pane('xm4', 'ratio', 'Mixing against time', 'The intensity of segregation of the tracers against time, and the strain they gathered')}
    </div>
    <div class="mp-compare" id="xmCompare"></div>
  </section>`;
}
function xmWireSec(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.xmsnap != null) XMS.snap = +t.dataset.xmsnap;
    else if (t.dataset.xmfield) XMS.field = t.dataset.xmfield;
    else if (t.dataset.xmlev != null) XMS.lev = +t.dataset.xmlev;
    else return;
    xmRender(XMS.dim);
  });
}
function xmRender(dim) {
  const sec = document.getElementById('xmSec');
  if (!sec) return;
  if (!sec.dataset.wired) xmWireSec(sec);
  const o = xmInputs(dim), r = xmCurrent(dim) ? XMS.res[dim] : null, ids = dim === 2 ? ['xm1', 'xm2', 'xm3', 'xm4'] : ['xm1', 'xm5', 'xm2', 'xm4'];
  if (!o || !r) {
    paneEmptyIds(ids, paneWhy('xmp' + dim));
    for (const id of ids) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    for (const id of ['xmField', 'xmSnap', 'xmLev']) { const el = document.getElementById(id); if (el) el.innerHTML = ''; }
    const st = document.getElementById('xmStats');
    if (st) st.innerHTML = xmFailed(dim) ? `<p class="dry-msg">${pill(`The ${dim}D could not be solved: ${dryEsc(XMS.error[dim])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${XMS.busy ? `Solving the ${dim}D: its answers here when it is done.` : 'Not solved for the inputs as they are.'}</p>`;
    const cmp = document.getElementById('xmCompare'); if (cmp) cmp.innerHTML = '';
    return;
  }
  const fields = dim === 2 ? ['speed', 'gd', 'mu', 'q', 'p', 'dT'] : ['speed', 'uz', 'gd', 'mu', 'q'];
  if (!fields.includes(XMS.field)) XMS.field = 'speed';
  document.getElementById('xmField').innerHTML = fields.map(k => `<button type="button" role="tab" data-xmfield="${k}" aria-selected="${k === XMS.field}">${XM_FIELDS[k][0]}</button>`).join('');
  const moments = dim === 2 ? r.snaps.map((s, i) => [i, `${xmSig(s.t)} s`]) : r.moments.map((m, i) => [i, `${(m.phi * 180 / Math.PI).toFixed(0)}°`]);
  if (!(XMS.snap >= 0 && XMS.snap < moments.length)) XMS.snap = dim === 2 ? moments.length - 1 : 0;
  document.getElementById('xmSnap').innerHTML = moments.map(([k, t]) => `<button type="button" role="tab" data-xmsnap="${k}" aria-selected="${k === XMS.snap}">${t}</button>`).join('');
  if (dim === 2) { xm2Tiles(o, r); xm2Map(o, r); xm2Power(o, r); xm2Tracers(o, r); xmMixing(o, r, 2); }
  else {
    if (!(XMS.lev >= 0 && XMS.lev < r.levels.length)) XMS.lev = 1;
    document.getElementById('xmLev').innerHTML = r.sections[0].horiz.map((s, i) => `<button type="button" role="tab" data-xmlev="${i}" aria-selected="${i === XMS.lev}">${['A', 'B', 'C'][i] || i + 1} · ${xmMm(s.z)} mm</button>`).join('');
    xm3Tiles(o, r); xm3Horiz(o, r); xm3Vert(o, r); xm3Power(o, r); xmMixing(o, r, 3);
  }
  xmCompare(o, r, dim);
}
/** A field's colour scale and its values' format. */
function xmScale(k, vals) {
  let lo = Infinity, hi = -Infinity; for (const v of vals) { if (!Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) { lo = Number.isFinite(lo) ? lo - 1e-9 : 0; hi = lo + 1e-6; }
  if (k === 'gd' || k === 'mu' || k === 'q') { const top = Math.max(hi, 1e-9); return { lut: k === 'q' ? mpHeatLut() : getLut('seq'), sc: { min: Math.max(lo, top * 1e-4, 1e-9), max: top, log: true, levels: 0 } }; }
  if (k === 'p' || k === 'uz') { const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-12); return { lut: getLut('div'), sc: { min: -m, max: m, levels: 0 } }; }
  if (k === 'dT') return { lut: mpHeatLut(), sc: { min: Math.min(0, lo), max: Math.max(hi, lo + 1e-6), levels: 0 } };
  return { lut: getLut('seq'), sc: { min: 0, max: Math.max(hi, 1e-9), levels: 0 } };
}
const xmFmt = (k, v) => (k === 'gd' || k === 'mu' || k === 'q' ? xmSig(v) : xmSig(v));
/** The colour bar's HTML. */
const xmBar = (lut, sc, unit, f) => `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${f(sc.min)}</span><span>${unit}${sc.log ? ' (log)' : ''}</span><span>${f(sc.max)}</span></span></div>`;
/** A map of N × N cells (x across, y up), the solid cells grey; returns the frame's P(x, y). */
function xmCells(c, box, G, val, fluid, lut, sc) {
  const [bx, by, bs] = box, N = G.N, k = bs / (N * G.h), P = (x, y) => [bx + (x - G.x0) * k, by + bs - (y - G.x0) * k], cs = G.h * k;
  const solid = swbFill(XM_C.wall, 0.55);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const q = i + N * j, x = G.x0 + i * G.h, y = G.x0 + (j + 1) * G.h, [px, py] = P(x, y);
    if (fluid && !fluid[q]) { if (Math.hypot(x + G.h / 2, y - G.h / 2) > N * G.h / 2) continue; c.fillStyle = solid; }
    else c.fillStyle = lutColor(lut, scaleT(sc, val(q)));
    c.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cs) + 1, Math.ceil(cs) + 1);
  }
  return { P, k };
}
/** Arrows of the in-plane velocity, every few cells. */
function xmArrows(c, P, k, G, ux, uy, fluid, vmax) {
  const N = G.N, every = Math.max(2, Math.round(N / 18)), L = every * G.h * k * 0.9;
  c.strokeStyle = cssVar('--ink'); c.globalAlpha = 0.6; c.lineWidth = 1;
  for (let j = every >> 1; j < N; j += every) for (let i = every >> 1; i < N; i += every) {
    const q = i + N * j; if (fluid && !fluid[q]) continue;
    const u = ux[q], v = uy[q], s = Math.hypot(u, v); if (!(s > vmax * 0.03)) continue;
    const [px, py] = P(G.x0 + (i + 0.5) * G.h, G.x0 + (j + 0.5) * G.h), l = L * Math.min(1, s / vmax), ax = u / s, ay = -v / s, hd = Math.min(4, 0.35 * l), hw = 0.7 * hd;
    if (l < 3) continue;
    c.beginPath(); c.moveTo(px - ax * l / 2, py - ay * l / 2); c.lineTo(px + ax * l / 2, py + ay * l / 2);
    c.lineTo(px + ax * l / 2 - (ax * hd - ay * hw), py + ay * l / 2 - (ay * hd + ax * hw)); c.moveTo(px + ax * l / 2, py + ay * l / 2); c.lineTo(px + ax * l / 2 - (ax * hd + ay * hw), py + ay * l / 2 - (ay * hd - ax * hw)); c.stroke();
  }
  c.globalAlpha = 1;
}
/** The 2D's field at a snapshot (per cell). */
function xm2Field(o, s, k) {
  if (k === 'speed') return q => Math.hypot(s.uc[q], s.vc[q]);
  if (k === 'gd') return q => s.gd[q];
  if (k === 'mu') return q => s.mu[q];
  if (k === 'q') return q => s.mu[q] * s.gd[q] * s.gd[q] / 1000;
  if (k === 'p') return q => s.p[q] / 1000;
  return q => (s.dT ? s.dT[q] * 1000 : 0);
}
function xm2Map(o, r) {
  const cv = document.getElementById('xm1'), lg = document.getElementById('xm1Lg');
  if (!cv) return;
  const s = r.snaps[XMS.snap], G = r.G, k = XMS.field, f = xm2Field(o, s, k), vals = [];
  for (let q = 0; q < G.N * G.N; q++) if (s.fluid[q]) vals.push(f(q));
  const { lut, sc } = xmScale(k, vals), { c, w, h } = setupCanvas(cv, 0.9), bs = Math.min(w - 16, h - 16);
  c.clearRect(0, 0, w, h);
  const box = [(w - bs) / 2, 8, bs], M = xmCells(c, box, G, f, s.fluid, lut, sc);
  if (k === 'speed') { let vm = 0; for (const v of vals) vm = Math.max(vm, v); xmArrows(c, M.P, M.k, G, s.uc, s.vc, s.fluid, vm); }
  // (the parts' true outlines at the moment, over the cells the grid filled)
  c.save(); c.strokeStyle = cssVar('--ink'); c.lineWidth = 1.2;
  for (const so of mxSlice(mxSolids({ ...o, gapW: r.gapW }, s.t), o.zs)) {
    if (!so.own) continue;
    c.beginPath();
    if (so.poly) { so.poly.forEach(([x, y], n) => (n ? c.lineTo(...M.P(x, y)) : c.moveTo(...M.P(x, y)))); c.closePath(); }
    else if (so.circ) { const [x, y, rr] = so.circ, [px, py] = M.P(x, y); c.arc(px, py, rr * M.k, 0, 7); }
    c.stroke();
  }
  c.beginPath(); c.arc(...M.P(0, 0), o.D / 2 * M.k, 0, 7); c.stroke(); c.restore();
  document.getElementById('xm1T').textContent = `On the slice: ${XM_FIELDS[k][0].toLowerCase()}, at ${xmSig(s.t)} s (the arm at ${((s.phi * 180 / Math.PI) % 360).toFixed(0)}°)`;
  lg.innerHTML = xmBar(lut, sc, XM_FIELDS[k][1], v => xmFmt(k, v)) + `<p class="fv-why">${{ speed: 'Arrows: the paste\'s velocity in the slice.', gd: 'Highest at the bars\' edges, in their gap to the wall and round the disperser.', mu: 'The paste thins where it is sheared hardest.', q: 'μ γ̇²: where the work the parts do turns to heat.', p: 'Ahead of each bar the paste is pushed up, behind it drawn down.', dT: `Its rise since the start (${o.heat.T0.toFixed(1)} °C): over ${xmSig(r.snaps[r.snaps.length - 1].t)} s the batch warms by millikelvins; the 1D carries it over the step.` }[k]} Grey: the cells the parts fill on this grid; outlines: the parts themselves.</p>`;
}
function xm2Power(o, r) {
  const cv = document.getElementById('xm2'), lg = document.getElementById('xm2Lg');
  if (!cv) return;
  const H = r.hist.slice(1), cols = ['#1c7ed6', '#2f9e44', '#ae3ec9'], heat = cssVar('--heat').trim(), S = [];
  for (let b = 1; b <= o.nBlade; b++) S.push({ p: H.map(q => [q.t, q.P[b]]), c: cols[(b - 1) % cols.length], w: 1.8, l: `blade ${b}` });
  S.push({ p: H.map(q => [q.t, q.P[o.nBlade + 1]]), c: heat, w: 1.8, l: xmFaces(2, o)[2].t.toLowerCase() });
  const ys = S.flatMap(q => q.p.map(p => p[1])), one = o.one.PB / Math.max(1e-9, o.one.Hb) / o.nBlade;
  const yt = pmpTicks(Math.min(0, ...ys), Math.max(one, ...ys) * 1.05 + 1e-9, 5), xt = pmpTicks(0, H[H.length - 1].t, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(3)), yf: v => String(+v.toPrecision(4)),
    xl: 'time (s)', yl: 'power per height of the slice (W/m)', hl: [{ y: one, c: cssVar('--muted'), t: '' }], s: S });
  const mean = b => H.reduce((s, q) => s + q.P[b], 0) / H.length;
  lg.innerHTML = oneDLegend([...S.map(q => [q.l, q.c, '']), ['the 1D, a blade per height', cssVar('--muted'), 'dash']]) + `<p class="fv-why">The power each part puts into the paste in the slice. Mean: ${Array.from({ length: o.nBlade }, (_, b) => `blade ${b + 1} ${xmSig(mean(b + 1))}`).join(', ')}, the disperser ${xmSig(mean(o.nBlade + 1))} W/m. A bar passing the wall, the disc or the other blade's sweep raises its power for a moment.</p>`;
}
function xm2Tracers(o, r) {
  const cv = document.getElementById('xm3'), lg = document.getElementById('xm3Lg');
  if (!cv || !r.tracers) { if (cv) paneEmptyIds(['xm3'], 'No tracers (Mesh: Tracers 0)'); return; }
  const T = r.tracers, { c, w, h } = setupCanvas(cv, 0.9), bs = Math.min(w - 16, h - 16), box = [(w - bs) / 2, 8, bs];
  c.clearRect(0, 0, w, h);
  const { P, k } = xmPlan(c, o, box), last = r.snaps[r.snaps.length - 1];
  const ca = '#1c7ed6', cb = cssVar('--heat').trim();
  for (let q = 0; q < T.x.length; q++) { const [px, py] = P(T.x[q], T.y[q]); c.fillStyle = T.y0[q] > 0 ? cb : ca; c.globalAlpha = 0.75; c.fillRect(px - 1.2, py - 1.2, 2.4, 2.4); }
  c.globalAlpha = 1; xmDrawSolids(c, P, o, last.t, 'slice', { gapW: r.gapW, gapF: 0 });
  const st = Array.from(T.strain).sort((a, b) => a - b), med = st[Math.floor(st.length / 2)], hi = Array.from(T.tHigh).filter(v => v > 0).length / T.x.length;
  lg.innerHTML = oneDLegend([['started in the upper half', cb, 'dot'], ['in the lower half', ca, 'dot']]) + `<p class="fv-why">${T.x.length} tracers after ${xmSig(last.t)} s. Their median strain ${xmSig(med)}; ${(hi * 100).toFixed(1)} % met a stress above the lumps' strength (${o.tracers.tauC.toFixed(0)} Pa) at least once.</p>`;
}
/** The intensity of segregation against time (2D, 3D). */
function xmMixing(o, r, dim) {
  const cv = document.getElementById('xm4'), lg = document.getElementById('xm4Lg'), T = r.tracers;
  if (!cv) return;
  if (!T || !T.mix || T.mix.length < 2) { paneEmptyIds(['xm4'], dim === 3 ? 'No tracers (Mesh: arm turns for the tracers 0)' : 'No tracers (Mesh: Tracers 0)'); if (lg) lg.innerHTML = ''; return; }
  const S = [{ p: T.mix.map(m => [m.t, m.I]), c: '#1c7ed6', w: 2.2, l: 'intensity of segregation', dots: T.mix.length < 30 }];
  const xt = pmpTicks(0, T.mix[T.mix.length - 1].t, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: 0, y1: 1, yticks: [0, 0.25, 0.5, 0.75, 1], xticks: xt, xf: v => String(+v.toPrecision(3)), yf: v => v.toFixed(2), xl: 'time (s)', yl: 'segregation (1 unmixed, 0 even)', s: S });
  const end = T.mix[T.mix.length - 1].I, extra = dim === 3 ? ` Median strain ${xmSig(T.median)}; ${(T.lowShare * 100).toFixed(1)} % of the tracers gathered under ${xmSig(T.sLow)} (the strain a parcel needs, the inputs bar).` : '';
  lg.innerHTML = `<p class="fv-why">The tracers coloured by the half they started in (${dim === 3 ? 'the upper or the lower half of the batch' : 'the slice\'s upper or lower half'}), counted in bins of about sixteen: ${xmSig(end)} after ${xmSig(T.mix[T.mix.length - 1].t)} s.${extra}</p>`;
}
function xm2Tiles(o, r) {
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const turn = xmTurn(o), H = r.hist.filter(q => q.t > r.hist[r.hist.length - 1].t - turn + 1e-9 && q.t > 0), nb = o.nBlade;
  const mean = f => H.reduce((s, q) => s + f(q), 0) / Math.max(1, H.length);
  const pB = mean(q => q.P.slice(1, nb + 1).reduce((a, b) => a + b, 0)), pD = mean(q => q.P[nb + 1]), tqW = mean(q => q.Tq[0]), last = r.snaps[r.snaps.length - 1];
  let dTmax = 0, nf = 0, dead = 0; for (let q = 0; q < last.gd.length; q++) if (last.fluid[q]) { nf++; if (last.dT) dTmax = Math.max(dTmax, last.dT[q]); if (last.gd[q] < mixIn().gdDead) dead++; }
  const T = r.tracers, mixEnd = T && T.mix.length ? T.mix[T.mix.length - 1].I : null, Hb = o.one.Hb;
  document.getElementById('xmStats').innerHTML = [
    tile('Blades', `${xmSig(pB)} W/m`, `per height, the last turn's mean: × the bars' ${xmMm(Hb)} mm = ${xmSig(pB * Hb)} W (the 1D ${xmSig(o.one.PB)} W)`, 'flow'),
    tile('Disperser', `${xmSig(pD)} W/m`, xmCutsDisc(o) ? 'the slice cuts the disc: taken as a cylinder (see below)' : xmFaces(2, o)[2].t.toLowerCase(), 'flow', xmCutsDisc(o) ? 'warn' : ''),
    tile('Wall torque', `${xmSig(Math.abs(tqW))} N·m/m`, 'the paste on the vessel, per height', 'weight'),
    tile('Warmest', dTmax >= 1 ? `+${xmSig(dTmax)} K` : `+${xmSig(dTmax * 1000)} mK`, `the hottest paste over ${xmSig(last.t)} s, from ${o.heat.T0.toFixed(1)} °C`, 'temp'),
    tile('Dead', `${(dead / Math.max(1, nf) * 100).toFixed(1)} %`, `of the slice sheared under ${mixIn().gdDead} 1/s at the end`, 'ratio', dead / Math.max(1, nf) > 0.2 ? 'warn' : ''),
    tile('Mixed', mixEnd != null ? xmSig(mixEnd) : '—', mixEnd != null ? `segregation after ${xmSig(last.t)} s (1 unmixed)` : 'no tracers', 'fibre'),
    tile('Reynolds', xmSig(xmRe(o).Re), 'at the bars: viscous flow', 'ratio'),
  ].join('');
}
// ---- 3D ----
/** A 3D section's field (per cell), from the moment's arrays. */
function xm3Field(s, k) {
  if (k === 'speed') return q => Math.hypot(s.ux[q], s.uy[q], s.uz ? s.uz[q] : 0);
  if (k === 'uz') return q => (s.uz ? s.uz[q] * 1000 : 0);
  if (k === 'gd') return q => s.gd[q];
  if (k === 'mu') return q => s.mu[q];
  return q => s.mu[q] * s.gd[q] * s.gd[q] / 1000;
}
function xm3Horiz(o, r) {
  const cv = document.getElementById('xm1'), lg = document.getElementById('xm1Lg');
  if (!cv) return;
  const sec = r.sections[XMS.snap].horiz[XMS.lev], G = { N: r.G.N, h: r.G.h, x0: r.G.x0 }, k = XMS.field, f = xm3Field(sec, k), vals = [];
  for (let q = 0; q < G.N * G.N; q++) if (sec.fluid[q]) vals.push(f(q));
  const { lut, sc } = xmScale(k, vals), { c, w, h } = setupCanvas(cv, 0.9), bs = Math.min(w - 16, h - 16), box = [(w - bs) / 2, 8, bs];
  c.clearRect(0, 0, w, h);
  const M = xmCells(c, box, G, f, sec.fluid, lut, sc);
  if (k === 'speed') { let vm = 0; for (const v of vals) vm = Math.max(vm, v); xmArrows(c, M.P, M.k, G, sec.ux, sec.uy, sec.fluid, vm); }
  const t = r.moments[XMS.snap].t;
  c.save(); c.strokeStyle = cssVar('--ink'); c.lineWidth = 1.2;
  for (const so of mxSlice(mxSolids({ ...o, gapW: r.moments[0].gapW, gapF: r.moments[0].gapF }, t), sec.z)) {
    if (!so.own) continue; c.beginPath();
    if (so.poly) { so.poly.forEach(([x, y], n) => (n ? c.lineTo(...M.P(x, y)) : c.moveTo(...M.P(x, y)))); c.closePath(); }
    else if (so.circ) { const [x, y, rr] = so.circ, [px, py] = M.P(x, y); c.arc(px, py, rr * M.k, 0, 7); }
    c.stroke();
  }
  c.beginPath(); c.arc(...M.P(0, 0), o.D / 2 * M.k, 0, 7); c.stroke(); c.restore();
  document.getElementById('xm1T').textContent = `Across the batch at ${xmMm(sec.z)} mm: ${XM_FIELDS[k][0].toLowerCase()}, the blades at ${(r.moments[XMS.snap].phi * 180 / Math.PI).toFixed(0)}° of their cycle`;
  lg.innerHTML = xmBar(lut, sc, XM_FIELDS[k][1], v => xmFmt(k, v)) + `<p class="fv-why">${k === 'speed' ? 'Arrows: the velocity in the section. ' : k === 'uz' ? 'Red up, blue down: the paste turned over between the floor and the top. ' : ''}Grey: the cells the parts fill on this grid; outlines: the parts cutting this level.</p>`;
}
function xm3Vert(o, r) {
  const cv = document.getElementById('xm5'), lg = document.getElementById('xm5Lg');
  if (!cv) return;
  const V = r.sections[XMS.snap].vert, ns = V.ns, Nz = r.G.Nz, k = XMS.field, kk = k === 'speed' ? 'speed' : k;
  const at = q => (kk === 'speed' ? Math.hypot(V.us[q], V.un[q], V.wz[q]) : kk === 'uz' ? V.wz[q] * 1000 : kk === 'gd' ? V.gd[q] : kk === 'mu' ? xmMu(o, V.gd[q]) : xmMu(o, V.gd[q]) * V.gd[q] * V.gd[q] / 1000);
  const vals = []; for (let q = 0; q < ns * Nz; q++) if (!V.fluid || V.fluid[q]) vals.push(at(q));
  const { lut, sc } = xmScale(k, vals), { c, w, h } = setupCanvas(cv, 0.9), R = o.D / 2, H = Nz * r.G.hz;
  c.clearRect(0, 0, w, h);
  const kx = Math.min((w - 40) / (2 * R), (h - 40) / H), ox = w / 2, oy = h - 24, X = x => ox + x * kx, Z = z => oy - z * kx, ds = 2 * R / ns;
  const solid = swbFill(XM_C.wall, 0.55);
  for (let kz = 0; kz < Nz; kz++) for (let q = 0; q < ns; q++) { const i = q + ns * kz; c.fillStyle = V.fluid && !V.fluid[i] ? solid : lutColor(lut, scaleT(sc, at(i))); c.fillRect(Math.floor(X(-R + q * ds)), Math.floor(Z((kz + 1) * r.G.hz)), Math.ceil(ds * kx) + 1, Math.ceil(r.G.hz * kx) + 1); }
  // (the in-plane velocity: along the section and up)
  if (k === 'speed') {
    let vm = 0; for (let q = 0; q < ns * Nz; q++) vm = Math.max(vm, Math.hypot(V.us[q], V.wz[q]));
    const ev = Math.max(2, Math.round(ns / 16)), L = ev * ds * kx * 0.9; c.strokeStyle = cssVar('--ink'); c.globalAlpha = 0.6; c.lineWidth = 1;
    for (let kz = ev >> 1; kz < Nz; kz += Math.max(1, Math.round(ev * ds / r.G.hz))) for (let q = ev >> 1; q < ns; q += ev) { const i = q + ns * kz, u = V.us[i], v = V.wz[i], s = Math.hypot(u, v); if (!(s > vm * 0.03) || (V.fluid && !V.fluid[i])) continue; const px = X(-R + (q + 0.5) * ds), py = Z((kz + 0.5) * r.G.hz), l = L * Math.min(1, s / vm); c.beginPath(); c.moveTo(px - u / s * l / 2, py + v / s * l / 2); c.lineTo(px + u / s * l / 2, py - v / s * l / 2); c.stroke(); c.beginPath(); c.arc(px + u / s * l / 2, py - v / s * l / 2, 1.5, 0, 7); c.fillStyle = cssVar('--ink'); c.fill(); }
    c.globalAlpha = 1;
  }
  c.strokeStyle = cssVar(XM_C.wall); c.lineWidth = 2; c.beginPath(); c.moveTo(X(-R), Z(H * 1.05)); c.lineTo(X(-R), Z(0)); c.lineTo(X(R), Z(0)); c.lineTo(X(R), Z(H * 1.05)); c.stroke();
  c.font = '11.5px ' + cssVar('--mono'); c.fillStyle = cssVar('--muted'); c.textAlign = 'center'; c.fillText('the vessel\'s axis', X(0), h - 6);
  c.save(); c.setLineDash([3, 3]); c.strokeStyle = cssVar('--muted'); c.beginPath(); c.moveTo(X(0), Z(0)); c.lineTo(X(0), Z(H)); c.stroke(); c.restore();
  document.getElementById('xm5T').textContent = `Up through the arm: ${XM_FIELDS[k][0].toLowerCase()}, the blades at ${(r.moments[XMS.snap].phi * 180 / Math.PI).toFixed(0)}° of their cycle`;
  lg.innerHTML = xmBar(lut, sc, XM_FIELDS[k][1], v => xmFmt(k, v)) + `<p class="fv-why">The plane through the vessel's axis and the blades' axes at this moment, ${xmMm(o.D)} mm across, ${xmMm(H)} mm deep (to scale); grey: the cells the parts fill.${k === 'speed' ? ' Arrows: the velocity along the plane and up it.' : ''}</p>`;
}
function xm3Power(o, r) {
  const cv = document.getElementById('xm2'), lg = document.getElementById('xm2Lg');
  if (!cv) return;
  const M = r.moments, cols = ['#1c7ed6', '#2f9e44', '#ae3ec9'], heat = cssVar('--heat').trim(), deg = m => m.phi * 180 / Math.PI, S = [];
  for (let b = 1; b <= o.nBlade; b++) S.push({ p: M.map(m => [deg(m), m.P[b]]), c: cols[(b - 1) % cols.length], w: 1.8, l: `blade ${b}`, dots: true });
  S.push({ p: M.map(m => [deg(m), m.P[o.nBlade + 1]]), c: heat, w: 1.8, l: 'disperser', dots: true });
  const span = 360 / (o.ratio * o.nBar), ys = S.flatMap(q => q.p.map(p => p[1])), oneB = o.one.PB / o.nBlade, oneD = o.one.PD;
  const yt = pmpTicks(0, Math.max(oneB, oneD, ...ys) * 1.08 + 1e-9, 5), xt = pmpTicks(0, span, 6);
  plotChart(cv, FILM_ASPECT, { x0: 0, x1: span, y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => `${+v.toFixed(0)}°`, yf: v => String(+v.toPrecision(4)), xl: 'the arm\'s angle through the blades\' cycle', yl: 'power (W)',
    hl: [{ y: oneB, c: cols[0], t: 'the 1D, a blade', left: true }, ...(oneD > 0 ? [{ y: oneD, c: heat, t: 'the 1D, the disperser', left: true, below: true }] : [])], s: S });
  const mean = k => M.reduce((s, m) => s + m.P[k], 0) / M.length;
  lg.innerHTML = oneDLegend([...S.map(q => [q.l, q.c, 'dot']), ['the 1D', cssVar('--muted'), 'dash']]) + `<p class="fv-why">${M.length} moments over the blades' cycle (${xmSig(span)}° of the arm's turn, then it repeats). Mean: ${Array.from({ length: o.nBlade }, (_, b) => `blade ${b + 1} ${xmSig(mean(b + 1))}`).join(', ')}, the disperser ${xmSig(mean(o.nBlade + 1))} W; the 1D: the blades ${xmSig(o.one.PB)}, the disperser ${xmSig(o.one.PD)} W.</p>`;
}
function xm3Tiles(o, r) {
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const M = r.moments, nb = o.nBlade, mean = f => M.reduce((s, m) => s + f(m), 0) / M.length;
  const pB = mean(m => m.P.slice(1, nb + 1).reduce((a, b) => a + b, 0)), pD = mean(m => m.P[nb + 1]), T = r.tracers;
  const dB = pB / Math.max(1e-9, o.one.PB) - 1, g = xmGrid(o);
  document.getElementById('xmStats').innerHTML = [
    tile('Blades', `${xmSig(pB)} W`, `over the cycle; the 1D ${xmSig(o.one.PB)} W (${dB >= 0 ? '+' : ''}${(dB * 100).toFixed(0)} %); the bars ${(o.t / g.h).toFixed(1)} cells thick`, 'flow', o.t / g.h < 2 ? 'warn' : ''),
    tile('Disperser', `${xmSig(pD)} W`, `the 1D ${xmSig(o.one.PD)} W`, 'flow'),
    tile('Total', `${xmSig(pB + pD)} W`, `${xmSig((pB + pD) / (Math.PI * o.D * o.D / 4 * o.H) / 1000)} kW/m³ into the batch`, 'temp'),
    tile('Dead', `${(r.shear.dead * 100).toFixed(1)} %`, `of the batch never sheared over ${r.shear.gdDead} 1/s`, 'ratio', r.shear.dead > 0.2 ? 'warn' : ''),
    tile('Lumps break', `${(r.shear.high * 100).toFixed(1)} %`, `of the batch where μ γ̇ passes ${o.tracers.tauC.toFixed(0)} Pa at some moment`, 'cut'),
    tile('Mixed', T && T.mix.length ? xmSig(T.mix[T.mix.length - 1].I) : '—', T ? `segregation after ${o.mesh.turns} arm turn${o.mesh.turns === 1 ? '' : 's'}` : 'no tracers', 'fibre'),
    tile('Strain', T ? xmSig(T.median) : '—', T ? `the tracers' median; ${(T.lowShare * 100).toFixed(0)} % under ${xmSig(T.sLow)}` : 'no tracers', 'fibre', T && T.lowShare > 0.5 ? 'warn' : ''),
  ].join('');
}
/** The same answers against ones worked out apart (the 1D's model, the energy kept, the grid's gaps). */
function xmCompare(o, r, dim) {
  const el = document.getElementById('xmCompare');
  if (!el) return;
  const rows = [], g = xmGrid(o), nb = o.nBlade;
  if (dim === 2) {
    const turn = xmTurn(o), H = r.hist.filter(q => q.t > r.hist[r.hist.length - 1].t - turn + 1e-9 && q.t > 0), mean = f => H.reduce((s, q) => s + f(q), 0) / Math.max(1, H.length);
    const pB = mean(q => q.P.slice(1, nb + 1).reduce((a, b) => a + b, 0)), P = mean(q => q.P.reduce((a, b) => a + b, 0)), D = mean(q => q.Dis);
    rows.push(['The blades\' power', `${xmSig(o.one.PB)} W`, `${xmSig(pB * o.one.Hb)} W`, `the 1D's bars in their cells (Stokes drag and form drag, its factor ${mixIn().fB}); here the slice's per height × the bars' height ${xmMm(o.one.Hb)} mm (a slice at one height: the 3D sees the floor and the top); the bars ${(o.t / g.h).toFixed(1)} cells thick`]);
    rows.push(['The heat the shear makes', `${xmSig(P)} W/m`, `${xmSig(D)} W/m`, 'the parts\' power in: all of it ends as heat (∫ μ γ̇²); the rest in the parts\' drag layer, smaller on a finer grid']);
    const last = r.hist[r.hist.length - 1];
    if (last.Eh != null) {
      const made = r.hist.slice(1).reduce((s, q, i) => s + q.Dis * (q.t - r.hist[i].t), 0), jac = r.hist.slice(1).reduce((s, q, i) => s + q.Qj * (q.t - r.hist[i].t), 0);
      rows.push(['The heat kept', `${xmSig(made + jac)} J/m`, `${xmSig(last.Eh)} J/m`, `made by the shear (${xmSig(made)}) and through the jacket (${xmSig(jac)}) over ${xmSig(last.t)} s, against the heat the slice holds above the start: carried in flux form, nothing lost`]);
    }
  } else {
    const M = r.moments, mean = f => M.reduce((s, m) => s + f(m), 0) / M.length, pB = mean(m => m.P.slice(1, nb + 1).reduce((a, b) => a + b, 0)), pD = mean(m => m.P[nb + 1]);
    rows.push(['The blades\' power', `${xmSig(o.one.PB)} W`, `${xmSig(pB)} W`, `the 1D: the bars' drag in their cells (Stokes and form drag, its factor ${mixIn().fB}); here every bar through the batch, the floor and the top. The bars are ${(o.t / g.h).toFixed(1)} cells thick on this grid: under two, a bar is felt thinner than it is and its drag is low -- refine (Mesh: cells across, up) and the power rises toward its value`]);
    rows.push(['The disperser\'s power', `${xmSig(o.one.PD)} W`, `${xmSig(pD)} W`, 'the 1D: its power number (laminar Kp/Re plus turbulent); here the disc, its teeth and shaft in the flow (creeping: no turbulence)']);
    rows.push(['The heat the shear makes', `${xmSig(mean(m => m.P.reduce((a, b) => a + b, 0)))} W`, `${xmSig(mean(m => m.Dis))} W`, 'the parts\' power in: all of it ends as heat (∫ μ γ̇²); the rest in the parts\' drag layer']);
    const s2 = XMS.res[2] && xmCurrent(2) ? XMS.res[2] : null;
    if (s2) { const H = s2.hist.slice(1), b2 = H.reduce((s, q) => s + q.P.slice(1, nb + 1).reduce((a, b) => a + b, 0), 0) / H.length; rows.push(['The blades\' power per height', `${xmSig(b2)} W/m (the 2D)`, `${xmSig(pB / o.one.Hb)} W/m`, 'the 2D\'s slice against the 3D\'s mean over the bars\' height']); }
  }
  if (dim === 2 && xmCutsDisc(o)) rows.push(['The disperser in the slice', `a disc ${xmMm(o.tD)} mm thick (teeth ${xmMm(o.hT)} mm)`, 'a cylinder through the slice', 'the slice cuts the disc: the 2D takes it as a cylinder as tall as the slice, its power per height far above the thin disc\'s -- move the slice (the inputs bar: 2D slice height) or see the 3D']);
  rows.push(['The wall gap', `${xmMm(o.dw)} mm`, `${xmMm(g.gapW)} mm`, g.gapW > o.dw * (1 + 1e-9) ? `${(o.dw / g.h).toFixed(2)} cells: opened to ${o.mesh.gapCells} cells on this grid (refine to close it); the gap's own shear is the 1D's wall zone` : 'resolved on this grid']);
  el.innerHTML = `<h4 class="mp-h">Against independent answers</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Independent</th><th scope="col">This ${dim}D</th><th scope="col">How</th></tr></thead>
    <tbody>${rows.map(([p, q, s, t]) => `<tr><th scope="row">${p}</th><td>${q}</td><td>${s}</td><td>${t}</td></tr>`).join('')}</tbody></table>`;
}
function xmCsv(dim) {
  const r = xmCurrent(dim) ? XMS.res[dim] : null, o = xmInputs(dim);
  if (!r || !o) return;
  const parts = Array.from({ length: o.nBlade + 2 }, (_, k) => xmOwner(o, k));
  const rows = [];
  if (dim === 2) {
    rows.push(['time (s)', 'arm angle (°)', ...parts.map(p => `${p}: power (W/m)`), ...parts.map(p => `${p}: torque about the vessel's axis (N·m/m)`), 'shear heat (W/m)', 'kinetic energy (J/m)', 'mean temperature (°C)']);
    for (const q of r.hist) rows.push([q.t, q.phi * 180 / Math.PI, ...q.P, ...q.Tq, q.Dis, q.KE, q.T]);
    if (r.tracers) { rows.push([]); rows.push(['tracer', 'x0 (mm)', 'y0 (mm)', 'x (mm)', 'y (mm)', 'strain', 'time above the lumps\' strength (s)']); for (let i = 0; i < r.tracers.x.length; i++) rows.push([i + 1, r.tracers.x0[i] * 1000, r.tracers.y0[i] * 1000, r.tracers.x[i] * 1000, r.tracers.y[i] * 1000, r.tracers.strain[i], r.tracers.tHigh[i]]); }
  } else {
    rows.push(['moment', 'arm angle (°)', ...parts.map(p => `${p}: power (W)`), ...parts.map(p => `${p}: torque about the vessel's axis (N·m)`), 'shear heat (W)']);
    r.moments.forEach((m, i) => rows.push([i + 1, m.phi * 180 / Math.PI, ...m.P, ...m.Tq, m.Dis]));
    if (r.tracers) { rows.push([]); rows.push(['time (s)', 'segregation']); for (const m of r.tracers.mix) rows.push([m.t, m.I]); }
  }
  downloadCSV(`mixing-${dim}D-${csvStamp()}.csv`, rows);
}
