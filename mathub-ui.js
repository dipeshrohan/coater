'use strict';
/*
 * mathub-ui.js — the Materials page as a material hub (MH-5): the library of the project's materials and interfaces
 * on the left; the material picked on the right -- its identity, where it is in the line, its checks, its provenance,
 * then its tabs: Properties (a property table by group, every value with its symbol, unit, provenance and source;
 * a row opens its definition: the law and its plot, the tensor and its eigenvalues, the stiffness matrix, the range,
 * the solvers that read it), Models (the flow law's curve, the isotherm, the conversion in the furnace ...), Measured
 * data, Used by. Two more views: Readiness (each solver's properties by provenance, and what blocks it) and Compare.
 * The values are the ones the solvers read (mathub.js binds each property to it): an edit here is an edit there.
 */
const HUB = { view: 'lib', sel: 'slurry', tab: 'props', open: null, q: '', cmpT: 20, readyOpen: null, conv: null };
/** A symbol: escaped, its _sub as a subscript (x_dry, c_p, τ_y). */
const hubSym = s => hubEsc(s).replace(/_([A-Za-z0-9,.₀-₉]+)/g, '<sub>$1</sub>');
const hubEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Provenance groups for the bars (the table names the kind itself). */
const HUB_PG = [['meas', 'Measured', ['measured', 'fitted']], ['you', 'From you or a datasheet', ['user', 'supplier', 'report']], ['asm', 'Assumed or published', ['published', 'assumed']], ['blt', 'Built-in', ['builtin']]];
const hubPG = k => (HUB_PG.find(g => g[2].includes(k)) || ['calc'])[0];
const HUB_CLS_ORDER = ['Fluid', 'Particles', 'Gas', 'Solid', 'Porous solid'];

/** A provenance bar: segments per group with their counts (and the count of each, written). */
function hubProvBar(n, wide = false) {
  const tot = HUB_PG.reduce((a, g) => a + g[2].reduce((s, k) => s + (n[k] || 0), 0), 0);
  if (!tot) return '<span class="hub-pbar hub-pbar-empty"></span>';
  const seg = HUB_PG.map(([c, l, ks]) => { const m = ks.reduce((s, k) => s + (n[k] || 0), 0); return m ? `<i class="pb-${c}" style="flex:${m}" title="${l}: ${m}"></i>` : ''; }).join('');
  const txt = wide ? `<span class="hub-pleg">${HUB_PG.map(([c, l, ks]) => { const m = ks.reduce((s, k) => s + (n[k] || 0), 0); return m ? `<span><i class="pb-${c}"></i>${l} <b>${m}</b></span>` : ''; }).join('')}</span>` : '';
  return `<span class="hub-pbar${wide ? ' wide' : ''}" role="img" aria-label="${HUB_PG.map(([, l, ks]) => `${l} ${ks.reduce((s, k) => s + (n[k] || 0), 0)}`).join(', ')}">${seg}</span>${txt}`;
}
const hubProvChip = k => `<span class="hub-prov pv-${hubPG(k)}">${hubProvL(k)}</span>`;

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
  root.innerHTML = `<div class="hub-grid"><nav class="hub-lib" id="hubLib" aria-label="The project's materials">${hubLibHTML()}</nav><section class="hub-main" id="hubMain" aria-labelledby="hubName">${hubEditorHTML(r)}</section></div>`;
  hubWireLib(); hubWireEditor(r);
}
/** The page's status line: the materials, their values by provenance, what blocks a solver. */
function hubStatus() {
  const st = document.getElementById('st'), ss = document.getElementById('ss');
  if (ss) ss.innerHTML = '';
  if (!st) return;
  const R = hubReadiness(), n = {};
  for (const r of hubAll()) for (const [k, m] of Object.entries(hubCounts(r))) n[k] = (n[k] || 0) + m;
  const g = ks => ks.reduce((s, k) => s + (n[k] || 0), 0), bad = R.filter(q => q.st === 'bad');
  st.innerHTML = pill(`${HUB_RECORDS.length} materials · ${HUB_IFACES.length} interfaces`, '')
    + pill(`${g(['measured', 'fitted'])} measured · ${g(['user', 'supplier', 'report'])} from you or a datasheet · ${g(['published', 'assumed'])} assumed · ${g(['builtin'])} built-in`, g(['published', 'assumed']) ? 'warn' : 'ok')
    + (bad.length ? pill(`${bad.map(q => q.ph.l).join(', ')}: a material cannot hold as set`, 'bad') : '');
}

// ---- the library ----
function hubMatches(r) {
  const q = HUB.q.trim().toLowerCase();
  if (!q) return true;
  return [r.name, r.sub, r.cls, ...hubProps(r).map(p => `${p.l} ${p.sym}`)].some(t => String(t).toLowerCase().includes(q));
}
function hubLibHTML() {
  const item = r => {
    const ch = hubChecks(r), lv = ch.some(c => c.level === 'error') ? 'bad' : ch.length ? 'warn' : '';
    return `<button type="button" class="hub-item${r.id === HUB.sel ? ' on' : ''}" data-hubsel="${r.id}" aria-current="${r.id === HUB.sel}">
      ${uiBadge(r.icon)}<span class="hub-item-t"><b>${hubEsc(r.name)}</b><small>${hubEsc(r.sub)}</small>${hubProvBar(hubCounts(r))}</span>${lv ? `<i class="hub-dot hub-${lv}" title="${lv === 'bad' ? 'cannot hold as set' : 'a warning'}"></i>` : ''}</button>`;
  };
  const mats = HUB_RECORDS.filter(hubMatches), ifs = HUB_IFACES.filter(hubMatches);
  const groups = HUB_CLS_ORDER.map(c => [c, mats.filter(r => r.cls === c)]).filter(g => g[1].length);
  return `<label class="hub-search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><input type="search" id="hubQ" placeholder="Search materials, properties" value="${hubEsc(HUB.q)}" aria-label="Search the materials and their properties"></label>
    ${groups.map(([c, rs]) => `<div class="hub-lib-h">${c === 'Particles' ? 'Particles' : c + (rs.length > 1 && !/s$/.test(c) ? 's' : '')}</div>${rs.map(item).join('')}`).join('')}
    ${ifs.length ? `<div class="hub-lib-h">Interfaces</div>${ifs.map(item).join('')}` : ''}
    ${!groups.length && !ifs.length ? '<p class="hub-none">Nothing matches.</p>' : ''}
    <div class="hub-lib-foot"><span><i class="pb-meas"></i>Measured</span><span><i class="pb-you"></i>Yours</span><span><i class="pb-asm"></i>Assumed</span><span><i class="pb-blt"></i>Built-in</span></div>`;
}
function hubWireLib() {
  view.querySelectorAll('[data-hubsel]').forEach(b => { b.onclick = () => { if (HUB.sel !== b.dataset.hubsel) { HUB.sel = b.dataset.hubsel; HUB.open = null; const r = hubRec(HUB.sel); if (!hubTabs(r).some(t => t[0] === HUB.tab)) HUB.tab = 'props'; } hubPaint(); }; });
  const q = document.getElementById('hubQ');
  if (q) q.addEventListener('input', () => { HUB.q = q.value; const lib = document.getElementById('hubLib'); lib.innerHTML = hubLibHTML(); hubWireLib(); const nq = document.getElementById('hubQ'); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
}

// ---- the editor ----
function hubTabs(r) {
  return [['props', 'Properties'], ...(r.models ? [['models', 'Models and plots']] : []), ...(hubMeasured(r) ? [['meas', 'Measured data']] : []), ['used', 'Used by']];
}
function hubEditorHTML(r) {
  const used = new Set(hubProps(r).flatMap(p => p.phys)), ph = HUB_PHYS.map(q => q.k).filter(k => used.has(k)), ch = hubChecks(r), tabs = hubTabs(r), iface = r.id.startsWith('i-');
  if (!tabs.some(t => t[0] === HUB.tab)) HUB.tab = 'props';
  const parts = iface ? [r.a, r.bb].map(id => (id ? `<button type="button" class="hub-link" data-hubsel="${id}">${hubEsc(hubRec(id).name)}</button>` : '<span>the blade (rigid wall)</span>')).join(' <span class="hub-sep">|</span> ') : '';
  return `<header class="hub-head">
      <div class="hub-title">${uiBadge(r.icon)}<div><h2 id="hubName">${hubEsc(r.name)}</h2><p class="hub-cls"><span class="hub-tag">${iface ? 'Interface' : r.cls}</span>${hubEsc(r.sub)}${r.desc ? ` · ${hubEsc(r.desc)}` : ''}</p></div>
        <span class="hub-head-act"><button type="button" class="btn btn-secondary btn-sm" id="hubRecReset" title="This material's values back to their first values">${uiIco('restart')}Defaults</button><button type="button" class="btn btn-secondary btn-sm" id="hubRecExport">${uiIco('download')}Export</button></span></div>
      <dl class="hub-facts">
        ${iface ? `<div><dt>Between</dt><dd>${parts}</dd></div>` : ''}
        <div><dt>Where it is</dt><dd>${r.domains.map(hubEsc).join('<br>')}</dd></div>
        <div><dt>Solved by</dt><dd class="hub-chips">${ph.map(k => `<button type="button" class="chip hub-ph" data-hubgo="${k}">${hubPhys(k).l}</button>`).join('')}</dd></div>
        <div><dt>Provenance</dt><dd>${hubProvBar(hubCounts(r), true)}</dd></div>
      </dl>
      ${r.note ? `<p class="hub-note">${hubEsc(r.note)}</p>` : ''}
      ${ch.length ? `<ul class="hub-checks">${ch.map(c => `<li class="hub-${c.level === 'error' ? 'bad' : 'warn'}"><i class="hub-dot hub-${c.level === 'error' ? 'bad' : 'warn'}"></i>${hubEsc(c.msg)}</li>`).join('')}</ul>` : ''}
    </header>
    <div class="hub-tabs" role="tablist" aria-label="${hubEsc(r.name)}: its pages">${tabs.map(([k, t]) => `<button type="button" role="tab" data-hubtab="${k}" aria-selected="${HUB.tab === k}">${t}</button>`).join('')}</div>
    <div class="hub-tab" role="tabpanel">${HUB.tab === 'models' ? hubModelsHTML(r) : HUB.tab === 'meas' ? hubMeasHTML(r) : HUB.tab === 'used' ? hubUsedHTML(r) : hubPropsHTML(r)}</div>`;
}

// the property table
function hubPropsHTML(r) {
  const body = r.groups.map(g => `<tbody class="hub-grp"><tr class="hub-grp-h"><th colspan="6" scope="rowgroup">${hubEsc(g.l)}</th></tr>${g.props.map(p => hubRowHTML(r, p)).join('')}</tbody>`).join('');
  return `<div class="table-wrap"><table class="hub-table"><thead><tr><th scope="col">Property</th><th scope="col">Symbol</th><th scope="col" class="hub-c-v">Value</th><th scope="col">Unit</th><th scope="col">Provenance</th><th scope="col" class="hub-c-src">Source</th></tr></thead>${body}</table></div>
    <p class="hub-foot">Click a property for its definition: the law and its plot, the tensor in the material's frame, its range, the solvers that read it. Values are the solvers' own: a change here is solved with.</p>`;
}
/** A property's value cell: its input (an editable value), select or switch, else the value. */
function hubValCell(p, v) {
  const b = p.b;
  if (b.t === 'card' && v.def) { const [attr, pre] = HUB_ATTR[b.card]; return `<span class="hub-num">${hubFmt(v.v, -4)}</span><small class="hub-at">at 20 °C</small><span class="hub-tdef" title="Defined in temperature: open the row">${v.def.kind === 'table' ? `table, ${v.def.x.length} points` : 'f(T)'}</span><input type="number" id="${pre}_${b.k}" data-${attr}="${b.k}" data-hubp="${p.id}" value="${v.v}" hidden disabled>`; }
  if (b.t === 'card') { const [attr, pre] = HUB_ATTR[b.card]; return `<input type="number" id="${pre}_${b.k}" data-${attr}="${b.k}" data-hubp="${p.id}" min="${v.lo}" max="${v.hi}" step="${v.step}" value="${v.v}" aria-label="${hubEsc(p.l)}">`; }
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
  const provCell = b.t === 'card' || b.t === 'inp'
    ? `<select class="hub-psel pv-${hubPG(v.prov)}" id="hubpv_${p.id}" data-hubprov="${p.id}" data-help="mat.flag" aria-label="${hubEsc(p.l)}: its provenance">${HUB_PROV_SET.map(k => `<option value="${k}"${k === v.prov ? ' selected' : ''}>${HUB_PROV[k].l}</option>`).join('')}</select>`
    : hubProvChip(v.prov);
  const srcCell = b.t === 'card' ? `<input type="text" class="mat-src hub-src" id="${HUB_ATTR[b.card][1]}s_${b.k}" data-${HUB_ATTR[b.card][0]}="${b.k}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: source">`
    : b.t === 'inp' ? `<input type="text" class="hub-src" id="hubins_${b.k}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: source">`
    : `<span class="hub-srct" title="${hubEsc(v.src)}">${hubEsc(v.src)}</span>`;
  const row = `<tr class="hub-row${off ? ' hub-off' : ''}${open ? ' open' : ''}${p.sub ? ' hub-subrow' : ''}${lv ? ' hub-r' + lv : ''}" data-hubrow="${p.id}"${b.t === 'card' ? ` data-${HUB_ATTR[b.card][0]}="${b.k}"` : ''}>
    <th scope="row"><button type="button" class="hub-pname" id="hubop_${p.id}" data-hubopen="${p.id}" aria-expanded="${open}"><svg class="hub-car" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>${hubEsc(p.l)}${lv ? `<i class="hub-dot hub-${lv}"></i>` : ''}</button>${off ? `<small class="hub-offn">${hubEsc(off)}</small>` : p.note ? `<small class="hub-offn">${hubEsc(p.note)}</small>` : ''}</th>
    <td class="hub-sym">${hubSym(p.sym)}</td><td class="hub-c-v">${hubValCell(p, v)}</td><td class="hub-u">${hubEsc(v.u)}</td><td>${provCell}</td><td class="hub-c-src">${srcCell}</td></tr>`;
  return row + (open ? `<tr class="hub-detail"><td colspan="6">${hubDetailHTML(r, p, v)}</td></tr>` : '');
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
      ['Provenance', `${hubProvL(v.prov)}: ${hubEsc((HUB_PROV[v.prov] || HUB_PROV_RO[v.prov] || {}).d || '')}`],
      ['Source', `<input type="text" class="hub-src hub-src-d" id="hubsrc_${p.id}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: source">`],
    ])}${usedHTML}</div>`;
    return `<div class="hub-d">${kv([
      ['Definition', 'Constant'],
      help ? ['What it is', hubEsc(help.d)] : null,
      b.t === 'card' ? ['Stage card', `the ${HUB_CARD_T[b.card]} (its Defaults: the Defaults menu above)`] : null,
      si ? ['In SI', si] : null,
      ['Allowed', `${v.lo} to ${v.hi} ${hubEsc(v.u)}`],
      b.t === 'inp' ? ['Also on', 'the inputs bar (left), the same value'] : b.t === 'cfdg' ? ['Also on', 'Coating › 2D, the fibre (the same value)'] : b.t === 'peel' ? ['Also on', 'Pre heat treatment, its inputs (the same value)'] : null,
      ['Provenance', `${hubProvL(v.prov)}: ${hubEsc((HUB_PROV[v.prov] || HUB_PROV_RO[v.prov] || {}).d || '')}`],
      b.t === 'card' || b.t === 'inp' ? ['Source', `<input type="text" class="hub-src hub-src-d" id="hubsrc_${p.id}" data-hubsrc="${p.id}" value="${hubEsc(v.src)}" aria-label="${hubEsc(p.l)}: source">`] : ['Source', hubEsc(v.src)],
    ])}${usedHTML}</div>`;
  }
  if (b.t === 'calc') return `<div class="hub-d">${kv([['Definition', 'Calculated'], ['How', hubEsc(v.src)], si ? ['In SI', si] : null])}${usedHTML}</div>`;
  if (b.t === 'const') { const c = HUB_CONST[b.id]; return `<div class="hub-d">${kv([['Definition', 'Constant, built into the solver'], ['Value', `${hubFmt(c.v, -6)} ${hubEsc(c.u)}`], ['Source', hubEsc(c.src)], ['In the code', `<code>${hubEsc(c.solver)}</code>`]])}${usedHTML}</div>`; }
  if (b.t === 'law') {
    const L = HUB_LAW[b.id], law = ML_LAWS[L.q.law], prm = Object.entries(L.q.params).filter(([k]) => k !== 'n' && k !== 'c').map(([k, x]) => `${k} = ${hubFmt(x, -6)}${law.params[k] ? ' ' + law.params[k] : ''}`).join(' · ');
    return `<div class="hub-d hub-d-plot"><div>${kv([['Definition', `Law in temperature: ${hubEsc(law.formula)}`], prm ? ['Parameters', hubEsc(prm)] : ['Coefficients', hubEsc((L.q.params.c || L.q.params.n || []).map(x => hubFmt(x, -6)).join(', '))],
      ['Valid', `${L.T[0]} to ${L.T[1]} °C${L.p ? ', at 1 atm' : ''}`], ['Source', hubEsc(L.src)], ['In the code', `<code>${hubEsc(L.solver)}</code>, checked against it`]])}${usedHTML}</div>
      <figure class="hub-fig"><canvas id="hubDetCv" role="img" aria-label="${hubEsc(p.l)} against temperature"></canvas></figure></div>`;
  }
  if (b.t === 'tensor') return `<div class="hub-d">${hubTensorHTML(p)}${usedHTML}</div>`;
  if (b.t === 'stiff' || b.t === 'stiffWeb') return `<div class="hub-d">${hubStiffHTML(b.t === 'stiffWeb' ? 'web' : 'go')}${usedHTML}</div>`;
  if (b.t === 'model') return `<div class="hub-d">${kv([['Law', hubEsc(ML_RHEO[CFDG.model].formula)], ['Parameters', 'the rows below; those of another law are kept, not used'], ['Its plot', '<button type="button" class="hub-link" data-hubtab="models">Models and plots</button>']])}${usedHTML}</div>`;
  if (b.t === 'measured') return `<div class="hub-d">${kv([['Definition', 'Your measurement'], ['Value', `${RHEO_MEASURED.mu} Pa·s at ${RHEO_MEASURED.gd} 1/s`], ['The law there', `${hubFmt(P.mu, -4)} Pa·s (${hubFmt((P.mu - RHEO_MEASURED.mu) / RHEO_MEASURED.mu * 100, 1)} %)`], ['Fit a flow curve', 'Measured data: import a rheometer test and use its fit']])}</div>`;
  return `<div class="hub-d">${kv([['Definition', hubEsc(v.src)]])}${usedHTML}</div>`;
}
/**
 * A property a solver can take in temperature (MH-4b): its definition -- a constant, a table in T (linear or monotone
 * cubic between its points; outside them held at its ends, carried on, or refused), or an expression in T (kelvin) --
 * edited here, checked (matlib's checks; positive over its range), plotted; the solvers that evaluate it named.
 */
function hubDefHTML(p, v) {
  const q = v.def, kind = !q ? 'const' : q.kind === 'table' ? 'table' : 'expr', [solv, range] = hubTdep(p), names = solv.map(k => hubPhys(k).l).join(' and ');
  const seg = `<span class="seg" role="tablist" aria-label="${hubEsc(p.l)}: its definition">${[['const', 'Constant'], ['table', 'Table in T'], ['expr', 'Expression in T']].map(([k, t]) => `<button type="button" role="tab" id="hubdk_${p.id}_${k}" data-hubdefkind="${p.id}|${k}" aria-selected="${k === kind}">${t}</button>`).join('')}</span>`;
  let body = '';
  if (kind === 'const') body = `<p class="hub-muted">${hubFmt(v.v, -6)} ${hubEsc(v.u)} at every temperature. A table or an expression in T makes ${names} take it at each point's temperature.</p>`;
  else if (kind === 'table') body = `<div class="hub-dt-wrap"><table class="hub-dt" aria-label="${hubEsc(p.l)} against temperature"><thead><tr><th scope="col">T <small>°C</small></th><th scope="col">${hubSym(p.sym)} <small>${hubEsc(v.u)}</small></th><th></th></tr></thead><tbody>
      ${q.x.map((x, i) => `<tr><td><input type="number" step="any" id="hubdt_${p.id}_x${i}" data-hubdt="${p.id}" data-c="x" value="${+(x - 273.15).toFixed(6)}" aria-label="Point ${i + 1}: temperature"></td><td><input type="number" step="any" id="hubdt_${p.id}_y${i}" data-hubdt="${p.id}" data-c="y" value="${q.y[i]}" aria-label="Point ${i + 1}: value"></td><td>${q.x.length > 2 ? `<button type="button" class="hub-link" id="hubdtdel_${p.id}_${i}" data-hubdtdel="${p.id}|${i}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="hub-dt-ctl"><button type="button" class="btn btn-secondary btn-sm" id="hubdtadd_${p.id}" data-hubdtadd="${p.id}">${uiIco('plus')}Add a point</button>
        <label>Between points <select class="hub-sel" id="hubdto_${p.id}_interp" data-hubdtopt="${p.id}" data-o="interp"><option value="linear"${q.interp !== 'pchip' ? ' selected' : ''}>Linear</option><option value="pchip"${q.interp === 'pchip' ? ' selected' : ''}>Monotone cubic</option></select></label>
        <label>Outside them <select class="hub-sel" id="hubdto_${p.id}_extrap" data-hubdtopt="${p.id}" data-o="extrap">${[['clamp', 'Held at the end values'], ['extrapolate', 'Carried on'], ['error', 'Refused (the solve stops)']].map(([k, t]) => `<option value="${k}"${(q.extrap || 'error') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div></div>`;
  else body = `<label class="hub-expr-l">${hubSym(p.sym)}(T) = <input type="text" class="hub-expr" id="hubdexpr_${p.id}" data-hubdexpr="${p.id}" value="${hubEsc(q.src)}" spellcheck="false" aria-label="${hubEsc(p.l)} as an expression in T"></label>
      <p class="hub-muted hub-small">T in kelvin; + − × (*) ÷ (/) ^, exp, log, sqrt, pow, min, max, abs, pi. In ${hubEsc(v.u)}.</p>`;
  return `<div class="hub-def"><div class="hub-def-h"><span class="hub-d-l">Definition</span>${seg}</div>${body}<p class="hub-err" id="hubDefErr_${p.id}" hidden></p>
    ${kind !== 'const' ? `<figure class="hub-fig hub-def-fig"><canvas id="hubDefCv" data-hubdefplot="${p.id}" role="img" aria-label="${hubEsc(p.l)} against temperature"></canvas></figure>` : ''}
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
  gab: ['Sorption isotherm (GAB)', 'X(a) = X_m C K a / ((1 − K a)(1 − K a + C K a)): the water the dry GO holds at a humidity'],
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
      const g = { Xm: MAT.dry.gabXm.v, C: MAT.dry.gabC.v, K: MAT.dry.gabK.v }, p = [];
      for (let i = 0; i <= 95; i++) p.push([i, drGAB(i / 100, g) * 100]);
      const zs = [...new Set(OVEN.zones.map(z => z.rh))];
      hubLine(cv, p, { xl: 'relative humidity (%)', yl: 'water held X (% of its mass)', x0: 0, x1: 95, aspect: 0.36, marks: [{ x: MAT.dry.rhRoom.v, c: acc, t: 'room' }, ...zs.map(rh => ({ x: rh, c: mut, t: '' }))], hl: [{ y: hubXcap() * 100, c: cssVar('--warn'), t: 'its pores full', left: true }] });
      setLg([['X(a), GAB', cssVar('--go-film')], [`the room: ${MAT.dry.rhRoom.v} %`, acc, 'dash'], [`the oven's zones: ${zs.join(', ')} %`, mut, 'dash'], ['the water its pores hold', cssVar('--warn'), 'dash']]);
    } else if (k === 'soft') {
      const Xc = hubXcap(), p = []; for (let i = 0; i <= 80; i++) { const X = Xc * 1.2 * i / 80; p.push([X, MAT.film.Ep.v / (1 + X / MAT.film.Xh.v)]); }
      hubLine(cv, p, { xl: 'water X (kg/kg)', yl: 'E₁ (GPa)', x0: 0, x1: Xc * 1.2, aspect: 0.36, marks: [{ x: MAT.film.Xh.v, c: mut, t: 'X_h' }, { x: Xc, c: cssVar('--warn'), t: '' }] });
      setLg([['E₁(X)', cssVar('--go-film')], [`X_h ${MAT.film.Xh.v}: half`, mut, 'dash'], [`its pores full: ${hubFmt(Xc, 3)}`, cssVar('--warn'), 'dash']]);
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
  return `<div class="table-wrap"><table class="cfd-table hub-used"><thead><tr><th scope="col">Solver</th><th scope="col">What it reads from ${hubEsc(r.name)}</th><th scope="col"></th></tr></thead><tbody>
    ${rows.map(([ph, ps]) => `<tr><th scope="row">${ph.l}<small>${hubEsc(ph.s)}</small></th><td class="hub-chips">${ps.map(p => `<button type="button" class="chip${hubOff(p) ? ' hub-chip-off' : ''}" data-hubopenp="${p.id}" title="${hubEsc(hubOff(p) || p.l)}">${hubEsc(p.l)}${p.sym ? ` <i>${hubSym(p.sym)}</i>` : ''}</button>`).join('')}</td><td><button type="button" class="btn btn-secondary btn-sm" data-hubgo="${ph.k}">Open</button></td></tr>`).join('')}
    ${unused.length ? `<tr><th scope="row">None<small>shown, not solved with</small></th><td class="hub-chips">${unused.map(p => `<span class="chip hub-chip-off">${hubEsc(p.l)}</span>`).join('')}</td><td></td></tr>` : ''}</tbody></table></div>`;
}

// ---- wiring the editor ----
function hubWireEditor(r) {
  view.querySelectorAll('[data-hubtab]').forEach(b => { b.onclick = () => { HUB.tab = b.dataset.hubtab; hubPaint(); }; });
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
  view.querySelectorAll('select[data-hubprov]').forEach(el => el.addEventListener('change', () => { hubSet(prop(el.dataset.hubprov), null, { prov: el.value }); hubSoon(); }));
  view.querySelectorAll('input[data-hubsrc]').forEach(el => el.addEventListener('change', () => { hubSet(prop(el.dataset.hubsrc), null, { src: el.value.trim() }); hubSoon(); }));
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.addEventListener('change', f); };
  on('matModel', e => { CFDG.model = e.target.value; rheoSync('model'); render(); });
  on('matOrModel', e => { MAT.orient.model = e.target.value; render(); });
  on('matStructOn', e => { MAT.rheo.structOn = e.target.checked; render(); });
  on('matOrOn', e => { MAT.orient.on = e.target.checked; render(); });
  on('hubFibre', e => { undoHint(`Fibre web: ${FIBRES[e.target.value].l}`); selectFibre(e.target.value); render(); });
  const rr = document.getElementById('hubRecReset');
  if (rr) rr.onclick = () => {
    undoHint(`${r.name}: back to its first values`);
    const D = matDefaults();
    for (const p of hubProps(r)) {
      const b = p.b;
      if (b.t === 'card') MAT[b.card] = { ...MAT[b.card], [b.k]: { ...D[b.card][b.k] } };
      else if (b.t === 'inp') { const c = CFG.find(q => q.k === b.k); if (P[b.k] !== c.v) setInput(b.k, c.v); if (MAT.prov) delete MAT.prov['in.' + b.k]; }
      else if (b.t === 'cfdg') CFDG[b.k] = FIBRES[CFDG.fibre].set[b.k];
      else if (b.t === 'peel') { const q = OVEN_PEEL_FIELDS.find(f => f[0] === b.k); OVEN.peel = { ...OVEN.peel, [b.k]: OVEN_PEEL_DEFAULT[b.k], [q[7]]: OVEN_PEEL_DEFAULT[q[7]] }; }
    }
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
  const defOf = id => { const p = prop(id); return { p, q: MAT[p.b.card][p.b.k].def || null, v: MAT[p.b.card][p.b.k].v }; };
  view.querySelectorAll('[data-hubdefkind]').forEach(b => { b.onclick = () => {
    const [id, k] = b.dataset.hubdefkind.split('|'), { p, q, v } = defOf(id), cur = !q ? 'const' : q.kind === 'table' ? 'table' : 'expr';
    if (k === cur) return;
    const hi = hubTdep(p)[1][1] > 300 ? 1273.15 : 373.15;
    if (k === 'const') defSet(id, null, 'constant again');
    else if (k === 'table') defSet(id, { kind: 'table', var: 'T', x: [293.15, hi], y: [v, v], interp: 'linear', extrap: 'clamp' }, 'as a table in T');
    else defSet(id, { kind: 'expr', src: String(v) }, 'as an expression in T');
  }; });
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
  view.querySelectorAll('select[data-hubdtopt]').forEach(el => el.addEventListener('change', () => {
    const id = el.dataset.hubdtopt, { q } = defOf(id);
    defSet(id, { ...q, [el.dataset.o]: el.value }, el.dataset.o === 'interp' ? 'its interpolation' : 'outside its points');
  }));
  view.querySelectorAll('input[data-hubdexpr]').forEach(el => el.addEventListener('change', () => defSet(el.dataset.hubdexpr, { kind: 'expr', src: el.value.trim() }, 'expression edited')));
  const re = document.getElementById('hubRecExport');
  if (re) re.onclick = () => hubDownload(`${r.id}.material.json`, hubExport([r.id]));
  if (HUB.tab === 'meas' && r.id === 'slurry') rtDraw();
  if (HUB.tab === 'models') requestAnimationFrame(() => hubDrawModels(r));
  if (HUB.tab === 'props' && HUB.open) requestAnimationFrame(() => {
    const p = prop(HUB.open), cv = document.getElementById('hubDetCv');
    if (p && cv && p.b.t === 'law') { const L = HUB_LAW[p.b.id]; hubLine(cv, hubLawCurve(p.b.id).map(([T, y]) => [T, y / (HUB_LAW_SCALE[p.b.id] || 1)]), { xl: 'temperature (°C)', yl: `${p.sym} (${L.u})`, x0: L.T[0], x1: L.T[1], aspect: 0.55, yf: v => hubFmt(v, -3) }); }
    const dc = document.getElementById('hubDefCv');
    if (p && dc && dc.dataset.hubdefplot === p.id) hubDrawDef(dc, p);
  });
}
/** A definition in temperature against T over the range its solvers check (the table's points marked; 20 °C marked). */
function hubDrawDef(cv, p) {
  const e = MAT[p.b.card][p.b.k], q = e.def, [, [t0, t1]] = hubTdep(p), pts = [];
  if (!q) return;
  const lo = q.kind === 'table' && (q.extrap || 'error') === 'error' ? Math.max(t0, q.x[0] - 273.15) : t0, hi = q.kind === 'table' && (q.extrap || 'error') === 'error' ? Math.min(t1, q.x[q.x.length - 1] - 273.15) : t1;
  for (let i = 0; i <= 200; i++) { const T = lo + (hi - lo) * i / 200; try { const y = hubDefAt(q, T); if (Number.isFinite(y)) pts.push([T, y]); } catch (err) { /* outside a refusing table */ } }
  const u = hubVal(p).u, extra = q.kind === 'table' ? [{ p: q.x.map((x, i) => [x - 273.15, q.y[i]]).filter(([x]) => x >= t0 && x <= t1), c: cssVar('--ink'), line: false, dots: true }] : [];
  hubLine(cv, pts, { xl: 'temperature (°C)', yl: `${p.sym.replace(/_/g, '')} (${u})`, x0: t0, x1: t1, aspect: 0.42, extra, marks: [{ x: 20, c: cssVar('--muted'), t: '20 °C' }], yf: v => hubFmt(v, -3) });
}
/** Draw the page again once the change's event is over (the focus moved on by then: it is kept). */
let hubTimer = 0;
function hubSoon() { clearTimeout(hubTimer); hubTimer = setTimeout(() => { if (tab === 13) viewMaterials(); }, 0); }

// ---- readiness ----
function hubReadyHTML() {
  const R = hubReadiness(), L = { ok: ['Firm', 'every value it reads measured, yours or built in'], warn: ['Indicative', 'it reads assumed or published values'], bad: ['Blocked', 'a material it reads cannot hold as set'] };
  const cnt = (n, ks) => ks.reduce((s, k) => s + (n[k] || 0), 0);
  const rows = R.map(q => {
    const open = HUB.readyOpen === q.ph.k, asm = q.used.flatMap(({ r, ps }) => ps.filter(p => ['published', 'assumed'].includes(hubVal(p).prov)).map(p => ({ r, p })));
    return `<tr class="hub-rd${open ? ' open' : ''}"><th scope="row"><button type="button" class="hub-pname" data-hubready="${q.ph.k}" aria-expanded="${open}"><svg class="hub-car" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>${q.ph.l}</button><small>${hubEsc(q.ph.s)}</small></th>
      <td>${q.total}<small>from ${q.used.length} materials</small></td><td class="hub-rd-bar">${hubProvBar(q.n)}</td>
      <td>${cnt(q.n, ['measured', 'fitted'])}</td><td>${cnt(q.n, ['user', 'supplier', 'report'])}</td><td>${cnt(q.n, ['published', 'assumed'])}</td><td>${cnt(q.n, ['builtin'])}</td>
      <td class="hub-st hub-st-${q.st}"><i class="hub-dot hub-${q.st}"></i>${L[q.st][0]}<small>${L[q.st][1]}</small></td><td><button type="button" class="btn btn-secondary btn-sm" data-hubgo="${q.ph.k}">Open</button></td></tr>
      ${open ? `<tr class="hub-detail"><td colspan="9">${q.probs.length ? `<ul class="hub-checks">${q.probs.map(c => `<li class="hub-${c.level === 'error' ? 'bad' : 'warn'}"><i class="hub-dot hub-${c.level === 'error' ? 'bad' : 'warn'}"></i>${hubEsc(c.r.name)}: ${hubEsc(c.msg)}</li>`).join('')}</ul>` : ''}
        ${asm.length ? `<p class="hub-d-l">Assumed or published (${asm.length}): measure these to firm it up</p><div class="hub-chips">${asm.map(({ r, p }) => `<button type="button" class="chip" data-hubjump="${r.id}|${p.id}">${hubEsc(r.name)} · ${hubEsc(p.l)}</button>`).join('')}</div>` : '<p class="hub-muted">Nothing it reads is assumed.</p>'}</td></tr>` : ''}`;
  }).join('');
  return `<div class="hub-sheet"><div class="table-wrap"><table class="cfd-table hub-ready"><thead><tr><th scope="col">Solver</th><th scope="col">Values it reads</th><th scope="col">Provenance</th><th scope="col">Measured</th><th scope="col">Yours</th><th scope="col">Assumed</th><th scope="col">Built-in</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hub-foot">Values a solver reads as things are set (a law's parameters for the law chosen, a model's when it is on). Calculated values follow the ones they come from and are not counted.</p></div>`;
}
function hubWireReady() {
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
function hubExportFile() { hubDownload(`materials-${new Date().toISOString().slice(0, 10)}.json`, hubExport()); }
function hubImportFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let res;
    try { res = hubImport(JSON.parse(await f.text())); } catch (e) { imgToast(`${f.name}: ${e.message}.`, 'error'); return; }
    if (!res.changes.length) { imgToast(`${f.name}: nothing to change${res.skipped.length ? ` (${res.skipped.length} not taken: ${res.skipped.slice(0, 3).join('; ')})` : ''}.`); return; }
    undoHint(`Import materials from ${f.name}`);
    hubImport(JSON.parse(await f.text()), true);
    imgToast(`${f.name}: ${res.changes.length} values taken${res.skipped.length ? `; ${res.skipped.length} not (${res.skipped.slice(0, 2).join('; ')})` : ''}.`);
    render();
  };
  inp.click();
}
