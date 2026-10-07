/*
 * cut-mp-ui.js — MP-CUT on the Cutting stage: its pages 1D, 2D and 3D (mp-bench-ui.js), each in the steps Geometry › Mesh ›
 * Solve › Results. The dried film as it was peeled (film.js's layers through its thickness: each its thickness, its
 * stiffness at its water and its natural strain) cut with a knife along a ruler (cut-mp.js in cfd-mp-worker.js):
 *  1D: through the film at the cut: each layer's stress in the free piece, which the cut's face must shed, and the energy
 *      released if the layers part at each interface from the cut, against their hold on each other.
 *  2D: the section across the cut: the stress near it (the layers' peel and shear, along the film), by finite elements.
 *  3D: the cut piece: its curl and its corners, held up and lying on a table (sheet.js's plate).
 * The piece's size is the inputs bar's (The pieces cut); the film's values its card's (Materials: Dried GO film). The
 * stage's Results page (the piece in 3D, the stack) is as it was.
 */
const CMS = { dim: 2, res: {}, key: {}, busy: false, bdim: null, pending: null, prog: null, error: {}, id: 0, worker: null, again: null, map: 'szz' };
/** The mesh's defaults (the Mesh step's, editable). 2D: elements in from the cut (graded toward it), the domain's length in
 *  film thicknesses, elements through each band of layers, layers to a band; 3D: elements along a quarter's side. */
const CM_MESH_DEF = { 1: {}, 2: { cutNx: 30, cutGrade: 300, cutLh: 20, cutNz: 2, cutBands: 6 }, 3: { cutN: 8 } };
const CM_C = '--go-film';
const cmSet = dim => (typeof swbSettings === 'function' && SWB_ADAPT['film:piece'] ? swbSettings(SWB_ADAPT['film:piece'], dim) : CM_MESH_DEF[dim]);
/** The film's layers at the peel, from its underside up (film.js's profile, as the roll's and the peel front's take them):
 *  each its thickness, its stiffness at its water (softer with water, the Film card's X_h), its natural strain from its
 *  stress on the web (−σ/Q). */
function cmLayers(run) {
  const F = filmOpts().film;
  return [...run.profile.cells].sort((a, b) => a.z0 - b.z0).map(c => { const E = F.Ep / (1 + c.X / F.Xh), Q = E / (1 - F.nup); return { t: c.t, E, nu: F.nup, en: -c.sig / Q, X: c.X }; });
}
/** A dimension's inputs: the film's layers (1D, 2D) or its plate (3D), the piece's size, the layers' hold, its strength. */
function cmInputs(dim) {
  const run = typeof pmpRunNow === 'function' ? pmpRunNow() : null;
  if (!run || !run.profile || !run.profile.cells.length) return null;
  const m = cmSet(dim), pl = OVEN.peel, f = MAT.film;
  const base = { dim, film: run.key, where: run.where, Lx: pl.pieceL / 1000, Ly: pl.pieceW / 1000, Gl: f.Gl.v, sigF: f.sigF.v * 1e6 };
  if (dim === 3) {
    if (!run.plate) return null;
    const P = run.plate;
    return { ...base, n: m.cutN, plate: { A: P.A, D: P.D, nu: P.nu, h: P.h, kS: P.kS, kSet: P.kSet || 0, p: P.p } };
  }
  const layers = cmLayers(run).map(({ t, E, nu, en }) => ({ t, E, nu, en }));
  if (dim === 1) return { ...base, layers };
  return { ...base, layers, mesh: { nx: m.cutNx, grade: m.cutGrade, Lh: m.cutLh, nzL: m.cutNz, group: Math.max(1, Math.ceil(layers.length / m.cutBands)), p: 2 } };
}
const cmKeyNow = dim => { const o = cmInputs(dim); return o ? JSON.stringify(o) : null; };
const cmCurrent = dim => !!CMS.res[dim] && CMS.key[dim] === cmKeyNow(dim);
const cmFailed = dim => !!(CMS.error[dim] && CMS.key[dim] === cmKeyNow(dim));
function cmRequest(dim) {
  const key = cmKeyNow(dim);
  if (!key) return;
  if (CMS.key[dim] === key && CMS.res[dim]) { solveTake('cmp' + dim); return; }
  // (Phase 0, solving only on request)
  if (!solveMay('cmp' + dim)) return;
  if (CMS.busy) { if (CMS.pending !== key) CMS.again = dim; return; }
  solveTake('cmp' + dim);
  const o = cmInputs(dim);
  CMS.busy = true; CMS.bdim = dim; CMS.pending = key; CMS.prog = null; CMS.again = null;
  const id = ++CMS.id;
  if (!CMS.worker) CMS.worker = makeWorker('cfd-mp-worker.js');
  const done = () => { CMS.busy = false; CMS.pending = null; CMS.bdim = null; if (CMS.again) { const a = CMS.again; CMS.again = null; cmRequest(a); } if (typeof swbRefresh === 'function') swbRefresh('film:piece'); };
  CMS.worker.onmessage = e => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.progress) { CMS.prog = msg.progress; if (typeof swbOn === 'function' && swbOn('film:piece')) swbProgress(); return; }
    CMS.key[dim] = key;
    if (msg.ok) { CMS.res[dim] = { ...msg.res, ms: msg.ms }; CMS.error[dim] = null; } else { CMS.res[dim] = null; CMS.error[dim] = msg.error; }
    done();
  };
  CMS.worker.onerror = ev => { CMS.key[dim] = key; CMS.res[dim] = null; CMS.error[dim] = ev.message || 'the multiphysics worker failed'; CMS.worker = null; done(); };
  CMS.worker.postMessage({ id, kind: 'cut', o });
}
function cmStop() {
  if (CMS.worker) { CMS.worker.terminate(); CMS.worker = null; }
  Object.assign(CMS, { busy: false, bdim: null, pending: null, prog: null, again: null });
}

// ---- numbers ----
const cmUm = v => { const u = v * 1e6; return u >= 100 ? u.toFixed(0) : u >= 10 ? u.toFixed(1) : u.toFixed(2); };
const cmMPa = v => { const m = v / 1e6; if (Math.abs(m) < 5e-4) return '0'; return (Math.abs(m) >= 100 ? m.toFixed(0) : Math.abs(m) >= 10 ? m.toFixed(1) : Math.abs(m) >= 1 ? m.toFixed(2) : m.toFixed(3)).replace(/^-/, '−'); };
const cmJ = v => (v < 1e-9 ? 'none' : v < 0.01 ? `${(v * 1e3).toPrecision(3)} mJ/m²` : `${v >= 100 ? v.toFixed(0) : v.toPrecision(3)} J/m²`);
/** A curl in words: its radius, or flat past a kilometre. */
const cmMm = v => { const m = v * 1000; return Math.abs(m) < 0.05 ? '0 mm' : `${m.toFixed(Math.abs(m) >= 10 ? 0 : 1)} mm`; };
const cmCurl = k => (Math.abs(k) < 1e-3 ? 'flat' : `R ${(1000 / Math.abs(k)).toFixed(0)} mm`);
const cmH = o => o.layers.reduce((a, q) => a + q.t, 0);
/** mpMesh's node number from (i, j) and the nodes per axis (the axis with the fewer nodes runs fastest). */
const cmNode = (nn, i, k) => (nn[0] <= nn[1] ? i + k * nn[0] : k + i * nn[1]);
const cmBar = (lut, sc, unit, f) => `<div class="mp-cbar"><span class="mp-cbar-scale" style="background:linear-gradient(90deg,${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(',')})"></span><span class="mp-cbar-t"><span>${f(sc.min)}</span><span>${unit}</span><span>${f(sc.max)}</span></span></div>`;

// ---- drawing: the knife on the ruler from above, and the section at the cut (1D: its line; 2D: the section) ----
function cmDraw(cv, dim, o, what) {
  const { c, w, h } = setupCanvas(cv, 0.42), ink = cssVar('--ink'), mut = cssVar('--muted'), acc = cssVar('--accent') || '#1c7ed6';
  c.clearRect(0, 0, w, h);
  // the plan: the film, the ruler along the cut line, the knife
  const pw = Math.min(w * 0.3, h - 70), Lx = o.Lx, Ly = o.Ly, sc = pw / Math.max(Lx, Ly), px = 16, py = 24, pW = Lx * sc, pH = Ly * sc;
  c.fillStyle = swbFill(CM_C, 0.3); c.fillRect(px, py, pW, pH); c.strokeStyle = swbFill(CM_C, 0.95); c.lineWidth = 1.2; c.strokeRect(px, py, pW, pH);
  c.fillStyle = swbFill('#868e96', 0.5); c.fillRect(px + pW - 10, py - 8, 10, pH + 16);
  c.save(); c.setLineDash([4, 3]); c.strokeStyle = cssVar('--bad') || '#c92a2a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(px + pW, py - 10); c.lineTo(px + pW, py + pH + 10); c.stroke(); c.restore();
  c.strokeStyle = acc; c.lineWidth = 2.4; c.beginPath(); c.moveTo(px + pW, py + pH / 2); c.lineTo(px + pW - pW * 0.35, py + pH / 2); c.stroke();
  c.font = '11.5px ' + cssVar('--mono'); c.textAlign = 'center';
  outlinedText(c, `${(Lx * 1000).toFixed(0)} × ${(Ly * 1000).toFixed(0)} mm`, px + pW / 2, py + pH + 22, mut);
  // the section at the cut: the layers stacked, drawn tall
  const x0 = px + pW + 60, x1 = w - 24, yb = h - 64, yt = 30, H = cmH(o), Z = z => yb - z / H * (yb - yt);
  const lay = o.layers, xL = dim === 1 ? x0 + (x1 - x0) * 0.45 : x0, xR = dim === 1 ? x0 + (x1 - x0) * 0.55 : x1;
  let z = 0;
  lay.forEach((L, i) => { const a = Z(z), b = Z(z + L.t); c.fillStyle = swbFill(CM_C, 0.18 + 0.32 * (i % 2)); c.fillRect(xL, b, xR - xL, a - b); z += L.t; });
  c.strokeStyle = swbFill(CM_C, 0.95); c.lineWidth = 1.2; c.strokeRect(xL, Z(H), xR - xL, Z(0) - Z(H));
  // (the cut's face: at the section's left; the knife above it)
  c.strokeStyle = cssVar('--bad') || '#c92a2a'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(xL, Z(H) - 4); c.lineTo(xL, Z(0) + 4); c.stroke();
  c.fillStyle = swbFill('#868e96', 0.85); c.beginPath(); c.moveTo(xL - 8, Z(H) - 28); c.lineTo(xL + 1, Z(H) - 4); c.lineTo(xL + 8, Z(H) - 28); c.closePath(); c.fill();
  if (what === 'mesh' && dim === 2) {
    const A = cutAxes2(o), xs = mpAxisEdges(A.axes[0]).edges, zs = mpAxisEdges(A.axes[1]).edges, X = x => xL + x / A.L * (xR - xL);
    c.strokeStyle = ink; c.globalAlpha = 0.55; c.lineWidth = 0.6; c.beginPath();
    let last = -1e9; for (const x of xs) { const px2 = X(x); if (px2 - last < 2.5 && x !== xs[xs.length - 1]) continue; last = px2; c.moveTo(px2, Z(0)); c.lineTo(px2, Z(H)); }
    for (const zz of zs) { c.moveTo(xL, Z(zz)); c.lineTo(xR, Z(zz)); }
    c.stroke(); c.globalAlpha = 1;
  } else if (what === 'mesh') {
    c.strokeStyle = ink; c.globalAlpha = 0.6; c.lineWidth = 0.7; c.beginPath(); let zz = 0; for (const L of lay) { zz += L.t; c.moveTo(xL - 6, Z(zz)); c.lineTo(xR + 6, Z(zz)); } c.stroke(); c.globalAlpha = 1;
  } else if (what === 'solve') {
    const F = cmFaces(dim, o), at = [[xL - 16, (Z(0) + Z(H)) / 2], [(xL + xR) / 2, Z(H) - 14], [(xL + xR) / 2, Z(0) + 16], [xR + 16, (Z(0) + Z(H)) / 2]];
    F.slice(0, 4).forEach((q, i) => { const [qx, qy] = at[i]; c.fillStyle = q.c; c.beginPath(); c.arc(qx, qy, 9, 0, 7); c.fill(); c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), qx, qy + 4); });
  }
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
  c.fillText(dim === 1 ? `Left: the piece, the ruler and the knife's line (red). Right: the film at the cut, its ${lay.length} layers (drawn tall), the cut's face red.`
    : `Left: the piece and the cut. Right: the section across the cut, ${(cutAxes2(o).L * 1000).toFixed(2)} mm in from it; the film's ${cmUm(H)} µm drawn tall.`, 8, h - 8);
}
function cmFaces(dim, o) {
  const red = cssVar('--bad').trim() || '#c92a2a', air = '#1c7ed6', sym = cssVar('--muted');
  if (dim === 3) return [{ t: 'The piece\'s edges (the cuts)', c: red, kind: 'free', bc: ['free: no force, no moment'] }, { t: 'Its faces', c: air, kind: 'free', bc: ['held up: free; on a table: its weight down, the table pushing up where it touches'] }, { t: 'Its middle lines', c: sym, kind: 'sym', bc: ['mirror: the piece\'s quarter'] }];
  return [{ t: 'The cut\'s face', c: red, kind: 'free', bc: ['free: no force (σ_xx = σ_xz = 0)', 'its layers\' stress shed here'] },
    { t: 'The film\'s top', c: air, kind: 'free', bc: ['free', '—'] }, { t: 'Its underside', c: air, kind: 'free', bc: ['free (cut on a soft board)', '—'] },
    { t: dim === 1 ? 'Far from the cut' : 'The far end (into the piece)', c: sym, kind: 'sym', bc: [dim === 1 ? 'the free piece\'s stretch and curl' : 'a mirror: no movement along x (the piece\'s middle)', 'along the cut: the piece\'s own strain (plane strain about it)'] }];
}

// ---- the adapter ----
SWB_ADAPT['film:piece'] = {
  key: 'cut', sk: 'film:piece', t: 'Cutting', ready: 'mp7', sid: 'cmp',
  S: () => CMS,
  inputs: dim => cmInputs(dim),
  current: dim => cmCurrent(dim),
  failed: dim => cmFailed(dim),
  request: dim => solveArm('cmp' + dim),
  stop: () => cmStop(),
  why: () => 'The cut is solved after the film to the peel (Peel and wind: the film on the web from the oven).',
  slow3: 'The 3D takes a few seconds',
  dofs: dim => (dim === 3 ? 12 : 2), coupled: 'the displacements',
  axes: (dim, o) => (dim === 2 ? { axes: cutAxes2(o).axes, mat: (ijk, seg) => seg[1] } : { axes: [[{ L: cmH(o), n: o.layers ? o.layers.length : 1 }]] }),
  axisNames: dim => (dim === 2 ? ['In from the cut (x)', 'Through the film (z)'] : dim === 1 ? ['Through the film (z)'] : ['Along the line (x)', 'Across it (y)']),
  meshFields: dim => (dim === 2 ? [
    { k: 'cutNx', t: 'Elements in from the cut', min: 4, max: 400, step: 1, int: true, def: CM_MESH_DEF[2].cutNx },
    { k: 'cutGrade', t: 'Grading to the cut (largest / smallest)', min: 1, max: 10000, step: 10, def: CM_MESH_DEF[2].cutGrade },
    { k: 'cutLh', t: 'The section\'s length in film thicknesses', min: 4, max: 200, step: 1, def: CM_MESH_DEF[2].cutLh },
    { k: 'cutNz', t: 'Elements through each band of layers', min: 1, max: 16, step: 1, int: true, def: CM_MESH_DEF[2].cutNz },
    { k: 'cutBands', t: 'Bands of layers through the film', min: 1, max: 60, step: 1, int: true, def: CM_MESH_DEF[2].cutBands },
  ] : dim === 3 ? [{ k: 'cutN', t: 'Elements along a quarter\'s side', min: 2, max: 24, step: 1, int: true, def: CM_MESH_DEF[3].cutN }] : []),
  meshHow: dim => (dim === 2 ? 'Quadratic elements (9 nodes) on the section, plane strain about the cut line; graded toward the cut, where the stress changes fastest. The film\'s layers are grouped into bands (each band its layers\' stiffness-weighted values) so the matrix stays small.'
    : dim === 3 ? 'Bogner–Fox–Schmit plate elements (the height, its two slopes and its twist at each node), a quarter of the piece; von Kármán (large deflection), Newton with a line search.' : 'The film\'s own layers, each its stiffness and natural strain (film.js\'s profile at the peel); exact through each (the energy is quadratic in z).'),
  meshStats: (dim, o) => {
    if (dim === 1) return { nodes: o.layers.length + 1, elems: o.layers.length, unknowns: 2, band: 1 };
    if (dim === 3) { const n = o.n + 1; return { nodes: n * n, elems: o.n * o.n, unknowns: n * n * 12, band: 12 * (n + 1) }; }
    const A = cutAxes2(o), nx = 2 * o.mesh.nx + 1, nz = 2 * o.mesh.nzL * A.bands.length + 1;
    return { nodes: nx * nz, elems: o.mesh.nx * o.mesh.nzL * A.bands.length, unknowns: 2 * nx * nz, band: 2 * (nz + 2) };
  },
  meshTiles: (dim, o) => {
    const st = SWB_ADAPT['film:piece'].meshStats(dim, o);
    if (dim === 1) return [['Layers', String(o.layers.length), 'film.js\'s, through the film', 'film'], ['Thickness', `${cmUm(cmH(o))} µm`, 'the film at the peel', 'ratio'], ['Interfaces', String(o.layers.length - 1), 'each its parting energy', 'cut'], ['Unknowns', '2', 'the piece\'s stretch and curl', 'tune']];
    if (dim === 3) return [['Nodes', st.nodes.toLocaleString('en'), '12 unknowns at each', 'mesh'], ['Elements', st.elems.toLocaleString('en'), 'plate (bicubic), a quarter', 'grading'], ['Unknowns', st.unknowns.toLocaleString('en'), 'heights, slopes, twists, in-plane', 'tune'], ['Solves', '2', 'held up; on a table', 'play']];
    const A = cutAxes2(o), xs = mpAxisEdges(A.axes[0]).edges;
    return [['Nodes', st.nodes.toLocaleString('en'), '2 unknowns at each', 'mesh'], ['Elements', st.elems.toLocaleString('en'), 'quadratic quadrilaterals', 'grading'], ['Smallest', `${cmUm(xs[1] - xs[0])} µm`, 'at the cut', 'ratio'], ['Bands', String(A.bands.length), `${o.mesh.group} layer${o.mesh.group > 1 ? 's' : ''} each`, 'film'], ['Section', `${(A.L * 1000).toFixed(2)} mm`, `${o.mesh.Lh} film thicknesses`, 'length']];
  },
  meshHTML: (dim, o) => {
    const A = SWB_ADAPT['film:piece'], set = swbSettings(A, dim), F = A.meshFields(dim);
    const card = F.length ? `<section class="swb-card"><h4>${uiBadge('tune')}Mesh</h4><table class="swb-t swb-set"><tbody>${F.map(f => `<tr><th scope="row"><label for="swbm_${f.k}">${f.t}</label></th><td><input type="number" id="swbm_${f.k}" data-swbm="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${set[f.k]}" aria-label="${f.t}"></td><td class="swb-u"></td><td class="swb-def">${set[f.k] === f.def ? '' : `default ${f.def}`}</td></tr>`).join('')}</tbody></table><p class="fv-why">${A.meshHow(dim)}</p></section>`
      : `<section class="swb-card"><h4>${uiBadge('tune')}Mesh</h4><p class="fv-why">${A.meshHow(dim)} Nothing to set: the layers are the film's.</p></section>`;
    const run = pmpRunNow(), cells = run ? cmLayers(run) : [];
    const lay = dim === 3 ? `<section class="swb-card"><h4>${uiBadge('film')}The plate</h4><table class="swb-t swb-kv"><tbody><tr><th scope="row">Thickness</th><td>${cmUm(o.plate.h)} µm</td></tr><tr><th scope="row">Its natural curl</th><td>${Math.abs(o.plate.kS) > 1e-9 ? `radius ${(1000 / Math.abs(o.plate.kS)).toFixed(0)} mm both ways` : 'none'}${Math.abs(o.plate.kSet) > 1e-9 ? `; the roll's set along the line, radius ${(1000 / Math.abs(o.plate.kSet)).toFixed(0)} mm` : ''}</td></tr><tr><th scope="row">Its weight</th><td>${o.plate.p.toFixed(3)} Pa</td></tr></tbody></table></section>`
      : `<section class="swb-card"><h4>${uiBadge('film')}The film's layers</h4><div class="swb-scroll"><table class="swb-t"><thead><tr><th scope="col">#</th><th scope="col">From (µm)</th><th scope="col">Thick (µm)</th><th scope="col">Water (%)</th><th scope="col">E (GPa)</th><th scope="col">Natural strain</th></tr></thead><tbody>${(() => { let z = 0; return cells.map((L, i) => { const r = `<tr><td>${i + 1}</td><td>${cmUm(z)}</td><td>${cmUm(L.t)}</td><td>${(L.X * 100).toFixed(1)}</td><td>${(L.E / 1e9).toFixed(2)}</td><td>${(L.en * 1e3).toFixed(3)} × 10⁻³</td></tr>`; z += L.t; return r; }).join(''); })()}</tbody></table></div></section>`;
    return `<div class="swb-tables">${card}${lay}</div>`;
  },
  extraMeshes: () => '',
  paneTitles: dim => ({ geometry: dim === 3 ? 'The cut piece' : 'The cut, to scale', mesh: 'The mesh', solve: 'The faces and what holds there' }),
  layout: (dim, o) => ({ parts: [{ k: 'film', t: 'Dried GO film (its layers)', c: CM_C, rects: [] }, { k: 'cut', t: 'The cut', c: '--bad', rects: [] }] }),
  draw: (cv, dim, o, step) => (dim === 3 ? cmDrawPiece(cv, o, step) : cmDraw(cv, dim, o, step)),
  domain: dim => ({ 1: 'a line through the film at the cut, its layers', 2: 'the section across the cut, from its face in', 3: 'the cut piece, a quarter on its mirror lines' }[dim]),
  domainShort: (dim, o) => (dim === 3 ? `${(o.Lx * 1000).toFixed(0)} × ${(o.Ly * 1000).toFixed(0)} mm` : dim === 2 ? `${(cutAxes2(o).L * 1000).toFixed(2)} mm × ${cmUm(cmH(o))} µm` : `${o.layers.length} layers, ${cmUm(cmH(o))} µm`),
  parts: (dim, o) => [{ t: 'Dried GO film', c: CM_C, mat: 'Dried GO film', rec: 'gofilm', size: `${(o.Lx * 1000).toFixed(0)} × ${(o.Ly * 1000).toFixed(0)} mm${dim < 3 ? `, ${cmUm(cmH(o))} µm in ${o.layers.length} layers` : `, ${cmUm(o.plate.h)} µm`}`, how: dim === 3 ? 'a plate: its stiffnesses and natural curl from its layers' : 'each layer its stiffness at its water and its natural strain' },
    { t: 'The cut', c: '--bad', mat: 'a knife along a ruler', rec: null, size: dim === 3 ? 'all four edges' : 'one straight edge', how: 'a free face: the layers\' stress shed' }],
  domainRows: (dim, o) => {
    const run = pmpRunNow();
    return [['Domain', SWB_ADAPT['film:piece'].domain(dim)], ['The film', `${run ? dryFilmName(run.key) : ''}, the water leaving ${o.where === 'both' ? 'from the top and the underside' : 'from the top only'}; as peeled`],
      ['The piece', `${(o.Lx * 1000).toFixed(0)} × ${(o.Ly * 1000).toFixed(0)} mm (the inputs bar: The pieces cut)`], ['The layers\' hold', `${o.Gl} J/m² on each other (the Film card)`], ['Its strength', `${(o.sigF / 1e6).toFixed(0)} MPa`]];
  },
  geoTiles: (dim, o) => (dim === 3 ? [['Piece', `${(o.Lx * 1000).toFixed(0)} × ${(o.Ly * 1000).toFixed(0)}`, 'mm, as cut', 'section'], ['Thickness', `${cmUm(o.plate.h)} µm`, 'the film as peeled', 'film'],
    ['Its curl', Math.abs(o.plate.kS) > 1e-9 ? `R ${(1000 / Math.abs(o.plate.kS)).toFixed(0)} mm` : 'none', 'natural, both ways', 'ratio'], ['Roll\'s set', Math.abs(o.plate.kSet) > 1e-9 ? `R ${(1000 / Math.abs(o.plate.kSet)).toFixed(0)} mm` : 'none', 'along the line', 'period']]
    : [['Film', `${cmUm(cmH(o))} µm`, `${o.layers.length} layers`, 'film'], ['Piece', `${(o.Lx * 1000).toFixed(0)} × ${(o.Ly * 1000).toFixed(0)}`, 'mm, as cut', 'section'], ['Layers\' hold', `${o.Gl} J/m²`, 'on each other', 'cut'], ['Strength', `${(o.sigF / 1e6).toFixed(0)} MPa`, 'in its plane', 'weight']]),
  geoNote: dim => (dim === 3 ? 'The piece as cut, flat before it curls: the Solve step lets it go.' : 'The knife cuts through all the film\'s layers at once; the cut\'s face is free.'),
  meshNote: dim => (dim === 2 ? 'Graded toward the cut; the bands of layers through the film.' : dim === 1 ? 'The film\'s own layers.' : 'A quarter of the piece, its mirror lines at the middle.'),
  physics: (dim, o) => (dim === 3 ? [['Plate (von Kármán)', 'energy ∫ ½ εᵀA ε + ½ (κ − κ̄)ᵀ D (κ − κ̄) + p w;  ε with ½ w,x² …', 'A, D, κ̄ from the film\'s layers (film.js\'s plate); the roll\'s set along the line; its weight p']]
    : dim === 2 ? [['Elasticity (plane strain about the cut)', 'σ = C (ε − ε*),  ∇·σ = 0;  ε_yy = e₀ + κ z (the piece\'s, along the cut)', 'each band: E, ν, its natural strain ε* (the layers\' at the peel)']]
      : [['Laminate (the free piece)', 'σ(z) = Q (e₀ + κ z − ε*(z)),  N = M = 0', 'each layer: Q = E/(1 − ν), its natural strain ε*'], ['Parting at an interface (steady)', 'G = W(the piece) − W(the part below) − W(the part above)', `each part free across the cut, held along it; against the layers' hold ${o.Gl} J/m²`]]),
  coupling: dim => (dim === 3 ? 'none: the plate\'s shape from its stiffness and natural curl, held up and on a table.' : 'the layers\' natural strains (the drying\'s) set the stress; the cut sheds it.'),
  bcCols: ['Mechanics', 'Note'], timeTitle: 'Load', timeCols: ['Load', 'For', 'Conditions', 'Steps'],
  faces: (dim, o) => cmFaces(dim, o).map(f => ({ ...f, bc: f.bc.length > 1 ? f.bc : [f.bc[0], '—'] })),
  time: dim => [['Cut', '—', 'the knife through the film at once; static (no time)', '1']],
  solver: (dim, o, r) => [['Method', dim === 3 ? 'plate FE (BFS), Newton with Levenberg–Marquardt and a line search; the curl raised in steps' : dim === 2 ? 'FE plane strain, quadratic, banded Cholesky' : 'closed form per layer (laminate theory), each part\'s stretch and curl from N = M = 0'],
    ['Checked', dim === 3 ? 'a cylinder exactly; a small piece a spherical cap (sheet.validate.js)' : dim === 2 ? 'far in = the 1D; the cut\'s face carries nothing; uniform layers no stress (cut-mp.validate.js)' : 'Hutchinson–Suo\'s film on a substrate; Timoshenko\'s bimetal; uniform layers nothing (cut-mp.validate.js)'],
    ...(r ? [['Solved in', `${(r.ms / 1000).toFixed(2)} s`]] : [])],
  solveTiles: (dim, o, r) => [['Piece', `${(o.Lx * 1000).toFixed(0)} × ${(o.Ly * 1000).toFixed(0)}`, 'mm', 'section'], ['Layers\' hold', `${o.Gl} J/m²`, 'on each other', 'cut'], ['Solved in', r ? `${(r.ms / 1000).toFixed(2)} s` : '—', r ? 'for the inputs as they are' : 'not solved yet', 'play']],
  tools: (dim, step) => ((step === 'geometry' || step === 'solve' || step === 'results') && typeof dmpWhere === 'function' ? `<div class="seg seg-sm" role="tablist" aria-label="Where the water left the film" id="cmWhere">${[['top', 'Water: top'], ['both', 'Top and underside']].map(([k, t]) => `<button type="button" role="tab" data-cmwhere="${k}" aria-selected="${dmpWhere() === k}">${t}</button>`).join('')}</div>` : ''),
  wire: () => { document.querySelectorAll('[data-cmwhere]').forEach(b => { b.onclick = () => { if (dmpWhere() === b.dataset.cmwhere) return; dmpSetWhere(b.dataset.cmwhere); undoCommit(); render(); }; }); },
  resultsHTML: dim => cmHTML(dim),
  renderResults: dim => cmRender(dim),
  csv: dim => cmCsv(dim),
  openInputs: () => { setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } },
  viewer: true,
  viewNames: dim => (dim === 1 ? { cm1: 'The stress through the film', cm2: 'Parting at each interface', cmCompare: 'How it was solved' }
    : dim === 2 ? { cm1: 'Near the cut', cm2: 'Along the interfaces from the cut', cm3: 'Far in: against the 1D' }
      : { cm1: 'Held up (free)', cm2: 'On a table', cmCompare: 'Against the Cutting page' }),
};

/** The 3D's drawing (Geometry, Mesh, Solve): the piece flat in a view from above and the front, its quarter's mesh. */
function cmDrawPiece(cv, o, what) {
  const r = { W: Array.from({ length: 2 * o.n + 1 }, () => Array(2 * o.n + 1).fill(0)) };
  drawSheet(cv, r, o.Lx * 1000, o.Ly * 1000, 1, what === 'solve', what === 'solve' ? cssVar('--bad') : '#e8590c');
  if (what === 'mesh') {
    const { c, w, h } = { c: cv.getContext('2d'), w: cv.clientWidth, h: cv.clientHeight };
    c.fillStyle = cssVar('--muted'); c.font = '11.5px ' + cssVar('--sans'); c.textAlign = 'left';
    c.fillText(`A quarter: ${o.n} × ${o.n} plate elements (the whole drawn mirrored: ${2 * o.n} × ${2 * o.n}).`, 8, h - 8);
    void w;
  }
}

// ---- the answers ----
function cmHTML(dim) {
  const pane = (id, icon, title, aria, extra = '') => `<figure class="pane mp-pane"><figcaption>${uiBadge(icon)}<span id="${id}T">${title}</span>${extra}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  const chips = '<span class="vp-spacer"></span><span class="seg seg-sm" role="tablist" aria-label="What the map shows" id="cmMap"></span>';
  const panes = dim === 1 ? [pane('cm1', 'cut', 'The stress through the film', 'Each layer\'s stress through the film: free, and as it was on the web'), pane('cm2', 'weight', 'Parting at each interface', 'The energy released if the layers part at each interface from the cut, against their hold')]
    : dim === 2 ? [pane('cm1', 'section', 'Near the cut', 'A map of the stress near the cut on the section', chips), pane('cm2', 'cut', 'Along the interfaces from the cut', 'The peel and the shear between the layers against the distance from the cut'), pane('cm3', 'ratio', 'Far in: against the 1D', 'The stress through the film far from the cut against the 1D\'s laminate theory')]
      : [pane('cm1', 'film', 'Held up (free)', 'The cut piece held up, as it curls free'), pane('cm2', 'film', 'On a table (its weight)', 'The cut piece lying on a table under its weight')];
  return `<section class="mp-sec mp-bench" id="cmSec" aria-label="The cut: its answers"><div class="stats mp-stats" id="cmStats"></div>
    <div class="dry-grid mp-grid mp-grid2">${panes.join('')}</div>${dim === 2 ? '' : '<div class="mp-compare" id="cmCompare"></div>'}</section>`;
}
function cmRender(dim) {
  const sec = document.getElementById('cmSec');
  if (!sec) return;
  if (!sec.dataset.wired) { sec.dataset.wired = '1'; sec.addEventListener('click', e => { const t = e.target.closest && e.target.closest('button'); if (t && t.dataset.cmmap) { CMS.map = t.dataset.cmmap; cmRender(CMS.dim); } }); }
  const o = cmInputs(dim), r = cmCurrent(dim) ? CMS.res[dim] : null, ids = ['cm1', 'cm2', 'cm3'].filter(id => document.getElementById(id));
  if (!o || !r) {
    paneEmptyIds(ids, paneWhy('cm1'));
    for (const id of ids) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; }
    const st = document.getElementById('cmStats');
    if (st) st.innerHTML = cmFailed(dim) ? `<p class="dry-msg">${pill(`The ${dim}D could not be solved: ${dryEsc(CMS.error[dim])}`, 'bad')}</p>` : `<p class="fv-why mp-empty">${CMS.busy ? `Solving the ${dim}D: its answers here when it is done.` : 'Not solved for the inputs as they are.'}</p>`;
    const cmp = document.getElementById('cmCompare'); if (cmp) cmp.innerHTML = '';
    return;
  }
  if (dim === 1) cmRender1(o, r); else if (dim === 2) cmRender2(o, r); else cmRender3(o, r);
}
const cmTile = (l, v, sub, ic, lv) => `<div class="stat${lv ? ' stat-' + lv : ''}" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
function cmRender1(o, r) {
  const H = r.H, F = r.free, sMax = Math.max(...F.at.flatMap(a => [a.s0, a.s1])), sMin = Math.min(...F.at.flatMap(a => [a.s0, a.s1])), g = r.jMax >= 0 ? r.G[r.jMax] : null, ratio = g ? g.G / o.Gl : 0;
  document.getElementById('cmStats').innerHTML = [
    cmTile('Its curl, free', cmCurl(F.kappa), Math.abs(F.kappa) < 1e-3 ? 'its layers alike: it stays flat' : F.kappa > 0 ? 'away from its top (top convex)' : 'toward its top', 'ratio'),
    cmTile('Its size, free', `${(F.e0 * 100).toFixed(3)} %`, 'its middle\'s stretch from as it was on the web', 'section'),
    cmTile('Most pulled', `${cmMPa(sMax)} MPa`, 'a layer in the free piece: the cut sheds it', 'cut', sMax >= o.sigF ? 'bad' : ''),
    cmTile('Most pushed', `${cmMPa(sMin)} MPa`, 'a layer in the free piece', 'cut'),
    cmTile('Parting energy', g && g.G > 1e-9 ? cmJ(g.G) : 'none', g && g.G > 1e-9 ? `most at ${cmUm(g.z)} µm up (interface ${g.j} of ${r.G.length})` : r.G.length ? 'the layers carry no stress to release' : 'one layer: no interface', 'weight', ratio >= 1 ? 'bad' : ratio >= 0.5 ? 'warn' : ''),
    cmTile('Against the hold', g ? `${(ratio * 100).toFixed(ratio < 0.01 ? 3 : 1)} %` : '—', `of ${o.Gl} J/m²: ${ratio >= 1 ? 'the layers part at the cut' : 'they stay together'}`, 'tune', ratio >= 1 ? 'bad' : ''),
  ].join('');
  // the stress through the film: free (the piece), on the web (as dried)
  const cv = document.getElementById('cm1'), lg = document.getElementById('cm1Lg'), run = pmpRunNow();
  const free = F.at.flatMap(a => [[a.s0 / 1e6, a.z0 * 1e6], [a.s1 / 1e6, a.z1 * 1e6]]);
  const S = [{ p: free, c: cssVar('--heat').trim(), w: 2.2, l: 'in the cut piece (free: stretched and curled)' }];
  if (run) { const web = [...run.profile.cells].sort((a, b) => a.z0 - b.z0).flatMap(c => [[c.sig / 1e6, c.z0 * 1e6], [c.sig / 1e6, (c.z0 + c.t) * 1e6]]); S.push({ p: web, c: cssVar('--muted'), w: 1.6, dash: [5, 3], l: 'on the web, as the drying left it' }); }
  const xs = S.flatMap(q => q.p.map(p => p[0])), xt = pmpTicks(Math.min(0, ...xs), Math.max(0, ...xs), 5), yt = pmpTicks(0, H * 1e6, 5);
  plotChart(cv, FILM_ASPECT, { x0: xt[0], x1: xt[xt.length - 1], y0: 0, y1: yt[yt.length - 1], xticks: xt, yticks: yt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'stress in its plane (MPa)', yl: 'height in the film (µm)', vl: [{ x: 0, c: cssVar('--muted'), t: '' }], s: S });
  const alike = Math.max(Math.abs(sMax), Math.abs(sMin)) < 1e3;
  lg.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">${alike ? `Its layers came off the web alike (all ${run ? cmMPa(run.profile.cells[0].sig) : '—'} MPa on it, the water leaving ${o.where === 'both' ? 'both ways' : 'from the top only'}): freed, the piece only grows, flat, and the cut has nothing to shed. ${o.where === 'both' ? '' : 'With the water leaving from the top and the underside (the switch above) its layers differ. '}` : ''}On the web its layers were held at the web's size; peeled and cut free, the piece stretches by ${(F.e0 * 100).toFixed(3)} % and curls so its layers' forces and moments cancel. What is left is what the cut's face must shed: near the cut the layers pull and push on each other.</p>`;
  // the parting energy at each interface
  const cv2 = document.getElementById('cm2'), lg2 = document.getElementById('cm2Lg');
  if (!r.G.length) { paneEmptyIds(['cm2'], 'One layer: no interface.'); lg2.innerHTML = ''; }
  else {
    // (in mJ/m² when it is small beside a joule)
    const gTop = Math.max(...r.G.map(q => q.G)), u = gTop < 0.01 && !(gTop > 0.2 * o.Gl) ? 1e3 : 1;
    const P = r.G.map(q => [q.G * u, q.z * 1e6]), gmax = Math.max(o.Gl * u * (gTop > 0.2 * o.Gl ? 1.05 : 0), gTop * u) || 1e-9;
    const xt2 = pmpTicks(0, gmax, 4);
    plotChart(cv2, FILM_ASPECT, { x0: 0, x1: xt2[xt2.length - 1], y0: 0, y1: yt[yt.length - 1], xticks: xt2, yticks: yt, xf: v => String(+v.toPrecision(3)), yf: v => String(+v.toPrecision(4)), xl: `energy released, parting (${u > 1 ? 'mJ' : 'J'}/m²)`, yl: 'height in the film (µm)',
      ...(gmax >= o.Gl * u ? { vl: [{ x: o.Gl * u, c: cssVar('--bad'), t: `their hold (${o.Gl} J/m²)` }] } : {}), s: [{ p: P, c: '#1c7ed6', w: 2, dots: true }] });
    lg2.innerHTML = `<p class="fv-why">If the layers part at an interface from the cut inward, each part relaxes across the cut (held along it, as the piece is): the energy that frees, per area. Past their hold on each other (${o.Gl} J/m², the Film card) they part at the cut${gmax < o.Gl ? `; here it is ${(o.Gl / Math.max(1e-30, Math.max(...r.G.map(q => q.G)))).toFixed(0)} times short of it` : ''}.</p>`;
  }
  const el = document.getElementById('cmCompare');
  el.innerHTML = `<h4 class="mp-h">How it was solved</h4><table class="mp-cmp"><tbody><tr><th scope="row">Free piece</th><td>laminate theory both ways in its plane: e₀ ${(F.e0 * 1e3).toFixed(4)} × 10⁻³, κ ${F.kappa.toFixed(3)} 1/m</td></tr><tr><th scope="row">Checks</th><td>Hutchinson and Suo's film on a substrate (0.04 %), Timoshenko's bimetal (exact), uniform layers nothing (cut-mp.validate.js)</td></tr></tbody></table>`;
}
function cmRender2(o, r) {
  const H = r.mesh.H, far = r.far, sFar = Math.max(...far.map(q => Math.abs(q.sxx)));
  document.getElementById('cmStats').innerHTML = [
    cmTile('Peel between layers', `${cmMPa(r.peel.v)} MPa`, `a quarter of the film (${cmUm(r.peel.x)} µm) in from the cut, at ${cmUm(r.peel.z)} µm up; + opens`, 'weight'),
    cmTile('Shear between layers', `${cmMPa(r.shear.v)} MPa`, `the same distance in, at ${cmUm(r.shear.z)} µm up`, 'cut'),
    cmTile('Far in, most', `${cmMPa(sFar)} MPa`, 'σ_xx in a layer: the 1D\'s', 'section'),
    cmTile('The cut\'s face', `${(Math.abs(r.edgeN / Math.max(1e-30, r.farN)) * 100).toFixed(3)} %`, 'its force over the far end\'s: free', 'tune'),
    cmTile('Strength', `${(o.sigF / 1e6).toFixed(0)} MPa`, 'in its plane (the Film card)', 'weight'),
  ].join('');
  // the map near the cut (x to 4 H), the stress chosen
  const maps = [['szz', 'Peel σ_zz'], ['sxz', 'Shear σ_xz'], ['sxx', 'Across σ_xx'], ['syy', 'Along σ_yy']];
  if (!maps.some(q => q[0] === CMS.map)) CMS.map = 'szz';
  document.getElementById('cmMap').innerHTML = maps.map(([k, t]) => `<button type="button" role="tab" data-cmmap="${k}" aria-selected="${k === CMS.map}">${t}</button>`).join('');
  const cv = document.getElementById('cm1'), lg = document.getElementById('cm1Lg'), xs = r.mesh.coord[0], zs = r.mesh.coord[1], nn = r.mesh.nn, vals = r[CMS.map];
  const Xmax = Math.min(xs[xs.length - 1], 4 * H), ix = xs.findIndex(x => x >= Xmax);
  const node = (i, k) => cmNode(nn, i, k);
  let mx = 1e-9; for (let i = 0; i <= ix; i++) for (let k = 0; k < zs.length; k++) mx = Math.max(mx, Math.abs(vals[node(i, k)]));
  const lut = getLut('div'), sc = { min: -mx / 1e6, max: mx / 1e6, levels: 0 };
  const { c, w, h } = setupCanvas(cv, 0.42), m = { l: 56, r: 16, t: 16, b: 34 }, pw = w - m.l - m.r, ph = h - m.t - m.b, X = x => m.l + x / Xmax * pw, Z = z => m.t + ph - z / H * ph;
  c.clearRect(0, 0, w, h);
  for (let i = 0; i < ix; i++) for (let k = 0; k < zs.length - 1; k++) {
    const v = (vals[node(i, k)] + vals[node(i + 1, k)] + vals[node(i, k + 1)] + vals[node(i + 1, k + 1)]) / 4 / 1e6;
    c.fillStyle = lutColor(lut, scaleT(sc, v)); c.fillRect(Math.floor(X(xs[i])), Math.floor(Z(zs[k + 1])), Math.ceil(X(xs[i + 1]) - X(xs[i])) + 1, Math.ceil(Z(zs[k]) - Z(zs[k + 1])) + 1);
  }
  c.strokeStyle = cssVar('--bad'); c.lineWidth = 2.4; c.beginPath(); c.moveTo(X(0), Z(0)); c.lineTo(X(0), Z(H)); c.stroke();
  c.strokeStyle = cssVar('--line'); c.lineWidth = 1; c.strokeRect(m.l, m.t, pw, ph);
  c.font = '12px ' + cssVar('--mono'); c.fillStyle = cssVar('--muted'); c.textAlign = 'center';
  for (const v of niceTicks(0, Xmax * 1e6, 5)) c.fillText(fmtNum(v), X(v / 1e6), h - m.b + 18);
  c.textAlign = 'right'; c.fillText(`${cmUm(H)}`, m.l - 6, m.t + 8); c.fillText('0', m.l - 6, m.t + ph + 4); c.fillText('in from the cut (µm)', w - m.r, h - 2); c.textAlign = 'left'; c.fillText('up through the film (µm, stretched)', m.l, m.t - 4);
  lg.innerHTML = cmBar(lut, sc, 'MPa', v => cmMPa(v * 1e6)) + `<p class="fv-why">The cut (red) at the left; ${(Xmax * 1e6).toFixed(0)} µm in, the film's ${cmUm(H)} µm drawn tall. ${{ szz: 'The peel: + pulls the layers apart, − presses them.', sxz: 'The shear between the layers: it carries the stress the cut sheds into the layers below and above.', sxx: 'Across the cut: none at its face, the free piece\'s far in.', syy: 'Along the cut: the piece\'s own all the way to the cut.' }[CMS.map]}</p>`;
  // along the interfaces
  const cv2 = document.getElementById('cm2'), lg2 = document.getElementById('cm2Lg'), f = r.ifaces[r.peel.i >= 0 ? r.peel.i : 0];
  if (!f) { paneEmptyIds(['cm2'], 'One band of layers: no interface between bands.'); lg2.innerHTML = ''; }
  else {
    const lim = xs.findIndex(x => x >= 4 * H), xx = xs.slice(0, lim + 1).map(x => x * 1e6);
    const S = [{ p: xx.map((x, i) => [x, f.szz[i] / 1e6]), c: '#c2255c', w: 2, l: 'peel σ_zz' }, { p: xx.map((x, i) => [x, f.sxz[i] / 1e6]), c: '#1c7ed6', w: 2, dash: [5, 3], l: 'shear σ_xz' }];
    const ys = S.flatMap(q => q.p.map(p => p[1])), yt = pmpTicks(Math.min(0, ...ys), Math.max(0, ...ys), 5), xt = pmpTicks(0, xx[xx.length - 1], 5);
    plotChart(cv2, FILM_ASPECT, { x0: 0, x1: xt[xt.length - 1], y0: yt[0], y1: yt[yt.length - 1], xticks: xt, yticks: yt, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(3)), xl: 'in from the cut (µm)', yl: 'stress between the layers (MPa)', hl: [{ y: 0, c: cssVar('--muted'), t: '' }], vl: [{ x: r.peel.x * 1e6, c: cssVar('--muted'), t: 'H/4' }], s: S });
    lg2.innerHTML = oneDLegend(S.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">At ${cmUm(f.z)} µm up (the interface with the most peel). Right at the cut's corner they rise without bound where the layers' stiffness differs (a free edge's singularity): the measure is taken a quarter of the film in, where it settles as the mesh is refined.</p>`;
  }
  // far in against the 1D
  const cv3 = document.getElementById('cm3'), lg3 = document.getElementById('cm3Lg'), Fr = r.free;
  const one = Fr.at.flatMap(a => [[a.s0 / 1e6, a.z0 * 1e6], [a.s1 / 1e6, a.z1 * 1e6]]);
  // (each band's own: the 2D averages the layers of a band)
  const S3 = [{ p: one, c: cssVar('--muted'), w: 1.6, dash: [5, 3], l: 'the 1D (each layer)' }, { p: far.map(q => [q.sxx / 1e6, q.z * 1e6]), c: cssVar('--heat').trim(), w: 2, l: 'this 2D, far in' }];
  const xs3 = S3.flatMap(q => q.p.map(p => p[0])), xt3 = pmpTicks(Math.min(0, ...xs3), Math.max(0, ...xs3), 5), yt3 = pmpTicks(0, H * 1e6, 5);
  plotChart(cv3, FILM_ASPECT, { x0: xt3[0], x1: xt3[xt3.length - 1], y0: 0, y1: yt3[yt3.length - 1], xticks: xt3, yticks: yt3, xf: v => String(+v.toPrecision(4)), yf: v => String(+v.toPrecision(4)), xl: 'σ_xx (MPa)', yl: 'height in the film (µm)', s: S3 });
  lg3.innerHTML = oneDLegend(S3.map(q => [q.l, q.c, q.dash ? 'dash' : ''])) + `<p class="fv-why">Far from the cut the section is the free piece: the 1D's laminate theory${r.mesh.bands < o.layers.length ? ` (here the ${o.layers.length} layers in ${r.mesh.bands} bands, each its layers' mean: more bands on the Mesh step follow the 1D closer)` : ''}.</p>`;
  const cmp = document.getElementById('cmCompare'); if (cmp) cmp.innerHTML = '';   // (the 2D's own check: far in, against the 1D)
}
function cmRender3(o, r) {
  const fr = r.free, tb = r.table, L = o.Lx * 1000, Wd = o.Ly * 1000, sgn = o.plate.kS + o.plate.kSet > 0 ? -1 : 1, col = '#e8590c';
  document.getElementById('cmStats').innerHTML = [
    cmTile('Held up', sheetShapeText(fr).split(':')[0], `corners ${cmMm(fr.corner)} off its middle`, 'film'),
    cmTile('On a table', sheetShapeText(tb).split(':')[0], `corners ${cmMm(tb.corner)} off the table`, 'film', tb.corner > 0.005 ? 'warn' : ''),
    cmTile('Ends lift', cmMm(tb.edgeX), 'on the table, the middles of its ends', 'section'),
    cmTile('Sides lift', cmMm(tb.edgeY), 'on the table, the middles of its sides', 'section'),
    cmTile('Its curl', cmCurl(fr.kxMid), 'at its middle, along the line, held up', 'ratio'),
  ].join('');
  drawSheet(document.getElementById('cm1'), fr, L, Wd, sgn, false, col);
  drawSheet(document.getElementById('cm2'), tb, L, Wd, 1, true, col);
  const words = (q, table) => `${sheetShapeText(q)}; its corners ${cmMm(q.corner)} ${table ? 'off the table' : 'off its middle'}, the middles of its ends ${cmMm(q.edgeX)}, of its sides ${cmMm(q.edgeY)}`;
  document.getElementById('cm1Lg').innerHTML = `<p class="fv-why">${words(fr, false)}.</p>`;
  document.getElementById('cm2Lg').innerHTML = `<p class="fv-why">${words(tb, true)}.</p>`;
  document.getElementById('cmCompare').innerHTML = `<h4 class="mp-h">Against the Cutting page</h4><table class="mp-cmp"><tbody><tr><th scope="row">Model</th><td>the same plate model as the stage's Results (the piece in 3D, sheet.js)</td></tr><tr><th scope="row">Mesh</th><td>its own: ${o.n} × ${o.n} a quarter; the Results page ${8} × ${8}</td></tr>${[fr, tb].some(q => q.maxSlope > 0.35) ? '<tr><th scope="row">Slopes</th><td>it curls steeply: this model is for moderate slopes</td></tr>' : ''}</tbody></table>`;
}
function cmCsv(dim) {
  const r = cmCurrent(dim) ? CMS.res[dim] : null;
  if (!r) return;
  const rows = [];
  if (dim === 1) {
    rows.push(['layer from (µm)', 'to (µm)', 'stress at its bottom (MPa)', 'at its top (MPa)']); r.free.at.forEach(a => rows.push([a.z0 * 1e6, a.z1 * 1e6, a.s0 / 1e6, a.s1 / 1e6]));
    rows.push([]); rows.push(['interface height (µm)', 'parting energy (J/m²)']); r.G.forEach(g => rows.push([g.z * 1e6, g.G]));
  } else if (dim === 2) {
    const xs = r.mesh.coord[0], zs = r.mesh.coord[1], nn = r.mesh.nn;
    rows.push(['x in from the cut (µm)', 'z (µm)', 'σ_xx (MPa)', 'σ_zz (MPa)', 'σ_xz (MPa)', 'σ_yy (MPa)']);
    for (let k = 0; k < zs.length; k++) for (let i = 0; i < xs.length; i++) { const n = cmNode(nn, i, k); rows.push([xs[i] * 1e6, zs[k] * 1e6, r.sxx[n] / 1e6, r.szz[n] / 1e6, r.sxz[n] / 1e6, r.syy[n] / 1e6]); }
  } else {
    for (const [k, q] of [['held up', r.free], ['on a table', r.table]]) { rows.push([`${k}: heights (mm) on the (2n+1)² grid, rows across, columns along`]); q.W.forEach(row => rows.push(row)); rows.push([]); }
  }
  downloadCSV(`cut-${dim}D-${csvStamp()}.csv`, rows);
}
