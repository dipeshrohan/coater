/*
 * gf-mp-ui.js — MP-GF on the Graphene film stage: its pages 1D, 2D and 3D (mp-bench-ui.js), each in the steps Geometry ›
 * Mesh › Solve › Results. The graphene film the furnace made (its batch's mean thickness, its density, its heat conduction
 * along it) in use: a piece on a square heater under its middle, in the room's air, from the room's temperature until it
 * is steady (gf-mp.js in cfd-mp-worker.js) -- its heat along it and through it, what leaves its faces and edges
 * (convection and radiation), and the stress its warming gives in its plane.
 *  1D: a strip through the heater's middle, the heater a band across the piece (its flux the same); the film even
 *      through its thickness.
 *  2D: the same strip's section through the film's thickness.
 *  3D: a quarter of the piece, the heater the square it is.
 * The heater's test (its size, power, the air, the time) is on the inputs bar; the film's own values on its card
 * (Materials: Graphene film). The stage's Results page is the furnace's graphene film.
 */
const GFS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, again: null, snap: -1, map: 'T' };
/** The mesh's and the time's defaults (the Mesh step's, editable): elements over the heater's half and from it to the
 *  edge (graded toward the heater), through the film, the time steps. */
const GF_MESH_DEF = { 1: { heatN: 10, outN: 40, outGrade: 10, tSteps: 60 }, 2: { heatN: 10, outN: 40, outGrade: 10, thruN: 4, tSteps: 60 }, 3: { heatN: 6, outN: 16, outGrade: 6, thruN: 2, tSteps: 40 } };
const GF_C = '--graphite';
const gfSet = dim => (typeof swbSettings === 'function' && SWB_ADAPT['furn:product'] ? swbSettings(SWB_ADAPT['furn:product'], dim) : GF_MESH_DEF[dim]);
/** The furnace's graphene film as it came out (its batch: the thickness, its mass per area, its heat conduction along it),
 *  the furnace solved for the inputs as they are; null before. */
function gfFilm() {
  if (typeof furnCurrent !== 'function' || !furnCurrent() || !FURN.res) return null;
  // (the furnace's result as its worker sends it: the top piece's end values, the batch over the stack)
  const fr = FURN.res, e = fr.end || {}, B = fr.batch || { hMean: e.h }, t = B.hMean;
  if (!(t > 0) || !(e.mEnd > 0) || !(e.kappa > 0) || !(e.h > 0)) return null;
  // (its size after the furnace: the piece as cut, changed by its free shrinking there; the same GO per area as the top
  //  piece's at the batch's mean thickness: its density and its conduction along it scale with 1 / thickness)
  const sz = fr.plane && fr.plane.size && Number.isFinite(fr.plane.size.free) ? 1 + fr.plane.size.free : 1, q = fr.q;
  return { t, rho: e.mEnd / t, kp: e.kappa * e.h / t, Lx: q.o.Lx * sz, Ly: q.o.Ly * sz, shrink: sz - 1 };
}
/** The graphite's heat capacity at a temperature (°C): the hub's law (the furnace's multiphysics' own), else graphite's
 *  at the room. */
const gfCp = T => (typeof hubLawAt === 'function' ? hubLawAt('gCp', T) : 710);
/**
 * A dimension's inputs: the film (the furnace's, its card's values through it and its strength), the heater's test (the
 * inputs bar), the room's temperature, the mesh's settings; the moments kept (the start, then a thousandth, a hundredth,
 * a tenth and the whole of the time on the heater: the film warms in a second or so, the piece spreads it more slowly).
 */
function gfmInputs(dim) {
  const F = gfFilm();
  if (!F) return null;
  const fu = OVEN.furn, v = k => MAT.furn[k].v, m = gfSet(dim), T0 = MAT.dry.Troom.v, tEnd = fu.gfT;
  return { dim, Lx: F.Lx, Ly: F.Ly, t: F.t, kp: F.kp, kt: v('kt'), rho: F.rho, c: gfCp(T0), heater: { a: fu.gfA / 1000, P: fu.gfP }, air: { h: fu.gfH, T: T0, eps: v('epsG') },
    tEnd, steps: m.tSteps, snapAt: [0, 1e-3, 1e-2, 0.1, 1].map(f => f * tEnd), mesh: { nh: m.heatN, nx: m.outN, grade: m.outGrade, nz: dim > 1 ? m.thruN : 1 },
    film: { E: v('EG') * 1e9, nu: v('nuG'), alpha: v('aG') * 1e-6 }, sigF: v('sigG') * 1e6 };
}
const gfmKeyNow = dim => { const o = gfmInputs(dim); return o ? JSON.stringify(o) : null; };
const gfmCurrent = dim => !!GFS.res[dim] && GFS.key[dim] === gfmKeyNow(dim);
const gfmFailed = dim => !!(GFS.error[dim] && GFS.key[dim] === gfmKeyNow(dim));
/** Solve a dimension (one at a time; a request while busy runs next). */
function gfmRequest(dim) {
  const key = gfmKeyNow(dim);
  if (!key) return;
  if (GFS.key[dim] === key && GFS.res[dim]) { solveTake('gmp' + dim); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('gmp' + dim)) return;
  if (GFS.busy) { if (GFS.pending !== key) GFS.again = dim; return; }
  solveTake('gmp' + dim);
  const o = gfmInputs(dim);
  GFS.busy = true; GFS.bdim = dim; GFS.pending = key; GFS.prog = null; GFS.again = null;
  const id = ++GFS.id;
  if (!GFS.worker) GFS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { GFS.busy = false; GFS.pending = null; GFS.bdim = null; if (GFS.again) { const a = GFS.again; GFS.again = null; gfmRequest(a); } if (typeof swbRefresh === 'function') swbRefresh('furn:product'); };
  GFS.worker.onmessage = e => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.progress) { GFS.prog = msg.progress; if (typeof swbOn === 'function' && swbOn('furn:product')) swbProgress(); return; }
    GFS.key[dim] = key;
    if (msg.ok) { GFS.res[dim] = { ...msg.res, ms: msg.ms }; GFS.error[dim] = null; } else { GFS.res[dim] = null; GFS.error[dim] = msg.error; }
    done();
  };
  GFS.worker.onerror = ev => { GFS.key[dim] = key; GFS.res[dim] = null; GFS.error[dim] = ev.message || 'the multiphysics worker failed'; GFS.worker = null; done(); };
  GFS.worker.postMessage({ id, kind: 'gfilm', o });
}
/** Stop the solve (New, Open): its worker ended, what was asked next dropped. */
function gfmStop() {
  if (GFS.worker) { GFS.worker.terminate(); GFS.worker = null; }
  Object.assign(GFS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}
/** Wait for a dimension's solve (the report, the tests): true when solved. */
async function gfmWait(dim) {
  for (let k = 0; k < 12000; k++) {
    if (!GFS.busy) { if (gfmCurrent(dim)) return true; if (gfmFailed(dim)) return false; if (!solveAsked('gmp' + dim)) return false; gfmRequest(dim); }
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- numbers in words ----
const gfMm = v => { const m = v * 1000; return m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2); };
const gfUm = v => { const u = v * 1e6; return u >= 100 ? u.toFixed(0) : u.toFixed(1); };
const gfT = v => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
const gfS = s => (s >= 100 ? s.toFixed(0) : s >= 10 ? s.toFixed(1) : s >= 1 ? s.toFixed(2) : s.toPrecision(2));
const gfKPa = v => { const k = v / 1000; return (Math.abs(k) >= 100 ? k.toFixed(0) : Math.abs(k) >= 10 ? k.toFixed(1) : k.toFixed(2)).replace(/^-/, '−'); };
const gfFluxOf = o => o.heater.P / (o.heater.a * o.heater.a);
/** The radiation's coefficient about the room's temperature (W/(m²·K)): 4 ε σ T∞³. */
const gfHr = o => 4 * o.air.eps * 5.670374419e-8 * Math.pow(o.air.T + 273.15, 3);

// ---- drawing: the piece from above and the half section from its middle (1D, 2D); the quarter in 3D ----
/**
 * Left, the piece from above to scale: the heater under its middle, the 1D's line or the 2D's section through it; right,
 * the half from the middle (its mirror plane) to the edge, the film drawn thick (its thickness not to scale), the heater
 * under it. what: 'geometry' | 'mesh' | 'solve'.
 */
function gfDraw(cv, dim, o, what) {
  const { c, w, h } = setupCanvas(cv, 0.42), ink = cssVar('--ink'), mut = cssVar('--muted'), acc = cssVar('--accent') || '#1c7ed6', heat = cssVar('--heat').trim();
  c.clearRect(0, 0, w, h);
  const A = gfAxesOf(o, dim), a2 = A.a2, L2 = o.Lx / 2;
  // the plan
  const pw = Math.min(w * 0.3, h - 70), sc = pw / Math.max(o.Lx, o.Ly), px = 16, py = 24, pW = o.Lx * sc, pH = o.Ly * sc, cx = px + pW / 2, cy = py + pH / 2;
  c.fillStyle = swbFill(GF_C, 0.3); c.fillRect(px, py, pW, pH); c.strokeStyle = swbFill(GF_C, 0.95); c.lineWidth = 1.2; c.strokeRect(px, py, pW, pH);
  c.save(); c.setLineDash([4, 3]); c.strokeStyle = heat; c.lineWidth = 1.5; c.strokeRect(cx - o.heater.a / 2 * sc, cy - o.heater.a / 2 * sc, o.heater.a * sc, o.heater.a * sc); c.restore();
  c.strokeStyle = acc; c.lineWidth = 2.4; c.beginPath();
  if (dim < 3) { c.moveTo(cx, cy); c.lineTo(px + pW, cy); }
  else { c.rect(cx, cy, pW / 2, pH / 2); }
  c.stroke();
  c.font = '11.5px ' + cssVar('--mono'); c.textAlign = 'center';
  outlinedText(c, `${gfMm(o.Lx)} × ${gfMm(o.Ly)} mm`, cx, py + pH + 16, mut);
  // the half section
  const x0 = px + pW + 60, x1 = w - 24, band = 22, yF = Math.round(h * 0.42), Xs = x => x0 + x / L2 * (x1 - x0);
  const filmTop = yF - band / 2, filmBot = yF + band / 2;
  c.fillStyle = swbFill(heat, 0.3); c.fillRect(x0, filmBot, Xs(a2) - x0, 16); c.strokeStyle = heat; c.lineWidth = 1.2; c.strokeRect(x0, filmBot, Xs(a2) - x0, 16);
  c.fillStyle = swbFill(GF_C, what === 'mesh' ? 0.12 : 0.34); c.fillRect(x0, filmTop, x1 - x0, band); c.strokeStyle = swbFill(GF_C, 0.95); c.strokeRect(x0, filmTop, x1 - x0, band);
  c.save(); c.setLineDash([5, 4]); c.strokeStyle = mut; c.beginPath(); c.moveTo(x0, filmTop - 18); c.lineTo(x0, filmBot + 24); c.stroke(); c.restore();
  // (the plan's line to the section: dashed guides)
  c.save(); c.setLineDash([4, 4]); c.strokeStyle = mut; c.lineWidth = 1; c.beginPath(); c.moveTo(px + pW, cy); c.lineTo(x0, filmTop); c.moveTo(px + pW, cy); c.lineTo(x0, filmBot); c.stroke(); c.restore();
  c.font = '600 12px ' + cssVar('--sans'); c.textAlign = 'left';
  if (what === 'mesh') {
    const xs = A.edges[0], room = (x1 - x0) / xs.length, k = room >= 3 ? 1 : Math.ceil(3 / room);
    c.strokeStyle = ink; c.globalAlpha = 0.6; c.lineWidth = 0.7; c.beginPath();
    for (let i = 0; i < xs.length; i += k) { const x = Xs(xs[i]); c.moveTo(x, filmTop); c.lineTo(x, filmBot); }
    if (dim === 2) for (let j = 1; j < o.mesh.nz; j++) { const y = filmTop + band * j / o.mesh.nz; c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke(); c.globalAlpha = 1;
    c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut;
    c.fillText(`${xs.length - 1} elements along${dim === 2 ? `, ${o.mesh.nz} through the film` : ''}${k > 1 ? `; every ${k}th edge drawn` : ''}: smallest at the heater's edge.`, x0, filmBot + 40);
  } else if (what === 'solve') {
    const F = gfFaces(dim, o), at = [[(x0 + Xs(a2)) / 2, filmBot + 30], [(Xs(a2) + x1) / 2, filmBot + 16], [(x0 + x1) / 2, filmTop - 16], [x1 + 0, filmTop - 16], [x0 - 14, yF]];
    c.lineWidth = 3.2;
    const seg = (q, xa, ya, xb, yb) => { c.strokeStyle = q.c; c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb); c.stroke(); };
    seg(F[0], x0, filmBot, Xs(a2), filmBot); seg(F[1], Xs(a2), filmBot, x1, filmBot); seg(F[2], x0, filmTop, x1, filmTop); seg(F[3], x1, filmTop, x1, filmBot);
    c.save(); c.setLineDash([6, 4]); c.lineWidth = 1.6; seg(F[4], x0, filmTop, x0, filmBot); c.restore();
    F.forEach((q, i) => { const [qx, qy] = at[i]; c.fillStyle = q.c; c.beginPath(); c.arc(qx, qy, 9, 0, 7); c.fill(); c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), qx, qy + 4); });
  } else {
    outlinedText(c, `graphene film, ${gfUm(o.t)} µm`, x0 + 8, yF + 4, ink);
    c.textAlign = 'center'; outlinedText(c, 'heater', (x0 + Xs(a2)) / 2, filmBot + 12, ink);
    swbDimLine(c, [x0, filmBot + 36], [Xs(a2), filmBot + 36], `${gfMm(a2)} mm`, false, mut);
    swbDimLine(c, [Xs(a2), filmBot + 36], [x1, filmBot + 36], `${gfMm(L2 - a2)} mm`, false, mut);
    // (the air on both faces: arrows away)
    c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 1.4;
    for (const f of [0.55, 0.75, 0.92]) { const x = x0 + f * (x1 - x0); c.beginPath(); c.moveTo(x, filmTop - 4); c.lineTo(x, filmTop - 20); c.stroke(); c.beginPath(); c.moveTo(x, filmTop - 24); c.lineTo(x - 4, filmTop - 17); c.lineTo(x + 4, filmTop - 17); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x, filmBot + 4); c.lineTo(x, filmBot + 20); c.stroke(); c.beginPath(); c.moveTo(x, filmBot + 24); c.lineTo(x - 4, filmBot + 17); c.lineTo(x + 4, filmBot + 17); c.closePath(); c.fill(); }
  }
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
  c.fillText(dim === 1 ? 'Left: the piece from above, the heater dashed, the 1D\'s line from its middle. Right: the strip, the heater taken as a band across.'
    : `Left: the piece from above, the heater dashed, the 2D's section from its middle. Right: the section, its thickness drawn ×${Math.round(band / (o.t * (x1 - x0) / L2))}.`, 8, h - 8);
}
/** The mesh's axes as the solve builds them (gf-mp.js's gfAxes), with each axis's element edges. */
function gfAxesOf(o, dim) {
  const A = gfAxes({ ...o, dim });
  return { ...A, edges: A.axes.map(segs => mpAxisEdges(segs).edges) };
}
/** The faces and what holds there, in the drawings' order (1D, 2D: the half section; 3D: the quarter). */
function gfFaces(dim, o) {
  const heat = cssVar('--heat').trim() || '#d9480f', air = '#1c7ed6', sym = cssVar('--muted'), q = gfFluxOf(o), eps = o.air.eps;
  const airTxt = `the room's air at ${o.air.T} °C: ${o.air.h} W/(m²·K)${eps > 0 ? `, and radiation to the room (ε ${eps})` : ''}`;
  const F = [
    { t: 'Underside over the heater', c: heat, kind: 'flux', face3: null, bc: [`the heater's flux, ${q.toFixed(0)} W/m² (${o.heater.P} W over ${gfMm(o.heater.a)} mm square${dim < 3 ? ', taken as a band across' : ''}); covered: no loss`, 'free'] },
    { t: 'Underside off the heater', c: air, kind: 'conv', face3: null, bc: [airTxt, 'free'] },
    { t: 'Top face', c: air, kind: 'conv', face3: 'z1', at3: (X, Y, Z) => [X * 0.6, Y * 0.6, Z], bc: [airTxt, 'free'] },
    { t: dim === 3 ? 'The edges' : 'The edge', c: air, kind: 'conv', face3: ['x1', 'y1'], at3: (X, Y, Z) => [X, Y * 0.5, Z / 2], bc: [`the room's air at ${o.air.T} °C: ${o.air.h} W/(m²·K)`, 'free'] },
    { t: dim === 3 ? 'Mirror planes (x = 0, y = 0)' : 'Mirror plane (x = 0)', c: sym, kind: 'sym', face3: null, bc: ['no heat across (symmetry)', dim === 3 ? 'symmetry (no movement across)' : '—'] },
  ];
  return F;
}

// ---- the stage's adapter ----
SWB_ADAPT['furn:product'] = {
  key: 'gfilm', sk: 'furn:product', t: 'Graphene film', ready: 'mp8', sid: 'gmp',
  S: () => GFS,
  inputs: dim => gfmInputs(dim),
  current: dim => gfmCurrent(dim),
  failed: dim => gfmFailed(dim),
  request: dim => solveArm('gmp' + dim),
  stop: () => gfmStop(),
  why: () => 'The graphene film is solved after the furnace has made it (Furnace: its two runs).',
  slow3: 'The 3D takes a few seconds',
  dofs: () => 1, coupled: 'the temperature',
  axes: (dim, o) => ({ axes: gfAxes(o).axes, mat: (ijk, seg) => (seg[0] === 0 && (dim < 3 || seg[1] === 0) ? 0 : 1) }),
  axisNames: dim => (dim === 1 ? ['Along the film from the heater\'s middle (x)'] : dim === 2 ? ['Along the film from the heater\'s middle (x)', 'Through the film (z)'] : ['Along the piece from its middle (x)', 'Across it from its middle (y)', 'Through the film (z)']),
  meshFields: dim => [
    { k: 'heatN', t: 'Elements over the heater\'s half', min: 1, max: dim === 3 ? 40 : 400, step: 1, int: true, def: GF_MESH_DEF[dim].heatN },
    { k: 'outN', t: 'Elements from the heater to the edge', min: 1, max: dim === 3 ? 80 : 2000, step: 1, int: true, def: GF_MESH_DEF[dim].outN },
    { k: 'outGrade', t: 'Grading to the edge (largest / smallest)', min: 1, max: 100, step: 1, def: GF_MESH_DEF[dim].outGrade },
    ...(dim > 1 ? [{ k: 'thruN', t: 'Elements through the film', min: 1, max: dim === 3 ? 8 : 40, step: 1, int: true, def: GF_MESH_DEF[dim].thruN }] : []),
    { k: 'tSteps', t: 'Time steps on the heater', min: 5, max: 2000, step: 5, int: true, def: GF_MESH_DEF[dim].tSteps },
  ],
  meshHow: dim => `Linear elements, ${dim === 1 ? 'on a line along the film' : dim === 2 ? 'quadrilaterals on the section' : 'hexahedra on the quarter'}; the heat stored and the faces' loss at the nodes (lumped: no overshoot). Even over the heater, graded from its edge out (the temperature bends most there). The time steps start at a tenth of the film's own time (it warms in about a second) and grow by one factor to the end.`,
  extraMeshes: (dim, o) => (dim === 3 ? `The stress on the quarter's mid-plane: ${(o.mesh.nh + o.mesh.nx + 1) ** 2} nodes, the same x and y, plane stress.` : 'The stress at each node along x, from the temperature through the film averaged there.'),
  layout: (dim, o) => {
    const A = gfAxes(o), L2 = o.Lx / 2, W2 = o.Ly / 2;
    const parts = [{ k: 'film', t: 'Graphene film', c: GF_C, rects: [[0, 0, L2, o.t]] }, { k: 'heater', t: 'The heater (under it)', c: '--heat', rects: [] }];
    if (dim === 3) return { parts, partAt: () => parts[0], kz: Math.max(1, Math.round(0.06 * Math.max(L2, W2) / o.t)), xLines: [A.a2], yLines: [A.b2] };
    return { x0: 0, x1: L2, z0: 0, z1: o.t, parts, mirrors: [{ x0: 0, z0: 0, x1: 0, z1: o.t }] };
  },
  draw: (cv, dim, o, step) => (dim === 3 ? swbDrawIso(cv, SWB_ADAPT['furn:product'], o, step) : gfDraw(cv, dim, o, step)),
  domain: dim => ({ 1: 'a strip from the heater\'s middle to the piece\'s edge, the heater a band across it', 2: 'the same strip\'s section through the film\'s thickness', 3: 'a quarter of the piece on its two mirror planes, the heater the square it is' }[dim]),
  domainShort: (dim, o) => (dim === 1 ? `${gfMm(o.Lx / 2)} mm along` : dim === 2 ? `${gfMm(o.Lx / 2)} mm × ${gfUm(o.t)} µm` : `${gfMm(o.Lx / 2)} × ${gfMm(o.Ly / 2)} mm × ${gfUm(o.t)} µm`),
  parts: (dim, o) => [
    { t: 'Graphene film', c: GF_C, mat: 'Graphene film', rec: 'gfilm', size: `${gfMm(o.Lx)} × ${gfMm(o.Ly)} mm, ${gfUm(o.t)} µm`, how: `along it ${o.kp.toFixed(0)} W/(m·K), through it ${o.kt}; ${o.rho.toFixed(0)} kg/m³` },
    { t: 'The heater', c: '--heat', mat: 'a heat flux on the film\'s underside', rec: null, size: `${gfMm(o.heater.a)} mm square, ${o.heater.P} W`, how: dim < 3 ? 'a band across the piece with the same flux' : `the square under the middle: the quarter takes ${(o.heater.P / 4).toPrecision(3)} W` }],
  domainRows: (dim, o) => {
    const F = gfFilm();
    return [['Domain', SWB_ADAPT['furn:product'].domain(dim)], ['The film', `as the furnace made it: ${gfUm(o.t)} µm (its batch's mean), ${o.rho.toFixed(0)} kg/m³, ${o.kp.toFixed(0)} W/(m·K) along it${F && F.shrink ? `; the piece ${(F.shrink * 100).toFixed(2)} % on its size as cut` : ''}`],
      ['The heater', `${gfMm(o.heater.a)} mm square under the piece's middle, ${o.heater.P} W: ${gfFluxOf(o).toFixed(0)} W/m²`], ['The air', `${o.air.h} W/(m²·K) on both faces and the edges, at ${o.air.T} °C; radiation ε ${o.air.eps}`],
      ['Mirror planes', dim === 3 ? 'the piece\'s middle along and across (x = 0, y = 0)' : 'the heater\'s middle (x = 0)'], ['Its stress', 'free and flat on the heater: nothing holds it']];
  },
  geoTiles: (dim, o) => [['Piece', `${gfMm(o.Lx)} × ${gfMm(o.Ly)}`, 'mm, after the furnace', 'section'], ['Thickness', `${gfUm(o.t)} µm`, 'the furnace\'s batch mean', 'film'],
    ['Along it', `${o.kp.toFixed(0)} W/(m·K)`, `through it ${o.kt} W/(m·K)`, 'temp'], ['Heater', `${o.heater.P} W`, `${gfMm(o.heater.a)} mm square, ${gfFluxOf(o).toFixed(0)} W/m²`, 'temp'],
    ['On it', `${gfS(o.tEnd)} s`, `from the room's ${o.air.T} °C`, 'period']],
  geoNote: (dim, o) => (dim === 3 ? 'The quarter seen from the piece\'s outer corner, its thickness drawn taller; the heater\'s square under its middle (the lines on the top).' : 'The film is thin against the piece: its thickness is drawn wide. The heater carries on into the page in 1D and 2D.'),
  meshNote: (dim, o) => (dim === 3 ? 'The mesh on the quarter\'s outer faces: even over the heater, graded from it to the edges.' : 'Even over the heater, graded from its edge out.'),
  physics: (dim, o) => {
    const heatEq = dim === 1 ? 'ρ c t ∂T/∂t = k t ∂²T/∂x² + q (the heater) − n (h ΔT + ε σ (T⁴ − T∞⁴))' : 'ρ c ∂T/∂t = ∇·(K ∇T),  K = diag(k_along, k_through)';
    return [['Heat', heatEq, `k ${o.kp.toFixed(0)} along it (the furnace's), ${o.kt} through it W/(m·K); ρ ${o.rho.toFixed(0)} kg/m³; c ${o.c.toFixed(0)} J/(kg·K) (graphite at the room)`],
      ['Stress (the heat\'s)', dim === 3 ? 'plane stress on the mid-plane: σ = C (ε − α ΔT̄ I),  ∇·σ = 0' : 'a long piece: σ_yy = E (ε̄ − α ΔT̄),  σ_xx = 0', `E ${MAT.furn.EG.v} GPa, ν ${MAT.furn.nuG.v}, α ${MAT.furn.aG.v} × 10⁻⁶/K in its plane; strength ${MAT.furn.sigG.v} MPa`]];
  },
  coupling: dim => `the heat each moment, radiation by Picard on its coefficient; the stress from that moment's temperature through the film averaged (one way: the stress does not change the heat)${dim < 3 ? '' : ', a plane-stress solve on the mid-plane'}.`,
  bcCols: ['Heat', 'Stress'],
  faces: (dim, o) => gfFaces(dim, o),
  time: (dim, o) => [['On the heater', `${gfS(o.tEnd)} s`, `from the room's ${o.air.T} °C, the heater at ${o.heater.P} W from the start`, String(o.steps)], ['Steady', '—', 'the same, nothing changing in time', '1']],
  solver: (dim, o, r) => {
    const st = gfSteps(o);
    return [['Elements', `linear (${dim === 1 ? 'lines' : dim === 2 ? 'quadrilaterals' : 'hexahedra'}), the stored heat and the faces' loss at the nodes`], ['In time', `implicit Euler, ${o.steps} steps from ${gfS(st.dt0)} s (a tenth of the film's own time, ${gfS(st.tau)} s), each ${((st.r - 1) * 100).toFixed(1)} % longer`],
      ['Radiation', o.air.eps > 0 ? 'its coefficient ε σ (T² + T∞²)(T + T∞) at the last iterate, to 10⁻⁸' : 'none (ε 0)'], ['Matrix', 'banded, Cholesky'],
      ['Stress', dim === 3 ? 'plane stress on the mid-plane (mp-core\'s elastic solver), the mirror planes held across' : 'the long piece\'s closed form at each node'],
      ['Checked', 'the fin\'s closed form (1D), 1D = 2D for a thin film, the plate\'s series (3D), the energy, the warming in time, the stress against the long piece (gf-mp.validate.js)'],
      ...(r ? [['Balance', gfBal(r)], ['Solved in', `${(r.ms / 1000).toFixed(2)} s`]] : [])];
  },
  solveTiles: (dim, o, r) => [['Heater', `${o.heater.P} W`, `${gfFluxOf(o).toFixed(0)} W/m² under it`, 'temp'], ['Air', `${o.air.h} W/(m²·K)`, `ε ${o.air.eps}, room ${o.air.T} °C`, 'flow'],
    ['Time', `${gfS(o.tEnd)} s`, `${o.steps} steps, then steady`, 'period'], ['Solved in', r ? `${(r.ms / 1000).toFixed(2)} s` : '—', r ? 'for the inputs as they are' : 'not solved yet', 'play']],
  resultsHTML: dim => gfHTML(dim),
  renderResults: dim => gfRender(dim),
  csv: dim => gfCsv(dim),
  openInputs: () => { setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="gfuse"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } },
  viewer: true,
  viewNames: dim => ({ gf1: 'Temperature along the film', gf2: 'Against time', gf3: dim === 3 ? 'On the film\'s plane' : 'Its stress across the piece',
    gf4: dim === 1 ? 'Where the heat leaves' : dim === 2 ? 'On the section' : 'The quarter in 3D', gfCompare: 'Against independent answers' }),
};
/** The solve's energy balance in words: the heater's power against what left to the air, steady. */
function gfBal(r) {
  const e = Math.abs(r.steady.Pout - r.Pin) / r.Pin, u = r.dim === 3 ? ' W (the quarter)' : ' W per m across';
  return `the heater's ${r.Pin.toPrecision(4)} = ${r.steady.Pout.toPrecision(4)} out to the air${u} (${e < 1e-6 ? 'closes' : `off by ${(e * 100).toFixed(4)} %`})`;
}

// ---- the inputs bar: the heater's test ----
function gfTreeHTML() {
  const fu = OVEN.furn, field = (k, id) => { const f = FURN_FIELDS.find(q => q[0] === k); return `<div class="prop"><label class="prop-l" for="${id}">${f[1]}</label><span class="prop-v"><input type="number" id="${id}" min="${f[3]}" max="${f[4]}" step="${f[5]}" value="${fu[k]}" data-furnf="${k}"><span class="prop-u">${f[2]}</span></span></div>`; };
  return `<div class="ovz" id="gfIn">${field('gfA', 'gfA')}${field('gfP', 'gfP')}${field('gfH', 'gfH')}${field('gfT', 'gfT')}
    <p class="prop-note">A piece of the graphene film on a square heater under its middle, in still room air (about 5–10 W/(m²·K); a fan, 20–50). It starts at the room's temperature (Materials: the room). Its own values (through it, its emissivity, its stiffness, expansion and strength) are on its card: Materials › Graphene film.</p></div>`;
}

// ---- the answers (the Results step) ----
function gfHTML(dim) {
  const pane = (id, icon, title, aria, extra = '') => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}<span id="${id}T">${title}</span>${extra}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  const chips = `<span class="vp-spacer"></span><span class="seg seg-sm" role="tablist" aria-label="The moment shown" id="gfSnap"></span>`;
  const mapChips = `<span class="vp-spacer"></span><span class="seg seg-sm" role="tablist" aria-label="What the map shows" id="gfMap"></span>`;
  const p3 = dim === 3 ? pane('gf3', 'section', 'On the film\'s plane', 'A map of the quarter\'s mid-plane: its temperature or its stress', mapChips) : pane('gf3', 'cut', 'Its stress across the piece', 'The stress σ_yy across the piece against the distance from the heater\'s middle, steady and at the end of the time');
  const p4 = dim === 1 ? pane('gf4', 'flow', 'Where the heat leaves', 'The heat leaving the film\'s faces per area against the distance from the heater\'s middle, steady')
    : dim === 2 ? pane('gf4', 'section', 'On the section', 'The temperature on the film\'s section at the moment chosen', chips) : pane('gf4', 'section', 'The quarter in 3D', 'The temperature on the quarter\'s faces at the moment chosen', chips);
  return `<section class="mp-sec mp-bench" id="gfSec" aria-label="The graphene film on the heater: its answers">
    <div class="stats mp-stats" id="gfStats"></div>
    <div class="dry-grid mp-grid mp-grid2">
      ${pane('gf1', 'temp', 'Temperature along the film', 'The film\'s temperature against the distance from the heater\'s middle at the moments kept and steady')}
      ${pane('gf2', 'period', 'Against time', 'The hottest point, the heater\'s mean and the edge\'s temperature against time on the heater')}
    </div>
    <div class="dry-grid mp-grid mp-grid2">${p3}${p4}</div>
    <div class="mp-compare" id="gfCompare"></div>
  </section>`;
}
function gfWireSec(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.gfsnap != null) { GFS.snap = +t.dataset.gfsnap; gfRender(GFS.dim); }
    else if (t.dataset.gfmap) { GFS.map = t.dataset.gfmap; gfRender(GFS.dim); }
  });
}
function gfRender(dim) {
  const sec = document.getElementById('gfSec');
  if (!sec) return;
  if (!sec.dataset.wired) gfWireSec(sec);
  const o = gfmInputs(dim), r = gfmCurrent(dim) ? GFS.res[dim] : null, ids = ['gf1', 'gf2', 'gf3', 'gf4'];
  if (!o || !r) {
    paneEmptyIds(ids, paneWhy('gf1'));
    for (const id of ids) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    const st = document.getElementById('gfStats');
    if (st) st.innerHTML = gfmFailed(dim) ? `<p class="dry-msg">${pill(`The ${dim}D could not be solved: ${dryEsc(GFS.error[dim])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${GFS.busy ? `Solving the ${dim}D: its answers here when it is done.` : 'Not solved for the inputs as they are.'}</p>`;
    const cmp = document.getElementById('gfCompare'); if (cmp) cmp.innerHTML = '';
    return;
  }
  if (!(GFS.snap >= -1 && GFS.snap < r.snaps.length)) GFS.snap = -1;
  const snap = document.getElementById('gfSnap');
  if (snap) snap.innerHTML = [...r.snaps.map((s, i) => [i, `${gfS(s.t)} s`]), [-1, 'Steady']].map(([k, t]) => `<button type="button" role="tab" data-gfsnap="${k}" aria-selected="${k === GFS.snap}">${t}</button>`).join('');
  gfTiles(o, r); gfAlong(o, r); gfTime(o, r);
  if (dim === 3) { gfPlaneMap(o, r); gfIso(o, r); }
  else { gfStressAlong(o, r); if (dim === 1) gfLossAlong(o, r); else gfSection(o, r); }
  gfCompare(o, r);
}
/** The moment chosen: its temperature (nodal) and its name. */
const gfMoment = r => (GFS.snap >= 0 && r.snaps[GFS.snap] ? { T: r.snaps[GFS.snap].T, t: `after ${gfS(r.snaps[GFS.snap].t)} s on the heater` } : { T: r.steady.T, t: 'steady' });
/** The time to reach 95 % of the hottest point's steady rise (s); null when not within the time on the heater. */
function gfT95(o, r) {
  const goal = o.air.T + 0.95 * (r.steady.Tmax - o.air.T);
  for (let i = 1; i < r.hist.length; i++) if (r.hist[i].Tmax >= goal) { const a = r.hist[i - 1], b = r.hist[i]; return a.t + (goal - a.Tmax) / Math.max(1e-12, b.Tmax - a.Tmax) * (b.t - a.t); }
  return null;
}
function gfTiles(o, r) {
  const tile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const S = r.steady, end = r.hist[r.hist.length - 1], t95 = gfT95(o, r), st = r.stress ? r.stress.steady : null, sF = o.sigF;
  const sAbs = st ? Math.max(st.sMax, -st.sMin) : 0, frac = sAbs / sF;
  document.getElementById('gfStats').innerHTML = [
    tile('Hottest', `${gfT(S.Tmax)} °C`, `steady, ${gfT(S.Tmax - o.air.T)} K over the room; ${gfT(end.Tmax)} °C after ${gfS(o.tEnd)} s`, 'temp'),
    tile('Over the heater', `${gfT(S.Theat)} °C`, 'the film\'s underside on it, its mean', 'temp'),
    tile('At the edge', `${gfT(S.Tedge)} °C`, r.dim === 3 ? 'the middle of the piece\'s edge' : 'the piece\'s edge', 'temp'),
    tile('Spread', `${gfT(S.Tmax - S.Tedge)} K`, 'the hottest less the edge: the less, the better it spreads', 'ratio'),
    tile('Steady by', t95 != null ? `${gfS(t95)} s` : `> ${gfS(o.tEnd)} s`, t95 != null ? '95 % of its rise at the hottest point' : 'not within the time on the heater', 'period', t95 == null ? 'warn' : ''),
    tile('Its stress', st ? `${gfKPa(sAbs)} kPa` : '—', st ? `${(frac * 100).toFixed(frac < 0.01 ? 3 : 1)} % of its strength (${(sF / 1e6).toFixed(0)} MPa); ${st.sMax >= -st.sMin ? 'pulled' : 'pushed'} most` : 'not solved', 'cut', frac >= 1 ? 'bad' : frac >= 0.8 ? 'warn' : ''),
    tile('Heat out', `${(S.Pout / r.Pin * 100).toFixed(2)} %`, 'of the heater\'s power, steady (energy balance)', 'flow'),
  ].join('');
}
/** Distances (mm) and values along x at y = 0 on the bottom face (z = 0): each dimension's nodes there. */
function gfLine(r, T) {
  const xs = r.mesh.coord[0], d = r.dim, nn = r.mesh.nn, out = [];
  for (let i = 0; i < xs.length; i++) {
    // (node index as mpMesh numbers them: the axis with the fewest nodes fastest -- rebuilt from the counts)
    const n = gfNode(nn, d, [i, 0, 0]);
    out.push([xs[i] * 1000, T[n]]);
  }
  return out;
}
/** mpMesh's node number from (i, j, k) and the nodes per axis (its stride: the axis with the fewest nodes runs fastest). */
function gfNode(nn, dim, ix) {
  const order = [...Array(dim).keys()].sort((a, b) => nn[a] - nn[b]), stride = Array(dim).fill(0);
  let s = 1; for (const d of order) { stride[d] = s; s *= nn[d]; }
  let k = 0; for (let d = 0; d < dim; d++) k += ix[d] * stride[d];
  return k;
}
/** The temperature along the film from the heater's middle: at the moments kept and steady (3D: along x at y = 0). */
function gfAlong(o, r) {
  const cv = document.getElementById('gf1'), lg = document.getElementById('gf1Lg');
  if (!cv) return;
  const cols = ['#adb5bd', '#74c0fc', '#339af0', '#1c7ed6'], heat = cssVar('--heat').trim();
  const S = r.snaps.filter(s => s.t > 0).map((s, i) => ({ p: gfLine(r, s.T), c: cols[Math.min(i + 1, cols.length - 1)], w: 2, l: `${gfS(s.t)} s` }));
  S.push({ p: gfLine(r, r.steady.T), c: heat, w: 2.4, dash: [6, 3], l: 'steady' });
  const ys = S.flatMap(q => q.p.map(p => p[1])), lo = Math.min(o.air.T, ...ys), hi = Math.max(...ys), yt = pmpTicks(lo, hi + (hi - lo) * 0.04 + 1e-9, 5), xt = pmpTicks(0, o.Lx / 2 * 1000, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)),
    xl: 'from the heater\'s middle (mm)', yl: 'temperature (°C)', vl: [{ x: gfAxes(o).a2 * 1000, c: cssVar('--muted'), t: 'the heater\'s edge' }], s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">${r.dim === 3 ? 'Along the piece through its middle (y = 0), on its underside. ' : r.dim === 2 ? 'On the film\'s underside. ' : ''}The heat runs out along the film from over the heater and leaves its faces on the way: the better it conducts along itself, the flatter this line.</p>`;
}
/** The hottest point, the heater's mean and the edge against time. */
function gfTime(o, r) {
  const cv = document.getElementById('gf2'), lg = document.getElementById('gf2Lg');
  if (!cv) return;
  // (time on a log scale: the film warms in a second, the piece spreads the heat over minutes; the start, t = 0, left out)
  const H = r.hist.filter(q => q.t > 0), heat = cssVar('--heat').trim(), ink = cssVar('--ink'), lg10 = Math.log10;
  const S = [{ p: H.map(q => [lg10(q.t), q.Tmax]), c: heat, w: 2, l: 'the hottest point' }, { p: H.map(q => [lg10(q.t), q.Theat]), c: ink, w: 2, dash: [5, 3], l: 'over the heater, its mean' }, { p: H.map(q => [lg10(q.t), q.Tedge]), c: '#1c7ed6', w: 2, l: 'the edge' }];
  const ys = S.flatMap(q => q.p.map(p => p[1])), yt = pmpTicks(Math.min(o.air.T, ...ys), Math.max(...ys) + 1e-9, 5), t95 = gfT95(o, r);
  const d0 = Math.floor(lg10(H[0].t)), d1 = Math.ceil(lg10(o.tEnd)), xt = []; for (let d = d0; d <= d1; d++) xt.push(d);
  const tf = v => { const s = Math.pow(10, v); return s >= 1 ? String(+s.toPrecision(3)) : s.toPrecision(1); };
  plotChart(cv, FILM_ASPECT, { x0: d0, x1: d1, y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: tf, yf: v => String(+v.toPrecision(4)), xl: 'time on the heater (s, a log scale)', yl: 'temperature (°C)',
    ...(t95 != null && t95 > 0 ? { vl: [{ x: lg10(t95), c: cssVar('--muted'), t: `95 % by ${gfS(t95)} s` }] } : {}), s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">Steady, the hottest point ${gfT(r.steady.Tmax)} °C. The film over the heater warms first (its own time ρ c t / 2h ≈ ${gfS(o.rho * o.c * o.t / (2 * (o.air.h + gfHr(o))))} s); the edge follows as the heat spreads out to it.</p>`;
}
/** The stress across the long piece (1D, 2D): σ_yy along x, steady and at the end of the time. */
function gfStressAlong(o, r) {
  const cv = document.getElementById('gf3'), lg = document.getElementById('gf3Lg');
  if (!cv || !r.stress) return;
  const sF = o.sigF / 1e3, mk = s => s.x.map((x, i) => [x * 1000, s.syy[i] / 1000]);
  const S = [{ p: mk(r.stress.steady), c: cssVar('--heat').trim(), w: 2.4, l: 'steady' }, { p: mk(r.stress.end), c: '#1c7ed6', w: 2, dash: [5, 3], l: `after ${gfS(o.tEnd)} s` }];
  const ys = S.flatMap(q => q.p.map(p => p[1])), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = Math.max(hi - lo, 1e-6), yt = pmpTicks(lo - span * 0.05, hi + span * 0.05, 5), xt = pmpTicks(0, o.Lx / 2 * 1000, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)),
    xl: 'from the heater\'s middle (mm)', yl: 'stress across, σ_yy (kPa)', hl: [{ y: 0, c: cssVar('--muted'), t: '' }], vl: [{ x: gfAxes(o).a2 * 1000, c: cssVar('--muted'), t: 'the heater\'s edge' }], s: S });
  const a = MAT.furn.aG.v;
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">The warm film over the heater would ${a < 0 ? 'shrink' : 'grow'} in its plane (α ${a} × 10⁻⁶/K); the cooler film round it holds it: ${a < 0 ? 'pulled' : 'pushed'} over the heater, the other way out at the edges. Its strength, ${(sF / 1000).toFixed(0)} MPa, is ${(sF / Math.max(1e-9, Math.max(-lo, hi))).toFixed(0)} times the most here.</p>`;
}
/** Where the heat leaves the film (1D): its faces' loss per area along it, steady (convection and radiation). */
function gfLossAlong(o, r) {
  const cv = document.getElementById('gf4'), lg = document.getElementById('gf4Lg');
  if (!cv) return;
  const xs = r.mesh.coord[0], a2 = gfAxes(o).a2, sig = 5.670374419e-8, K = 273.15, T0 = o.air.T;
  const conv = [], rad = [];
  for (let i = 0; i < xs.length; i++) {
    const T = r.steady.T[i], n = xs[i] <= a2 * (1 + 1e-9) ? 1 : 2;
    conv.push([xs[i] * 1000, n * o.air.h * (T - T0)]); rad.push([xs[i] * 1000, n * o.air.eps * sig * (Math.pow(T + K, 4) - Math.pow(T0 + K, 4))]);
  }
  const S = [{ p: conv, c: '#1c7ed6', w: 2, l: 'convection' }, { p: rad, c: cssVar('--heat').trim(), w: 2, dash: [5, 3], l: 'radiation' }];
  const ys = S.flatMap(q => q.p.map(p => p[1])), yt = pmpTicks(0, Math.max(...ys) * 1.04 + 1e-9, 5), xt = pmpTicks(0, o.Lx / 2 * 1000, 6);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], yticks: yt, xticks: xt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)),
    xl: 'from the heater\'s middle (mm)', yl: 'heat leaving its faces (W/m²)', vl: [{ x: a2 * 1000, c: cssVar('--muted'), t: 'the heater\'s edge' }], s: S });
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">Steady, both faces together (over the heater only its top: the heater covers its underside). The heater gives ${gfFluxOf(o).toFixed(0)} W/m² over ${gfMm(a2)} mm; the film carries it out and loses it on the way.</p>`;
}
/** The colour bar's HTML. */
const gfBar = (lut, sc, unit, f) => `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${f(sc.min)}</span><span>${unit}</span><span>${f(sc.max)}</span></span></div>`;
/** The section (2D): its temperature at the moment chosen, its thickness stretched to read it. */
function gfSection(o, r) {
  const cv = document.getElementById('gf4'), lg = document.getElementById('gf4Lg');
  if (!cv) return;
  const mo = gfMoment(r), xs = r.mesh.coord[0], zs = r.mesh.coord[1], nn = r.mesh.nn, lut = mpHeatLut();
  const val = (k, i) => mo.T[gfNode(nn, 2, [i, k])], all = mo.T, sc = { min: Math.min(...all), max: Math.max(...all), levels: 0 };
  if (sc.max - sc.min < 1e-3) { sc.min -= 0.05; sc.max += 0.05; }
  const { c, w, h } = setupCanvas(cv, 0.34), m = { l: 56, r: 16, t: 22, b: 34 }, pw = w - m.l - m.r, ph = h - m.t - m.b, X1 = xs[xs.length - 1], Z1 = zs[zs.length - 1];
  c.clearRect(0, 0, w, h);
  const X = x => m.l + x / X1 * pw, Z = z => m.t + ph - z / Z1 * ph;
  for (let k = 0; k < zs.length - 1; k++) for (let i = 0; i < xs.length - 1; i++) {
    const v = (val(k, i) + val(k, i + 1) + val(k + 1, i) + val(k + 1, i + 1)) / 4;
    c.fillStyle = lutColor(lut, scaleT(sc, v));
    c.fillRect(Math.floor(X(xs[i])), Math.floor(Z(zs[k + 1])), Math.ceil(X(xs[i + 1]) - X(xs[i])) + 1, Math.ceil(Z(zs[k]) - Z(zs[k + 1])) + 1);
  }
  const a2 = gfAxes(o).a2; c.fillStyle = cssVar('--heat'); c.fillRect(X(0), m.t + ph + 2, X(a2) - X(0), 5);
  c.strokeStyle = cssVar('--line'); c.strokeRect(m.l, m.t, pw, ph);
  c.font = '12px ' + cssVar('--mono'); c.fillStyle = cssVar('--muted'); c.textAlign = 'center';
  for (const v of niceTicks(0, X1 * 1000, 6)) c.fillText(fmtNum(v), X(v / 1000), h - m.b + 20);
  c.textAlign = 'right'; c.fillText(`${gfUm(Z1)} µm`, m.l - 6, m.t + 8); c.fillText('0', m.l - 6, m.t + ph + 4);
  c.textAlign = 'right'; c.fillText('from the heater\'s middle (mm)', w - m.r, h - 2); c.textAlign = 'left'; c.fillText('through the film (stretched)', m.l, m.t - 6);
  document.getElementById('gf4T').textContent = `On the section: temperature, ${mo.t}`;
  // (the difference through the film over the heater's middle)
  const dz = val(0, 0) - val(zs.length - 1, 0);
  lg.innerHTML = gfBar(lut, sc, '°C', v => v.toFixed(2)) + `<p class="fv-why">Its ${gfUm(Z1)} µm drawn as tall as the panel. The heater (the bar under it) to ${gfMm(a2)} mm. Through the film over the heater's middle ${dz.toFixed(4)} K: the heat crosses it at once (q t / k_t = ${(gfFluxOf(o) * o.t / o.kt).toFixed(4)} K), so the 1D's even film holds.</p>`;
}
/** The quarter's mid-plane (3D): its temperature through the film averaged, or its stress's largest pull or push. */
function gfPlaneMap(o, r) {
  const cv = document.getElementById('gf3'), lg = document.getElementById('gf3Lg'), seg = document.getElementById('gfMap');
  if (!cv || !r.stress) return;
  const maps = [['T', 'Temperature'], ['s1', 'Largest pull σ₁'], ['syy', 'Stress σ_yy']];
  if (!maps.some(q => q[0] === GFS.map)) GFS.map = 'T';
  seg.innerHTML = maps.map(([k, t]) => `<button type="button" role="tab" data-gfmap="${k}" aria-selected="${k === GFS.map}">${t}</button>`).join('');
  const st = r.stress.steady, nn2 = [st.x.length, st.y.length];
  const at = (k, j) => gfNode(nn2, 2, [j, k]);
  // (the map over where the film warms: out to where its rise along the middle line falls below 1 % of the most, at least
  //  twice the heater's half, the rest of the quarter left out -- said below)
  const zs3 = r.mesh.coord[2], top3 = zs3.length - 1, rise = i => r.steady.T[gfNode(r.mesh.nn, 3, [i, 0, top3])] - o.air.T, r0 = Math.max(1e-12, rise(0));
  let ic = 0; for (let i = 0; i < st.x.length; i++) if (rise(i) > 0.01 * r0) ic = i;
  const a2 = gfAxes(o).a2, need = st.x.findIndex(x => x >= 2 * a2), cut = Math.min(st.x.length - 1, Math.max(ic + 1, need < 0 ? st.x.length - 1 : need, 2));
  const sx = st.x.slice(0, cut + 1).map(v => v * 1000), sy = st.y.slice(0, Math.min(st.y.length, cut + 1)).map(v => v * 1000), nx = sx.length, cropped = cut < st.x.length - 1;
  const { c, w, h } = setupCanvas(cv, 0.5);
  c.clearRect(0, 0, w, h);
  let lut, sc, unit, f, v;
  if (GFS.map === 'T') {
    // (the steady temperature through the film averaged, at the mid-plane's nodes)
    const zs = r.mesh.coord[2], nn = r.mesh.nn, H = zs[zs.length - 1];
    const Tm = (i, j) => { let a = 0; for (let k = 0; k < zs.length - 1; k++) a += (r.steady.T[gfNode(nn, 3, [i, j, k])] + r.steady.T[gfNode(nn, 3, [i, j, k + 1])]) / 2 * (zs[k + 1] - zs[k]); return a / H; };
    const grid = []; for (let k = 0; k < sy.length; k++) for (let j = 0; j < nx; j++) grid[k * nx + j] = Tm(j, k);   // (the shown part)
    lut = mpHeatLut(); sc = { min: Math.min(...grid), max: Math.max(...grid), levels: 0 }; unit = '°C'; f = x => x.toFixed(2); v = (k, j) => grid[k * nx + j];
  } else {
    const a = GFS.map === 's1' ? st.s1 : st.syy, mx = Math.max(1e-9, ...a.map(Math.abs));
    lut = getLut('div'); sc = { min: -mx / 1000, max: mx / 1000, levels: 0 }; unit = 'kPa (− push, + pull)'; f = x => gfKPa(x * 1000); v = (k, j) => a[at(k, j)] / 1000;
  }
  if (sc.max - sc.min < 1e-9) { sc.min -= 0.05; sc.max += 0.05; }
  mpPlanes(c, w, h, sx, sy, [{ t: maps.find(q => q[0] === GFS.map)[1] + (GFS.map === 'T' ? ', through the film averaged' : ''), v }], lut, sc);
  document.getElementById('gf3T').textContent = 'On the film\'s plane, steady';
  lg.innerHTML = gfBar(lut, sc, unit, f) + `<p class="fv-why">The quarter from the piece's middle (lower left)${cropped ? `, out to ${sx[nx - 1].toFixed(0)} mm where the film has warmed (beyond it, under 1 % of the rise; the quarter runs to ${gfMm(o.Lx / 2)} mm)` : ' to its edges'}; the heater's square to ${gfMm(gfAxes(o).a2)} mm each way. ${GFS.map === 'T' ? '' : `Free on the heater: what the warm middle's ${MAT.furn.aG.v < 0 ? 'shrinking' : 'growing'} in its plane gives against the cooler film round it. Its strength ${(o.sigF / 1e6).toFixed(0)} MPa.`}</p>`;
}
/** The quarter in 3D (its faces): the temperature at the moment chosen. */
function gfIso(o, r) {
  const cv = document.getElementById('gf4'), lg = document.getElementById('gf4Lg'), A = SWB_ADAPT['furn:product'];
  if (!cv) return;
  const mo = gfMoment(r), T = mo.T, sc = { min: Math.min(...T), max: Math.max(...T), levels: 0 }, lut = mpHeatLut();
  if (sc.max - sc.min < 1e-3) { sc.min -= 0.05; sc.max += 0.05; }
  swbDrawIso(cv, A, o, 'results', { f: id => T[id], sc, lut });
  document.getElementById('gf4T').textContent = `The quarter in 3D: temperature, ${mo.t}`;
  lg.innerHTML = gfBar(lut, sc, '°C', x => x.toFixed(2)) + `<p class="fv-why">Seen from the piece's outer corner: its top and its two edges; its middle, on the mirror planes, behind. Its thickness drawn ×${A.layout(3, o).kz}.</p>`;
}
/** The same answers against ones worked out apart (the conditions each holds for, said). */
function gfCompare(o, r) {
  const el = document.getElementById('gfCompare');
  if (!el) return;
  const rows = [], hE = o.air.h + gfHr(o), oL = { ...o, air: { ...o.air, h: hE }, check: { edges: 'adiabatic' } }, T0 = o.air.T;
  if (r.dim < 3) {
    const fin0 = gfFin1(oL, 0) + T0, finE = gfFin1(oL, o.Lx / 2) + T0;
    rows.push(['The hottest point, steady', `${gfT(fin0)} °C`, `${gfT(r.steady.Tmax)} °C`, `the fin's closed form, the radiation taken about the room (h + 4εσT∞³ = ${hE.toFixed(2)} W/(m²·K)) and the edge closed${o.air.eps > 0 ? ': exact for ε 0' : ''}`]);
    rows.push(['The edge, steady', `${gfT(finE)} °C`, `${gfT(r.steady.Tedge)} °C`, 'the same']);
  } else {
    const p0 = gfPlate({ ...oL, check: { edges: 'adiabatic', heaterLoss: true } }, 0, 0, 200) + T0, pE = gfPlate({ ...oL, check: { edges: 'adiabatic', heaterLoss: true } }, o.Lx / 2, 0, 200) + T0;
    rows.push(['The hottest point, steady', `${gfT(p0)} °C`, `${gfT(r.steady.Tmax)} °C`, `the thin plate's series, both faces losing everywhere (here the heater covers its patch: this one hotter), radiation about the room, the edges closed`]);
    rows.push(['The edge\'s middle, steady', `${gfT(pE)} °C`, `${gfT(r.steady.Tedge)} °C`, 'the same']);
  }
  if (r.dim > 1) {
    const nn = r.mesh.nn, top = r.dim === 2 ? gfNode(nn, 2, [0, nn[1] - 1]) : gfNode(nn, 3, [0, 0, nn[2] - 1]);
    rows.push(['Through the film over the heater\'s middle', `${(gfFluxOf(o) * o.t / o.kt).toFixed(4)} K`, `${(r.steady.T[0] - r.steady.T[top]).toFixed(4)} K`, 'q t / k_t: all the heater\'s flux crossing it (an upper bound: some leaves sideways first)']);
  }
  rows.push(['Heat out to the air, steady', `${r.Pin.toPrecision(4)} W${r.dim === 3 ? '' : '/m'}`, `${r.steady.Pout.toPrecision(4)} W${r.dim === 3 ? '' : '/m'}`, `the heater's power${r.dim === 3 ? ' (the quarter\'s share)' : ' per metre of the band'}: what goes in comes out`]);
  el.innerHTML = `<h4 class="mp-h">Against independent answers</h4>
    <table class="mp-cmp"><thead><tr><th scope="col"></th><th scope="col">Independent</th><th scope="col">This ${r.dim}D</th><th scope="col">How</th></tr></thead>
    <tbody>${rows.map(([p, q, s, t]) => `<tr><th scope="row">${p}</th><td>${q}</td><td>${s}</td><td>${t}</td></tr>`).join('')}</tbody></table>`;
}
function gfCsv(dim) {
  const r = gfmCurrent(dim) ? GFS.res[dim] : null;
  if (!r) return;
  const rows = [['distance from the heater\'s middle (mm)', 'steady temperature, underside (°C)', `temperature at ${gfS(r.hist[r.hist.length - 1].t)} s (°C)`, ...(dim < 3 ? ['steady stress across σ_yy (kPa)'] : [])]];
  const sl = gfLine(r, r.steady.T), el = gfLine(r, r.snaps.length ? r.snaps[r.snaps.length - 1].T : r.steady.T);
  sl.forEach(([x, T], i) => rows.push([x, T, el[i][1], ...(dim < 3 && r.stress ? [r.stress.steady.syy[i] / 1000] : [])]));
  if (dim === 3 && r.stress) {
    const st = r.stress.steady, nn2 = [st.x.length, st.y.length];
    rows.push([]); rows.push(['x (mm)', 'y (mm)', 'σ_xx (kPa)', 'σ_yy (kPa)', 'σ_xy (kPa)', 'σ₁ (kPa)']);
    for (let j = 0; j < st.y.length; j++) for (let i = 0; i < st.x.length; i++) { const n = gfNode(nn2, 2, [i, j]); rows.push([st.x[i] * 1000, st.y[j] * 1000, st.sxx[n] / 1000, st.syy[n] / 1000, st.sxy[n] / 1000, st.s1[n] / 1000]); }
  }
  rows.push([]); rows.push(['time (s)', 'hottest (°C)', 'over the heater (°C)', 'edge (°C)', 'heat out (W)']);
  for (const q of r.hist) rows.push([q.t, q.Tmax, q.Theat, q.Tedge, q.Pout]);
  downloadCSV(`graphene-film-${dim}D-${csvStamp()}.csv`, rows);
}
