'use strict';
/*
 * rheo-params.js — the slurry's flow law in its standard parameters (MH-3), as Fluent and COMSOL define them:
 * Newtonian μ; power law K, n; Herschel–Bulkley τy, K, n (τ = τy + K γ̇ⁿ, K in Pa·sⁿ); Carreau–Yasuda η0 and Cross η0
 * (their η∞, λ and a on Materials), n. They are the inputs (P.mu for the Newtonian, P.K, P.eta0, P.ty, P.n).
 *
 * P.mu also carries, for every law, the viscosity it gives at 2.7 1/s -- the form the solvers take (muEffLocal: μref, τy,
 * n), an exact reparameterization -- and is kept in step, never rounded by a slider:
 *  - one of the law's own parameters changed (K, η0, τy, n, the law, its extras): P.mu = its viscosity at 2.7 1/s;
 *  - the viscosity at 2.7 1/s set from outside (a measured-data fit, a rheometer fit, a project from before MH-3): the
 *    law's own parameter (K or η0) follows, the others kept.
 * A law that cannot hold is never quietly changed (the old 5 % floor under K, the cap on η∞ at half of μref): the
 * solvers refuse it, and the inputs bar says why. A project from before whose numbers were made under that floor or cap
 * keeps them exactly (the law it was solved with), with a note saying so.
 * The slurry's own measurement (10.5 Pa·s at 2.7 1/s, the user's) is shown beside the law's value at that shear rate.
 */
const RHEO_PRIMARY = { newtonian: 'mu', power: 'K', hb: 'K', carreau: 'eta0', cross: 'eta0' };
/** The inputs set exactly (not through a slider's step): the law's own and its viscosity at 2.7 1/s. */
const RHEO_EXACT = new Set(['mu', 'K', 'eta0']);
/**
 * The inputs bar's material values kept exactly as given -- typed, fitted, imported, read back from a project or undone --
 * not rounded to the slider's step (a fitted n of 0.473 is not 0.45, a measured 0.068 N/m not 0.07): the law's own, n and
 * τy, the surface tension, the contact angles and their variation, the fibre's thickness. Dragging a slider still steps.
 */
const INPUT_EXACT = new Set([...RHEO_EXACT, 'n', 'ty', 'g', 'th', 'thw', 'dth', 'tf']);
/** A value as its box shows it: to the input's decimals, or to six significant digits when it has more (an exact value). */
const inputShow = (v, d) => (+(+v).toFixed(d) === +v ? (+v).toFixed(d) : String(+(+v).toPrecision(6)));
/** What a project from before MH-3 needed kept (the old floor or cap acting), shown until the law is next changed. */
let RHEO_NOTE = '';
let RHEO_HOLD = 0;
/** Run f with the keeping in step held (a project's inputs, undo: they come back consistent as they were saved). */
function rheoHold(f) { RHEO_HOLD++; try { return f(); } finally { RHEO_HOLD--; } }
const rheoHeld = () => RHEO_HOLD > 0 || (typeof UNDO !== 'undefined' && UNDO.applying);
/** The law in standard parameters from inputs get(k) (the inputs bar's, or a location's), the law and Materials' extras. */
function rheoStd(get = k => P[k], model = CFDG.model) {
  const x = MAT.rheo, n = get('n');
  switch (model) {
    case 'newtonian': return { model, mu: get('mu') };
    case 'power': return { model, K: get('K'), n };
    case 'hb': return { model, ty: get('ty'), K: get('K'), n };
    case 'carreau': return { model, eta0: get('eta0'), etaInf: x.etaInf.v, lam: x.lamT.v, a: x.aCY.v, n };
    case 'cross': return { model, eta0: get('eta0'), etaInf: x.etaInf.v, lam: x.lamT.v, n };
    default: return { model };
  }
}
/** The law's problems (matlib's checks: K ≤ 0, n ≤ 0, η0 ≤ η∞ ...): blocking errors first. */
const rheoProblems = (std = rheoStd()) => mlRheoCheck(std);
/** The viscosity at 2.7 1/s the law gives (the solvers' μref), or NaN when the law cannot hold. */
function rheoAnchor(std = rheoStd()) {
  if (rheoProblems(std).some(p => p.level === 'error')) return NaN;
  return mlRheoToSolver(std).muRef;
}
/** The law's own parameter (K or η0) giving viscosity mu at 2.7 1/s, the others as get gives them; NaN: none can. */
function rheoPrimaryFrom(model, mu, get = k => P[k]) {
  const g = ML_GD_REF, n = get('n');
  if (model === 'newtonian') return mu;
  if (model === 'power') return mu * Math.pow(g, 1 - n);
  if (model === 'hb') { const raw = mu - get('ty') / g; return raw > 0 ? raw * Math.pow(g, 1 - n) : NaN; }
  const x = MAT.rheo, ei = x.etaInf.v, L = x.lamT.v, a = model === 'cross' ? 1 : x.aCY.v;
  const t = Math.pow(L * g, model === 'cross' ? 1 - n : a), F = model === 'cross' ? 1 / (1 + t) : Math.pow(1 + t, (n - 1) / a);
  return mu > ei ? ei + (mu - ei) / F : NaN;
}
/** An exact input's display (its slider and number box) without the slider's step touching P. */
function rheoShow(k) {
  const c = CFG.find(q => q.k === k), sl = document.getElementById('s_' + k), num = document.getElementById('n_' + k);
  if (!c || !sl) return;
  sl.value = P[k];
  if (num && document.activeElement !== num) num.value = Number.isFinite(P[k]) ? inputShow(P[k], c.d) : '';
  if (typeof syncSliderFill === 'function') syncSliderFill(sl);
}
/**
 * After input k changed (the inputs bar, a fit, a location's law): the law's viscosity at 2.7 1/s and its own parameter
 * in step. k: 'mu' from outside (its own parameter follows); 'model' (the law chosen); else one of its parameters.
 */
function rheoSync(k) {
  if (rheoHeld()) return;
  const model = CFDG.model, prim = RHEO_PRIMARY[model];
  if (k === 'mu' && prim !== 'mu') {
    const v = rheoPrimaryFrom(model, P.mu);
    if (Number.isFinite(v)) { P[prim] = v; rheoShow(prim); }
  } else if (['K', 'eta0', 'ty', 'n', 'model', 'extras'].includes(k) || (k === 'mu' && prim === 'mu')) {
    const a = rheoAnchor();
    if (Number.isFinite(a)) { P.mu = a; rheoShow('mu'); }
  } else return;
  RHEO_NOTE = '';
}
/** Set the viscosity at 2.7 1/s with others (a fit's values: mu, n, ty), then the law's own parameter from them. */
function rheoSetAnchor(vals) {
  rheoHold(() => { for (const [k, v] of Object.entries(vals)) setInput(k, v); });
  rheoSync('mu');
}
/**
 * A project from before MH-3 (its inputs have no K): the law's own parameters from its viscosity at 2.7 1/s, its yield
 * stress and n, so that every solver gets exactly the law it was solved with:
 *  - Herschel–Bulkley: K = (μref − τy/2.7) 2.7^(1−n); where the old floor acted (μref − τy/2.7 below 5 % of μref), K at
 *    that floor and μref the law's real value at 2.7 1/s (the note says so: the slurry's 10.5 was not what it solved);
 *  - power law: K = μref 2.7^(1−n);  Carreau–Yasuda, Cross: η0 from μref, η∞ as the old cap held it;
 *  - a location that set its own yield stress or n (its viscosity at 2.7 1/s then kept): that viscosity set too.
 */
function rheoMigrate(inputs) {
  if (inputs && 'K' in inputs) return;
  const mu = P.mu, ty = P.ty, n = P.n, notes = [];
  const hb = mlRheoFromSolver('hb', mu, ty, n);
  P.K = CFDG.model === 'power' ? mu * Math.pow(ML_GD_REF, 1 - n) : hb.K;
  if (hb.floored && CFDG.model === 'hb') {
    P.mu = mlRheoToSolver({ model: 'hb', ty, K: hb.K, n }).muRef;
    notes.push(`its yield stress ${ty} Pa and viscosity ${mu} Pa·s at 2.7 1/s ${hb.conflict ? 'contradict each other' : 'nearly contradict each other'}: the solvers then held K at a floor of 5 % of that viscosity (${+hb.K.toPrecision(4)} Pa·sⁿ), so the law solved gives ${+P.mu.toPrecision(4)} Pa·s at 2.7 1/s. Kept as it was solved; set K or the yield stress`);
  }
  const x = { model: CFDG.model, etaInf: MAT.rheo.etaInf.v, L: MAT.rheo.lamT.v, a: MAT.rheo.aCY.v };
  if (CFDG.model === 'carreau' || CFDG.model === 'cross') {
    const cy = mlRheoFromSolver(CFDG.model, mu, 0, n, x);
    P.eta0 = cy.eta0;
    if (cy.capped) { notes.push(`its η∞ ${x.etaInf} Pa·s was held at half its viscosity at 2.7 1/s (${cy.etaInf} Pa·s) by the solvers: kept as solved`); MAT.rheo.etaInf = { ...MAT.rheo.etaInf, v: cy.etaInf }; }
  } else {
    // (the Carreau–Yasuda law's η0 for these inputs, for when it is chosen: anchored at the same viscosity)
    const cy = mlRheoFromSolver('carreau', mu, 0, n, { ...x, model: 'carreau' });
    if (Number.isFinite(cy.eta0)) P.eta0 = cy.eta0;
  }
  for (const k of ['K', 'eta0', 'mu']) rheoShow(k);
  for (const l of CFD_LOCS) if ((l.over.ty != null || l.over.n != null) && l.over.mu == null && l.over.K == null && l.over.eta0 == null) l.over.mu = mu;
  RHEO_NOTE = notes.length ? `This project: ${notes.join('; ')}.` : '';
}
/** A location's viscosity at 2.7 1/s for the solvers: the shared one unless it sets its own law (its own K, η0, τy, n). */
function locMuRef(i) {
  const o = CFD_LOCS[i].over;
  if (o.mu != null) return o.mu;
  if (!['K', 'eta0', 'ty', 'n'].some(k => o[k] != null)) return P.mu;
  return rheoAnchor(rheoStd(k => locInput(i, k)));
}
/** Why the law (shared, or location i's) cannot be solved, or ''. */
function rheoError(i = null) {
  const std = i == null ? rheoStd() : rheoStd(k => locInput(i, k)), p = rheoProblems(std).find(q => q.level === 'error');
  if (p) return `The flow law (${ML_RHEO[std.model].l}) cannot hold: ${p.msg}.`;
  const mu = i == null ? P.mu : locMuRef(i);
  if (!(mu > 0)) return 'The flow law cannot hold: its viscosity at 2.7 1/s is not positive.';
  if (std.model === 'hb' && !(mu - (i == null ? P.ty : locInput(i, 'ty')) / ML_GD_REF > 0)) return `The yield stress and the viscosity at 2.7 1/s contradict each other: no Herschel–Bulkley law gives both (K would be ≤ 0).`;
  return '';
}
/** The slurry's measurement the law is compared with (the user's: 10.5 Pa·s at 2.7 1/s). */
const RHEO_MEASURED = { gd: 2.7, mu: 10.5, src: 'yours' };
/** The inputs bar's line under the slurry's law: its viscosity at 2.7 1/s against the measurement, and what is wrong. */
function rheoReadoutHTML() {
  const std = rheoStd(), err = rheoError(), mu = P.mu, m = RHEO_MEASURED;
  const diff = Number.isFinite(mu) ? (mu - m.mu) / m.mu * 100 : NaN;
  const law = ML_RHEO[std.model] ? ML_RHEO[std.model].formula : '';
  return `<div class="rheo-out${err ? ' bad' : ''}"><div class="rheo-law">${law}</div>`
    + `<div class="rheo-row"><span>Viscosity at ${m.gd} 1/s, the law</span><b>${Number.isFinite(mu) ? +mu.toPrecision(4) : '—'} Pa·s</b></div>`
    + `<div class="rheo-row"><span>Your measurement</span><b>${m.mu} Pa·s${Number.isFinite(diff) && Math.abs(diff) >= 0.05 ? ` <small>${diff > 0 ? '+' : ''}${diff.toFixed(1)} %</small>` : ''}</b></div>`
    + (err ? `<p class="rheo-err">${err}</p>` : RHEO_NOTE ? `<p class="rheo-note">${RHEO_NOTE}</p>` : '') + '</div>';
}
function rheoReadout() {
  const el = document.getElementById('rheoOut');
  if (el) el.innerHTML = rheoReadoutHTML();
}
