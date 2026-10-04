/*
 * tree.js — the inputs bar made easier to scan: a line icon for every input, tinted by its group;
 * the inputs a tab does not use dimmed (with the reason on hover); and, when the bar is collapsed,
 * an icon rail whose group icons open that group as a flyout.
 */

// ---- icons: 16 × 16 line drawings (currentColor) ----
const S = 'fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"';
const PICON = {
  speed: `<path d="M2 8h9.5M8.5 5l3 3-3 3" ${S}/><path d="M2 5h3.5M2 11h3.5" ${S} opacity=".55"/>`,
  height: `<path d="M8 2.5v11M5.5 5 8 2.5 10.5 5M5.5 11 8 13.5 10.5 11" ${S}/><path d="M2.5 13.5h11" ${S} opacity=".55"/>`,
  thickness: `<path d="M2 5.5h12M2 10.5h12" ${S}/><path d="M8 5.5v5" ${S} opacity=".55"/><path d="M6.8 7 8 5.8 9.2 7M6.8 9 8 10.2 9.2 9" ${S} opacity=".55"/>`,
  oven: `<rect x="2.5" y="5.5" width="11" height="8" rx="1.5" ${S}/><path d="M5.5 2.5c.8.9-.8 1.6 0 2.5M8 2.5c.8.9-.8 1.6 0 2.5M10.5 2.5c.8.9-.8 1.6 0 2.5" ${S} opacity=".6"/>`,
  drop: `<path d="M8 2.2c2.4 3 4 5.1 4 7.1a4 4 0 0 1-8 0c0-2 1.6-4.1 4-7.1z" ${S}/>`,
  thinning: `<path d="M2.5 2.5v11h11" ${S} opacity=".55"/><path d="M3.5 4c2.5 0 3.5 6 9.5 7.5" ${S}/>`,
  yield: `<path d="M8 2.2c2.4 3 4 5.1 4 7.1a4 4 0 0 1-8 0c0-2 1.6-4.1 4-7.1z" ${S}/><path d="M5 9.5h6" ${S}/>`,
  tension: `<path d="M2.5 3v10M13.5 3v10" ${S} opacity=".55"/><path d="M2.5 6c2 4 9 4 11 0" ${S}/>`,
  pressure: `<path d="M3 11a5 5 0 1 1 10 0" ${S}/><path d="M8 11l2.6-3.4" ${S}/><circle cx="8" cy="11" r=".9" fill="currentColor"/>`,
  length: `<path d="M2.5 8h11M4.5 6 2.5 8l2 2M11.5 6l2 2-2 2" ${S}/><path d="M2.5 4v8M13.5 4v8" ${S} opacity=".55"/>`,
  angle: `<path d="M2.5 13h11M2.5 13 11 4.5" ${S}/><path d="M7.5 13a5 5 0 0 0-1.5-3.5" ${S} opacity=".7"/>`,
  face: `<path d="M3 13 11 3" ${S}/><path d="M2.5 13h4" ${S} opacity=".55"/><circle cx="11" cy="3" r="1.1" fill="currentColor"/>`,
  wave: `<path d="M1.5 8c1.6-3.2 3.3-3.2 4.9 0s3.3 3.2 4.9 0 2.4-2.6 3.2-1.6" ${S}/>`,
  wavelength: `<path d="M1.5 6.5c1.6-3 3.3-3 4.9 0s3.3 3 4.9 0 2.4-2.4 3.2-1.4" ${S}/><path d="M3.8 12h8.4M5 10.8l-1.2 1.2L5 13.2M11 10.8l1.2 1.2-1.2 1.2" ${S} opacity=".6"/>`,
  bumpy: `<path d="M2 6.5h12" ${S} opacity=".55"/><path d="M2 11l1.5-1 1.5 1 1.5-1.2 1.5 1.2 1.5-.8 1.5.8 1.5-1 1.5 1" ${S}/>`,
  wetting: `<path d="M1.8 12.5h12.4" ${S} opacity=".55"/><path d="M3 12.5a2.3 2.3 0 0 1 4.6 0M9 12.5c0-2.4 1-4 2.4-4s2.4 1.6 2.4 4" ${S}/>`,
  edge: `<path d="M2.5 2.5v11" ${S} opacity=".55"/><path d="M5 2.5l2 1.8-1.6 1.9 2 1.8-1.7 2 2 1.8-1.7 1.7" ${S}/>`,
  ripple: `<path d="M2 6c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0M2 10c1-1 2-1 3 0s2 1 3 0 2-1 3 0 2 1 3 0" ${S}/>`,
  vibration: `<path d="M1.5 8h2l1-3.5 2 7 2-7 2 7 1-3.5h3" ${S}/>`,
  radius: `<path d="M3 13a10 10 0 0 1 10-10" ${S}/><path d="M13 13 5.9 5.9" ${S} opacity=".6"/><circle cx="13" cy="13" r=".9" fill="currentColor"/>`,
  pool: `<path d="M2 6.5c1.5 1 2.5 1 4 0s2.5-1 4 0 2.5 1 4 0" ${S}/><path d="M2 6.5v5.5h12V6.5" ${S} opacity=".55"/>`,
  exit: `<path d="M2.5 13h11M9 13V3" ${S}/><path d="M9 9.5a3.5 3.5 0 0 0 3.2 3.5" ${S} opacity=".7"/>`,
  shape: `<path d="M2.5 3.5h7a4 4 0 0 1 4 4v1H2.5z" ${S}/><path d="M1.5 12.5h13" ${S} opacity=".55"/>`,
  model: `<path d="M2.5 2.5v11h11" ${S} opacity=".55"/><path d="M3.5 12c1.5-5 4-7.5 9-8" ${S}/><path d="M3.5 12l9-6" ${S} opacity=".45"/>`,
  fibre: `<path d="M2 5c2 1.5 4 1.5 6 0s4-1.5 6 0M2 11c2-1.5 4-1.5 6 0s4 1.5 6 0M5 2.5v11M11 2.5v11" ${S}/>`,
  weight: `<path d="M5 5.5h6l1.5 8h-9z" ${S}/><circle cx="8" cy="3.8" r="1.4" ${S}/>`,
  density: `<path d="M8 2.5 13 5v6l-5 2.5L3 11V5z" ${S}/><path d="M3 5l5 2.5L13 5M8 7.5v6" ${S} opacity=".55"/>`,
  yarn: `<circle cx="8" cy="8" r="5" ${S}/><path d="M4.6 5.5c2 .5 4.8 2.5 5.9 6M3.3 9c2.3-.3 5.4.3 7.6 3M6 3.3c2.6 1.2 4.6 3.3 5.5 5.8" ${S} opacity=".6"/>`,
  count: `<path d="M5.5 2.5 4.5 13.5M11.5 2.5l-1 11M2.5 6h11M2 10h11" ${S}/>`,
  air: `<path d="M2 6h7.5a2 2 0 1 0-2-2M2 10h10a2 2 0 1 1-2 2M2 8h5" ${S}/>`,
  temp: `<path d="M6.5 9.5V3.5a1.5 1.5 0 0 1 3 0v6a3 3 0 1 1-3 0z" ${S}/><path d="M8 6.5v4.5" ${S}/>`,
  plenum: `<rect x="2.5" y="4.5" width="11" height="7" rx="1.5" ${S}/><path d="M5 8h6M9.5 6.5 11 8l-1.5 1.5" ${S} opacity=".6"/>`,
  humidity: `<path d="M8 2.2c2.4 3 4 5.1 4 7.1a4 4 0 0 1-8 0c0-2 1.6-4.1 4-7.1z" ${S}/><path d="M6.3 11.3l3.4-3.4" ${S} opacity=".7"/><circle cx="6.5" cy="8.3" r=".75" fill="currentColor"/><circle cx="9.5" cy="11" r=".75" fill="currentColor"/>`,
  mesh: `<rect x="2.5" y="2.5" width="11" height="11" rx="1" ${S}/><path d="M2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11" ${S} opacity=".6"/>`,
  grading: `<rect x="2.5" y="2.5" width="11" height="11" rx="1" ${S}/><path d="M7.5 2.5v11M10.5 2.5v11M12.2 2.5v11" ${S} opacity=".6"/>`,
  tolerance: `<circle cx="8" cy="8" r="5.5" ${S}/><circle cx="8" cy="8" r="2.5" ${S} opacity=".7"/><circle cx="8" cy="8" r=".8" fill="currentColor"/>`,
  iterations: `<path d="M12.5 8A4.5 4.5 0 1 1 11 4.6" ${S}/><path d="M11.3 2.2v2.6H8.7" ${S}/>`,
  film: `<path d="M2 11.5h12" ${S}/><path d="M2 8.5c3 0 3-1.5 6-1.5s3 1.5 6 1.5" ${S} opacity=".7"/>`,
  location: `<path d="M8 14s4.5-4.4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.6 8 14 8 14z" ${S}/><circle cx="8" cy="6.5" r="1.6" ${S}/>`,
  pulse: `<path d="M1.5 10h3V5.5h2.5V10h2.5V5.5H12V10h2.5" ${S}/>`,
  period: `<circle cx="8" cy="8" r="5.5" ${S}/><path d="M8 4.8V8l2.2 1.5" ${S}/>`,
  position: `<path d="M1.5 8h13" ${S} opacity=".55"/><circle cx="8" cy="8" r="2.4" ${S}/><path d="M8 3v2.4M8 10.6V13" ${S}/>`,
  playback: `<path d="M5 3.5v9l7-4.5z" ${S}/>`,
  process: `<path d="M1.5 11.5h13" ${S} opacity=".55"/><path d="M2 8h9.5M8.5 5l3 3-3 3" ${S}/>`,
  data: `<path d="M2.5 2.5v11h11" ${S} opacity=".55"/><circle cx="6" cy="9.5" r="1.2" fill="currentColor"/><circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="11.5" cy="4.8" r="1.2" fill="currentColor"/>`,
  doe: `<rect x="2.5" y="2.5" width="11" height="11" rx="1" ${S} opacity=".55"/><circle cx="5.3" cy="5.3" r="1.2" fill="currentColor"/><circle cx="10.7" cy="5.3" r="1.2" fill="currentColor"/><circle cx="5.3" cy="10.7" r="1.2" fill="currentColor"/><circle cx="10.7" cy="10.7" r="1.2" fill="currentColor"/>`,
};
const picon = name => `<svg class="pi" viewBox="0 0 16 16" aria-hidden="true">${PICON[name] || PICON.process}</svg>`;

// ---- which icon and group each input has ----
const INPUT_ICON = {
  U: 'speed', webW: 'position', Hm: 'height', tf: 'thickness', oven: 'oven', mu: 'drop', n: 'thinning', ty: 'yield', g: 'tension', Pup: 'pressure', L: 'length', th: 'angle', face: 'face',
  dH: 'wave', lw: 'wavelength', tilt: 'angle', skew: 'angle', dt: 'bumpy', dth: 'wetting', a0e: 'edge', lam: 'ripple', vib: 'vibration',
  cfdR: 'radius', cfdPool: 'pool', cfdExit: 'exit', cfdShape: 'shape', cfdModel: 'model', cfdFibreSel: 'fibre', cfdGsm: 'weight', cfdRhoF: 'density', cfdDFrom: 'yarn',
  cfdDen: 'yarn', cfdNf: 'count', cfdAirPerm: 'air', cfdAirDP: 'pressure', cfdKoz: 'count', cfdAirFrac: 'air', cfdAirU: 'air', cfdAirT: 'temp', cfdPlenum: 'plenum',
  cfdMesh: 'mesh', cfdTol: 'tolerance', cfdS_nEb: 'mesh', cfdS_nEf: 'mesh', cfdS_nEs: 'mesh', cfdS_nEy: 'mesh', cfdS_gradeB: 'grading', cfdS_gradeS: 'grading', cfdS_gradeY: 'grading',
  cfdS_maxIter: 'iterations', cfdS_ldGaps: 'film', fa: 'pulse', fp: 'period', fd: 'pulse', pl0: 'pool', plp: 'length', az: 'position', rt: 'playback',
  c3d_units: 'length', c3d_machine: 'process', c3d_up: 'height', c3d_inlet: 'pool', c3d_loc: 'location', c3d_stripW: 'position',
  c3d_nxGap: 'mesh', c3d_nxFilm: 'mesh', c3d_ny: 'mesh', c3d_nzStrip: 'mesh', c3d_nzFull: 'mesh',
};
/** The oven zones' inputs: by their field (zone 1's drying air also by its old id, above). */
const OVEN_ICON = { len: 'length', airU: 'air', airT: 'temp', plenum: 'plenum', rh: 'humidity' };
/** A read-only row's icon from its label (the DOE base case). */
const LABEL_ICON = [[/^Location/, 'location'], [/^Gap/, 'height'], [/^Contact angle/, 'angle'], [/^Blade/, 'shape'], [/^Exit face/, 'exit'], [/^Rheology/, 'model'], [/^Fibre/, 'fibre'], [/^Mesh/, 'mesh'], [/^Across the web/, 'position']];
/** Groups: their colour (a CSS variable) and icon; the shared inputs' groups by name, the setup's by their tree key. */
const GROUPS = {
  'Process': ['process', 'process'], 'Slurry': ['slurry', 'drop'], 'Blade and bead': ['blade', 'shape'], 'Variation across the web': ['variation', 'wave'], 'Web edge and film': ['edge', 'ripple'],
  geo: ['blade', 'shape'], rheo: ['slurry', 'model'], fibre: ['process', 'fibre'], air: ['edge', 'air'], solver: ['neutral', 'mesh'], locs: ['variation', 'location'],
  oven: ['edge', 'oven'], matro: ['slurry', 'drop'],
  anim: ['neutral', 'playback'], doe: ['neutral', 'doe'], meas: ['neutral', 'data'],
  c3d_geo: ['blade', 'shape'], c3d_region: ['variation', 'location'], c3d_mesh: ['neutral', 'mesh'],
};
function groupOf(details) {
  if (details.dataset.tree) return GROUPS[details.dataset.tree] || ['neutral', 'process'];
  if (details.dataset.c3dgrp) return GROUPS['c3d_' + details.dataset.c3dgrp] || ['neutral', 'process'];
  const name = (details.querySelector(':scope > summary') || {}).textContent || '';
  if (GROUPS[name.trim()]) return GROUPS[name.trim()];
  if (details.querySelector('.anim-params')) return GROUPS.anim;
  if (details.closest('#setupExtra') && /DOE|From CFD/i.test(name)) return GROUPS.doe;
  if (/Datasets/i.test(name)) return GROUPS.meas;
  return ['neutral', 'process'];
}

// ---- which shared inputs each tab uses ----
const ALL_IN = CFG.map(c => c.k);
// (the pool and its feed: only on Coating › 1D › Pool and feed)
const FEED_IN = ['fN', 'fV', 'fTau', 'fTip', 'fX', 'fD', 'fDo', 'fBack'];
// (the pool's mesh: each on its own page, Coating › 2D and 3D › Pool and feed)
const POOL2_IN = ['f2H', 'f2Hm', 'f2Ny'], POOL3_IN = ['f3H', 'f3Hm', 'f3Ny', 'f3Pm', 'f3PLo', 'f3PUp'];
const USES = [
  ALL_IN.filter(k => !['oven', 'a0e', 'lam', 'vib', 'thw', ...FEED_IN, ...POOL2_IN, ...POOL3_IN].includes(k)),
  ALL_IN.filter(k => !['oven', 'a0e', 'lam', 'vib', 'thw', ...FEED_IN, ...POOL2_IN, ...POOL3_IN].includes(k)),
  ['U', 'Hm', 'tf', 'oven', 'mu', 'n', 'ty', 'g', 'Pup', 'L', 'a0e'],
  ['U', 'Hm', 'tf', 'oven', 'mu', 'n', 'ty', 'g', 'Pup', 'L', 'dH', 'lam', 'vib'],
  null, null,     // (CFD, DOE: below, with the setup)
  ALL_IN.filter(k => !FEED_IN.includes(k) && !POOL2_IN.includes(k) && !POOL3_IN.includes(k)),
];
const cfdUses = () => {
  const uses = RHEO_MODELS[CFDG.model].uses;
  return ['U', 'webW', 'Hm', 'tf', 'oven', 'mu', 'g', 'Pup', 'th', 'dH', 'lw', 'tilt', 'skew', 'dt', 'dth', ...(uses.includes('n') ? ['n'] : []), ...(uses.includes('ty') ? ['ty'] : []), ...(bladeUsesL() ? ['L'] : [])];
};
/** Why a tab does not use an input (its hover note). */
function unusedWhy(k) {
  if (tab === 12) return 'not used by the process chain (it starts from the wet film)';
  if (tab === 13) return 'not on a material card';
  if (tab === 16 || tab === 17) return `not used by the pool in ${tab === 16 ? '2D' : '3D'}`;
  if (tab === 4 || tab === 5 || tab >= 8) {
    if (RHEO_INS.includes(k)) return `not used by the ${RHEO_MODELS[CFDG.model].l} model chosen in the CFD setup`;
    if (k === 'L') return CFDG.shape === 'custom' ? 'not used with a custom blade profile (its points set the land)' : 'not used with a round blade entry (by the flat land and the shaped blades)';
    return tab === 9 ? 'not used by the 3D geometry' : tab >= 8 ? 'not used by this 1D page' : 'not used by the CFD';
  }
  return `not used in ${TABS[tab]}`;
}
// (the 1D pages use the 2D's inputs; To the oven also the ripple's, Across the web and the 3D blade the notch face)
// (the 3D also the contact angle on the web: its open edges)
// (the web's width: the coating's pages (the locations, across the web, the 3D, the pool), the Drying's (its water per second,
//  the 2D and 3D sections))
// (WF-2: a stage's tab, its own: Mixing the slurry's flow, Drying the web's speed and the room to the oven, Peel and wind the
//  web's speed; the later stages none of these (their own inputs are below them); the Line none)
const NAV_USES = { line: () => [], mix: () => ['mu', 'n', 'ty', 'g'], dry: () => ['U', 'webW', 'oven'], peel: () => ['U'], cut: () => [], stack: () => [], furn: () => [], gfilm: () => [],
  // (MP-W: the stack's and the furnace's multiphysics pages: their stage's inputs only, as the stage's own page)
  stack1d: () => [], stack2d: () => [], stack3d: () => [], furn1d: () => [], furn2d: () => [], furn3d: () => [],
  // (MP-5: the drying's multiphysics pages: the Drying page's inputs)
  dry1d: () => ['U', 'webW', 'oven'], dry2d: () => ['U', 'webW', 'oven'], dry3d: () => ['U', 'webW', 'oven'],
  // (the pool and its feed: the 1D's inputs, which give the film and its sensitivity to the pool, and the feed's own)
  feed1d: () => [...cfdUses(), ...FEED_IN],
  // (the pool in 2D and 3D: the 1D's (its cycle), the feed's, and its own mesh)
  feed2d: () => [...cfdUses(), ...FEED_IN, ...POOL2_IN], feed3d: () => [...cfdUses(), ...FEED_IN, ...POOL3_IN.filter(k => !k.startsWith('f3P') || feedEntry() === 'dip')] };   // (the pipes' mesh: with the tips in the paste)
// (the coating's results on the Process view: the wet film's inputs, as the 1D and 2D; Materials: the inputs its cards show)
/** The shared inputs page pg uses (null: all of them). */
const usesOf = pg => { const v = NAV[pg].v; return NAV_USES[pg] ? NAV_USES[pg]() : v === 13 ? ['mu', 'n', 'ty', 'g', 'tf'] : v === 4 || v === 5 || v === 8 || v === 12 ? cfdUses() : v === 10 ? [...cfdUses(), 'lam', 'vib'] : v === 11 ? [...cfdUses(), 'face'] : v === 9 ? [...cfdUses(), 'face', 'thw'] : USES[v]; };
// (MH-3: a page that uses the slurry's flow shows the chosen law's own inputs -- Newtonian μ; power law K, n; Herschel–Bulkley
//  K, n, τy; Carreau–Yasuda and Cross η0, n -- in place of the viscosity at 2.7 1/s every list names)
const RHEO_INS = ['mu', 'K', 'eta0', 'n', 'ty'];
const rheoUsesOf = u => (u && u.some(k => RHEO_INS.includes(k)) ? [...u.filter(k => !RHEO_INS.includes(k)), ...RHEO_MODELS[CFDG.model].uses] : u);
const inputUsed = k => { const u = rheoUsesOf(typeof navNow === 'function' ? usesOf(navNow()) : USES[tab]); return !u || u.includes(k); };
/** The page an input's "Show" or "Go to" opens when the page shown does not use it: the first, in the process's order, that
 *  does (the slurry's flow on Mixing, the coating's on its 1D, the ripple's on To the oven, the notch face across the web,
 *  the web's thickness on the 3D, the contact angle at the web's edge on Web edge; Summary shows them all). */
const JUMP_PAGES = ['mix', 'gap', 'oven1d', 'across', 'cfd3d', 'edge', 'summary'];
const pageUsing = k => JUMP_PAGES.find(pg => { const u = rheoUsesOf(usesOf(pg)); return !u || u.includes(k); }) || null;

// ---- decorating the tree: icons, group colours, dimming ----
function decorateTree() {
  const tree = document.querySelector('.tree');
  if (!tree) return;
  tree.querySelectorAll('details.grp').forEach(d => {
    const [col, ic] = groupOf(d);
    d.style.setProperty('--gc', `var(--g-${col})`);
    const sm = d.querySelector(':scope > summary');
    if (sm && !sm.querySelector(':scope > .gi')) sm.insertAdjacentHTML('afterbegin', `<span class="gi">${picon(ic)}</span>`);
  });
  tree.querySelectorAll('.prop, .sl').forEach(row => {
    if (row.querySelector(':scope > .pi, :scope > label > .pi, :scope > .prop-l > .pi')) return;
    const input = row.querySelector('input[id], select[id], .seg[id]');
    let name = input ? INPUT_ICON[input.id.replace(/^n_/, '')] || OVEN_ICON[input.dataset.ovk] : null;
    const lab = row.querySelector('.prop-l') || row.querySelector('label');
    if (!name && lab) { const hit = LABEL_ICON.find(([re]) => re.test(lab.textContent.trim())); if (hit) name = hit[1]; }
    if (!lab) return;
    const d = row.closest('details.grp');
    // (the label's text in one box beside the icon, so an (i) or a note stays inline with it)
    if (lab.classList.contains('prop-l')) { const t = document.createElement('span'); t.className = 'pl-t'; while (lab.firstChild) t.appendChild(lab.firstChild); lab.appendChild(t); }
    lab.insertAdjacentHTML('afterbegin', picon(name || (d ? groupOf(d)[1] : 'process')));
    row.classList.add('has-pi');
  });
  // (WF-2: the shared inputs the page shown does not use are not shown -- the page's inputs only)
  for (const c of CFG) {
    const num = document.getElementById('n_' + c.k), row = num && num.closest('.prop');
    if (!row) continue;
    const used = inputUsed(c.k);
    row.classList.toggle('unused', !used);
    row.hidden = !used;
    const why = used ? '' : unusedWhy(c.k);
    if (row.dataset.why !== why) {
      row.dataset.why = why;
      let tag = row.querySelector('.unused-tag');
      if (!used && !tag) { (row.querySelector('.pl-t') || row.querySelector('.prop-l')).insertAdjacentHTML('beforeend', '<span class="unused-tag"></span>'); tag = row.querySelector('.unused-tag'); }
      if (tag) { tag.textContent = why; tag.hidden = used; }
    }
  }
  document.querySelectorAll('#params > details.grp').forEach(d => {
    const rows = [...d.querySelectorAll('.prop')], off = rows.length && rows.every(r => r.classList.contains('unused'));
    d.classList.toggle('grp-unused', off);
    d.hidden = !!off;
    const sm = d.querySelector(':scope > summary');
    let t = sm.querySelector('.grp-tag');
    if (off && !t) { sm.insertAdjacentHTML('beforeend', '<span class="grp-tag">not used here</span>'); }
    else if (!off && t) t.remove();
  });
  renderRail();
}

// ---- the icon rail (the bar collapsed) and its flyouts ----
function renderRail() {
  const rail = document.getElementById('treeRail');
  if (!rail) return;
  const groups = [...document.querySelectorAll('.tree details.grp')].filter(d => !d.closest('[hidden]'));
  rail.innerHTML = groups.map((d, i) => {
    const [col, ic] = groupOf(d), name = ((d.querySelector(':scope > summary') || {}).textContent || '').replace('not used here', '').trim();
    const off = d.classList.contains('grp-unused');
    return `<button type="button" class="rail-b${off ? ' off' : ''}${d.classList.contains('fly-on') ? ' on' : ''}" data-fly="${i}" style="--gc: var(--g-${col})" title="${name}${off ? ' (not used in this tab)' : ''}" aria-label="${name}">${picon(ic)}</button>`;
  }).join('');
  rail.querySelectorAll('[data-fly]').forEach(b => {
    b.onclick = e => { e.stopPropagation(); openFlyout(groups[+b.dataset.fly]); };
  });
}
function openFlyout(d) {
  const tree = document.querySelector('.tree');
  const same = d.classList.contains('fly-on') && tree.classList.contains('tree-flyout');
  closeFlyout();
  if (same) return;
  d.classList.add('fly-on'); d.open = true;
  tree.classList.add('tree-flyout');
  renderRail();
  const first = d.querySelector('input, select, button:not(.rail-b)'); if (first) first.focus({ preventScroll: true });
  document.getElementById('treeScroll').scrollTop = 0;
}
function closeFlyout() {
  const tree = document.querySelector('.tree');
  if (!tree || !tree.classList.contains('tree-flyout')) return false;
  tree.classList.remove('tree-flyout');
  tree.querySelectorAll('.fly-on').forEach(x => x.classList.remove('fly-on'));
  renderRail();
  return true;
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.tree')) closeFlyout(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && closeFlyout()) e.stopPropagation(); }, true);

// (the tree's content is redrawn by the modules: decorate it again after each change)
(function watchTree() {
  let queued = false;
  const mo = new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; mo.disconnect(); decorateTree(); watch(); }); });
  const watch = () => mo.observe(document.getElementById('treeScroll'), { childList: true, subtree: true });
  watch();
})();
