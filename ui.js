/*
 * ui.js — DOM wiring: builds the input sliders from physics.js's CFG,
 * wires up the four tabs, and renders each tab's charts/status text.
 *
 * Depends on physics.js (CFG, P, physics functions), draw.js (canvas
 * utilities), and simulation.js (ANIM), all loaded first.
 */

// ---------------------------------------------------------------------
// Build the Inputs sidebar from CFG. Each CFG group becomes a
// collapsible <details> section (the two most-adjusted groups, Process
// and Slurry, start open; the more "assumed" groups start collapsed —
// see the CFG entries' `h` hints) instead of one long flat list of 19
// sliders, which was overwhelming to scroll through, especially on
// mobile.
// ---------------------------------------------------------------------
const paramsContainer = document.getElementById('params');
const OPEN_BY_DEFAULT = new Set(['Process', 'Slurry']);

let renderPending = 0;
const queueRender = () => {
  cancelAnimationFrame(renderPending);
  renderPending = requestAnimationFrame(() => { renderPending = 0; render(); });
};

/** Keep a slider's --val custom property (0-100%) in sync with its value, so styles.css can paint the filled portion of the custom track. Call on init and on every 'input'. */
function syncSliderFill(input) {
  const pct = (input.value - input.min) / (input.max - input.min) * 100;
  input.style.setProperty('--val', pct + '%');
}

// Each input is a property row, as in a CFD setup tree: its name, an editable
// number with its unit, and a thin slider under it for quick sweeps. The
// slider (s_<key>) stays the source of truth: typing a number sets it and
// fires its 'input' event, exactly as dragging does (and as loading a case
// or resetting does).
(function buildSliders() {
  let currentGroup = null;
  CFG.forEach(c => {
    if (c.g) {
      const details = document.createElement('details');
      details.className = 'grp';
      details.open = OPEN_BY_DEFAULT.has(c.g);
      const summary = document.createElement('summary');
      summary.textContent = c.g;
      details.appendChild(summary);
      paramsContainer.appendChild(details);
      currentGroup = details;
    }
    const row = document.createElement('div');
    row.className = 'prop';
    row.innerHTML = `<label class="prop-l" for="n_${c.k}">${c.l}${c.h ? `<small>${c.h}</small>` : ''}</label>
      <span class="prop-v"><input type="number" id="n_${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${(+c.v).toFixed(c.d)}"><span class="prop-u">${c.u}</span></span>
      <input type="range" class="prop-range" id="s_${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.v}" aria-label="${c.l}${c.u ? ', ' + c.u : ''}" tabindex="-1">`;
    currentGroup.appendChild(row);

    const slider = row.querySelector('input[type=range]'), num = row.querySelector('input[type=number]');
    const showValue = () => { if (document.activeElement !== num) num.value = (+slider.value).toFixed(c.d); syncSliderFill(slider); };
    showValue();
    slider.addEventListener('input', () => { P[c.k] = +slider.value; if (inputProblems.has(num.id)) clearRejected(num.id); showValue(); queueRender(); });
    // (a typed value outside the slider's range is rejected: see validate.js)
    num.addEventListener('change', () => {
      guardNumber(num, { label: c.l, lo: c.min, hi: c.max, unit: c.u }, v => { slider.value = v; slider.dispatchEvent(new Event('input')); });
      num.value = (+slider.value).toFixed(c.d);
    });
  });
})();

/** Write the model-validity message (from physics.js's modelScope()) into the persistent banner at the top of the main panel. `extra` appends a one-off note (used by the animation tab to flag a supply-limited pool). */
function updateScope(extra = '') {
  const el = document.getElementById('scope');
  if (!el) return;
  const q = modelScope();
  const hard = q.issues.some(x => x.includes('no finite'));
  el.className = 'scope ' + (hard ? 'bad' : q.issues.length ? 'warn' : '');
  el.innerHTML = q.issues.length
    ? `<strong>${hard ? 'Result withheld' : 'Use with caution'}.</strong> ${q.issues.join('; ').replace(/^./, c => c.toUpperCase())}. Re ${q.Re.toFixed(3)}, Ca ${q.Ca.toFixed(2)}, H/L ${q.aspect.toFixed(2)}.${extra}`
    : `<strong>Within the thin-film checks.</strong> Re ${q.Re.toFixed(3)}, Ca ${q.Ca.toFixed(2)}, H/L ${q.aspect.toFixed(2)}.${extra}`;
  el.title = el.textContent;   // (the status bar may cut it short)
  const pg = document.getElementById('pgScope');   // (the Results pages show it under their answer)
  // (WF-2: the thin-film check is the coating's: not on the map, the materials or the later stages' pages)
  const coatingPage = ['coat', 'results'].includes(document.body.dataset.sec);
  if (pg) { pg.className = 'pg-scope ' + el.className.replace('scope', '').trim(); pg.innerHTML = coatingPage ? el.innerHTML : ''; pg.hidden = !coatingPage; }
}

/**
 * Draw the cross-section at the metering edge (blade, bead, meniscus, film) for the Contact line page: a schematic -- the
 * exit face at its angle (CFDG.exitAngle) up to the notch corner (P.face), the underside a round sketch -- with the solved
 * answer drawn on it: a = { H (gap, mm), h (wet film, mm), s (contact line up the face, mm; 0 pinned) }. The meniscus from
 * the contact line down to the film is the static (Young–Laplace) shape through those two heights. a.bare: the drawing
 * only, no labels (a small card, its numbers beside it).
 */
function drawSection(cv, aspect = 0.66, a) {
  const { c, w, h } = setupCanvas(cv, aspect);
  const H = a.H, fa = (typeof CFDG !== 'undefined' ? CFDG.exitAngle : 45) * Math.PI / 180, fc = Math.cos(fa), fs = Math.sin(fa);
  const lcap = capillaryLength(), rise = Math.max(0, H + a.s * fs - a.h);
  const st = { h: a.h, s: a.s, pinned: !(a.s > 0), phi: 2 * Math.asin(Math.min(1, rise / (2 * lcap))) };
  const mt = a.bare ? 20 : 90, mb = a.bare ? 16 : 70;   // (margins: the labels' room, none when bare)
  const x0 = 4, sc = Math.min(w / 16, (h - mt) / (H + P.face * fs + 1.2)), y0 = h - mb;
  const X = x => (x + x0) * sc, Y = y => y0 - y * sc;
  c.clearRect(0, 0, w, h);

  const ink = cssVar('--ink'), mut = cssVar('--muted'), bl = cssVar('--blade'), fb = cssVar('--fibre'),
    sl = cssVar('--slurry'), bad = cssVar('--bad'), acc = cssVar('--accent');
  c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();

  c.fillStyle = fb; c.fillRect(0, Y(0), w, P.tf * sc);
  c.fillStyle = cssVar('--soft'); c.fillRect(0, Y(-P.tf), w, 60);
  c.strokeStyle = ink; c.lineWidth = 1.2; c.strokeRect(0, Y(0), w, P.tf * sc);

  const E = [0, H], Qp = [st.s * fc, H + st.s * fs];
  const V = [P.face * fc, H + P.face * fs];
  const D = [V[0] + P.face * 0.55 * fs, V[1] - P.face * 0.55 * fc];
  const R = 15; // blade roll radius in view units, just for the drawn curvature
  const under = x => H + x * x / (2 * R);

  // slurry: pool against the blade's underside, up to the contact line, then the meniscus down to the flat film
  const men = meniscusProfile(Qp[0], st.h, st.phi);
  c.beginPath();
  c.moveTo(X(-x0), Y(0)); c.lineTo(X(-x0), Y(under(-x0)));
  for (let x = -x0; x <= 0; x += 0.25) c.lineTo(X(x), Y(under(x)));
  c.lineTo(X(0), Y(H)); c.lineTo(X(Qp[0]), Y(Qp[1]));
  men.forEach(p => c.lineTo(X(p[0]), Y(p[1])));
  c.lineTo(X(12), Y(st.h)); c.lineTo(X(12), Y(0));
  c.closePath(); c.fillStyle = sl; c.fill(); c.strokeStyle = mut; c.lineWidth = 1; c.stroke();

  // blade
  c.beginPath();
  c.moveTo(X(-x0), Y(11)); c.lineTo(X(-x0), Y(under(-x0)));
  for (let x = -x0; x <= 0; x += 0.25) c.lineTo(X(x), Y(under(x)));
  c.lineTo(X(V[0]), Y(V[1])); c.lineTo(X(D[0]), Y(D[1])); c.lineTo(X(D[0] + 1), Y(11));
  c.closePath(); c.fillStyle = bl; c.fill(); c.strokeStyle = ink; c.lineWidth = 1.6; c.stroke();

  // contact-line marker
  c.fillStyle = st.s > P.face ? bad : acc;
  c.beginPath(); c.arc(X(Qp[0]), Y(Qp[1]), 5, 0, 7); c.fill();

  if (a.bare) { c.restore(); return; }
  c.fillStyle = ink;
  [[E, 'metering edge', -4, 20], [V, 'notch corner', 6, -8], [D, 'dry edge', 6, 6]].forEach(([p, t, dx, dy]) => {
    c.beginPath(); c.arc(X(p[0]), Y(p[1]), 4, 0, 7); c.fill();
    c.font = '12px ' + cssVar('--mono');
    outlinedText(c, t, X(p[0]) + dx + 8, Y(p[1]) + dy, ink);
  });

  c.fillStyle = mut; c.font = '12px ' + cssVar('--mono');
  outlinedText(c, 'gap H = ' + H.toFixed(2) + ' mm', X(-3.8), Y(H / 2) + 4, mut);
  outlinedText(c, 'film ' + st.h.toFixed(2) + ' mm', X(8), Y(st.h) - 8, mut);

  c.strokeStyle = mut; c.setLineDash([3, 3]);
  c.beginPath(); c.moveTo(X(-0.7), Y(0)); c.lineTo(X(-0.7), Y(H)); c.stroke(); c.setLineDash([]);

  outlinedText(c, st.pinned ? 'contact line pinned at the edge' : 'contact line ' + st.s.toFixed(2) + ' mm up the face', X(Qp[0]) + 12, Y(Qp[1]) - 12, acc);
  c.fillStyle = mut; c.font = '11px ' + cssVar('--sans');
  c.fillText('schematic: the exit face at ' + (fa * 180 / Math.PI).toFixed(0) + '°, not to scale along the blade', 10, h - 10);
  c.restore();
}

// ---------------------------------------------------------------------
// Module frame: every module fills the work area the same way -- a
// toolbar (its controls, and its verdicts as pills at the right), a
// viewport of titled panes sized to fit, and a results strip (key numbers,
// and "About this view").
// ---------------------------------------------------------------------
const workbenchFits = () => innerWidth >= 1024;
/** A hint where there is nothing to show yet: what it is, what to do next, and the button to do it. */
const emptyHint = (title, text, actions = '') => `<div class="empty-hint"><svg class="eh-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 7.5v5.5M12 16.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><b>${title}</b><p>${text}</p>${actions ? `<div class="eh-act">${actions}</div>` : ''}</div>`;
/** One line at the top of the inputs bar: what its inputs do in the page shown. */
const TREE_NOTE = [
  'The inputs this page uses (the others are on the pages that use them); the animation\'s own settings are at the bottom.',
  'The inputs this page uses (the others are on the pages that use them).',
  'The inputs this page uses (the others are on the pages that use them).',
  'The inputs this page uses (the others are on the pages that use them).',
  'The shared inputs, then the CFD setup and the four locations below. Change them, then Run.',
  'The DOE starts from these inputs and the CFD setup (its base case) and varies the factors of its Design tab. Changing an input here changes 2D CFD too.',
  'The predictions use these inputs; the Fit tab can adjust them to your data.',
  'Every result on this page follows these inputs.',
  'The 1D uses these inputs and the 2D setup (blade, rheology, fibre, locations), so it compares with the 2D like for like.',
  'The 3D uses the 2D setup at the strip\'s location (blade, rheology, fibre, the gap and contact angle across the web), or a blade from an STL or STEP file; its geometry, region and mesh are below.',
  'The 1D uses these inputs and the 2D setup; the ripple comes from the gap waviness and vibration below.',
  'The 1D at every position across the web: the gap and contact angle vary there with the inputs under Variation across the web.',
  'The chain starts from the wet film these inputs give (the 1D, or the 2D and 3D where solved); the oven\'s zones are below.',
  'The slurry\'s card and the rheology model, its laws\' extras and the structure are edited on the page; viscosity, n, yield stress, surface tension and the fibre web as set here and in Coating › 2D.',
  'The line: nothing to set here; each stage\'s page has its own inputs.',
];
/** The (i) of a view's toolbar: this tab's guide in the help. */
const aboutButton = () => `<button type="button" class="icon-btn vp-about" data-about title="About this tab: what it answers and how to read it" aria-label="About this tab"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="4.9" r=".95" fill="currentColor"/></svg></button>`;
/** A plot's explanation is behind an (i) in its caption (open ones remembered while the page is open). */
const PANE_NOTES = new Set();
const paneInfo = id => `<button type="button" class="pane-i" data-note="${id}" aria-expanded="${PANE_NOTES.has(id)}" aria-controls="note_${id}" title="What this plot shows">i</button>`;
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('[data-about]');
  if (a) { openHelp('guide'); return; }
  const n = e.target.closest && e.target.closest('[data-note]');
  if (n) { const id = n.dataset.note; if (PANE_NOTES.has(id)) PANE_NOTES.delete(id); else PANE_NOTES.add(id); render(); }
});
function moduleFrame({ tools = '', panes, cols = 1, notes = '', extra = '', steps = '', top = '' }) {
  // the page reads top down: its sub tabs (and controls), the answer (verdict, the question, the other
  // checks, the thin-film validity), the key numbers, then the plots; its history opens from Edit > History
  return `<div class="mod-wb" id="modWb" style="--dock-h: ${modDockH}px">
    <div class="vp-bar pg-bar" role="toolbar" aria-label="Page controls">${subTabs()}${steps}${tools ? `<div class="pg-tools">${tools}</div>` : ''}<span class="vp-spacer"></span>${aboutButton()}</div>
    <div class="verdict"><div class="status" id="st"></div><p class="vq">${navQ(navNow())}</p><p class="pg-scope" id="pgScope"></p></div>
    <div class="mod-results"><div class="stats" id="ss"></div></div>
    <div class="mod-vp" data-cols="${cols}" style="--cols:${cols}">${top ? `<div class="mod-top">${top}</div>` : ''}${panes.map(p => `<figure class="pane${p.center ? ' pane-center' : ''}"><figcaption>${uiBadge(p.icon)}${p.title}${p.note ? paneInfo(p.id) : ''}</figcaption><canvas id="${p.id}" role="img" aria-label="${p.aria}"></canvas>${p.legend ? `<div class="pane-legend">${p.legend}</div>` : ''}${p.note ? `<p class="pane-note" id="note_${p.id}"${PANE_NOTES.has(p.id) ? '' : ' hidden'}>${p.note}</p>` : ''}</figure>`).join('')}${extra ? `<div class="mod-extra">${extra}</div>` : ''}</div>
    <div class="split split-h" id="modSplit" role="separator" aria-orientation="horizontal" aria-label="Resize the history panel" tabindex="0"></div>
    <section class="dock mod-dock" aria-label="History">
      <div class="dock-tabs" role="tablist" aria-label="Panels"><button type="button" role="tab" data-dock="history" aria-selected="true" aria-controls="mod-history">${uiIco('history')}History<span class="tab-n" data-n="history"></span></button></div>
      <div class="dock-body"><div class="dock-panel" id="mod-history" role="tabpanel"><div class="history-host"></div></div></div>
    </section>
  </div>`;
}
/** The modules' dock (their history): its height, dragged on the splitter (or arrow keys on it). */
let modDockH = 170;
function wireModDock() {
  const sp = document.getElementById('modSplit'), wb = document.getElementById('modWb');
  if (!sp || !wb) return;
  const setH = h => { modDockH = Math.round(Math.max(90, Math.min(wb.clientHeight - 260, h))); wb.style.setProperty('--dock-h', modDockH + 'px'); };
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = modDockH;
    const move = ev => setH(h0 - (ev.clientY - y0));
    const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); render(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setH(modDockH + (e.key === 'ArrowUp' ? 30 : -30)); render(); } });
}
/** Height (px) a pane's canvas may take so that the viewport's panes fit its height (rows share it). */
function paneRoom(cv) {
  const vp = cv.closest('.mod-vp');
  if (!vp || !workbenchFits()) return Infinity;
  const cols = +vp.dataset.cols || 1, rows = Math.ceil(vp.querySelectorAll('.pane').length / cols);
  const cs = getComputedStyle(vp), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), gap = parseFloat(cs.rowGap) || 0;
  const fig = cv.closest('.pane'), top = vp.querySelector('.mod-top'), topH = top ? top.offsetHeight + gap : 0;   // (a page's block above its panes)
  return Math.max(120, (vp.clientHeight - pad - topH - gap * (rows - 1)) / rows - (fig.offsetHeight - cv.offsetHeight) - 2);
}
/** A canvas's aspect ratio (height / width) in its pane: `want`, or flatter so the panes fit. */
const fitAspect = (cv, want) => Math.max(0.12, Math.min(want, paneRoom(cv) / (cv.parentElement.clientWidth || 600)));

// ---------------------------------------------------------------------
// Start-up (the animation)
// ---------------------------------------------------------------------
function viewA() {
  document.getElementById('setupExtra').innerHTML = `<div class="tree-sep">Animation</div>
    <details class="grp" open><summary>Scenario</summary>
    <div class="anim-params">
      <div class="section-label">Feed pulsing</div>
      <div class="sl"><label for="fa"><span class="lt">Feed pulse depth</span><output id="fao"></output></label><input type="range" class="prop-range" id="fa" min="0" max="100" step="5"></div>
      <div class="sl"><label for="fp"><span class="lt">Pulse period</span><output id="fpo"></output></label><input type="range" class="prop-range" id="fp" min="2" max="20" step="0.5"></div>
      <div class="sl"><label for="fd"><span class="lt">Pulse length</span><output id="fdo"></output></label><input type="range" class="prop-range" id="fd" min="10" max="80" step="5"></div>

      <div class="section-label">Pool setup</div>
      <div class="sl"><label for="pl0"><span class="lt">Pool depth at start</span><output id="pl0o"></output></label><input type="range" class="prop-range" id="pl0" min="2.5" max="8" step="0.5"></div>
      <div class="sl"><label for="plp"><span class="lt">Pool length upstream</span><output id="plpo"></output></label><input type="range" class="prop-range" id="plp" min="20" max="300" step="10"></div>

      <div class="section-label">View</div>
      <div class="sl"><label for="az"><span class="lt">Position across web</span><output id="azo"></output></label><input type="range" class="prop-range" id="az" min="0" max="300" step="1"></div>
      <div class="sl"><label for="rt"><span class="lt">Playback speed</span><output id="rto"></output></label><input type="range" class="prop-range" id="rt" min="0.1" max="1" step="0.05"><span class="h">1× = real time</span></div>
    </div></details>`;
  view.innerHTML = moduleFrame({
    tools: `<button id="ap" class="btn btn-primary btn-sm tool-run" type="button"></button>
      <button id="ar" class="tool-btn" type="button">${uiIco('restart')}Restart</button>
      <div class="vp-time"><label for="at">Time</label><input type="range" class="prop-range" id="at" min="0" max="58" step="0.1"><output id="ato"></output></div>`,
    panes: [
      { id: 'ca', icon: 0, title: 'Slurry metering under the fixed blade · fibre moving left to right', aria: 'Animation of slurry metering under the fixed blade onto the moving fibre', center: true },
      { id: 'cb', icon: 'zoom', title: 'Downstream meniscus, magnified · same simulation and clock', aria: 'Separate magnified animation of the downstream meniscus', center: true },
    ],
  });

  const cv = document.getElementById('ca'), cv2 = document.getElementById('cb');
  // (each canvas narrows to keep its proportions when the viewport is short)
  if (workbenchFits()) { cv.dataset.maxh = paneRoom(cv); cv2.dataset.maxh = paneRoom(cv2); }
  ANIM.start(cv, cv2);

  const ap = document.getElementById('ap'), at = document.getElementById('at'), ato = document.getElementById('ato'),
    az = document.getElementById('az'), azo = document.getElementById('azo');
  const syncPlayButton = () => { ap.innerHTML = ANIM.playing ? `${uiIco('pause')}Pause` : `${uiIco('play')}Play`; ap.setAttribute('aria-pressed', ANIM.playing); };
  syncPlayButton();
  az.value = ANIM.z; azo.textContent = ANIM.z + ' mm'; syncSliderFill(az);
  syncSliderFill(at);

  ap.onclick = () => { ANIM.playing = !ANIM.playing; syncPlayButton(); };
  document.getElementById('ar').onclick = () => { ANIM.seek(0); };
  at.oninput = () => { ANIM.seek(+at.value); ANIM.playing = false; syncPlayButton(); syncSliderFill(at); };
  ANIM.onTime = t => { if (document.activeElement !== at) { at.value = t; syncSliderFill(at); } ato.textContent = t.toFixed(0) + ' s'; };

  const fa = document.getElementById('fa'), fp = document.getElementById('fp'),
    fao = document.getElementById('fao'), fpo = document.getElementById('fpo'),
    fd = document.getElementById('fd'), fdo = document.getElementById('fdo');
  fa.value = ANIM.fa * 100; fp.value = ANIM.fp; fd.value = ANIM.fd * 100;
  const syncFeedLabels = () => {
    fao.textContent = fa.value + ' %';
    fpo.textContent = (+fp.value).toFixed(1) + ' s';
    fdo.textContent = fd.value + ' % of period';
    syncSliderFill(fa); syncSliderFill(fp); syncSliderFill(fd);
  };
  syncFeedLabels();

  const rt = document.getElementById('rt'), rto = document.getElementById('rto');
  rt.value = ANIM.rate; syncSliderFill(rt);
  const syncRateLabel = () => { rto.textContent = (+rt.value).toFixed(2) + '×'; syncSliderFill(rt); };
  syncRateLabel();
  rt.oninput = () => { ANIM.rate = +rt.value; syncRateLabel(); };

  const p0 = document.getElementById('pl0'), pp = document.getElementById('plp'),
    p0o = document.getElementById('pl0o'), ppo = document.getElementById('plpo');
  p0.value = ANIM.L0; pp.value = ANIM.Lp;
  const syncPoolLabels = () => { p0o.textContent = (+p0.value).toFixed(1) + ' mm'; ppo.textContent = pp.value + ' mm'; syncSliderFill(p0); syncSliderFill(pp); };
  syncPoolLabels();

  fa.oninput = fp.oninput = fd.oninput = () => {
    ANIM.fa = +fa.value / 100; ANIM.fp = +fp.value; ANIM.fd = +fd.value / 100;
    syncFeedLabels(); ANIM.refresh();
  };
  p0.oninput = pp.oninput = () => {
    ANIM.L0 = +p0.value; ANIM.Lp = +pp.value;
    syncPoolLabels(); ANIM.reinit();
  };
  az.oninput = () => { ANIM.z = +az.value; azo.textContent = ANIM.z + ' mm'; syncSliderFill(az); ANIM.refresh(); fillA(); };

  fillA();
  updateScope(ANIM.limited ? ' <strong>Pool outlet is currently supply-limited.</strong>' : '');
}

/** Fill the animation tab's status pills + stats grid from ANIM.info (set by simulation.js's setModel()). */
function fillA() {
  const i = ANIM.info, st = i.st;
  let statusHtml;
  if (i.WET) statusHtml = pill('Slurry reaches the notch corner: the dry edge gets wet', 'bad');
  else if (st.s > 0.05) statusHtml = pill('Contact line lifted ' + st.s.toFixed(1) + ' mm up the face', 'warn');
  else statusHtml = pill('Detaches at the active metering edge', 'ok');
  statusHtml += pill('Local gap ' + i.H.toFixed(2) + ' mm', '') + pill('Contact angle ' + i.th.toFixed(0) + '°', '');
  document.getElementById('st').innerHTML = statusHtml;

  document.getElementById('ss').innerHTML = [
    ['Gap at this position', i.H.toFixed(2) + ' mm'],
    ['Wet film in the animation', st.h.toFixed(2) + ' mm'],
    ['Film / gap', (st.h / i.H).toFixed(3)],
    ['Shear rate U/H', (P.U / 60 / (i.H / 1000)).toFixed(1) + ' 1/s'],
    ['Numerical state', ANIM.safe ? 'physical bounds passed' : 'surface solve stopped'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// The answers of the Results pages, shared by each page and the Summary
// ---------------------------------------------------------------------
/** The contact line and the wet film across the web (answers.js: the 1D's profile where the blade is, at the level of the
 *  most detailed model solved), in mm, their ranges and the verdict; null while the 1D solves. */
function contactAcross() {
  const X = ansAcross();
  if (!X) return null;
  const N = X.z.length, WIDTH = 300, pts = X.z.map((z, k) => [z, X.s[k] * 1000]), film = X.z.map((z, k) => [z, X.film[k] * 1000]);
  const ss = pts.map(q => q[1]), hs = film.map(q => q[1]);
  const mx = Math.max(...ss), mn = Math.min(...ss), hmn = Math.min(...hs), hmx = Math.max(...hs), over = ss.filter(s => s > P.face).length;
  const peakToPeak = mx - mn, wetFraction = over / N * 100, filmDeviation = (hmx - hmn) / ((hmx + hmn) / 2) * 100;
  const verdict = over ? ['Slurry reaches the notch corner over ' + wetFraction.toFixed(0) + '% of the width', 'bad']
    : peakToPeak > 0.5 ? ['Uneven contact line: ' + peakToPeak.toFixed(1) + ' mm peak to peak', 'warn']
      : mx === 0 ? ['Pinned at the sharp edge everywhere', 'ok'] : ['Contact line steady', 'ok'];
  return { N, WIDTH, pts, film, mx, mn, over, hmn, hmx, peakToPeak, wetFraction, filmDeviation, verdict, src: X.src, label: X.label };
}
/** The web edge from the blade to the oven: the bead on the film at the web's edges (answers.js; of the two, the one whose
 *  scallops are larger at the oven), the amplitude along the way and at the oven, and the verdict; null while the 1D solves. */
function edgeOutlook() {
  const X = ansAcross();
  if (!X) return null;
  const ovenDistanceMm = P.oven * 1000, n = X.z.length - 1;
  const at = (side, z, h) => { const e = edgeBead(h); return { side, z, h, e, end: e.arrest ? P.a0e / 1000 : edgeAmplitudeAt(ovenDistanceMm, h) }; };
  const L = at('left', X.z[0], X.film[0]), R = at('right', X.z[n], X.film[n]), pick = R.end > L.end ? R : L, e = pick.e;
  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const x = ovenDistanceMm * i / 100;
    pts.push([x, e.arrest ? P.a0e / 1000 : edgeAmplitudeAt(x, pick.h)]);
  }
  const endAmplitude = pick.end;
  const visible = endAmplitude > 0.2;
  const verdict = e.arrest ? ['Yield stress freezes the edge', 'ok']
    : visible ? ['Scalloped edge at the oven: ' + (endAmplitude * 2).toFixed(1) + ' mm peak to peak', 'bad']
      : ['Edge stays straight to the oven', 'ok'];
  return { e, ovenDistanceMm, pts, endAmplitude, visible, verdict, side: pick.side, z: pick.z, h: pick.h, src: X.src, label: X.label };
}
/** The film-surface ripple: its levelling (the 1D's model on the answer's film there, answers.js) at the location where
 *  the most is left at the oven, and the verdict; null while the 1D solves. */
function surfaceOutlook() {
  let best = null;
  CFD_LOCS.forEach((l, i) => { const lv = ansRippleAt(i); if (lv) { const aEnd = lv.at(lv.tRes); if (!best || aEnd > best.aEnd) best = { lv, aEnd, i }; } });
  if (!best) return null;
  const { lv, aEnd } = best, remainMicrons = aEnd * 1e6;
  const verdict = remainMicrons > 5 ? ['Ripple survives to the oven: ' + remainMicrons.toFixed(0) + ' µm', 'bad']
    : remainMicrons > 1 ? ['Small ripple remains: ' + remainMicrons.toFixed(1) + ' µm', 'warn']
      : ['Film levels out before the oven', 'ok'];
  return { lv, aEnd, remainMicrons, verdict, loc: best.i, src: lv.src };
}
/** A Results page before the 1D has solved: its status and an empty numbers strip (the page redraws when it arrives). */
function ansWaiting() {
  document.getElementById('st').innerHTML = ONE_D.error ? pill('The 1D could not be solved: ' + ONE_D.error, 'bad') : pill('Solving the 1D…', '');
  document.getElementById('ss').innerHTML = '';
}

// ---------------------------------------------------------------------
// Tab 2: Contact line at the blade
// ---------------------------------------------------------------------
function view1() {
  oneDRequest(true);
  const ca = contactAcross(), mid = ca ? ansAcrossAt(150) : null;
  view.innerHTML = moduleFrame({
    cols: workbenchFits() ? 2 : 1,
    panes: [
      { id: 'c1', icon: 'section', title: 'Cross-section at the web centre', aria: 'Cross-section of blade, slurry and meniscus',
        note: `The film and the contact line at the web's centre, ${ca ? ca.label : 'from the solvers'}. The meniscus drawn from the contact line down to the film is the static Young–Laplace shape; it is pinned at the sharp edge when the contact angle is large and climbs the exit face when it is small.` },
      { id: 'c2', icon: 1, title: 'Top view: contact line across the web', aria: 'Contact line position across the web',
        note: `Where the contact line sits on the exit face, from the metering edge (0) to the notch corner, ${ca ? ca.label : 'from the solvers'}. Gap waviness, fibre thickness and wetting changes push it up and down.` },
    ],
  });
  if (!ca) { ansWaiting(); return; }
  const c1 = document.getElementById('c1');
  drawSection(c1, workbenchFits() ? fitAspect(c1, 0.95) : 0.66, { H: localGap(150), h: mid.film * 1000, s: mid.s * 1000 });

  const { WIDTH, pts, mx, mn, hmn, hmx, peakToPeak, filmDeviation, verdict } = ca;
  const c2 = document.getElementById('c2');
  plotChart(c2, fitAspect(c2, 0.95), {
    x0: 0, x1: WIDTH, y0: 0, y1: Math.max(P.face * 1.3, mx * 1.1),
    yl: 'contact line up the face (mm)', xl: 'position across web (mm)',
    s: [{ p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: P.face, c: cssVar('--bad'), t: 'notch corner: slurry reaches the dry edge' }],
  });

  let statusHtml = pill(...verdict);
  statusHtml += pill(ca.label.charAt(0).toUpperCase() + ca.label.slice(1), '');
  statusHtml += pill('Capillary length ' + capillaryLength().toFixed(2) + ' mm', '');
  document.getElementById('st').innerHTML = statusHtml;

  document.getElementById('ss').innerHTML = [
    ['Wet film, centre', (mid.film * 1000).toFixed(3) + ' mm'],
    ['Film range across web', hmn.toFixed(2) + ' to ' + hmx.toFixed(2) + ' mm'],
    ['Film variation', filmDeviation.toFixed(1) + ' %'],
    ['Contact line range', mn.toFixed(2) + ' to ' + mx.toFixed(2) + ' mm'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Tab 3: Web edge
// ---------------------------------------------------------------------
function view2() {
  oneDRequest(true);
  const U = P.U / 60, ed = edgeOutlook();

  view.innerHTML = moduleFrame({
    panes: [
      { id: 'c1', icon: 2, title: 'Edge growth from the blade to the oven', aria: 'Edge amplitude versus distance',
        note: `The wet edge is a ridge of slurry along the fibre margin, as high as the film there${ed ? ` (${(ed.h * 1000).toFixed(3)} mm at the ${ed.side} edge, ${ed.label})` : ''}. Surface tension pulls it into beads (Rayleigh–Plateau), and viscosity slows that down. A yield stress larger than the capillary pressure freezes it.` },
      { id: 'c2', icon: 'top', title: 'Top view of the edge at the oven entrance', aria: 'Top view of the wet edge',
        note: 'Machine direction left to right.' },
    ],
  });
  if (!ed) { ansWaiting(); return; }
  const { e, ovenDistanceMm, pts, endAmplitude, verdict } = ed;

  const c1 = document.getElementById('c1');
  plotChart(c1, fitAspect(c1, 0.36), {
    x0: 0, x1: ovenDistanceMm, y0: 0, y1: Math.max(e.lam / 4 * 1.1, 0.5),
    yl: 'edge scallop amplitude (mm)', xl: 'distance from blade (mm)', yd: 2,
    s: [{ p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: 0.2, c: cssVar('--warn'), t: 'visible' }],
  });

  document.getElementById('st').innerHTML = pill(...verdict)
    + pill(`The ${ed.side} edge (z ${ed.z.toFixed(0)} mm): film ${(ed.h * 1000).toFixed(3)} mm, ${ansFrom(ed.src)}`, '')
    + pill('Capillary pressure ' + e.pc.toFixed(0) + ' Pa vs yield ' + P.ty.toFixed(1) + ' Pa', '')
    // (the structure, GO-1: just sheared at the blade, the slurry rebuilds on the web)
    + (e.lam0 != null ? pill(`Structure λ ${e.lam0.toFixed(2)} just after the blade: grows at ${e.sig.toFixed(2)} 1/s at first (rested ${(P.g / (6 * e.muRested * e.R)).toFixed(2)} 1/s); ${e.arrest ? 'the yield stress holds it from the start' : Number.isFinite(e.tArrest) ? `the rebuilding yield stress holds it from ${e.tArrest.toFixed(0)} s (${(e.tArrest * U * 1000).toFixed(0)} mm)` : 'the rebuilt yield stress does not hold it'}`, '') : '');

  const c2 = document.getElementById('c2');
  const { c, w, h } = setupCanvas(c2, fitAspect(c2, 0.32));
  const plotWindow = Math.max(e.lam * 3.2, 12), sc = w / plotWindow;
  c.clearRect(0, 0, w, h);
  const fibreColor = cssVar('--fibre'), slurryColor = cssVar('--slurry'), ink = cssVar('--ink');
  c.fillStyle = cssVar('--surface'); c.fillRect(0, 0, w, h);
  const mid = h * 0.55;
  const scallopY = x => mid - (e.arrest ? P.a0e / 1000 : endAmplitude) * sc * Math.sin(2 * Math.PI * (x / sc) / e.lam);

  c.fillStyle = slurryColor;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(w, 0); c.lineTo(w, mid);
  for (let x = w; x >= 0; x -= 2) c.lineTo(x, scallopY(x));
  c.closePath(); c.fill();

  c.fillStyle = fibreColor;
  c.beginPath(); c.moveTo(0, h); c.lineTo(w, h); c.lineTo(w, mid);
  for (let x = w; x >= 0; x -= 2) c.lineTo(x, scallopY(x));
  c.closePath(); c.fill();

  c.strokeStyle = ink; c.lineWidth = 1.4;
  c.beginPath();
  for (let x = 0; x <= w; x += 2) { const y = scallopY(x); x ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.stroke();

  c.fillStyle = cssVar('--muted'); c.font = '12px ' + cssVar('--mono');
  c.fillText('slurry', 10, 20);
  c.fillText('white fibre margin', 10, h - 10);
  c.fillText('scallop wavelength ' + e.lam.toFixed(1) + ' mm', w - 190, 20);

  document.getElementById('ss').innerHTML = [
    ['Edge bead radius', (e.R * 1000).toFixed(2) + ' mm'],
    ['Growth time constant', (1 / e.sig).toFixed(2) + ' s'],
    ['Time to oven', (ovenDistanceMm / 1000 / U).toFixed(0) + ' s'],
    ['Amplitude at oven', endAmplitude.toFixed(2) + ' mm'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Tab 4: Film surface
// ---------------------------------------------------------------------
function view3() {
  oneDRequest(true);
  const sf = surfaceOutlook(), where = sf ? `at L${sf.loc + 1} (z ${CFD_LOCS[sf.loc].z} mm, where the most is left at the oven), on the wet film ${ansFrom(sf.src)}` : '';

  view.innerHTML = moduleFrame({
    panes: [
      { id: 'c1', icon: 3, title: 'Film surface across the web', aria: 'Film surface ripple before and after levelling',
        note: `Deviation from the mean, in µm, ${where}. Dashed: just after the blade. Solid: at the oven entrance.` },
      { id: 'c2', icon: 'period', title: 'Levelling in time', aria: 'Ripple amplitude versus time',
        note: sf ? `Surface tension smooths the film (the 1D's levelling model). A yield stress stops levelling at a residual amplitude that stays into the oven. The ripple source is the gap wobble (through the film sensitivity dh/dH = ${sf.lv.dhdH.toFixed(2)}, the 1D's) plus vibration.` : '' },
    ],
  });
  if (!sf) { ansWaiting(); return; }
  const { lv, aEnd, remainMicrons, verdict } = sf, { h, dhdH, a0, tau, residual: residualFromYield, tRes } = lv;

  const plotWindow = Math.max(P.lam * 3, 20);
  const p0 = [], p1 = [];
  for (let i = 0; i <= 200; i++) {
    const z = plotWindow * i / 200, s = Math.sin(2 * Math.PI * z / P.lam);
    p0.push([z, a0 * 1e6 * s]);
    p1.push([z, aEnd * 1e6 * s]);
  }
  const ym = Math.max(a0 * 1e6 * 1.3, 10);
  const c1 = document.getElementById('c1');
  plotChart(c1, fitAspect(c1, 0.34), {
    x0: 0, x1: plotWindow, y0: -ym, y1: ym, yl: 'film deviation (µm)', xl: 'across web (mm)',
    s: [{ p: p0, c: cssVar('--muted'), dash: [5, 4] }, { p: p1, c: cssVar('--accent'), w: 2.4 }],
  });

  const tp = [];
  const tSpan = Math.max(tRes * 1.4, 1);
  for (let i = 0; i <= 100; i++) {
    const t = tSpan * i / 100;
    tp.push([t, lv.at(t) * 1e6]);
  }
  const c2 = document.getElementById('c2');
  plotChart(c2, fitAspect(c2, 0.34), {
    x0: 0, x1: tSpan, y0: 0, y1: Math.max(a0 * 1e6 * 1.1, 5),
    yl: 'ripple amplitude (µm)', xl: 'time after the blade (s)',
    s: [{ p: tp, c: cssVar('--accent'), w: 2.2 }],
    vl: [{ x: tRes, c: cssVar('--warn'), t: 'oven' }],
  });

  const sharePct = remainMicrons / (h * 1e6) * 100;
  const Ca = muEff(P.U / 60 / (gapHeight() / 1000)) * P.U / 60 / P.g;
  document.getElementById('st').innerHTML = pill(...verdict)
    + pill(P.ty > 0 && residualFromYield >= a0 ? 'Yield stress blocks levelling completely'
      : P.ty > 0 ? 'Levels down to a yield-limited residual' : 'Levelling limited by viscosity only', '')
    // (the structure, GO-1: just sheared at the blade, the slurry rebuilds on the web)
    + (lv.lam0 != null ? pill(`Structure λ ${lv.lam0.toFixed(2)} just after the blade, rebuilding at rest: levelling time ${tau.toFixed(2)} → ${lv.tauRested.toFixed(2)} s, residual ${(residualFromYield * 1e6).toFixed(0)} → ${(lv.residualRested * 1e6).toFixed(0)} µm${lv.tFrozen != null && lv.residualRested > 0 ? (lv.tFrozen === 0 ? '; held from the start' : `; held from ${lv.tFrozen < 10 ? lv.tFrozen.toFixed(1) : lv.tFrozen.toFixed(0)} s`) : ''}`, '') : '')
    // Ca's value is already in the validity banner above; here we just flag whether it crosses the ribbing threshold.
    + pill('Ribbing watch above Ca 0.5 (roll-coating value)', Ca > 0.5 ? 'warn' : '');

  document.getElementById('ss').innerHTML = [
    ['Starting ripple', (a0 * 1e6).toFixed(0) + ' µm'],
    ['Levelling time', tau.toFixed(2) + ' s'],
    ['Residual from yield', (Math.min(residualFromYield, 1) * 1e6).toFixed(0) + ' µm'],
    ['At oven, share of film', sharePct.toFixed(2) + ' %'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Summary (Results' first page, where the app opens): every answer at a glance
// ---------------------------------------------------------------------
/** A small line chart (the Summary's cards): points [x, y], the y range, an optional dashed level and its label.
 * It stretches to the card's width at a fixed height; lines keep their width, the label stays text. */
function sparkline(pts, y0, y1, level) {
  const W = 400, H = 84, x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const X = x => 4 + (x - x0) / ((x1 - x0) || 1) * (W - 8), Y = y => H - 8 - (Math.min(Math.max(y, y0), y1) - y0) / ((y1 - y0) || 1) * (H - 16);
  const d = pts.map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join('');
  const ly = level ? Y(level.y) : 0;
  return `<div class="spark" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H - 8}" y2="${H - 8}" class="sp-base"/>${level ? `<line x1="0" x2="${W}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" class="sp-level" style="stroke: var(${level.c})"/>` : ''}<path d="${d}" class="sp-line"/></svg>${level ? `<span class="sp-lab" style="top: ${(ly - 17).toFixed(0)}px">${level.t}</span>` : ''}</div>`;
}
function viewSummary() {
  oneDRequest(true);
  const ca = contactAcross(), ed = edgeOutlook(), sf = surfaceOutlook(), web = processWeb();
  const cfg = k => CFG.find(c => c.k === k), val = (k, l) => `${l} <b>${P[k].toFixed(cfg(k).d)} ${cfg(k).u}</b>`;
  if (!ca || !ed || !sf || !web) {
    view.innerHTML = `<div class="sum-page">
      <div class="vp-bar pg-bar" role="toolbar" aria-label="Page controls">${subTabs()}<span class="vp-spacer"></span>${aboutButton()}</div>
      <div class="sum-body"><div class="sum-top"><div><h1>Your coating at these settings</h1>
        <p class="sum-set">${[val('U', 'Web speed'), val('Hm', 'Scraper height'), val('mu', 'Viscosity'), val('ty', 'Yield stress')].join(' · ')}</p></div></div>
      ${emptyHint(ONE_D.error ? 'The 1D could not be solved' : 'Solving the 1D across the web…', ONE_D.error ? escAttr(ONE_D.error) : 'The answers come from the most detailed model solved for these inputs: the 1D across the web, at the level of the 2D and 3D where they are solved.')}</div></div>`;
    return;
  }
  const answer = (v, yes, warn) => v[1] === 'bad' ? yes : v[1] === 'warn' ? warn : 'No';
  const tone = v => v[1] === 'bad' ? '--bad' : v[1] === 'warn' ? '--warn' : '--ok';
  const card = (view, label, q, v, badge, value, unit, chart) => `<article class="sum-card" data-view="${view}" style="--c: var(${tone(v)})" title="${v[0]}">
      <div class="sc-top"><span class="sc-lab">${uiBadge(view)}${label}</span><span class="sc-badge">${badge}</span></div>
      <h3>${q}</h3>
      <div class="sc-v"><strong>${value}</strong><span>${unit}</span></div>
      ${chart}
      <button type="button" class="sc-open" data-view="${view}">Open ${label.toLowerCase()} ›</button>
    </article>`;
  const surfPts = [], tSpan = Math.max(sf.lv.tRes * 1.4, 1);
  for (let i = 0; i <= 100; i++) { const t = tSpan * i / 100; surfPts.push([t, sf.lv.at(t) * 1e6]); }
  view.innerHTML = `<div class="sum-page">
    <div class="vp-bar pg-bar" role="toolbar" aria-label="Page controls">${subTabs()}<span class="vp-spacer"></span>${aboutButton()}</div>
    <div class="sum-body">
      <div class="sum-top">
        <div><h1>Your coating at these settings</h1>
          <p class="sum-set">${[val('U', 'Web speed'), val('Hm', 'Scraper height'), val('mu', 'Viscosity'), val('ty', 'Yield stress')].join(' · ')}<button type="button" class="linkish" id="sumInputs">Edit inputs</button></p></div>
        <div class="sum-film" title="${escAttr(web.label)}"><span>${uiBadge('film')}Wet film, mean</span><strong>${(web.mean * 1000).toFixed(3)} mm</strong><em>${(web.min * 1000).toFixed(3)} to ${(web.max * 1000).toFixed(3)} mm across the web · ${web.tag}</em></div>
      </div>
      <div class="sum-cards">
        ${card(1, 'Contact line', 'Slurry on the dry edge?', ca.verdict, answer(ca.verdict, 'Yes', 'Uneven'),
          ca.mx === 0 ? '0 mm' : `${ca.mn.toFixed(2)}–${ca.mx.toFixed(2)} mm`, `up the face (dry edge at ${P.face.toFixed(1)} mm) · ${ANS_SRC[ca.src]}`,
          sparkline(ca.pts, 0, Math.max(P.face * 1.3, ca.mx * 1.1), { y: P.face, c: '--bad', t: 'dry edge' }))}
        ${card(2, 'Web edge', 'Edge scallops at the oven?', ed.verdict, answer(ed.verdict, 'Yes', 'Some'),
          `${(ed.endAmplitude * 2).toFixed(1)} mm`, `peak to peak at the oven (${ed.side} edge)`,
          sparkline(ed.pts, 0, Math.max(ed.e.lam / 4 * 1.1, 0.5), { y: 0.2, c: '--warn', t: 'visible' }))}
        ${card(3, 'Film surface', 'Streaks at the oven?', sf.verdict, answer(sf.verdict, 'Yes', 'Slight'),
          `${sf.remainMicrons < 10 ? sf.remainMicrons.toFixed(1) : sf.remainMicrons.toFixed(0)} µm`, `ripple left at the oven (L${sf.loc + 1}) · ${ANS_SRC[sf.src]}`,
          sparkline(surfPts, 0, Math.max(sf.lv.a0 * 1e6 * 1.1, 5)))}
      </div>
      <p class="pg-scope" id="pgScope"></p>
      <h2 class="sum-h">Go further</h2>
      <div class="sum-more">
        <button type="button" data-nav="gap">${uiBadge(4)}<b>Flow under the blade</b><span>Coating: 1D along the blade, 2D CFD at four places across the web, 3D.</span></button>
        <button type="button" data-nav="doe">${uiBadge(5)}<b>What matters most</b><span>Studies › DOE: vary up to three settings together.</span></button>
        <button type="button" data-nav="meas">${uiBadge(6)}<b>Check against your data</b><span>Studies › Measured data: import measurements and fit the model.</span></button>
      </div>
    </div>
  </div>`;
  document.getElementById('sumInputs').onclick = () => setPanelHidden('model', false);
  view.querySelectorAll('.sum-card').forEach(c => { c.onclick = () => { tab = +c.dataset.view; render(); }; });
  view.querySelectorAll('.sum-more [data-nav]').forEach(b => { b.onclick = () => navGo(b.dataset.nav); });
}

// ---------------------------------------------------------------------
// Tabs + top-level render loop
// ---------------------------------------------------------------------
// The views, by number (the number is what the project file, the undo history and the help keep):
// 0 Start-up animation, 1 Contact line, 2 Web edge, 3 Film surface, 4 2D CFD, 5 DOE, 6 Measured data, 7 Summary,
// 8 1D gap flow, 9 3D, 10 1D to the oven, 11 1D across the web, 12 Process, 13 Materials.
let tab = 14;   // (WF-2: the app opens on the Line, the map of the process)
const TABS = ['Start-up', 'Contact line', 'Web edge', 'Film surface', '2D CFD', 'DOE', 'Measured data', 'Summary', 'Gap flow', '3D', 'To the oven', 'Across the web', 'Process', 'Materials', 'Line'];
/** What each view answers, in plain words (its tooltip, the welcome screen, its About). */
const TAB_Q = [
  'How the slurry moves under the blade, from start-up (animation)',
  'Does the slurry climb the blade face and reach the dry edge?',
  'Does the wet edge break into scallops before the oven?',
  'Do streaks and ripples level out before the oven?',
  'What does the flow under the blade look like in detail? (2D CFD)',
  'Which setting changes the result most? (design of experiments)',
  'How well do the models match my measurements, and which inputs fit them?',
  'Is the coating OK at these settings? Every result at a glance.',
  'How does the slurry flow along the blade, and what flow rate and film does the bead pressure give? (1D)',
  'How does the slurry flow in 3D, across the web too, and what film and contact line does it give? (3D)',
  'How does the film settle, and the ripple level, between the blade and the oven? (1D)',
  'How do the film and the contact line vary across the web? (1D at every position)',
  'From the wet film to the dry GO film: how thick and heavy is it, and how much water must the oven take out?',
  'What is the slurry made of, and what is it coated onto? Each value with its unit and its reference: one material card per material, the same on every stage card.',
  'The process stage by stage, from the mixer to the graphene film: where each stands and its answers.',
];
const TAB_ICONS = [
  '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.6 5.3v5.4L11 8z" fill="currentColor"/>',
  '<path d="M3 2.5v11M3 5.5c4 0 5.5 3.5 10.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="3" cy="5.5" r="1.4" fill="currentColor"/>',
  '<path d="M1.5 9.5c1.6-3 3.2-3 4.8 0s3.2 3 4.8 0 2.4-2.2 3.4-1.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1.5 13.5h13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>',
  '<path d="M1.5 7c1.2-1.4 2.4-1.4 3.6 0s2.4 1.4 3.6 0 2.4-1.4 3.6 0 1.6 1 2.2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1.5 11h13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".55"/>',
  '<path d="M2 2.5h12v11H2zM2 6.2h12M2 9.8h12M6 2.5v11M10 2.5v11" fill="none" stroke="currentColor" stroke-width="1.1"/>',
  '<circle cx="4" cy="4" r="1.6" fill="currentColor"/><circle cx="12" cy="4" r="1.6" fill="currentColor"/><circle cx="4" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M4 4h8v8H4z" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>',
  '<path d="M2.5 2.5v11h11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".6"/><path d="M3.5 12.5l9.5-9.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-dasharray="1.6 1.6"/><circle cx="6" cy="9.4" r="1.4" fill="currentColor"/><circle cx="9" cy="7.4" r="1.4" fill="currentColor"/><circle cx="11.6" cy="4.8" r="1.4" fill="currentColor"/>',
  '<path d="M2.5 13.5V3M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.5 10.5l3-3 2 2 4-4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>',
  '<path d="M1.5 5.5c4 0 6 3 13 3M1.5 11.5h13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 8.2h3M8 9.2h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>',
  '<path d="M8 1.8 14 5v6l-6 3.2L2 11V5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 5l6 3.2L14 5M8 8.2v6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" opacity=".7"/>',
  '<path d="M1.5 10.5c1.5-3 3-4 6.5-4h6.5M1.5 13.5h13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  '<path d="M1.5 9c1.2-1.4 2.4-1.4 3.6 0s2.4 1.4 3.6 0 2.4-1.4 3.6 0 1.6 1 2.2.6M3 4.5h10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3 3v3M13 3v3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>',
  '<rect x="1.2" y="5.8" width="3.6" height="4.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="11.2" y="5.8" width="3.6" height="4.4" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 8h6.4M9.4 6.4 11 8l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3.5h10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".55"/>',
  '<path d="M6 1.8h4M6.6 1.8v4.3L2.9 12.6a1.1 1.1 0 0 0 1 1.6h8.2a1.1 1.1 0 0 0 1-1.6L9.4 6.1V1.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/><path d="M4.4 10.2h7.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>',
  '<path d="M1.5 8h3M11.5 8h3M6 8h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><rect x="4.5" y="6" width="2" height="4" rx=".6" fill="currentColor"/><rect x="9.5" y="6" width="2" height="4" rx=".6" fill="currentColor"/>',
];
/**
 * The pages the tab bar opens (WF-2: the tabs in the process's order). A page is a view -- its number, which the project
 * file, the undo history and the help keep -- and, on the Process view (12), the stage it shows: for the film's stage its
 * part (the film peeled off, a piece cut from it, the pieces in the pressed stack), for the furnace's its part (the runs
 * and their checks, the graphene film that comes out). t: its name where it is not its view's; q: what it answers.
 */
const NAV = {
  line: { v: 14 }, materials: { v: 13 },
  mix: { v: 12, st: 'slurry', t: 'Mixing', icon: 'drop', note: 'The slurry\'s flow as the mixer makes it: viscosity, n, yield stress, surface tension. Its solids and densities are on Materials.', q: 'The slurry the mixer makes: what it is made of and how it flows (the mixer itself is not modelled yet).' },
  gap: { v: 8 }, oven1d: { v: 10 }, across: { v: 11 }, startup: { v: 0 }, cfd2d: { v: 4 }, cfd3d: { v: 9 },
  contact: { v: 1 }, edge: { v: 2 }, surface: { v: 3 },
  wetdry: { v: 12, st: 'coat', t: 'Wet and dry film', icon: 'film', q: 'The wet film across the web and the dry film it leaves: the coat weight, and the water the oven must take out.' },
  flakes: { v: 12, st: 'align', t: 'Flakes', icon: 'fibre', note: 'The flakes\' alignment is computed with each 2D run: its inputs are the 2D\'s (Coating › 2D) and the alignment card on Materials.', q: 'How flat the flakes lie in the film at the oven, and dried, at each location (computed with each 2D run).' },
  dry: { v: 12, st: 'dry', t: 'Drying', icon: 'oven', note: 'The web\'s speed and the room before the oven, then the oven\'s zones: each zone\'s length, its air and what is above the film.', q: 'The film through the room and the oven: its water and temperature, where it skins over, whether it is dry at the exit.' },
  peel: { v: 12, st: 'film', fv: 'film', t: 'Peel and wind', icon: 'film', note: 'The web\'s speed, and after the oven: the stretch to where the film is peeled, and the winder\'s core.', q: 'The dry film on the web to the peel: its stress, cracks and blisters, the force to peel it, its curl, and the roll it is wound into.' },
  cut: { v: 12, st: 'film', fv: 'piece', t: 'Cutting', icon: 'cut', note: 'The pieces\' size. A piece starts from the film as it was peeled (Peel and wind).', q: 'A piece cut from the roll, in 3D: how it curls held up and lying on a table.' },
  stack: { v: 12, st: 'film', fv: 'stack', t: 'Pre heat treatment', icon: 'weight', note: 'The pre heat treatment: its oven\'s temperature, the time in it, and the time under the plate after it.', q: 'The pieces pressed in a stack under the plate and heated: their water and stress, and how they lie when taken out.' },
  furn: { v: 12, st: 'furn', fp: 'runs', t: 'Furnace', icon: 'oven', note: 'The furnace: the two runs\' programs, the stack in its holder (papers, plates, the room above it).', q: 'The stack in the furnace, run 1 then run 2: its gas, puffing, cracks, sticking and waves, piece by piece.' },
  gfilm: { v: 12, st: 'furn', fp: 'product', t: 'Graphene film', icon: 'bars', note: 'The graphene film is the furnace\'s result: its inputs are the furnace\'s, with your limit on its thickness\'s spread.', q: 'The graphene film that comes out: its thickness and spread, density, heat conduction, C/O and graphitization.' },
  summary: { v: 7 }, doe: { v: 5 }, meas: { v: 6 },
};
const navTitle = k => NAV[k].t || TABS[NAV[k].v];
const navQ = k => NAV[k].q || TAB_Q[NAV[k].v];
/** The page shown: the view, and on the Process view its stage and part. */
function navNow() {
  if (tab !== 12) return Object.keys(NAV).find(k => NAV[k].v === tab && !NAV[k].st) || 'line';
  const fv = typeof FILM !== 'undefined' && FILM.view || 'film', fp = typeof FURN !== 'undefined' && FURN.part || 'runs';
  return Object.keys(NAV).find(k => { const q = NAV[k]; return q.v === 12 && q.st === PROC.stage && (!q.fv || q.fv === fv) && (!q.fp || q.fp === fp); }) || 'wetdry';
}
/** Show page k (a stage page keeps its own step; step, if given, opens that one). */
function navGo(k, step) {
  const q = NAV[k];
  if (!q) return;
  if (q.st) PROC.stage = q.st;
  if (q.fv) FILM.view = q.fv;
  if (q.fp) FURN.part = q.fp;
  if (step && q.v === 12 && typeof procStepKey === 'function') PROC.step[procStepKey()] = step;
  tab = q.v;
  render();
}
/**
 * The tab bar's sections, in the process's order: the Line (the map), Materials, the eight stages (numbered, each with a
 * dot for where it stands: the Line's), then Results and Studies. A section opens the first time on its first page, after
 * that on the page last shown. Coating's sub tabs are its models 1D, 2D, 3D and its Results, each with its pages under
 * them; Studies' are the DOE and Measured data.
 */
const SECTIONS = [
  { k: 'line', t: 'Line', icon: 14, pages: ['line'] },
  { k: 'materials', t: 'Materials', icon: 13, pages: ['materials'] },
  { k: 'mix', n: 1, t: 'Mixing', pages: ['mix'] },
  { k: 'coat', n: 2, t: 'Coating', groups: [{ k: '1d', t: '1D', pages: ['gap', 'oven1d', 'across', 'startup'] }, { k: '2d', t: '2D', pages: ['cfd2d'] }, { k: '3d', t: '3D', pages: ['cfd3d'] },
    { k: 'res', t: 'Results', pages: ['contact', 'edge', 'surface', 'wetdry', 'flakes'] }] },
  { k: 'dry', n: 3, t: 'Drying', pages: ['dry'] },
  { k: 'peel', n: 4, t: 'Peel and wind', short: 'Peel', pages: ['peel'] },
  { k: 'cut', n: 5, t: 'Cutting', pages: ['cut'] },
  { k: 'stack', n: 6, t: 'Pre heat treatment', short: 'Pre heat', pages: ['stack'] },
  { k: 'furn', n: 7, t: 'Furnace', pages: ['furn'] },
  { k: 'gfilm', n: 8, t: 'Graphene film', short: 'Graphene', pages: ['gfilm'] },
  { k: 'results', t: 'Results', icon: 7, pages: ['summary'] },
  { k: 'studies', t: 'Studies', icon: 5, pages: ['doe', 'meas'] },
];
SECTIONS.forEach(s => { if (s.groups) s.pages = s.groups.flatMap(g => g.pages); });
const secOfPage = k => SECTIONS.find(s => s.pages.includes(k)) || SECTIONS[0];
/** The section shown (or, for another view, the first section with it). */
const secOf = (v = tab) => v === tab ? secOfPage(navNow()) : SECTIONS.find(s => s.pages.some(k => NAV[k].v === v)) || SECTIONS[0];
const groupOfPage = k => { const s = secOfPage(k); return s.groups ? s.groups.find(g => g.pages.includes(k)) : null; };
const SEC_LAST = {}, GROUP_LAST = {};
const tabsEl = document.getElementById('tabs');
const tabButtons = () => [...tabsEl.querySelectorAll('button[role="tab"]')];
const goSection = i => { const s = SECTIONS[i]; navGo(SEC_LAST[s.k] ?? s.pages[0]); };
const NAV_TIP = new Map();   // (each tab's own hover text; a stage's gets where it stands after it)
SECTIONS.forEach((s, i) => {
  // (a thin line between the map and the materials, the stages, and the results and studies)
  if (i && (s.n === 1 || (!s.n && SECTIONS[i - 1].n))) tabsEl.insertAdjacentHTML('beforeend', '<span class="tab-sep" aria-hidden="true"></span>');
  const b = document.createElement('button');
  // (a narrow window shows a stage's short name; its full name stays for screen readers and on hover)
  b.innerHTML = s.n ? `<b class="tab-n" aria-hidden="true">${s.n}</b><span class="tab-l">${s.t}</span>${s.short ? `<span class="tab-s" aria-hidden="true">${s.short}</span>` : ''}<i class="tab-dot" aria-hidden="true"></i><span class="sr-only tab-st"></span>`
    : `<svg viewBox="0 0 16 16" aria-hidden="true">${TAB_ICONS[s.icon]}</svg><span>${s.t}</span>`;
  b.type = 'button';
  b.dataset.sec = s.k;
  b.title = s.groups ? s.groups.map(g => g.t).join(' · ') : s.pages.length > 1 ? s.pages.map(navTitle).join(' · ') : navQ(s.pages[0]);
  NAV_TIP.set(s.k, b.title);
  b.setAttribute('role', 'tab');
  b.onclick = () => goSection(i);
  b.onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const cur = i, n = SECTIONS.length;   // (from the tab the keys are on)
    goSection(e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (cur + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
    tabButtons()[SECTIONS.indexOf(secOf())].focus();
  };
  tabsEl.appendChild(b);
});
/** The stages' dots: where each stands, as the Line shows it (its word for readers). */
function navDots() {
  let S;
  try { S = lineStages(); } catch (e) { return; }   // (a stage's module not ready yet: the dots stay as they were)
  for (const st of S) {
    const b = tabsEl.querySelector(`[data-sec="${st.k}"]`);
    if (!b) continue;
    const [t, c] = LINE_ST[st.st], d = b.querySelector('.tab-dot'), w = b.querySelector('.tab-st');
    d.className = `tab-dot pt-dot pt-${c}`;
    w.textContent = `: ${t}`;
    b.title = `${NAV_TIP.get(st.k)} (${t})`;
  }
}
/**
 * The sub tabs of the section shown (a pill switch at the top of the page), or '' when it has one page. Coating: its
 * models and its Results (a group opens on its page last shown), and the group's pages under them.
 */
function subTabs() {
  const pg = navNow(), s = secOfPage(pg);
  const btn = (k, t, on, title, row, icon) => `<button type="button" role="tab" data-nav="${k}" data-view="${NAV[k].v}" data-row="${row}" aria-selected="${on}" tabindex="${on ? 0 : -1}" title="${title}">${uiIco(icon)}${t}</button>`;
  const ico = k => NAV[k].icon || NAV[k].v;
  if (s.groups) {
    const g = groupOfPage(pg);
    const top = `<div class="subtabs" role="tablist" aria-label="${s.t}: its models and results">${s.groups.map(x => btn(GROUP_LAST[x.k] ?? x.pages[0], x.t, x === g, x.pages.map(navTitle).join(' · '), 'g', GROUP_ICON[x.k])).join('')}</div>`;
    return top + (g && g.pages.length > 1 ? `<div class="subtabs subtabs-2" role="tablist" aria-label="${g.t} pages">${g.pages.map(k => btn(k, navTitle(k), k === pg, navQ(k), 'v', ico(k))).join('')}</div>` : '');
  }
  if (s.pages.length < 2) return '';
  return `<div class="subtabs" role="tablist" aria-label="${s.t} pages">${s.pages.map(k => btn(k, navTitle(k), k === pg, navQ(k), 'v', ico(k))).join('')}</div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.subtabs [data-nav]');
  if (b) navGo(b.dataset.nav);
});
// (arrow keys move along the row the focus is in, and open that page)
document.addEventListener('keydown', e => {
  const b = e.target.closest && e.target.closest('.subtabs [data-nav]');
  if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const bs = [...b.parentElement.querySelectorAll('[data-nav]')], i = bs.indexOf(b), n = bs.length, row = b.dataset.row;
  const k = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
  navGo(bs[k].dataset.nav);
  const f = document.querySelectorAll(`.subtabs [data-row="${row}"]`)[k]; if (f) f.focus();
});
const view = document.getElementById('view');
const work = document.getElementById('work');

/** The module's verdict pills sit in its toolbar, which may cut them short: their full text on hover. */
function titleStatus() { const st = document.getElementById('st'); if (st) st.title = [...st.children].map(p => p.textContent).join(' · '); }

let renderLastPage = null;   // (WF-2: the page, not the view: the stages' pages share the Process view)
/** Where a page is scrolled to: the element with an id at or just above its top, and how far it is from the top. */
function renderAnchor(vp) {
  const top = vp.getBoundingClientRect().top;
  let best = null, bestY = -Infinity;
  for (const el of vp.querySelectorAll('[id]')) {
    const y = el.getBoundingClientRect().top - top;
    if (y <= 1 && y > bestY && el.offsetParent !== null) { best = el; bestY = y; }
  }
  return { top: vp.scrollTop, id: best ? best.id : null, dy: bestY };
}
function render() {
  // (a redraw keeps the keyboard focus on a sub tab or 1D location button: arrow keys go on working)
  const af = document.activeElement, keepF = af && af.closest && (af.closest('.subtabs [data-view]') || af.closest('[data-l1d]'))
    ? (af.dataset.row ? `.subtabs [data-row="${af.dataset.row}"]` : '[data-l1d]') : null, keepV = af && (af.dataset.nav ?? af.dataset.view ?? af.dataset.l1d);
  // (a redraw of the same page -- a result arriving, a value changed -- keeps what was at the top of the page there,
  //  though what is above it may have grown or shrunk: the element with an id nearest the top, and how far above it)
  //  (another page opens at its top)
  const pg = navNow();
  const vpOld = document.querySelector('.mod-vp'), keepS = vpOld && renderLastPage === pg && vpOld.scrollTop > 0 ? renderAnchor(vpOld) : null;
  renderLastPage = pg;
  undoBeforeRender();
  const acrF = acrFocusSave();   // (the blade across the web's panels are drawn anew: the focus goes back to the same control)
  const sec = secOfPage(pg), grp = groupOfPage(pg);
  SEC_LAST[sec.k] = pg;
  if (grp) GROUP_LAST[grp.k] = pg;
  tabButtons().forEach(b => { const on = b.dataset.sec === sec.k; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  // (a narrow window scrolls the tab bar: the section shown kept in view)
  if (tabsEl.scrollWidth > tabsEl.clientWidth) {
    const onB = tabButtons().find(b => b.dataset.sec === sec.k), r = onB.getBoundingClientRect(), m = tabsEl.getBoundingClientRect();
    if (r.left < m.left) tabsEl.scrollLeft -= m.left - r.left + 8; else if (r.right > m.right) tabsEl.scrollLeft += r.right - m.right + 8;
  }
  document.body.dataset.tab = tab;
  document.body.dataset.sec = sec.k;
  document.body.dataset.page = pg;
  applyPanels();
  document.getElementById('treeNote').textContent = NAV[pg].note || TREE_NOTE[tab] || '';
  ANIM.stop();
  // module-specific setup (CFD) lives in the model tree; a module that fills the work area sets .fill itself
  if (tab !== 0 && tab !== 4) document.getElementById('setupExtra').innerHTML = '';
  document.getElementById('sbCoord').textContent = '';
  renderRunChips();
  work.classList.add('fill');
  [viewA, view1, view2, view3, viewCFD, viewDOE, viewMeasured, viewSummary, view1DGap, view3D, view1DFilm, view1DAcross, viewProcess, viewMaterials, viewLine][tab]();
  if (keepS) {
    const vp = document.querySelector('.mod-vp'), el = keepS.id && document.getElementById(keepS.id);
    if (vp) vp.scrollTop = el && vp.contains(el) ? vp.scrollTop + el.getBoundingClientRect().top - vp.getBoundingClientRect().top - keepS.dy : keepS.top;
  }
  wireModDock();
  acrossSidebar();
  decorateImageButtons();
  applyHelp();
  updateProjectTitle();
  titleStatus();
  updateScope();
  undoAfterRender();
  applyKeyLabels();
  decorateTree();
  clearTimeout(navDots.t); navDots.t = setTimeout(navDots, 250);   // (the stages' dots once the page settles: not on every frame of a drag)
  if (keepF) { const bs = [...document.querySelectorAll(keepF)], f = bs.find(x => (x.dataset.nav ?? x.dataset.view ?? x.dataset.l1d) === keepV) || bs.find(x => x.getAttribute('aria-selected') === 'true'); if (f) f.focus(); }
  acrFocusRestore(acrF);
}

// ---- theme: follows the system until switched here (remembered in this browser)
const THEME_KEY = 'bladeCoatDefectLab.theme';
try { const t = localStorage.getItem(THEME_KEY); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked: follow the system */ }
document.getElementById('themeBtn').onclick = () => {
  const next = isDarkTheme() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* not remembered */ }
};

// ---- the model panel's width: drag the splitter (or arrow keys on it)
(function treeSplitter() {
  const sp = document.getElementById('treeSplit'), body = document.getElementById('wbBody');
  const setW = w => { body.style.setProperty('--tree-w', Math.max(240, Math.min(520, w)) + 'px'); };
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
    const x0 = e.clientX, w0 = body.querySelector('.tree').offsetWidth;
    const move = ev => setW(w0 + ev.clientX - x0);
    const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); render(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); setW(body.querySelector('.tree').offsetWidth + (e.key === 'ArrowRight' ? 20 : -20)); render();
  });
})();

window.addEventListener('resize', render);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

document.getElementById('reset').onclick = () => {
  undoHint('Reset inputs to defaults');
  CFG.forEach(c => {
    P[c.k] = c.v;
    const s = document.getElementById('s_' + c.k);
    s.value = c.v;
    s.dispatchEvent(new Event('input'));
  });
  imgToast(`The shared inputs are back to their defaults (the CFD setup and the blade across the web stay).${keyLabel('edit.undo') ? ` Undo: ${keyLabel('edit.undo')}.` : ''}`);
};


if (matchMedia('(prefers-reduced-motion: reduce)').matches) ANIM.playing = false;

render();
