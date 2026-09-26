'use strict';
/*
 * Input validation. A typed value outside its range is rejected: the last valid value stays, the
 * field is marked, and the entry is listed under Problems. Before a location is solved its inputs
 * are checked as a whole: errors (outside what the solver can do) stop the run, warnings (outside
 * where the model is reliable, or an unusual process setting) are listed and it runs.
 */

// ---- rejected entries ----
const inputProblems = new Map();   // field id -> { label, text, id }
const fmtRange = (lo, hi, unit) => `${lo} to ${hi}${unit ? ' ' + unit : ''}`;
/**
 * Validate a typed number: in [lo, hi] it is passed to apply(v) and any earlier rejection of the
 * field is cleared; else the field is marked, the entry listed, and false returned (the caller
 * puts the last valid value back). allowEmpty: an empty field is valid (apply(null)).
 */
function guardNumber(el, { label, lo, hi, unit = '', allowEmpty = false }, apply) {
  const id = el.id, raw = el.value.trim(), v = +raw;
  if (raw === '' && allowEmpty) { clearRejected(id); apply(null); renderProblems(); return true; }
  if (raw === '' || !Number.isFinite(v) || v < lo || v > hi) {
    const text = `${label}: ${raw === '' ? 'an empty entry' : `${raw}${unit ? ' ' + unit : ''}`} is not allowed (${fmtRange(lo, hi, unit)}); the last valid value was kept.`;
    inputProblems.set(id, { label, text, id });
    markInvalidInputs();
    renderProblems();
    return false;
  }
  clearRejected(id);
  apply(v);
  renderProblems();
  return true;
}
function clearRejected(id) {
  inputProblems.delete(id);
  const el = document.getElementById(id);
  if (el) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); if (el.dataset.badTitle) { el.title = ''; delete el.dataset.badTitle; } }
}
/** Mark the fields with a rejected entry (after a view is drawn again). */
function markInvalidInputs() {
  for (const [id, p] of inputProblems) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.add('invalid'); el.setAttribute('aria-invalid', 'true'); el.title = p.text; el.dataset.badTitle = '1';
  }
}

// ---- checks before a run ----
/** Problems with the inputs of one solve (geo as cfdGeometry gives it). i: its location (for the fields to go to), or null. */
function checkGeometry(geo, i) {
  const out = [], own = k => i != null && CFD_LOCS[i].over[k] != null;
  const field = (k, tree) => own(k) ? `li_${i}_${k}` : tree;
  const err = (code, text, jump) => out.push({ level: 'error', code, text, jump });
  const warn = (code, text, jump) => out.push({ level: 'warning', code, text, jump });
  const Hmm = geo.H * 1000, Umin = geo.U * 60;
  // what the solver can do
  if (!(geo.U > 0)) err('speed', `Web speed ${Umin.toFixed(2)} m/min: it must be above 0.`, field('U', 'n_U'));
  if (!(geo.H > 0)) err('gap', `The gap at the metering edge is ${Hmm.toFixed(3)} mm: the scraper must sit above the fibre.`, field('gap', 'n_Hm'));
  // (a shaped blade: the contact line can stay pinned below a flat exit face; a face too steep for the contact angle holds none;
  // a custom face has no one exit angle -- the solver says where the contact line can go)
  const shapedB = !!geo.blade, sum = geo.exitAngle + geo.contactDeg;
  if (shapedB && geo.shape !== 'custom' && !(sum > 94)) err('angles', `Exit face ${geo.exitAngle}° + contact angle ${geo.contactDeg.toFixed(1)}° = ${sum.toFixed(1)}°: the surface would leave the exit face overhanging (needs above 94°).`, field('th', 'cfdExit'));
  if (!shapedB && !(sum > 94 && sum < 175)) err('angles', `Exit face ${geo.exitAngle}° + contact angle ${geo.contactDeg.toFixed(1)}° = ${sum.toFixed(1)}°: the free-surface solver needs between 94° and 175°.`, field('th', 'cfdExit'));
  if (!(geo.muRef > 0)) err('visc', 'The viscosity must be above 0.', field('mu', 'n_mu'));
  if (RHEO_MODELS[geo.model].uses.includes('n') && !(geo.n > 0.05 && geo.n <= 2)) err('nrange', `Shear-thinning index ${geo.n}: the solver needs 0.05 to 2.`, field('n', 'n_n'));
  if (geo.ty < 0) err('yneg', 'The yield stress cannot be negative.', field('ty', 'n_ty'));
  if (!(geo.gamma > 0)) err('gamma', 'The surface tension must be above 0.', field('g', 'n_g'));
  if (bladeUsesL(geo.shape) && !(geo.L > 0)) err('land', 'The land length must be above 0.', 'n_L');
  const prof = shapedB ? bladeProfileCached(geo.blade) : null;
  if (prof && prof.err) err('blade', `The blade shape is not possible: ${prof.err}.`, 'cfdShape');
  const fs = fibreStructure();
  if (!(fs.eps > 0 && fs.eps < 1)) err('fibre', `The fibre data give a porosity of ${(fs.eps * 100).toFixed(0)} %: the basis weight, fibre density and thickness do not fit together.`, 'cfdGsm');
  // where the model is reliable
  const Re = geo.rho * geo.U * geo.H / geo.muRep, Ca = geo.muRep * geo.U / geo.gamma;
  if (Re > 50) warn('re', `Reynolds number ${Re.toFixed(0)}: the flow may not stay steady and laminar, as the solver assumes.`, field('mu', 'n_mu'));
  if (Ca > 1) warn('ca', `Capillary number ${Ca.toFixed(2)}: the contact line moves fast over the blade, and the static contact-angle model is least reliable there.`, field('th', 'n_th'));
  if (RHEO_MODELS[geo.model].uses.includes('n') && (geo.n < 0.2 || geo.n > 1.2)) warn('nusual', `Shear-thinning index ${geo.n}: outside the usual range for slurries (0.2 to 1.2).`, field('n', 'n_n'));
  if (geo.ty > 0) {
    // the driving stresses without the yield stress: the viscous part of the law at U/H (as muLaw) and the bead pressure over the blade
    const Lb = geo.shape === 'round' ? geo.Xup : prof ? prof.xe : geo.L, gd = geo.U / geo.H, n = RHEO_MODELS[geo.model].uses.includes('n') ? geo.n : 1;
    const base = Math.max(geo.muRef - geo.ty / 2.7, 0.05 * geo.muRef);
    const drive = Math.max(base * Math.pow(gd / 2.7, n - 1) * gd, geo.Pup * geo.H / (2 * Lb));
    if (geo.ty > drive) warn('yield', `Yield stress ${geo.ty} Pa is above the stresses driving the flow (about ${drive.toFixed(1)} Pa): much of the slurry will not yield, and the solver may converge slowly or not at all.`, field('ty', 'n_ty'));
  }
  if (geo.solver && geo.solver.tol >= 1e-6) warn('tol', `Newton tolerance ${fmtTol(geo.solver.tol)}: results are converged only loosely.`, 'cfdTol');
  // the process
  if (geo.shape === 'round' && CFDG.pool > 0.8 * CFDG.R) warn('pool', `Pool edge ${CFDG.pool} mm is beyond 0.8 × the radius: ${(0.8 * CFDG.R).toFixed(0)} mm is used.`, 'cfdPool');
  if (Hmm > 0 && Hmm < 0.1) warn('thin', `The gap at the edge is only ${Hmm.toFixed(3)} mm: slurry particles (2 to 8 µm) and fibre roughness become a large part of it.`, field('gap', 'n_Hm'));
  if (Hmm > 0 && (P.dH + P.dt + Math.abs(P.tilt) / 2) / 1000 > 0.3 * Hmm) warn('wavy', `Gap waviness ${P.dH} µm, ${P.tilt ? `blade tilt ${P.tilt} µm edge to edge and ` : ''}fibre thickness variation ${P.dt} µm together exceed 30 % of the gap: the local gap varies strongly across the web.`, P.tilt && Math.abs(P.tilt) / 2 > P.dH ? 'n_tilt' : 'n_dH');
  const film2D = Math.max(12, (geo.solver ? geo.solver.ldGaps : 8) * Hmm);
  if (geo.ovenDistance * 1000 <= film2D) warn('oven', `The oven (${(geo.ovenDistance * 1000).toFixed(0)} mm away) is within the free film solved in 2D (${film2D.toFixed(0)} mm): the film up to the oven is not computed beyond it.`, 'n_oven');
  return out;
}
const checkLocation = i => checkGeometry(cfdGeometry(i), i);

/** Everything listed under Problems: rejected entries, then each location's checks (the same one for several locations merged). */
function problemList() {
  const out = [...inputProblems.values()].map(p => ({ level: 'error', kind: 'entry', text: p.text, jump: p.id, where: 'entry rejected' }));
  const merged = new Map();
  CFD_LOCS.forEach((_, i) => {
    let list = [];
    try { list = checkLocation(i); } catch (e) { list = [{ level: 'error', text: `The inputs could not be checked: ${e.message}` }]; }
    for (const p of list) {
      const key = p.level + ':' + (p.code || p.text), m = merged.get(key);
      if (m) { m.locs.push(i); if (m.text !== p.text) m.differ = true; } else merged.set(key, { ...p, kind: 'check', locs: [i] });
    }
  });
  // (one entry per kind of problem: the first location's numbers, the others' when they differ are theirs)
  for (const p of merged.values()) out.push({ ...p, text: p.differ ? `${p.text} (L${p.locs[0] + 1}'s values; the others differ a little)` : p.text, where: p.locs.length === CFD_LOCS.length ? 'all locations' : p.locs.map(i => `L${i + 1}`).join(', ') });
  return out.sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
}

/** The Problems panels (CFD and DOE docks) and their tab counts. */
function renderProblems() {
  const hosts = document.querySelectorAll('.problems-host');
  const list = problemList(), nRej = list.filter(p => p.kind === 'entry').length, nErr = list.filter(p => p.level === 'error' && p.kind !== 'entry').length, nWarn = list.length - nErr - nRej;
  document.querySelectorAll('.tab-n[data-n="problems"]').forEach(el => {
    el.textContent = list.length ? String(list.length) : '';
    el.classList.toggle('bad', nErr + nRej > 0); el.classList.toggle('warn', !(nErr + nRej) && nWarn > 0);
  });
  if (!hosts.length) return;
  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const icon = (lv, kind) => lv === 'error'
    ? '<span class="prob-lv bad"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' + (kind === 'entry' ? 'Rejected' : 'Error') + '</span>'
    : '<span class="prob-lv warn"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l6.5 11.5h-13z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>Warning</span>';
  const html = list.length
    ? `<div class="fv-bar"><span class="fv-ctl">${nRej ? `<b>${nRej}</b> rejected entr${nRej === 1 ? 'y' : 'ies'} · ` : ''}<b>${nErr}</b> error${nErr === 1 ? '' : 's'} · <b>${nWarn}</b> warning${nWarn === 1 ? '' : 's'}</span>
        <span class="fv-why">Errors stop a location from being solved; warnings do not.</span>
        ${inputProblems.size ? '<button type="button" class="btn btn-secondary btn-sm" data-prob-clear>Clear rejected entries</button>' : ''}</div>
      <div class="table-wrap"><table class="cfd-table prob-table"><thead><tr><th>Level</th><th>Problem</th><th>Where</th><th></th></tr></thead><tbody>
        ${list.map(p => `<tr class="prob-${p.level}"><td>${icon(p.level, p.kind)}</td><td>${esc(p.text)}</td><td>${p.where}</td><td class="case-act">${p.jump ? `<button type="button" class="btn btn-secondary btn-sm" data-jump="${p.jump}">Go to</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`
    : '<p class="cap">No problems: the inputs are within what the solver can do and where the model is reliable.</p>';
  hosts.forEach(h => {
    h.innerHTML = html;
    h.querySelectorAll('[data-jump]').forEach(b => { b.onclick = () => jumpToField(b.dataset.jump); });
    const clr = h.querySelector('[data-prob-clear]');
    if (clr) clr.onclick = () => { for (const id of [...inputProblems.keys()]) clearRejected(id); renderProblems(); };
  });
}
/** Show and focus an input: its tree group opened (a location's own input: its panel), scrolled into view, briefly highlighted. */
function jumpToField(id) {
  let el = document.getElementById(id);
  const m = /^l[is]_(\d+)_/.exec(id);
  if (!el && m && typeof renderLocCards === 'function' && document.getElementById('cfdLocs')) { cfdEditLoc = +m[1]; renderLocCards(); el = document.getElementById(id); }
  if (!el && /^(cfd|n_|li_|ls_)/.test(id) && tab !== 4) { tab = 4; render(); el = document.getElementById(id); }
  if (!el) return;
  for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
  const row = el.closest('.prop') || el.closest('label') || el;
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}
