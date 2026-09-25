/*
 * guide.js — the Help dialog (Help menu): a guide to each module, the methods and their limits,
 * the keyboard shortcuts (changeable: keys.js), and a search over all the help texts (these, and
 * the input and result cards of help.js).
 */

const GUIDE = [
  { tab: 7, t: 'Summary', what: 'Where the app opens: every answer of the Results pages at a glance for the inputs as they are: the wet film and its range across the web, and a card each for the contact line (does slurry reach the dry edge?), the web edge (does it scallop before the oven?) and the film surface (do streaks survive to the oven?), with a small chart and the verdict of that page.',
    uses: 'Every shared input, through the pages it summarises. The inputs bar is hidden here at first: Inputs in the tab bar (or Edit inputs) shows it, and the cards follow every change.',
    read: 'Each card\'s badge answers its question (No in green, Yes in red, a caution in amber) with the key number under it; click a card for its page and the full detail. The line under the cards is the thin-film validity check the fast models share. Go further leads to the CFD, the DOE and the measured data.' },
  { tab: 1, t: 'Contact line', what: 'Where the meniscus leaves the blade: the static cross-section at the web centre, and the contact line\'s height up the notch face at every position across the web.',
    uses: 'Process (not the oven), Slurry, Blade and bead, Variation across the web (waviness, fibre thickness and wetting variation move the line up and down).',
    read: 'Left: blade, slurry, meniscus and film at the centre. Right: the contact line up the face (mm) against position across the web; the red dashed line is the notch corner, where slurry reaches the dry edge. The pills say whether it stays pinned, is uneven, or reaches the corner.' },
  { tab: 2, t: 'Web edge', what: 'The wet edge as a ridge of slurry that surface tension pulls into beads (Rayleigh–Plateau), slowed by viscosity and frozen by a large enough yield stress: its scallop amplitude from the blade to the oven.',
    uses: 'Process (speed, gap, oven distance), Slurry, Blade and bead (through the film thickness), Edge irregularity at exit.',
    read: 'Top: scallop amplitude against distance from the blade, with the "visible" line at 0.2 mm. Bottom: the edge seen from above at the oven. An order-of-magnitude indicator: which lever matters, not exact millimetres.' },
  { tab: 3, t: 'Film surface', what: 'Streaks and ripple on the film surface: the ripple the blade leaves (gap waviness through dh/dH, plus vibration), and how surface tension levels it before the oven; a yield stress leaves a residual.',
    uses: 'Process, Slurry, Blade and bead, Blade gap waviness, Ripple wavelength, Vibration ripple.',
    read: 'Top: the surface across the web just after the blade (dashed) and at the oven (solid), in µm. Bottom: ripple amplitude against time, with the oven marked. The pills say whether the ripple survives to the oven.' },
  { tab: 8, t: 'Gap flow (1D)', what: 'The first stage of Flow: the slurry\'s flow along the blade in 1D lubrication, solved exactly across the gap at every station for the rheology model (a yield stress leaves an unsheared plug), with the 2D\'s blade shape, exit face, fibre slip and locations. The bead pressure at the inlet, falling to ambient at the metering edge, sets the flow rate q; the film left on the web is q / U.',
    uses: 'Process, Slurry, Blade and bead, each location\'s gap and contact angle (Variation across the web or its own values), and the 2D setup: blade entry, exit face, rheology model, fibre.',
    read: 'The switch at the top picks the location. Pressure along the blade, with the 2D\'s along the web when that location is solved (the 2D\'s meniscus sets its pressure at the edge, the 1D takes ambient); the gap; the shear stress on the web and the blade; velocity across the gap at the inlet, midway and the edge. The table compares the 1D, the 2D and (later) the 3D at the four locations.' },
  { tab: 10, t: 'To the oven (1D)', what: 'The film from the metering edge to the oven: the 1D thin-film equation (the web dragging the film, surface tension, gravity) from the full gap at the edge, with the flow rate of the 1D gap flow, settling to q / U; and the ripple on it levelling on the way.',
    uses: 'As the gap flow, plus the ripple\'s sources: blade gap waviness, vibration ripple, ripple wavelength; and the distance to the oven.',
    read: 'Top: the film height against the distance from the edge, with q / U dashed. Bottom: the ripple amplitude from the blade to the oven. The pills say whether the ripple survives to the oven.' },
  { tab: 11, t: 'Across the web (1D)', what: 'The 1D gap flow at 61 positions across the web, each with its own gap (blade waviness, fibre thickness variation) and contact angle (wetting variation): the wet film and the contact line against position.',
    uses: 'As the gap flow with the shared values (a location\'s own values do not apply here), plus the notch face length for the dry-edge line.',
    read: 'Left: the wet film across the web; the dots are the 2D at its four locations when solved. Right: the contact line up the exit face from the static meniscus; past the dashed line the slurry reaches the dry edge.' },
  { tab: 0, t: 'Start-up', what: 'An animated cross-section of the slurry metered under the fixed blade onto the moving fibre, from start-up: the pool fills and pulses with the feed, the fibre accelerates, the film forms and the downstream surface is solved live. A second pane magnifies the meniscus on the same clock.',
    uses: 'Process (not the distance to the oven), Slurry, Blade and bead; the across-web inputs through the position slider (the local gap and wetting there); the scenario in the inputs bar (feed pulsing, pool, position, playback speed).',
    read: 'Play / Pause and the time slider drive both panes. The pills give the contact line\'s place (at the edge, up the face, or at the notch corner: the dry edge gets wet) and the local gap and contact angle; the results strip gives the gap, wet film and shear rate at that position. A red pill or "surface solve stopped" means the numbers there are not to be trusted.',
    more: 'How it runs: the fibre starts at rest under a pool of slurry already deeper than the gap, starts at 3 s and reaches full speed 1.5 s later (assumed). The nozzle at the pool surface feeds in pulses, on average what leaves through the gap; the pool level comes from that volume balance, and the gap flow from the fibre speed and the bead pressure, taken as proportional to pool depth. The blade diameter is 100 mm; the notch size, pool depth and length are assumed. Bead height scales with bead pressure for display.' },
  { tab: 4, t: '2D CFD', what: '2D Navier–Stokes flow under the blade, over its exit face and into the free film, with the meniscus and its contact line solved together with the flow, at four positions across the web. Velocity, pressure, shear, viscosity and more, post-processed from the stored solutions.',
    uses: 'Process, Slurry, Blade and bead, Variation across the web (each location\'s local gap and contact angle), and the CFD setup in the inputs bar (blade entry, exit face, rheology model, fibre, air, solver and mesh, locations with their own inputs).',
    read: 'The page is in four steps (the bar beside 1D | 2D | 3D, each with where it stands). Geometry: the blade drawn to scale with its dimensions (drag a round handle, or click a value and type; the gap and contact angle of each location beside it). Mesh: the mesh the solve starts on, laid out by the solver before anything is solved (or, once solved, the solved one), shaded by each element\'s shape quality, with its numbers (elements, nodes, worst and mean quality, a histogram, aspect ratio, shortest edge; "show" zooms to the worst element); the mesh study is there too. Solve: the boundary conditions drawn on the domain (click a blue value to change it) and the solver settings; Run (Ctrl+Enter from any step) solves the four locations and opens Results when they are done. Results: the flow. Run solves the four locations (each in its own worker); while they solve, a bar each shows about how far it has got (≈: an estimate from the solves done and how far the current one\'s residual has fallen toward the tolerance; the status bar shows them together on every page) and what it is doing. The toolbar picks the location (or Compare, or Difference), the field, streamlines, vectors, contours; the zoom bar on the plot zooms and pans (wheel, drag). Click the colour bar for its scale. The bottom panel has flow metrics, probes, cut lines, across-web and profile charts, fibre results, convergence, the mesh study, saved cases, problems, messages, history and the method. "Out of date" marks results whose inputs changed since they were solved.' },
  { tab: 9, t: '3D', what: 'The flow in 3D on a strip across the web around one location. The blade is made from the 2D setup (its side profile extended across the web, the gap varying there as the inputs say) or read from an STL or STEP file of the blade and placed with its lowest point at the gap. Solve 3D first solves each station across the strip in 2D at its own gap and contact angle, then couples them in a 3D Navier–Stokes solve with the meniscus and its contact line, so the flow across the web, which the 1D and 2D cannot have, is in it. The full web width is solved as overlapping strips in parallel, each with its neighbours\' latest solution on its sides, sweep after sweep until they agree (minutes; the same answer as solving the whole width at once, which would not fit in a browser\'s memory).',
    uses: 'Everything the 2D uses at that location (blade, rheology, fibre and web slip, bead pressure, surface tension, the gap and contact angle with their variation across the web), the 3D geometry (from the 2D setup, or a file: its units, axes and inlet distance; the exit-face angle from the 2D setup), the region and the 3D mesh in the inputs bar.',
    read: 'The page is in four steps, as 2D: Geometry (the blade in 3D, the region), Mesh (the hexahedral mesh with its size, unknowns, memory and time, and its shape quality: before solving, each station\'s starting layout; once solved, the solved hexahedra\'s), Solve (the boundary conditions, the sides of the strip or the web\'s edges, and Solve 3D) and Results (the flow). Solve 3D (Ctrl+Enter from any step) runs in the background and opens Results when it is done; Esc stops it; the mesh settings show about how large and long a solve is. While it solves, one bar shows about how far the whole solve has got (≈: the stations\' 2D and the 3D, or the full width\'s sweeps, weighted by their estimated times, and how far each Newton solve\'s residual has fallen) and one more for each station or strip being solved; the status bar shows it on every page. The view colours the flow by a field (speed, pressure, shear rate, viscosity, velocity across the web) on its outer faces: the strip\'s two sides are cuts through the flow; turn the blade off to see the top. Streamlines (after a solve): tubes from the inlet, spaced by equal flow up the gap, coloured along their length by the same field; Low / Medium / High sets how many; the slurry\'s faces turn faint while they show. Drag to turn, wheel to zoom, right-drag to pan. The charts: the film and the contact line across the strip (3D against each station\'s own 2D), the pressure on the blade\'s underside, the pressure along the blade at the middle. The table\'s 3D column is the strip\'s middle, or the full width\'s station nearest each location. Full width: its stations sample the variation across the web at their spacing; the web\'s edges are symmetry planes (with a skewed blade: open, each held at its own station\'s flow along the blade; the edge bead is not modelled either way). "Out of date" marks a result whose inputs changed since.' },
  { tab: 5, t: 'DOE', what: 'A full-factorial design of experiments at one location: 1–3 factors (process, slurry, blade geometry, mesh) at 2–5 levels each, every combination solved in the CFD, several at a time.',
    uses: 'The CFD base case of the chosen location (every input as in 2D CFD), and the factors in the Design tab.',
    read: 'Response: an output against one factor, a line per level of the second, a panel per level of the third. Response map: two factors as a coloured grid. Main effects: the mean output at each level of each factor, so the steepest line is the strongest lever. Runs lists every run; failed runs say why.' },
  { tab: 6, t: 'Measured data', what: 'Measurements from a CSV (wet film or coat weight across the web or against settings, the contact line, the meniscus shape, the edge amplitude, the surface ripple) compared with the fast models and the CFD; a fit adjusts inputs to match them.',
    uses: 'Every input (the predictions use the fast models and the CFD), and the datasets imported.',
    read: 'The parity plot puts each point at (measured, predicted): on the 1:1 line is a perfect prediction, inside the dashed lines within ±10 %. The Comparison tab lists each point with the % errors and their RMS; Solve in CFD adds the CFD column. The Fit tab adjusts 1–3 inputs to the chosen datasets and shows the error before and after; Apply sets them.' },
];

const METHODS = [
  { t: 'Inputs: measured and assumed', d: 'Measured (yours): web speed, machine height, fibre thickness, viscosity 10.5 Pa·s at 2.7 1/s, and the design wet film of 1.45 mm: the default bead pressure is back-calculated so the fast model gives 1.45 mm (it is not itself a measurement). Assumed until measured: surface tension (0.07 N/m, water-like), the contact angle on the blade, yield stress, shear-thinning index, land length, notch face length and density (1020 kg/m³). The inputs bar marks the assumed inputs, and Measured data can fit them to your measurements.', lim: '' },
  { t: 'Wet film thickness (fast models)', d: 'One-dimensional lubrication flow between the fixed land and the moving web: q = U·H/2 + H³/(12 μ)·Δp/L, film h = q/U, with the bead pressure Δp over the land length L. The viscosity is the Herschel–Bulkley law at the representative shear rate U/H (its value at 2.7 1/s is the viscosity input).',
    lim: 'Valid while the thin-film checks hold: Reynolds number below 1 (inertia negligible), capillary number below 0.1, gap / land length below 0.2. The status bar says when one fails ("Use with caution", or "Result withheld" when there is no finite film).' },
  { t: 'Contact line and meniscus (fast models)', d: 'The static 2D Young–Laplace meniscus (gravity and surface tension): it climbs 2 Lcap sin(φ/2) above the film, Lcap the capillary length. If it cannot reach past the gap, the contact line stays pinned at the sharp metering edge (Gibbs pinning); otherwise it moves up the 45° notch face.',
    lim: 'Static: dynamic wetting (the contact angle changing with speed) is not included, so it matters most at higher capillary numbers.' },
  { t: 'Variation across the web', d: 'The local gap is the machine height less the fibre thickness, plus the blade waviness (a sine of the chosen wavelength), the blade\'s tilt (the gap difference from one web edge to the other, centred on the middle) and the fibre thickness variation; a skewed blade (its edge at an angle to the cross direction) moves slurry across the web in the 3D, the pressure under it pushing the slurry at right angles to the blade; the local contact angle varies by the wetting variation.',
    lim: 'The fibre-thickness and wetting variation follow a fixed smooth pattern: a stand-in for real scatter, not a measurement of it.' },
  { t: 'Web edge beads', d: 'Rayleigh–Plateau growth of the edge ridge (radius half the film): growth rate γ/(6 μ R), wavelength 9 R, with the viscosity at a slow 0.1 1/s; a yield stress larger than the Laplace pressure γ/R freezes it. Grows from the edge irregularity at exit until it saturates at a quarter wavelength.',
    lim: 'An order-of-magnitude indicator.' },
  { t: 'Film levelling', d: 'Ripple of the chosen wavelength levelled by surface tension and gravity against viscosity (a thin-film levelling time constant 3 μ / (h³ (γ k⁴ + ρ g k²))); a yield stress leaves a residual amplitude it cannot level. The starting ripple is the gap waviness times dh/dH plus vibration.',
    lim: 'Linear, one wavelength at a time; an order-of-magnitude indicator.' },
  { t: 'Start-up animation', d: 'The pool depth from a volume balance (pulsed feed in, gap flow out), the gap flow from the web speed and a bead pressure taken as proportional to pool depth; the downstream surface from the thin-film equation (viscous flow, surface tension, the moving fibre), solved live.',
    lim: 'The start-up, pool depth and length are assumed. When the pool cannot supply the outlet, the outlet is supply-limited; a numerical failure stops the surface and is reported.' },
  { t: 'CFD', d: 'Steady 2D incompressible Navier–Stokes by finite elements (Taylor–Hood: quadratic velocity, linear pressure) with the viscosity varying as the rheology model says (Newtonian, power law, Herschel–Bulkley). Velocity, pressure, the free surface and the contact line are solved together by Newton\'s method, stepping from a Newtonian fluid to the real rheology. The contact line is pinned at the edge or climbs the exit face (Gibbs). The fibre is porous (Darcy, from its test report). Validated against exact flat-gap flows, the lid-driven cavity, the static meniscus, mass conservation and grid convergence (Flow › 2D › More › Method).',
    lim: 'Steady and 2D (no instabilities along the web). The solver needs exit face + contact angle between 94° and 175°. The contact line position depends on the mesh more than the film does: check with the mesh study. A run that does not converge is not shown.' },
  { t: 'Input checks', d: 'A typed value outside an input\'s range is refused. Before a run, the geometry is checked: errors (outside what the solver can do) stop the run, warnings (outside where the model is valid, or unusual process values) do not. All are listed in the Problems tab.', lim: '' },
  { t: 'DOE', d: 'Full factorial: every combination of the factor levels is one CFD run at the chosen location; the others stay as the base case. Main effects average each level over the other factors.', lim: 'A run with an input outside what the solver can do is not solved; a run that does not converge is marked failed.' },
  { t: 'Measured data and the fit', d: 'Each measured point is predicted by the fast model (instantly) and, on request, the CFD (each different point solved once). Error = (predicted − measured) / measured. The fit minimises the RMS % error of the fast model over the chosen datasets by Nelder–Mead in each input\'s range, from the current values and eight other starts, then solves the fitted values in the CFD to check them.',
    lim: 'The fast model and the CFD differ (a 45° notch face against the exit face; 1D against 2D): a fit on the fast model is a starting point, which the CFD check confirms or not. A fitted value at the end of its range means the best fit may lie beyond it.' },
];

// ---- search: every help text as items ----
function helpItems() {
  const items = [];
  for (const key of Object.keys(HELP)) {
    const h = helpOf(key);
    if (!h) continue;
    const kind = key.startsWith('in.') ? 'Input' : /^(cfd|sol|loc)\./.test(key) ? 'CFD setting' : /^(tb|zm|dp)\./.test(key) ? 'Control' : key.startsWith('doe.') ? 'DOE' : key.startsWith('meas.') ? 'Measured data' : 'Help';
    const id = key.startsWith('in.') ? 'n_' + key.slice(3) : Object.keys(HELP_BY_ID).find(k => HELP_BY_ID[k] === key) || null;
    items.push({ kind, t: h.t, parts: [h.d, h.r, h.e ? `Effect: ${h.e}` : '', h.u ? `Used by: ${h.u}` : ''].filter(Boolean), jump: id });
  }
  for (const [name, d] of Object.entries(HELP_RESULTS)) items.push({ kind: 'Result', t: name, parts: [d] });
  for (const g of GUIDE) items.push({ kind: 'Module', t: g.t, parts: [g.what, `Uses: ${g.uses}`, `Reading it: ${g.read}`], tab: g.tab });
  for (const m of METHODS) items.push({ kind: 'Method', t: m.t, parts: [m.d, m.lim ? `Limits: ${m.lim}` : ''].filter(Boolean) });
  for (const a of KEY_ACTIONS) items.push({ kind: 'Shortcut', t: a.l, parts: [keyOf(a.id) ? `Key: ${keyLabel(a.id)}` : 'No key (set one in Keyboard shortcuts)', a.g], key: true });
  return items;
}
const gEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const stripTags = t => String(t ?? '').replace(/<[^>]*>/g, '');
/** Text with the query's words marked. */
function gMark(text, words) {
  let s = gEsc(stripTags(text));
  for (const w of words) if (w) s = s.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return s;
}

// ---- the dialog ----
const HELPDLG = { sec: 'guide', mod: 0, q: '' };
function openHelp(sec) {
  let dlg = document.getElementById('helpDlg');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'helpDlg'; dlg.className = 'img-dlg help-dlg'; dlg.setAttribute('aria-labelledby', 'helpDlgH');
    document.body.appendChild(dlg);
  }
  HELPDLG.sec = sec || 'guide'; HELPDLG.mod = tab; HELPDLG.q = '';
  dlg.innerHTML = `<div class="help-top"><h2 id="helpDlgH">Help</h2>
      <input type="search" id="helpQ" placeholder="Search help: inputs, results, controls, methods, keys" aria-label="Search help" autocomplete="off">
      <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="help-main"><nav class="help-nav" aria-label="Help sections"></nav><div class="help-body" id="helpBody" tabindex="-1"></div></div>
    <p class="help-foot">${PROJ_APP} ${APP_VERSION} · The ⓘ next to an input, or a moment's hover on a control, shows its card.</p>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  const q = dlg.querySelector('#helpQ');
  q.oninput = () => { HELPDLG.q = q.value.trim(); renderHelpDlg(); };
  if (!dlg.open) dlg.showModal();
  renderHelpDlg();
  (sec === 'search' ? q : dlg.querySelector('.help-nav [aria-current="page"]') || q).focus();
}
function renderHelpDlg() {
  const dlg = document.getElementById('helpDlg');
  if (!dlg) return;
  const nav = dlg.querySelector('.help-nav'), body = dlg.querySelector('#helpBody'), searching = !!HELPDLG.q;
  const navBtn = (sec, mod, label, sub) => `<button type="button" class="help-nb${sub ? ' sub' : ''}" data-sec="${sec}"${mod != null ? ` data-mod="${mod}"` : ''}${!searching && HELPDLG.sec === sec && (mod == null || HELPDLG.mod === mod) ? ' aria-current="page"' : ''}>${label}</button>`;
  nav.innerHTML = navBtn('guide', null, 'Module guide') + GUIDE.map(g => navBtn('guide', g.tab, g.t + (g.tab === tab ? ' <small>(this one)</small>' : ''), true)).join('')
    + navBtn('methods', null, 'Methods and limits') + navBtn('keys', null, 'Keyboard shortcuts');
  nav.querySelectorAll('[data-sec]').forEach(b => {
    b.onclick = () => {
      HELPDLG.sec = b.dataset.sec; if (b.dataset.mod != null) HELPDLG.mod = +b.dataset.mod;
      HELPDLG.q = ''; dlg.querySelector('#helpQ').value = '';
      renderHelpDlg(); body.scrollTop = 0;
    };
  });
  if (searching) {
    const words = HELPDLG.q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = helpItems().map(it => {
      const title = it.t.toLowerCase(), text = (it.t + ' ' + it.parts.join(' ')).toLowerCase();
      if (!words.every(w => text.includes(w))) return null;
      return { it, s: words.reduce((a, w) => a + (title.includes(w) ? 3 : 0) + (title.startsWith(w) ? 2 : 0), 0) };
    }).filter(Boolean).sort((a, b) => b.s - a.s);
    body.innerHTML = `<p class="fv-note">${scored.length} result${scored.length === 1 ? '' : 's'} for “${gEsc(HELPDLG.q)}”</p>` + (scored.length ? scored.slice(0, 60).map(({ it }, n) => `<article class="help-hit">
        <div class="help-hit-h"><span class="help-kind">${it.kind}</span><b>${gMark(it.t, words)}</b>${it.jump && document.getElementById(it.jump) ? ` <button type="button" class="btn btn-secondary btn-sm" data-jump="${it.jump}">Show</button>` : ''}${it.tab != null ? ` <button type="button" class="btn btn-secondary btn-sm" data-guide="${it.tab}">Guide</button>` : ''}${it.key ? ` <button type="button" class="btn btn-secondary btn-sm" data-sec2="keys">Change</button>` : ''}</div>
        ${it.parts.map(p => `<p>${gMark(p, words)}</p>`).join('')}</article>`).join('') : '<p class="cap">Nothing found. Try another word (an input\'s name, a result, "contact line", "yield", "mesh"…).</p>');
    body.querySelectorAll('[data-jump]').forEach(b => { b.onclick = () => { dlg.close(); jumpToField(b.dataset.jump); }; });
    body.querySelectorAll('[data-guide]').forEach(b => { b.onclick = () => { HELPDLG.q = ''; dlg.querySelector('#helpQ').value = ''; HELPDLG.sec = 'guide'; HELPDLG.mod = +b.dataset.guide; renderHelpDlg(); }; });
    body.querySelectorAll('[data-sec2]').forEach(b => { b.onclick = () => { HELPDLG.q = ''; dlg.querySelector('#helpQ').value = ''; HELPDLG.sec = 'keys'; renderHelpDlg(); }; });
    return;
  }
  if (HELPDLG.sec === 'guide') {
    const g = GUIDE.find(x => x.tab === HELPDLG.mod) || GUIDE[0];
    body.innerHTML = `<h3 class="help-h">${g.t}${g.tab === tab ? ' <small>the tab shown</small>' : ` <button type="button" class="btn btn-secondary btn-sm" data-go="${g.tab}">Go to this tab</button>`}</h3>
      <p class="help-q">${TAB_Q[g.tab]}</p>
      <h4>What it does</h4><p>${g.what}</p><h4>Inputs it uses</h4><p>${g.uses}</p><h4>Reading it</h4><p>${g.read}</p>${g.more ? `<h4>How it works</h4><p>${g.more}</p>` : ''}
      <h4>Keys</h4><p>${[['run.run', 'run'], ['run.stop', 'stop']].filter(([k]) => keyOf(k) && (g.tab >= 4)).map(([k, l]) => `<kbd>${keyLabel(k)}</kbd> ${l}`).join(' · ') || ''}${g.tab === 4 ? ` · <kbd>${keyLabel('view.fit')}</kbd> fit, <kbd>${keyLabel('view.l1')}</kbd>…<kbd>${keyLabel('view.l4')}</kbd> location, <kbd>${keyLabel('view.compare')}</kbd> compare, <kbd>${keyLabel('view.diff')}</kbd> difference` : ''}${g.tab < 4 ? 'The panel and edit keys work here (see Keyboard shortcuts).' : ''}</p>`;
    const go = body.querySelector('[data-go]');
    if (go) go.onclick = () => { dlg.close(); tab = +go.dataset.go; render(); };
  } else if (HELPDLG.sec === 'methods') {
    body.innerHTML = `<h3 class="help-h">Methods and limits</h3><p class="fv-note">What each result rests on, and where it stops being reliable.</p>`
      + METHODS.map(m => `<section class="help-m"><h4>${m.t}</h4><p>${m.d}</p>${m.lim ? `<p class="help-lim"><b>Limits.</b> ${m.lim}</p>` : ''}</section>`).join('');
  } else if (HELPDLG.sec === 'keys') {
    body.innerHTML = '<h3 class="help-h">Keyboard shortcuts</h3><div id="helpKeys"></div>';
    renderKeyEditor(body.querySelector('#helpKeys'));
  }
}
(function helpMenu() {
  const menu = document.getElementById('helpMenu');
  if (!menu) return;
  const w = document.getElementById('hmWelcome'); if (w) w.onclick = () => { menu.open = false; openWelcome(); };
  menu.querySelectorAll('[data-help-sec]').forEach(b => { b.onclick = () => { menu.open = false; openHelp(b.dataset.helpSec); }; });
})();
