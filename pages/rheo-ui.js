'use strict';
/*
 * rheo-ui.js — the Materials tab's Rheometer tests card (GO-1): rheometer exports (Anton Paar RheoCompass's
 * layout, or any table with named columns: rheofit.js) imported, plotted and fitted, and a fit's values put on the
 * rheology card ("Use this fit": marked Measured, the file as the source).
 *  - a flow curve: each law fitted (the viscosity against the shear rate, log-log), its fit error and its values'
 *    standard errors, those the curve cannot pin down marked loose;
 *  - a thixotropy test (3ITT): the structure model's rebuild time, the shear rate that halves it and its gain(s),
 *    the steady law kept as the app has it;
 *  - an amplitude sweep: the plateau G′, the yield point (G′ 5 % down) and the flow point (G′ = G″);
 *  - a frequency sweep: G′ and G″, the crossover (kept for the viscoelastic sub-phase).
 * The tests are kept with the materials (MAT.tests: saved in the project and the cases, one undo unit).
 */
const RT = { sel: null, fits: new Map() };   // (the test shown; the fits, by test and what they depend on)
const RT_KINDS = { flow: 'Flow curve', '3itt': 'Thixotropy test (3ITT)', amp: 'Amplitude sweep', freq: 'Frequency sweep' };
/** The laws a flow curve is fitted to, in the table's order, and their line colours (the locations' palette; the Newtonian muted, dashed). */
const RT_LAWS = ['hb', 'carreau', 'cross', 'power', 'newtonian'];
const rtLawColor = k => k === 'newtonian' ? cssVar('--muted') : locColor(RT_LAWS.indexOf(k));
/** The values a fit gives the app: label, unit, digits (significant). */
const RT_VALS = { muRef: ['viscosity at 2.7 1/s', 'Pa·s'], n: ['n', ''], ty: ['yield stress', 'Pa'], etaInf: ['η∞', 'Pa·s'], L: ['λ', 's'], a: ['a', ''],
  tb: ['rebuild time', 's'], gdc: ['halving shear rate', '1/s'], cy: ['yield gain c_y', ''], ce: ['viscosity gain c_η', ''] };
const rtEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const rtNum = (v, p = 3) => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(p - 1) : (+v.toPrecision(p)).toString();
/** The card's plot: wide and low on a wide card, taller on a phone. */
const rtAspect = cv => (cv.parentElement.clientWidth || 600) < 600 ? 0.62 : 0.4;
const rtSel = () => (MAT.tests || []).find(t => t.id === RT.sel) || (MAT.tests || [])[0] || null;

/** A test from a read file (rfRead): its tables' columns as plain arrays (JSON: the project), its kind and warnings. */
function rtRecord(file) {
  return {
    id: 'rt' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: file.name, kind: file.kind, at: new Date().toISOString(),
    tables: file.tables.map(t => ({ title: t.title, n: t.n, units: t.units, cols: Object.fromEntries(Object.entries(t.cols).map(([k, a]) => [k, Array.from(a)])) })),
    warnings: file.warnings || [],
  };
}
/** Import a rheometer file: read (bytes: UTF-16 exports too), kept as a test, shown. */
function rtImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.txt,.tsv,.dat,text/csv,text/plain';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try {
      const file = rfRead(await f.arrayBuffer(), f.name);
      if (!file.kind) { imgToast(`${f.name}: no rheometer test found in it (a table with columns such as Shear Rate, Shear Stress or Viscosity, Storage and Loss Modulus, with their units).`, 'error'); return; }
      const rec = rtRecord(file);
      undoHint(`Import rheometer test ${f.name}`);
      MAT = { ...MAT, tests: [...(MAT.tests || []), rec] };
      RT.sel = rec.id;
      render();
    } catch (e) { imgToast(`Could not read ${f.name}: ${e.message}`, 'error'); }
  };
  inp.click();
}
function rtRemove(id) {
  const t = (MAT.tests || []).find(q => q.id === id);
  if (!t) return;
  undoHint(`Remove rheometer test ${t.name}`);
  MAT = { ...MAT, tests: MAT.tests.filter(q => q.id !== id) };
  if (RT.sel === id) RT.sel = null;
  render();
}

// ---- the fits ----
/** The steady law the app has (as the 2D's: the model's n and yield stress only where it uses them): for a 3ITT fit. */
function rtLaw() {
  const uses = RHEO_MODELS[CFDG.model].uses;
  return rheoCompile(P.mu, uses.includes('ty') ? P.ty : 0, uses.includes('n') ? P.n : 1, cfdRheoX());
}
/** A flow curve's points (every table's shear rates and stresses, in order). */
function rtFlowPoints(t) {
  const gd = [], tau = [];
  for (const tb of t.tables) if (tb.cols.gd && tb.cols.tau) tb.cols.gd.forEach((g, i) => { const s = tb.cols.tau[i]; if (g > 0 && s > 0 && Number.isFinite(g) && Number.isFinite(s)) { gd.push(g); tau.push(s); } });
  return { gd, tau };
}
/** The shear rates a 3ITT's slow intervals run at (distinct within 5 %): two or more pin the two gains apart. */
function rtRestRates(pts) {
  const byInt = new Map();
  for (const q of pts) { if (!byInt.has(q.interval)) byInt.set(q.interval, q.gd); }
  const rates = [...byInt.values()], hi = Math.max(...rates), slow = rates.filter(g => g < hi / 3).sort((a, b) => a - b), out = [];
  for (const g of slow) if (!out.length || g > out[out.length - 1] * 1.05) out.push(g);
  return out;
}
/** A test's fit (cached by the test and, for a 3ITT, the steady law it keeps). */
function rtFit(t) {
  const lawKey = t.kind === '3itt' ? JSON.stringify([CFDG.model, P.mu, P.n, P.ty, cfdRheoX()]) : '';
  const key = t.id + '|' + lawKey;
  if (RT.fits.has(key)) return RT.fits.get(key);
  let fit = null;
  try {
    if (t.kind === 'flow') { const { gd, tau } = rtFlowPoints(t); fit = gd.length >= 4 ? { flow: rfFitFlow(gd, tau), gd, tau } : { error: 'fewer than 4 points with a shear rate and a stress' }; }
    else if (t.kind === '3itt') {
      const pts = rf3ITTPoints(t), law = rtLaw();
      if (pts.length < 6) fit = { error: 'fewer than 6 points with a time, a shear rate and a viscosity' };
      else {
        const rest = rtRestRates(pts), common = rfFit3ITT(pts, law);
        const apart = rest.length >= 2 && law.ty > 0 ? rfFit3ITT(pts, law, { separate: true, S0: common.S }) : null;
        fit = { pts, rest, common, apart, lawName: RHEO_MODELS[CFDG.model].l };
      }
    } else if (t.kind === 'amp' || t.kind === 'freq') {
      const tb = t.tables.find(q => q.cols.G1 && q.cols.G2 && (t.kind === 'amp' ? q.cols.strain : q.cols.omega));
      if (!tb) fit = { error: 'no table with G′, G″ and ' + (t.kind === 'amp' ? 'the strain' : 'the angular frequency') };
      else if (t.kind === 'amp') fit = { amp: rfAmp(tb.cols.strain, tb.cols.G1, tb.cols.G2, tb.cols.tau || null), tb };
      else fit = { freq: rfFreq(tb.cols.omega, tb.cols.G1, tb.cols.G2), tb };
    }
  } catch (e) { fit = { error: e.message }; }
  RT.fits.set(key, fit);
  return fit;
}

// ---- Use this fit ----
/** Put a sidebar input to a fitted value (the input's range and step: as its slider takes it); returns the note. */
function rtSetSide(k, v, src) {
  const c = CFG.find(q => q.k === k), cl = Math.min(c.max, Math.max(c.min, v));
  setInput(k, cl);
  MAT.rheo.side = { ...(MAT.rheo.side || {}), [k]: { v: P[k], src } };
  const took = P[k];
  return Math.abs(took - v) > 1e-9 * Math.max(1, Math.abs(v)) ? `${c.l.toLowerCase()} ${rtNum(v, 4)} → ${took.toFixed(c.d)}${cl !== v ? ` (the input's range ${c.min}–${c.max})` : ` (the input's step ${c.step})`}` : '';
}
/** A card value (MAT_RHEO) from a fit: measured, the file as the source (loose: said). */
function rtSetCard(k, v, src, loose) {
  const [, , , lo, hi, , d] = MAT_RHEO.find(q => q[0] === k), cl = Math.min(hi, Math.max(lo, v));
  MAT.rheo = { ...MAT.rheo, [k]: { v: +cl.toPrecision(Math.max(3, d + 1)), flag: 'measured', src: `${src}${loose ? ' (loose: the test does not pin it down)' : ''}${cl !== v ? ` (fitted ${rtNum(v)}; the card's range ${lo}–${hi})` : ''}` } };
}
function rtUseFlow(t, law) {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: the law it would be set against is its changed value's)
  const f = rtFit(t).flow[law], a = f.app, src = `fit to ${t.name}`, notes = [];
  undoHint(`Use the ${RHEO_MODELS[law].l} fit of ${t.name}`);
  CFDG.model = law;
  // (MH-3: the fit's law set whole -- its extras, its viscosity at 2.7 1/s, n, the yield stress -- then its own parameter, K or
  //  η0, from them: the law fitted, exactly)
  if (law === 'carreau' || law === 'cross') {
    rtSetCard('etaInf', a.etaInf, src, f.loose.includes('etaInf'));
    rtSetCard('lamT', a.L, src, f.loose.includes('L'));
    if (law === 'carreau') rtSetCard('aCY', a.a, src, f.loose.includes('a'));
  }
  rheoHold(() => {
    const n1 = rtSetSide('mu', a.muRef, src); if (n1) notes.push(n1);
    if (RHEO_MODELS[law].uses.includes('n')) { const n2 = rtSetSide('n', a.n, src); if (n2) notes.push(n2); }
    if (law === 'hb') { const n3 = rtSetSide('ty', a.ty, src); if (n3) notes.push(n3); }
  });
  rheoSync('mu');
  imgToast(`${RHEO_MODELS[law].l} from ${t.name}${notes.length ? `; as the inputs take them: ${notes.join(', ')}` : ''}.${f.loose.length ? ` Not pinned down by this curve: ${f.loose.map(k => RT_VALS[k][0]).join(', ')}.` : ''}`);
  render();
}
function rtUseStruct(t, which) {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: the law it would be set against is its changed value's)
  const fit = rtFit(t), f = fit[which], src = `fit to ${t.name}`;
  undoHint(`Use the structure fit of ${t.name}`);
  for (const k of ['tb', 'gdc', 'cy', 'ce']) rtSetCard(k, f.S[k], src, f.loose.includes(k));
  MAT.rheo = { ...MAT.rheo, structOn: true };
  imgToast(`The structure from ${t.name}${f.loose.length ? `; not pinned down by this test: ${f.loose.map(k => RT_VALS[k][0]).join(', ')}` : ''}.`);
  render();
}
function rtUseYield(t, which) {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: the law it would be set against is its changed value's)
  const p = rtFit(t).amp[which], src = `${which === 'flow' ? 'flow point (G′ = G″)' : 'yield point (G′ 5 % below its plateau)'} of ${t.name}`;
  undoHint(`Use the ${which === 'flow' ? 'flow' : 'yield'} point of ${t.name} as the yield stress`);
  const note = rtSetSide('ty', p.stress, src);
  imgToast(`Yield stress from the ${src}${note ? `; as the input takes it: ${note}` : ''}.${RHEO_MODELS[CFDG.model].uses.includes('ty') ? '' : ` The ${RHEO_MODELS[CFDG.model].l} model does not use a yield stress: Herschel–Bulkley does.`}`);
  render();
}

// ---- the card ----
function rtCardHTML() {
  const tests = MAT.tests || [], t = rtSel();
  const chips = tests.map(q => `<span class="rt-chip${q === t ? ' on' : ''}"><button type="button" class="rt-pick" data-rt="${q.id}" aria-pressed="${q === t}" title="${rtEsc(q.name)}: ${RT_KINDS[q.kind]}">${rtEsc(q.name)} <small>${RT_KINDS[q.kind]}</small></button><button type="button" class="rt-x" data-rtx="${q.id}" aria-label="Remove ${rtEsc(q.name)}" title="Remove this test">×</button></span>`).join('');
  return `<section class="mat-card rt-card" aria-labelledby="matTestsH">
    <header><h3 id="matTestsH">${uiBadge('metrics')}Rheometer tests</h3><button type="button" class="btn btn-secondary btn-sm" id="rtImport">${uiIco('upload')}Import rheometer file…</button></header>
    ${tests.length ? `<div class="rt-chips" role="group" aria-label="Rheometer tests">${chips}</div><div id="rtBody"></div>`
      : '<p class="rt-empty">No rheometer tests yet. Import an export from the rheometer (Anton Paar RheoCompass, or any table with named columns): a flow curve, a thixotropy test (3ITT), an amplitude or a frequency sweep. Its columns are read by name and unit; each law is fitted, and a fit\'s values can go on the card above.</p>'}
  </section>`;
}
/** The shown test's plot and fit table (the card in the page). */
function rtDraw() {
  const imp = document.getElementById('rtImport');
  if (imp) imp.onclick = rtImport;
  document.querySelectorAll('.rt-pick').forEach(b => { b.onclick = () => { RT.sel = b.dataset.rt; render(); }; });
  document.querySelectorAll('.rt-x').forEach(b => { b.onclick = () => rtRemove(b.dataset.rtx); });
  const body = document.getElementById('rtBody'), t = rtSel();
  if (!body || !t) return;
  const fit = rtFit(t), pts = t.tables.reduce((a, q) => a + q.n, 0);
  const head = `<p class="rt-meta">${RT_KINDS[t.kind]} · ${t.tables.length} table${t.tables.length > 1 ? 's' : ''}, ${pts} points · read ${new Date(t.at).toLocaleDateString()}${t.warnings.length ? ` · <span class="warn-text">${t.warnings.map(rtEsc).join('; ')}</span>` : ''}</p>`;
  if (!fit || fit.error) { body.innerHTML = head + `<p class="mat-warn warn-text">Not fitted: ${rtEsc(fit ? fit.error : 'no fit')}.</p>`; return; }
  body.innerHTML = head + `<div class="rt-plot"><canvas id="rtChart" role="img" aria-label="${RT_KINDS[t.kind]}: the points and the fit"></canvas></div><div class="rt-legend" id="rtLegend"></div><div class="rt-table" id="rtTable"></div>`;
  const cv = document.getElementById('rtChart'), ink = cssVar('--ink'), L10 = Math.log10;
  const dec = v => { const p = Math.round(v); return Math.abs(v - p) < 1e-9 ? (p >= 4 || p <= -3 ? `1e${p}` : String(+Math.pow(10, p).toPrecision(1))) : rtNum(Math.pow(10, v), 2); };
  const logRange = vals => { const f = vals.filter(v => v > 0 && Number.isFinite(v)); let a = Math.floor(L10(Math.min(...f))), b = Math.ceil(L10(Math.max(...f))); if (b <= a) b = a + 1; return [a, b]; };
  const ticks = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  // (a standard error past 1000 %: just loose)
  const errText = (v, e, loose) => `${rtNum(v)}${Number.isFinite(e) && e <= 10 ? ` ± ${e < 0.001 ? '<0.1' : (e * 100).toPrecision(2)} %` : ''}${loose ? ' <span class="rt-loose">loose</span>' : ''}`;
  const tbl = (cols, rows) => `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  if (t.kind === 'flow') {
    const { gd, tau } = fit, eta = gd.map((g, i) => tau[i] / g), [x0, x1] = logRange(gd), [y0, y1] = logRange(eta);
    const series = RT_LAWS.map(k => {
      const law = fit.flow[k], x = k === 'carreau' || k === 'cross' ? { model: k, etaInf: law.params.etaInf, L: law.params.L, a: law.params.a } : null;
      const c = rheoCompile(law.app.muRef, law.app.ty || 0, law.app.n, x), p = [];
      for (let i = 0; i <= 120; i++) { const lg = x0 + (x1 - x0) * i / 120, e = c.mu(Math.pow(10, lg)); if (e > 0 && Number.isFinite(e)) p.push([lg, L10(e)]); }
      return { p, c: rtLawColor(k), w: k === 'newtonian' ? 1.5 : 2, dash: k === 'newtonian' ? [5, 4] : null };
    });
    plotChart(cv, rtAspect(cv), { x0, x1, y0, y1, xticks: ticks(x0, x1), yticks: ticks(y0, y1), xf: dec, yf: dec, yl: 'viscosity (Pa·s)', xl: 'shear rate (1/s)',
      s: [...series, { p: gd.map((g, i) => [L10(g), L10(eta[i])]), c: ink, line: false, dots: true }] });
    document.getElementById('rtLegend').innerHTML = `<span><i class="rt-dot"></i>measured</span>` + RT_LAWS.map(k => `<span><i class="rt-sw${k === 'newtonian' ? ' dash' : ''}" style="background:${rtLawColor(k)}"></i>${RHEO_MODELS[k].l}</span>`).join('');
    const best = RT_LAWS.reduce((b, k) => fit.flow[k].rms < fit.flow[b].rms ? k : b, 'hb');
    const rows = RT_LAWS.map(k => {
      const f = fit.flow[k], keys = ['muRef', ...(RHEO_MODELS[k].uses.includes('n') ? ['n'] : []), ...(k === 'hb' ? ['ty'] : []), ...(k === 'carreau' || k === 'cross' ? ['etaInf', 'L'] : []), ...(k === 'carreau' ? ['a'] : [])];
      const vals = keys.map(v => `${RT_VALS[v][0]} ${errText(f.app[v], f.err[v], f.loose.includes(v))}${RT_VALS[v][1] ? ' ' + RT_VALS[v][1] : ''}`).join(' · ');
      return `<tr${k === best ? ' class="rt-best"' : ''}><td><i class="rt-sw${k === 'newtonian' ? ' dash' : ''}" style="background:${rtLawColor(k)}"></i>${RHEO_MODELS[k].l}${k === best ? ' <small>best</small>' : ''}</td><td class="num">${(f.rms * 100).toFixed(1)} %</td><td>${vals}</td><td><button type="button" class="btn btn-secondary btn-sm rt-use" data-law="${k}">Use this fit</button></td></tr>`;
    });
    document.getElementById('rtTable').innerHTML = tbl(['Law', 'Fit error', 'Values (± one standard error)', ''], rows)
      + '<p class="rt-note">The fit error: the root-mean-square of the stress\'s log misfit (about the % scatter). Loose: the curve does not pin the value down (its standard error above 25 %), e.g. a time constant with no plateau in the data. Use this fit sets the model, the viscosity at 2.7 1/s, n and the yield stress in the inputs (as their sliders take them) and the law\'s extras on the card.</p>';
    document.querySelectorAll('.rt-use[data-law]').forEach(b => { b.onclick = () => rtUseFlow(t, b.dataset.law); });
  } else if (t.kind === '3itt') {
    const { pts } = fit, [y0, y1] = logRange(pts.map(q => q.eta)), T = pts[pts.length - 1].t;
    const model = (f, c, dash) => ({ p: pts.map((q, i) => [q.t, L10(f.model[i])]), c, w: 2, dash });
    const xt = niceTicks(0, T, 5);   // (cfd-plot.js: round steps)
    plotChart(cv, rtAspect(cv), { x0: 0, x1: T, y0, y1, xticks: xt, yticks: ticks(y0, y1), xf: v => String(+v.toPrecision(6)), yf: dec, yl: 'viscosity (Pa·s)', xl: 'time (s)',
      s: [{ p: pts.map(q => [q.t, L10(q.eta)]), c: ink, line: false, dots: true }, model(fit.common, locColor(0)), ...(fit.apart ? [model(fit.apart, locColor(1), [6, 4])] : [])] });
    document.getElementById('rtLegend').innerHTML = `<span><i class="rt-dot"></i>measured</span><span><i class="rt-sw" style="background:${locColor(0)}"></i>the structure model, one gain</span>${fit.apart ? `<span><i class="rt-sw dash" style="background:${locColor(1)}"></i>the yield and viscosity gains apart</span>` : ''}`;
    const row = (f, name, which) => `<tr><td>${name}</td><td class="num">${(f.rms * 100).toFixed(1)} %</td><td>${['tb', 'gdc', ...(which === 'apart' ? ['cy', 'ce'] : ['cy'])].map(k => `${which === 'common' && k === 'cy' ? 'gain c_y = c_η' : RT_VALS[k][0]} ${errText(f.S[k], f.err[k], f.loose.includes(k))}${RT_VALS[k][1] ? ' ' + RT_VALS[k][1] : ''}`).join(' · ')}</td><td><button type="button" class="btn btn-secondary btn-sm rt-use" data-which="${which}">Use this fit</button></td></tr>`;
    document.getElementById('rtTable').innerHTML = tbl(['Structure', 'Fit error', 'Values (± one standard error)', ''], [row(fit.common, 'One gain', 'common'), ...(fit.apart ? [row(fit.apart, 'Gains apart', 'apart')] : [])])
      + (fit.common.rms > 0.2 ? `<p class="mat-warn warn-text">The steady law as set (${rtEsc(fit.lawName)}) does not follow this test's viscosities (fit error ${(fit.common.rms * 100).toFixed(0)} %): fit a flow curve of this slurry and use it first, then this test.</p>` : '')
      + `<p class="rt-note">Fitted with the steady law as the app has it (${rtEsc(fit.lawName)}, ${P.mu} Pa·s at 2.7 1/s): fit the flow curve first. The structure starts steady at the first interval's shear rate. ${fit.rest.length >= 2 ? (fit.apart ? 'The test recovers at two or more slow rates: the yield and viscosity gains fitted apart as well.' : 'Recovering at two slow rates would pin the gains apart, with a yield stress in the law.') : 'One slow rate: one gain for the yield stress and the viscosity; the halving shear rate is often loose (tests recovering at two slow rates pin it down).'}</p>`;
    document.querySelectorAll('.rt-use[data-which]').forEach(b => { b.onclick = () => rtUseStruct(t, b.dataset.which); });
  } else {
    const tb = fit.tb, xs = t.kind === 'amp' ? tb.cols.strain.map(v => v * 100) : tb.cols.omega, [x0, x1] = logRange(xs), [y0, y1] = logRange([...tb.cols.G1, ...tb.cols.G2]);
    const vl = [];
    if (t.kind === 'amp') { const a = fit.amp; if (a.yield) vl.push({ x: L10(a.yield.strain * 100), c: cssVar('--warn'), t: 'yield point' }); if (a.flow) vl.push({ x: L10(a.flow.strain * 100), c: cssVar('--bad'), t: 'flow point' }); }
    else if (fit.freq.crossover) vl.push({ x: L10(fit.freq.crossover), c: cssVar('--warn'), t: 'crossover' });
    plotChart(cv, rtAspect(cv), { x0, x1, y0, y1, xticks: ticks(x0, x1), yticks: ticks(y0, y1), xf: dec, yf: dec, yl: 'G′, G″ (Pa)', xl: t.kind === 'amp' ? 'strain (%)' : 'angular frequency (rad/s)', vl,
      hl: t.kind === 'amp' ? [{ y: L10(fit.amp.G0), c: cssVar('--muted'), t: 'plateau G′' }] : [],
      s: [{ p: xs.map((x, i) => [L10(x), L10(tb.cols.G1[i])]), c: locColor(0), w: 2, dots: true }, { p: xs.map((x, i) => [L10(x), L10(tb.cols.G2[i])]), c: locColor(1), w: 2, dots: true }] });
    document.getElementById('rtLegend').innerHTML = `<span><i class="rt-sw" style="background:${locColor(0)}"></i>G′ (storage)</span><span><i class="rt-sw" style="background:${locColor(1)}"></i>G″ (loss)</span>`;
    if (t.kind === 'amp') {
      const a = fit.amp, r = (p, name, which) => `<tr><td>${name}</td><td>${p ? `strain ${rtNum(p.strain * 100)} % · stress ${rtNum(p.stress)} Pa` : 'not reached in the sweep'}</td><td>${p ? `<button type="button" class="btn btn-secondary btn-sm rt-use" data-yield="${which}">Use as the yield stress</button>` : ''}</td></tr>`;
      document.getElementById('rtTable').innerHTML = tbl(['', 'Where', ''], [`<tr><td>Plateau G′</td><td>${rtNum(a.G0)} Pa</td><td></td></tr>`, r(a.yield, 'Yield point (G′ 5 % below the plateau)', 'yield'), r(a.flow, 'Flow point (G′ = G″)', 'flow')])
        + '<p class="rt-note">The yield stress the laws use is the flow curve\'s (its stress as the shear rate goes to zero); the flow point is often close to it, the yield point below it. Herschel–Bulkley uses a yield stress.</p>';
      document.querySelectorAll('.rt-use[data-yield]').forEach(b => { b.onclick = () => rtUseYield(t, b.dataset.yield); });
    } else {
      const q = fit.freq;
      document.getElementById('rtTable').innerHTML = tbl(['', ''], [`<tr><td>Crossover (G′ = G″)</td><td>${q.crossover ? `${rtNum(q.crossover)} rad/s: relaxation time ${rtNum(q.relaxTime)} s` : 'not in the sweep'}</td></tr>`, `<tr><td>At 1 rad/s</td><td>G′ ${rtNum(q.G1at1)} Pa · G″ ${rtNum(q.G2at1)} Pa</td></tr>`])
        + '<p class="rt-note">Kept for the viscoelastic sub-phase (asked later): the flow models here are not viscoelastic.</p>';
    }
  }
}
