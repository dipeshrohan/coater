/*
 * ui.js — DOM wiring: builds the input sliders from physics.js's CFG,
 * wires up the four tabs, and renders each tab's charts/status text.
 *
 * Depends on physics.js (CFG, P, physics functions), draw.js (canvas
 * utilities), and simulation.js (ANIM), all loaded first.
 */

// ---------------------------------------------------------------------
// Slider icons (purely decorative, keyed by CFG[i].ic)
// ---------------------------------------------------------------------
const ICON = {
  speed: '<path d="M2.5 12.5a5.5 5.5 0 0 1 11 0"/><path d="M8 12.5 10.8 6"/><circle cx="8" cy="12.5" r="1"/>',
  height: '<path d="M3 3h10M3 13h10M8 4v8M6.2 6l1.8-2 1.8 2M6.2 10l1.8 2 1.8-2"/>',
  layers: '<rect x="2.5" y="2.8" width="11" height="2.6" rx="0.8"/><rect x="2.5" y="6.7" width="11" height="2.6" rx="0.8"/><rect x="2.5" y="10.6" width="11" height="2.6" rx="0.8"/>',
  distance: '<path d="M2 8h12M2 8l2.4-2.2M2 8l2.4 2.2M14 8l-2.4-2.2M14 8l-2.4 2.2"/>',
  droplet: '<path d="M8 2.2c2.8 3.6 4.6 5.9 4.6 8.1A4.6 4.6 0 0 1 3.4 10.3C3.4 8.1 5.2 5.8 8 2.2Z"/>',
  curve: '<path d="M2.5 4.5c2 0 2 3.5 5.5 3.5S11 11.5 13 11.5"/>',
  gauge: '<circle cx="8" cy="8.5" r="5.3"/><path d="M8 8.5 6.1 5.6M8 5v1.1M11.3 8.5h-1.1M4.7 8.5h1.1"/>',
  ruler: '<rect x="2.3" y="6.8" width="11.4" height="4.2" rx="0.6"/><path d="M5 6.8v1.6M7.5 6.8v1.6M10 6.8v1.6M12.3 6.8v1.6"/>',
  angle: '<path d="M3 13h10M3 13 12 4"/><path d="M6.3 13a3.9 3.9 0 0 1 1.2-2.7"/>',
  wave: '<path d="M2 9c1.4-3 2.4-3 3.8 0s2.4 3 3.8 0 2.4-3 3.8 0"/>',
  scatter: '<circle cx="4.2" cy="5.2" r="1"/><circle cx="9.3" cy="4.2" r="1"/><circle cx="12.2" cy="8.4" r="1"/><circle cx="6" cy="10.4" r="1"/><circle cx="10.6" cy="12.2" r="1"/>',
  edge: '<path d="M2 12.5 4.8 6l2 4 2-5 2 4 3.2-5"/>',
};

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
    row.className = 'sl';
    row.innerHTML = `<label for="s_${c.k}"><span class="lt"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICON[c.ic]}</svg>${c.l}</span><output id="o_${c.k}"></output></label><input type="range" id="s_${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.v}">${c.h ? `<span class="h">${c.h}</span>` : ''}`;
    currentGroup.appendChild(row);

    const slider = row.querySelector('input'), output = row.querySelector('output');
    const showValue = () => { output.textContent = (+slider.value).toFixed(c.d) + (c.u ? ' ' + c.u : ''); syncSliderFill(slider); };
    showValue();
    slider.addEventListener('input', () => { P[c.k] = +slider.value; showValue(); queueRender(); });
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
    ? `<strong>${hard ? 'Result withheld' : 'Use with caution'}.</strong> ${q.issues.join('; ')}. Re ${q.Re.toFixed(3)}, Ca ${q.Ca.toFixed(2)}, H/L ${q.aspect.toFixed(2)}.${extra}`
    : `<strong>Within the thin-film checks.</strong> Re ${q.Re.toFixed(3)}, Ca ${q.Ca.toFixed(2)}, H/L ${q.aspect.toFixed(2)}.${extra}`;
}

/** Draw the static cross-section (blade, bead, meniscus, film) for the "Contact line at the blade" tab. */
function drawSection(cv) {
  const { c, w, h } = setupCanvas(cv, 0.66);
  const H = gapHeight(), st = contactLine(H, P.th);
  const sc = w / 16, x0 = 4, y0 = h - 70;
  const X = x => (x + x0) * sc, Y = y => y0 - y * sc;
  c.clearRect(0, 0, w, h);

  const ink = cssVar('--ink'), mut = cssVar('--muted'), bl = cssVar('--blade'), fb = cssVar('--fibre'),
    sl = cssVar('--slurry'), bad = cssVar('--bad'), acc = cssVar('--accent');
  c.save(); c.beginPath(); c.rect(0, 0, w, h); c.clip();

  c.fillStyle = fb; c.fillRect(0, Y(0), w, P.tf * sc);
  c.fillStyle = cssVar('--soft'); c.fillRect(0, Y(-P.tf), w, 60);
  c.strokeStyle = ink; c.lineWidth = 1.2; c.strokeRect(0, Y(0), w, P.tf * sc);

  const Qx = st.s * SIN45, E = [0, H], Qp = [Qx, H + st.s * SIN45];
  const V = [P.face * SIN45, H + P.face * SIN45];
  const D = [V[0] + P.face * 0.55 * SIN45, V[1] - P.face * 0.55 * SIN45];
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

  outlinedText(c, st.pinned ? 'contact line pinned at the edge' : 'contact line ' + st.s.toFixed(1) + ' mm up the face', X(Qp[0]) + 12, Y(Qp[1]) - 12, acc);
  c.restore();
}

// ---------------------------------------------------------------------
// Tab 1: Slurry animation
// ---------------------------------------------------------------------
function viewA() {
  view.innerHTML = `
    <div class="status" id="st"></div>
    <canvas id="ca" role="img" aria-label="Animation of slurry metering under the fixed blade onto the moving fibre"></canvas>

    <div class="playback-bar">
      <button id="ap"></button>
      <button id="ar">Restart</button>
      <div class="sl"><label for="at"><span class="lt">Time</span><output id="ato"></output></label><input type="range" id="at" min="0" max="58" step="0.1"></div>
    </div>

    <div class="anim-params">
      <div class="section-label">Feed pulsing</div>
      <div class="sl"><label for="fa"><span class="lt">Feed pulse depth</span><output id="fao"></output></label><input type="range" id="fa" min="0" max="100" step="5"></div>
      <div class="sl"><label for="fp"><span class="lt">Pulse period</span><output id="fpo"></output></label><input type="range" id="fp" min="2" max="20" step="0.5"></div>
      <div class="sl"><label for="fd"><span class="lt">Pulse length</span><output id="fdo"></output></label><input type="range" id="fd" min="10" max="80" step="5"></div>

      <div class="section-label">Pool setup</div>
      <div class="sl"><label for="pl0"><span class="lt">Pool depth at start</span><output id="pl0o"></output></label><input type="range" id="pl0" min="2.5" max="8" step="0.5"></div>
      <div class="sl"><label for="plp"><span class="lt">Pool length upstream</span><output id="plpo"></output></label><input type="range" id="plp" min="20" max="300" step="10"></div>

      <div class="section-label">View</div>
      <div class="sl"><label for="az"><span class="lt">Position across web</span><output id="azo"></output></label><input type="range" id="az" min="0" max="300" step="1"></div>
      <div class="sl"><label for="rt"><span class="lt">Playback speed</span><output id="rto"></output></label><input type="range" id="rt" min="0.1" max="1" step="0.05"><span class="h">1× = real time</span></div>
    </div>

    <canvas id="cb" role="img" aria-label="Separate magnified animation of the downstream meniscus" style="margin-top:14px"></canvas>
    <p class="cap"><b>Separate view:</b> the downstream meniscus, magnified, driven by the same simulation and the same clock as the view above.</p>
    <details class="cap-toggle"><summary>How this view works</summary><p class="cap"><b>Fixed blade, fibre moves left to right.</b> The animation is driven by the same model and the same inputs as the other tabs. Web speed, machine height, fibre thickness, viscosity, yield stress, shear thinning, bead pressure, land length, surface tension and contact angle set the flow and the meniscus. The across-web inputs act through the position slider, which picks the local gap and wetting at that point. Edge, ripple and oven inputs act in the other tabs. The blade diameter is 100 mm (from you); the notch size is assumed. Bead height scales with bead pressure for display. <b>The downstream liquid surface is solved live</b> (thin-film equation with viscous flow, surface tension and the moving fibre, in real time). The run starts from a developed steady film. <b>How it works.</b> The run starts with the fibre stopped and a pool of slurry already deeper than the gap. The fibre starts at 3 s and reaches full speed 1.5 s later (assumed). The nozzle tip sits at the pool surface and feeds in pulses, at an average rate equal to the flow leaving through the gap. The pool level comes from a volume balance (feed in minus gap flow out), and the gap flow comes from the fibre speed and the bead pressure, which is taken as proportional to pool depth. The pool depth at start and its length upstream of the blade are assumed, not measured. The liquid surface downstream is solved live (thin-film equation with viscous flow, surface tension and the moving fibre). Change any input while it runs and the surface relaxes to the new state. The contact-line position on the face still comes from the static balance used in the other tabs.</p></details>
    <div class="stats" id="ss"></div>`;

  const cv = document.getElementById('ca');
  ANIM.start(cv, document.getElementById('cb'));

  const ap = document.getElementById('ap'), at = document.getElementById('at'), ato = document.getElementById('ato'),
    az = document.getElementById('az'), azo = document.getElementById('azo');
  const syncPlayButton = () => { ap.textContent = ANIM.playing ? 'Pause' : 'Play'; ap.setAttribute('aria-pressed', ANIM.playing); };
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
  statusHtml += pill('local gap ' + i.H.toFixed(2) + ' mm', '') + pill('contact angle ' + i.th.toFixed(0) + '°', '');
  document.getElementById('st').innerHTML = statusHtml;

  document.getElementById('ss').innerHTML = [
    ['Gap at this position', i.H.toFixed(2) + ' mm'],
    ['Wet film', st.h.toFixed(2) + ' mm'],
    ['Film / gap', (st.h / i.H).toFixed(3)],
    ['Shear rate U/H', (P.U / 60 / (i.H / 1000)).toFixed(1) + ' 1/s'],
    ['Numerical state', ANIM.safe ? 'physical bounds passed' : 'surface solve stopped'],
  ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Tab 2: Contact line at the blade
// ---------------------------------------------------------------------
function view1() {
  view.innerHTML = `
    <div class="status" id="st"></div>
    <canvas id="c1" role="img" aria-label="Cross-section of blade, slurry and meniscus"></canvas>
    <p class="cap"><b>Cross-section at the web centre.</b> The meniscus is the Young–Laplace profile from the contact line down to the flat film. It is pinned at the sharp edge when the contact angle is large, and climbs the flat face when it is small.</p>
    <canvas id="c2" role="img" aria-label="Contact line position across the web"></canvas>
    <p class="cap"><b>Top view, across the web.</b> Each point is where the contact line sits on the face, from the sharp edge (0) to the notch corner. Gap waviness, fibre thickness and wetting changes push it up and down. Compare photos 1, 3 and 5: an uneven line.</p>
    <div class="stats" id="ss"></div>`;
  drawSection(document.getElementById('c1'));

  const N = 300, WIDTH = 300, pts = [];
  let mx = 0, mn = 1e9, over = 0, hmn = 1e9, hmx = 0;
  for (let i = 0; i < N; i++) {
    const z = i / (N - 1) * WIDTH;
    const H = gapHeight() + (P.dH * Math.sin(2 * Math.PI * z / P.lw) - P.dt * spatialNoise(z, 1.7)) / 1000;
    const th = P.th + P.dth * spatialNoise(z, 4.1);
    const r = contactLine(H, th);
    pts.push([z, r.s]);
    mx = Math.max(mx, r.s); mn = Math.min(mn, r.s);
    if (r.s > P.face) over++;
    hmn = Math.min(hmn, r.h); hmx = Math.max(hmx, r.h);
  }
  plotChart(document.getElementById('c2'), 0.4, {
    x0: 0, x1: WIDTH, y0: 0, y1: Math.max(P.face * 1.3, mx * 1.1),
    yl: 'contact line up the face (mm)', xl: 'position across web (mm)',
    s: [{ p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: P.face, c: cssVar('--bad'), t: 'notch corner: slurry reaches the dry edge' }],
  });

  const peakToPeak = mx - mn, wetFraction = over / N * 100, filmDeviation = (hmx - hmn) / ((hmx + hmn) / 2) * 100;
  let statusHtml;
  if (over) statusHtml = pill('Slurry reaches the notch corner over ' + wetFraction.toFixed(0) + '% of the width', 'bad');
  else if (peakToPeak > 0.5) statusHtml = pill('Uneven contact line: ' + peakToPeak.toFixed(1) + ' mm peak to peak', 'warn');
  else if (mx === 0) statusHtml = pill('Pinned at the sharp edge everywhere', 'ok');
  else statusHtml = pill('Contact line steady', 'ok');
  statusHtml += pill('Ca = ' + (muEff(P.U / 60 / (gapHeight() / 1000)) * P.U / 60 / P.g).toFixed(2), '');
  statusHtml += pill('capillary length ' + capillaryLength().toFixed(2) + ' mm', '');
  document.getElementById('st').innerHTML = statusHtml;

  document.getElementById('ss').innerHTML = [
    ['Wet film, centre', contactLine(gapHeight(), P.th).h.toFixed(2) + ' mm'],
    ['Film range across web', hmn.toFixed(2) + ' to ' + hmx.toFixed(2) + ' mm'],
    ['Film variation', filmDeviation.toFixed(1) + ' %'],
    ['Contact line range', mn.toFixed(1) + ' to ' + mx.toFixed(1) + ' mm'],
  ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Tab 3: Web edge
// ---------------------------------------------------------------------
function view2() {
  const e = edgeBead(), U = P.U / 60, ovenDistanceMm = P.oven * 1000;
  const scallopAt = x => Math.min(P.a0e / 1000 * Math.exp(e.sig * x / 1000 / U), e.lam / 4);

  view.innerHTML = `
    <div class="status" id="st"></div>
    <canvas id="c1" role="img" aria-label="Edge amplitude versus distance"></canvas>
    <p class="cap"><b>Edge growth.</b> The wet edge is a ridge of slurry along the fibre margin. Surface tension pulls it into beads (Rayleigh–Plateau), and viscosity slows that down. A yield stress larger than the capillary pressure freezes it.</p>
    <canvas id="c2" role="img" aria-label="Top view of the wet edge"></canvas>
    <p class="cap"><b>Top view of the edge</b> at the oven entrance, machine direction left to right. Compare photo 4: a scalloped boundary against the white margin.</p>
    <div class="stats" id="ss"></div>`;

  const pts = [];
  for (let i = 0; i <= 100; i++) {
    const x = ovenDistanceMm * i / 100;
    pts.push([x, e.arrest ? P.a0e / 1000 : scallopAt(x)]);
  }
  plotChart(document.getElementById('c1'), 0.36, {
    x0: 0, x1: ovenDistanceMm, y0: 0, y1: Math.max(e.lam / 4 * 1.1, 0.5),
    yl: 'edge scallop amplitude (mm)', xl: 'distance from blade (mm)', yd: 2,
    s: [{ p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: 0.2, c: cssVar('--warn'), t: 'visible' }],
  });

  const endAmplitude = e.arrest ? P.a0e / 1000 : scallopAt(ovenDistanceMm);
  const visible = endAmplitude > 0.2;
  document.getElementById('st').innerHTML =
    (e.arrest ? pill('Yield stress freezes the edge', 'ok')
      : visible ? pill('Scalloped edge at the oven: ' + (endAmplitude * 2).toFixed(1) + ' mm peak to peak', 'bad')
        : pill('Edge stays straight to the oven', 'ok'))
    + pill('capillary pressure ' + e.pc.toFixed(0) + ' Pa vs yield ' + P.ty.toFixed(1) + ' Pa', '');

  const { c, w, h } = setupCanvas(document.getElementById('c2'), 0.32);
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
  ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Tab 4: Film surface
// ---------------------------------------------------------------------
function view3() {
  const H = gapHeight(), h = contactLine(H, P.th).h / 1000;
  const dhdH = (filmThickness(H + 0.01) - filmThickness(H - 0.01)) / 0.02; // film sensitivity to gap wobble
  const a0 = (Math.abs(dhdH) * P.dH + P.vib) / 1e6; // starting ripple amplitude, m
  const k = 2 * Math.PI / (P.lam / 1000); // ripple wavenumber, 1/m
  const gd = 0.5; // representative shear rate for leveling flow (slow, surface-tension-driven)
  const mu = muEff(gd);

  const tau = 3 * mu / (h * h * h * (P.g * k ** 4 + RHO * GRAVITY * k * k)); // leveling time constant, s
  const residualFromYield = P.ty / (h * (P.g * k ** 3 + RHO * GRAVITY * k));
  const asymptote = Math.min(a0, residualFromYield);
  const tRes = P.oven / (P.U / 60); // residence time to the oven, s
  const aEnd = asymptote + (a0 - asymptote) * Math.exp(-tRes / tau);

  view.innerHTML = `
    <div class="status" id="st"></div>
    <canvas id="c1" role="img" aria-label="Film surface ripple before and after levelling"></canvas>
    <p class="cap"><b>Film surface across the web</b> (deviation from the mean, in µm). Dashed: just after the blade. Solid: at the oven entrance. Compare the fine streaks in photos 2 and 4.</p>
    <canvas id="c2" role="img" aria-label="Ripple amplitude versus time"></canvas>
    <p class="cap"><b>Levelling in time.</b> Surface tension smooths the film. A yield stress stops levelling at a residual amplitude that stays into the oven. The ripple source is the gap wobble (through the film sensitivity dh/dH = ${dhdH.toFixed(2)}) plus vibration.</p>
    <div class="stats" id="ss"></div>`;

  const plotWindow = Math.max(P.lam * 3, 20);
  const p0 = [], p1 = [];
  for (let i = 0; i <= 200; i++) {
    const z = plotWindow * i / 200, s = Math.sin(2 * Math.PI * z / P.lam);
    p0.push([z, a0 * 1e6 * s]);
    p1.push([z, aEnd * 1e6 * s]);
  }
  const ym = Math.max(a0 * 1e6 * 1.3, 10);
  plotChart(document.getElementById('c1'), 0.34, {
    x0: 0, x1: plotWindow, y0: -ym, y1: ym, yl: 'film deviation (µm)', xl: 'across web (mm)',
    s: [{ p: p0, c: cssVar('--muted'), dash: [5, 4] }, { p: p1, c: cssVar('--accent'), w: 2.4 }],
  });

  const tp = [];
  const tSpan = Math.max(tRes * 1.4, 1);
  for (let i = 0; i <= 100; i++) {
    const t = tSpan * i / 100;
    tp.push([t, (asymptote + (a0 - asymptote) * Math.exp(-t / tau)) * 1e6]);
  }
  plotChart(document.getElementById('c2'), 0.34, {
    x0: 0, x1: tSpan, y0: 0, y1: Math.max(a0 * 1e6 * 1.1, 5),
    yl: 'ripple amplitude (µm)', xl: 'time after the blade (s)',
    s: [{ p: tp, c: cssVar('--accent'), w: 2.2 }],
    vl: [{ x: tRes, c: cssVar('--warn'), t: 'oven' }],
  });

  const remainMicrons = aEnd * 1e6, sharePct = remainMicrons / (h * 1e6) * 100;
  const Ca = muEff(P.U / 60 / (gapHeight() / 1000)) * P.U / 60 / P.g;
  document.getElementById('st').innerHTML =
    (remainMicrons > 5 ? pill('Ripple survives to the oven: ' + remainMicrons.toFixed(0) + ' µm', 'bad')
      : remainMicrons > 1 ? pill('Small ripple remains: ' + remainMicrons.toFixed(1) + ' µm', 'warn')
        : pill('Film levels out before the oven', 'ok'))
    + pill(P.ty > 0 && residualFromYield >= a0 ? 'Yield stress blocks levelling completely'
      : P.ty > 0 ? 'Levels down to a yield-limited residual' : 'Levelling limited by viscosity only', '')
    + pill('Ca ' + Ca.toFixed(2) + ' (ribbing watch above about 0.5, roll-coating value)', Ca > 0.5 ? 'warn' : '');

  document.getElementById('ss').innerHTML = [
    ['Starting ripple', (a0 * 1e6).toFixed(0) + ' µm'],
    ['Levelling time', tau.toFixed(2) + ' s'],
    ['Residual from yield', (Math.min(residualFromYield, 1) * 1e6).toFixed(0) + ' µm'],
    ['At oven, share of film', sharePct.toFixed(2) + ' %'],
  ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Tabs + top-level render loop
// ---------------------------------------------------------------------
let tab = 0;
const TABS = ['Slurry animation', 'Contact line at the blade', 'Web edge', 'Film surface'];
const tabsEl = document.getElementById('tabs');
TABS.forEach((t, i) => {
  const b = document.createElement('button');
  b.textContent = t;
  b.setAttribute('role', 'tab');
  b.onclick = () => { tab = i; render(); };
  b.onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    tab = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (tab + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    render();
    tabsEl.children[tab].focus();
  };
  tabsEl.appendChild(b);
});
const view = document.getElementById('view');

function render() {
  [...tabsEl.children].forEach((b, i) => { b.setAttribute('aria-selected', i === tab); b.tabIndex = i === tab ? 0 : -1; });
  ANIM.stop();
  [viewA, view1, view2, view3][tab]();
  updateScope();
}

window.addEventListener('resize', render);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

document.getElementById('reset').onclick = () => {
  CFG.forEach(c => {
    P[c.k] = c.v;
    const s = document.getElementById('s_' + c.k);
    s.value = c.v;
    s.dispatchEvent(new Event('input'));
  });
};

if (matchMedia('(prefers-reduced-motion: reduce)').matches) ANIM.playing = false;

render();
