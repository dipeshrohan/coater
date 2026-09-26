/*
 * cfd-custom.js — the custom blade profile's editor (Flow › 2D › Geometry, blade Custom): its points in a
 * table (x, y, corner, M, C), placed by clicking on the drawing (joined by a spline), or read from CSV / text
 * points, a DXF drawing (lines, arcs, polylines, splines) or a side section of the 3D page's STL / STEP blade;
 * flipped left-right or up-down. The points are CFDG.custom (mm, cfd-ui.js); cfd-blade.js's customProfile makes
 * the profile from them (corners where the outline turns more than cornerDeg unless ticked or unticked; M, the
 * metering point, and C, the simple model's wetted end, automatic unless picked).
 */

/** Whether clicks on the drawing add points (Place points). */
let CUST_PLACE = false;
const CUST_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const custEsc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Set the custom profile (an undo step named what), redraw. */
function custSet(c, what) {
  undoHint(`Custom profile: ${what}`);
  CFDG.custom = c;
  if (tab === 4) viewCFD(); else render();
}
/**
 * Points [{ x, y, bulge, corner }] (m or the file's units x scale to mm) opened into the profile's order (inlet, M,
 * face; the blade's back and top left out) as the custom profile, M and C automatic.
 */
function custFromOutline(verts, closed, scaleMM, name, join = 'straight') {
  const o = openProfile(verts.map(v => ({ ...v, x: v.x * scaleMM, y: v.y * scaleMM })), closed);
  if (!o || o.length < 3) { imgToast('No blade outline found there: it needs an underside falling to a lowest point and a face rising from it.', 'error'); return false; }
  const cur = CFDG.custom || customDefault();
  custSet({ verts: o.map(v => ({ x: +v.x.toFixed(6), y: +v.y.toFixed(6), ...(v.bulge ? { bulge: v.bulge } : {}), ...(v.corner === true || v.corner === false ? { corner: v.corner } : {}) })), join, cornerDeg: cur.cornerDeg ?? 10, M: null, C: null, name }, `${o.length} points ${name}`);
  return true;
}

/** The editor in the Geometry step's side panel. b: bladeMM's (the profile made from the points). */
function customEditorHTML(b) {
  const c = CFDG.custom || customDefault(), p = b.prof, corners = new Set(p && p.auto ? p.auto.corners : []);
  const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  const rows = c.verts.map((v, k) => `<tr${k === p.Mi ? ' class="on"' : ''}><td>${k + 1}</td>
    <td><input type="number" class="cust-x" data-k="${k}" step="0.01" value="${+v.x.toFixed(4)}" aria-label="Point ${k + 1} x (mm)"></td>
    <td><input type="number" class="cust-y" data-k="${k}" step="0.01" value="${+v.y.toFixed(4)}" aria-label="Point ${k + 1} y (mm)"></td>
    <td><input type="checkbox" class="cust-c" data-k="${k}"${corners.has(k) ? ' checked' : ''}${k === 0 || k === c.verts.length - 1 ? ' disabled' : ''} aria-label="Point ${k + 1} is a corner"${v.corner == null ? ' title="automatic (by the turning angle)"' : ' title="set by hand"'}>${v.corner == null ? '' : '<span class="cust-set" title="set by hand">•</span>'}</td>
    <td><input type="radio" name="custM" class="cust-m" data-k="${k}"${k === p.Mi ? ' checked' : ''}${k === 0 || k === c.verts.length - 1 ? ' disabled' : ''} aria-label="M at point ${k + 1}"></td>
    <td><input type="radio" name="custC" class="cust-cc" data-k="${k}"${k === p.Ci ? ' checked' : ''}${k < p.Mi || k === c.verts.length - 1 ? ' disabled' : ''} aria-label="C at point ${k + 1}"></td>
    <td><button type="button" class="icon-btn cust-del" data-k="${k}" aria-label="Delete point ${k + 1}"${c.verts.length <= 3 ? ' disabled' : ''}>✕</button></td></tr>`).join('');
  return `<h4>${uiBadge('shape')}Custom profile</h4>
    <p class="side-note">${custEsc(c.name || 'points')} · ${c.verts.length} points · M at point ${p.Mi + 1}${c.M == null ? ' (automatic)' : ''} · C at point ${p.Ci + 1}${c.C == null ? ' (automatic)' : ''}${b.err ? ` · <b class="warn-text">${custEsc(b.err)}</b>` : ''}</p>
    <div class="cust-tools">
      <button type="button" class="btn btn-secondary btn-sm" id="custCSV">Paste CSV…</button>
      <button type="button" class="btn btn-secondary btn-sm" id="custDXF">Load DXF…</button><input type="file" id="custDXFFile" accept=".dxf" hidden>
      <button type="button" class="btn btn-secondary btn-sm" id="custSTL">From STL/STEP…</button>
      <button type="button" class="btn btn-secondary btn-sm${CUST_PLACE ? ' on' : ''}" id="custPlace" aria-pressed="${CUST_PLACE}" title="Click on the drawing to add points, in order from the inlet round the metering point and up the face">${CUST_PLACE ? 'Placing: click the drawing' : 'Place points'}</button>
      <button type="button" class="btn btn-secondary btn-sm" id="custFlipX" title="Mirror left to right">Flip ↔</button>
      <button type="button" class="btn btn-secondary btn-sm" id="custFlipY" title="Mirror top to bottom">Flip ↕</button>
    </div>
    <div class="cust-opts">
      <label class="fv-ctl">Joined by <select id="custJoin">${opt('straight', 'straight lines', c.join)}${opt('spline', 'a spline', c.join)}</select></label>
      <label class="fv-ctl">Corner above <input type="number" id="custCornerDeg" min="1" max="90" step="1" value="${c.cornerDeg ?? 10}"> °</label>
      <button type="button" class="btn btn-secondary btn-sm" id="custAuto" title="Corners by the turning angle; M and C found again">Automatic corners, M, C</button>
    </div>
    <div class="table-wrap cust-table"><table class="cfd-table"><thead><tr><th>#</th><th>x (mm)</th><th>y (mm)</th><th>Corner</th><th>M</th><th>C</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="cust-tools"><button type="button" class="btn btn-secondary btn-sm" id="custAdd">Add a point</button></div>
    <p class="side-note">In order from the inlet, round the metering point M (the gap H there) and up the face. The underside must be one height at each x (it can step straight down or up); the face must rise. Straight lines are rounded at the points that are not corners. On the drawing: drag a point, double-click it to make it a corner or smooth, drag M or C onto another point.</p>`;
}

/** Wire the editor (after renderGeometry2D). */
function wireCustomEditor(host) {
  const c = () => CFDG.custom || customDefault();
  const g = id => host.querySelector('#' + id);
  const edit = (fn, what) => { const cc = JSON.parse(JSON.stringify(c())); fn(cc); custSet(cc, what); };
  host.querySelectorAll('.cust-x, .cust-y').forEach(el => el.addEventListener('change', () => {
    const k = +el.dataset.k, v = +el.value;
    if (!Number.isFinite(v)) { el.value = c().verts[k][el.classList.contains('cust-x') ? 'x' : 'y']; return; }
    edit(cc => { cc.verts[k][el.classList.contains('cust-x') ? 'x' : 'y'] = v; }, `point ${k + 1} ${el.classList.contains('cust-x') ? 'x' : 'y'} ${v} mm`);
  }));
  host.querySelectorAll('.cust-c').forEach(el => el.addEventListener('change', () => { const k = +el.dataset.k; edit(cc => { cc.verts[k].corner = el.checked; }, `point ${k + 1} ${el.checked ? 'a corner' : 'smooth'}`); }));
  host.querySelectorAll('.cust-m').forEach(el => el.addEventListener('change', () => { const k = +el.dataset.k; edit(cc => { cc.M = k; if (cc.C != null && cc.C < k) cc.C = null; }, `M at point ${k + 1}`); }));
  host.querySelectorAll('.cust-cc').forEach(el => el.addEventListener('change', () => { const k = +el.dataset.k; edit(cc => { cc.C = k; }, `C at point ${k + 1}`); }));
  host.querySelectorAll('.cust-del').forEach(el => el.addEventListener('click', () => {
    const k = +el.dataset.k;
    edit(cc => { cc.verts.splice(k, 1); for (const q of ['M', 'C']) if (cc[q] != null) cc[q] = cc[q] === k ? null : cc[q] > k ? cc[q] - 1 : cc[q]; }, `point ${k + 1} deleted`);
  }));
  const add = g('custAdd');
  if (add) add.onclick = () => edit(cc => { const a = cc.verts[cc.verts.length - 2], b = cc.verts[cc.verts.length - 1]; cc.verts.push({ x: +(2 * b.x - a.x).toFixed(4), y: +(2 * b.y - a.y).toFixed(4) }); }, 'a point added');
  const join = g('custJoin');
  if (join) join.onchange = () => edit(cc => { cc.join = join.value; }, `joined by ${join.value === 'spline' ? 'a spline' : 'straight lines'}`);
  const cd = g('custCornerDeg');
  if (cd) cd.onchange = () => guardNumber(cd, { label: 'Corner above', lo: 1, hi: 90, unit: '°' }, v => edit(cc => { cc.cornerDeg = v; }, `corners above ${v}°`));
  const auto = g('custAuto');
  if (auto) auto.onclick = () => edit(cc => { cc.verts.forEach(v => { delete v.corner; }); cc.M = null; cc.C = null; }, 'corners, M and C automatic');
  // (a mirror of the points as they are, arcs turning the other way: twice gives them back)
  const flip = (ax, what) => edit(cc => { cc.verts = cc.verts.map(v => ({ ...v, x: ax === 'x' ? -v.x : v.x, y: ax === 'y' ? -v.y : v.y, ...(v.bulge ? { bulge: -v.bulge } : {}) })); }, what);
  const fx = g('custFlipX'), fy = g('custFlipY');
  if (fx) fx.onclick = () => flip('x', 'flipped left-right');
  if (fy) fy.onclick = () => flip('y', 'flipped up-down');
  const place = g('custPlace');
  if (place) place.onclick = () => {
    if (!CUST_PLACE) {
      // (a new profile: the points clicked, in order, joined by a spline; the drawing keeps its frame meanwhile)
      const hd = document.getElementById('geoDraw'), sv = hd && hd.querySelector('svg');
      CUST_FRAME = hd && hd._frame && sv ? { ...hd._frame, w: sv.viewBox.baseVal.width, h: sv.viewBox.baseVal.height } : null;
      CUST_PLACE = true;
      undoHint('Custom profile: placing points');
      CFDG.custom = { verts: [], join: 'spline', cornerDeg: c().cornerDeg ?? 10, M: null, C: null, name: 'placed points' };
      imgToast('Click on the drawing from the inlet, round the lowest point, up the face; press Place points again when done.');
    } else CUST_PLACE = false;
    if (tab === 4) viewCFD(); else render();
  };
  const csv = g('custCSV');
  if (csv) csv.onclick = custCSVDialog;
  const dxf = g('custDXF'), dxfF = g('custDXFFile');
  if (dxf && dxfF) { dxf.onclick = () => dxfF.click(); dxfF.onchange = () => { const f = dxfF.files && dxfF.files[0]; if (f) custDXFDialog(f); dxfF.value = ''; }; }
  const stl = g('custSTL');
  if (stl) stl.onclick = custSTLDialog;
}

/**
 * Place points: a click on the drawing (x relative to M, y above the web, mm) adds one at the end. b: the drawing's
 * blade (bladeMM): while its profile is not yet possible the points are drawn as placed; once it is, the drawing has
 * M at x = 0 and the gap there, and a click is taken back to the points' own frame.
 */
function custPlaceClick(x, y, b) {
  const cc = JSON.parse(JSON.stringify(CFDG.custom || { verts: [], join: 'spline', cornerDeg: 10, M: null, C: null, name: 'placed points' }));
  const pv = b && b.prof && b.prof.placed && b.prof.verts, v0 = cc.verts[0];
  if (pv && v0) { x += b.X + v0.x - pv[0].x * 1000; y += v0.y - pv[0].y * 1000; }
  cc.verts.push({ x: +x.toFixed(3), y: +y.toFixed(3) });
  undoHint(`Custom profile: point ${cc.verts.length} placed`);
  CFDG.custom = cc;
  if (tab === 4) viewCFD(); else render();
}

/** A dialog (the app's): its form built by html(), wired by wire(dlg). */
function custDialog(id, title, html, wire) {
  let dlg = document.getElementById(id);
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = id; dlg.className = 'img-dlg cust-dlg'; dlg.setAttribute('aria-labelledby', id + 'H'); document.body.appendChild(dlg); }
  const draw = () => {
    dlg.innerHTML = `<form method="dialog" class="img-form"><div class="img-head"><h2 id="${id}H">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>${html()}</form>`;
    dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
    wire(dlg, draw);
  };
  draw();
  if (!dlg.open) dlg.showModal();
  return dlg;
}
const custUnitSel = (id, cur) => `<label class="fv-ctl">Units <select id="${id}">${Object.keys(CUST_UNITS).map(u => `<option${u === cur ? ' selected' : ''}>${u}</option>`).join('')}</select></label>`;

/** Paste CSV / text points: x, y (and a corner column, 1 / 0) per line. */
function custCSVDialog() {
  const st = { text: '', units: 'mm' };
  custDialog('custCsvDlg', 'Custom profile from points', () => {
    const pts = parsePointsCSV(st.text);
    return `<p class="fv-note">One point per line: x, y (commas, semicolons, tabs or spaces; a header line is skipped; a third column 1 or 0 marks a corner). The machine direction to the right, up from the web; any origin. An outline of the whole blade is cut open at the inlet and the face's top.</p>
      <textarea id="custCsvText" rows="10" class="mono cust-text" spellcheck="false" aria-label="Points">${custEsc(st.text)}</textarea>
      <div class="cust-opts">${custUnitSel('custCsvUnits', st.units)}<span class="fv-why" id="custCsvN">${pts.length} points read</span></div>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="submit" class="btn btn-primary btn-sm" id="custCsvGo">Use these points</button></div>`;
  }, (dlg, draw) => {
    const ta = dlg.querySelector('#custCsvText'), n = dlg.querySelector('#custCsvN');
    ta.oninput = () => { st.text = ta.value; n.textContent = `${parsePointsCSV(st.text).length} points read`; };
    dlg.querySelector('#custCsvUnits').onchange = e => { st.units = e.target.value; };
    dlg.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const pts = parsePointsCSV(st.text);
      if (pts.length < 3) { imgToast('At least 3 points are needed.', 'error'); return; }
      const a = pts[0], z = pts[pts.length - 1], closed = pts.length > 3 && Math.hypot(a.x - z.x, a.y - z.y) < 1e-9 * (1 + Math.abs(a.x) + Math.abs(a.y));
      if (custFromOutline(closed ? pts.slice(0, -1) : pts, closed, CUST_UNITS[st.units], 'from pasted points')) dlg.close();
    };
    void draw;
  });
}

/** A DXF drawing: its lines, arcs, polylines and splines joined; the outline with the lowest point used (arcs kept). */
async function custDXFDialog(file) {
  let d;
  try { d = parseDXF(await file.text()); } catch (e) { imgToast(`Could not read ${file.name}: ${e.message}`, 'error'); return; }
  if (!d.chains.length) { imgToast(`${file.name}: no lines, arcs or polylines found.`, 'error'); return; }
  const low = ch => Math.min(...ch.verts.map(v => v.y));
  const chains = d.chains.slice().sort((a, b) => low(a) - low(b));
  const st = { pick: 0, units: d.units ? Object.keys(CUST_UNITS).find(u => Math.abs(CUST_UNITS[u] - d.units * 1000) < 1e-9) || 'mm' : 'mm' };
  custDialog('custDxfDlg', 'Custom profile from a DXF drawing', () => `
    <p class="fv-note">${custEsc(file.name)}: ${d.chains.length} outline${d.chains.length > 1 ? 's' : ''} joined from its lines, arcs, polylines and splines${d.units ? `; units in the file: ${st.units}` : '; no units in the file'}. The machine direction to the right, up from the web (flip it afterwards if not). Arcs stay arcs.</p>
    <label class="fv-ctl">Outline <select id="custDxfPick">${chains.map((ch, k) => `<option value="${k}"${k === st.pick ? ' selected' : ''}>${k + 1}: ${ch.verts.length} points, ${ch.closed ? 'closed' : 'open'}${k === 0 ? ' (the lowest)' : ''}</option>`).join('')}</select></label>
    <div class="cust-opts">${custUnitSel('custDxfUnits', st.units)}</div>
    <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="submit" class="btn btn-primary btn-sm">Use this outline</button></div>`, (dlg, draw) => {
    dlg.querySelector('#custDxfPick').onchange = e => { st.pick = +e.target.value; };
    dlg.querySelector('#custDxfUnits').onchange = e => { st.units = e.target.value; };
    dlg.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const ch = chains[st.pick];
      if (custFromOutline(ch.verts, ch.closed, CUST_UNITS[st.units], `from ${file.name}`)) dlg.close();
    };
    void draw;
  });
}

/** A side section of the 3D page's blade file (or one loaded here, which becomes the 3D page's file), cut at z across. */
function custSTLDialog() {
  const st = { z: null, err: null, busy: false };
  const loops = () => {
    const t = c3dOrientedFile();
    if (!t) return null;
    const b = trisBox(t);
    if (st.z == null || st.z < b.min[2] || st.z > b.max[2]) st.z = +(((b.min[2] + b.max[2]) / 2) * 1000).toFixed(3) / 1000;
    return { b, loops: sectionTris(t, st.z) };
  };
  custDialog('custStlDlg', 'Custom profile from a section of a 3D blade', () => {
    const f = C3D_FILE, L = f ? loops() : null, open = L && L.loops.length ? openProfile(L.loops[0].verts, L.loops[0].closed) : null;
    // a small preview: the section's outlines, the part used in the profile thick
    let svg = '';
    if (L && L.loops.length) {
      const all = L.loops.flatMap(q => q.verts), x0 = Math.min(...all.map(v => v.x)), x1 = Math.max(...all.map(v => v.x)), y0 = Math.min(...all.map(v => v.y)), y1 = Math.max(...all.map(v => v.y));
      const W = 480, Hh = 180, k = Math.min((W - 20) / (x1 - x0 || 1), (Hh - 20) / (y1 - y0 || 1)), X = x => 10 + (x - x0) * k, Y = y => Hh - 10 - (y - y0) * k;
      svg = `<svg class="cust-prev" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="The section">${L.loops.map(q => `<polyline class="sec-loop" points="${[...q.verts, ...(q.closed ? [q.verts[0]] : [])].map(v => `${X(v.x).toFixed(1)},${Y(v.y).toFixed(1)}`).join(' ')}"/>`).join('')}${open ? `<polyline class="sec-used" points="${open.map(v => `${X(v.x).toFixed(1)},${Y(v.y).toFixed(1)}`).join(' ')}"/>` : ''}</svg>`;
    }
    return `<p class="fv-note">${f ? `The 3D page's blade: ${custEsc(f.name)} (${(f.tris.length / 9).toLocaleString()} triangles), turned by the 3D page's axes (machine direction ${C3D.machine}, up ${C3D.up}${f.kind === 'step' ? '' : `, units ${C3D.units}`}).` : 'No blade file on the 3D page yet: load one (it becomes the 3D page\'s blade file too).'}</p>
      <div class="cust-opts"><button type="button" class="btn btn-secondary btn-sm" id="custStlLoad">${f ? 'Load another file…' : 'Load an STL or STEP file…'}</button><input type="file" id="custStlFile" accept=".stl,.step,.stp" hidden>
      ${L ? `<label class="fv-ctl">Cut at z <input type="number" id="custStlZ" step="0.1" min="${(L.b.min[2] * 1000).toFixed(2)}" max="${(L.b.max[2] * 1000).toFixed(2)}" value="${+(st.z * 1000).toFixed(3)}"> mm <span class="fv-why">(${(L.b.min[2] * 1000).toFixed(1)} to ${(L.b.max[2] * 1000).toFixed(1)})</span></label>` : ''}</div>
      ${svg}${L ? `<p class="fv-why">${L.loops.length} outline${L.loops.length === 1 ? '' : 's'} in the section; ${open ? `the thick line (${open.length} points) becomes the profile: the underside of the lowest outline and the face above its lowest point.` : 'no blade outline found at this z.'}</p>` : ''}
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="submit" class="btn btn-primary btn-sm"${open ? '' : ' disabled'}>Use this section</button></div>`;
  }, (dlg, draw) => {
    const load = dlg.querySelector('#custStlLoad'), fi = dlg.querySelector('#custStlFile');
    load.onclick = () => fi.click();
    fi.onchange = async () => {
      const file = fi.files && fi.files[0]; fi.value = '';
      if (!file) return;
      try {
        const { tris, kind } = await c3dReadBladeFile(file);
        undoHint(`Import 3D blade ${file.name}`);
        c3dFileIn({ name: file.name, kind, tris, id: String(Date.now()) });
        st.z = null; draw();
      } catch (e) { imgToast(`Could not import ${file.name}: ${e.message}`, 'error'); }
    };
    const z = dlg.querySelector('#custStlZ');
    if (z) z.onchange = () => { const v = +z.value / 1000; if (Number.isFinite(v)) { st.z = v; draw(); } };
    dlg.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const L = loops();
      if (!L || !L.loops.length) return;
      if (custFromOutline(L.loops[0].verts, L.loops[0].closed, 1000, `section of ${C3D_FILE.name} at z ${+(st.z * 1000).toFixed(2)} mm`)) dlg.close();
    };
  });
}
