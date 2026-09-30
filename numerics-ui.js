/*
 * numerics-ui.js — Coating › 2D and 3D: the Numerics panel (NUM-1). The numerical chain as the solvers run it, from the
 * geometry to the post-processing -- each stage's method (what the code does, not a menu of what it might do) and its
 * setting, "Automatic" resolved to the values it stands for -- and the last solve's quality: converged or not, its Newton
 * steps, its final residual against the tolerance, its mass balance.
 *
 * Advanced shows the settings that are real but were fixed in the code before: the floor of the viscosity's shear rate
 * (the yield-stress regularization, 2D and 3D, shared), and the 3D's own Newton tolerance and iteration limit. Each
 * default is exactly what the solvers always used, and a setting left on Automatic is not sent at all, so results solved
 * before stay current and nothing changes until one is set.
 *
 * 2D: the Solve step's "Numerics" tab in the bottom panel (cfd-ui.js's dock); 3D: under the Solve step's drawing.
 * Loaded after cfd-ui.js, cfd-steps.js and ui-3d.js.
 */

/** Basic (the chain) or Advanced (its settings open): a view choice, not saved. */
let NUM_ADV = false;
const NUM_GD_RANGE = { lo: 1e-6, hi: 10 };   // (1/s: the floor as a user may set it)
const NUM_IT3_RANGE = { lo: 10, hi: 300 };
/** The 3D's Newton iterations when Automatic (cfd-fem3d.js): a strip's; an edge strip's steps. */
const NUM_IT3_AUTO = { strip: 60, edgeFirst: 150, edgeNext: 80 };

const numEsc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const numSci = (v, d = 2) => {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v))), m = v / Math.pow(10, e);
  return e >= -2 && e <= 3 ? String(+v.toPrecision(d + 1)) : `${m.toFixed(d - 1)}×10${String(e).replace('-', '⁻').replace(/\d/g, c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c])}`;
};
/** The floor's Automatic value at a location (1/s): 10⁻³ U/H, the web's speed across the blade over the gap at the edge (cfd-worker.js). */
const numGdAuto = i => { const g = cfdGeometry(i); return 1e-3 * g.U / g.H; };
/** The floor used at a location (1/s) and whether it is Automatic. */
const numGdNow = i => (CFDS.gdMin > 0 ? { v: CFDS.gdMin, auto: false } : { v: numGdAuto(i), auto: true });

// ---- the chain ----
/** Rows [group, stage, method, setting] of the chain for kind '2d' (location i) or '3d'. */
function numChainRows(kind) {
  const d3 = kind === '3d', i = d3 ? (C3D.region === 'strip' ? C3D.loc : 0) : stepLoc2D(), geo = cfdGeometry(i), law = RHEO_MODELS[CFDG.model];
  const s = solverOf(i), gd = numGdNow(i), shape = (BLADE_SHAPES.find(([k]) => k === CFDG.shape) || [0, CFDG.shape])[1];
  const adv = NUM_ADV;
  // (the settings: Automatic stated with its value; in Advanced an input for the ones that can be set)
  const gdCell = adv
    ? `<span class="num-set"><input type="number" id="numGdMin" min="${NUM_GD_RANGE.lo}" max="${NUM_GD_RANGE.hi}" step="any" value="${CFDS.gdMin > 0 ? CFDS.gdMin : ''}" placeholder="${numSci(numGdAuto(i))}" aria-label="Yield-stress floor γ̇min (1/s), empty for Automatic"> 1/s
        <button type="button" class="tool-btn" id="numGdAuto"${gd.auto ? ' disabled' : ''}>Automatic</button></span><small>Automatic: 10⁻³ U/H = ${numSci(numGdAuto(i))} 1/s${d3 ? ' (shared with the 2D)' : ''}</small>`
    : `${gd.auto ? 'Automatic: ' : ''}γ̇min = ${numSci(gd.v)} 1/s<small>${gd.auto ? '10⁻³ U/H at the metering edge' : 'set (Automatic would be ' + numSci(numGdAuto(i)) + ' 1/s)'}</small>`;
  const tol3 = C3D.tol3 > 0 ? C3D.tol3 : null, it3 = C3D.iter3 > 0 ? C3D.iter3 : null;
  const itAutoText = C3D.region === 'edge' ? `${NUM_IT3_AUTO.edgeFirst} for the first pressure step, ${NUM_IT3_AUTO.edgeNext} after` : `${NUM_IT3_AUTO.strip} per 3D solve`;
  const tolCell = d3
    ? (adv ? `<span class="num-set"><select id="numTol3" aria-label="3D Newton tolerance"><option value=""${tol3 ? '' : ' selected'}>Automatic (the 2D's: ${fmtTol(CFDS.tol)})</option>${SOLVER_TOLS.map(t => `<option value="${t}"${t === tol3 ? ' selected' : ''}>${fmtTol(t)}</option>`).join('')}</select></span>`
      : `${tol3 ? fmtTol(tol3) : `Automatic: the 2D's, ${fmtTol(CFDS.tol)}`}`)
    : `${fmtTol(s.tol)}<small>on the Solve toolbar</small>`;
  const itCell = d3
    ? (adv ? `<span class="num-set"><input type="number" id="numIter3" min="${NUM_IT3_RANGE.lo}" max="${NUM_IT3_RANGE.hi}" step="1" value="${it3 || ''}" placeholder="auto" aria-label="3D Newton iterations, at most; empty for Automatic">
          <button type="button" class="tool-btn" id="numIt3Auto"${it3 ? '' : ' disabled'}>Automatic</button></span><small>Automatic: ${itAutoText}</small>`
      : `${it3 ? `at most ${it3}` : `Automatic: at most ${itAutoText}`}`)
    : `at most ${s.maxIter}<small>on the Solve toolbar</small>`;
  const counts = meshCounts(s, bladeXe(geo.H * 1000), geo.H);
  const mesh2 = `${MESH_PRESETS[s.mesh] ? MESH_PRESETS[s.mesh].l : s.mesh}: ${counts.nEb + counts.nEf + counts.nEs} × ${counts.nEy} elements<small>along the blade, face and film × across the gap</small>`;
  const mesh3 = `${C3D_MESH_PRESETS[c3dPresetOf()] ? C3D_MESH_PRESETS[c3dPresetOf()].l : 'Custom'}: ${C3D.nxGap + C3D.nxFace + C3D.nxFilm} × ${c3dNy()} × ${C3D.region === 'strip' ? C3D.nzStrip : C3D.region === 'edge' ? C3D.edgeNz : C3D.nzFull}<small>along × up the gap × across</small>`;
  const region = C3D.region === 'strip' ? `A strip ${C3D.stripW} mm wide at L${C3D.loc + 1}; its sides symmetry planes${P.skew ? ' (a skewed blade: held at their stations\' flow)' : ''}`
    : C3D.region === 'edge' ? `An edge strip ${C3D.edgeW} mm wide, its outer side open (the slurry's surface round the edge); the bead pressure raised in steps from none`
      : `The full width as overlapping strips solved in parallel, swept until they agree (additive Schwarz: at most ${C3D_WIDE_CFG.maxSweeps} sweeps, to ${numSci(C3D_WIDE_CFG.tol, 1)} of the gap)`;
  const clModel = CFDG.clModel === 'simple' ? 'Simple' : 'Full';
  return [
    ['Setup', 'Geometry', d3 ? (C3D.source === 'made' ? 'The 2D blade profile (lines and arcs) extruded across the web; the gap and contact angle vary across it' : 'The blade from the STL/STEP file (triangles); its underside by vertical rays; each station its own section')
      : 'The blade\'s side profile: straight lines and circular arcs; the web flat, moving', d3 ? (C3D.source === 'made' ? `From the 2D: ${numEsc(shape)}` : 'From the file') : numEsc(shape)],
    ['Setup', 'Mesh', d3 ? 'Structured hexahedra on spines (27 nodes, triquadratic): each station across the web the 2D\'s layout; graded toward the edge, the contact line and the walls'
      : 'Structured quadrilaterals on spines (9 nodes, quadratic), graded toward the metering edge, the contact line and the walls; zones or an adapted mesh from the Mesh step', d3 ? mesh3 : mesh2],
    ...(d3 ? [['Setup', 'Region', region, C3D.region === 'strip' ? 'Strip' : C3D.region === 'edge' ? 'Edge strip' : 'Full width']] : []),
    ['Setup', 'Physics', `Steady incompressible Navier–Stokes: ρ u·∇u = −∇p + ∇·τ + ρg, ∇·u = 0${d3 ? ' (u, v, w and p)' : ''}; τ = 2μ(γ̇)D`, numEsc(law.l)],
    ['Setup', 'Boundary conditions', 'Inlet: the bead pressure (normal traction). Blade and exit face: no slip. Web: moving, slipping over the fibre (Beavers–Joseph). Free surface: σ·n = γκn against the air. Outlet: the film moves with the web', 'On the drawing'],
    ['Numerics', 'Discretization', `Galerkin finite elements, Taylor–Hood Q2–Q1 (quadratic velocity, linear continuous pressure: stable without stabilization), isoparametric, ${d3 ? '3×3×3' : '3×3'} Gauss points`, 'The only method'],
    ['Numerics', 'Yield-stress floor', 'The viscosity at γ̇_eff = √(γ̇² + γ̇min²): finite where the slurry is unyielded (Herschel–Bulkley), the law itself above it', gdCell],
    ['Numerics', 'Pressure–velocity coupling', `Coupled: velocity, pressure, the free surface's heights and the contact line${d3 ? 's (one per station)' : ''} in one system`, 'Coupled (Newton)'],
    ['Numerics', 'Nonlinear solver', d3 ? 'Each station first in 2D; then Newton\'s method in 3D from them (a homotopy if far): exact Jacobian for the flow and the rheology, finite differences for the moving mesh, backtracking line search'
      : 'Newton\'s method: exact Jacobian for the flow and the rheology, finite differences for the moving mesh; backtracking line search; continuation from a Newtonian fluid to the law', itCell],
    ['Numerics', 'Linear solver', 'Direct: banded LU with partial pivoting (stored in row blocks: no 2 GB limit); the contact line bordered (Schur complement)', 'Direct'],
    ['Numerics', 'Convergence', 'Converged when the largest scaled residual is below the tolerance; reaching the iteration limit is a failure, never a result', tolCell],
    ['Free surface', 'Interface', 'Sharp and boundary-fitted: each spine\'s height an unknown; the kinematic condition u·n = 0 and the surface traction in the weak form (no curvature differentiated)', 'Spines'],
    ['Free surface', 'Contact line', `${clModel} model: the static contact angle on the exit face; held at a corner while the angle lies between its two faces' (Gibbs)`, `${locInput(i, 'th').toFixed(1)}° at L${i + 1}`],
    ['Time', 'Time', 'Steady: the flow at its operating state (no time derivative)', 'Steady'],
    ['Post-processing', 'Derived fields', d3 ? 'Shear rate and viscosity (in the solve), vorticity, the pressure gradient and the wall shear stress on the web (from the solved flow when shown) at the nodes: each element\'s own gradient, averaged over the elements sharing the node' : 'Shear rate, viscosity, stresses, vorticity at the nodes: each element\'s own gradient, averaged; pressure from its linear field', 'Results step'],
    ['Post-processing', 'Interpolation', d3 ? 'Within each element its own triquadratic basis (the solution as solved)' : 'Plots and probes: bilinear between the nodes of the solved mesh', '—'],
    ['Post-processing', 'Streamlines', (d3 ? C3D.streamInt : FV.streamInt) === 'rk45'
      ? `Adaptive Dormand–Prince 5(4) ${d3 ? 'in the element\'s own coordinates (they cannot leave the fluid)' : 'through the interpolated field'}: each step sized so its error estimate stays below 10⁻⁶ of ${d3 ? 'an element' : 'a cell'}; checked against the stream function`
      : d3 ? 'RK4 in the element\'s own coordinates (they cannot leave the fluid), a fixed step of 0.05 of an element' : 'RK4 through the interpolated field, a fixed step; checked against the stream function',
      (d3 ? C3D.streamInt : FV.streamInt) === 'rk45' ? 'Adaptive RK45' : 'RK4, fixed step'],
    ['Post-processing', 'Mass balance', d3 ? 'In through the inlet against out through the outlet and the strip\'s sides (web, blade and free surface let none through)' : 'The outflow against the inflow (the stream function at the domain\'s ends)', 'Below'],
  ];
}

/** The last solve's quality: '2d' (location i) or '3d'. */
function numLastHTML(kind) {
  if (kind === '3d') {
    const S = C3D_RES, R = S && S.result;
    if (!R) return '<p class="fv-why">Not solved yet: Solve 3D, then its convergence and mass balance show here.</p>';
    const stale = S.key !== c3dSolveKey3(S), mb = R.massBalance;
    const rows = [
      ['State', `${R.converged === false ? pill('Did not converge', 'bad') : pill('Converged', 'ok')}${stale ? ' ' + pill('Out of date', 'warn') : ''}`],
      ...(R.region === 'full' ? [['Strips', `${R.size && R.size.strips ? R.size.strips : '—'} overlapping, ${R.sweeps} sweeps to agree`]] : [['Newton steps (3D)', R.iterations != null ? String(R.iterations) : '—']]),
      ...(R.region === 'full' ? [] : [['Final residual', `${numSci(R.residual)}<small>tolerance ${fmtTol(C3D.tol3 > 0 ? C3D.tol3 : CFDS.tol)}</small>`]]),
      ...(R.size && R.size.unknowns ? [['Unknowns', R.size.unknowns.toLocaleString('en-US').replace(/,/g, ' ') + (R.size.bytes ? `<small>matrix ${(R.size.bytes / 1e6).toFixed(0)} MB</small>` : '')]] : []),
      ['Mass balance', mb ? (mb.worst != null ? `largest strip imbalance ${(mb.worst * 100).toFixed(3)} %<small>each strip's in against out and through its sides, last sweep</small>`
        : `imbalance ${(mb.imbalance * 100).toFixed(3)} %<small>in ${(mb.inlet * 1e9).toFixed(2)}, out ${(mb.outlet * 1e9).toFixed(2)}${Math.abs(mb.sides) > 1e-6 * Math.abs(mb.inlet) ? `, through the sides ${(mb.sides * 1e9).toFixed(2)}` : ''} mm³/s</small>`)
        : '—<small>solved before the mass balance was reported: Solve 3D again</small>'],
    ];
    return numKv(rows);
  }
  const i = stepLoc2D(), run = cfdRuns[i], r = run && run.result;
  if (!r || run.status !== 'done') return `<p class="fv-why">Location ${i + 1} is not solved yet: Run, then its convergence and mass balance show here (the whole sequence of solves on the Convergence tab).</p>`;
  const tr = r.trace, used = tr && tr.solves[tr.used], rows = [
    ['State', `${r.converged ? pill('Converged', 'ok') : pill('Stalled below 10⁻⁴', 'warn')}${cfdIsStale(i) ? ' ' + pill('Out of date', 'warn') : ''}`],
    ['Newton steps', used ? `${used.n}<small>of the solution shown; ${tr.r.length} in all over ${tr.solves.length} solves</small>` : String(r.iterations)],
    ['Final residual', `${numSci(r.residual)}<small>tolerance ${fmtTol(solverOf(i).tol)}</small>`],
    ['Mass balance', Number.isFinite(r.massError) ? `outflow against inflow ${(r.massError * 100).toFixed(4)} %` : '—'],
  ];
  return numKv(rows);
}
const numKv = rows => `<table class="kv num-kv"><tbody>${rows.map(([l, v]) => `<tr><th scope="row">${l}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

/** The panel: kind '2d' (the dock's Numerics tab) or '3d' (under the 3D Solve step). */
function numericsHTML(kind) {
  const rows = numChainRows(kind);
  let grp = '';
  const body = rows.map(([g, st, m, set]) => {
    const head = g !== grp ? `<tr class="num-grp"><th colspan="3" scope="colgroup">${g}</th></tr>` : '';
    grp = g;
    return `${head}<tr><th scope="row">${st}</th><td class="num-m">${m}</td><td class="num-s">${set}</td></tr>`;
  }).join('');
  const where = kind === '3d' ? '3D' : `2D at L${stepLoc2D() + 1}`;
  return `<section class="num-panel" id="num${kind}" aria-labelledby="num${kind}H">
    <div class="num-head"><h3 class="dock-h" id="num${kind}H">${uiBadge('tolerance')}Numerics · ${where}</h3>
      <div class="seg seg-sm" role="tablist" aria-label="Numerics: basic or advanced" id="num${kind}Mode"><button type="button" role="tab" data-numadv="0" aria-selected="${!NUM_ADV}">Basic</button><button type="button" role="tab" data-numadv="1" aria-selected="${NUM_ADV}">Advanced</button></div>
      <span class="fv-why">${NUM_ADV ? 'The settings that can be changed are open. Each Automatic is what the solver has always used; a setting left on Automatic is not sent to it.' : 'What the solver does, stage by stage; Automatic resolved to its values. Advanced opens the settings that can be changed.'}</span></div>
    <div class="num-cols"><div class="table-wrap"><table class="cfd-table num-table"><thead><tr><th>Stage</th><th>Method, as the solver runs it</th><th>Setting</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="num-last"><h4>${uiBadge('conv')}The last solve</h4>${numLastHTML(kind)}</div></div>
  </section>`;
}

/** Wire the panel's switches and inputs (after it is drawn): 2D redraws the CFD view, 3D the page. */
function wireNumerics(kind) {
  const sec = document.getElementById('num' + kind);
  if (!sec) return;
  const redraw = () => { if (kind === '3d') render(); else viewCFD(); };
  sec.querySelectorAll('[data-numadv]').forEach(b => { b.onclick = () => { NUM_ADV = b.dataset.numadv === '1'; redraw(); }; });
  const gd = document.getElementById('numGdMin');
  if (gd) gd.onchange = () => { guardNumber(gd, { label: 'Yield-stress floor γ̇min', lo: NUM_GD_RANGE.lo, hi: NUM_GD_RANGE.hi, unit: '1/s', allowEmpty: true }, v => { CFDS.gdMin = v > 0 ? v : null; }); redraw(); };
  const ga = document.getElementById('numGdAuto'); if (ga) ga.onclick = () => { CFDS.gdMin = null; redraw(); };
  const t3 = document.getElementById('numTol3'); if (t3) t3.onchange = () => { C3D.tol3 = t3.value ? +t3.value : null; redraw(); };
  const it = document.getElementById('numIter3');
  if (it) it.onchange = () => { guardNumber(it, { label: '3D Newton iterations, at most', lo: NUM_IT3_RANGE.lo, hi: NUM_IT3_RANGE.hi, allowEmpty: true }, v => { C3D.iter3 = v > 0 ? Math.round(v) : null; }); redraw(); };
  const ia = document.getElementById('numIt3Auto'); if (ia) ia.onclick = () => { C3D.iter3 = null; redraw(); };
}
/** The 2D's dock tab: drawn with the CFD view. */
function renderNumerics2D() {
  const host = document.getElementById('cfdNumerics');
  if (!host) return;
  host.innerHTML = numericsHTML('2d');
  wireNumerics('2d');
}
/** The report's table of the chain ('2d' at a location, or '3d'): its stages, methods and settings (the inputs' HTML left out). */
function numericsReportRows(kind) {
  const keep = NUM_ADV; NUM_ADV = false;
  try { return numChainRows(kind).map(([, st, m, set]) => [st, m, set.replace(/<small>/g, ' (').replace(/<\/small>/g, ')').replace(/<[^>]*>/g, '')]); }
  finally { NUM_ADV = keep; }
}
