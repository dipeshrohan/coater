/*
 * results-viewer.js — task 13: a stage's results laid out as a viewer (the owner's choice, layout A): its views listed
 * on the left, one of them large in the middle, its key values in a column on the right; the sentences that explain a
 * view behind an (i) on it, and the inputs bar showing only the inputs (its drawings and notes behind an (i) in its head).
 * On the pages in RV_PAGES (marked body.rv-page; Pre heat, Drying, Peel and wind, Cutting, Furnace; the other stages follow, one at a time, each with the owner's yes).
 *   rvBuild(sec, key, names): before a results section draws, its views (figures, and its .rv-extra tables) moved into the
 *     viewer, only the one picked shown; its key values (.mp-stats) into the right-hand column
 *   rvAfter(): after it draws, an (i) on each view, the key values' notes in their tooltips
 */
const RV_PAGES = new Set(['stack', 'stack1d', 'stack2d', 'stack3d', 'dry', 'dry1d', 'dry2d', 'dry3d', 'peel', 'peel1d', 'peel2d', 'peel3d', 'cut', 'cut1d', 'cut2d', 'cut3d', 'furn', 'furn1d', 'furn2d', 'furn3d']);
const RV = { sel: {} };

/** The views a results section holds, in its order: its figures and its comparison tables. */
function rvViews(sec, names) {
  const out = [];
  for (const el of sec.querySelectorAll('figure.pane, .mp-compare, .rv-extra')) {
    const cv = el.querySelector('canvas'), id = el.dataset.rvid || (el.classList.contains('mp-compare') ? el.id : cv ? cv.id : '');
    if (!id) continue;
    const cap = el.querySelector('figcaption');
    out.push({ id, el, t: names[id] || (cap ? cap.textContent.trim() : id) });
  }
  return out;
}

/** Before the section draws: the viewer built around its views, the one picked shown (the first, until another is). */
function rvBuild(sec, key, names = {}) {
  if (!sec || sec.querySelector(':scope > .rv')) return;
  const views = rvViews(sec, names), stats = sec.querySelector('.mp-stats');
  if (!views.length) return;
  const sel = views.some(v => v.id === RV.sel[key]) ? RV.sel[key] : views[0].id;   // (the list's first state; rvSync keeps it)
  const wrap = document.createElement('div');
  wrap.className = 'rv';
  wrap.dataset.rvkey = key;
  wrap.innerHTML = `<nav class="rv-list" role="tablist" aria-label="The view shown"><h5>Results</h5>${views.map(v => `<button type="button" role="tab" data-rvview="${v.id}" aria-selected="${v.id === sel}">${v.t}</button>`).join('')}</nav>
    <div class="rv-main"></div><aside class="rv-keys" aria-label="Key values"><h5>Key values</h5></aside>`;
  const main = wrap.querySelector('.rv-main');
  for (const v of views) { main.appendChild(v.el); v.el.dataset.rvid = v.id; v.el.classList.add('rv-view'); }
  if (stats) wrap.querySelector('.rv-keys').appendChild(stats);
  sec.prepend(wrap);
  // (a bar of switches for every view, as the furnace's run: kept above the viewer)
  for (const c of sec.querySelectorAll(':scope > .mp-runbar')) sec.insertBefore(c, wrap);
  for (const g of sec.querySelectorAll(':scope > .mp-grid')) if (!g.children.length) g.remove();
  rvSync(wrap);
}

/** A viewer's view shown as picked (the first, until another is): before its charts draw, so the one shown fills its place.
 * (The report, PROC_ALL: every view shown, each drawn at its full width.) */
function rvSync(wrap) {
  if (!wrap) return;
  const views = [...wrap.querySelectorAll('.rv-main > .rv-view')], ids = views.map(v => v.dataset.rvid), key = wrap.dataset.rvkey;
  const sel = ids.includes(RV.sel[key]) ? RV.sel[key] : ids[0];
  const all = typeof PROC_ALL !== 'undefined' && PROC_ALL;
  for (const v of views) v.hidden = !all && v.dataset.rvid !== sel;
  // (a wide view, a table of every location: the key values' column given to it -- the table holds them all)
  wrap.classList.toggle('rv-wide', !all && views.some(v => v.dataset.rvid === sel && v.classList.contains('rv-wide')));
  for (const b of wrap.querySelectorAll('[data-rvview]')) b.setAttribute('aria-selected', String(b.dataset.rvview === sel));
}

/** After the section draws: an (i) on each view that has sentences to explain it (those under its chart); the key
 * values' notes in their tooltips. */
function rvAfter() {
  for (const v of document.querySelectorAll('.rv .rv-view')) {
    const cap = v.querySelector('figcaption') || v.querySelector('h4');
    if (cap && !cap.querySelector('.rv-i') && (v.querySelector('.pane-legend p.fv-why') || (v.classList.contains('mp-compare') && v.querySelector(':scope > p.fv-why')))) cap.insertAdjacentHTML('beforeend', '<button type="button" class="rv-i" data-rvi aria-label="What it shows" title="What it shows">i</button>');
  }
  for (const s of document.querySelectorAll('.rv-keys .stat')) {
    const lab = s.querySelector('span'), sm = s.querySelector('small');
    if (sm && sm.textContent.trim()) s.title = `${lab ? lab.textContent.trim() : ''}: ${sm.textContent.trim()}`;
  }
}

/** The inputs bar's (i): its drawings and notes shown again (or hidden), on the viewer's pages. */
function rvTreeButton() {
  const reset = document.getElementById('reset');
  if (reset && !document.querySelector('[data-rvnotes]')) reset.insertAdjacentHTML('beforebegin', '<button type="button" class="rv-i rv-i-tree" data-rvnotes aria-pressed="false" aria-label="Show the drawings and notes" title="Show the drawings and notes">i</button>');
}

document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-rvview], [data-rvi], [data-rvnotes], [data-rvabout]');
  if (!t) return;
  if (t.dataset.rvabout) { const a = document.getElementById(t.dataset.rvabout); if (a) { a.hidden = !a.hidden; t.setAttribute('aria-expanded', String(!a.hidden)); } return; }
  if (t.dataset.rvview) { const w = t.closest('.rv'); RV.sel[w.dataset.rvkey] = t.dataset.rvview; render(); return; }
  if ('rvi' in t.dataset) { const v = t.closest('.rv-view'); if (v) { v.classList.toggle('rv-notes'); t.setAttribute('aria-pressed', String(v.classList.contains('rv-notes'))); } return; }
  if ('rvnotes' in t.dataset) { const on = document.body.classList.toggle('rv-tree-notes'); t.setAttribute('aria-pressed', String(on)); }
});
rvTreeButton();
