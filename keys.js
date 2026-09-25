/*
 * keys.js — keyboard shortcuts: one list of actions, each with a default key that can be changed
 * (in Help > Keyboard shortcuts; kept in this browser), and one handler for them all.
 *
 * Run (Ctrl+Enter) and Stop (Esc) act on the tab shown: 2D CFD, DOE, Measured data. The
 * view keys (Alt + a letter or digit) drive the CFD flow plot; Ctrl+B and Ctrl+J hide and show
 * the inputs bar and the bottom panel. Keys without Ctrl or Alt are not taken while typing in a box,
 * and Ctrl+Z / Ctrl+Y in a text box stay the browser's own text undo.
 */

const KEYS_STORE = 'bladeCoatDefectLab.keys.v1';
const KEYS_CAPTURE = { on: false };   // (a key is being recorded in the key editor)
const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform || '');
/** The tab showing's solving, if any. */
const tabRunning = () => tab === 4 ? cfdRuns.some(r => r.status === 'running') || !!(meshStudy && meshStudy.status === 'running')
  : tab === 5 ? DOE.status === 'running' : tab === 6 ? MQ.active.size + MQ.jobs.length > 0 : tab === 9 ? C3D_RUN.status === 'running' : false;
const onCfd = () => tab === 4 && !!document.getElementById('cfdWb');
/** Click a zoom button of the flow plot(s) shown. */
const zoomClick = z => { const bs = document.querySelectorAll(`#cfdPlots .zoom-ctl [data-z="${z}"]`); if (!bs.length) return false; bs.forEach(b => b.click()); return true; };
const setFvView = v => { if (!onCfd()) return false; FV.view = v; viewCFD(); return true; };
/** The bottom panel's tabs of the view shown, and the selected one. */
function dockCycle(step) {
  const bs = [...document.querySelectorAll('#view .dock-tabs button[role="tab"]')];
  if (bs.length < 2) return false;
  const k = bs.findIndex(b => b.getAttribute('aria-selected') === 'true');
  const b = bs[(k + step + bs.length) % bs.length];
  setPanelHidden('dock', false);
  b.click(); b.focus();
  return true;
}

const KEY_ACTIONS = [
  { id: 'file.new', g: 'File', l: 'New project', def: '', run: () => newProject() },
  { id: 'file.open', g: 'File', l: 'Open project…', def: 'Ctrl+O', run: () => openProject() },
  { id: 'file.save', g: 'File', l: 'Save', def: 'Ctrl+S', run: () => saveProject(false) },
  { id: 'file.saveAs', g: 'File', l: 'Save as…', def: 'Ctrl+Shift+S', run: () => saveProject(true) },
  { id: 'file.import', g: 'File', l: 'Import measured data…', def: '', run: () => importMeasured() },
  { id: 'file.report', g: 'File', l: 'Report…', def: '', run: () => openReportDialog() },
  { id: 'file.image', g: 'File', l: 'Save as image…', def: '', run: () => openImageDialog() },
  { id: 'edit.undo', g: 'Edit', l: 'Undo (in this view)', def: 'Ctrl+Z', text: false, run: () => undo() },
  { id: 'edit.redo', g: 'Edit', l: 'Redo', def: 'Ctrl+Y', text: false, run: () => redo() },
  { id: 'edit.redo2', g: 'Edit', l: 'Redo (second key)', def: 'Ctrl+Shift+Z', text: false, run: () => redo() },
  { id: 'run.run', g: 'Run', l: 'Run the tab shown: all four CFD locations, the DOE, the measured dataset in the CFD, or the 3D', def: 'Ctrl+Enter',
    when: () => [4, 5, 6, 9].includes(tab),
    run: () => { if (tab === 4) runAllLocations(); else if (tab === 5) runDOE(); else if (tab === 6) measRunCfd(measSelected()); else if (tab === 9) c3dRun(); } },
  { id: 'run.stop', g: 'Run', l: 'Stop what the tab shown is solving', def: 'Escape', when: () => tabRunning(),
    run: () => { if (tab === 4) cancelAllLocations(); else if (tab === 5) stopDOE(); else if (tab === 6) measStopCfd(); else if (tab === 9) c3dStop(); } },
  { id: 'view.fit', g: 'View (CFD flow plot)', l: 'Whole domain (fit)', def: 'Alt+F', when: onCfd, run: () => zoomClick('fit') },
  { id: 'view.in', g: 'View (CFD flow plot)', l: 'Zoom in', def: 'Alt+=', when: onCfd, run: () => zoomClick('in') },
  { id: 'view.out', g: 'View (CFD flow plot)', l: 'Zoom out', def: 'Alt+-', when: onCfd, run: () => zoomClick('out') },
  { id: 'view.edge', g: 'View (CFD flow plot)', l: 'Zoom to the metering edge', def: 'Alt+E', when: onCfd, run: () => zoomClick('edge') },
  { id: 'view.meniscus', g: 'View (CFD flow plot)', l: 'Zoom to the meniscus', def: 'Alt+M', when: onCfd, run: () => zoomClick('meniscus') },
  ...[0, 1, 2, 3].map(i => ({ id: `view.l${i + 1}`, g: 'View (CFD flow plot)', l: `Location ${i + 1}`, def: `Alt+${i + 1}`, when: onCfd, run: () => setFvView(i) })),
  { id: 'view.compare', g: 'View (CFD flow plot)', l: 'Compare the four locations', def: 'Alt+C', when: onCfd, run: () => setFvView('compare') },
  { id: 'view.diff', g: 'View (CFD flow plot)', l: 'Difference plot', def: 'Alt+D', when: onCfd, run: () => setFvView('diff') },
  { id: 'panel.model', g: 'Panels', l: 'Hide / show the inputs', def: 'Ctrl+B', run: () => setPanelHidden('model', !panelHidden('model')) },
  { id: 'panel.dock', g: 'Panels', l: 'Hide / show the bottom panel', def: 'Ctrl+J', when: () => !!document.querySelector('#view .dock'), run: () => setPanelHidden('dock', !panelHidden('dock')) },
  { id: 'panel.next', g: 'Panels', l: 'Next tab of the bottom panel', def: 'Alt+]', when: () => !!document.querySelector('#view .dock-tabs'), run: () => dockCycle(1) },
  { id: 'panel.prev', g: 'Panels', l: 'Previous tab of the bottom panel', def: 'Alt+[', when: () => !!document.querySelector('#view .dock-tabs'), run: () => dockCycle(-1) },
  { id: 'help.open', g: 'Help', l: 'Help', def: '', run: () => openHelp() },
  { id: 'help.keys', g: 'Help', l: 'Keyboard shortcuts', def: '', run: () => openHelp('keys') },
];
const KEY_BY_ID = new Map(KEY_ACTIONS.map(a => [a.id, a]));
const KEY_MAP = (() => { try { const m = JSON.parse(localStorage.getItem(KEYS_STORE) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } })();
const saveKeyMap = () => { try { localStorage.setItem(KEYS_STORE, JSON.stringify(KEY_MAP)); } catch (e) { /* not kept */ } };
/** An action's key now: changed here, else its default ('' = none). */
const keyOf = id => (id in KEY_MAP ? KEY_MAP[id] : (KEY_BY_ID.get(id) || {}).def) || '';
/** A key as shown (Cmd on a Mac). */
const keyLabel = id => { const k = keyOf(id); return k ? (IS_MAC ? k.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥') : k).replace('Escape', 'Esc') : ''; };

/** The key of an event, as 'Ctrl+Alt+Shift+K' (letters and digits by their place on the keyboard, so Alt on a Mac works). */
function comboOf(e) {
  const c = e.code || '';
  let k = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^Numpad\d$/.test(c) ? c.slice(6)
    : { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\', Backquote: '`', NumpadAdd: '+', NumpadSubtract: '-', NumpadEnter: 'Enter' }[c]
    || (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!k || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(k)) return '';
  if (k === ' ') k = 'Space';
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}
const typingIn = t => t && (t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(t.type)));
const textBox = t => t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && ['text', 'search', 'email', 'url'].includes(t.type)));
/** Esc is taken by something open (a menu, a dialog, the colour panel, placing probes or a cut, a help card). */
function escTaken() {
  if (document.querySelector('dialog[open], .vp-pop[open], .tree.tree-flyout')) return true;
  const cb = document.getElementById('cbarPop'); if (cb && !cb.hidden) return true;
  const hc = document.getElementById('helpCard'); if (hc && !hc.hidden) return true;
  return !!(typeof placeCut !== 'undefined' && placeCut) || !!(typeof placeProbes !== 'undefined' && placeProbes);
}
document.addEventListener('keydown', e => {
  if (KEYS_CAPTURE.on || e.repeat && !/^Alt\+(=|-)$/.test(comboOf(e))) return;
  const combo = comboOf(e);
  if (!combo) return;
  const plain = !/^(Ctrl|Alt)\+/.test(combo);
  if (plain && combo !== 'Escape' && typingIn(e.target)) return;
  if (combo === 'Escape' && escTaken()) return;
  if (document.querySelector('dialog[open]') && combo !== 'Escape') return;   // (a dialog has the keys)
  const a = KEY_ACTIONS.find(x => keyOf(x.id) === combo);
  if (!a) return;
  if (a.text === false && textBox(e.target)) return;
  if (a.when && !a.when()) return;
  e.preventDefault();
  a.run();
}, true);

// ---- the inputs bar and the bottom panel, hidden or shown (remembered in this browser) ----
const PANELS_STORE = 'bladeCoatDefectLab.panels.v1';
// (the four simple tabs' bottom panel holds only their history: hidden until opened (Edit > History);
// the inputs bar has its own state on the Summary page, which opens without it)
const PANELS = (() => { const d = { model: false, dock: false, modDock: true, modelHome: true }; try { return { ...d, ...JSON.parse(localStorage.getItem(PANELS_STORE) || '{}') }; } catch (e) { return d; } })();
const panelKey = k => { const t = typeof tab === 'number' ? tab : 0;   // (tab: ui.js, loaded after)
  return k === 'dock' && (t <= 3 || t >= 8) ? 'modDock' : k === 'model' && t === 7 ? 'modelHome' : k; };   // (views 0-3, 8-11: the history-only panel)
const panelHidden = k => !!PANELS[panelKey(k)];
function setPanelHidden(k, hide) {
  PANELS[panelKey(k)] = !!hide;
  try { localStorage.setItem(PANELS_STORE, JSON.stringify(PANELS)); } catch (e) { /* not kept */ }
  applyPanels();
  render();
}
function applyPanels() {
  const body = document.getElementById('wbBody'), off = panelHidden('model'), home = panelKey('model') === 'modelHome';
  // (hidden: a strip of group icons; on the Summary page, gone altogether)
  if (body) { body.classList.toggle('tree-off', off && !home); body.classList.toggle('tree-none', off && home); }
  document.getElementById('work').classList.toggle('dock-off', panelHidden('dock'));
  const l = `${off ? 'Show' : 'Hide'} the inputs${keyLabel('panel.model') ? ` (${keyLabel('panel.model')})` : ''}`;
  const tb = document.getElementById('treeToggle');
  if (tb) { tb.title = l; tb.setAttribute('aria-label', l); tb.setAttribute('aria-expanded', String(!off)); }
  const ib = document.getElementById('inputsBtn');
  if (ib) { ib.title = l; ib.setAttribute('aria-pressed', String(!off)); }
}
// (a click on a bottom-panel tab while the panel is hidden shows it again)
document.addEventListener('click', e => { if (panelHidden('dock') && e.target.closest && e.target.closest('#view .dock-tabs button')) setPanelHidden('dock', false); }, true);
(function panelButtons() {
  const t = document.getElementById('treeToggle'), ib = document.getElementById('inputsBtn');
  if (t) t.onclick = () => setPanelHidden('model', !panelHidden('model'));
  if (ib) ib.onclick = () => setPanelHidden('model', !panelHidden('model'));
  applyPanels();
})();

/** Keys shown in menus and on buttons, as they are now. */
function applyKeyLabels() {
  document.querySelectorAll('kbd[data-key]').forEach(k => { k.textContent = keyLabel(k.dataset.key); k.hidden = !k.textContent; });
  const set = (id, text, key) => { const el = document.getElementById(id); if (el) el.title = text + (keyLabel(key) ? ` (${keyLabel(key)})` : ''); };
  set('cfdRunAll', 'Solve all four locations', 'run.run');
  set('doeRun', 'Solve every combination of the factor levels', 'run.run');
  set('measCfd', document.getElementById('measCfd') ? document.getElementById('measCfd').title.replace(/ \([^)]*\)$/, '') : '', 'run.run');
  applyPanels();
}

// ---- changing keys (the Keyboard shortcuts page of the help) ----
/** The shortcut list with its keys, a Change button each, and Reset. */
function renderKeyEditor(host) {
  const groups = [...new Set(KEY_ACTIONS.map(a => a.g))];
  const clash = combo => KEY_ACTIONS.filter(a => combo && keyOf(a.id) === combo);
  host.innerHTML = `<p class="fv-note">Click Change and press the new key (with Ctrl, Alt or Shift as you like); Esc cancels, Backspace clears it. Kept in this browser.
      Keys without Ctrl or Alt are not taken while you type in a box.</p>
    ${groups.map(g => `<h3 class="dock-h">${g}</h3><table class="cfd-table key-table"><tbody>${KEY_ACTIONS.filter(a => a.g === g).map(a => {
      const k = keyOf(a.id), c = clash(k), changed = keyOf(a.id) !== (a.def || '');
      return `<tr><th scope="row">${a.l}</th><td><kbd class="key-kbd${k ? '' : ' none'}">${k ? keyLabel(a.id) : 'none'}</kbd>${c.length > 1 ? ` <span class="warn-text">also ${c.filter(x => x !== a).map(x => x.l.toLowerCase()).join(', ')}</span>` : ''}</td>
        <td class="key-acts"><button type="button" class="btn btn-secondary btn-sm" data-kchange="${a.id}">Change</button>${changed ? `<button type="button" class="btn btn-secondary btn-sm" data-kreset="${a.id}" title="Back to ${a.def || 'none'}">Reset</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`).join('')}
    <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="keysResetAll"${Object.keys(KEY_MAP).length ? '' : ' disabled'}>Reset all to the defaults</button></div>`;
  host.querySelectorAll('[data-kchange]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.kchange, kbd = b.closest('tr').querySelector('kbd');
      kbd.textContent = 'press a key…'; kbd.classList.add('capturing'); b.disabled = true;
      KEYS_CAPTURE.on = true;
      const onKey = e => {
        const combo = comboOf(e);
        if (!combo) return;           // (a modifier alone: wait for the key)
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => { KEYS_CAPTURE.on = false; }, 0);
        if (combo !== 'Escape') {
          const v = combo === 'Backspace' || combo === 'Delete' ? '' : combo;
          if (v === (KEY_BY_ID.get(id).def || '')) delete KEY_MAP[id]; else KEY_MAP[id] = v;
          saveKeyMap(); applyKeyLabels(); undoUI();
        }
        renderKeyEditor(host);
      };
      document.addEventListener('keydown', onKey, true);
    };
  });
  host.querySelectorAll('[data-kreset]').forEach(b => { b.onclick = () => { delete KEY_MAP[b.dataset.kreset]; saveKeyMap(); applyKeyLabels(); undoUI(); renderKeyEditor(host); }; });
  host.querySelector('#keysResetAll').onclick = () => { for (const k of Object.keys(KEY_MAP)) delete KEY_MAP[k]; saveKeyMap(); applyKeyLabels(); undoUI(); renderKeyEditor(host); };
}
