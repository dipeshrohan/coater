/*
 * cfd-ui.js — the "CFD Analysis" tab.
 *
 * Runs the 2D solve -- the flow under the blade (round entry onto the
 * metering edge, or the flat land), over the blade's exit face and into
 * the free film, with the meniscus solved together with the flow -- at
 * four lateral locations (one Web Worker each, cfd-worker.js), stores
 * each solved field, and shows it as a CFD
 * post-processing view (cfd-plot.js) with flow-tracking overlays computed
 * from the stored velocity field (cfd-flowviz.js). Only the Run buttons
 * solve; every display control (field, streamlines, seeds, vectors,
 * location, comparison) re-draws from what's already stored.
 *
 * Depends on physics.js (P, RHO, GRAVITY, gapHeight, muEff, spatialNoise,
 * filmThickness), draw.js (plotChart, cssVar, pill), cfd-flowviz.js and
 * cfd-plot.js, all loaded first.
 */

// Blade geometry for the CFD domain (this tab's own inputs; changing them
// marks results out of date, like the sidebar sliders do).
//  shape 'round': round entry of radius R (mm) converging onto the metering
//    edge, which is its lowest point; the domain starts at the pool edge,
//    `pool` mm upstream, where the bead pressure acts.
//  shape 'flat': the flat land of the sidebar's land length (the lubrication
//    model's geometry).
//  exitAngle: the blade's exit face at the metering edge, degrees from the
//    web in the machine direction (90 = square to the web). The meniscus
//    meets it; its contact angle there is the sidebar's contact angle on the
//    blade, varied across the web as the Contact line tab does.
//  Fibre (the woven web), picked from its test report (fibre: FIBRES key; the
//    report's values fill the inputs below and the sidebar's fibre thickness):
//    gsm basis weight (g/m^2), rhoF fibre density (kg/m^3) -> porosity; the
//    filament diameter from the yarn (dFrom 'yarn': den denier, nf filaments
//    per yarn) or, not given, from the air permeability (dFrom 'air': the
//    Kozeny-Carman diameter that reproduces it); kozeny the Kozeny constant;
//    airPerm the air permeability (1e-3 m^3/m^2/s) at airDP Pa (0 = test
//    pressure not stated). Its pores are dry (air): the slurry rests on the
//    top filaments and slips over the air between them; airFrac is the air
//    fraction of that top surface.
//  Drying air in the oven, blown up into the fibre from a plenum below: airU
//    its superficial speed (m/s), airT its temperature (C), plenum its length
//    in the machine direction (mm). The wet film seals the fibre's top, so the
//    air can only leave along the fibre: the pressure that speed needs follows.
//  model: the slurry's rheology model for the CFD runs (which of the sidebar's
//    rheology inputs apply): Newtonian, power law, or Herschel-Bulkley.
// The fibres' test reports. tf thickness (mm, sets the sidebar's), tUse / tMom continuous / momentary use temperature (C).
const FIBRES = {
  thin: {
    l: 'Thin PET (130)', tf: 0.20, tUse: 130, tMom: null,
    set: { gsm: 138, rhoF: 1380, dFrom: 'yarn', den: 150, nf: 48, airPerm: 25, airDP: 0, kozeny: 5, airFrac: 0.5 },
    note: 'report 2018-01-29: polyester filament, 150D×2 plain weave, 0.20 mm, 138 g/m², 25.9 / 22 threads/cm, air permeability 20–30 ×10⁻³ m³/m²·s (test pressure not stated), below 130 °C continuous. Filaments per yarn (48; not in the report), PET density and the top-surface air fraction (= porosity) assumed.',
  },
  thick: {
    l: 'Thick PP (RX001)', tf: 0.90, tUse: 90, tMom: 110,
    set: { gsm: 600, rhoF: 905, dFrom: 'air', den: 0, nf: 0, airPerm: 125, airDP: 127, kozeny: 5, airFrac: 0.26 },
    note: 'report 2026-03-20: polypropylene, heat set, 0.90 mm, 600 g/m², 55 / 19.5 threads/cm, air flow 1 L/s through 80 cm² at 127 Pa (= 125 ×10⁻³ m³/m²·s), 90 °C continuous, 110 °C momentary. Filament size not in the report: inferred from the air permeability. PP density (905, literature 900–910) and the top-surface air fraction (= porosity) assumed.',
  },
};
const CFDG = { shape: 'round', R: 100, pool: 40, exitAngle: 90, model: 'hb', fibre: 'thin', ...FIBRES.thin.set, airU: 1, airT: 100, plenum: 100 };
const RHEO_MODELS = {
  newtonian: { l: 'Newtonian', uses: [], law: 'μ = the viscosity at 2.7 1/s; n and yield stress not used' },
  power: { l: 'Power law', uses: ['n'], law: 'μ = μ(2.7 1/s) · (γ̇ / 2.7)^(n−1); yield stress not used' },
  hb: { l: 'Herschel–Bulkley', uses: ['n', 'ty'], law: 'μ = τy / γ̇ + K (γ̇ / 2.7)^(n−1), K such that μ(2.7 1/s) is the viscosity input' },
};

/** Permeability (m^2) from the air-permeability test: Darcy across the thickness t (m), air at 20 C, test pressure dp (Pa). */
const airTestK = (t, dp) => CFDG.airPerm * 1e-3 * airProps(20).mu * t / dp;
/**
 * Fibre structure from its test-report data: thickness t (m, the sidebar's), porosity
 * eps = 1 - basis weight / (fibre density x t), filament diameter d (m) -- from the yarn's
 * denier (g per 9000 m) shared by its filaments, or the Kozeny-Carman diameter that gives
 * the measured air permeability, d = sqrt(16 K (1 - eps)^2 k / eps^3); ok = a porosity
 * that makes sense and a diameter.
 */
function fibreStructure() {
  const t = P.tf / 1000, eps = 1 - CFDG.gsm / 1000 / (CFDG.rhoF * t);
  const d = CFDG.dFrom === 'air'
    ? (CFDG.airDP > 0 ? Math.sqrt(16 * CFDG.kozeny * (1 - eps) ** 2 * airTestK(t, CFDG.airDP) / eps ** 3) : NaN)
    : Math.sqrt(4 * (CFDG.den / CFDG.nf) / 9e6 / (Math.PI * CFDG.rhoF));
  return { t, eps, d, ok: eps > 0.05 && eps < 0.98 && d > 0 };
}
/** Has the fibre been changed from its report's values? */
const fibreEdited = () => { const f = FIBRES[CFDG.fibre]; return Math.abs(P.tf - f.tf) > 1e-9 || Object.entries(f.set).some(([k, v]) => CFDG[k] !== v); };
/** Where the fibre inputs come from (updated as they change). */
const fibreNote = () => `${FIBRES[CFDG.fibre].l}, ${FIBRES[CFDG.fibre].note} Thickness: the sidebar's fibre thickness. Test pressure 0 = not stated.${fibreEdited() ? ' <span class="warn-text">Edited from the report.</span>' : ''}`;
/** Pick a fibre: its report's values into the inputs, and its thickness into the sidebar (as loading a case does, so every tab updates). */
function selectFibre(key) {
  const f = FIBRES[key];
  CFDG.fibre = key; Object.assign(CFDG, f.set);
  const sl = document.getElementById('s_tf');
  if (sl) { sl.value = f.tf; sl.dispatchEvent(new Event('input')); } else P.tf = f.tf;
}
/** Fibre permeability (m^2), Kozeny-Carman for a bed of fibres: k = d^2 eps^3 / (16 K (1 - eps)^2). */
function fibrePermeability() {
  const { eps, d, ok } = fibreStructure();
  return ok ? d * d * eps ** 3 / (16 * CFDG.kozeny * (1 - eps) ** 2) : NaN;
}
/**
 * Slip over the dry fibre: the slurry rests on the top filaments and bridges the air
 * between them -- no-slip stripes (filaments) and shear-free ones (air, fraction airFrac)
 * of period d / (1 - airFrac). Slip length along the stripes (Philip 1972)
 * b = (period / pi) ln sec(pi airFrac / 2), across them half that; a plain weave shows
 * warp and weft crowns equally, so the flow sees their mean.
 */
function fibreSlip() {
  const { d } = fibreStructure(), a = CFDG.airFrac, period = d / (1 - a);
  const along = period / Math.PI * Math.log(1 / Math.cos(Math.PI * a / 2)), across = along / 2;
  return { period, along, across, b: (along + across) / 2 };
}
/**
 * Drying air blown up into the fibre at speed ua over a plenum of length Lp, the wet film
 * sealing the top: it can only flow along the fibre (thickness t) to the plenum's edges.
 * Taking it out right at those edges (the shortest path it could have; ambient pressure
 * p0 there), Darcy along the thin layer with the air's density rising with pressure
 * (isothermal): p dp/dx = -mu p0 ua x / (k t), so at the plenum's centre
 * p^2 = p0^2 + 2 p0 dpInc, dpInc = mu ua Lp^2 / (8 k t) (the same without compression).
 * Also the speed along the fibre where it leaves, ua Lp / (2 t), and its pore Reynolds
 * number there (well above 1: inertial losses add to Darcy's, so the pressure is a least value).
 */
function ovenAir() {
  const st = fibreStructure(), k = fibrePermeability(), air = airProps(CFDG.airT), ua = CFDG.airU, Lp = CFDG.plenum / 1000, p0 = 101325;
  const dpInc = air.mu * ua * Lp * Lp / (8 * k * st.t), pc = Math.sqrt(p0 * p0 + 2 * p0 * dpInc);
  const uEdge = ua * Lp / (2 * st.t);
  return { air, dpInc, dp: pc - p0, uEdge, ReEdge: air.rho * (uEdge / st.eps) * st.d / air.mu };
}
/** Air viscosity (Sutherland's law) and density (ideal gas at 1 atm) at T degC. */
function airProps(Tc) {
  const T = Tc + 273.15;
  return { mu: 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4), rho: 101325 / (287.05 * T) };
}
const CFD_WEB_WIDTH_MM = 300; // the across-web axis the Contact line tab already uses
// Each location reads its own inputs (over) first, falling back to the shared values: the
// sidebar's, and for the gap and the contact angle the across-web variation at its z.
const CFD_LOCS = [37.5, 112.5, 187.5, 262.5].map((z, i) => ({ id: i + 1, z, over: {} }));
// Inputs a location can set for itself, in the sidebar's units.
const LOC_INPUTS = [
  { k: 'gap', l: 'Gap at edge', u: 'mm', step: 0.001, d: 3 },
  { k: 'th', l: 'Contact angle', u: '°', step: 0.5, d: 1 },
  { k: 'U', l: 'Web speed', u: 'm/min', step: 0.01, d: 2 },
  { k: 'Pup', l: 'Bead pressure', u: 'kPa', step: 0.02, d: 2 },
  { k: 'mu', l: 'Viscosity at 2.7 1/s', u: 'Pa·s', step: 0.5, d: 1 },
  { k: 'n', l: 'Shear-thinning n', u: '', step: 0.05, d: 2 },
  { k: 'ty', l: 'Yield stress', u: 'Pa', step: 0.5, d: 1 },
  { k: 'g', l: 'Surface tension', u: 'N/m', step: 0.005, d: 3 },
];
/** A location's shared (not overridden) value of an input. */
function locShared(i, k) {
  const z = CFD_LOCS[i].z;
  if (k === 'gap') return cfdLocalGapMm(z);
  if (k === 'th') return cfdLocalContactDeg(z);
  return P[k];
}
/** A location's effective value of an input: its own if set, else the shared one. */
const locInput = (i, k) => CFD_LOCS[i].over[k] ?? locShared(i, k);
/** The rheology law (as physics.js muEff) for given parameters. */
function muLaw(gd, muRef, ty, n) {
  gd = Math.max(gd, 1e-6);
  const base = Math.max(muRef - ty / 2.7, 0.05 * muRef);
  return ty / gd + base * Math.pow(gd / 2.7, n - 1);
}
const cfdRuns = CFD_LOCS.map(() => ({ status: 'idle' }));
let cfdEditLoc = null; // location whose own inputs are open for editing
// Named probes: points (m) shared by all locations, kept in local storage; placeProbes = clicks on a plot add one
const PROBES_KEY = 'bladeCoatDefectLab.cfdProbes.v1';
let cfdProbes = (() => { try { const a = JSON.parse(localStorage.getItem(PROBES_KEY) || '[]'); return Array.isArray(a) ? a.filter(q => q && typeof q.name === 'string' && Number.isFinite(q.x) && Number.isFinite(q.y)) : []; } catch (e) { return []; } })();
let placeProbes = false;
function saveProbes() { try { localStorage.setItem(PROBES_KEY, JSON.stringify(cfdProbes)); } catch (e) { /* storage blocked: probes live for this session only */ } }
function addProbe(x, y, name) {
  let n = cfdProbes.length + 1;
  while (cfdProbes.some(q => q.name === 'P' + n)) n++;
  cfdProbes.push({ name: (name || '').trim() || 'P' + n, x, y });
  saveProbes();
}
const cfdWorkers = CFD_LOCS.map(() => null);
let cfdAutoStarted = false;

// Flow-visualization settings. Display-only: none of these re-run CFD.
const FV = {
  view: 0,                // 0..3 = one location, 'compare' = all four
  profileLoc: 0,
  base: 'speed',
  streamlines: true, density: 'medium', customN: 24, seedMode: 'auto', direction: 'forward',
  lineColor: 'none', arrows: true, lineWidth: 'normal',
  vectors: false, vectorDensity: 'medium', vectorScale: 1, vectorNormalize: false, vectorColor: false,
  yScale: 'exaggerated', settingsOpen: false,
  manualSeeds: [],        // [x, y] in metres, shared by all locations so comparisons are like for like
  across: 'film',         // quantity plotted against position across the web
  convOpen: false,        // convergence: solve-sequence table expanded
  tree: { geo: true, rheo: true, fibre: false, air: false, locs: true },   // model tree: CFD groups open
  dock: 'metrics',        // results panel shown
  dockH: 300,             // results panel height (px)
};
const DENSITY_N = { low: 8, medium: 16, high: 32 };
const VEC_SPACING = { low: 64, medium: 44, high: 30 };
const LINE_W = { thin: 1, normal: 1.4, thick: 2.2 };

const SCALARS = {
  speed: { label: 'Velocity magnitude |V|', short: '|V|', unit: 'mm/s', scale: 1000, kind: 'seq', zeroMin: true, arr: f => f.speed },
  pressure: { label: 'Pressure (gauge, ambient air = 0)', short: 'p', unit: 'Pa', scale: 1, kind: 'auto', autoTol: 0.02, skipCorner: true, arr: f => f.p },
  ux: { label: 'u_x, machine direction', short: 'u_x', unit: 'mm/s', scale: 1000, kind: 'auto', arr: f => f.u },
  uy: { label: 'u_y, normal to the web', short: 'u_y', unit: 'mm/s', scale: 1000, kind: 'div', floorFrac: 0.01, arr: f => f.v },
  shear: { label: 'Shear rate', short: 'shear', unit: '1/s', scale: 1, kind: 'seq', zeroMin: true, skipCorner: true, arr: f => f.shear },
  mu: { label: 'Apparent viscosity', short: 'μ', unit: 'Pa·s', scale: 1, kind: 'seq', cap: true, arr: f => f.mu },
  omega: { label: 'Vorticity', short: 'ω', unit: '1/s', scale: 1, kind: 'div', skipCorner: true, arr: f => f.omega },
  strain1: { label: 'Principal strain rate, stretching', short: 'λ₁', unit: '1/s', scale: 1, kind: 'seq', zeroMin: true, skipCorner: true, arr: f => f.strain1 },
  dissip: { label: 'Viscous dissipation μγ̇²', short: 'Φ', unit: 'kW/m³', scale: 1e-3, kind: 'seq', zeroMin: true, skipCorner: true, arr: f => f.dissipation },
};
// Line colouring by each streamline's own travel time (not a field)
const TIME_SCALAR = { key: 'time', label: 'Time along the line', short: 't', unit: 's', scale: 1, kind: 'seq', perLine: true, capped: false };
// skipCorner: the colour range leaves out the metering edge corner's singular zone (values there are clamped, and the colorbar says so)

// ---------------------------------------------------------------------
// Locations and solving
// ---------------------------------------------------------------------

/** Local gap (mm) at lateral position z (mm): the same across-web waviness and fibre-thickness variation the Contact line tab and the animation already use. */
function cfdLocalGapMm(z) {
  return gapHeight() + (P.dH * Math.sin(2 * Math.PI * z / P.lw) - P.dt * spatialNoise(z, 1.7)) / 1000;
}

/** Local contact angle on the blade (deg) at lateral position z (mm): the sidebar's value with its wetting variation, as the Contact line tab uses it. */
const cfdLocalContactDeg = z => P.th + P.dth * spatialNoise(z, 4.1);

function cfdGeometry(i) {
  const z = CFD_LOCS[i].z, v = k => locInput(i, k), uses = RHEO_MODELS[CFDG.model].uses;
  const U = v('U') / 60;                    // m/min -> m/s
  const H = v('gap') / 1000;                // mm -> m, gap at the metering edge
  const ty = uses.includes('ty') ? v('ty') : 0, n = uses.includes('n') ? v('n') : 1; // the model's parameters
  return {
    z, shape: CFDG.shape, U, H, L: P.L / 1000, R: CFDG.R / 1000, Xup: Math.min(CFDG.pool, 0.8 * CFDG.R) / 1000, exitAngle: CFDG.exitAngle,
    contactDeg: v('th'), webSlip: 1 / fibreSlip().b,
    Pup: v('Pup') * 1000,                   // kPa -> Pa, applied at the inlet (pool edge / start of the land)
    muRef: v('mu'),                         // the rheology law's reference (viscosity at 2.7 1/s, as the slider defines it)
    muRep: muLaw(U / H, v('mu'), ty, n),    // at the representative shear rate U/H: one-viscosity estimates only
    model: CFDG.model, ty, n, rho: RHO, gamma: v('g'), g: GRAVITY, ovenDistance: P.oven,
    own: Object.keys(CFD_LOCS[i].over), ownVals: { ...CFD_LOCS[i].over },
  };
}
const cfdInputsKey = geo => JSON.stringify([geo.model, geo.shape, geo.U, geo.H, geo.shape === 'round' ? [geo.R, geo.Xup] : geo.L, geo.exitAngle, geo.contactDeg, geo.webSlip, geo.Pup, geo.muRef, geo.ty, geo.n, geo.gamma, geo.ovenDistance]);
const cfdIsStale = i => cfdRuns[i].field && cfdRuns[i].key !== cfdInputsKey(cfdGeometry(i));

// ---- solver messages: what each run did, in order (the Messages tab) ----
const cfdLog = [];
function logCFD(i, text, kind = '') {
  cfdLog.push({ t: new Date(), i, text, kind });
  if (cfdLog.length > 500) cfdLog.splice(0, cfdLog.length - 500);
  renderMessages();
  renderDockCounts();
}

function runLocation(i) {
  const run = cfdRuns[i];
  if (run.status === 'running') return;
  const geo = cfdGeometry(i);
  const worker = new Worker('cfd-worker.js');
  cfdWorkers[i] = worker;
  const t0 = performance.now();
  run.status = 'running'; run.error = null; run.progress = null;
  let lastStage = null;
  logCFD(i, `run started: ${geo.shape === 'round' ? `round entry R ${(geo.R * 1000).toFixed(0)} mm` : 'flat land'}, gap ${(geo.H * 1000).toFixed(3)} mm, web ${(geo.U * 60).toFixed(2)} m/min, ${RHEO_MODELS[geo.model].l}, contact angle ${geo.contactDeg.toFixed(1)}°`);
  const finish = () => { worker.terminate(); if (cfdWorkers[i] === worker) cfdWorkers[i] = null; };
  worker.onmessage = e => {
    if (e.data.progress) {
      run.progress = e.data.progress;
      if (run.progress.stage && run.progress.stage !== lastStage) { lastStage = run.progress.stage; logCFD(i, lastStage); }
      updateLocStates(); renderRunChips(); updateBusy();
      return;
    }
    finish();
    const ms = performance.now() - t0;
    const r = e.data.ok ? e.data.result : null;
    if (!r) { run.status = 'error'; run.error = e.data.error; }
    else if (!r.converged && !(r.stalled && r.residual < 1e-4)) {
      // a non-converged field is not a valid physical result: keep nothing from it
      run.status = 'error'; run.error = `did not converge (residual ${r.residual.toExponential(1)} after ${r.iterations} steps)`;
    } else {
      Object.assign(run, {
        status: 'done', result: r, geo, key: cfdInputsKey(geo), elapsedMs: ms,
        field: makeFlowField(r, { rho: geo.rho, ty: geo.ty }), streamCache: new Map(),
      });
      run.metrics = flowMetrics(run.field);
    }
    if (run.status === 'done') {
      const tr = r.trace;
      logCFD(i, `solved in ${(ms / 1000).toFixed(1)} s: wet film ${(r.Q / geo.U * 1000).toFixed(3)} mm, contact line ${r.mode === 'climbed' ? `${(r.sCL * 1000).toFixed(3)} mm up the exit face` : 'pinned at the edge'}, residual ${r.residual.toExponential(1)}${tr ? `, ${tr.solves.length} solves / ${tr.r.length} Newton iterates` : ''}${r.converged ? '' : ' (partly converged)'}`, r.converged ? 'ok' : 'warn');
    } else logCFD(i, `failed: ${run.error}`, 'bad');
    renderRunChips();
    renderCFD();
  };
  worker.onerror = e => { finish(); run.status = 'error'; run.error = e.message || 'worker error'; logCFD(i, `failed: ${run.error}`, 'bad'); renderRunChips(); renderCFD(); };
  worker.postMessage({
    geometry: geo.shape, H: geo.H, L: geo.L, R: geo.R, Xup: geo.Xup, exitAngle: geo.exitAngle, contactDeg: geo.contactDeg, webSlip: geo.webSlip,
    U: geo.U, Pup: geo.Pup, rho: geo.rho, muRef: geo.muRef, ty: geo.ty, n: geo.n, muRep: geo.muRep,
    gamma: geo.gamma, g: geo.g, ovenDistance: geo.ovenDistance,
  });
  renderRunChips();
  renderCFD();
}

function runAllLocations() { CFD_LOCS.forEach((_, i) => runLocation(i)); }

function cancelAllLocations() {
  cfdWorkers.forEach((w, i) => {
    if (!w) return;
    w.terminate(); cfdWorkers[i] = null;
    cfdRuns[i].status = 'cancelled'; // any earlier result for this location is kept (and flagged if out of date)
    logCFD(i, 'stopped', 'warn');
  });
  renderRunChips();
  renderCFD();
}

// ---------------------------------------------------------------------
// Post-processing (cached per stored field; never re-solves)
// ---------------------------------------------------------------------

function scalarRange(key, fields) {
  const d = SCALARS[key];
  let min = Infinity, max = -Infinity, capped = false, vref = 0;
  for (const f of fields) {
    const a = d.arr(f);
    if (!a) continue;
    vref = Math.max(vref, f.vmax * 1000);
    const cap = d.cap && f.hasPlug ? f.muCap : Infinity, skip = d.skipCorner && f.cornerZone;
    for (let k = 0; k < a.length; k++) {
      if (skip && skip[k]) continue;
      let v = a[k] * d.scale;
      if (v > cap) { v = cap; capped = true; }
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const kind = d.kind === 'auto' ? (min < -(d.autoTol ?? 1e-3) * Math.abs(max) ? 'div' : 'seq') : d.kind;
  if (kind === 'div') {
    // symmetric about zero; a floor keeps numerical noise in a ~zero field from being stretched into bold colour
    const m = Math.max(Math.abs(min), Math.abs(max), (d.floorFrac || 0) * vref) || 1;
    min = -m; max = m;
  } else if (d.zeroMin || (d.kind === 'auto' && min < 0)) min = 0;
  if (!(max > min)) max = min + 1;
  if (d.skipCorner) for (const f of fields) { const a = d.arr(f); if (a && f.cornerZone) for (let k = 0; k < a.length; k++) if (f.cornerZone[k] && (a[k] * d.scale > max || a[k] * d.scale < min)) capped = true; }
  return { key, label: d.label, short: d.short, unit: d.unit, scale: d.scale, kind, min, max, capped };
}
/** Colour range for time along the lines: 0 to the 90th percentile of the lines' total times (a few slow lines would wash the rest out; they are capped, and the colorbar says so). */
function timeRange(list) {
  const ends = list.flatMap(i => streamlinesFor(cfdRuns[i]).lines.map(l => l.t[l.t.length - 1])).sort((a, b) => a - b);
  const max = ends.length ? Math.max(1e-9, ends[Math.min(ends.length - 1, Math.floor(0.9 * ends.length))]) : 1;
  return { ...TIME_SCALAR, min: 0, max, capped: ends.some(t => t > max) };
}
const scalarFor = (range, f) => range && (range.perLine ? range : { ...range, arr: SCALARS[range.key].arr(f) });

function streamlinesFor(run) {
  const f = run.field;
  const n = FV.density === 'custom' ? Math.max(2, Math.min(80, Math.round(FV.customN) || 16)) : DENSITY_N[FV.density];
  const manual = FV.seedMode === 'manual'
    ? FV.manualSeeds.filter(([x, y]) => fieldInside(f, x, y))
    : null;
  const key = manual ? `m|${FV.direction}|${JSON.stringify(manual)}` : `a|${n}|${FV.direction}`;
  let hit = run.streamCache.get(key);
  if (!hit) {
    const seeds = manual || autoSeeds(f, n, FV.direction);
    const lines = seeds.map(p => traceStreamline(f, p, { direction: FV.direction }));
    for (const l of lines) l.t = streamlineTimes(f, l);
    hit = { seeds, lines, psiDev: lines.length ? Math.max(...lines.map(l => streamlinePsiDeviation(f, l))) : null };
    run.streamCache.set(key, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function viewCFD() {
  const opt = (v, t, cur, dis) => `<option value="${v}"${v === cur ? ' selected' : ''}${dis ? ' disabled' : ''}>${t}</option>`;
  const tree = (key, title, body) => `<details class="grp cfd-grp" data-tree="${key}"${FV.tree[key] ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
  const prop = (label, id, attrs, unit, hidden) => `<div class="prop"${hidden ? ' hidden' : ''}><label class="prop-l" for="${id}">${label}</label><span class="prop-v"><input type="number" id="${id}" ${attrs}><span class="prop-u">${unit}</span></span></div>`;
  const propSel = (label, id, options) => `<div class="prop prop-sel"><label class="prop-l" for="${id}">${label}</label><span class="prop-v"><select id="${id}">${options}</select></span></div>`;
  document.getElementById('setupExtra').innerHTML = `
    <div class="tree-sep">CFD setup</div>
    ${tree('geo', 'Blade geometry', `
      <div class="prop prop-seg"><span class="prop-l">Entry</span><div class="seg" role="tablist" aria-label="Blade shape" id="cfdShape">
        <button type="button" role="tab" data-shape="round" aria-selected="${CFDG.shape === 'round'}">Round entry</button>
        <button type="button" role="tab" data-shape="flat" aria-selected="${CFDG.shape === 'flat'}">Flat land</button>
      </div></div>
      ${prop('Radius', 'cfdR', `min="10" max="500" step="5" value="${CFDG.R}"`, 'mm', CFDG.shape !== 'round')}
      ${prop('Pool edge upstream', 'cfdPool', `min="5" max="150" step="5" value="${CFDG.pool}"`, 'mm', CFDG.shape !== 'round')}
      ${prop('Exit face to the web', 'cfdExit', `min="30" max="150" step="5" value="${CFDG.exitAngle}"`, '°')}
      <p class="prop-note" id="cfdGeoNote"></p>`)}
    ${tree('rheo', 'Rheology model', `
      ${propSel('Model', 'cfdModel', Object.entries(RHEO_MODELS).map(([k, m]) => opt(k, m.l, CFDG.model)).join(''))}
      <p class="prop-note" id="cfdModelNote">${RHEO_MODELS[CFDG.model].law}</p>`)}
    ${tree('fibre', 'Fibre', `
      ${propSel('Test report', 'cfdFibreSel', Object.entries(FIBRES).map(([k, f]) => opt(k, f.l, CFDG.fibre)).join(''))}
      ${prop('Basis weight', 'cfdGsm', `min="10" max="3000" step="1" value="${CFDG.gsm}"`, 'g/m²')}
      ${prop('Fibre density', 'cfdRhoF', `min="800" max="3000" step="5" value="${CFDG.rhoF}"`, 'kg/m³')}
      ${propSel('Filament diameter from', 'cfdDFrom', opt('yarn', 'yarn denier / filaments', CFDG.dFrom) + opt('air', 'air permeability', CFDG.dFrom))}
      ${prop('Yarn', 'cfdDen', `min="5" max="3000" step="1" value="${CFDG.den}"`, 'denier', CFDG.dFrom !== 'yarn')}
      ${prop('Filaments per yarn', 'cfdNf', `min="1" max="1000" step="1" value="${CFDG.nf}"`, '', CFDG.dFrom !== 'yarn')}
      ${prop('Air permeability', 'cfdAirPerm', `min="0.1" max="5000" step="0.5" value="${CFDG.airPerm}"`, '×10⁻³ m³/m²·s')}
      ${prop('… at test pressure', 'cfdAirDP', `min="0" max="2000" step="1" value="${CFDG.airDP}"`, 'Pa')}
      ${prop('Kozeny constant', 'cfdKoz', `min="1" max="20" step="0.5" value="${CFDG.kozeny}"`, '')}
      ${prop('Air fraction, top surface', 'cfdAirFrac', `min="0.05" max="0.95" step="0.01" value="${CFDG.airFrac}"`, '')}
      <p class="prop-note" id="cfdFibreNote">${fibreNote()}</p>`)}
    ${tree('air', 'Drying air (oven)', `
      ${prop('Air speed up into the fibre', 'cfdAirU', `min="0" max="50" step="0.1" value="${CFDG.airU}"`, 'm/s')}
      ${prop('Air temperature', 'cfdAirT', `min="0" max="400" step="5" value="${CFDG.airT}"`, '°C')}
      ${prop('Plenum length', 'cfdPlenum', `min="1" max="5000" step="10" value="${CFDG.plenum}"`, 'mm')}
      <p class="prop-note">Assumed values.</p>`)}
    ${tree('locs', 'Locations across the web', `
      <div class="loc-list" id="cfdLocs"></div>
      <div class="loc-edit" id="cfdLocEdit" hidden></div>`)}`;
  document.querySelectorAll('#setupExtra details[data-tree]').forEach(d => d.addEventListener('toggle', () => { FV.tree[d.dataset.tree] = d.open; }));

  const dockTab = (k, t) => `<button type="button" role="tab" data-dock="${k}" aria-selected="${FV.dock === k}" aria-controls="dock-${k}">${t}<span class="tab-n" data-n="${k}"></span></button>`;
  const panel = (k, body) => `<div class="dock-panel" id="dock-${k}" role="tabpanel"${FV.dock === k ? '' : ' hidden'}>${body}</div>`;
  view.innerHTML = `
    <div class="cfd-wb" id="cfdWb" style="--dock-h: ${FV.dockH}px">
      <div class="vp-bar" role="toolbar" aria-label="Solve and display">
        <button id="cfdRunAll" class="btn btn-primary btn-sm tool-run" type="button" title="Solve all four locations (Ctrl+Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10l8-5z" fill="currentColor"/></svg>Run all 4</button>
        <button id="cfdCancel" class="tool-btn tool-stop" type="button" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg>Stop</button>
        <span class="vp-sep" aria-hidden="true"></span>
        <div class="seg" role="tablist" aria-label="Location shown" id="cfdViewSeg"></div>
        <span class="vp-sep" aria-hidden="true"></span>
        <label class="vp-ctl">Field <select id="fvBase">
          ${opt('speed', 'Velocity magnitude |V|', FV.base)}${opt('ux', 'u_x (machine direction)', FV.base)}${opt('uy', 'u_y (normal to web)', FV.base)}
          ${opt('shear', 'Shear rate', FV.base)}${opt('mu', 'Apparent viscosity', FV.base)}${opt('omega', 'Vorticity', FV.base)}
          ${opt('strain1', 'Principal strain rate', FV.base)}${opt('dissip', 'Viscous dissipation', FV.base)}
          ${opt('pressure', 'Pressure', FV.base)}${opt('none', 'None (geometry only)', FV.base)}
        </select></label>
        <label class="fv-chk"><input type="checkbox" id="fvStream"${FV.streamlines ? ' checked' : ''}> Streamlines</label>
        <label class="fv-chk"><input type="checkbox" id="fvVec"${FV.vectors ? ' checked' : ''}> Vectors</label>
        <details class="vp-pop" id="fvMore"${FV.settingsOpen ? ' open' : ''}><summary class="tool-btn">Display</summary>
          <div class="pop-body">
            <div class="fv-grid">
          <fieldset><legend>View</legend>
            <label class="fv-ctl">Vertical scale <select id="fvScale">${opt('exaggerated', 'Exaggerated (fit)', FV.yScale)}${opt('true', 'True 1:1', FV.yScale)}</select></label>
          </fieldset>
          <fieldset><legend>Streamlines</legend>
            <label class="fv-ctl">Density <select id="fvDensity">${opt('low', 'Low (8)', FV.density)}${opt('medium', 'Medium (16)', FV.density)}${opt('high', 'High (32)', FV.density)}${opt('custom', 'Custom', FV.density)}</select>
              <input type="number" id="fvCustomN" min="2" max="80" step="1" value="${FV.customN}" aria-label="Custom streamline count"${FV.density === 'custom' ? '' : ' hidden'}></label>
            <label class="fv-ctl">Seeds <select id="fvSeedMode">${opt('auto', 'Automatic', FV.seedMode)}${opt('manual', 'Manual', FV.seedMode)}</select></label>
            <label class="fv-ctl">Direction <select id="fvDir">${opt('forward', 'Forward', FV.direction)}${opt('backward', 'Backward', FV.direction)}${opt('both', 'Both', FV.direction)}</select></label>
            <label class="fv-ctl">Colour <select id="fvLineColor">${opt('none', 'Plain', FV.lineColor)}${opt('speed', 'Velocity magnitude', FV.lineColor)}${opt('shear', 'Shear rate', FV.lineColor)}${opt('mu', 'Apparent viscosity', FV.lineColor)}${opt('pressure', 'Pressure', FV.lineColor)}${opt('time', 'Time along the line', FV.lineColor)}</select></label>
            <label class="fv-ctl">Width <select id="fvLineW">${opt('thin', 'Thin', FV.lineWidth)}${opt('normal', 'Normal', FV.lineWidth)}${opt('thick', 'Thick', FV.lineWidth)}</select></label>
            <label class="fv-chk"><input type="checkbox" id="fvArrows"${FV.arrows ? ' checked' : ''}> Direction arrows</label>
          </fieldset>
          <fieldset><legend>Vectors</legend>
            <label class="fv-ctl">Density <select id="fvVecDensity">${opt('low', 'Low', FV.vectorDensity)}${opt('medium', 'Medium', FV.vectorDensity)}${opt('high', 'High', FV.vectorDensity)}</select></label>
            <label class="fv-ctl">Length <select id="fvVecScale">${[0.5, 1, 1.5, 2].map(v => opt(String(v), v + '×', String(FV.vectorScale))).join('')}</select></label>
            <label class="fv-chk"><input type="checkbox" id="fvVecNorm"${FV.vectorNormalize ? ' checked' : ''}> Equal length (direction only)</label>
            <label class="fv-chk"><input type="checkbox" id="fvVecColor"${FV.vectorColor ? ' checked' : ''}> Colour by |V|</label>
          </fieldset>
        </div>
            <label class="fv-chk is-off" title="Pathlines need transient CFD data. This solver is steady-state, so there is no particle history to trace."><input type="checkbox" disabled> Pathlines <span class="fv-why">(steady solver: not available)</span></label>
            <p class="fv-note">One colour scale per plot: colouring the streamlines or vectors switches the field colours off.</p>
          </div>
        </details>
        <button class="tool-btn" type="button" id="cfdProbePlace" aria-pressed="${placeProbes}" title="Place named probes by clicking the plot"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>${placeProbes ? 'Done placing' : 'Probes'}</button>
        <span class="vp-spacer"></span>
        <details class="vp-pop vp-pop-r" id="cfdExport" hidden><summary class="tool-btn">Export CSV</summary>
          <div class="pop-body pop-menu">
            <span class="fv-why" id="cfdExportWhat"></span>
            <button class="menu-item" type="button" id="cfdCsvField">Field (every node)</button>
            <button class="menu-item" type="button" id="cfdCsvBound">Boundaries (web, blade, face, free surface)</button>
            <button class="menu-item" type="button" id="cfdCsvMetrics">Flow metrics table</button>
            <button class="menu-item" type="button" id="cfdCsvProbes">Probes</button>
          </div>
        </details>
      </div>
      <div class="viewport" id="cfdViewport">
        <div id="cfdBusy"></div>
        <div id="cfdSeeds"></div>
        <div id="cfdPlots"></div>
        <div class="fv-legend" id="cfdLegend"></div>
      </div>
      <div class="split split-h" id="dockSplit" role="separator" aria-orientation="horizontal" aria-label="Resize the results panel" tabindex="0"></div>
      <section class="dock" aria-label="Results">
        <div class="dock-tabs" role="tablist" aria-label="Results">
          ${dockTab('metrics', 'Flow metrics')}${dockTab('probes', 'Probes')}${dockTab('across', 'Across the web')}${dockTab('profiles', 'Profiles')}${dockTab('fibre', 'Fibre')}${dockTab('conv', 'Convergence')}${dockTab('cases', 'Saved cases')}${dockTab('msgs', 'Messages')}${dockTab('method', 'Method')}
        </div>
        <div class="dock-body">
          ${panel('metrics', '<div id="cfdMetrics"></div>')}
          ${panel('probes', `<div class="fv-bar">
              <span class="fv-ctl">Add a probe at</span>
              <label class="fv-ctl">Name <input type="text" id="cfdProbeName" maxlength="24" placeholder="auto" aria-label="Probe name"></label>
              <label class="fv-ctl">x <input type="number" id="cfdProbeX" step="0.1" min="0"> mm</label>
              <label class="fv-ctl">y <input type="number" id="cfdProbeY" step="0.01" min="0"> mm</label>
              <button class="btn btn-secondary btn-sm" type="button" id="cfdProbeAdd">Add</button>
              <span class="fv-why">or use Place probes in the toolbar and click the plot</span>
            </div>
            <div id="cfdProbes"></div>`)}
          ${panel('across', `<div class="fv-bar"><label class="fv-ctl">Quantity <select id="xlMetric">${Object.entries(ACROSS).map(([k, m]) => opt(k, m.l, FV.across)).join('')}</select></label></div>
            <div id="cfdAcross"></div>`)}
          ${panel('profiles', '<h3 class="dock-h" id="cfdProfTitle">Profiles</h3><div id="cfdProfiles"></div>')}
          ${panel('fibre', '<div id="cfdFibre"></div>')}
          ${panel('conv', '<div id="cfdConv"></div>')}
          ${panel('cases', `<div class="fv-bar">
              <label class="fv-ctl">Name <input type="text" id="cfdCaseName" maxlength="60" placeholder="e.g. 90° face, 35° contact" aria-label="Case name"></label>
              <button class="btn btn-secondary btn-sm" type="button" id="cfdCaseSave">Save current case</button>
              <span class="fv-why" id="cfdCaseMsg">Kept in this browser (local storage).</span>
            </div>
            <div id="cfdCases"></div>`)}
          ${panel('msgs', `<div class="fv-bar"><span class="fv-ctl" id="cfdMsgCount"></span><button class="btn btn-secondary btn-sm" type="button" id="cfdMsgClear">Clear</button></div>
            <div class="msg-log" id="cfdMsgs" role="log"></div>`)}
          ${panel('method', `<p class="cap cfd-lede"><b>2D Navier&ndash;Stokes flow under the blade, over its exit face and into the free film</b> at four positions across the web, with the meniscus and its contact line solved together with the flow: velocity, pressure, shear and viscosity fields. Everything shown is post-processed from the stored solutions: display settings never re-run the solver.</p><p class="cap"><b>Solver.</b> Steady 2D incompressible Navier&ndash;Stokes by finite elements (Taylor&ndash;Hood: quadratic velocity, linear pressure), with the viscosity varying in space exactly as the chosen rheology model says (Newtonian, power law, or Herschel&ndash;Bulkley as in the other tabs; the viscosity input is the value at 2.7 1/s in all three). Velocity, pressure, the free surface's position and the contact line's position are unknowns of one system, solved by Newton's method, starting from a Newtonian fluid and stepping to the real rheology. The free surface obeys the kinematic condition (no flow through it) and the stress balance with surface tension; gravity acts throughout. The flow rate is not assumed: it is whatever the bead pressure, the web and the meniscus together give.
      <b>Meniscus.</b> The contact line either stays pinned at the metering edge or climbs the exit face. It climbs when a pinned surface would leave the edge flatter than the contact angle allows (Gibbs' condition); on the face the surface leaves it at the contact angle.
      <b>Validated</b> (cfd-fem.validate.js) against exact solutions: flat-gap flow (Couette&ndash;Poiseuille, and a yield-stress fluid); the Ghia, Ghia &amp; Shin (1982) lid-driven cavity; the static meniscus on a vertical or tilted face (the Young&ndash;Laplace climb height, to 0.03%); plus mass conservation and grid convergence of the coating flow, and the round entry against the earlier stream-function solver.
      <b>Fibre.</b> The fibre's pores are dry: the slurry rests on the top filaments and nothing crosses the web surface. Over the air between those filaments the slurry slips (du/dy = (u &minus; U)/b at the surface, slip length b from the filament spacing, Philip 1972). Porosity, filament diameter and permeability (Kozeny&ndash;Carman) follow from the fibre's test-report data. Drying air: blown up into the fibre from a plenum; with the wet film sealing its top, the air can only leave along the fibre, and the pressure the set speed needs for that follows (Darcy, the air compressing).
      <b>Geometry.</b> Round entry: the blade's round surface converges onto the metering edge, its lowest point; the bead pressure acts at the pool edge. Flat land: the lubrication model's geometry, for comparison. The film is followed in 2D for a stretch downstream of the edge, then by the 1D thin-film model to the oven (under Profiles).
      <b>Locations.</b> Each location's gap at the edge and contact angle on the blade use the across-web waviness, fibre-thickness and wetting variation from the sidebar, the same formulas the Contact line tab uses. Any location can instead be given its own gap, contact angle, web speed, bead pressure, rheology or surface tension (the settings button on its row in the model tree); the blade and the fibre are shared.
      <b>Flow tracking.</b> Streamlines are integrated (RK4) through the interpolated velocity field and checked against the stream function, which is constant along a true streamline; the drift is reported under Flow metrics.
      <b>Limits.</b> The sharp metering edge is a corner: stresses and pressure there are singular in any continuum model, so their values right at the corner depend on the mesh (the reported lowest pressure says when it sits there). Contact angle is the static one (no contact-line hysteresis). Upstream, the pool's own free surface is not modelled; flow that turns back leaves through the inlet. Steady solver: no pathlines.</p>`)}
        </div>
      </section>
    </div>`;
  document.querySelectorAll('.dock-tabs button').forEach(b => {
    b.onclick = () => {
      FV.dock = b.dataset.dock;
      document.querySelectorAll('.dock-tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
      document.querySelectorAll('.dock-panel').forEach(pn => { pn.hidden = pn.id !== 'dock-' + FV.dock; });
      renderCFD();   // (charts in the panel now showing size to it)
    };
  });
  wireDockSplit();

  document.getElementById('cfdRunAll').onclick = runAllLocations;
  document.querySelectorAll('#cfdShape button').forEach(b => { b.onclick = () => { CFDG.shape = b.dataset.shape; viewCFD(); }; });
  const geoNum = (id, key, lo, hi) => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => { const v = +el.value; if (Number.isFinite(v)) CFDG[key] = Math.min(hi, Math.max(lo, v)); el.value = CFDG[key]; renderCFD(); });
  };
  geoNum('cfdR', 'R', 10, 500); geoNum('cfdPool', 'pool', 5, 150); geoNum('cfdExit', 'exitAngle', 30, 150);
  geoNum('cfdGsm', 'gsm', 10, 3000); geoNum('cfdRhoF', 'rhoF', 800, 3000); geoNum('cfdDen', 'den', 5, 3000); geoNum('cfdNf', 'nf', 1, 1000);
  geoNum('cfdKoz', 'kozeny', 1, 20); geoNum('cfdAirFrac', 'airFrac', 0.05, 0.95); geoNum('cfdAirPerm', 'airPerm', 0.1, 5000); geoNum('cfdAirDP', 'airDP', 0, 2000);
  document.getElementById('cfdFibreSel').addEventListener('change', e => { selectFibre(e.target.value); viewCFD(); });
  document.getElementById('cfdDFrom').addEventListener('change', e => { CFDG.dFrom = e.target.value; viewCFD(); });
  geoNum('cfdAirU', 'airU', 0, 50); geoNum('cfdAirT', 'airT', 0, 400); geoNum('cfdPlenum', 'plenum', 1, 5000);
  document.getElementById('cfdModel').addEventListener('change', e => { CFDG.model = e.target.value; document.getElementById('cfdModelNote').textContent = RHEO_MODELS[CFDG.model].law; renderCFD(); });
  document.getElementById('cfdCancel').onclick = cancelAllLocations;
  document.getElementById('cfdMsgClear').onclick = () => { cfdLog.length = 0; renderMessages(); };
  document.getElementById('cfdCaseSave').onclick = saveCase;
  document.getElementById('xlMetric').addEventListener('change', e => { FV.across = e.target.value; renderAcross(); });
  document.getElementById('cfdCsvField').onclick = () => exportField();
  document.getElementById('cfdCsvBound').onclick = () => exportBoundaries();
  document.getElementById('cfdCsvMetrics').onclick = () => exportMetrics();
  document.getElementById('cfdCsvProbes').onclick = () => exportProbes();
  document.getElementById('cfdProbePlace').onclick = () => { placeProbes = !placeProbes; viewCFD(); };
  document.getElementById('cfdProbeAdd').onclick = () => {
    const x = parseFloat(document.getElementById('cfdProbeX').value), y = parseFloat(document.getElementById('cfdProbeY').value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
    addProbe(x / 1000, y / 1000, document.getElementById('cfdProbeName').value);
    document.getElementById('cfdProbeName').value = '';
    renderCFD();
  };
  document.getElementById('fvMore').addEventListener('toggle', e => { FV.settingsOpen = e.target.open; });

  const bind = (id, key, parse = v => v, prop = 'value') => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => { FV[key] = parse(el[prop]); renderCFD(); });
  };
  bind('fvBase', 'base');
  bind('fvStream', 'streamlines', Boolean, 'checked');
  bind('fvVec', 'vectors', Boolean, 'checked');
  bind('fvScale', 'yScale');
  bind('fvDensity', 'density');
  bind('fvCustomN', 'customN', Number);
  bind('fvSeedMode', 'seedMode');
  bind('fvDir', 'direction');
  bind('fvLineColor', 'lineColor');
  bind('fvLineW', 'lineWidth');
  bind('fvArrows', 'arrows', Boolean, 'checked');
  bind('fvVecDensity', 'vectorDensity');
  bind('fvVecScale', 'vectorScale', Number);
  bind('fvVecNorm', 'vectorNormalize', Boolean, 'checked');
  bind('fvVecColor', 'vectorColor', Boolean, 'checked');

  renderCFD();
  if (!cfdAutoStarted && cfdRuns.every(r => r.status === 'idle')) { cfdAutoStarted = true; runAllLocations(); }
}

/** The results panel's height: drag the splitter above it (or arrow keys on it). */
function wireDockSplit() {
  const sp = document.getElementById('dockSplit'), wb = document.getElementById('cfdWb');
  const setH = h => { FV.dockH = Math.round(Math.max(120, Math.min(wb.clientHeight - 200, h))); wb.style.setProperty('--dock-h', FV.dockH + 'px'); };
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
    const y0 = e.clientY, h0 = FV.dockH;
    const move = ev => setH(h0 - (ev.clientY - y0));
    const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); renderCFD(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); setH(FV.dockH + (e.key === 'ArrowUp' ? 30 : -30)); renderCFD();
  });
}
// toolbar pop-overs (Display, Export): kept on screen, closed by a click elsewhere or Escape
document.addEventListener('toggle', e => {
  const d = e.target;
  if (!d.classList || !d.classList.contains('vp-pop') || !d.open) return;
  const body = d.querySelector('.pop-body');
  body.style.left = ''; body.style.right = '';
  const r = body.getBoundingClientRect();
  if (r.right > innerWidth - 8) { body.style.left = 'auto'; body.style.right = '0'; }
}, true);
document.addEventListener('click', e => { document.querySelectorAll('.vp-pop[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.vp-pop[open]').forEach(d => { d.open = false; }); });

function renderCFD() {
  if (!document.getElementById('cfdLocs')) return; // tab not showing
  const custom = document.getElementById('fvCustomN');
  if (custom) custom.hidden = FV.density !== 'custom';
  const dens = document.getElementById('fvDensity');
  if (dens) dens.disabled = custom.disabled = FV.seedMode === 'manual';
  renderCfdStatus();
  renderMessages();
  renderDockCounts();
  renderGeoNote();
  renderLocCards();
  renderViewSeg();
  renderSeedPanel();
  updateBusy();
  renderFlowPlots();
  renderLegend();
  renderCases();
  renderProbes();
  renderExportBar();
  renderMetrics();
  renderAcross();
  renderFibre();
  renderProfiles();
  renderConvergence();
}

// ---------------------------------------------------------------------
// CSV export of what is solved and shown: the location in view, or all
// four in the comparison view (a location column tells them apart).
// ---------------------------------------------------------------------
const csvCell = v => { const t = typeof v === 'number' ? (Number.isFinite(v) ? String(+v.toPrecision(9)) : '') : String(v ?? ''); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function downloadCSV(name, rows) {
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
const exportLocs = () => (FV.view === 'compare' ? CFD_LOCS.map((_, i) => i) : [FV.view]).filter(i => cfdRuns[i].field);
const csvStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
function renderExportBar() {
  const bar = document.getElementById('cfdExport');
  if (!bar) return;
  const locs = exportLocs();
  bar.hidden = !locs.length;
  document.getElementById('cfdExportWhat').textContent = locs.length ? `(location${locs.length > 1 ? 's' : ''} ${locs.map(i => i + 1).join(', ')}${locs.some(cfdIsStale) ? '; some out of date' : ''})` : '';
}
/** Where a node sits: the boundary it lies on, else interior. */
function nodeKind(f, i, j) {
  if (j === 0) return 'web';
  if (j === f.ny - 1) return i <= f.iCorner ? 'blade' : i <= f.iCL ? 'exit face' : 'free surface';
  if (i === 0) return 'inlet';
  if (i === f.nx - 1) return 'outlet';
  return 'interior';
}
function exportField() {
  const rows = [['location', 'z_mm', 'i', 'j', 'boundary', 'x_mm', 'y_mm', 'u_mm_s', 'v_mm_s', 'speed_mm_s', 'p_Pa', 'shear_rate_1_s', 'viscosity_Pa_s', 'unyielded',
    'vorticity_1_s', 'strain_rate_stretching_1_s', 'strain_rate_compression_1_s', 'stretching_direction_deg', 'dissipation_W_m3', 'stream_function_mm2_s']];
  for (const L of exportLocs()) {
    const f = cfdRuns[L].field;
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
      const k = j * f.nx + i;
      rows.push([L + 1, CFD_LOCS[L].z, i, j, nodeKind(f, i, j), f.gx[k] * 1e3, f.gy[k] * 1e3, f.u[k] * 1e3, f.v[k] * 1e3, f.speed[k] * 1e3, f.p[k], f.shear[k], f.mu[k],
        f.unyielded && f.unyielded[k] ? 1 : 0, f.omega[k], f.strain1[k], f.strain2[k], f.strainDir[k] * 180 / Math.PI, f.dissipation[k], f.psi[k] * 1e6]);
    }
  }
  downloadCSV(`cfd-field-${csvStamp()}.csv`, rows);
}
function exportBoundaries() {
  const rows = [['location', 'z_mm', 'column', 'web_x_mm', 'web_p_Pa', 'web_u_mm_s', 'top', 'top_x_mm', 'top_y_mm', 'top_p_Pa']];
  for (const L of exportLocs()) {
    const r = cfdRuns[L].result, f = cfdRuns[L].field;
    for (let i = 0; i < f.nx; i++) rows.push([L + 1, CFD_LOCS[L].z, i, r.xWeb[i] * 1e3, r.pWeb[i], r.uWeb[i] * 1e3, nodeKind(f, i, f.ny - 1), r.xTop[i] * 1e3, r.yTop[i] * 1e3, r.pTop[i]]);
  }
  downloadCSV(`cfd-boundaries-${csvStamp()}.csv`, rows);
}
/** The Flow metrics table as shown (a value's small note follows it after " | "). */
function exportMetrics() {
  const table = document.querySelector('#cfdMetrics table');
  if (!table) return;
  const cell = c => [...c.childNodes].map(n => n.textContent.trim()).filter(Boolean).join(' | ');
  const rows = [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(cell));
  if (FV.view !== 'compare') rows.unshift(['Metric', `Location ${FV.view + 1}`]);
  downloadCSV(`cfd-metrics-${csvStamp()}.csv`, rows);
}

/** Values at a probe point in one location's field, or null when the point is outside its fluid. */
function probeValues(f, q) {
  if (!fieldInside(f, q.x, q.y)) return null;
  const v = a => sampleField(f, a, q.x, q.y);
  const u = v(f.u), w = v(f.v);
  return { u, v: w, speed: Math.hypot(u, w), p: v(f.p), shear: v(f.shear), mu: v(f.mu), unyielded: f.hasPlug && v(f.mu) > f.muCap };
}
function renderProbes() {
  const host = document.getElementById('cfdProbes');
  if (!host) return;
  if (!cfdProbes.length) { host.innerHTML = `<p class="cap">No probes yet. ${placeProbes ? 'Click a plot to place one.' : 'Place them by clicking a plot, or enter a point.'}</p>`; return; }
  const locs = exportLocs(), esc = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const cell = (L, q) => {
    const f = cfdRuns[L].field, pv = probeValues(f, q);
    if (!pv) return '<td><small>outside the fluid</small></td>';
    return `<td>|V| ${fmtNum(pv.speed * 1000)} <small>u ${fmtNum(pv.u * 1000)} · v ${fmtNum(pv.v * 1000)} mm/s</small><small>p ${fmtNum(pv.p)} Pa · γ̇ ${fmtNum(pv.shear)} 1/s</small><small>μ ${pv.unyielded ? '&gt; cap (unyielded)' : fmtNum(pv.mu) + ' Pa·s'}</small></td>`;
  };
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table probe-table${locs.length > 1 ? ' cmp' : ''}"><thead><tr><th>Probe <small>x, y (mm)</small></th>${locs.map(L => `<th>Location ${L + 1}<small>z ${CFD_LOCS[L].z} mm</small></th>`).join('')}<th></th></tr></thead><tbody>
    ${cfdProbes.map((q, k) => `<tr><th scope="row"><input type="text" class="probe-name" data-pn="${k}" value="${esc(q.name)}" maxlength="24" aria-label="Probe name"><small>${(q.x * 1000).toFixed(2)}, ${(q.y * 1000).toFixed(3)}</small></th>${locs.map(L => cell(L, q)).join('')}<td class="case-act"><button class="btn btn-secondary btn-sm" type="button" data-pdel="${k}" aria-label="Delete probe ${esc(q.name)}">Delete</button></td></tr>`).join('')}
  </tbody></table></div><p class="fv-note">Probes are shared by all locations and kept in this browser; values are read from the stored fields${locs.length ? '' : ' (no solved location in view)'}.</p>`;
  host.querySelectorAll('input[data-pn]').forEach(inp => inp.addEventListener('change', () => { const t = inp.value.trim(); if (t) { cfdProbes[+inp.dataset.pn].name = t; saveProbes(); } renderCFD(); }));
  host.querySelectorAll('button[data-pdel]').forEach(b => { b.onclick = () => { cfdProbes.splice(+b.dataset.pdel, 1); saveProbes(); renderCFD(); }; });
}
function exportProbes() {
  const rows = [['probe', 'x_mm', 'y_mm', 'location', 'z_mm', 'inside_fluid', 'u_mm_s', 'v_mm_s', 'speed_mm_s', 'p_Pa', 'shear_rate_1_s', 'viscosity_Pa_s', 'unyielded']];
  for (const q of cfdProbes) for (const L of exportLocs()) {
    const pv = probeValues(cfdRuns[L].field, q);
    rows.push([q.name, q.x * 1e3, q.y * 1e3, L + 1, CFD_LOCS[L].z, pv ? 1 : 0, ...(pv ? [pv.u * 1e3, pv.v * 1e3, pv.speed * 1e3, pv.p, pv.shear, pv.mu, pv.unyielded ? 1 : 0] : ['', '', '', '', '', '', ''])]);
  }
  downloadCSV(`cfd-probes-${csvStamp()}.csv`, rows);
}

// ---------------------------------------------------------------------
// Saved cases (browser local storage): every input that defines a run --
// the sidebar's, this tab's blade / fibre / rheology-model inputs, and the
// four locations (position and own inputs) -- plus a summary of the results
// at the time of saving. Loading restores the inputs and runs the four
// locations again (results are not stored: a run takes seconds).
// ---------------------------------------------------------------------
const CASES_KEY = 'bladeCoatDefectLab.cfdCases.v1';
function readCases() {
  try { const a = JSON.parse(localStorage.getItem(CASES_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return null; }                 // storage not available (e.g. blocked in this browser)
}
function writeCases(list) {
  try { localStorage.setItem(CASES_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}
function caseMsg(t) { const el = document.getElementById('cfdCaseMsg'); if (el) el.textContent = t; }

function saveCase() {
  const el = document.getElementById('cfdCaseName'), name = el.value.trim();
  if (!name) { caseMsg('Give the case a name first.'); el.focus(); return; }
  const list = readCases();
  if (!list) { caseMsg('Local storage is not available in this browser.'); return; }
  const c = {
    name, saved: new Date().toISOString(),
    P: Object.fromEntries(CFG.map(q => [q.k, P[q.k]])),
    CFDG: { ...CFDG },
    locs: CFD_LOCS.map(l => ({ z: l.z, over: { ...l.over } })),
    probes: cfdProbes.map(q => ({ ...q })),
    summary: cfdRuns.map((r, i) => r.field && !cfdIsStale(i) ? { film: r.result.Q / r.geo.U * 1000, mode: r.result.mode, s: r.result.sCL * 1000 } : null),
  };
  const at = list.findIndex(x => x.name === name);
  if (at >= 0) list[at] = c; else list.unshift(c);
  if (!writeCases(list)) { caseMsg('Could not save: local storage is full or blocked.'); return; }
  caseMsg(at >= 0 ? `Replaced "${name}".` : `Saved "${name}".`);
  el.value = '';
  renderCases();
}

function loadCase(name) {
  const c = (readCases() || []).find(x => x.name === name);
  if (!c) return;
  // sidebar: set each slider as the reset button does, so everything that listens updates
  for (const q of CFG) {
    if (!(q.k in c.P)) continue;
    const sl = document.getElementById('s_' + q.k);
    if (sl) { sl.value = c.P[q.k]; sl.dispatchEvent(new Event('input')); } else P[q.k] = c.P[q.k];
  }
  for (const k of Object.keys(CFDG)) if (c.CFDG && k in c.CFDG) CFDG[k] = c.CFDG[k];   // (older cases: fields since renamed are skipped)
  c.locs.forEach((l, i) => { if (CFD_LOCS[i]) { CFD_LOCS[i].z = l.z; CFD_LOCS[i].over = { ...l.over }; } });
  if (Array.isArray(c.probes)) { cfdProbes = c.probes.map(q => ({ ...q })); saveProbes(); }
  cfdEditLoc = null;
  viewCFD();
  caseMsg(`Loaded "${name}": solving its four locations.`);
  runAllLocations();
}

function deleteCase(name) {
  const list = readCases();
  if (!list) return;
  writeCases(list.filter(x => x.name !== name));
  caseMsg(`Deleted "${name}".`);
  renderCases();
}

function renderCases() {
  const host = document.getElementById('cfdCases');
  if (!host) return;
  const list = readCases();
  if (!list) { host.innerHTML = '<p class="cap">Local storage is not available in this browser, so cases cannot be saved here.</p>'; return; }
  if (!list.length) { host.innerHTML = '<p class="cap">No saved cases yet.</p>'; return; }
  const esc = t => t.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table case-table"><thead><tr><th>Case</th><th>Blade · model</th><th>Wet film, locations 1–4 (mm)</th><th></th></tr></thead><tbody>${list.map((c, k) => {
    const g = c.CFDG || {}, films = (c.summary || []).map(x => x ? x.film.toFixed(3) : '—').join(' · ');
    const own = (c.locs || []).filter(l => Object.keys(l.over || {}).length).length;
    return `<tr><th scope="row">${esc(c.name)}<small>${new Date(c.saved).toLocaleString()}</small></th>
      <td>${g.shape === 'flat' ? 'flat land' : `round entry R ${g.R} mm`}, face ${g.exitAngle}°<small>${RHEO_MODELS[g.model || 'hb'].l}${own ? ` · ${own} location${own > 1 ? 's' : ''} with own inputs` : ''}</small></td>
      <td>${films}</td>
      <td class="case-act"><button class="btn btn-secondary btn-sm" type="button" data-load="${k}">Load</button> <button class="btn btn-secondary btn-sm" type="button" data-del="${k}" aria-label="Delete case ${esc(c.name)}">Delete</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
  host.querySelectorAll('button[data-load]').forEach(b => { b.onclick = () => loadCase(list[+b.dataset.load].name); });
  host.querySelectorAll('button[data-del]').forEach(b => { b.onclick = () => deleteCase(list[+b.dataset.del].name); });
}

function renderGeoNote() {
  const el = document.getElementById('cfdGeoNote');
  if (!el) return;
  if (CFDG.shape === 'round') {
    const g = cfdGeometry(0), hPool = g.H + g.R - Math.sqrt(g.R * g.R - g.Xup * g.Xup);
    const clipped = CFDG.pool > 0.8 * CFDG.R ? ` (limited to 0.8 × radius)` : '';
    el.textContent = `Domain: ${(g.Xup * 1000).toFixed(0)} mm from the pool edge${clipped}, where the gap is ${(hPool * 1000).toFixed(1)} mm, to the metering edge.`;
  } else {
    el.textContent = `Domain: the ${P.L} mm land (sidebar), bead pressure at its upstream end.`;
  }
}

/** The CFD runs in the status bar, one chip per location (shown in every module: runs carry on in the background). */
function renderRunChips() {
  const el = document.getElementById('cfdStatus');
  if (!el) return;
  el.innerHTML = CFD_LOCS.map((loc, i) => {
    const r = cfdRuns[i];
    let cls = '', txt = '—', tip = 'not run yet';
    if (r.status === 'running') {
      cls = 'run'; const pr = r.progress;
      txt = pr && Number.isFinite(pr.residual) ? `r ${pr.residual.toExponential(0)}` : 'solving';
      tip = `solving${pr ? ': ' + (pr.stage || 'starting') : ''}`;
    } else if (r.status === 'error') { cls = 'bad'; txt = 'failed'; tip = r.error || 'failed'; }
    else if (r.field && cfdIsStale(i)) { cls = 'warn'; txt = 'out of date'; tip = 'inputs changed since this run'; }
    else if (r.field) { cls = r.result.converged ? 'ok' : 'warn'; txt = `${(r.elapsedMs / 1000).toFixed(1)} s`; tip = `solved in ${(r.elapsedMs / 1000).toFixed(1)} s, residual ${r.result.residual.toExponential(1)}`; }
    else if (r.status === 'cancelled') { cls = 'warn'; txt = 'stopped'; tip = 'stopped'; }
    return `<span class="sb-run ${cls}" title="Location ${loc.id} (z ${loc.z} mm): ${tip}"><i class="loc-dot" style="background:${locColor(i)}"></i>L${loc.id} <b>${txt}</b></span>`;
  }).join('');
}

function renderCfdStatus() {
  renderRunChips();
  // Run and Stop share the toolbar slot: Stop while anything is solving
  const cancel = document.getElementById('cfdCancel'), run = document.getElementById('cfdRunAll'), running = cfdRuns.some(r => r.status === 'running');
  if (cancel) cancel.hidden = !running;
  if (run) run.hidden = running;
}

/** Counts on the results tabs: probes, saved cases, messages. */
function renderDockCounts() {
  const set = (k, n) => { const el = document.querySelector(`.tab-n[data-n="${k}"]`); if (el) el.textContent = n ? String(n) : ''; };
  set('probes', cfdProbes.length);
  set('cases', (readCases() || []).length);
  set('msgs', cfdLog.length);
}

/** While a location in view is solving: a line over the plot with its stage and residual (kept current as progress comes in). */
function busyLine() {
  const shown = (FV.view === 'compare' ? CFD_LOCS.map((_, i) => i) : [FV.view]).filter(i => cfdRuns[i].status === 'running');
  if (!shown.length) return '';
  return `<div class="vp-busy" role="status"><i class="spin" aria-hidden="true"></i>${shown.map(i => {
    const pr = cfdRuns[i].progress;
    return `<span><b>Solving L${i + 1}</b> ${pr ? cfdStageText(pr.stage) : 'starting'}${pr && Number.isFinite(pr.residual) ? ` <span class="mono">r ${pr.residual.toExponential(1)}</span>` : ''}</span>`;
  }).join(' · ')}${shown.some(i => cfdRuns[i].field) ? '<span class="fv-why">(showing the previous result meanwhile)</span>' : ''}</div>`;
}
function updateBusy() {
  const el = document.getElementById('cfdBusy');
  if (el) el.innerHTML = busyLine();
}

/** The Messages tab: the solver's log, oldest first, kept at the bottom while new lines come in. */
function renderMessages() {
  const host = document.getElementById('cfdMsgs');
  if (!host) return;
  const sc = host.closest('.dock-body') || host, atEnd = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 30;
  const hh = d => d.toTimeString().slice(0, 8);
  host.innerHTML = cfdLog.length ? cfdLog.map(m => `<div class="msg ${m.kind}"><time>${hh(m.t)}</time><span class="msg-loc"><i class="loc-dot" style="background:${locColor(m.i)}"></i>L${m.i + 1}</span><span class="msg-t">${m.text}</span></div>`).join('')
    : '<p class="cap">No messages yet: each run writes what the solver does here.</p>';
  if (atEnd && !host.closest('[hidden]')) sc.scrollTop = sc.scrollHeight;
  const n = document.getElementById('cfdMsgCount');
  if (n) n.textContent = `${cfdLog.length} message${cfdLog.length === 1 ? '' : 's'}`;
}

function renderLocCards() {
  const host = document.getElementById('cfdLocs');
  host.innerHTML = CFD_LOCS.map((loc, i) => {
    const r = cfdRuns[i];
    let cls = '', txt = 'not run';
    if (r.status === 'running') { cls = 'run'; txt = r.progress ? `solving · ${cfdStageText(r.progress.stage)}${r.progress.s < 1 ? `, rheology ${Math.round(r.progress.s * 100)}%` : ''}` : 'solving…'; }
    else if (r.status === 'error') { cls = 'bad'; txt = 'failed'; }
    else if (r.field && cfdIsStale(i)) { cls = 'warn'; txt = 'out of date'; }
    else if (r.field) { cls = r.result.converged ? 'ok' : 'warn'; txt = `solved · ${(r.elapsedMs / 1000).toFixed(1)} s${r.result.converged ? '' : ' · partly converged'}`; }
    else if (r.status === 'cancelled') { cls = 'warn'; txt = 'cancelled'; }
    const sel = FV.view === i ? ' sel' : '', own = Object.keys(loc.over).length;
    return `<div class="loc-row${sel}">
      <button class="loc-pick" type="button" data-pick="${i}" aria-pressed="${FV.view === i}" title="Show location ${loc.id} in the viewport"><i class="loc-dot" style="background:${locColor(i)}"></i>L${loc.id}</button>
      <label class="loc-z"><span>z</span><input type="number" min="0" max="${CFD_WEB_WIDTH_MM}" step="0.5" value="${loc.z}" data-i="${i}" aria-label="Location ${loc.id} position across the web, mm"><span>mm</span></label>
      <button class="icon-btn loc-in-btn${own ? ' on' : ''}" type="button" data-edit="${i}" aria-expanded="${cfdEditLoc === i}" aria-controls="cfdLocEdit" title="Inputs for location ${loc.id} only${own ? ` (${own} set here)` : ''}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h7M12 4h2M2 12h3M8 12h6M9 2.5v3M5 10.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>${own ? `<span class="badge">${own}</span>` : ''}</button>
      <button class="icon-btn" type="button" data-run="${i}"${r.status === 'running' ? ' disabled' : ''} title="Run location ${loc.id}" aria-label="Run location ${loc.id}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10l8-5z" fill="currentColor"/></svg></button>
      <div class="loc-state ${cls}" data-state="${i}"${r.error ? ` title="${r.error}"` : ''}>${txt}</div>
      <div class="loc-meta">gap <b>${locInput(i, 'gap').toFixed(3)}</b> mm · contact <b>${locInput(i, 'th').toFixed(1)}</b>&deg;</div>
    </div>`;
  }).join('');
  const edit = document.getElementById('cfdLocEdit');
  if (cfdEditLoc == null) { edit.hidden = true; edit.innerHTML = ''; }
  else {
    const i = cfdEditLoc, loc = CFD_LOCS[i], own = Object.keys(loc.over).length;
    edit.hidden = false;
    edit.innerHTML = `<div class="loc-edit-head"><b>Location ${loc.id}: its own inputs</b><span class="fv-why">empty = the shared value (shown faint)</span></div>
      <div class="loc-in-grid">${LOC_INPUTS.map(q => { const off = (q.k === 'n' || q.k === 'ty') && !RHEO_MODELS[CFDG.model].uses.includes(q.k); return `<label${off ? ` title="not used by the ${RHEO_MODELS[CFDG.model].l} model"` : ''}><span>${q.l}${q.u ? ` <small>${q.u}</small>` : ''}${off ? ' <small>(not used)</small>' : ''}</span><input type="number" step="${q.step}" data-li="${i}" data-k="${q.k}" value="${loc.over[q.k] ?? ''}" placeholder="${locShared(i, q.k).toFixed(q.d)}"${off ? ' disabled' : ''} aria-label="Location ${loc.id}: ${q.l}${q.u ? ', ' + q.u : ''} (empty = shared value)"></label>`; }).join('')}</div>
      <div class="loc-edit-actions"><button class="btn btn-secondary btn-sm" type="button" data-clear="${i}"${own ? '' : ' disabled'}>Use shared values</button><button class="btn btn-secondary btn-sm" type="button" data-edit="${i}">Close</button></div>`;
  }
  host.querySelectorAll('input[data-i]').forEach(inp => inp.addEventListener('change', () => {
    const v = Math.min(CFD_WEB_WIDTH_MM, Math.max(0, +inp.value || 0));
    CFD_LOCS[+inp.dataset.i].z = v;
    renderCFD();
  }));
  document.querySelectorAll('#cfdLocs button[data-edit], #cfdLocEdit button[data-edit]').forEach(b => { b.onclick = () => { cfdEditLoc = cfdEditLoc === +b.dataset.edit ? null : +b.dataset.edit; renderLocCards(); }; });
  host.querySelectorAll('button[data-pick]').forEach(b => { b.onclick = () => { FV.view = +b.dataset.pick; FV.profileLoc = FV.view; renderCFD(); }; });
  edit.querySelectorAll('input[data-li]').forEach(inp => inp.addEventListener('change', () => {
    const loc = CFD_LOCS[+inp.dataset.li], k = inp.dataset.k, raw = inp.value.trim(), v = +raw;
    const ok = k === 'th' ? v > 0 && v < 180 : k === 'ty' || k === 'Pup' ? v >= 0 : v > 0;
    if (raw === '') delete loc.over[k];
    else if (Number.isFinite(v) && ok) loc.over[k] = v;
    renderCFD();
  }));
  edit.querySelectorAll('button[data-clear]').forEach(b => { b.onclick = () => { CFD_LOCS[+b.dataset.clear].over = {}; renderCFD(); }; });
  host.querySelectorAll('button[data-run]').forEach(b => { b.onclick = () => runLocation(+b.dataset.run); });
}

/** Refresh only the locations' status lines (progress while solving), leaving their inputs alone. */
function updateLocStates() {
  document.querySelectorAll('.loc-state[data-state]').forEach(el => {
    const r = cfdRuns[+el.dataset.state];
    if (r.status === 'running') { el.className = 'loc-state run'; el.textContent = r.progress ? `solving · ${cfdStageText(r.progress.stage)}${r.progress.s < 1 ? `, rheology ${Math.round(r.progress.s * 100)}%` : ''}` : 'solving…'; }
  });
}

/** Short progress text from the solver's stage message. */
function cfdStageText(stage) {
  if (!stage) return 'starting';
  if (/at the edge/.test(stage)) return 'meniscus at the edge';
  if (/held/.test(stage)) return 'placing the contact line';
  if (/laid out again/.test(stage)) return 'refining at the contact line';
  if (/free on the face/.test(stage)) return 'contact line on the face';
  return 'solving';
}

function renderViewSeg() {
  const host = document.getElementById('cfdViewSeg');
  const items = CFD_LOCS.map((l, i) => [i, `L${l.id}`, `Location ${l.id}, z ${l.z} mm`]).concat([['compare', 'Compare', 'All four locations']]);
  host.innerHTML = items.map(([v, t, title]) => `<button type="button" role="tab" aria-selected="${FV.view === v}" data-v="${v}" title="${title}">${t}</button>`).join('');
  host.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      FV.view = b.dataset.v === 'compare' ? 'compare' : +b.dataset.v;
      if (FV.view !== 'compare') FV.profileLoc = FV.view;
      renderCFD();
    };
  });
}

function renderSeedPanel() {
  const host = document.getElementById('cfdSeeds');
  if (FV.seedMode !== 'manual' || !FV.streamlines) { host.innerHTML = ''; return; }
  const chips = FV.manualSeeds.map(([x, y], k) =>
    `<span class="seed-chip">(${(x * 1000).toFixed(2)}, ${(y * 1000).toFixed(3)}) mm<button type="button" data-k="${k}" aria-label="Remove seed ${k + 1}">×</button></span>`).join('');
  host.innerHTML = `<div class="fv-seeds">
      <span class="fv-seeds-lead">Manual seeds: click the field, or enter</span>
      <label>x <input type="number" id="fvSeedX" step="0.1" min="0"> mm</label>
      <label>y <input type="number" id="fvSeedY" step="0.01" min="0"> mm</label>
      <button class="btn btn-secondary btn-sm" type="button" id="fvSeedAdd">Add</button>
      <button class="btn btn-secondary btn-sm" type="button" id="fvSeedClear"${FV.manualSeeds.length ? '' : ' disabled'}>Clear all</button>
      <button class="btn btn-secondary btn-sm" type="button" id="fvSeedAuto">Back to automatic</button>
      <div class="seed-list">${chips || '<span class="fv-why">No seeds yet.</span>'}</div>
    </div>`;
  document.getElementById('fvSeedAdd').onclick = () => {
    const x = parseFloat(document.getElementById('fvSeedX').value), y = parseFloat(document.getElementById('fvSeedY').value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
    FV.manualSeeds.push([x / 1000, y / 1000]);
    renderCFD();
  };
  document.getElementById('fvSeedClear').onclick = () => { FV.manualSeeds = []; renderCFD(); };
  document.getElementById('fvSeedAuto').onclick = () => { FV.seedMode = 'auto'; document.getElementById('fvSeedMode').value = 'auto'; renderCFD(); };
  host.querySelectorAll('.seed-chip button').forEach(b => { b.onclick = () => { FV.manualSeeds.splice(+b.dataset.k, 1); renderCFD(); }; });
}

function locationTitle(i) {
  const r = cfdRuns[i];
  return `Location ${i + 1} · z = ${CFD_LOCS[i].z} mm · gap at edge ${(r.geo.H * 1000).toFixed(3)} mm${r.geo.own && r.geo.own.length ? ` · own ${r.geo.own.map(k => LOC_INPUTS.find(q => q.k === k).l.toLowerCase()).join(', ')}` : ''}`;
}

function renderFlowPlots() {
  const host = document.getElementById('cfdPlots');
  const compare = FV.view === 'compare';
  const list = CFD_LOCS.map((_, i) => i).filter(i => cfdRuns[i].field && (compare || i === FV.view));
  if (!list.length) {
    const running = cfdRuns.some(r => r.status === 'running');
    host.innerHTML = `<p class="cap fv-empty">${running ? '<i class="spin" aria-hidden="true"></i>Solving: the field appears here when the run finishes.' : compare ? 'No location has a result yet.' : `Location ${FV.view + 1} has no result yet: run it (toolbar, or its row in the model tree).`}</p>`;
    return;
  }
  const fields = list.map(i => cfdRuns[i].field);
  const ranges = {
    base: FV.base !== 'none' && SCALARS[FV.base] ? scalarRange(FV.base, fields) : null,
    line: !FV.streamlines || FV.lineColor === 'none' ? null
      : FV.lineColor === 'time' ? timeRange(list)
        : scalarRange(FV.lineColor, fields),
    speed: scalarRange('speed', fields),
  };
  const yMax = Math.max(...fields.map(f => f.Ly));
  const vmax = Math.max(...fields.map(f => f.vmax));

  host.innerHTML = list.map(i => `
    ${compare ? '' : `<div class="fv-caption">${locationTitle(i)} · ${cfdRuns[i].result.mesh.nEx} × ${cfdRuns[i].result.mesh.nEy} finite elements · <span class="fv-ex"></span>${cfdIsStale(i) ? ' · <span class="warn-text">out of date: inputs changed since this run</span>' : ''}${cfdRuns[i].result.converged ? '' : ` · <span class="warn-text">converged only to residual ${cfdRuns[i].result.residual.toExponential(1)}</span>`}</div>`}
    <div class="fv-plot${compare ? ' compact' : ''}" data-i="${i}">
      <canvas class="fv-main" role="img" aria-label="${locationTitle(i)}: CFD field with flow overlays"></canvas>
      <canvas class="fv-over" aria-hidden="true"></canvas>
      <div class="fv-tip" hidden></div>
    </div>`).join('') + (compare ? '<p class="fv-note">Same colour range, axes (y up to the largest gap), streamline settings and vector scale in all four.</p>' : '');

  // one location: the plot fills the viewport's height (what the caption leaves)
  const cap = host.querySelector('.fv-caption');
  const maxH = compare ? null : host.clientHeight - (cap ? cap.offsetHeight + 6 : 0) - 4;
  host.querySelectorAll('.fv-plot').forEach(el => {
    const i = +el.dataset.i, run = cfdRuns[i], f = run.field;
    const sl = FV.streamlines ? streamlinesFor(run) : null;
    const cv = el.querySelector('.fv-main');
    const map = drawFlowPlot(cv, {
      f, webSpeed: run.geo.U, yMax, yScale: FV.yScale, compact: compare, maxH: maxH > 150 ? maxH : null, title: compare ? locationTitle(i) + (cfdIsStale(i) ? ' (out of date)' : '') : '',
      exitAngle: run.geo.exitAngle, bladeLabel: run.geo.shape === 'round' ? `blade, round entry R ${(run.geo.R * 1000).toFixed(0)} mm` : 'blade land (fixed)',
      scalar: scalarFor(ranges.base, f), lineScalar: scalarFor(ranges.line, f),
      streamlines: sl ? sl.lines : null, lineWidth: LINE_W[FV.lineWidth] * (compare ? 0.8 : 1), arrows: FV.arrows,
      vectorSample: FV.vectors ? (nc, nr) => sampleVectors(f, nc, nr) : null,
      vectorSpacing: VEC_SPACING[FV.vectorDensity] * (compare ? 0.8 : 1), vectorScale: FV.vectorScale,
      vectorNormalize: FV.vectorNormalize, vectorVmax: vmax, vectorColor: FV.vectorColor, vectorScalar: scalarFor(ranges.speed, f),
      seeds: sl ? sl.seeds : null, manualSeeds: FV.seedMode === 'manual',
      probes: cfdProbes.map(q => ({ ...q, inside: fieldInside(f, q.x, q.y) })),
    });
    wirePlotProbe(el, cv, map, run);
    const ex = host.querySelector('.fv-ex');
    if (ex) ex.textContent = map.exaggeration > 1.05 ? `vertical scale ×${map.exaggeration.toFixed(1)}` : 'true 1:1 scale';
  });
}

/** Hover/touch probe (crosshair + values at the point, read from the stored field) and click-to-seed in manual mode. */
function wirePlotProbe(el, cv, map, run) {
  const f = run.field, over = el.querySelector('.fv-over'), tip = el.querySelector('.fv-tip');
  const dpr = window.devicePixelRatio || 1, cssW = cv.clientWidth || cv.width / dpr, cssH = parseFloat(cv.style.height) || cv.height / dpr;
  over.width = cv.width; over.height = cv.height; over.style.width = cssW + 'px'; over.style.height = cssH + 'px';
  const oc = over.getContext('2d');
  oc.setTransform(dpr, 0, 0, dpr, 0, 0);
  cv.style.cursor = placeProbes || (FV.seedMode === 'manual' && FV.streamlines) ? 'crosshair' : 'default';
  const sb = document.getElementById('sbCoord');
  const clear = () => { oc.clearRect(0, 0, cssW, cssH); tip.hidden = true; if (sb) sb.textContent = ''; };
  const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  const probe = e => {
    const [px, py] = at(e), p = map.toPhys(px, py);
    if (!p) { clear(); return; }
    oc.clearRect(0, 0, cssW, cssH);
    oc.strokeStyle = cssVar('--ink'); oc.globalAlpha = 0.45; oc.setLineDash([3, 3]); oc.lineWidth = 1;
    oc.beginPath(); oc.moveTo(map.left, py); oc.lineTo(map.right, py); oc.moveTo(px, map.top); oc.lineTo(px, map.bottom); oc.stroke();
    oc.setLineDash([]); oc.globalAlpha = 1;
    oc.beginPath(); oc.arc(px, py, 3.5, 0, 7); oc.fillStyle = cssVar('--surface'); oc.fill(); oc.strokeStyle = cssVar('--ink'); oc.stroke();

    const [x, y] = p, s = a => sampleField(f, a, x, y);
    if (sb) sb.textContent = `L${run.geo ? CFD_LOCS.findIndex((_, k) => cfdRuns[k] === run) + 1 : ''} · x ${(x * 1000).toFixed(2)} mm · y ${(y * 1000).toFixed(3)} mm${fieldInside(f, x, y) ? ` · |V| ${fmtNum(Math.hypot(s(f.u), s(f.v)) * 1000)} mm/s${f.p ? ` · p ${fmtNum(s(f.p))} Pa` : ''}` : ''}`;
    if (!fieldInside(f, x, y)) {
      tip.innerHTML = `<b>x ${(x * 1000).toFixed(2)} mm · y ${(y * 1000).toFixed(3)} mm</b><span class="fv-why">outside the fluid (${f.curv && x > f.xe && y > cfdTopAt(f, x) ? 'air' : 'blade'})</span>`;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (px + 14 + tw > cssW ? px - tw - 14 : px + 14) + 'px';
      tip.style.top = Math.max(0, Math.min(py + 14, cssH - th)) + 'px';
      return;
    }
    const vfloor = f.vmax * 1e-4 * 1000; // below this a velocity component is numerical noise, not flow
    const u = s(f.u) * 1000, v = s(f.v) * 1000, mu = f.mu ? s(f.mu) : null;
    const comp = c => Math.abs(c) < vfloor ? '≈ 0' : fmtNum(c);
    const muTxt = mu == null ? '' : f.hasPlug && mu > f.muCap ? 'μ &gt; cap (unyielded)' : `μ ${fmtNum(mu)} Pa·s`;
    tip.innerHTML = `<b>x ${(x * 1000).toFixed(2)} mm · y ${(y * 1000).toFixed(3)} mm</b>
      <span>|V| ${fmtNum(Math.hypot(u, v))} mm/s</span>
      <span>u_x ${comp(u)} · u_y ${comp(v)} mm/s</span>
      <span>shear ${fmtNum(s(f.shear))} 1/s · ${muTxt}</span>
      ${f.omega ? `<span>ω ${fmtNum(s(f.omega))} 1/s</span>` : ''}
      ${f.p ? `<span>p ${fmtNum(s(f.p))} Pa</span>` : ''}
      ${placeProbes ? '<span class="fv-why">click to place a probe here</span>' : FV.seedMode === 'manual' && FV.streamlines ? '<span class="fv-why">click to add a seed here</span>' : ''}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (px + 14 + tw > cssW ? px - tw - 14 : px + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(py + 14, cssH - th)) + 'px';
  };
  cv.addEventListener('pointermove', probe);
  cv.addEventListener('pointerdown', probe);
  cv.addEventListener('pointerleave', clear);
  cv.addEventListener('click', e => {
    const p = map.toPhys(...at(e));
    if (!p) return;
    if (placeProbes) { addProbe(p[0], p[1]); renderCFD(); return; }
    if (FV.seedMode !== 'manual' || !FV.streamlines) return;
    FV.manualSeeds.push(p);
    renderCFD();
  });
}

function renderLegend() {
  const host = document.getElementById('cfdLegend');
  if (!cfdRuns.some(r => r.field)) { host.innerHTML = ''; return; }
  const items = [];
  if (FV.streamlines) {
    items.push('<span class="lg"><i class="lg-line"></i>streamline (tangent to the velocity; ψ constant along it)</span>');
    if (FV.arrows) items.push('<span class="lg"><i class="lg-arrow"></i>flow direction</span>');
    items.push(`<span class="lg"><i class="lg-seed${FV.seedMode === 'manual' ? ' man' : ''}"></i>${FV.seedMode === 'manual' ? 'your seed' : 'seed'}</span>`);
  }
  if (FV.vectors) items.push(`<span class="lg"><i class="lg-vec"></i>velocity vector${FV.vectorNormalize ? ' (direction only)' : ' (length ∝ |V|)'}</span>`);
  items.push('<span class="lg"><i class="lg-edge"></i>active metering edge</span>');
  items.push('<span class="lg"><i class="lg-line lg-surf"></i>free surface (air above)</span>');
  if (cfdRuns.some(r => r.result && r.result.mode === 'climbed')) items.push('<span class="lg"><i class="lg-seed lg-cl"></i>contact line on the exit face</span>');
  let note = '';
  if (FV.streamlines && FV.seedMode === 'auto') note = 'Automatic seeds are spaced by equal flow rate, so lines crowd where the flow is fast. ';
  if (FV.streamlines && FV.direction !== 'forward' && FV.seedMode === 'auto') note += `Seeds sit ${FV.direction === 'backward' ? 'on the outflow' : 'mid-channel'} for ${FV.direction} tracing. `;
  host.innerHTML = items.join('') + (note ? `<p class="fv-note">${note}</p>` : '');
}

/** Where a point lies, in words: at the web, the blade, the exit face, the free surface, or inside. */
function where(f, loc) {
  const [x, y] = loc, xs = `x ${(x * 1000).toFixed(2)}`;
  const at = f.curv ? f.locate(x, y) : null;
  if (at) {
    const [xi, et] = at;
    if (et < 0.5) return `<small>at the web, ${xs}</small>`;
    if (et > f.ny - 1.5) {
      const i = Math.round(xi);
      if (i <= f.iCorner) return `<small>at the blade, ${xs}</small>`;
      if (i <= f.iCL) return `<small>on the exit face, y ${(y * 1000).toFixed(3)}</small>`;
      return `<small>at the free surface, ${xs}</small>`;
    }
  }
  return `<small>at ${xs}, y ${(y * 1000).toFixed(3)}</small>`;
}

/** Numbers from the stored field (cached per run): residence times, dissipation, field viscosities for Re and Ca. */
function cfdFieldNumbers(run) {
  if (run.fieldNumbers) return run.fieldNumbers;
  const f = run.field, r = run.result, N = f.nx * f.ny, top = (f.ny - 1) * f.nx;
  let dissTot = 0, dissBlade = 0, a = 0, am = 0;
  for (let k = 0; k < N; k++) {
    const w = f.nodeArea[k], under = f.gx[k] <= r.xe;
    dissTot += w * f.dissipation[k];
    if (under) { dissBlade += w * f.dissipation[k]; if (!(f.unyielded && f.unyielded[k])) { a += w; am += w * f.mu[k]; } }
  }
  // free surface within 5 gaps of the contact line: yielded nodes only (an unyielded node's viscosity is the regularization's, not a property)
  let ms = 0, ns = 0, nu = 0;
  for (let i = r.iCL; i < f.nx && f.gx[top + i] <= r.clX + 5 * r.H; i++) { if (f.unyielded && f.unyielded[top + i]) nu++; else { ms += f.mu[top + i]; ns++; } }
  run.fieldNumbers = { res: residenceTimes(f, r.xe), dissTot, dissBlade, muBar: am / a, muS: ns ? ms / ns : null, surfYielded: ns, surfUnyielded: nu };
  return run.fieldNumbers;
}

function renderMetrics() {
  const host = document.getElementById('cfdMetrics');
  const compare = FV.view === 'compare';
  const idx = compare ? CFD_LOCS.map((_, i) => i) : [FV.view];
  if (!idx.some(i => cfdRuns[i].field)) { host.innerHTML = '<p class="cap">No result to measure yet.</p>'; return; }
  const unyieldedPct = r => {
    const f = r.field;
    if (!f.unyielded) return 0;
    let a = 0, tot = 0;
    for (let k = 0; k < f.nx * f.ny; k++) { tot += f.nodeArea[k]; if (f.unyielded[k]) a += f.nodeArea[k]; }
    return a / tot * 100;
  };
  const pAt = (r, key) => where(r.field, r.result[key]);
  // [label, unit, value] -- units live in the label column so the values stay short enough to compare side by side
  const rows = [
    ['Rheology model', '', r => RHEO_MODELS[r.geo.model || 'hb'].l],
    ['Inputs of this run', 'set for this location (others shared)', r => r.geo.own && r.geo.own.length ? r.geo.own.map(k => { const q = LOC_INPUTS.find(x => x.k === k); return `${q.l} ${r.geo.ownVals[k]}${q.u ? ' ' + q.u : ''}`; }).join('<br>') : 'shared'],
    ['Wet film thickness, Q/U', 'mm', r => (r.result.Q / r.geo.U * 1000).toFixed(3)],
    ['Through-flow Q', 'mm²/s per mm width', r => fmtNum(r.metrics.Q * 1e6)],
    ['Mean velocity at the metering edge, Q/H', 'mm/s', r => fmtNum(r.metrics.meanGapVelocity * 1000)],
    ['Max |V|', 'mm/s', r => `${fmtNum(r.metrics.vmax * 1000)} ${where(r.field, r.metrics.vmaxLoc)}`],
    ['Area-mean |V|', 'mm/s', r => fmtNum(r.metrics.meanSpeed * 1000)],
    ['Min |V| inside the fluid', 'mm/s', r => `${fmtNum(r.metrics.vminInterior * 1000)} ${where(r.field, r.metrics.vminLoc)}`],
    ['Max shear rate', '1/s', r => { const [x, y] = r.metrics.gdMaxLoc; return `${fmtNum(r.metrics.gdMax)} ${Math.hypot(x - r.result.xe, y - r.result.H) < 0.3 * r.result.H ? '<small>next to the metering edge corner, where it is singular: this value depends on the mesh</small>' : where(r.field, r.metrics.gdMaxLoc)}`; }],
    ['Meniscus: contact line', 'on the blade', r => r.result.mode === 'climbed'
      ? `${(r.result.sCL * 1000).toFixed(3)} mm up the exit face <small>${(r.result.clY * 1000).toFixed(3)} mm above the web</small>`
      : 'pinned at the metering edge'],
    ['Surface leaves the contact line at', '° from the web, machine direction', r => `${r.result.leaveDeg.toFixed(1)} <small>${r.result.mode === 'climbed' ? `= contact angle ${r.geo.contactDeg.toFixed(1)}° off the face` : `pinned: at most ${r.result.alphaMaxDeg.toFixed(1)} (Gibbs)`}</small>`],
    ['Film at the end of the 2D domain', 'mm, ' + 'x from the edge', r => `${(r.result.hEnd * 1000).toFixed(3)} <small>at ${((r.result.xEnd - r.result.xe) * 1000).toFixed(1)} mm</small>`],
    ['Peak pressure', 'Pa, gauge', r => `${fmtNum(r.result.pMax)} ${pAt(r, 'pMaxLoc')}`],
    ['Lowest pressure', 'Pa, gauge', r => r.result.pMin < 0
      ? `${fmtNum(r.result.pMin)} ${r.result.pMinAtCorner ? '<small>next to the metering edge corner, where pressure is singular: this value depends on the mesh</small>' : pAt(r, 'pMinLoc')}`
      : 'not below ambient'],
    ['Pressure gradient along the web under the edge, −dp/dx', 'kPa/m', r => { const q = r.result, i = q.iCorner; return fmtNum(-(q.pWeb[i + 1] - q.pWeb[i - 1]) / (q.xWeb[i + 1] - q.xWeb[i - 1]) / 1000); }],
    ['Mass check: outflow vs inflow', '% difference', r => (r.result.massError * 100).toFixed(3)],
    ['Reverse flow, u_x < 0', '% of area', r => r.metrics.reverseFraction > 0 ? (r.metrics.reverseFraction * 100).toFixed(2) : 'none'],
    ['Recirculation, closed streamlines', 'mm²', r => r.metrics.recircArea > 0 ? `${fmtNum(r.metrics.recircArea * 1e6)} <small>${(r.metrics.recircFraction * 100).toFixed(1)}% of area</small>` : 'none'],
    ['Stagnation, |V| < 1% of max', 'x, y in mm', r => r.metrics.stagnation.length ? r.metrics.stagnation.slice(0, 4).map(s => `${(s.x * 1000).toFixed(2)}, ${(s.y * 1000).toFixed(3)}`).join('<br>') + (r.metrics.stagnation.length > 4 ? `<br><small>+${r.metrics.stagnation.length - 4} more</small>` : '') : 'none'],
    ['Unyielded fluid, stress below yield', '% of area', r => r.geo.ty > 0 ? (unyieldedPct(r) > 0 ? unyieldedPct(r).toFixed(1) : 'none <small>stress above yield everywhere</small>') : 'none <small>no yield stress</small>'],
    ['Residence time, inlet to the metering edge', 's (fastest · flux-weighted mean · slowest)', r => { const t = cfdFieldNumbers(r).res; return t.n ? `${fmtNum(t.min)} · ${fmtNum(t.mean)} · ${fmtNum(t.max)} <small>${t.n} equal-flux lines${t.turned ? `; ${t.turned} turned back` : ''}</small>` : '—'; }],
    ['Viscous dissipation', 'mW per m of width (under the blade)', r => { const q = cfdFieldNumbers(r); return `${fmtNum(q.dissTot * 1e3)} <small>${fmtNum(q.dissBlade * 1e3)}</small>`; }],
    ['Reynolds number ρUH/μ(U/H)', 'viscosity at the shear rate U/H', r => (RHO * r.geo.U * r.geo.H / r.geo.muRep).toExponential(2)],
    ['Reynolds number from the field, ρQ/μ̄', 'μ̄ = area mean of the yielded fluid under the blade', r => { const q = cfdFieldNumbers(r); return `${(RHO * r.result.Q / q.muBar).toExponential(2)} <small>μ̄ ${fmtNum(q.muBar)} Pa·s</small>`; }],
    ['Capillary number μ(U/H)U/γ', 'viscosity at the shear rate U/H', r => (r.geo.muRep * r.geo.U / r.geo.gamma).toExponential(2)],
    ['Capillary number at the meniscus, μ_s U/γ', 'μ_s = mean along the yielded free surface within 5 gaps of the contact line', r => { const q = cfdFieldNumbers(r); return q.muS == null ? 'surface unyielded there <small>no viscous stress scale: the yield stress holds it</small>' : `${(q.muS * r.geo.U / r.geo.gamma).toExponential(2)} <small>μ_s ${fmtNum(q.muS)} Pa·s${q.surfUnyielded ? `; ${q.surfUnyielded} of ${q.surfUnyielded + q.surfYielded} surface nodes unyielded, left out` : ''}</small>`; }],
    ['Streamline check: ψ drift along lines', '% of ψ range', r => { const sl = FV.streamlines ? streamlinesFor(r) : null; return sl && sl.psiDev != null ? (sl.psiDev * 100).toFixed(3) : '—'; }],
    ['Solver', '', r => `${r.result.converged ? 'converged' : 'partly converged'} <small>${r.result.iterations} Newton steps, residual ${r.result.residual.toExponential(1)}, ${(r.elapsedMs / 1000).toFixed(1)} s</small>`],
  ];
  const head = compare ? `<tr><th>Metric</th>${idx.map(i => `<th>Location ${i + 1}<small>z ${CFD_LOCS[i].z} mm</small></th>`).join('')}</tr>` : '';
  const body = rows.map(([name, unit, fn]) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th>${idx.map(i => `<td>${cfdRuns[i].field ? fn(cfdRuns[i]) : '—'}</td>`).join('')}</tr>`).join('');
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table${compare ? ' cmp' : ''}">${head ? `<thead>${head}</thead>` : ''}<tbody>${body}</tbody></table></div>
    <p class="fv-note">Pressure is gauge pressure, ambient air = 0, including the hydrostatic head; at the free surface it balances surface tension. Left out on purpose: velocity at the active metering edge (a no-slip solid corner, so 0 by definition).</p>`;
}

/** Fibre results: structure from the test report, the slip it gives the gap flow, and the drying air's Darcy numbers. */
function renderFibre() {
  const host = document.getElementById('cfdFibre');
  if (!host) return;
  const compare = FV.view === 'compare', idx = compare ? CFD_LOCS.map((_, i) => i) : [FV.view];
  const st = fibreStructure(), k = fibrePermeability(), sl = fibreSlip(), oa = ovenAir(), air = oa.air;
  // the report's air permeability as a check on k: Darcy across the thickness, air at 20 C, for the two standard test pressures (ISO 9237)
  const note = document.getElementById('cfdFibreNote');
  if (note) note.innerHTML = fibreNote();
  const fib = FIBRES[CFDG.fibre], kTest = dp => airTestK(st.t, dp);
  const um = v => fmtNum(v * 1e6);
  // slip along the web under the blade, from each run
  const slip = r => {
    const q = r.result;
    let s = 0, m = 0, n = 0;
    for (let i = 0; i <= q.iCorner; i++) { const v = (q.uWeb[i] - r.geo.U) / r.geo.U; s += v; m = Math.min(m, v); n++; }
    return `${(s / n * 100).toFixed(3)} <small>most ${(m * 100).toFixed(3)}</small>`;
  };
  const perLoc = [
    ['Slip length / gap, b/H', 'at the metering edge', r => (sl.b / r.geo.H).toExponential(2)],
    ['Slip at the fibre surface under the blade, (u − U)/U', '% (mean; most negative)', r => r.result.uWeb ? slip(r) : '—'],
  ];
  const head = compare ? `<tr><th>Per location</th>${idx.map(i => `<th>Location ${i + 1}<small>z ${CFD_LOCS[i].z} mm</small></th>`).join('')}</tr>` : '';
  const locRows = idx.some(i => cfdRuns[i].field) ? perLoc.map(([name, unit, fn]) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th>${idx.map(i => `<td>${cfdRuns[i].field ? fn(cfdRuns[i]) : '—'}</td>`).join('')}</tr>`).join('') : '';
  const row = (name, unit, val) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th><td${compare ? ` colspan="${idx.length}"` : ''}>${val}</td></tr>`;
  const kFmt = v => Number.isFinite(v) ? `${v.toExponential(2)} <small>${fmtNum(v / 9.869233e-13)} D</small>` : '—';
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table${compare ? ' cmp' : ''}">${head ? `<thead>${head}</thead>` : ''}<tbody>
    ${row('Porosity, 1 − basis weight / (fibre density × thickness)', `${CFDG.gsm} g/m², ${CFDG.rhoF} kg/m³, ${P.tf} mm`, st.ok ? st.eps.toFixed(3) : `<span class="warn-text">${st.eps.toFixed(3)}: not a porosity (basis weight too high for this thickness)</span>`)}
    ${row('Filament diameter', CFDG.dFrom === 'air' ? 'Kozeny–Carman diameter that gives the measured air permeability' : `${CFDG.den} denier yarn, ${CFDG.nf} filaments`, Number.isFinite(st.d) ? `${um(st.d)} µm` : '—')}
    ${row('Permeability k, Kozeny–Carman', 'm² (darcy)', kFmt(k))}
    ${row('Permeability from the report\'s air permeability', `${CFDG.airPerm} ×10⁻³ m³/m²·s across ${P.tf} mm${CFDG.airDP > 0 ? ` at ${CFDG.airDP} Pa` : '; test pressure not stated'}`, CFDG.airDP > 0 ? `${kFmt(kTest(CFDG.airDP))}${CFDG.dFrom === 'air' ? ' <small>(the filament diameter is fitted to it)</small>' : ''}` : `${kFmt(kTest(200))} at 200 Pa<br>${kFmt(kTest(100))} at 100 Pa`)}
    ${row('Top surface: filament spacing', `filament + air gap, air fraction ${CFDG.airFrac}`, `${um(sl.period)} µm`)}
    ${row('Slip length b over the air between filaments', 'µm: along / across the filaments; used (plain weave: mean)', `${um(sl.along)} / ${um(sl.across)}; <b>${um(sl.b)}</b>`)}
    ${locRows}
    ${row('Fibre use temperature', `${fib.l}: continuous${fib.tMom ? ' / momentary' : ''}`, `${fib.tUse}${fib.tMom ? ' / ' + fib.tMom : ''} °C${CFDG.airT > fib.tUse ? ` <span class="warn-text">oven air ${CFDG.airT} °C is above the continuous limit</span>` : ''}`)}
    ${row('Drying air: viscosity, density', `at ${CFDG.airT} °C`, `${(air.mu * 1e6).toFixed(2)} µPa·s, ${air.rho.toFixed(3)} kg/m³`)}
    ${row('Drying air: pressure the plenum needs for this speed', `at the plenum's centre, gauge; ${CFDG.airU} m/s up into the fibre over ${CFDG.plenum} mm, out along the ${P.tf} mm fibre`, st.ok ? `at least <b>${fmtNum(oa.dp / 1e6)} MPa</b> <small>${fmtNum(oa.dpInc / 1e6)} MPa if the air did not compress</small>` : '—')}
    ${row('Drying air: speed along the fibre where it leaves', "at the plenum's edges", st.ok ? `${fmtNum(oa.uEdge)} m/s` : '—')}
    ${row('Drying air: pore Reynolds number there, ρ(u/ε)d/μ', '', st.ok ? `${fmtNum(oa.ReEdge)} <small>${oa.ReEdge < 1 ? "Darcy's law holds (below 1)" : "above 1: inertial losses add to Darcy's, so the pressure above is a least value"}</small>` : '—')}
  </tbody></table></div>
    <p class="fv-note">The fibre's pores are dry: the slurry rests on the top filaments and nothing crosses the web surface (at over 40 vol% solids the gaps between the slurry's own 2–8 µm particles are finer than the fibre's pores, so capillarity keeps the liquid in the slurry). Over the air between the filaments the slurry slips: filaments as no-slip stripes, air as shear-free ones (Philip 1972). The drying air comes up into the fibre from a plenum below, but the wet film seals the fibre's top, so it can only leave along the fibre's ${P.tf} mm to the plenum's edges (taken as its exit: the shortest path it could have). The pressure above is what the set speed needs for that (Darcy along the fibre, the air compressing as the pressure rises); a plenum at a realistic pressure moves the air in the fibre far slower, so under the film it is nearly still.</p>`;
}

// ---- across the web: the four locations side by side ----

// Location colours (categorical slots 1-4 of the dataviz reference palette,
// validated on this app's surfaces: light #fff -- two slots below 3:1, so
// every chart carries direct labels and a table -- and dark #161b22).
const LOC_COLORS = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500'] };
const locColor = i => LOC_COLORS[isDarkTheme() ? 'dark' : 'light'][i];
const ACROSS = {
  film: { l: 'Wet film thickness, Q/U', u: 'mm', f: r => r.result.Q / r.geo.U * 1000 },
  gap: { l: 'Gap at the metering edge', u: 'mm', f: r => r.geo.H * 1000 },
  ratio: { l: 'Wet film / gap', u: '', f: r => r.result.Q / r.geo.U / r.geo.H },
  cl: { l: 'Contact line height above the web', u: 'mm', f: r => r.result.clY * 1000 },
  pmax: { l: 'Peak pressure', u: 'Pa', f: r => r.result.pMax },
  vmax: { l: 'Max |V|', u: 'mm/s', f: r => r.metrics.vmax * 1000 },
  tres: { l: 'Residence time to the edge, flux-weighted mean', u: 's', f: r => cfdFieldNumbers(r).res.mean },
  diss: { l: 'Viscous dissipation', u: 'mW per m width', f: r => cfdFieldNumbers(r).dissTot * 1000 },
  q: { l: 'Through-flow Q', u: 'mm²/s', f: r => r.result.Q * 1e6 },
};

/** Direct labels at the right-hand ends of the series: a short line in the series colour, the name in ink, nudged apart. */
function endLabels(cv, map, series) {
  const c = cv.getContext('2d'), ink = cssVar('--ink');
  const items = series.filter(s => s.pts.length).map(s => { const [x, y] = s.pts[s.pts.length - 1]; return { s, x: map.X(x), y: map.Y(y) }; }).sort((a, b) => a.y - b.y);
  for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < 13) items[k].y = items[k - 1].y + 13;
  // keep the stack inside the plot: shift it up if it runs past the bottom, down if past the top
  const over = items.length ? items[items.length - 1].y - (map.rect.b - 7) : 0;
  if (over > 0) items.forEach(it => { it.y -= over; });
  const under = items.length ? map.rect.t + 7 - items[0].y : 0;
  if (under > 0) items.forEach(it => { it.y += under; });
  c.font = `11px ${cssVar('--mono')}`; c.textBaseline = 'middle'; c.textAlign = 'left';
  for (const it of items) {
    const x = Math.min(it.x + 4, map.rect.r - 34);
    c.strokeStyle = it.s.color; c.lineWidth = 2; c.beginPath(); c.moveTo(x, it.y); c.lineTo(x + 10, it.y); c.stroke();
    labelOn(c, it.s.short, x + 13, it.y, ink, 'left');
  }
}

/**
 * Hover read-out for a chart: a guide line and a tooltip with each series'
 * value at the pointer (interpolated along the independent axis 'x' or 'y').
 */
function chartHover(wrap, cv, map, series, o) {
  const tip = wrap.querySelector('.fv-tip'), guide = wrap.querySelector('.xl-guide');
  const along = (pts, t) => {
    const i0 = o.by === 'y' ? 1 : 0, i1 = 1 - i0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1][i0], b = pts[k][i0];
      if ((t - a) * (t - b) <= 0 && a !== b) return pts[k - 1][i1] + (t - a) / (b - a) * (pts[k][i1] - pts[k - 1][i1]);
    }
    return null;
  };
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < map.rect.l || px > map.rect.r || py < map.rect.t || py > map.rect.b) { tip.hidden = true; guide.hidden = true; return; }
    const t = o.by === 'y' ? map.invY(py) : map.invX(px);
    const rows = series.map(s => { const v = along(s.pts, t); return v == null ? '' : `<span><i class="xl-sw" style="background:${s.color}"></i>${s.name}: ${o.fmt(v)}</span>`; }).join('');
    if (!rows) { tip.hidden = true; guide.hidden = true; return; }
    tip.innerHTML = `<b>${o.head(t)}</b>${rows}`;
    tip.hidden = false;
    guide.hidden = false;
    if (o.by === 'y') Object.assign(guide.style, { left: map.rect.l + 'px', width: (map.rect.r - map.rect.l) + 'px', top: py + 'px', height: '1px' });
    else Object.assign(guide.style, { left: px + 'px', width: '1px', top: map.rect.t + 'px', height: (map.rect.b - map.rect.t) + 'px' });
    const tw = tip.offsetWidth, th = tip.offsetHeight, W = cv.clientWidth, Hh = cv.clientHeight;
    tip.style.left = (px + 14 + tw > W ? px - tw - 14 : px + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(py + 14, Hh - th)) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; guide.hidden = true; });
}

function renderAcross() {
  const host = document.getElementById('cfdAcross');
  if (!host) return;
  const locs = CFD_LOCS.map((_, i) => i).filter(i => cfdRuns[i].field);
  if (locs.length < 2) { host.innerHTML = '<p class="cap">Needs at least two solved locations.</p>'; return; }
  const m = ACROSS[FV.across], stale = i => cfdIsStale(i);
  const name = i => `Location ${i + 1} · z ${CFD_LOCS[i].z} mm${stale(i) ? ' (out of date)' : ''}`;
  const legend = `<div class="xl-legend">${locs.map(i => `<span class="lg"><i class="xl-sw" style="background:${locColor(i)}"></i>${name(i)}</span>`).join('')}</div>`;
  const chart = id => `<div class="xl-chart"><canvas id="${id}" role="img"></canvas><div class="xl-guide" hidden></div><div class="fv-tip" hidden></div></div>`;
  const vals = locs.map(i => ({ i, z: CFD_LOCS[i].z, v: m.f(cfdRuns[i]) }));
  host.innerHTML = `${legend}
    <div class="dock-grid">
    <figure class="dock-fig">${chart('xlMetricChart')}
    <div class="table-wrap"><table class="cfd-table xl-table"><thead><tr><th>${m.l}${m.u ? `<small>${m.u}</small>` : ''}</th>${vals.map(o => `<th><i class="xl-sw" style="background:${locColor(o.i)}"></i> L${o.i + 1}<small>z ${o.z} mm</small></th>`).join('')}</tr></thead>
      <tbody><tr><th scope="row">value</th>${vals.map(o => `<td>${fmtNum(o.v)}${stale(o.i) ? ' <small>out of date</small>' : ''}</td>`).join('')}</tr></tbody></table></div>
    <p class="cap"><b>${m.l}</b> at each location's position across the web${FV.across === 'film' || FV.across === 'gap' ? ' (the gap varies with the blade waviness and fibre-thickness variation set in the sidebar, or a location\'s own gap)' : ''}.</p></figure>
    <figure class="dock-fig">${chart('xlSurf')}
    <p class="cap"><b>Free surface</b> from the contact line into the film: height above the web against distance downstream of the metering edge.</p></figure>
    <figure class="dock-fig">${chart('xlPress')}
    <p class="cap"><b>Pressure along the web</b>, inlet to the end of the 2D domain (the dotted line marks the metering edge).</p></figure>
    <figure class="dock-fig">${chart('xlProf')}
    <p class="cap"><b>u(y) just upstream of the metering edge</b> (0.3 gap before it).</p></figure>
    </div>`;

  // 1. the chosen quantity against z: markers in the location colours, a neutral line joining them in z order
  {
    const cv = document.getElementById('xlMetricChart'), pts = vals.slice().sort((a, b) => a.z - b.z);
    let lo = Math.min(...pts.map(o => o.v)), hi = Math.max(...pts.map(o => o.v));
    const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad;
    cv.setAttribute('aria-label', `${m.l} against position across the web`);
    const map = plotChart(cv, 0.32, { x0: 0, x1: CFD_WEB_WIDTH_MM, y0: lo, y1: hi, xl: 'z across the web (mm)', yl: `${m.l}${m.u ? ' (' + m.u + ')' : ''}`, xd: 0, yd: Math.max(0, Math.min(4, 2 - Math.floor(Math.log10(hi - lo || 1)))),
      s: [{ p: pts.map(o => [o.z, o.v]), c: cssVar('--muted'), w: 1.5 }] });
    const c = cv.getContext('2d'), surf = cssVar('--surface'), ink = cssVar('--ink');
    c.font = `11px ${cssVar('--mono')}`; c.textBaseline = 'middle';
    for (const o of pts) {
      const x = map.X(o.z), y = map.Y(o.v);
      c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = stale(o.i) ? surf : locColor(o.i); c.fill();
      c.lineWidth = 2; c.strokeStyle = stale(o.i) ? locColor(o.i) : surf; c.stroke();
      labelOn(c, `L${o.i + 1}`, x + 8, y - 11, ink, 'left');
    }
    const wrap = cv.parentElement, tip = wrap.querySelector('.fv-tip');
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const near = pts.reduce((a, o) => Math.abs(map.X(o.z) - px) < Math.abs(map.X(a.z) - px) ? o : a);
      if (Math.abs(map.X(near.z) - px) > 30 || py < map.rect.t - 10 || py > map.rect.b + 10) { tip.hidden = true; return; }
      tip.innerHTML = `<b><i class="xl-sw" style="background:${locColor(near.i)}"></i> ${name(near.i)}</b><span>${m.l}: ${fmtNum(near.v)}${m.u ? ' ' + m.u : ''}</span>`;
      tip.hidden = false;
      const tw = tip.offsetWidth, x = map.X(near.z);
      tip.style.left = (x + 14 + tw > cv.clientWidth ? x - tw - 14 : x + 14) + 'px'; tip.style.top = Math.max(0, map.Y(near.v) - 10) + 'px';
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  }

  // 2-4. overlays, one series per location
  const overlay = (id, aspect, series, o) => {
    const cv = document.getElementById(id);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of series) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (o.y0 != null) y0 = o.y0;
    const pad = 0.06 * (y1 - y0 || 1);
    cv.setAttribute('aria-label', o.aria);
    const map = plotChart(cv, aspect, { x0: o.x0 ?? x0, x1: o.x1 ?? x1, y0: o.y0 ?? y0 - pad, y1: y1 + pad, xl: o.xl, yl: o.yl, xd: o.xd ?? 0, yd: o.yd ?? 2,
      s: series.map(s => ({ p: s.pts, c: s.color, w: 2, dash: s.stale ? [4, 3] : null })), vl: o.vl || [] });
    endLabels(cv, map, series);
    chartHover(cv.parentElement, cv, map, series, o);
  };
  const ser = (i, pts) => ({ name: name(i), short: `L${i + 1}`, color: locColor(i), stale: stale(i), pts });
  overlay('xlSurf', 0.32, locs.map(i => { const r = cfdRuns[i].result, pts = []; for (let k = r.iCL; k < r.nx; k++) pts.push([(r.xTop[k] - r.xe) * 1000, r.yTop[k] * 1000]); return ser(i, pts); }),
    { aria: 'Free surface shape at each location', xl: 'distance downstream of the metering edge (mm)', yl: 'height above the web (mm)', xd: 1, yd: 2, y0: 0, by: 'x', head: t => `${t.toFixed(2)} mm from the edge`, fmt: v => v.toFixed(3) + ' mm' });
  overlay('xlPress', 0.32, locs.map(i => { const r = cfdRuns[i].result; return ser(i, r.xWeb.map((x, k) => [x * 1000, r.pWeb[k]])); }),
    { aria: 'Pressure along the web at each location', xl: 'x (mm), inlet → metering edge → film', yl: 'pressure along the web (Pa)', xd: 0, yd: 0, by: 'x', head: t => `x ${t.toFixed(2)} mm`, fmt: v => fmtNum(v) + ' Pa',
      vl: [{ x: cfdRuns[locs[0]].result.xe * 1000, c: cssVar('--line'), t: 'edge' }] });
  overlay('xlProf', 0.4, locs.map(i => { const run = cfdRuns[i], x = run.result.xe - 0.3 * run.geo.H; return ser(i, cfdColumn(run.field, run.field.u, x).map(([u, y]) => [u * 1000, y * 1000])); }),
    { aria: 'Velocity profile just upstream of the metering edge at each location', xl: 'velocity u (mm/s)', yl: 'height above the web y (mm)', xd: 1, yd: 2, y0: 0, by: 'y', head: t => `y ${t.toFixed(3)} mm`, fmt: v => fmtNum(v) + ' mm/s' });
}

// ---- convergence: the residual at every Newton iterate, through every solve a run needed ----

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const pow10Label = e => '10' + String(Math.round(e)).split('').map(ch => SUP[ch]).join('');
const TOL_EXP = -8;       // solveFEM's tolerance, 1e-8: the solves a result comes from end below it

function renderConvergence() {
  const host = document.getElementById('cfdConv');
  if (!host) return;
  const compare = FV.view === 'compare';
  const locs = (compare ? CFD_LOCS.map((_, i) => i) : [FV.view]).filter(i => cfdRuns[i].field && cfdRuns[i].result.trace);
  if (!locs.length) { host.innerHTML = `<p class="cap">${compare ? 'No location has a result yet.' : `Location ${FV.view + 1} has no result yet.`}</p>`; return; }
  const stale = i => cfdIsStale(i), tr = i => cfdRuns[i].result.trace;
  const name = i => `Location ${i + 1} · z ${CFD_LOCS[i].z} mm${stale(i) ? ' (out of date)' : ''}`;
  const lg10 = v => Math.log10(Math.max(v, 1e-16));
  const series = locs.map(i => ({ i, name: name(i), short: `L${i + 1}`, color: locColor(i), stale: stale(i), pts: tr(i).r.map((v, k) => [k + 1, lg10(v)]) }));
  const solveAt = (t, k) => t.solves.findIndex(sv => k > sv.k0 && k <= sv.k0 + sv.n);
  const fmtE = v => Number.isFinite(v) ? v.toExponential(1) : '—';
  const one = !compare, t0 = tr(locs[0]);

  const rows = [
    ['Solves run', i => { const t = tr(i); return `${t.solves.length}<small>${t.solves.filter(sv => sv.converged).length} converged</small>`; }],
    ['Newton iterates, all solves', i => `${tr(i).r.length}`],
    ['Solution shown', i => { const t = tr(i), u = t.solves[t.used]; return u ? `solve ${t.used + 1}<small>${u.label}</small>` : '—'; }],
    ['Its iterates', i => { const u = tr(i).solves[tr(i).used]; return u ? `${u.n}` : '—'; }],
    ['Its final residual', i => { const u = tr(i).solves[tr(i).used]; return u ? fmtE(u.residual) : '—'; }],
    ['Wall time', i => `${(cfdRuns[i].elapsedMs / 1000).toFixed(1)} s`],
  ];
  const table = `<div class="table-wrap"><table class="cfd-table${compare ? ' cmp' : ''}"><thead><tr><th></th>${locs.map(i => `<th>${compare ? `<i class="xl-sw" style="background:${locColor(i)}"></i> ` : ''}Location ${i + 1}<small>z ${CFD_LOCS[i].z} mm${stale(i) ? ' · out of date' : ''}</small></th>`).join('')}</tr></thead>
    <tbody>${rows.map(([l, f]) => `<tr><th scope="row">${l}</th>${locs.map(i => `<td>${f(i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const seq = one ? `<details class="fv-more" id="convSeq"${FV.convOpen ? ' open' : ''}><summary>Solve sequence (${t0.solves.length} solves)</summary>
    <div class="table-wrap"><table class="cfd-table cmp conv-seq"><thead><tr><th>#</th><th>Solve</th><th>Iterates</th><th>First residual</th><th>Final residual</th><th>Converged</th></tr></thead>
    <tbody>${t0.solves.map((sv, k) => `<tr${k === t0.used ? ' class="conv-used"' : ''}><td>${k + 1}</td><th scope="row">${sv.label}${k === t0.used ? '<small>solution shown</small>' : ''}</th><td>${sv.n}</td><td>${fmtE(t0.r[sv.k0])}</td><td>${fmtE(sv.residual)}</td><td>${sv.converged ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  const later = one && t0.used >= 0 && t0.used < t0.solves.length - 1
    ? ` Solve ${t0.used + 1} of ${t0.solves.length} gives the solution shown; the solves after it did not replace it (see the sequence).` : '';
  host.innerHTML = `${compare && locs.length > 1 ? `<div class="xl-legend">${locs.map(i => `<span class="lg"><i class="xl-sw" style="background:${locColor(i)}"></i>${name(i)}</span>`).join('')}</div>` : ''}
    <div class="xl-chart"><canvas id="convChart" role="img"></canvas><div class="xl-guide" hidden></div><div class="fv-tip" hidden></div></div>
    <p class="cap"><b>Residual at each Newton iterate</b> (largest equation residual, in the solver's scaled units), through every solve the run needed, in order: the meniscus pinned at the edge first, then — if the surface climbs the exit face — the contact line released onto it${one ? ' (shaded bands: one solve each)' : ''}. Each solve starts afresh on a new mesh or condition, so its residual jumps up and falls again. Within a solve, continuation steps (Newtonian to the chosen viscosity law; homotopy from the starting shape) converge intermediate problems loosely before the last one to the tolerance (dashed). Ringed: the end of the solve whose solution is shown.${later}</p>
    ${table}${seq}`;
  const det = document.getElementById('convSeq');
  if (det) det.addEventListener('toggle', e => { FV.convOpen = e.target.open; });

  const cv = document.getElementById('convChart');
  let lo = Infinity, hi = -Infinity, nMax = 1;
  for (const sr of series) for (const [k, v] of sr.pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); nMax = Math.max(nMax, k); }
  hi = Math.ceil(hi); lo = Math.min(Math.floor(lo), TOL_EXP - 1);
  lo = hi - 4 * Math.ceil((hi - lo) / 4);                  // five ticks on whole powers of ten
  const soft = cssVar('--soft');
  const bands = one ? t0.solves.filter((_, k) => k % 2 === 0).map(sv => ({ x0: sv.k0 + 0.5, x1: sv.k0 + sv.n + 0.5, c: soft })) : [];
  cv.setAttribute('aria-label', `Newton residual history, ${locs.map(i => `location ${i + 1}`).join(', ')}`);
  const map = plotChart(cv, 0.36, { x0: 0.5, x1: nMax + 0.5, y0: lo, y1: hi, xl: 'Newton iterate, all solves in sequence', yl: 'residual (scaled)', xd: 0, yf: pow10Label, bands,
    s: series.map(sr => ({ p: sr.pts, c: sr.color, w: 2, dash: sr.stale ? [4, 3] : null })),
    hl: [{ y: TOL_EXP, c: cssVar('--muted'), t: '' }] });
  // (the tolerance line's label at the left, clear of the end labels and the ring)
  const c = cv.getContext('2d'), surf = cssVar('--surface'), ink = cssVar('--ink');
  c.font = `11px ${cssVar('--mono')}`; c.textBaseline = 'middle';
  labelOn(c, `tolerance ${pow10Label(TOL_EXP)}`, map.rect.l + 6, map.Y(TOL_EXP) - 8, cssVar('--muted'), 'left');
  // the end of the solve each result comes from: a ring
  for (const sr of series) {
    const t = tr(sr.i), u = t.solves[t.used];
    if (!u || !u.n) continue;
    const [k, v] = sr.pts[u.k0 + u.n - 1], x = map.X(k), y = map.Y(v);
    c.beginPath(); c.arc(x, y, 5, 0, 7); c.fillStyle = sr.color; c.fill(); c.lineWidth = 2; c.strokeStyle = surf; c.stroke();
    if (one) { labelOn(c, 'solution shown', x + 8, Math.max(map.rect.t + 8, y - 12), ink, x > map.rect.r - 120 ? 'right' : 'left'); }
  }
  if (compare && series.length > 1) endLabels(cv, map, series);

  // hover: the iterate under the pointer, each location's residual there and which solve it belongs to
  const wrap = cv.parentElement, tip = wrap.querySelector('.fv-tip'), guide = wrap.querySelector('.xl-guide');
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const k = Math.round(map.invX(px));
    if (px < map.rect.l || px > map.rect.r || py < map.rect.t || py > map.rect.b || k < 1 || k > nMax) { tip.hidden = true; guide.hidden = true; return; }
    const lines = series.filter(sr => k <= sr.pts.length).map(sr => {
      const t = tr(sr.i), j = solveAt(t, k), sv = t.solves[j];
      return `<span><i class="xl-sw" style="background:${sr.color}"></i>${compare ? sr.short + ': ' : ''}${fmtE(t.r[k - 1])}${sv ? `<small style="display:block">solve ${j + 1}: ${sv.label}</small>` : ''}</span>`;
    }).join('');
    if (!lines) { tip.hidden = true; guide.hidden = true; return; }
    tip.innerHTML = `<b>iterate ${k}</b>${lines}`;
    tip.hidden = false; guide.hidden = false;
    const gx = map.X(k);
    Object.assign(guide.style, { left: gx + 'px', width: '1px', top: map.rect.t + 'px', height: (map.rect.b - map.rect.t) + 'px' });
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (gx + 14 + tw > cv.clientWidth ? gx - tw - 14 : gx + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(py + 14, cv.clientHeight - th)) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; guide.hidden = true; });
}

// ---- profiles for one location ----

/** Height of the top boundary at x (m) beyond the metering edge (free surface or face); for telling air from blade. */
function cfdTopAt(f, x) {
  const top = (f.ny - 1) * f.nx;
  let best = 0;
  for (let i = f.iCorner; i < f.nx - 1; i++) {
    const x0 = f.gx[top + i], x1 = f.gx[top + i + 1];
    if ((x - x0) * (x - x1) <= 0) { const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0); best = Math.max(best, f.gy[top + i] + t * (f.gy[top + i + 1] - f.gy[top + i])); }
  }
  return best;
}

/** Blade height above the web at x (m), 0 <= x <= metering edge: the mesh's top boundary there. */
function cfdBladeAt(f, x) {
  const top = (f.ny - 1) * f.nx;
  let i = 0;
  while (i < f.iCorner - 1 && f.gx[top + i + 1] < x) i++;
  const x0 = f.gx[top + i], x1 = f.gx[top + i + 1], t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return f.gy[top + i] + t * (f.gy[top + i + 1] - f.gy[top + i]);
}

/** A field sampled up a vertical line at x under the blade, web to blade: [[value, y], ...]. */
function cfdColumn(f, arr, x, n = 41) {
  const hb = cfdBladeAt(f, x), out = [];
  for (let k = 0; k < n; k++) { const y = hb * k / (n - 1); out.push([sampleField(f, arr, x, y), y]); }
  return out;
}

/** Stations to sample profiles at (x, m): near the inlet / part way, mid-way, and just upstream of the metering edge. */
function profileStations(run) {
  const xe = run.result.xe, H = run.geo.H;
  return run.geo.shape === 'round' ? [0.35 * xe, 0.8 * xe, xe - 0.3 * H] : [0.1 * xe, 0.5 * xe, xe - 0.3 * H];
}

/**
 * u(y) across the gap at three stations (light to dark = inlet to edge).
 * Flat land: against the exact fully developed profile (dashed) for the
 * pressure gradient the solution has at mid-land -- they must coincide
 * there. Round entry: the profile turns from returning flow near the pool
 * to the metered profile at the edge.
 */
function drawVelocityProfile(cv, run) {
  const r = run.result, f = run.field, geo = run.geo, st = profileStations(run);
  const cols = st.map(x => cfdColumn(f, f.u, x));
  let umax = geo.U, umin = 0, ymax = 0;
  for (const col of cols) for (const [u, y] of col) { umax = Math.max(umax, u); umin = Math.min(umin, u); ymax = Math.max(ymax, y); }
  const lut = getLut('seq'), shade = k => lutColor(lut, 0.35 + 0.65 * k / (st.length - 1));
  const series = [];
  if (r.prof1D) series.push({ p: r.prof1D.y.map((y, j) => [r.prof1D.u[j] * 1000, y * 1000]), c: cssVar('--muted'), w: 4, dash: [1, 3] });
  cols.forEach((col, k) => series.push({ p: col.map(([u, y]) => [u * 1000, y * 1000]), c: shade(k), w: 1.8 }));
  const ax = plotChart(cv, 0.5, {
    x0: Math.min(umin, 0) * 1000 * 1.1, x1: umax * 1000 * 1.1, y0: 0, y1: ymax * 1000,
    xl: 'velocity u (mm/s)', yl: 'height above the web y (mm)', xd: 1, yd: 2, s: series,
  });
  // label each station at its top end (just under the blade)
  const c = cv.getContext('2d');
  c.font = `11px ${cssVar('--mono')}`; c.textAlign = 'left'; c.textBaseline = 'middle';
  cols.forEach((col, k) => {
    const [u, y] = col[Math.round((col.length - 1) * 0.88)];
    labelOn(c, `x ${(st[k] * 1000).toFixed(1)}`, ax.X(u * 1000) + 6, ax.Y(y * 1000), shade(k), 'left');
  });
}

/**
 * Apparent viscosity across the gap just upstream of the metering edge
 * (flat land: mid-land). Where the stress is below the yield stress the
 * fluid is unyielded and the solver's viscosity there is its regularized
 * (large, finite) value: those points are pinned at the capped edge instead
 * of setting the axis.
 */
function drawViscosityProfile(cv, run) {
  const f = run.field, geo = run.geo, x = profileStations(run)[geo.shape === 'round' ? 2 : 1];
  const muCap = f.muCap || geo.muRep, col = cfdColumn(f, f.mu, x);
  plotChart(cv, 0.4, {
    x0: 0, x1: muCap, y0: 0, y1: col[col.length - 1][1] * 1000,
    xl: 'apparent viscosity (Pa·s)' + (f.hasPlug ? ', capped' : ''), yl: 'height above the web y (mm)', xd: 1, yd: 2,
    s: [{ p: col.map(([m, y]) => [Math.min(m, muCap), y * 1000]), c: cssVar('--accent'), w: 2 }],
    vl: f.hasPlug ? [{ x: muCap, c: cssVar('--warn'), t: '' }] : [],
  });
}

/** Pressure along the web and along the top boundary (blade, exit face, free surface), inlet to the end of the 2D domain. */
function drawPressureProfile(cv, run) {
  const r = run.result, f = run.field;
  const web = r.xWeb.map((x, i) => [x * 1000, r.pWeb[i]]), top = r.xTop.map((x, i) => [x * 1000, r.pTop[i]]);
  // axis from the pressures away from the edge corner (singular there)
  let lo = 0, hi = run.geo.Pup;
  const skip = (x, y) => Math.hypot(x - r.xe, y - r.H) < 0.3 * r.H;
  for (let i = 0; i < f.nx; i++) {
    if (!skip(r.xWeb[i], 0)) { lo = Math.min(lo, r.pWeb[i]); hi = Math.max(hi, r.pWeb[i]); }
    if (!skip(r.xTop[i], r.yTop[i])) { lo = Math.min(lo, r.pTop[i]); hi = Math.max(hi, r.pTop[i]); }
  }
  const pad = 0.08 * (hi - lo || 1);
  plotChart(cv, 0.4, {
    x0: 0, x1: f.Lx * 1000, y0: lo - pad, y1: hi + pad,
    xl: 'x (mm), inlet → metering edge → film', yl: 'pressure (Pa, gauge)', xd: 0, yd: 0,
    s: [{ p: top, c: cssVar('--muted'), w: 3.5, dash: [2, 3] }, { p: web, c: cssVar('--accent'), w: 1.8 }],
    hl: [{ y: run.geo.Pup, c: cssVar('--muted'), t: 'bead pressure' }],
    vl: [{ x: r.xe * 1000, c: cssVar('--line'), t: 'edge' }],
  });
}

/** Film height from the edge to the oven: the 2D free surface, then the 1D film model from the end of the 2D domain, toward h_inf = Q/U. */
function drawDownstreamFilm(cv, run) {
  const r = run.result, film = r.film, geo = run.geo;
  const surf = [];
  for (let i = r.iCL; i < r.nx; i++) surf.push([(r.xTop[i] - r.xe) * 1000, r.yTop[i] * 1000]);
  const pts = film.x ? film.x.map((x, i) => [(x + r.filmStart) * 1000, film.h[i] * 1000]) : [];
  let hMax = geo.H;
  for (const [, h] of surf.concat(pts)) hMax = Math.max(hMax, h);
  plotChart(cv, 0.4, {
    x0: 0, x1: geo.ovenDistance * 1000, y0: 0, y1: hMax * 1.15,
    xl: 'distance downstream of the metering edge (mm)', yl: 'film height (mm)', xd: 0, yd: 2,
    s: [{ p: surf, c: cssVar('--ink'), w: 2.2 }, { p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: r.Q / geo.U * 1000, c: cssVar('--muted'), t: 'h∞ = Q/U (mass conservation)' }],
  });
}

function renderProfiles() {
  const host = document.getElementById('cfdProfiles');
  const i = FV.view === 'compare' ? FV.profileLoc : FV.view;
  document.getElementById('cfdProfTitle').textContent = `Profiles · Location ${i + 1}` + (FV.view === 'compare' ? ' (pick a single location above to change)' : '');
  const run = cfdRuns[i];
  if (!run.field) { host.innerHTML = '<p class="cap">No result for this location yet.</p>'; return; }
  const r = run.result, geo = run.geo, round = geo.shape === 'round';
  const qDiff = (r.Q / r.qLub - 1) * 100;
  const lubNote = `${Math.abs(qDiff).toFixed(1)}% ${qDiff > 0 ? 'above' : 'below'} the one-viscosity lubrication estimate for the same bead pressure and zero pressure at the edge (the meniscus sets the real edge pressure${geo.ty === 0 && geo.n === 1 ? '' : ', and this fluid\'s viscosity varies across the gap'})`;

  const filmOk = !!r.film.x;
  const hOven = filmOk ? r.film.h[r.film.h.length - 1] : null;
  host.innerHTML = `
    <div class="stats dock-stats">${[
      ['Wet film, Q/U', (r.Q / geo.U * 1000).toFixed(3) + ' mm'],
      ['Film at oven', filmOk ? (hOven * 1000).toFixed(3) + ' mm' + (r.film.converged ? '' : ' (still relaxing)') : '—'],
      ['Gap at edge / film', filmOk ? (geo.H / hOven).toFixed(3) : '—'],
      ['Lubrication estimate, one viscosity', (r.qLub / geo.U * 1000).toFixed(3) + ' mm'],
      ...(round ? [] : [['physics.js filmThickness()', (filmThickness(geo.H * 1000)).toFixed(3) + ' mm']]),
    ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('')}</div>
    <div class="dock-grid">
      <figure class="dock-fig"><canvas id="cfdProfile" role="img" aria-label="Velocity profiles across the gap at three stations"></canvas>
      <p class="cap"><b>u(y) at three stations</b>, light to dark from ${round ? 'the pool side' : 'the inlet'} to just upstream of the metering edge${r.prof1D ? `, against the exact fully developed profile (dashed) for the pressure gradient (${fmtNum(r.prof1D.G / 1000)} kPa/m) and fibre-surface velocity (slip ${((r.prof1D.uWall / geo.U - 1) * 100).toFixed(2)}% of U) the solution has at mid-land: they must coincide there` : '. Negative u near the blade is flow turning back toward the pool'}. Flow rate ${lubNote}.</p></figure>
      <figure class="dock-fig"><canvas id="cfdPress" role="img" aria-label="Pressure along the web and the top boundary"></canvas>
      <p class="cap"><b>Pressure along the flow</b>: along the web (solid) and along the top boundary (dashed: blade, exit face, then the free surface, where it balances surface tension), from the bead pressure at the inlet, through the metering edge, into the film.${round ? ' The web drags slurry into the narrowing gap, which builds pressure above the bead pressure before it falls toward the edge.' : ''} The axis leaves out the edge corner itself, where pressure is singular.</p></figure>
      <figure class="dock-fig"><canvas id="cfdVisc" role="img" aria-label="Apparent viscosity across the gap"></canvas>
      <p class="cap"><b>Apparent viscosity across the gap</b> ${round ? 'just upstream of the metering edge' : 'at mid-land'}. Flat when Newtonian; higher toward the low-shear core with shear-thinning or yield stress. Fluid whose stress is below the yield stress (unyielded) is pinned at the capped edge.</p></figure>
      <figure class="dock-fig"><canvas id="cfdFilm" role="img" aria-label="Film height from the metering edge to the oven"></canvas>
      <p class="cap"><b>Film from the metering edge to the oven</b> (${(geo.ovenDistance * 1000).toFixed(0)} mm): the 2D free surface (dark, from the contact line), then ${filmOk ? `the Slurry animation tab's 1D free-surface method from ${(r.filmStart * 1000).toFixed(1)} mm on, driven by this run's flow rate` : `no 1D film (${r.film.error || 'unknown error'})`}. Dashed: where mass conservation says it must end up.</p></figure>
    </div>`;
  drawVelocityProfile(document.getElementById('cfdProfile'), run);
  drawPressureProfile(document.getElementById('cfdPress'), run);
  drawViscosityProfile(document.getElementById('cfdVisc'), run);
  drawDownstreamFilm(document.getElementById('cfdFilm'), run);
}
