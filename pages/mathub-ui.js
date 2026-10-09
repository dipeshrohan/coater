'use strict';
/*
 * mathub-ui.js — the Materials page as a material hub: the library of the project's materials and interfaces on the
 * left; the material picked on the right -- its identity, where it is in the line, its checks, then its tabs (the
 * owner's spec): Overview (identity and metadata), Properties (a table by group: property, symbol, definition method,
 * value, unit, validity range, data source; a row opens its definition), Constitutive Models, Experimental Data,
 * Property Functions (each property's equation or table in T, plotted), Validity and Sources, Domain Assignments.
 * Two more views: Readiness (per solver: required and complete, missing, optional, unsupported) and Compare.
 * The values are the ones the solvers read (mathub.js binds each property to it): an edit here is an edit there.
 */
const HUB = { view: 'lib', sel: 'slurry', tab: 'props', open: null, q: '', cmpT: 20, readyOpen: null, conv: null };
/** A symbol: escaped, its _sub as a subscript (x_dry, c_p, τ_y). */
const hubSym = s => hubEsc(s).replace(/_([A-Za-z0-9,.₀-₉]+)/g, '<sub>$1</sub>');
const hubEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HUB_CLS_ORDER = ['Fluid', 'Particles', 'Gas', 'Solid', 'Porous solid'];

/**
 * Show the hub: at a material (sel), its tab and a property opened (open) and scrolled to (or a row scrolled to:
 * scroll), or at a view (view: 'ready' with a solver opened, ready). The other pages' links to their materials.
 */
function hubShow({ sel = null, tab: t = 'props', open = null, scroll = null, view = 'lib', ready = null } = {}) {
  HUB.view = view; HUB.readyOpen = ready;
  if (sel) { HUB.sel = sel; HUB.tab = t; HUB.open = open; }
  if (tab !== 13) navGo('materials'); else render();
  const row = (open || scroll) && document.querySelector(`[data-hubrow="${open || scroll}"]`) || (ready && document.querySelector(`[data-hubready="${ready}"]`));
  if (row) row.scrollIntoView({ block: 'center' });
}
/** The stage cards' places in the hub (the menus' and the stages' links to them). */
const HUB_CARD_AT = { matSlurryH: { sel: 'slurry' }, matRheoH: { sel: 'slurry', scroll: 'model' }, matOrH: { sel: 'slurry', scroll: 'orOn' }, matFibreH: { sel: 'web' },
  matDryH: { view: 'ready', ready: 'dry' }, matFilmH: { sel: 'gofilm' }, matFurnH: { view: 'ready', ready: 'furn' }, matTestsH: { sel: 'slurry', tab: 'meas' } };

// ---- the page ----
function viewMaterials() {
  // (a rebuild keeps the focus, the caret and the scroll where they were)
  const ae = document.activeElement, fid = ae && ae.id && view.contains(ae) ? ae.id : null, sel = fid && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null;
  const sc = [...document.querySelectorAll('#view .mod-vp, #hubLib, #hubMain')].map(e => [e.id || e.className, e.scrollTop]);
  const views = [['lib', 'Materials'], ['ready', 'Readiness'], ['compare', 'Compare']];
  view.innerHTML = moduleFrame({
    tools: `<span class="seg" role="tablist" aria-label="Materials: which view" id="hubViews">${views.map(([k, t]) => `<button type="button" role="tab" data-hubview="${k}" aria-selected="${HUB.view === k}">${t}</button>`).join('')}</span>
      <span class="hub-tools">
        <button type="button" class="btn btn-secondary btn-sm" id="hubImport">${uiIco('upload')}Import…</button>
        <button type="button" class="btn btn-secondary btn-sm" id="hubExport">${uiIco('download')}Export</button>
        <button type="button" class="btn btn-secondary btn-sm" id="hubSheet">${uiIco('download')}Export CSV</button>
        <details class="hub-menu" id="hubDefaults"><summary class="btn btn-secondary btn-sm">${uiIco('restart')}Defaults</summary>
          <div class="hub-menu-pop" role="menu">${[['matReset', 'slurry'], ['matRheoReset', 'rheo'], ['matOrReset', 'orient'], ['matDryReset', 'dry'], ['matFilmReset', 'film'], ['matFurnReset', 'furn'], ['matLibReset', 'lib']].map(([id, c]) => `<button type="button" role="menuitem" id="${id}" data-hubreset="${c}">The ${HUB_CARD_T[c]}<small>its ${HUB_CARDS[c].length} values back to their first values</small></button>`).join('')}</div></details>
      </span>`,
    top: '<div id="hubRoot" class="hub-root"></div>',
    panes: [],
  });
  hubPaint();
  for (const [k, t] of sc) { const e = [...document.querySelectorAll('#view .mod-vp, #hubLib, #hubMain')].find(x => (x.id || x.className) === k); if (e) e.scrollTop = t; }
  if (fid) { const e = document.getElementById(fid); if (e) { e.focus({ preventScroll: true }); if (sel && typeof e.setSelectionRange === 'function') try { e.setSelectionRange(...sel); } catch (er) { /* (a number box) */ } } }
  view.querySelectorAll('[data-hubview]').forEach(b => { b.onclick = () => { HUB.view = b.dataset.hubview; render(); }; });
  document.getElementById('hubExport').onclick = hubExportFile;
  document.getElementById('hubImport').onclick = hubImportFile;
  document.getElementById('hubSheet').onclick = hubSheetFile;
  view.querySelectorAll('[data-hubreset]').forEach(b => { b.onclick = () => {
    const c = b.dataset.hubreset; document.getElementById('hubDefaults').open = false;
    undoHint(`The ${HUB_CARD_T[c]}: back to its defaults`);
    MAT = { ...MAT, [c]: c === 'rheo' ? { ...matDefaults().rheo, side: MAT.rheo.side } : matDefaults()[c] };
    if (c === 'rheo') rheoSync('extras');
    render();
  }; });
}
/** The page's body for the view shown (in #hubRoot), wired. */
function hubPaint() {
  const root = document.getElementById('hubRoot');
  if (!root) return;
  hubStatus();
  if (HUB.view === 'ready') { root.innerHTML = hubReadyHTML(); hubWireReady(); return; }
  if (HUB.view === 'compare') { root.innerHTML = hubCompareHTML(); hubWireCompare(); return; }
  if (!hubRec(HUB.sel)) HUB.sel = 'slurry';
  const r = hubRec(HUB.sel);
  // (a copy, MC-2: its editor drawn with its own values in place)
  const ed = r.inst ? hubInInst(r.inst, () => hubEditorHTML(r)) : hubEditorHTML(r);
  root.innerHTML = `<div class="hub-grid"><nav class="hub-lib" id="hubLib" aria-label="The project's materials">${hubLibHTML()}</nav><section class="hub-main" id="hubMain" aria-labelledby="hubName">${ed}</section></div>`;
  hubWireLib(); hubWireEditor(r);
}
/** The page's status line: the materials, required values missing, what blocks a solver. */
function hubStatus() {
  const st = document.getElementById('st'), ss = document.getElementById('ss');
  if (ss) ss.innerHTML = '';
  if (!st) return;
  const R = hubReadiness(), miss = R.reduce((a, q) => a + q.n.missing, 0), bad = R.filter(q => q.st === 'bad');
  const nc = hubInsts().length;
  st.innerHTML = pill(`${HUB_RECORDS.length} materials · ${HUB_IFACES.length} interfaces${nc ? ` · ${nc} cop${nc === 1 ? 'y' : 'ies'}` : ''}`, '')
    + (miss ? pill(`${miss} required values missing`, 'warn') : '')
    + (bad.length ? pill(`${bad.map(q => q.ph.l).join(', ')}: a material cannot hold as set`, 'bad') : '');
}

// ---- the library ----
function hubMatches(r) {
  const q = HUB.q.trim().toLowerCase();
  if (!q) return true;
  return [hubName(r), r.name, r.sub, r.cls, ...hubProps(r).map(p => `${p.l} ${p.sym}`)].some(t => String(t).toLowerCase().includes(q));
}
function hubLibHTML() {
  const item = r => {
    const ch = hubChecks(r), lv = ch.some(c => c.level === 'error') ? 'bad' : ch.length ? 'warn' : '';
    return `<button type="button" class="hub-item${r.id === HUB.sel ? ' on' : ''}${r.inst ? ' hub-item-copy' : ''}" data-hubsel="${r.id}" aria-current="${r.id === HUB.sel}">
      ${uiBadge(r.icon)}<span class="hub-item-t"><b>${hubEsc(hubName(r))}</b><small>${hubEsc(r.sub)}</small></span>${lv ? `<i class="hub-dot hub-${lv}" title="${lv === 'bad' ? 'cannot hold as set' : 'a warning'}"></i>` : ''}</button>`;
  };
  // (each record followed by its copies, MC-2)
  const withCopies = rs => rs.flatMap(r => [r, ...hubInsts(r.id).map(hubInstRec)]).filter(hubMatches);
  const mats = withCopies(HUB_RECORDS), ifs = withCopies(HUB_IFACES);
  const groups = HUB_CLS_ORDER.map(c => [c, mats.filter(r => r.cls === c)]).filter(g => g[1].length);
  return `<label class="hub-search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><input type="search" id="hubQ" placeholder="Search materials, properties" value="${hubEsc(HUB.q)}" aria-label="Search the materials and their properties"></label>
    ${groups.map(([c, rs]) => `<div class="hub-lib-h">${c === 'Particles' ? 'Particles' : c + (rs.length > 1 && !/s$/.test(c) ? 's' : '')}</div>${rs.map(item).join('')}`).join('')}
    ${ifs.length ? `<div class="hub-lib-h">Interfaces</div>${ifs.map(item).join('')}` : ''}
    ${!groups.length && !ifs.length ? '<p class="hub-none">Nothing matches.</p>' : ''}`;
}
function hubWireLib() {
  view.querySelectorAll('[data-hubsel]').forEach(b => { b.onclick = () => { if (HUB.sel !== b.dataset.hubsel) { HUB.sel = b.dataset.hubsel; HUB.open = null; const r = hubRec(HUB.sel); if (!hubTabs(r).some(t => t[0] === HUB.tab)) HUB.tab = 'props'; } hubPaint(); }; });
  const q = document.getElementById('hubQ');
  if (q) q.addEventListener('input', () => { HUB.q = q.value; const lib = document.getElementById('hubLib'); lib.innerHTML = hubLibHTML(); hubWireLib(); const nq = document.getElementById('hubQ'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
}

// ---- the editor ----
/** A material's tabs (the owner's spec), those with content: a material without models or measurements has no such tab. */
function hubTabs(r) {
  return [['overview', 'Overview'], ['props', 'Properties'], ...(r.models ? [['models', 'Constitutive Models']] : []), ...(hubMeasured(r) ? [['meas', 'Experimental Data']] : []),
    ...(hubFuncProps(r).length ? [['funcs', 'Property Functions']] : []), ['valid', 'Validity and Sources'], ['domains', 'Domain Assignments']];
}
/** The properties with a function to show: a law in temperature, or a value a solver can take in temperature. */
const hubFuncProps = r => hubProps(r).filter(p => p.b.t === 'law' || hubTdep(p));
function hubEditorHTML(r) {
  const ch = hubChecks(r), tabs = hubTabs(r), iface = r.id.startsWith('i-');
  if (!tabs.some(t => t[0] === HUB.tab)) HUB.tab = 'props';
  const parts = iface ? [r.a, r.bb].map(id => (id ? `<button type="button" class="hub-link" data-hubsel="${id}">${hubEsc(hubRec(id).name)}</button>` : '<span>the blade (rigid wall)</span>')).join(' <span class="hub-sep">|</span> ') : '';
  return `<header class="hub-head">
      <div class="hub-title">${uiBadge(r.icon)}<div><h2 id="hubName">${hubEsc(hubName(r))}</h2><p class="hub-cls"><span class="hub-tag">${iface ? 'Interface' : r.cls}</span>${r.inst ? `Copy of <button type="button" class="hub-link" data-hubsel="${r.base}">${hubEsc(hubName(hubBaseRec(r.base)))}</button> · ` : ''}${hubEsc(r.sub)}${r.desc && !r.inst ? ` · ${hubEsc(r.desc)}` : ''}</p></div>
        <span class="hub-head-act"><button type="button" class="btn btn-secondary btn-sm" id="hubRecDup" title="A copy of this material, edited apart from it and assigned to the domains you choose">${uiIco('plus')}Duplicate</button>${r.inst ? `<button type="button" class="btn btn-secondary btn-sm" id="hubRecDel" title="Remove this copy: its domains take ${hubEsc(hubName(hubBaseRec(r.base)))} again">${uiIco('trash')}Delete</button>` : ''}<button type="button" class="btn btn-secondary btn-sm" id="hubRecReset" title="This material's values back to their first values">${uiIco('restart')}Defaults</button><button type="button" class="btn btn-secondary btn-sm" id="hubRecExport">${uiIco('download')}Export</button></span></div>
      ${iface ? `<dl class="hub-facts"><div><dt>Between</dt><dd>${parts}</dd></div></dl>` : ''}
      ${r.note ? `<p class="hub-note">${hubEsc(r.note)}</p>` : ''}
      ${ch.length ? `<ul class="hub-checks">${ch.map(c => `<li class="hub-${c.level === 'error' ? 'bad' : 'warn'}"><i class="hub-dot hub-${c.level === 'error' ? 'bad' : 'warn'}"></i>${hubEsc(c.msg)}</li>`).join('')}</ul>` : ''}
    </header>
    <div class="hub-tabs" role="tablist" aria-label="${hubEsc(r.name)}: its pages">${tabs.map(([k, t]) => `<button type="button" role="tab" data-hubtab="${k}" aria-selected="${HUB.tab === k}">${t}</button>`).join('')}</div>
    <div class="hub-tab" role="tabpanel">${{ overview: hubOverviewHTML, models: hubModelsHTML, meas: hubMeasHTML, funcs: hubFuncsHTML, valid: hubValidHTML, domains: hubDomainsHTML }[HUB.tab]?.(r) ?? hubPropsHTML(r)}</div>`;
}

// the property table
function hubPropsHTML(r) {
  const body = r.groups.map(g => `<tbody class="hub-grp"><tr class="hub-grp-h"><th colspan="7" scope="rowgroup">${hubEsc(g.l)}</th></tr>${g.props.filter(p => !hubHidden(p)).map(p => hubRowHTML(r, p)).join('')}</tbody>`).join('');
  return `<div class="table-wrap"><table class="hub-table"><thead><tr><th scope="col">Property</th><th scope="col">Symbol</th><th scope="col">Method</th><th scope="col" class="hub-c-v">Value</th><th scope="col">Unit</th><th scope="col" class="hub-c-rng">Valid range</th><th scope="col" class="hub-c-src">Data source</th></tr></thead>${body}</table></div>`;
}
/** A property's value cell: its input (an editable value), select or switch, else the value. */
function hubValCell(p, v) {
  const b = p.b;
  // (a copy: its own card values and laws; the inputs bar's, the fibre's report, the switches are the project's, shown)
  if (b.inst && !['card', 'law', 'calc', 'tensor', 'stiff', 'stiffWeb'].includes(b.t)) {
    const txt = b.t === 'model' ? RHEO_MODELS[CFDG.model].l : b.t === 'orModel' ? OR_MODELS[MAT.orient.model] : b.t === 'switch' ? (b.get() ? 'On' : 'Off') : b.t === 'fibreSel' ? FIBRES[CFDG.fibre].l : typeof v.v === 'number' ? hubFmt(v.v, v.d) : String(v.v ?? '');
    return `<span class="hub-num hub-shared" title="The project's: set on ${hubEsc(hubName(hubBaseRec(hubRec(b.inst).base)))}">${hubEsc(txt)}</span>`;
  }
  if (hubPhiMix(p)) return `<span class="hub-num">${hubFmt(v.v, 3)}</span><button type="button" class="linkish hub-mixgo" data-hubgonav="mix" title="The batch's recipe on Mixing sets it">Mixing recipe</button>`;
  if (b.t === 'card' && v.def) { const [attr, pre] = HUB_ATTR[b.card]; return `<span class="hub-num">${hubFmt(v.v, -4)}</span><small class="hub-at">at 20 °C</small><span class="hub-tdef" title="Defined in temperature: open the row">${v.def.kind === 'table' ? `table, ${v.def.x.length} points` : 'f(T)'}</span><input type="number" id="${pre}_${b.k}" data-${attr}="${b.k}" data-hubp="${p.id}" value="${v.v}" hidden disabled>`; }
  if (b.t === 'card') { const [attr, pre] = HUB_ATTR[b.card]; return `<input type="number" id="${pre}_${b.k}" data-${attr}="${b.k}" data-hubp="${p.id}" min="${v.lo}" max="${v.hi}" step="${v.step}" value="${v.v ?? ''}"${v.v == null ? ' placeholder="—"' : ''} aria-label="${hubEsc(p.l)}">`; }
  if (b.t === 'inp') return `<input type="number" id="hubin_${b.k}" data-hubp="${p.id}" data-help="in.${b.k}" min="${v.lo}" max="${v.hi}" step="${v.exact ? 'any' : v.step}" value="${v.exact ? +(+v.v).toPrecision(6) : (+v.v).toFixed(v.d)}" aria-label="${hubEsc(p.l)}">`;
  if (b.t === 'cfdg') return `<input type="number" id="hubg_${b.k}" data-hubp="${p.id}" min="${v.lo}" max="${v.hi}" step="${v.step}" value="${v.v}" aria-label="${hubEsc(p.l)}">`;
  if (b.t === 'peel') return `<input type="number" id="hubpl_${b.k}" data-hubp="${p.id}" data-help="oven.${b.k}" min="${v.lo}" max="${v.hi}" step="${v.step}" value="${v.v}" aria-label="${hubEsc(p.l)}">`;
  if (b.t === 'model') return `<select id="matModel" class="hub-sel" aria-label="Flow law">${Object.entries(RHEO_MODELS).map(([k, m]) => `<option value="${k}"${k === CFDG.model ? ' selected' : ''}>${m.l}</option>`).join('')}</select>`;
  if (b.t === 'orModel') return `<select id="matOrModel" class="hub-sel" aria-label="Alignment model"${MAT.orient.on ? '' : ' disabled'}>${Object.entries(OR_MODELS).map(([k, l]) => `<option value="${k}"${k === MAT.orient.model ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  if (b.t === 'switch') return `<label class="hub-switch"><input type="checkbox" id="${b.id}"${b.get() ? ' checked' : ''}><span>${b.get() ? 'On' : 'Off'}</span></label>`;
  if (b.t === 'fibreSel') return `<select id="hubFibre" class="hub-sel" aria-label="The fibre's test report">${Object.entries(FIBRES).map(([k, f]) => `<option value="${k}"${k === CFDG.fibre ? ' selected' : ''}>${f.l}</option>`).join('')}</select>`;
  if (v.tensor) return `<span class="hub-ten${v.bad ? ' hub-badv' : ''}">${hubEsc(v.v)}</span>`;
  return `<span class="hub-num">${typeof v.v === 'number' ? hubFmt(v.v, v.d) : hubEsc(v.v)}</span>${v.at ? `<small class="hub-at">at ${v.at}</small>` : ''}`;
}
function hubRowHTML(r, p) {
  const v = hubVal(p), off = hubOff(p), open = HUB.open === p.id, b = p.b, ch = hubChecks(r).filter(c => c.prop === p.id);
  const lv = ch.some(c => c.level === 'error') ? 'bad' : ch.length ? 'warn' : '';
  // (the definition method: a choice where a solver takes the property in temperature, else the method it has)
  const kind = !v.def ? 'const' : v.def.kind === 'table' ? 'table' : 'expr';
  const methodCell = hubTdep(p) ? `<select class="hub-sel hub-msel" id="hubm_${p.id}" data-hubmethod="${p.id}" aria-label="${hubEsc(p.l)}: its definition method">${[['const', 'Constant'], ['table', 'Table in T'], ['expr', 'Equation in T']].map(([k, t]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${t}</option>`).join('')}</select>`
    : `<span class="hub-meth">${hubEsc(hubMethod(p, v))}</span>`;
  const srcCell = hubPhiMix(p) ? '<span class="hub-srct">the Mixing recipe</span>' : b.t === 'card' ? `<input type="text" class="mat-src hub-src" id="${HUB_ATTR[b.card][1]}s_${b.k}" data-${HUB_ATTR[b.card][0]}="${b.k}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: source">`
    : b.t === 'inp' ? `<input type="text" class="hub-src" id="hubins_${b.k}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: source">`
    : `<span class="hub-srct" title="${hubEsc(v.src)}">${hubEsc(v.src)}</span>`;
  const row = `<tr class="hub-row${off ? ' hub-off' : ''}${open ? ' open' : ''}${p.sub ? ' hub-subrow' : ''}${lv ? ' hub-r' + lv : ''}" data-hubrow="${p.id}"${b.t === 'card' ? ` data-${HUB_ATTR[b.card][0]}="${b.k}"` : ''}>
    <th scope="row"><button type="button" class="hub-pname" id="hubop_${p.id}" data-hubopen="${p.id}" aria-expanded="${open}"><svg class="hub-car" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>${hubEsc(p.l)}${lv ? `<i class="hub-dot hub-${lv}"></i>` : ''}</button>${off ? `<small class="hub-offn">${hubEsc(off)}</small>` : p.note ? `<small class="hub-offn">${hubEsc(p.note)}</small>` : ''}</th>
    <td class="hub-sym">${hubSym(p.sym)}</td><td>${methodCell}</td><td class="hub-c-v">${hubValCell(p, v)}</td><td class="hub-u">${hubEsc(v.u)}</td><td class="hub-c-rng">${hubEsc(hubValid(p, v))}</td><td class="hub-c-src">${srcCell}</td></tr>`;
  return row + (open ? `<tr class="hub-detail"><td colspan="7">${hubDetailHTML(r, p, v)}</td></tr>` : '');
}

// a property's definition (its row opened)
function hubDetailHTML(r, p, v) {
  const b = p.b, used = p.phys.filter(k => hubPhys(k));
  const usedHTML = used.length ? `<div class="hub-d-used"><span class="hub-d-l">Read by</span>${used.map(k => `<button type="button" class="chip hub-ph" data-hubgo="${k}">${hubPhys(k).l}</button>`).join('')}</div>` : '<div class="hub-d-used"><span class="hub-d-l">Read by</span><span class="hub-muted">no solver</span></div>';
  const kv = rows => `<dl class="hub-kv">${rows.filter(Boolean).map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl>`;
  const helpKey = b.t === 'card' ? `${{ slurry: 'mat', rheo: 'matr', orient: 'mato', dry: 'matd', film: 'matf', furn: 'matu', lib: 'matl' }[b.card]}.${b.k}` : b.t === 'inp' ? `in.${b.k}` : b.t === 'peel' ? `oven.${b.k}` : null;
  const help = helpKey && typeof helpOf === 'function' ? helpOf(helpKey) : null;
  const si = hubSI(p, v);
  if (['card', 'inp', 'cfdg', 'peel'].includes(b.t)) {
    if (hubTdep(p)) return `<div class="hub-d">${hubDefHTML(p, v)}${kv([
      help ? ['What it is', hubEsc(help.d)] : null,
      ['Stage card', `the ${HUB_CARD_T[b.card]} (its Defaults: the Defaults menu above)`],
      ['Valid range', hubEsc(hubValid(p, v))],
      ['Data source', `<input type="text" class="hub-src hub-src-d" id="hubsrc_${p.id}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: data source">`],
    ])}${usedHTML}</div>`;
    const mixRow = b.t === 'card' && b.card === 'slurry' && b.k === 'phi' && !b.inst
      ? ['Its value', `<label class="hub-switch"><input type="checkbox" id="hubPhiMix"${MAT.mixLink ? ' checked' : ''}><span>${MAT.mixLink ? 'From the Mixing recipe: the mixed slurry goes straight to the coater' : 'Typed here (on: from the Mixing recipe)'}</span></label>`] : null;
    return `<div class="hub-d">${kv([
      ['Method', hubPhiMix(p) ? 'From the Mixing recipe' : 'Constant'],
      mixRow,
      help ? ['What it is', hubEsc(help.d)] : null,
      b.t === 'card' ? ['Stage card', `the ${HUB_CARD_T[b.card]} (its Defaults: the Defaults menu above)`] : null,
      si ? ['In SI', si] : null,
      ['Valid range', `${v.lo} to ${v.hi} ${hubEsc(v.u)}`],
      b.t === 'inp' ? ['Also on', 'the inputs bar (left), the same value'] : b.t === 'cfdg' ? ['Also on', 'Coating › 2D, the fibre (the same value)'] : b.t === 'peel' ? ['Also on', 'Pre heat treatment, its inputs (the same value)'] : null,
      hubPhiMix(p) ? ['Data source', 'the Mixing recipe'] : b.t === 'card' || b.t === 'inp' ? ['Data source', `<input type="text" class="hub-src hub-src-d" id="hubsrc_${p.id}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: data source">`] : ['Data source', hubEsc(v.src)],
    ])}${usedHTML}</div>`;
  }
  if (b.t === 'calc') return `<div class="hub-d">${kv([['Method', 'Calculated'], ['How', hubEsc(v.src)], si ? ['In SI', si] : null])}${usedHTML}</div>`;
  if (b.t === 'const') { const c = HUB_CONST[b.id]; return `<div class="hub-d">${kv([['Method', 'Constant'], ['Value', `${hubFmt(c.v, -6)} ${hubEsc(c.u)}`], ['Data source', hubEsc(c.src)], ['In the code', `<code>${hubEsc(c.solver)}</code>`]])}${usedHTML}</div>`; }
  if (b.t === 'law') {
    const L = HUB_LAW[b.id], law = ML_LAWS[L.q.law];
    return `<div class="hub-d hub-d-plot"><div>${kv([['Method', `Equation in T: ${hubEsc(law.formula)}`], [hubLawIsList(b.id) ? 'Coefficients' : 'Parameters', hubLawParamsHTML(b.id, 'd')],
      ['Valid range', `${L.T[0]} to ${L.T[1]} °C${L.p ? ', at 1 atm' : ''}`], ['Data source', hubEsc(L.src)], ['In the code', `<code>${hubEsc(L.solver)}</code>, checked against it`]])}${usedHTML}</div>
      <figure class="hub-fig"><canvas id="hubDetCv" role="img" aria-label="${hubEsc(p.l)} against temperature"></canvas></figure></div>`;
  }
  if (b.t === 'tensor') return `<div class="hub-d">${hubTensorHTML(p)}${usedHTML}</div>`;
  if (b.t === 'stiff' || b.t === 'stiffWeb') return `<div class="hub-d">${hubStiffHTML(b.t === 'stiffWeb' ? 'web' : 'go')}${usedHTML}</div>`;
  if (b.t === 'model') return `<div class="hub-d">${kv([['Law', hubEsc(ML_RHEO[CFDG.model].formula)], ['Parameters', 'the rows below; those of another law are kept, not used'], ['Its plot', '<button type="button" class="hub-link" data-hubtab="models">Constitutive Models</button>']])}${usedHTML}</div>`;
  if (b.t === 'measured') return `<div class="hub-d">${kv([['Method', 'Measured point'], ['Value', `${RHEO_MEASURED.mu} Pa·s at ${RHEO_MEASURED.gd} 1/s`], ['The law there', `${hubFmt(P.mu, -4)} Pa·s (${hubFmt((P.mu - RHEO_MEASURED.mu) / RHEO_MEASURED.mu * 100, 1)} %)`], ['Fit a flow curve', 'Measured data: import a rheometer test and use its fit']])}</div>`;
  return `<div class="hub-d">${kv([['Method', hubEsc(hubMethod(p, v))], ['Data source', hubEsc(v.src)]])}${usedHTML}</div>`;
}
/**
 * A property a solver can take in temperature (MH-4b): its definition -- a constant, a table in T (linear or monotone
 * cubic between its points; outside them held at its ends, carried on, or refused), or an expression in T (kelvin) --
 * edited here, checked (matlib's checks; positive over its range), plotted; the solvers that evaluate it named.
 */
/** A built-in law whose parameters are a list of coefficients (IAPWS-IF97's n₁…n₁₀, Butland and Maddison's a…f). */
const hubLawIsList = id => Object.values(HUB_LAW[id].q.params).some(Array.isArray);
/** A built-in law's parameters, each an input (MC-1b): taken when the law still holds over its range, else said why. */
function hubLawParamsHTML(id, at) {
  const L = HUB_LAW[id], law = ML_LAWS[L.q.law], cur = hubLawParams(id), edited = !!(MAT.law || {})[id];
  const box = (k, i, x, lab, unit) => `<label class="hub-lp"><span>${lab}${unit ? ` <small>${hubEsc(unit)}</small>` : ''}</span><input type="number" step="any" id="hublp_${at}_${id}_${k}${i ?? ''}" data-hublawp="${id}|${k}|${i ?? ''}" value="${+x}" aria-label="${hubEsc(hubLawName(id))}: ${lab.replace(/<[^>]+>/g, '')}"></label>`;
  const names = { n: i => `n<sub>${i + 1}</sub>`, c: i => 'abcdef'[i] };
  const boxes = Object.entries(cur).map(([k, x]) => (Array.isArray(x) ? x.map((q, i) => box(k, i, q, (names[k] || (j => `${k}${j + 1}`))(i), '')).join('') : box(k, null, x, hubEsc(k), law.params[k] || ''))).join('');
  return `<div class="hub-lps">${boxes}</div><p class="hub-err" id="hubLawErr_${at}_${id}" hidden></p>${edited ? `<button type="button" class="linkish hub-lp-reset" data-hublawreset="${id}">Back to the law's own values</button>` : ''}`;
}
function hubDefHTML(p, v) {
  const q = v.def, kind = !q ? 'const' : q.kind === 'table' ? 'table' : 'expr', [solv, range] = hubTdep(p), names = solv.map(k => hubPhys(k).l).join(' and ');
  const seg = `<span class="seg" role="tablist" aria-label="${hubEsc(p.l)}: its definition">${[['const', 'Constant'], ['table', 'Table in T'], ['expr', 'Equation in T']].map(([k, t]) => `<button type="button" role="tab" id="hubdk_${p.id}_${k}" data-hubdefkind="${p.id}|${k}" aria-selected="${k === kind}">${t}</button>`).join('')}</span>`;
  let body = '';
  if (kind === 'const') body = `<p class="hub-muted">${hubFmt(v.v, -6)} ${hubEsc(v.u)} at every temperature. A table or an equation in T makes ${names} take it at each point's temperature.</p>`;
  else if (kind === 'table') body = `<div class="hub-dt-wrap"><table class="hub-dt" aria-label="${hubEsc(p.l)} against temperature"><thead><tr><th scope="col">T <small>°C</small></th><th scope="col">${hubSym(p.sym)} <small>${hubEsc(v.u)}</small></th><th></th></tr></thead><tbody>
      ${q.x.map((x, i) => `<tr><td><input type="number" step="any" id="hubdt_${p.id}_x${i}" data-hubdt="${p.id}" data-c="x" value="${+(x - 273.15).toFixed(6)}" aria-label="Point ${i + 1}: temperature"></td><td><input type="number" step="any" id="hubdt_${p.id}_y${i}" data-hubdt="${p.id}" data-c="y" value="${q.y[i]}" aria-label="Point ${i + 1}: value"></td><td>${q.x.length > 2 ? `<button type="button" class="hub-link" id="hubdtdel_${p.id}_${i}" data-hubdtdel="${p.id}|${i}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="hub-dt-ctl"><span class="hub-dt-btns"><button type="button" class="btn btn-secondary btn-sm" id="hubdtadd_${p.id}" data-hubdtadd="${p.id}">${uiIco('plus')}Add a point</button><button type="button" class="btn btn-secondary btn-sm" id="hubdtcsv_${p.id}" data-hubdtcsv="${p.id}">${uiIco('upload')}Load CSV…</button></span>
        <label>Between points <select class="hub-sel" id="hubdto_${p.id}_interp" data-hubdtopt="${p.id}" data-o="interp"><option value="linear"${q.interp !== 'pchip' ? ' selected' : ''}>Linear</option><option value="pchip"${q.interp === 'pchip' ? ' selected' : ''}>Monotone cubic</option></select></label>
        <label>Outside them <select class="hub-sel" id="hubdto_${p.id}_extrap" data-hubdtopt="${p.id}" data-o="extrap">${[['clamp', 'Held at the end values'], ['extrapolate', 'Carried on'], ['error', 'Refused (the solve stops)']].map(([k, t]) => `<option value="${k}"${(q.extrap || 'error') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div></div>`;
  else body = `<label class="hub-expr-l">${hubSym(p.sym)}(T) = <input type="text" class="hub-expr" id="hubdexpr_${p.id}" data-hubdexpr="${p.id}" value="${hubEsc(q.src)}" spellcheck="false" aria-label="${hubEsc(p.l)} as an equation in T"></label>
      <p class="hub-muted hub-small">T in kelvin; + − × (*) ÷ (/) ^, exp, log, sqrt, pow, min, max, abs, pi. In ${hubEsc(v.u)}.</p>`;
  return `<div class="hub-def"><div class="hub-def-h"><span class="hub-d-l">Definition</span>${seg}</div>${body}<p class="hub-err" id="hubDefErr_${p.id}" hidden></p>
    <figure class="hub-fig hub-def-fig"><canvas id="hubDefCv_${p.id}" data-hubdefplot="${p.id}" role="img" aria-label="${hubEsc(p.l)} against temperature"></canvas></figure>
    <p class="hub-muted hub-small">${names} take it at each point's temperature${kind === 'const' ? '' : `; the others its value at 20 °C, ${hubFmt(v.v, -4)} ${hubEsc(v.u)}`}. Checked positive from ${range[0]} to ${range[1]} °C.</p></div>`;
}
/** A value in SI (its unit parsed: the factor and the base units), or '' when the unit is a name (a share, a ratio). */
function hubSI(p, v) {
  if (typeof v.v !== 'number' || !v.u) return '';
  const u = p.b.t === 'inp' && p.b.k === 'K' ? null : v.u.replace('m³/m²·s', 'm³/(m²·s)');
  try {
    const q = u ? mlParseUnit(u) : mlRheoKUnit(P.n);
    if (q.f === 1 && !q.off) return '';
    return `${hubFmt(v.v * q.f + q.off, -5)} ${mlDimStr(q.dim).replace(/\^(-?\d+)/g, '<sup>$1</sup>').replace(/·/g, '·')}`;
  } catch (e) { return ''; }
}
/** A second-order tensor: its matrix in the material frame, eigenvalues, check, and what each solver takes of it. */
function hubTensorHTML(p) {
  const V = hubT2(p), M = mlV2M(V), t = hubTensorOf(p), eig = mlEig3(V), ok = !mlT2Check(V).length, u = p.b.u, f = x => hubFmt(x, -4);
  const proj = p.b.what === 'heat'
    ? [['Drying (1D through the film)', `k₃₃ = ${f(t.axial)} ${u}`], ['Pre heat and furnace multiphysics, 2D (a section along x and the thickness)', `diag(k₁₁, k₃₃) = ${f(t.trans)}, ${f(t.axial)} ${u}`], ['… 3D', `diag(k₁₁, k₂₂, k₃₃) = ${f(t.trans)}, ${f(t.trans)}, ${f(t.axial)} ${u}`]]
    : [['Drying (1D through the skin)', `K₃₃ = ${f(t.axial)} ${u}`], ['Pre heat: pressed stack (in the plane)', `K₁₁ = ${f(t.trans)} ${u}`], ['Pre heat multiphysics 2D, 3D', `diag(K₁₁, (K₂₂,) K₃₃): ${f(t.trans)}, ${f(t.axial)} ${u}`]];
  return `<div class="hub-mat-wrap"><div><div class="hub-mlab">In the material frame (1, 2 in the plane; 3 the normal), ${hubEsc(u)}</div>
    <table class="hub-matrix" aria-label="The tensor's components">${M.map(rw => `<tr>${rw.map(x => `<td>${x === 0 ? '0' : f(x)}</td>`).join('')}</tr>`).join('')}</table></div>
    <dl class="hub-kv">${[['Form', 'Transversely isotropic: K = k₁₁ I + (k₃₃ − k₁₁) n nᵀ, n the normal'], ['Eigenvalues', eig.map(f).join(', ')], ['Anisotropy', `k₁₁ / k₃₃ = ${hubFmt(t.trans / t.axial, -3)}`],
      ['Check', ok ? '<span class="hub-ok">positive definite: it flows down its gradient</span>' : `<span class="hub-bad">${hubEsc(mlT2Check(V)[0].msg)}</span>`], ...proj].map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')}</dl></div>
    <p class="hub-muted hub-small">Rotated into a part's frame (K' = Q K Qᵀ), the solvers take its full block: mp-core.js assembles K's off-diagonal terms (MH-4); here the film's frame is the stage's.</p>`;
}
/** A stiffness: the 6 × 6 (Voigt, engineering shear) in GPa, its check, the plane-strain block Peel and wind's FEM uses. */
function hubStiffHTML(which) {
  const C = hubStiff(which), ok = !mlCCheck(C).length, g = x => (Math.abs(x) < 1e-6 ? '0' : hubFmt(x / 1e9, -4)), L = ['11', '22', '33', '23', '13', '12'];
  const D = [[C[0][0], C[0][2], 0], [C[0][2], C[2][2], 0], [0, 0, C[4][4]]];
  return `<div class="hub-mat-wrap"><div><div class="hub-mlab">C in the material frame, GPa (Voigt: 11 22 33 23 13 12)</div>
    <table class="hub-matrix hub-m6" aria-label="The stiffness matrix"><tr><th></th>${L.map(l => `<th>${l}</th>`).join('')}</tr>${C.map((rw, i) => `<tr><th>${L[i]}</th>${Array.from(rw).map(x => `<td>${g(x)}</td>`).join('')}</tr>`).join('')}</table></div>
    <div><div class="hub-mlab">Peel and wind's plane strain (x along the line, z the normal), GPa</div>
    <table class="hub-matrix" aria-label="The plane-strain block">${D.map(rw => `<tr>${rw.map(x => `<td>${g(x)}</td>`).join('')}</tr>`).join('')}</table>
    <dl class="hub-kv"><div><dt>Check</dt><dd>${ok ? '<span class="hub-ok">symmetric, positive definite (Cholesky): it stores energy under any strain</span>' : `<span class="hub-bad">${hubEsc(mlCCheck(C)[0].msg)}</span>`}</dd></div>
      <div><dt>Form</dt><dd>transversely isotropic: E₁ = E₂, ν₁₂, E₃, ν₁₃ (ε₃ = −ν₁₃ σ₁ / E₁), G₁₃; G₁₂ = E₁ / (2 (1 + ν₁₂))</dd></div></dl></div></div>`;
}

// ---- models and plots ----
const HUB_MODELS = {
  flow: ['Flow law', 'η(γ̇) of the law the solvers use, against the measured point and the gap\'s shear rate'],
  struct: ['Structure (thixotropy)', 'steady structure λ(γ̇) = 1 / (1 + γ̇/γ̇_c): broken down by shear, rebuilt at rest'],
  align: ['Liquid crystal order at rest', 'Maier–Saupe: the order parameter at rest against the ordering strength U'],
  water: ['Water against temperature', 'the drying\'s laws (drying.js)'],
  air: ['Air against temperature', 'the drying\'s laws (drying.js), at 1 atm'],
  argon: ['Argon against temperature', 'the furnace multiphysics\' laws (furnace-mp.js), at 1 atm'],
  gab: ['Sorption isotherm (GAB)', 'X(a) = X_m C K a / ((1 − K a)(1 − K a + C K a)), C(T) = C exp(H_c/R (1/T − 1/T₀)): GO\'s own water at a humidity and temperature'],
  kT: ['Thermal conductivity tensor', ''],
  C: ['Stiffness', ''],
  soft: ['Softening with water', 'E₁(X) = E₁ / (1 + X / X_h): as Peel and wind takes it'],
  conv: ['Conversion in the furnace', 'heated at 10 °C/min: the stages\' distributed-activation-energy kinetics (furnace.js) — mass kept, C/O, graphitized share'],
  gcp: ['Graphite\'s heat capacity', 'Butland and Maddison (1973)'],
  webC: ['Stiffness', ''],
};
function hubModelsHTML(r) {
  return r.models.map(k => {
    const [t, s] = HUB_MODELS[k];
    let body = '';
    if (k === 'kT') body = hubTensorHTML(hubProps(r).find(p => p.id === 'k'));
    else if (k === 'C') body = hubStiffHTML('go');
    else if (k === 'webC') body = hubStiffHTML('web');
    else if (k === 'water' || k === 'air' || k === 'argon') body = `<div class="hub-plots">${hubLawSet(k).map(([id, l]) => `<figure class="hub-fig"><figcaption>${l}</figcaption><canvas data-hubplot="${k}:${id}" role="img" aria-label="${hubEsc(l)}"></canvas></figure>`).join('')}</div>`;
    else if (k === 'flow') body = `<div class="hub-plots hub-plots-2"><figure class="hub-fig"><figcaption>Viscosity η(γ̇)</figcaption><canvas data-hubplot="flow" role="img" aria-label="The slurry's viscosity against its shear rate"></canvas></figure>
        <figure class="hub-fig"><figcaption>Shear stress τ(γ̇): the flow curve</figcaption><canvas data-hubplot="flowTau" role="img" aria-label="The slurry's shear stress against its shear rate"></canvas></figure></div>
        <div class="pane-legend" data-hublg="flow"></div><div class="hub-rheo">${rheoReadoutHTML()}</div>`;
    else body = `<figure class="hub-fig hub-fig-w"><canvas data-hubplot="${k}" role="img" aria-label="${hubEsc(t)}"></canvas><div class="pane-legend" data-hublg="${k}"></div></figure>${k === 'conv' ? '<div data-hubconv></div>' : ''}`;
    return `<section class="hub-model"><h3>${t}</h3>${s ? `<p class="hub-muted">${hubEsc(s)}</p>` : ''}${body}</section>`;
  }).join('');
}
const hubLawSet = k => (k === 'water' ? [['waterMu', 'Viscosity μ (Pa·s)'], ['waterPsat', 'Saturation pressure p_sat (kPa)'], ['waterL', 'Latent heat L (MJ/kg)']]
  : k === 'air' ? [['airMu', 'Viscosity μ (µPa·s)'], ['airK', 'Thermal conductivity k (W/(m·K))'], ['airRho', 'Density ρ (kg/m³)'], ['airDv', 'Vapour diffusivity D_v (×10⁻⁵ m²/s)']]
  : [['arMu', 'Viscosity μ (µPa·s)'], ['arK', 'Thermal conductivity k (W/(m·K))'], ['arRho', 'Density ρ (kg/m³)']]);
const HUB_LAW_SCALE = { waterPsat: 1e-3, waterL: 1e-6, airMu: 1e6, airDv: 1e5, arMu: 1e6 };
/** A law's curve over its range (°C), scaled for its plot; argon's k is μ c_p / Pr. */
function hubLawCurve(id, n = 120) {
  const L = HUB_LAW[id === 'arK' ? 'arMu' : id], [a, b] = L.T, s = HUB_LAW_SCALE[id] || 1, p = [];
  for (let i = 0; i <= n; i++) { const T = a + (b - a) * i / n; let y = hubLawAt(id === 'arK' ? 'arMu' : id, T); if (id === 'arK') y *= HUB_CONST.arCp.v / HUB_CONST.arPr.v; p.push([T, y * s]); }
  return p;
}
function hubLine(cv, pts, { xl, yl, x0, x1, logx, logy, marks = [], extra = [], aspect = 0.5, yf, xf, hl = [] }) {
  if (!cv || cv.offsetParent === null) return;
  const ys = [...pts, ...extra.flatMap(s => s.p)].map(q => q[1]).filter(Number.isFinite);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (logy) { y0 = Math.floor(y0); y1 = Math.ceil(y1); if (y1 <= y0) y1 = y0 + 1; }
  else { const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 1; y0 = Math.max(y0 >= 0 ? 0 : -Infinity, y0 - pad); y1 += pad; }
  const xt = logx ? Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i) : niceTicks(x0, x1, 5), yt = logy ? Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i) : niceTicks(y0, y1, 4);
  const dec = v => { const k = Math.round(v); return k >= 4 || k <= -3 ? `1e${k}` : String(+Math.pow(10, k).toPrecision(1)); };
  const nf = v => String(+v.toPrecision(4));
  plotChart(cv, aspect, { x0, x1, y0: yt[0] <= y0 ? yt[0] : y0, y1: yt[yt.length - 1] >= y1 ? yt[yt.length - 1] : y1, xticks: xt, yticks: yt, xf: xf || (logx ? dec : nf), yf: yf || (logy ? dec : nf), xl, yl,
    vl: marks, hl, s: [{ p: pts, c: cssVar('--go-film'), w: 2.2 }, ...extra] });
}
/** The models' plots (drawn once their canvases are laid out). */
function hubDrawModels(r) {
  const L10 = Math.log10, acc = cssVar('--accent'), mut = cssVar('--muted');
  view.querySelectorAll('[data-hubplot]').forEach(cv => {
    const k = cv.dataset.hubplot, lg = view.querySelector(`[data-hublg="${k}"]`), setLg = items => { if (lg) lg.innerHTML = oneDLegend(items); };
    if (k.includes(':')) { const [, id] = k.split(':'), L = HUB_LAW[id === 'arK' ? 'arMu' : id]; hubLine(cv, hubLawCurve(id), { xl: 'temperature (°C)', yl: '', x0: L.T[0], x1: L.T[1], aspect: 0.62 }); return; }
    if (k === 'flow' || k === 'flowTau') {
      const g = procSlurryGap(), p = [], tau = k === 'flowTau';
      for (let i = 0; i <= 160; i++) { const lg10 = -2 + 6 * i / 160, gd = Math.pow(10, lg10), mu = muLaw(gd, P.mu, g.ty, g.n, g.x); if (mu > 0 && Number.isFinite(mu)) p.push([lg10, L10(tau ? mu * gd : mu)]); }
      const m = RHEO_MEASURED, pt = [[L10(m.gd), L10(tau ? m.mu * m.gd : m.mu)]];
      hubLine(cv, p, { xl: 'shear rate γ̇ (1/s)', yl: tau ? 'shear stress τ (Pa)' : 'viscosity η (Pa·s)', x0: -2, x1: 4, logx: true, logy: true, aspect: 0.62,
        extra: [{ p: pt, c: cssVar('--ink'), line: false, dots: true }], marks: [{ x: L10(g.gd), c: mut, t: '' }],
        hl: tau && g.ty > 0 ? [{ y: L10(g.ty), c: acc, t: `τy ${hubFmt(g.ty, -3)} Pa`, left: true }] : [] });
      if (!tau) setLg([[`${RHEO_MODELS[CFDG.model].l}: the law the solvers use`, cssVar('--go-film')], [`measured: ${m.mu} Pa·s at ${m.gd} 1/s`, cssVar('--ink'), 'dot'], [`the gap: ${hubFmt(g.gd, -3)} 1/s (U/H), η ${hubFmt(g.mu, -3)} Pa·s`, mut, 'dash'], ...(g.ty > 0 ? [['the yield stress', acc, 'dash']] : [])]);
    } else if (k === 'struct') {
      const gc = MAT.rheo.gdc.v, p = [];
      for (let i = 0; i <= 160; i++) { const lg10 = -3 + 7 * i / 160; p.push([lg10, 1 / (1 + Math.pow(10, lg10) / gc)]); }
      hubLine(cv, p, { xl: 'shear rate γ̇ (1/s)', yl: 'steady structure λ', x0: -3, x1: 4, logx: true, aspect: 0.36, marks: [{ x: L10(gc), c: mut, t: 'γ̇_c' }] });
      setLg([[MAT.rheo.structOn ? 'λ = 1 / (1 + γ̇/γ̇_c), the model on' : 'λ = 1 / (1 + γ̇/γ̇_c) (the model is off)', cssVar('--go-film')]]);
    } else if (k === 'align') {
      const p = []; for (let i = 0; i <= 120; i++) { const U = 20 * i / 120; p.push([U, orRestS(U)]); }
      hubLine(cv, p, { xl: 'ordering strength U', yl: 'order at rest S₀', x0: 0, x1: 20, aspect: 0.36, marks: [{ x: MAT.orient.U.v, c: acc, t: `U ${MAT.orient.U.v}` }] });
      setLg([['S₀(U), Maier–Saupe', cssVar('--go-film')], [`this slurry: S₀ ${hubFmt(orRestS(MAT.orient.U.v), 3)}`, acc, 'dash']]);
    } else if (k === 'gab') {
      // (GO's own water at the room's temperature, and at the pre heat's: warm GO holds less at the same humidity)
      const g = matGab(), Tr = MAT.dry.Troom.v, Tp = OVEN.peel.dryT, p = [], pH = [];
      for (let i = 0; i <= 95; i++) { p.push([i, drGAB(i / 100, g, Tr) * 100]); pH.push([i, drGAB(i / 100, g, Tp) * 100]); }
      // (the pre heat's air: the room's heated -- its humidity there, a = RH psat(T_room)/psat(T))
      const zs = [...new Set(OVEN.zones.map(z => z.rh))], heat = cssVar('--heat') || '#e8590c', aPre = MAT.dry.rhRoom.v * drPsat(Tr) / drPsat(Tp), pores = cssVar('--graphite');
      hubLine(cv, p, { xl: 'relative humidity (%)', yl: 'water held X (% of its mass)', x0: 0, x1: 95, aspect: 0.36, extra: [{ p: pH, c: heat, w: 2 }], marks: [{ x: MAT.dry.rhRoom.v, c: acc, t: 'room' }, { x: aPre, c: heat, t: 'pre heat' }, ...zs.map(rh => ({ x: rh, c: mut, t: '' }))], hl: [{ y: hubXcap() * 100, c: pores, t: 'the drying\'s pores' }] });
      setLg([[`X(a) at ${Tr} °C, GAB`, cssVar('--go-film')], [`at ${Tp} °C`, heat], [`the room: ${MAT.dry.rhRoom.v} %`, acc, 'dash'], [`the pre heat's air: ${aPre.toFixed(1)} % at ${Tp} °C`, heat, 'dash'], [`the oven's zones: ${zs.join(', ')} %`, mut, 'dash'], ['the most the drying keeps on the web (its pores)', pores, 'dash']]);
    } else if (k === 'soft') {
      const Xc = matRoomWater(), Xt = Math.max(Xc, MAT.film.Xh.v) * 1.2, p = []; for (let i = 0; i <= 80; i++) { const X = Xt * i / 80; p.push([X, MAT.film.Ep.v / (1 + X / MAT.film.Xh.v)]); }
      hubLine(cv, p, { xl: 'water X (kg/kg)', yl: 'E₁ (GPa)', x0: 0, x1: Xt, aspect: 0.36, marks: [{ x: MAT.film.Xh.v, c: mut, t: 'X_h' }, { x: Xc, c: acc, t: '' }] });
      setLg([['E₁(X)', cssVar('--go-film')], [`X_h ${MAT.film.Xh.v}: half`, mut, 'dash'], [`in the room: ${hubFmt(Xc, 3)}`, acc, 'dash']]);
    } else if (k === 'gcp') {
      hubLine(cv, hubLawCurve('gCp'), { xl: 'temperature (°C)', yl: 'c_p (J/(kg·K))', x0: 20, x1: 3000, aspect: 0.36 });
      setLg([['c_p(T), Butland–Maddison', cssVar('--go-film')]]);
    } else if (k === 'conv') {
      const c = hubConvCurve(), sc = cssVar('--accent');
      hubLine(cv, c.mass, { xl: 'temperature (°C), heated at 10 °C/min', yl: 'mass kept (% of the dry GO) · graphitized (%)', x0: 25, x1: 3000, aspect: 0.42, extra: [{ p: c.graph, c: sc, w: 1.8, dash: [6, 4] }] });
      setLg([['mass kept', cssVar('--go-film')], ['graphitized', sc, 'dash']]);
      const box = view.querySelector('[data-hubconv]');
      if (box) box.innerHTML = `<table class="cfd-table hub-conv"><thead><tr><th scope="col">Stage</th><th scope="col">Peak at 10 °C/min</th><th scope="col">Spread</th><th scope="col">Its share</th><th scope="col">Mass it takes</th></tr></thead><tbody>${c.rows.map(q => `<tr><th scope="row">${q[0]}</th><td>${q[1]}</td><td>${q[2]}</td><td>${q[3]}</td><td>${q[4]}</td></tr>`).join('')}</tbody></table>`;
    }
  });
}
/** The film heated at 10 °C/min from 25 to 3000 °C, with the Furnace card's stages (furnace.js: fuStage, fuAdvance, fuChem). */
function hubConvCurve() {
  const f = MAT.furn, key = JSON.stringify([MAT.slurry.co.v, ...['hc', 's1', 'c1CO2', 'c1CO', 's2', 'c2CO', 'T1', 'w1', 'T2', 'w2', 'T3', 'w3', 'Tg', 'wg'].map(k => f[k].v)]);
  if (HUB.conv && HUB.conv.key === key) return HUB.conv;
  const ch = fuChem({ co: MAT.slurry.co.v, hc: f.hc.v, s1: f.s1.v, c1CO2: f.c1CO2.v, c1CO: f.c1CO.v, s2: f.s2.v, c2CO: f.c2CO.v });
  const st = [fuStage({ Tp: f.T1.v, sig: f.w1.v * 1e3, nodes: 61 }), fuStage({ Tp: f.T2.v, sig: f.w2.v * 1e3, nodes: 61 }), fuStage({ Tp: f.T3.v, sig: f.w3.v * 1e3, nodes: 61 })], gs = fuStage({ Tp: f.Tg.v, sig: f.wg.v * 1e3, nodes: 61 });
  const mass = [], graph = [], dT = 5, dt = dT / (10 / 60);
  for (let T = 25; T <= 3000; T += dT) {
    if (T > 25) { for (const s of st) fuAdvance(s, T - dT + FU_K0, T + FU_K0, dt); fuAdvance(gs, T - dT + FU_K0, T + FU_K0, dt); }
    mass.push([T, (1 - st.reduce((a, s, i) => a + fuConv(s) * ch.stages[i].mass, 0) / ch.mGO) * 100]); graph.push([T, fuConv(gs) * 100]);
  }
  const rows = [['Labile oxygen', `${f.T1.v} °C`, `${f.w1.v} kJ/mol`, `${(f.s1.v * 100).toFixed(0)} % of its O`, `${(ch.stages[0].mass / ch.mGO * 100).toFixed(1)} %`],
    ['Stable oxygen', `${f.T2.v} °C`, `${f.w2.v} kJ/mol`, `${(f.s2.v * 100).toFixed(0)} % of its O`, `${(ch.stages[1].mass / ch.mGO * 100).toFixed(1)} %`],
    ['The rest of its oxygen and its hydrogen', `${f.T3.v} °C`, `${f.w3.v} kJ/mol`, 'the rest', `${(ch.stages[2].mass / ch.mGO * 100).toFixed(1)} %`],
    ['Graphitization', `${f.Tg.v} °C`, `${f.wg.v} kJ/mol`, '—', '—']];
  HUB.conv = { key, mass, graph, rows };
  return HUB.conv;
}

// ---- measured data ----
function hubMeasured(r) {
  return r.id === 'slurry' || r.id === 'flakes' || r.id === 'gofilm' || r.id === 'gfilm';
}
function hubMeasHTML(r) {
  if (r.id === 'slurry') return rtCardHTML();
  const m = MAT, row = (t, n, go, label) => `<tr><th scope="row">${t}</th><td>${n}</td><td><button type="button" class="btn btn-secondary btn-sm" data-hubgonav="${go}">${label}</button></td></tr>`;
  const rows = r.id === 'flakes' ? [row('SEM images of the flakes\' alignment', `${(m.sem.images || []).length} images · ${(m.sem.tables || []).length} angle tables`, 'flakes', 'Coating › Flakes')]
    : r.id === 'gofilm' ? [row('Temperatures in the oven', `${(m.dryMeas.temps || []).length} tables`, 'dry', 'Drying'), row('At the oven\'s exit (water, thickness)', `${(m.dryMeas.exit || []).length} values`, 'dry', 'Drying'),
      row('Curl', `${m.filmMeas.curl.length}`, 'peel', 'Peel and wind'), row('Cracks', `${m.filmMeas.cracks.length}`, 'peel', 'Peel and wind'), row('Peel force', `${m.filmMeas.peel.length}`, 'peel', 'Peel and wind'), row('Size after drying and the furnace', `${m.filmMeas.size.length}`, 'peel', 'Peel and wind')]
    : [row('Thickness, weight, heat conduction of the graphene film', `${(m.furnMeas.out || []).length} values`, 'gfilm', 'Graphene film')];
  return `<p class="hub-muted">Entered where they are compared with the solvers' results; a fit there sets the values here (marked Fitted, with the data as their source).</p>
    <div class="table-wrap"><table class="cfd-table hub-meas"><thead><tr><th scope="col">Data</th><th scope="col">Entered</th><th scope="col"></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ---- used by ----
function hubUsedHTML(r) {
  const rows = HUB_PHYS.map(ph => [ph, hubProps(r).filter(p => p.phys.includes(ph.k))]).filter(q => q[1].length);
  const unused = hubProps(r).filter(p => !p.phys.length && ['card', 'inp', 'cfdg', 'peel'].includes(p.b.t));
  return `<div class="table-wrap"><table class="cfd-table hub-used"><thead><tr><th scope="col">Solver</th><th scope="col">What it reads from ${hubEsc(hubName(r))}</th><th scope="col"></th></tr></thead><tbody>
    ${rows.map(([ph, ps]) => `<tr><th scope="row">${ph.l}<small>${hubEsc(ph.s)}</small></th><td class="hub-chips">${ps.map(p => `<button type="button" class="chip${hubOff(p) ? ' hub-chip-off' : ''}" data-hubopenp="${p.id}" title="${hubEsc(hubOff(p) || p.l)}">${hubEsc(p.l)}${p.sym ? ` <i>${hubSym(p.sym)}</i>` : ''}</button>`).join('')}</td><td><button type="button" class="btn btn-secondary btn-sm" data-hubgo="${ph.k}">Open</button></td></tr>`).join('')}
    ${unused.length ? `<tr><th scope="row">None<small>shown, not solved with</small></th><td class="hub-chips">${unused.map(p => `<span class="chip hub-chip-off">${hubEsc(p.l)}</span>`).join('')}</td><td></td></tr>` : ''}</tbody></table></div>`;
}

// ---- Overview: the material's identity and metadata ----
function hubOverviewHTML(r) {
  const m = hubMeta(r), used = new Set(hubProps(r).flatMap(p => p.phys)), iface = r.id.startsWith('i-');
  const fld = ([k, l]) => `<div class="hub-of"><label for="hubmeta_${k}">${l}</label>${k === 'notes' || k === 'desc'
    ? `<textarea id="hubmeta_${k}" data-hubmeta="${k}" rows="${k === 'notes' ? 3 : 2}">${hubEsc(m[k])}</textarea>`
    : `<input type="text" id="hubmeta_${k}" data-hubmeta="${k}" value="${hubEsc(m[k])}"${k === 'name' ? ` placeholder="${hubEsc(r.name)}"` : ''}>`}</div>`;
  return `<div class="hub-ov"><section class="hub-ov-id"><h3>Identity</h3><div class="hub-of-grid">${HUB_META_FIELDS.map(fld).join('')}</div></section>
    <section class="hub-ov-at"><h3>In the process</h3><dl class="hub-kv">
      <div><dt>Category</dt><dd>${iface ? 'Interface' : hubEsc(r.cls)}${r.sub ? ` · ${hubEsc(r.sub)}` : ''}</dd></div>
      <div><dt>Where it is</dt><dd>${r.domains.map(hubEsc).join('<br>')}</dd></div>
      <div><dt>Solved by</dt><dd class="hub-chips">${HUB_PHYS.some(q => used.has(q.k)) ? HUB_PHYS.filter(q => used.has(q.k)).map(q => `<button type="button" class="chip hub-ph" data-hubgo="${q.k}">${q.l}</button>`).join('') : '<span class="hub-muted">No solver reads it at present</span>'}</dd></div>
      ${r.inst ? `<div><dt>Copy of</dt><dd><button type="button" class="hub-link" data-hubsel="${r.base}">${hubEsc(hubName(hubBaseRec(r.base)))}</button></dd></div>` : ''}
      <div><dt>Properties</dt><dd>${hubProps(r).length} in ${r.groups.length} groups</dd></div></dl></section></div>`;
}
// ---- Property Functions: each property's equation or table in temperature, plotted ----
function hubFuncsHTML(r) {
  return `<div class="hub-funcs">${hubFuncProps(r).map(p => {
    const v = hubVal(p);
    if (p.b.t === 'law') {
      const L = HUB_LAW[p.b.id], law = ML_LAWS[L.q.law];
      return `<section class="hub-fn"><header><h3>${hubEsc(hubPropName(r, p))} <span class="hub-sym">${hubSym(p.sym)}</span></h3><span class="hub-meth">Equation in T</span></header>
        <div class="hub-d-plot"><dl class="hub-kv"><div><dt>Equation</dt><dd><code>${hubEsc(law.formula)}</code></dd></div><div><dt>${hubLawIsList(p.b.id) ? 'Coefficients' : 'Parameters'}</dt><dd>${hubLawParamsHTML(p.b.id, 'f')}</dd></div>
          <div><dt>Variable</dt><dd>T (temperature)</dd></div><div><dt>Valid range</dt><dd>${hubEsc(hubValid(p, v))}</dd></div><div><dt>Data source</dt><dd>${hubEsc(L.src)}</dd></div></dl>
          <figure class="hub-fig"><canvas data-hublawplot="${p.b.id}" data-p="${p.id}" role="img" aria-label="${hubEsc(p.l)} against temperature"></canvas></figure></div></section>`;
    }
    return `<section class="hub-fn"><header><h3>${hubEsc(hubPropName(r, p))} <span class="hub-sym">${hubSym(p.sym)}</span></h3><span class="hub-meth">${hubEsc(hubMethod(p, v))}</span></header>${hubDefHTML(p, v)}</section>`;
  }).join('')}</div>`;
}
// ---- Validity and Sources ----
function hubValidHTML(r) {
  const rows = hubProps(r).filter(p => !['model', 'orModel', 'switch'].includes(p.b.t)).map(p => {
    const v = hubVal(p), b = p.b;
    const src = b.t === 'card' ? `<input type="text" class="hub-src" id="hubvs_${p.id}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: data source">`
      : b.t === 'inp' ? `<input type="text" class="hub-src" id="hubvsi_${b.k}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: data source">`
      : (t => `<span class="hub-srct" title="${hubEsc(t)}">${hubEsc(t)}</span>`)(b.t === 'law' ? HUB_LAW[b.id].src : b.t === 'const' ? HUB_CONST[b.id].src : v.src || '');
    const code = b.t === 'law' ? HUB_LAW[b.id].solver : b.t === 'const' ? HUB_CONST[b.id].solver : '';
    return `<tr><th scope="row">${hubEsc(hubPropName(r, p))}</th><td>${hubEsc(hubMethod(p, v))}</td><td>${hubEsc(hubValid(p, v)) || '<span class="hub-muted">—</span>'}${v.u && hubValid(p, v) && !/°C/.test(hubValid(p, v)) ? ` ${hubEsc(v.u)}` : ''}</td><td>${hubEsc(hubOutside(p, v)) || '<span class="hub-muted">—</span>'}</td><td class="hub-c-src">${src}</td><td class="hub-c-code">${code ? `<code>${hubEsc(code)}</code>` : ''}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="cfd-table hub-valid"><thead><tr><th scope="col">Property</th><th scope="col">Method</th><th scope="col">Valid range</th><th scope="col">Outside the range</th><th scope="col" class="hub-c-src">Data source</th><th scope="col" class="hub-c-code">In the solver</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
// ---- Domain Assignments: where the material is, and what each solver reads from it there ----
function hubDomainsHTML(r) {
  // (each domain of the material's record: its solvers and the material they take there -- the record's own or one of
  //  its copies, chosen where a solver there takes an assigned material, MC-2)
  const B = r.inst ? hubBaseRec(r.base) : r, opts = [B, ...hubInsts(B.id).map(hubInstRec)], asg = (MAT.assign || {})[B.id] || {};
  const rows = B.domains.map((d, i) => {
    const all = (HUB_DOMAIN_PHYS[B.id] || [])[i] || [], sw = hubDomainSwaps(B.id, i), keep = all.filter(ph => !HUB_SWAP[ph]), cur = asg[i] && MAT.inst[asg[i]] ? asg[i] : B.id;
    const sel = sw.length && opts.length > 1 ? `<select class="hub-sel" id="hubas_${B.id}_${i}" data-hubassign="${B.id}|${i}" aria-label="${hubEsc(d)}: the material assigned">${opts.map(o => `<option value="${o.id}"${o.id === cur ? ' selected' : ''}>${hubEsc(hubName(o))}</option>`).join('')}</select>`
      : `<span>${hubEsc(hubName(cur === B.id ? B : hubRec(cur)))}</span>`;
    return `<tr${cur === r.id ? ' class="hub-dom-on"' : ''}><th scope="row">${hubEsc(d)}</th><td class="hub-chips">${all.map(ph => `<span class="chip hub-ph">${hubPhys(ph).l}</span>`).join('')}</td>
      <td>${sel}${sw.length && keep.length ? `<small class="hub-dom-keep">${keep.map(ph => hubPhys(ph).l).join(', ')}: ${hubEsc(hubName(B))}</small>` : ''}</td></tr>`;
  }).join('');
  return `<div class="hub-dom"><div class="table-wrap"><table class="cfd-table hub-domt"><thead><tr><th scope="col">Domain</th><th scope="col">Solvers</th><th scope="col">Material assigned</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${opts.length > 1 ? '' : '<p class="hub-muted hub-small">Duplicate the material to assign a copy of it to a domain.</p>'}
    ${hubUsedHTML(r)}</div>`;
}

// ---- wiring the editor ----
function hubWireEditor(r) {
  view.querySelectorAll('[data-hubtab]').forEach(b => { b.onclick = () => { HUB.tab = b.dataset.hubtab; hubPaint(); }; });
  // (the tab strip scrolls when it is wider than the card: the open tab kept in sight, a fade where more tabs are)
  const ts = view.querySelector('.hub-tabs'), tOn = ts && ts.querySelector('[aria-selected=true]');
  if (ts) {
    const a = tOn && tOn.getBoundingClientRect(), z = ts.getBoundingClientRect();
    if (a && a.right > z.right) ts.scrollLeft += a.right - z.right + 24;
    const more = () => { ts.classList.toggle('more-r', ts.scrollLeft + ts.clientWidth < ts.scrollWidth - 2); ts.classList.toggle('more-l', ts.scrollLeft > 2); };
    more(); ts.addEventListener('scroll', more, { passive: true });
  }
  view.querySelectorAll('[data-hubgo]').forEach(b => { b.onclick = () => hubGoPhys(b.dataset.hubgo); });
  view.querySelectorAll('[data-hubgonav]').forEach(b => { b.onclick = () => navGo(b.dataset.hubgonav); });
  view.querySelectorAll('[data-hubopen]').forEach(b => { b.onclick = () => { HUB.open = HUB.open === b.dataset.hubopen ? null : b.dataset.hubopen; hubPaint(); }; });
  view.querySelectorAll('[data-hubopenp]').forEach(b => { b.onclick = () => { HUB.tab = 'props'; HUB.open = b.dataset.hubopenp; hubPaint(); const row = view.querySelector(`[data-hubrow="${b.dataset.hubopenp}"]`); if (row) row.scrollIntoView({ block: 'center' }); }; });
  const prop = id => hubProps(r).find(p => p.id === id);
  // (values: each through its own guard, as its card or input has it)
  view.querySelectorAll('input[type=number][data-hubp]').forEach(el => el.addEventListener('change', () => {
    const p = prop(el.dataset.hubp), v = hubVal(p);
    guardNumber(el, { label: v.label || p.l, lo: v.lo, hi: v.hi, unit: v.u }, x => hubSet(p, x));
    hubSoon();
  }));
  view.querySelectorAll('input[data-hubsrc]').forEach(el => el.addEventListener('change', () => { hubSet(prop(el.dataset.hubsrc), null, { src: el.value.trim() }); hubSoon(); }));
  // (a built-in law's parameters, MC-1b: each checked -- the law finite and positive over its range -- before it is taken)
  view.querySelectorAll('input[data-hublawp]').forEach(el => el.addEventListener('change', () => {
    const [id, k, i] = el.dataset.hublawp.split('|'), err = document.getElementById(el.id.replace(/^hublp_(\w+?)_.*$/, (m, at) => `hubLawErr_${at}_${id}`));
    try {
      if (el.value.trim() === '' || !Number.isFinite(+el.value)) throw new Error('a number is needed');
      const lawNow = () => JSON.stringify((r.inst ? (MAT.inst[r.inst].law || {}) : (MAT.law || {}))[id] || null), before = lawNow();
      hubSetLawParam(id, k, i === '' ? null : +i, +el.value, r.inst || null);
      if (lawNow() !== before) undoHint(`${hubLawName(id)}: ${k}${i === '' ? '' : ` ${+i + 1}`}`);
      hubSoon();
    } catch (e) { el.classList.add('invalid'); if (err) { err.textContent = `Not taken: ${e.message}`; err.hidden = false; } }
  }));
  view.querySelectorAll('[data-hublawreset]').forEach(b => { b.onclick = () => { const id = b.dataset.hublawreset; undoHint(`${hubLawName(id)}: the law's own values`); const go = () => { MAT.law = { ...(MAT.law || {}) }; delete MAT.law[id]; }; if (r.inst) hubInInst(r.inst, go, true); else go(); render(); }; });
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.addEventListener('change', f); };
  on('matModel', e => { CFDG.model = e.target.value; rheoSync('model'); render(); });
  on('matOrModel', e => { MAT.orient.model = e.target.value; render(); });
  on('matStructOn', e => { MAT.rheo.structOn = e.target.checked; render(); });
  on('matOrOn', e => { MAT.orient.on = e.target.checked; render(); });
  // (the solids from the Mixing recipe, or typed here: off, the recipe's value kept as typed, to the card's decimals)
  on('hubPhiMix', e => { const on = e.target.checked; undoHint(`Materials: the solids ${on ? 'from the Mixing recipe' : 'typed here'}`); MAT.mixLink = on;
    if (!on) MAT.slurry = { ...MAT.slurry, phi: { ...MAT.slurry.phi, v: +MAT.slurry.phi.v.toFixed(3), src: 'typed on Materials' } };
    render(); });
  on('hubFibre', e => { undoHint(`Fibre web: ${FIBRES[e.target.value].l}`); selectFibre(e.target.value); render(); });
  const rr = document.getElementById('hubRecReset');
  // (a copy: its own values back to its record's first values; the project's untouched, MC-2)
  if (rr && r.inst) rr.onclick = () => {
    undoHint(`${hubName(r)}: back to its first values`);
    hubInInst(r.inst, () => { const D = matDefaults(); for (const p of hubProps(hubBaseRec(r.base))) { const b = p.b; if (b.t === 'card') MAT[b.card] = { ...MAT[b.card], [b.k]: { ...D[b.card][b.k] } }; if (b.t === 'law' && MAT.law) { MAT.law = { ...MAT.law }; delete MAT.law[b.id]; } } }, true);
    render();
  };
  else if (rr) rr.onclick = () => {
    undoHint(`${r.name}: back to its first values`);
    const D = matDefaults();
    for (const p of hubProps(r)) {
      const b = p.b;
      if (b.t === 'card') MAT[b.card] = { ...MAT[b.card], [b.k]: { ...D[b.card][b.k] } };
      else if (b.t === 'inp') { const c = CFG.find(q => q.k === b.k); if (P[b.k] !== c.v) setInput(b.k, c.v); if (MAT.prov) delete MAT.prov['in.' + b.k]; }
      else if (b.t === 'cfdg') CFDG[b.k] = FIBRES[CFDG.fibre].set[b.k];
      else if (b.t === 'peel') { const q = OVEN_PEEL_FIELDS.find(f => f[0] === b.k); OVEN.peel = { ...OVEN.peel, [b.k]: OVEN_PEEL_DEFAULT[b.k], [q[7]]: OVEN_PEEL_DEFAULT[q[7]] }; }
    }
    // (and its built-in laws' parameters, MC-1b)
    const laws = hubProps(r).filter(p => p.b.t === 'law').map(p => p.b.id);
    if (laws.length && MAT.law) { MAT.law = { ...MAT.law }; for (const id of laws) delete MAT.law[id]; }
    if (r.id === 'slurry') rheoSync('extras');
    render();
  };
  // (a definition in temperature, MH-4b: each change checked before it is taken; the error shown, the value kept)
  const defSet = (id, q, label) => {
    const p = prop(id), err = document.getElementById(`hubDefErr_${id}`);
    let bad = [];
    try { bad = q ? hubDefCheck(q, hubTdep(p)[1]) : []; } catch (e) { bad = [e.message]; }
    if (bad.length) { if (err) { err.textContent = `Not taken: ${/does not increase/.test(bad[0]) ? 'two points at one temperature' : bad[0]}`; err.hidden = false; } return; }
    undoHint(`${r.name}: ${hubPropName(r, p).toLowerCase()}, ${label}`);
    hubSetDef(p, q); hubSoon();
  };
  const defOf = id => { const p = prop(id), v = hubVal(p); return { p, q: v.def || null, v: v.v }; };
  const setMethod = (id, k) => {
    const { p, q, v } = defOf(id), cur = !q ? 'const' : q.kind === 'table' ? 'table' : 'expr';
    if (k === cur) return;
    const hi = hubTdep(p)[1][1] > 300 ? 1273.15 : 373.15;
    if (k === 'const') defSet(id, null, 'constant again');
    else if (k === 'table') defSet(id, { kind: 'table', var: 'T', x: [293.15, hi], y: [v, v], interp: 'linear', extrap: 'clamp' }, 'as a table in T');
    else defSet(id, { kind: 'expr', src: String(v) }, 'as an equation in T');
  };
  view.querySelectorAll('[data-hubdefkind]').forEach(b => { b.onclick = () => { const [id, k] = b.dataset.hubdefkind.split('|'); setMethod(id, k); }; });
  // (the Method column: the same choice; the row opens on its editor)
  view.querySelectorAll('select[data-hubmethod]').forEach(el => el.addEventListener('change', () => { const id = el.dataset.hubmethod; if (el.value !== 'const') HUB.open = id; setMethod(id, el.value); }));
  // (the Overview: a material's identity and metadata, one undo step per field)
  view.querySelectorAll('[data-hubmeta]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.hubmeta, val = el.value.trim();
    if (val === (hubMeta(r)[k] || '')) return;
    undoHint(`${hubName(r)}: ${HUB_META_FIELDS.find(f => f[0] === k)[1].toLowerCase()}`);
    hubSetMeta(r, k, val); hubSoon();
  }));
  const tableOf = id => {
    const rows = [...view.querySelectorAll(`[data-hubdt="${id}"][data-c="x"]`)].map((el, i) => [+el.value + 273.15, +view.querySelector(`#hubdt_${id}_y${i}`).value]);
    rows.sort((a, b) => a[0] - b[0]);
    return { kind: 'table', var: 'T', x: rows.map(q => q[0]), y: rows.map(q => q[1]), interp: defOf(id).q.interp || 'linear', extrap: defOf(id).q.extrap || 'error' };
  };
  view.querySelectorAll('input[data-hubdt]').forEach(el => el.addEventListener('change', () => {
    if (el.value.trim() === '' || !Number.isFinite(+el.value)) { const e = document.getElementById(`hubDefErr_${el.dataset.hubdt}`); if (e) { e.textContent = 'Not taken: a number is needed.'; e.hidden = false; } return; }
    defSet(el.dataset.hubdt, tableOf(el.dataset.hubdt), 'table edited');
  }));
  view.querySelectorAll('[data-hubdtadd]').forEach(b => { b.onclick = () => {
    const id = b.dataset.hubdtadd, { q } = defOf(id), n = q.x.length, x = q.x[n - 1] + (n > 1 ? q.x[n - 1] - q.x[n - 2] : 100);
    defSet(id, { ...q, x: [...q.x, x], y: [...q.y, q.y[n - 1]] }, 'a point added');
  }; });
  view.querySelectorAll('[data-hubdtdel]').forEach(b => { b.onclick = () => {
    const [id, i] = b.dataset.hubdtdel.split('|'), { q } = defOf(id);
    defSet(id, { ...q, x: q.x.filter((_, j) => j !== +i), y: q.y.filter((_, j) => j !== +i) }, 'a point removed');
  }; });
  // (a table read from a CSV: its points replace the table's; its file the source; the way between and outside kept)
  view.querySelectorAll('[data-hubdtcsv]').forEach(b => { b.onclick = () => {
    const id = b.dataset.hubdtcsv, { p, q } = defOf(id), inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv,.txt,text/csv,text/plain';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0], err = document.getElementById(`hubDefErr_${id}`);
      if (!f) return;
      let t;
      try { t = hubParseTCsv(await f.text(), hubVal(p).u); } catch (e) { if (err) { err.textContent = `Not taken: ${f.name}: ${e.message}.`; err.hidden = false; } return; }
      const nq = { kind: 'table', var: 'T', x: t.x, y: t.y, interp: (q && q.interp) || 'linear', extrap: (q && q.extrap) || 'clamp' };
      let bad = [];
      try { bad = hubDefCheck(nq, hubTdep(p)[1]); } catch (e) { bad = [e.message]; }
      if (bad.length) { if (err) { err.textContent = `Not taken: ${f.name}: ${/does not increase/.test(bad[0]) ? 'two points at one temperature' : bad[0]}`; err.hidden = false; } return; }
      undoHint(`${r.name}: ${hubPropName(r, p).toLowerCase()}, a table from ${f.name}`);
      hubSetDef(p, nq); hubSet(p, null, { src: f.name }); hubSoon();
    };
    inp.click();
  }; });
  view.querySelectorAll('select[data-hubdtopt]').forEach(el => el.addEventListener('change', () => {
    const id = el.dataset.hubdtopt, { q } = defOf(id);
    defSet(id, { ...q, [el.dataset.o]: el.value }, el.dataset.o === 'interp' ? 'its interpolation' : 'outside its points');
  }));
  view.querySelectorAll('input[data-hubdexpr]').forEach(el => el.addEventListener('change', () => defSet(el.dataset.hubdexpr, { kind: 'expr', src: el.value.trim() }, 'expression edited')));
  const du = document.getElementById('hubRecDup');
  if (du) du.onclick = () => { undoHint(`Duplicate ${hubName(r)}`); const id = hubDuplicate(r.id); HUB.sel = id; HUB.tab = 'overview'; HUB.open = null; render(); };
  const dl = document.getElementById('hubRecDel');
  if (dl) dl.onclick = () => { undoHint(`Delete ${hubName(r)}`); const base = r.base; hubDeleteInst(r.inst); HUB.sel = base; HUB.open = null; render(); };
  // (Domain Assignments: the material each domain takes, MC-2)
  view.querySelectorAll('select[data-hubassign]').forEach(el => el.addEventListener('change', () => {
    const [base, i] = el.dataset.hubassign.split('|'), dom = hubBaseRec(base).domains[+i];
    undoHint(`${dom.split(':')[0]}: ${el.value === base ? hubName(hubBaseRec(base)) : hubName(hubRec(el.value))}`);
    hubAssign(base, +i, el.value === base ? null : el.value); render();
  }));
  const re = document.getElementById('hubRecExport');
  if (re) re.onclick = () => hubDownload(`${r.id}.material.json`, hubAsSet(() => hubExport([r.id])));
  if (HUB.tab === 'meas' && r.id === 'slurry') rtDraw();
  // (a copy's plots drawn with its own values in place, MC-2)
  const raf = f => requestAnimationFrame(() => (r.inst ? hubInInst(r.inst, f) : f()));
  if (HUB.tab === 'models') raf(() => hubDrawModels(r));
  if (HUB.tab === 'props' && HUB.open) raf(() => {
    const p = prop(HUB.open), cv = document.getElementById('hubDetCv');
    if (p && cv && p.b.t === 'law') { const L = HUB_LAW[p.b.id]; hubLine(cv, hubLawCurve(p.b.id).map(([T, y]) => [T, y / (HUB_LAW_SCALE[p.b.id] || 1)]), { xl: 'temperature (°C)', yl: `${p.sym} (${L.u})`, x0: L.T[0], x1: L.T[1], aspect: 0.55, yf: v => hubFmt(v, -3) }); }
    const dc = p && document.getElementById(`hubDefCv_${p.id}`);
    if (dc) hubDrawDef(dc, p);
  });
  // (Property Functions: every definition's plot, every law's curve)
  if (HUB.tab === 'funcs') raf(() => {
    view.querySelectorAll('[data-hubdefplot]').forEach(cv => { const q = prop(cv.dataset.hubdefplot); if (q) hubDrawDef(cv, q); });
    view.querySelectorAll('[data-hublawplot]').forEach(cv => { const id = cv.dataset.hublawplot, L = HUB_LAW[id], q = prop(cv.dataset.p); hubLine(cv, hubLawCurve(id).map(([T, y]) => [T, y / (HUB_LAW_SCALE[id] || 1)]), { xl: 'temperature (°C)', yl: `${q ? q.sym.replace(/_/g, '') : ''} (${L.u})`, x0: L.T[0], x1: L.T[1], aspect: 0.42, yf: v => hubFmt(v, -3) }); });
  });
}
/** A definition in temperature against T over the range its solvers check (the table's points marked; 20 °C marked). */
function hubDrawDef(cv, p) {
  const e = hubVal(p), q = e.def, [, [t0, t1]] = hubTdep(p), pts = [];
  // (a constant: its value at every temperature, a flat line over the range its solvers reach)
  if (!q) { hubLine(cv, [[t0, e.v], [t1, e.v]], { xl: 'temperature (°C)', yl: `${p.sym.replace(/_/g, '')} (${hubVal(p).u})`, x0: t0, x1: t1, aspect: 0.42, marks: [{ x: 20, c: cssVar('--muted'), t: '20 °C' }], yf: v => hubFmt(v, -3) }); return; }
  const lo = q.kind === 'table' && (q.extrap || 'error') === 'error' ? Math.max(t0, q.x[0] - 273.15) : t0, hi = q.kind === 'table' && (q.extrap || 'error') === 'error' ? Math.min(t1, q.x[q.x.length - 1] - 273.15) : t1;
  for (let i = 0; i <= 200; i++) { const T = lo + (hi - lo) * i / 200; try { const y = hubDefAt(q, T); if (Number.isFinite(y)) pts.push([T, y]); } catch (err) { /* outside a refusing table */ } }
  const u = hubVal(p).u, extra = q.kind === 'table' ? [{ p: q.x.map((x, i) => [x - 273.15, q.y[i]]).filter(([x]) => x >= t0 && x <= t1), c: cssVar('--ink'), line: false, dots: true }] : [];
  hubLine(cv, pts, { xl: 'temperature (°C)', yl: `${p.sym.replace(/_/g, '')} (${u})`, x0: t0, x1: t1, aspect: 0.42, extra, marks: [{ x: 20, c: cssVar('--muted'), t: '20 °C' }], yf: v => hubFmt(v, -3) });
}
/** Draw the page again once the change's event is over (the focus moved on by then: it is kept). */
let hubTimer = 0;
function hubSoon() { clearTimeout(hubTimer); hubTimer = setTimeout(() => { if (tab === 13) viewMaterials(); }, 0); }

// ---- readiness ----
/** The order a solver's properties are listed in: what it lacks first, what it does not read last. */
const HUB_RD_ORDER = { missing: 0, complete: 1, unsupported: 2, optional: 3, na: 4 };
function hubReadyHTML() {
  const R = hubReadiness(), L = { ok: ['Ready', 'every value it requires is set and holds'], warn: ['Missing data', 'a value it requires has none'], bad: ['Blocked', 'a material cannot hold as set'] };
  const ST = { complete: 'Required, complete', missing: 'Required, missing', optional: 'Optional: not used as set', na: 'Not applicable: not read by this solver', unsupported: 'Defined in T: this solver takes its 20 °C value' };
  const rows = R.map(q => {
    const open = HUB.readyOpen === q.ph.k;
    return `<tr class="hub-rd${open ? ' open' : ''}"><th scope="row"><button type="button" class="hub-pname" data-hubready="${q.ph.k}" aria-expanded="${open}"><svg class="hub-car" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>${q.ph.l}</button><small>${hubEsc(q.ph.s)}</small></th>
      <td class="num">${q.n.complete}</td><td class="num">${q.n.missing}</td><td class="num">${q.n.optional}</td><td class="num">${q.n.na}</td><td class="num">${q.n.unsupported}</td>
      <td class="hub-st hub-st-${q.st}"><i class="hub-dot hub-${q.st}"></i>${L[q.st][0]}<small>${L[q.st][1]}</small></td><td><button type="button" class="btn btn-secondary btn-sm" data-hubgo="${q.ph.k}">Open</button></td></tr>
      ${open ? `<tr class="hub-detail"><td colspan="8">${q.probs.length ? `<ul class="hub-checks">${q.probs.map(c => `<li class="hub-${c.level === 'error' ? 'bad' : 'warn'}"><i class="hub-dot hub-${c.level === 'error' ? 'bad' : 'warn'}"></i>${hubEsc(hubName(c.r))}: ${hubEsc(c.msg)}</li>`).join('')}</ul>` : ''}
        <div class="table-wrap"><table class="cfd-table hub-rdt"><thead><tr><th scope="col">Material</th><th scope="col">Property</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Status</th></tr></thead><tbody>
        ${[...q.rows].sort((a, b) => HUB_RD_ORDER[a.st] - HUB_RD_ORDER[b.st]).map(x => `<tr class="hub-rs-${x.st}"><td>${hubEsc(hubName(x.r))}</td><td><button type="button" class="hub-link" data-hubjump="${x.r.id}|${x.p.id}">${hubEsc(hubPropName(x.r, x.p))}</button></td><td class="num">${typeof x.v.v === 'number' ? hubFmt(x.v.v, x.v.d ?? -4) : hubEsc(x.v.v ?? '')}</td><td>${hubEsc(x.v.u || '')}</td><td>${ST[x.st]}${x.off ? ` <small>(${hubEsc(x.off)})</small>` : ''}</td></tr>`).join('')}</tbody></table></div></td></tr>` : ''}`;
  }).join('');
  return `<div class="hub-sheet"><div class="table-wrap"><table class="cfd-table hub-ready"><thead><tr><th scope="col">Solver</th><th scope="col">Required, complete</th><th scope="col">Required, missing</th><th scope="col">Optional</th><th scope="col">Not applicable</th><th scope="col">Unsupported definition</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>${rows}</tbody></table></div>${typeof sensHTML === 'function' ? sensHTML() : ''}</div>`;
}
function hubWireReady() {
  if (typeof sensWire === 'function') sensWire();
  view.querySelectorAll('[data-hubready]').forEach(b => { b.onclick = () => { HUB.readyOpen = HUB.readyOpen === b.dataset.hubready ? null : b.dataset.hubready; hubPaint(); }; });
  view.querySelectorAll('[data-hubgo]').forEach(b => { b.onclick = () => hubGoPhys(b.dataset.hubgo); });
  view.querySelectorAll('[data-hubjump]').forEach(b => { b.onclick = () => { const [r, p] = b.dataset.hubjump.split('|'); HUB.view = 'lib'; HUB.sel = r; HUB.tab = 'props'; HUB.open = p; render(); const row = view.querySelector(`[data-hubrow="${p}"]`); if (row) row.scrollIntoView({ block: 'center' }); }; });
}

// ---- compare: the materials side by side at one temperature ----
function hubCompareHTML() {
  const T = HUB.cmpT, f = (v, d = -4) => (v == null || !Number.isFinite(v) ? '<span class="hub-muted">—</span>' : hubFmt(v, d));
  const s = MAT.slurry, d = MAT.dry, fl = MAT.film, fu = MAT.furn;
  const law = id => hubLawAt(id, T), inR = id => T >= HUB_LAW[id].T[0] && T <= HUB_LAW[id].T[1];
  const lawOr = id => (inR(id) ? law(id) : null);
  const goCp = d.cS.v * hubLawAt('gCp', T) / hubLawAt('gCp', 20);
  const cols = [
    ['GO slurry', T <= 100 ? { rho: slurryRho(), mu: P.mu } : { rho: null, mu: null }],
    ['Water', T <= 100 ? { rho: s.rhoL.v, cp: HUB_CONST.waterCp.v, mu: lawOr('waterMu') } : { rho: null, cp: null, mu: null }],
    ['Air', { rho: lawOr('airRho'), cp: HUB_CONST.airCp.v, k: lawOr('airK'), mu: lawOr('airMu') }],
    ['Argon', { rho: lawOr('arRho'), cp: HUB_CONST.arCp.v, k: inR('arMu') ? law('arMu') * HUB_CONST.arCp.v / HUB_CONST.arPr.v : null, mu: lawOr('arMu') }],
    ['GO flakes', { rho: s.rhoS.v * 1000 }],
    ['Dried GO film', { rho: s.phiDry.v * s.rhoS.v * 1000, cp: T === 20 ? d.cS.v : goCp, cpNote: T === 20 ? '' : 'scaled graphite law (furnace multiphysics)', k1: d.kIn.v, k3: d.kS.v, E1: fl.Ep.v, E3: fl.Et.v, eps: d.emis.v }],
    ['Graphene film', { cp: lawOr('gCp'), k1: fu.kG.v * 0.93 * fu.La1.v / (fu.La1.v + fu.ell.v) }],
    ['Fibre web', { rho: CFDG.rhoF, cp: d.cpWeb.v, E1: fl.Ew.v, E3: fl.Ew.v * fl.soft.v }],
    ['Graphite paper', { rho: fu.rhoP.v * 1000, cp: lawOr('gCp'), k1: fu.kPin.v, k3: fu.kPthr.v, E3: fu.Ez.v / 1000 }],
    ['Isostatic graphite', { rho: fu.rhoPl.v * 1000, cp: lawOr('gCp'), k1: fu.kPl.v, k3: fu.kPl.v, E1: MAT.lib.plE.v, E3: MAT.lib.plE.v, eps: fu.epsF.v }],
    ['Aluminium', { rho: MAT.lib.alRho.v, cp: MAT.lib.alC.v, k1: MAT.lib.alK.v, k3: MAT.lib.alK.v, eps: OVEN.peel.epsPl }],
  ];
  const rows = [['rho', 'Density', 'kg/m³', -4], ['cp', 'Specific heat capacity', 'J/(kg·K)', -4], ['k1', 'Thermal conductivity, in the plane', 'W/(m·K)', -3], ['k3', 'Thermal conductivity, through the thickness', 'W/(m·K)', -3], ['k', 'Thermal conductivity (gas)', 'W/(m·K)', -3],
    ['mu', 'Viscosity', 'Pa·s', -3], ['E1', 'Young\'s modulus, in the plane', 'GPa', -3], ['E3', 'Young\'s modulus, through the thickness', 'GPa', -3], ['eps', 'Emissivity', '', 2]];
  const Ts = [20, 100, 500, 1000, 2000, 2800];
  return `<div class="hub-sheet"><div class="hub-cmp-bar"><span class="hub-d-l">At</span><span class="seg" role="tablist" aria-label="Compared at the temperature">${Ts.map(t => `<button type="button" role="tab" data-hubcmpt="${t}" aria-selected="${t === T}">${t} °C</button>`).join('')}</span>
      <span class="hub-muted">Laws in temperature at ${T} °C; — outside a law's valid range or a liquid's (0–100 °C); constants as they are; the slurry's viscosity at 2.7 1/s.</span></div>
    <div class="table-wrap"><table class="cfd-table hub-cmp"><thead><tr><th scope="col">Property</th>${cols.map(([n]) => `<th scope="col">${hubEsc(n)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(([k, l, u, dd]) => `<tr><th scope="row">${l}<small>${u}</small></th>${cols.map(([, c]) => `<td${c[k + 'Note'] ? ` title="${hubEsc(c[k + 'Note'])}"` : ''}>${k in c ? f(c[k], dd) : '<span class="hub-na"></span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function hubWireCompare() {
  view.querySelectorAll('[data-hubcmpt]').forEach(b => { b.onclick = () => { HUB.cmpT = +b.dataset.hubcmpt; hubPaint(); }; });
}

// ---- material files ----
function hubDownload(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
/** A text file to save (the measurement sheet: with a byte-order mark, so spreadsheets read its µ, ³ and ° as written). */
function hubDownloadText(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type })); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
/** f with the project as set: while the ranking of the assumed values runs, the value under change is not the project's
 *  (a file saved then holds the project's own). */
const hubAsSet = f => (typeof sensAsSet === 'function' ? sensAsSet(f) : f());
function hubSheetFile() {
  const n = hubAsSet(() => hubSheetRows().length);
  hubDownloadText(`materials-${new Date().toISOString().slice(0, 10)}.csv`, hubAsSet(hubSheetCSV), 'text/csv');
  imgToast(`Materials CSV: ${n} values. Enter yours under "Your value" (and its unit and source), then Import the file.`);
}
function hubExportFile() { hubDownload(`materials-${new Date().toISOString().slice(0, 10)}.json`, hubAsSet(() => hubExport())); }
function hubImportFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,.csv,application/json,text/csv';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    // (a material file, or a filled measurement sheet: its rows read as a material file, a sheet's single numbers kept off definitions)
    const text = await f.text(), csv = /\.csv$/i.test(f.name) || !/^\s*[{[]/.test(text.replace(/^\uFEFF/, ''));
    let res, data, pre = [];
    try {
      if (csv) { const sh = hubSheetToFile(text); data = sh.file; pre = sh.skipped; if (!sh.n && !pre.length) { imgToast(`${f.name}: no "Your value" filled in.`); return; } } else data = JSON.parse(text);
      // (a material file's metadata alone is a change too)
      res = hubImport(data, false, { keepDefs: csv });
    } catch (e) { imgToast(`${f.name}: ${e.message}.`, 'error'); return; }
    res.skipped = [...pre, ...res.skipped];
    if (!res.changes.length && !(res.metas || []).length && !(res.laws || []).length && !(res.copies || []).length) { imgToast(`${f.name}: nothing to change${res.skipped.length ? ` (${res.skipped.length} not taken: ${res.skipped.slice(0, 3).join('; ')})` : ''}.`, res.skipped.length ? 'error' : undefined); return; }
    undoHint(`Import materials from ${f.name}`);
    hubImport(data, true, { keepDefs: csv });
    const nConv = res.changes.filter(c => c.unit).length;
    imgToast(`${f.name}: ${res.changes.length} values taken${(res.laws || []).length ? `, ${res.laws.length} laws' parameters` : ''}${(res.copies || []).length ? `, ${res.copies.length} cop${res.copies.length === 1 ? 'y' : 'ies'} made` : ''}${nConv ? ` (${nConv} converted to this app's units)` : ''}${res.skipped.length ? `; ${res.skipped.length} not (${res.skipped.slice(0, 2).join('; ')})` : ''}.`);
    render();
  };
  inp.click();
}
