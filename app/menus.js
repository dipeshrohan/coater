/*
 * menus.js — the menu bar (File … Help), the command palette and the right-click menus of the 2D flow plots and the 3D
 * view. One list of commands (MB_ACT) serves them all, and each command does what the page's own button, control or key
 * does: the same function, or the page's own control operated where it lives (its page opened first) -- never a second
 * way of doing it. The keys stay keys.js's (KEY_ACTIONS, changeable in Help > Keyboard shortcuts): a command with one
 * runs that key's action and shows its key.
 *
 * A command: { l (label), tip (one line, also shown in the status bar), run, on() (can it run now), why() (why not),
 * chk() (true / false: a check or radio mark; undefined: none), key (a KEY_ACTIONS id) }. A menu is a list of command ids,
 * '-' (a rule), { h: 'heading' } or { sub: 'label', items } (a submenu); menus are built when they open, so what is enabled
 * and checked is the page's state then. File, Edit and Help keep their own items (and ids) as they were, the new ones
 * after them. Nothing here changes what is saved in a project.
 */

const MB_ACT = new Map();
const mbA = (id, o) => { MB_ACT.set(id, { id, ...o }); return id; };
/** A command that is a key's action (keys.js): the same run, its when as its enabled state, its key shown. */
const mbK = (key, l, tip, o = {}) => { const a = KEY_BY_ID.get(key); return mbA('key:' + key, { l, tip, run: () => a.run(), on: a.when || null, why: () => 'Not on this page.', key, ...o }); };

// ---- where things are: open a page, a step, a stage; operate a control where it is ----
function mbTab(t) { if (tab !== t) { tab = t; render(); } }
function mb2D(step) { mbTab(4); if (step && step2D() !== step) goStep2D(step); }
function mb3D(step) { mbTab(9); if (step && step3D() !== step) goStep3D(step); }
/** The Materials page, scrolled to one of its cards (by its heading's id). */
// (a stage card's place in the material hub, MH-5)
function mbMat(id) { mbTab(13); if (typeof hubShow === 'function' && HUB_CARD_AT[id]) hubShow(HUB_CARD_AT[id]); }
const mbEl = sel => document.querySelector(sel);
/** A page's control, operated as a click on it would (after its page is opened by go). */
function mbClick(go, sel) { go(); const el = mbEl(sel); if (el && !el.disabled) el.click(); return !!el; }
/** A page's checkbox set, and its own change handler told (as the page's other controls do, cfd-steps.js's preset). */
function mbCheck(go, sel, v) { go(); const el = mbEl(sel); if (el && !el.disabled && el.checked !== v) { el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); } }
function mbSelect(go, sel, v) { go(); const el = mbEl(sel); if (el && !el.disabled && el.value !== v) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } }

// ---- the state the commands are enabled by ----
const mbSolved2D = () => cfdRuns.some(r => r.field);
const mbRunning2D = () => cfdRuns.some(r => r.status === 'running');
const mbRes3D = () => !!(typeof c3dShown === 'function' && c3dShown());
const mbRunning3D = () => C3D_RUN.status === 'running';
const mbBusy3D = () => mbRunning3D() || M3S.status === 'running' || ACC3.status === 'running';
const mbOn2DResults = () => tab === 4 && step2D() === 'results';
const mbView3D = () => tab === 9 && !!document.getElementById('v3dHost');
const NEED_2D = 'Solve the 2D first (Simulation › 2D CFD › Run all four locations).', NEED_3D = 'Solve the 3D first (Simulation › 3D CFD › Solve 3D).';

// ===================================================================== File
mbA('file.imgSave', { l: 'Save as image…', tip: 'Save the plots or views of this page as PNG or SVG (the camera button).', key: 'file.image', run: () => openImageDialog() });
mbA('imp.profile.csv', { l: 'Blade profile, points (CSV)…', tip: 'A custom blade profile from pasted points (2D Geometry, custom shape).', run: () => { mb2D('geometry'); setBladeShape('custom'); mbClick(() => {}, '#custCSV'); } });
mbA('imp.profile.dxf', { l: 'Blade profile, DXF…', tip: 'A custom blade profile from a DXF drawing.', run: () => { mb2D('geometry'); setBladeShape('custom'); mbClick(() => {}, '#custDXF'); } });
mbA('imp.profile.stl', { l: 'Blade profile from STL / STEP…', tip: 'A custom blade profile cut from a 3D file.', run: () => { mb2D('geometry'); setBladeShape('custom'); mbClick(() => {}, '#custSTL'); } });
mbA('imp.blade3d', { l: 'Blade for the 3D (STL / STEP)…', tip: 'The blade the 3D solves, from a CAD file (Coating › 3D, Geometry).', run: () => { mb3D('geometry'); if (C3D.source !== 'file') c3dSet('source', 'file'); mbClick(() => {}, '#c3dImport'); } });
mbA('imp.gap', { l: 'Gap across the web, measured…', tip: 'The gap measured across the web, pasted or from a CSV file (Coating › 1D › Across the web).', run: () => { mbTab(11); acrossMeasDialog(); } });
mbA('imp.rheometer', { l: 'Rheometer tests…', tip: 'Flow curves from a rheometer (Materials › how it flows), for the fits.', run: () => { mbMat('matRheoH'); rtImport(); } });
mbA('imp.flakeTable', { l: 'Flake angle table…', tip: 'Measured flake angles (Materials › flakes).', run: () => { mbMat('matOrH'); orImportTable(); } });
mbA('imp.sem', { l: 'SEM cross-section image…', tip: 'An SEM image to measure the flakes on (Materials › flakes).', run: () => { mbMat('matOrH'); orImportImage(); } });
mbA('imp.dryTemps', { l: 'Oven temperatures, measured…', tip: 'Measured film temperatures through the oven (Drying, Setup).', run: () => mbClick(() => navGo('dry', 'setup'), '#dryTImport') });
mbA('imp.furnace', { l: 'Furnace cycle (CSV)…', tip: 'The temperature of the furnace run shown, from a file (Furnace, Setup).', run: () => mbClick(() => navGo('furn', 'setup'), '#furnSetupRuns [data-furnfile]') });

const mbExp2D = (l, fn, tip) => ({ l, tip, run: () => { mb2D('results'); fn(); }, on: mbSolved2D, why: () => NEED_2D });
mbA('exp.field', mbExp2D('2D field, every node (CSV)', () => exportField(), 'Every node of the locations shown: position, velocity, pressure, shear rate, viscosity …'));
mbA('exp.bounds', mbExp2D('2D boundaries (CSV)', () => exportBoundaries(), 'Along the web, the blade, the face and the free surface.'));
mbA('exp.metrics', mbExp2D('2D flow metrics (CSV)', () => exportMetrics(), 'The flow metrics table.'));
mbA('exp.probes', mbExp2D('2D probes (CSV)', () => exportProbes(), 'The values at the probes.'));
mbA('exp.cuts', mbExp2D('2D cut lines (CSV)', () => exportCuts(), 'Every field along each cut line.'));
mbA('exp.stl3d', { l: '3D blade (STL)', tip: 'The blade made from the 2D setup, as an STL file (mm).', run: () => mbClick(() => mb3D('geometry'), '#c3dExport'), on: () => C3D.source === 'made', why: () => 'Only a blade made from the 2D setup (not one from a file).' });
mbA('exp.stream3d', { l: '3D streamlines (CSV)', tip: 'Every 3D streamline\'s points and velocity.', run: () => { mb3D('results'); if (!C3D.stream) c3dSet('stream', true); mbClick(() => {}, '#c3dStreamCsv'); }, on: mbRes3D, why: () => NEED_3D });
mbA('exp.doe', { l: 'DOE runs (CSV)', tip: 'The runs table: factors, outputs, status, time.', run: () => { mbTab(5); exportDOE(); }, on: () => DOE.runs.length > 0, why: () => 'Run the DOE first.' });
mbA('exp.meas', { l: 'Measured vs models (CSV)', tip: 'Each measured point with the model (the most detailed one solved) and the CFD.', run: () => { mbTab(6); exportMeasured(); }, on: () => !!measSelected(), why: () => 'Import a measured dataset first.' });
mbA('exp.dry', { l: 'Drying (CSV)', tip: 'Every film\'s drying along the oven.', run: () => { navGo('dry', 'results'); dryExportCSV(); }, on: () => !!DRY.res, why: () => 'Solve the drying first (the Drying tab).' });
mbA('exp.film', { l: 'Dry film (CSV)', tip: 'Stress, cracks and peel along the line.', run: () => { navGo('peel', 'results'); filmExportCSV(); }, on: () => !!FILM.res, why: () => 'Solve the film first (the Peel and wind tab).' });
mbA('exp.furn', { l: 'Furnace (CSV)', tip: 'The runs through time: temperature, weight, C/O, thickness …', run: () => { navGo('furn', 'results'); furnExportCSV(); }, on: () => !!FURN.res, why: () => 'Solve the furnace first (the Furnace tab).' });

// ===================================================================== Edit
mbA('edit.resetInputs', { l: 'Reset the inputs to their defaults', tip: 'The shared inputs back to their defaults (the CFD setup stays; Undo takes it back).', run: () => mbEl('#reset').click() });
mbA('edit.prefs', { l: 'Preferences…', tip: 'Theme, the welcome screen, panels, keyboard shortcuts.', run: () => mbPrefs() });
mbA('edit.resetPrefs', { l: 'Reset preferences', tip: 'The theme follows the system, the welcome screen as at first, the panels as at first (the keys: Help › Keyboard shortcuts, Reset).', run: () => mbResetPrefs() });

// ===================================================================== View
const mbTheme = () => document.documentElement.dataset.theme || 'system';
function mbSetTheme(v) {
  if (v === 'system') { delete document.documentElement.dataset.theme; try { localStorage.removeItem(THEME_KEY); } catch (e) { /* not kept */ } return; }
  if (mbTheme() !== v) { document.documentElement.dataset.theme = v; try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* not kept */ } }
}
[['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']].forEach(([v, l]) => mbA('view.theme.' + v, { l, tip: `The colours: ${l.toLowerCase()}.`, run: () => mbSetTheme(v), chk: () => mbTheme() === v }));
mbA('view.full', { l: 'Full screen', tip: 'The app over the whole screen (Esc leaves).', run: () => { const d = document; if (d.fullscreenElement) d.exitFullscreen(); else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => {}); },
  chk: () => !!document.fullscreenElement, on: () => !!document.documentElement.requestFullscreen });
const ON_2D = { why: () => 'Only on the 2D (Simulation › 2D CFD).' };
mbK('view.fitAll', 'Fit the view', 'The whole domain in the 2D flow plots; the 3D view back to its camera.', { why: () => 'Only with the 2D flow plots (2D Results) or the 3D view shown.' });
mbK('view.in', 'Zoom in', 'The 2D flow plots.', ON_2D);
mbK('view.out', 'Zoom out', 'The 2D flow plots.', ON_2D);
mbK('view.edge', 'Zoom to the metering edge', 'The 2D flow plots.', ON_2D);
mbK('view.meniscus', 'Zoom to the meniscus', 'The 2D flow plots.', ON_2D);
[0, 1, 2, 3].forEach(i => mbK(`view.l${i + 1}`, `Location ${i + 1}`, `The 2D at location ${i + 1}.`, { ...ON_2D, chk: () => onCfd() ? (step2D() === 'results' ? FV.view === i : (FV.stepLoc | 0) === i) : undefined }));
mbK('view.compare', 'Compare the four locations', 'The four locations side by side (2D Results).', { ...ON_2D, chk: () => onCfd() && step2D() === 'results' ? FV.view === 'compare' : undefined });
mbK('view.diff', 'Difference plot', 'One location minus another (2D Results).', { ...ON_2D, chk: () => onCfd() && step2D() === 'results' ? FV.view === 'diff' : undefined });
const MB_FV = [['fvStream', 'streamlines', 'Streamlines'], ['fvVec', 'vectors', 'Velocity vectors'], ['fvContours', 'contours', 'Contour lines'], ['fvFlakes', 'flakes', 'Flakes along the streamlines'], ['fvMesh', 'mesh', 'Mesh']];
MB_FV.forEach(([id, k, l]) => mbA('view.2d.' + k, { l, tip: `The 2D flow plots: ${l.toLowerCase()} on or off.`, run: () => mbCheck(() => mb2D('results'), '#' + id, !FV[k]), chk: () => !!FV[k], on: mbSolved2D, why: () => NEED_2D }));
const MB_V3 = [['iso', '3D'], ['side', 'Side'], ['top', 'Top'], ['front', 'Front']];
MB_V3.forEach(([v, l]) => mbA('view.3d.' + v, { l, tip: `The 3D view from ${v === 'iso' ? 'an angle' : `the ${l.toLowerCase()}`}.`,
  run: () => { mbTab(9); const b = mbEl(`[data-v3view="${v}"]`); if (b) b.click(); else { C3D.view = v; render(); } }, chk: () => C3D.view === v && (C3D.section === '3d' || step3D() !== 'mesh') }));
[['blade', 'Blade'], ['slurry', 'Slurry'], ['web', 'Web'], ['mesh', 'Mesh']].forEach(([k, l]) => mbA('view.3d.show.' + k, { l, tip: `The 3D view: the ${l.toLowerCase()} shown or hidden.`, run: () => { mbTab(9); c3dSet(k, !C3D[k]); }, chk: () => !!C3D[k] }));
mbA('view.3d.reset', { l: 'Reset the camera', tip: 'The 3D view back to its camera for the view chosen (as F does there).', run: () => v3Camera(), on: mbView3D, why: () => 'Only with the 3D view shown (Simulation › 3D CFD).' });
[1, 2, 5, 10, 20, 50].forEach(v => mbA('view.3d.h' + v, { l: `Height ×${v}`, tip: 'Heights drawn this many times larger (the gap is thin).', run: () => { mbTab(9); if (C3D.vscale !== v) c3dSet('vscale', v); }, chk: () => C3D.vscale === v }));

// ===================================================================== Geometry
mbA('geo.2d', { l: 'Blade geometry (2D)…', tip: 'The blade drawn with its dimensions (Coating › 2D, Geometry).', run: () => mb2D('geometry'), chk: () => tab === 4 && step2D() === 'geometry' });
BLADE_SHAPES.forEach(([k, l]) => mbA('geo.shape.' + k, { l, tip: `The blade's profile: ${l.toLowerCase()}.`, run: () => { mb2D('geometry'); setBladeShape(k); }, chk: () => CFDG.shape === k }));
[['full', 'Full (any corner or stretch)'], ['simple', 'Simple (wetted up to C)']].forEach(([k, l]) => mbA('geo.cl.' + k, { l, tip: 'How the contact line sits on a shaped exit face.',
  run: () => { mb2D('geometry'); const b = mbEl(`[data-stepcl="${k}"]`) || mbEl(`#cfdClModel [data-cl="${k}"]`); if (b) b.click(); }, chk: () => (CFDG.clModel === 'simple') === (k === 'simple'),
  on: () => typeof bladeShapedFace === 'function' && bladeShapedFace(), why: () => 'Only for a shaped exit face (bevel, radius, wedge, two-step, custom).' }));
mbA('geo.3d', { l: 'Blade geometry (3D)…', tip: 'The blade the 3D solves: made from the 2D setup, or from a file (Coating › 3D, Geometry).', run: () => mb3D('geometry'), chk: () => tab === 9 && step3D() === 'geometry' });
[['made', 'Made from the 2D setup'], ['file', 'From a file (STL / STEP)']].forEach(([k, l]) => mbA('geo.src.' + k, { l, tip: 'Where the 3D\'s blade comes from.', run: () => { mb3D('geometry'); if (C3D.source !== k) c3dSet('source', k); }, chk: () => C3D.source === k }));
mbA('geo.across', { l: 'The blade across the web…', tip: 'Bow, tilt, chamfered ends and the crown (Coating › 1D › Across the web).', run: () => mbTab(11), chk: () => tab === 11 });

// ===================================================================== Physics
mbA('phys.mat', { l: 'Materials…', tip: 'The material hub: every material and interface the solvers read, each property with its definition, unit, provenance and source.', run: () => mbTab(13), chk: () => tab === 13 });
[['matSlurryH', 'GO slurry'], ['matRheoH', 'Its flow law'], ['matOrH', 'Its flakes\' alignment'], ['matFibreH', 'Fibre web'], ['matDryH', 'What the drying reads'], ['matFilmH', 'Dried GO film'], ['matFurnH', 'What the furnace reads']]
  .forEach(([id, l]) => mbA('phys.card.' + id, { l, tip: `Materials › ${l}.`, run: () => mbMat(id) }));
Object.entries(RHEO_MODELS).forEach(([k, m]) => mbA('phys.rheo.' + k, { l: m.l, tip: m.law, run: () => mbSelect(() => mbTab(13), '#matModel', k), chk: () => CFDG.model === k }));
mbA('phys.struct', { l: 'Structure (thixotropy)', tip: 'The slurry\'s structure breaking down in the flow and building up at rest.', run: () => mbCheck(() => mbMat('matRheoH'), '#matStructOn', !MAT.rheo.structOn), chk: () => !!MAT.rheo.structOn });
mbA('phys.process', { l: 'The line…', tip: 'The process stage by stage, from the mixer to the graphene film: where each stands and its answers.', run: () => navGo('line'), chk: () => tab === 14 });
// (the process's stages, each its tab: WF-2)
const MB_STAGES = SECTIONS.filter(s => s.n);
MB_STAGES.forEach(s => mbA('phys.stage.' + s.k, { l: `${s.n} ${s.t}`, tip: s.groups ? `${s.t}: ${s.groups.map(g => g.t).join(', ')}.` : navQ(s.pages[0]), run: () => goSection(SECTIONS.indexOf(s)), chk: () => secOf() === s }));
mbA('phys.inputs', { l: 'Process inputs (web speed, gap, slurry …)', tip: 'The inputs panel: the shared process and slurry inputs.', run: () => { if (panelHidden('model')) setPanelHidden('model', false); }, chk: () => !panelHidden('model') });

// ===================================================================== Mesh
mbA('mesh.2d', { l: '2D mesh…', tip: 'The 2D mesh of each location, before it is solved: preview, quality, zones (Coating › 2D, Mesh).', run: () => mb2D('mesh'), chk: () => tab === 4 && step2D() === 'mesh' });
['coarse', 'medium', 'fine'].forEach(k => mbA('mesh.2d.' + k, { l: MESH_PRESETS[k].l, tip: `The 2D mesh preset: ${MESH_PRESETS[k].l.toLowerCase()}.`, run: () => mbSelect(() => mb2D('mesh'), '#cfdMesh', k), chk: () => CFDS.mesh === k }));
mbA('mesh.2d.custom', { l: 'Custom counts', tip: 'Set the 2D mesh\'s counts yourself (Mesh step).', run: () => mbSelect(() => mb2D('mesh'), '#cfdMesh', 'custom'), chk: () => CFDS.mesh === 'custom' });
mbA('mesh.2d.do', { l: 'Mesh 2D (the four locations)', tip: 'Lay out the four locations\' 2D meshes for the inputs as they are: Solve needs them.', run: () => { mb2D('mesh'); mesh2DDo(); } });
mbA('mesh.2d.study', { l: '2D mesh study…', tip: 'One location on three meshes, to see how much the answer moves.', run: () => mbClick(() => mb2D('mesh'), '#stepMeshStudy') });
mbA('mesh.2d.acc', { l: '2D mesh to an accuracy…', tip: 'Refine where the answer needs it, until it stops changing.', run: () => mbClick(() => mb2D('mesh'), '#stepMeshAcc') });
mbA('mesh.page.do', { l: 'Mesh this page', tip: 'Lay out the mesh of the page shown (Pool and feed 3D, or a stage\'s 1D, 2D or 3D) for the inputs as they are: Solve needs it.',
  run: () => meshDo(meshPageId()), on: () => !!meshPageId() && solveSafe(SOLVE_M[meshPageId()].key, null) != null, why: () => meshPageId() ? 'Solve what it needs first: the mesh is laid out for its results.' : 'Open Pool and feed 3D, or a stage\'s 1D, 2D or 3D page.' });
mbA('mesh.3d.do', { l: 'Mesh 3D', tip: 'Lay out the 3D mesh for the inputs as they are: Solve needs it.', run: () => { mb3D('mesh'); mesh3DDo(); } });
mbA('mesh.3d', { l: '3D mesh…', tip: 'The 3D mesh: presets, the gap, across the web, zones, statistics (Coating › 3D, Mesh).', run: () => mb3D('mesh'), chk: () => tab === 9 && step3D() === 'mesh' });
Object.entries(C3D_MESH_PRESETS).forEach(([k, q]) => mbA('mesh.3d.' + k, { l: q.l, tip: `The 3D mesh preset: ${q.l.toLowerCase()} (${q.nxGap} along the blade, ${q.ny} across the gap, ${q.nzStrip} across a strip).`,
  run: () => { mb3D('mesh'); c3dSetPreset(k); }, chk: () => c3dPresetOf() === k, on: () => !mbBusy3D(), why: () => 'Wait for the 3D solve or study to end.' }));
mbA('mesh.3d.type', { l: 'Structured hexahedra, 27 nodes (the 3D\'s only element type)', tip: 'Taylor–Hood Q2–Q1 on spines fitted to the blade, web and free surface; no tetrahedra or polyhedra.', run: () => {}, chk: () => true, on: () => false, why: () => 'The 3D solver has this one element type.' });
mbA('mesh.3d.stats', { l: '3D mesh statistics', tip: 'Quality, sizes, the gap\'s and across-web counts, warnings (Coating › 3D, Mesh).', run: () => { C3D_MOPEN.stats = true; mb3D('mesh'); render(); const g = mbEl('[data-m3grp="stats"]'); if (g) g.scrollIntoView({ block: 'nearest' }); } });
C3D_SECTIONS.forEach(([k, l, tip]) => mbA('mesh.3d.sec.' + k, { l, tip: `Mesh view: ${tip}.`, run: () => { mb3D('mesh'); const b = mbEl(`[data-c3dsec="${k}"]`); if (b) b.click(); else if (k === '3d') { C3D.section = '3d'; render(); } }, chk: () => C3D.section === k }));
mbA('mesh.3d.study', { l: '3D mesh-independence study…', tip: 'The strip on Coarse, Medium and Fine, nothing else changed, side by side: its section in the 3D Mesh step, then its Run.',
  run: () => { mb3D('mesh'); const el = mbEl('#m3sRun') || mbEl('#m3sStop'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); } },
  on: () => C3D.region === 'strip', why: () => 'Only for a strip (Simulation › 3D CFD › Region).' });
mbA('mesh.3d.studyStop', { l: 'Stop the 3D mesh study', tip: 'As the study\'s Stop button: the meshes solved so far are kept.', run: () => m3StudyStop(), on: () => M3S.status === 'running', why: () => 'No study is running.' });
// (its settings first -- method, target, outputs -- then the section's own Run, as the 2D's Mesh to an accuracy opens its panel)
mbA('mesh.3d.acc', { l: '3D mesh to an accuracy…', tip: 'Its settings (method, target, outputs) in the 3D Mesh step, then its Run.',
  run: () => { mb3D('mesh'); const el = mbEl('#acc3Method'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); } },
  on: () => !c3dOpenEdges(), why: () => 'Not with the web\'s edges open.' });
mbA('mesh.3d.accStop', { l: 'Stop the 3D mesh to an accuracy', tip: 'As its Stop button.', run: () => acc3Stop(), on: () => ACC3.status === 'running', why: () => 'It is not running.' });

// ===================================================================== Simulation
[[8, '1D'], [4, '2D CFD'], [9, '3D CFD']].forEach(([t, l]) => mbA('sim.dim.' + t, { l, tip: `Coating › ${l}.`, run: () => mbTab(t), chk: () => t === 8 ? [8, 10, 11, 15, 0].includes(tab) : tab === t }));
STEPS.forEach(([k, l]) => mbA('sim.2d.' + k, { l: `${l}${k === 'solve' ? ' (boundary conditions, solver settings)' : ''}`, tip: `The 2D's ${l.toLowerCase()} step.`, run: () => mb2D(k), chk: () => tab === 4 && step2D() === k }));
mbA('sim.2d.runAll', { l: 'Run all four locations', tip: 'Solve the 2D at the four locations.', key: 'run.run', run: () => { mb2D(); runAllLocations(); }, on: () => !cfdRuns.every(r => r.status === 'running'), why: () => 'They are all running.' });
[0, 1, 2, 3].forEach(i => mbA('sim.2d.run' + i, { l: `Run location ${i + 1}`, tip: `Solve the 2D at location ${i + 1} only.`, run: () => { mb2D(); runLocation(i); }, on: () => cfdRuns[i].status !== 'running', why: () => 'It is running.' }));
mbA('sim.2d.stop', { l: 'Stop the 2D', tip: 'Stop every 2D location solving.', run: () => cancelAllLocations(), on: mbRunning2D, why: () => 'Nothing is running.' });
mbA('sim.2d.conv', { l: 'Convergence (residuals)', tip: 'The Newton residuals of each solve (2D, bottom panel).', run: () => { mb2D(STEP_DOCK_2D[step2D()].includes('conv') ? undefined : 'solve'); FV.dock = 'conv'; if (panelHidden('dock')) setPanelHidden('dock', false); else viewCFD(); } });
[['geometry', 'Geometry'], ['mesh', 'Mesh'], ['solve', 'Solve'], ['results', 'Results']].forEach(([k, l]) => mbA('sim.3d.' + k, { l, tip: `The 3D's ${l.toLowerCase()} step.`, run: () => mb3D(k), chk: () => tab === 9 && step3D() === k }));
[['strip', 'A strip at a location'], ['edge', 'A strip at a web edge'], ['full', 'The full web width']].forEach(([k, l]) => mbA('sim.3d.region.' + k, { l, tip: 'What the 3D solves across the web.', run: () => { mbTab(9); if (C3D.region !== k) c3dSet('region', k); }, chk: () => C3D.region === k, on: () => !mbBusy3D(), why: () => 'Wait for the 3D to end.' }));
mbA('sim.3d.run', { l: 'Solve 3D', tip: 'Solve the 3D region (its Solve step).', run: () => { mb3D(); c3dRun(); }, on: () => !mbBusy3D() && !(typeof c3dMeshProblems === 'function' && c3dMeshProblems().some(p => p.level === 'error')),
  why: () => mbBusy3D() ? 'The 3D is running.' : ((typeof c3dMeshProblems === 'function' ? c3dMeshProblems().find(p => p.level === 'error') : null) || { text: 'The mesh has an error.' }).text });
// (a study or a mesh-to-accuracy run stopped as its own Stop button does; else the solve)
mbA('sim.3d.stop', { l: 'Stop the 3D', tip: 'Stop the 3D solve (or the mesh study or mesh-to-accuracy running).', run: () => { if (M3S.status === 'running') m3StudyStop(); else if (ACC3.status === 'running') acc3Stop(); else c3dStop(); }, on: mbBusy3D, why: () => 'Nothing is running.' });
mbK('run.run', 'Run (this page)', 'Solve what this page solves: the four 2D locations, the DOE, the measured set in the CFD, the 3D.', { why: () => 'Only on 2D CFD, 3D CFD, DOE and Measured data.' });
mbK('run.stop', 'Stop (this page)', 'Stop what this page is solving.', { why: () => 'Nothing is solving on this page.' });
mbA('sim.doe', { l: 'Design of experiments…', tip: 'Which setting changes the result most.', run: () => mbTab(5), chk: () => tab === 5 });
mbA('sim.doe.run', { l: 'Run the DOE', tip: 'Every combination of the factor levels.', run: () => { mbTab(5); runDOE(); }, on: () => DOE.status !== 'running', why: () => 'It is running.' });
mbA('sim.doe.stop', { l: 'Stop the DOE', tip: 'Stop the DOE runs.', run: () => stopDOE(), on: () => DOE.status === 'running', why: () => 'Nothing is running.' });
mbA('sim.meas.run', { l: 'Run the measured set in the CFD', tip: 'Solve the 2D at every measured point of the dataset shown.', run: () => { mbTab(6); measRunCfd(measSelected()); },
  on: () => !!measSelected() && MQ.active.size + MQ.jobs.length === 0, why: () => measSelected() ? 'It is running.' : 'Import a measured dataset first.' });
mbA('sim.meas.stop', { l: 'Stop the measured set', tip: 'Stop the measured set\'s CFD.', run: () => measStopCfd(), on: () => MQ.active.size + MQ.jobs.length > 0, why: () => 'Nothing is running.' });

// ===================================================================== Results
[[7, 'Summary'], [1, 'Contact line'], [2, 'Web edge'], [3, 'Film surface']].forEach(([t, l]) => mbA('res.page.' + t, { l, tip: TAB_Q[t], run: () => mbTab(t), chk: () => tab === t }));
['wetdry', 'flakes'].forEach(k => mbA('res.page.' + k, { l: navTitle(k), tip: navQ(k), run: () => navGo(k), chk: () => navNow() === k }));
mbA('res.2d', { l: '2D results…', tip: 'The flow under the blade at the four locations (Coating › 2D, Results).', run: () => mb2D('results'), chk: () => mbOn2DResults() });
const MB_FIELDS = [['speed', 'Velocity magnitude |V|'], ['ux', 'u_x (machine direction)'], ['uy', 'u_y (normal to web)'], ['shear', 'Shear rate'], ['mu', 'Apparent viscosity'], ['omega', 'Vorticity'],
  ['strain1', 'Principal strain rate'], ['dissip', 'Viscous dissipation'], ['lam', 'Structure λ (thixotropy)'], ['pressure', 'Pressure'], ['none', 'None (geometry only)']];
MB_FIELDS.forEach(([k, l]) => mbA('res.2d.f.' + k, { l, tip: `The 2D flow plots coloured by ${l.toLowerCase()}.`, run: () => mbSelect(() => mb2D('results'), '#fvBase', k), chk: () => FV.base === k, on: mbSolved2D, why: () => NEED_2D }));
mbA('res.2d.probe', { l: 'Place probes', tip: 'Click the 2D plot to place named probes (Esc ends).', run: () => mbClick(() => mb2D('results'), '#cfdProbePlace'), chk: () => !!placeProbes, on: mbSolved2D, why: () => NEED_2D });
mbA('res.2d.cut', { l: 'Draw a cut line', tip: 'Click its start, then its end on the 2D plot (Esc cancels).', run: () => mbClick(() => mb2D('results'), '#cfdCutPlace'), chk: () => !!placeCut, on: mbSolved2D, why: () => NEED_2D });
[['metrics', 'Flow metrics'], ['probes', 'Probes'], ['cuts', 'Cut lines'], ['across', 'Across the web'], ['profiles', 'Profiles'], ['flakes', 'Flakes'], ['fibre', 'Fibre'], ['conv', 'Convergence'], ['cases', 'Saved cases']]
  .forEach(([k, l]) => mbA('res.2d.dock.' + k, { l, tip: `The 2D Results' bottom panel: ${l.toLowerCase()}.`, run: () => { mb2D('results'); FV.dock = k; if (panelHidden('dock')) setPanelHidden('dock', false); else viewCFD(); },
    chk: () => mbOn2DResults() && FV.dock === k && !panelHidden('dock') }));
mbA('res.3d', { l: '3D results…', tip: 'The flow in 3D and across the web (Coating › 3D, Results).', run: () => mb3D('results'), chk: () => tab === 9 && step3D() === 'results' });
Object.entries(C3D_FIELDS).forEach(([k, f]) => mbA('res.3d.f.' + k, { l: f.l, tip: `The 3D view coloured by ${f.l.toLowerCase()}.`, run: () => { mb3D('results'); if (C3D.field !== k) c3dSet('field', k); }, chk: () => C3D.field === k, on: mbRes3D, why: () => NEED_3D }));
mbA('res.3d.stream', { l: '3D streamlines', tip: 'Streamlines through the solved 3D velocity (their seeds and mode below the view).', run: () => { mb3D('results'); c3dSet('stream', !C3D.stream); }, chk: () => !!C3D.stream, on: mbRes3D, why: () => NEED_3D });
[['yz', 'Y–Z section at an x'], ['xz', 'X–Z section, half the gap']].forEach(([v, l]) => mbA('res.3d.uz.' + v, { l, tip: 'The cross-web velocity u_z on a section (3D Results).',
  run: () => { mb3D('results'); if (C3D.uzView !== v) c3dSet('uzView', v); const el = mbEl('.m3-uz'); if (el) el.scrollIntoView({ block: 'start' }); }, chk: () => C3D.uzView === v, on: mbRes3D, why: () => NEED_3D }));
mbA('res.3d.xflow', { l: 'Cross-flow diagnostic', tip: 'The largest u_x, u_y, u_z and what drives the flow across the web.', run: () => { mb3D('results'); const el = mbEl('.m3-xflow'); if (el) el.scrollIntoView({ block: 'start' }); }, on: mbRes3D, why: () => NEED_3D });
[[8, 'Gap flow'], [10, 'To the oven'], [11, 'Across the web'], [15, 'Pool and feed'], [0, 'Start-up']].forEach(([t, l]) => mbA('res.1d.' + t, { l, tip: TAB_Q[t], run: () => mbTab(t), chk: () => tab === t }));
[[16, 'Pool and feed (2D)'], [17, 'Pool and feed (3D)']].forEach(([t, l]) => mbA('res.pool.' + t, { l, tip: TAB_Q[t], run: () => mbTab(t), chk: () => tab === t }));
mbA('res.meas', { l: 'Measured data…', tip: TAB_Q[6], run: () => mbTab(6), chk: () => tab === 6 });

// ===================================================================== Tools
mbK('tools.palette', 'Command palette…', 'Find any command by name and run it.');
mbA('tools.keys', { l: 'Keyboard shortcuts…', tip: 'Every key, and change them.', key: 'help.keys', run: () => openHelp('keys') });
mbA('tools.history', { l: 'History of this page', tip: 'The changes made on this page (Undo takes them back).', run: () => showHistory() });
mbA('tools.report', { l: 'Report…', tip: 'An HTML report of the project.', key: 'file.report', run: () => openReportDialog() });

// ===================================================================== Window
mbK('panel.model', 'Inputs panel', 'Show or hide the inputs.', { chk: () => !panelHidden('model') });
mbK('panel.dock', 'Bottom panel', 'Show or hide the bottom panel of this page.', { why: () => 'This page has no bottom panel.', chk: () => document.querySelector('#view .dock') ? !panelHidden('dock') : undefined });
const MB_TABS = { on: () => dockTabs().length > 1, why: () => document.querySelector('#view .dock') ? 'This page\'s bottom panel has one tab.' : 'This page has no bottom panel.' };
mbK('panel.next', 'Next bottom-panel tab', 'The bottom panel\'s next tab.', MB_TABS);
mbK('panel.prev', 'Previous bottom-panel tab', 'The bottom panel\'s previous tab.', MB_TABS);
SECTIONS.forEach((s, i) => mbA('win.sec.' + s.k, { l: s.n ? `${s.n} ${s.t}` : s.t, tip: s.n ? `Stage ${s.n}: ${s.t}.` : `The ${s.t} tab.`, run: () => goSection(i), chk: () => secOf(tab) === s }));
mbA('win.secNext', { l: 'Next section', tip: 'The next section of the tab bar.', run: () => goSection((SECTIONS.indexOf(secOf(tab)) + 1) % SECTIONS.length) });
mbA('win.secPrev', { l: 'Previous section', tip: 'The previous section of the tab bar.', run: () => goSection((SECTIONS.indexOf(secOf(tab)) + SECTIONS.length - 1) % SECTIONS.length) });
mbA('win.reset', { l: 'Reset the layout', tip: 'The inputs and bottom panels as they first were, the inputs panel at its first width.', run: () => mbResetLayout() });

// ===================================================================== Help
mbA('help.about', { l: 'About Blade Coat Defect Lab…', tip: 'Version, the project file format, this browser.', run: () => mbAbout() });

// ---- the menus ----
const MB_MENUS = {
  file: ['-', { sub: 'Import', items: [{ h: '2D blade profile' }, 'imp.profile.csv', 'imp.profile.dxf', 'imp.profile.stl', { h: '3D' }, 'imp.blade3d', { h: 'Across the web' }, 'imp.gap',
    { h: 'Materials' }, 'imp.rheometer', 'imp.flakeTable', 'imp.sem', { h: 'Process' }, 'imp.dryTemps', 'imp.furnace'] },
    { sub: 'Export', items: [{ h: '2D CFD' }, 'exp.field', 'exp.bounds', 'exp.metrics', 'exp.probes', 'exp.cuts', { h: '3D' }, 'exp.stl3d', 'exp.stream3d', { h: 'Studies' }, 'exp.doe', 'exp.meas', { h: 'Process' }, 'exp.dry', 'exp.film', 'exp.furn'] },
    'file.imgSave'],
  edit: ['-', 'edit.resetInputs', 'edit.prefs', 'edit.resetPrefs'],
  view: [{ sub: 'Theme', items: ['view.theme.system', 'view.theme.light', 'view.theme.dark'] }, 'view.full', '-', 'key:view.fitAll',
    { sub: '2D flow plots', items: ['key:view.in', 'key:view.out', 'key:view.edge', 'key:view.meniscus', '-', 'key:view.l1', 'key:view.l2', 'key:view.l3', 'key:view.l4', 'key:view.compare', 'key:view.diff', '-', ...MB_FV.map(q => 'view.2d.' + q[1])] },
    { sub: '3D view', items: [{ h: 'Camera' }, ...MB_V3.map(q => 'view.3d.' + q[0]), 'view.3d.reset', { h: 'Show' }, 'view.3d.show.blade', 'view.3d.show.slurry', 'view.3d.show.web', 'view.3d.show.mesh', 'res.3d.stream', { h: 'Vertical scale' }, ...[1, 2, 5, 10, 20, 50].map(v => 'view.3d.h' + v)] }],
  geometry: ['geo.2d', { sub: 'Blade shape', items: BLADE_SHAPES.map(q => 'geo.shape.' + q[0]) }, { sub: 'Contact line on the face', items: ['geo.cl.full', 'geo.cl.simple'] },
    { sub: 'Custom profile', items: ['imp.profile.csv', 'imp.profile.dxf', 'imp.profile.stl'] }, '-', 'geo.3d', { sub: 'Blade for the 3D', items: ['geo.src.made', 'geo.src.file'] }, 'imp.blade3d', 'exp.stl3d', '-', 'geo.across', 'imp.gap'],
  physics: ['phys.mat', { sub: 'Materials', items: ['phys.card.matSlurryH', 'phys.card.matRheoH', 'phys.card.matOrH', 'phys.card.matFibreH', 'phys.card.matDryH', 'phys.card.matFilmH', 'phys.card.matFurnH'] },
    { sub: 'Rheology model', items: Object.keys(RHEO_MODELS).map(k => 'phys.rheo.' + k) }, 'phys.struct', 'imp.rheometer', '-', 'phys.process', { sub: 'Process stage', items: MB_STAGES.map(s => 'phys.stage.' + s.k) }, 'phys.inputs'],
  mesh: [{ h: '2D' }, 'mesh.2d.do', 'mesh.2d', { sub: '2D mesh preset', items: ['mesh.2d.coarse', 'mesh.2d.medium', 'mesh.2d.fine', 'mesh.2d.custom'] }, 'mesh.2d.study', 'mesh.2d.acc',
    { h: '3D' }, 'mesh.3d.do', 'mesh.3d', { sub: '3D mesh preset', items: Object.keys(C3D_MESH_PRESETS).map(k => 'mesh.3d.' + k) }, { sub: 'Element type', items: ['mesh.3d.type'] }, 'mesh.3d.stats',
    { sub: '3D mesh views', items: C3D_SECTIONS.map(q => 'mesh.3d.sec.' + q[0]) }, 'mesh.3d.study', 'mesh.3d.studyStop', 'mesh.3d.acc', 'mesh.3d.accStop',
    { h: 'Pool and the stages' }, 'mesh.page.do'],
  simulation: [{ sub: 'Dimension', items: ['sim.dim.8', 'sim.dim.4', 'sim.dim.9'] }, 'key:run.run', 'key:run.stop',
    { sub: '2D CFD', items: [{ h: 'Steps' }, ...STEPS.map(q => 'sim.2d.' + q[0]), { h: 'Run' }, 'sim.2d.runAll', 'sim.2d.run0', 'sim.2d.run1', 'sim.2d.run2', 'sim.2d.run3', 'sim.2d.stop', '-', 'sim.2d.conv'] },
    { sub: '3D CFD', items: [{ h: 'Steps' }, 'sim.3d.geometry', 'sim.3d.mesh', 'sim.3d.solve', 'sim.3d.results', { h: 'Region' }, 'sim.3d.region.strip', 'sim.3d.region.edge', 'sim.3d.region.full', { h: 'Run' }, 'sim.3d.run', 'sim.3d.stop'] },
    { sub: 'Studies', items: ['sim.doe', 'sim.doe.run', 'sim.doe.stop', '-', 'sim.meas.run', 'sim.meas.stop', '-', 'mesh.3d.study'] }],
  results: [{ sub: 'Results pages', items: ['res.page.7', 'res.page.1', 'res.page.2', 'res.page.3', 'res.page.wetdry', 'res.page.flakes'] }, '-', 'res.2d', { sub: '2D field', items: MB_FIELDS.map(q => 'res.2d.f.' + q[0]) }, 'res.2d.probe', 'res.2d.cut',
    { sub: '2D locations', items: ['key:view.l1', 'key:view.l2', 'key:view.l3', 'key:view.l4', 'key:view.compare', 'key:view.diff'] },
    { sub: '2D panels', items: ['res.2d.dock.metrics', 'res.2d.dock.probes', 'res.2d.dock.cuts', 'res.2d.dock.across', 'res.2d.dock.profiles', 'res.2d.dock.flakes', 'res.2d.dock.fibre', 'res.2d.dock.conv', 'res.2d.dock.cases'] },
    '-', 'res.3d', { sub: '3D field', items: Object.keys(C3D_FIELDS).map(k => 'res.3d.f.' + k) }, 'res.3d.stream', { sub: 'Cross-web velocity u_z', items: ['res.3d.uz.yz', 'res.3d.uz.xz'] }, 'res.3d.xflow', '-', { sub: '1D', items: ['res.1d.8', 'res.1d.10', 'res.1d.11', 'res.1d.15', 'res.1d.0'] }, { sub: 'Pool and feed', items: ['res.pool.16', 'res.pool.17'] }, 'res.meas'],
  tools: ['key:tools.palette', 'tools.keys', 'tools.history', '-', 'sim.doe', 'res.meas', 'mesh.3d.stats', 'res.3d.xflow', '-', 'tools.report', 'file.imgSave'],
  window: ['key:panel.model', 'key:panel.dock', 'key:panel.next', 'key:panel.prev', '-', { h: 'Sections' }, ...SECTIONS.map(s => 'win.sec.' + s.k), 'win.secNext', 'win.secPrev', '-', 'win.reset'],
  help: ['-', 'help.about'],
};

// ---- building a menu when it opens ----
const mbEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function mbState(a) {
  let on = true;
  try { on = a.on ? !!a.on() : true; } catch (e) { on = false; }
  let chk; try { chk = a.chk ? a.chk() : undefined; } catch (e) { chk = undefined; }
  let why = ''; if (!on && a.why) { try { why = a.why(); } catch (e) { why = ''; } }
  return { on, chk, why };
}
function mbItemHTML(id, gut) {
  const a = MB_ACT.get(id);
  if (!a) return '';
  const s = mbState(a), k = a.key ? keyLabel(a.key) : '', tip = s.on ? a.tip : s.why || a.tip;
  const role = s.chk === undefined ? 'menuitem' : 'menuitemcheckbox';
  return `<button class="menu-item mb-item" type="button" role="${role}" data-mb="${id}"${s.chk === undefined ? '' : ` aria-checked="${!!s.chk}"`}${s.on ? '' : ' disabled'} title="${mbEsc(tip || '')}">`
    + `${gut ? `<span class="mb-chk" aria-hidden="true">${s.chk ? '✓' : ''}</span>` : ''}<span class="mi-l">${mbEsc(a.l)}</span>${k ? `<kbd>${mbEsc(k)}</kbd>` : ''}</button>`;
}
/** A list's items; a column for the check marks when any of its commands can be checked (as desktop menus keep one). */
function mbListHTML(items) {
  const gut = items.some(it => typeof it === 'string' && MB_ACT.has(it) && MB_ACT.get(it).chk);
  // (a command is its id, a string: tested first, as a string has a .sub of its own, String.prototype.sub)
  return items.map(it => it === '-' ? '<div class="menu-sep menu-sep-plain" aria-hidden="true"></div>'
    : typeof it === 'string' ? mbItemHTML(it, gut)
    : it.h ? `<div class="menu-sep mb-h" role="presentation"><span>${mbEsc(it.h)}</span></div>`
      : it.sub ? `<div class="mb-sub" role="none"><button class="menu-item mb-subbtn" type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false">${gut ? '<span class="mb-chk" aria-hidden="true"></span>' : ''}<span class="mi-l">${mbEsc(it.sub)}</span><span class="mb-arrow" aria-hidden="true">›</span></button><div class="pop-body pop-menu mb-pop" role="menu" aria-label="${mbEsc(it.sub)}" hidden>${mbListHTML(it.items)}</div></div>`
        : '').join('');
}
/** Fill a menu's own part (a new menu's whole body; File's, Edit's and Help's part after their items). */
function mbFill(key) {
  const host = mbEl(`[data-mbx="${key}"]`);
  if (host) host.innerHTML = mbListHTML(MB_MENUS[key]);
}
/** A menu's body where it fits: under its title, kept on the screen (the bar may scroll on a narrow window). */
function mbPlace(d) {
  const pop = d.querySelector(':scope > .pop-body'), r = d.querySelector(':scope > summary').getBoundingClientRect();
  if (!pop) return;
  pop.style.position = 'fixed'; pop.style.top = `${Math.round(r.bottom + 6)}px`; pop.style.left = '0px'; pop.style.right = 'auto';
  pop.style.maxHeight = `${Math.max(160, innerHeight - r.bottom - 14)}px`;
  // (a phone: the window's width, its submenus opening inside it)
  if (innerWidth < 640) { pop.style.left = '6px'; pop.style.right = '6px'; pop.style.width = 'auto'; return; }
  pop.style.width = '';
  const w = pop.offsetWidth;
  pop.style.left = `${Math.round(Math.max(6, Math.min(r.left, innerWidth - w - 6)))}px`;
}
function mbPlaceSub(wrap) {
  const btn = wrap.querySelector(':scope > .mb-subbtn'), pop = wrap.querySelector(':scope > .mb-pop');
  if (innerWidth < 640) { pop.style.position = 'static'; return; }   // (a phone: the submenu opens in the menu, under its item)
  // (beside its menu's edge, not over it: to the right, else to the left)
  const r = btn.getBoundingClientRect(), m = btn.closest('.pop-body').getBoundingClientRect();
  pop.style.position = 'fixed'; pop.style.maxHeight = `${innerHeight - 12}px`;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const left = m.right + 1 + w <= innerWidth - 4 ? m.right + 1 : Math.max(4, m.left - w - 1);
  pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(Math.max(6, Math.min(r.top - 6, innerHeight - h - 6)))}px`;
}
function mbOpenSub(wrap, focus) {
  const pop = wrap.querySelector(':scope > .mb-pop'), btn = wrap.querySelector(':scope > .mb-subbtn');
  wrap.parentElement.querySelectorAll(':scope > .mb-sub').forEach(o => { if (o !== wrap) mbCloseSub(o); });
  pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); wrap.classList.add('open');
  mbPlaceSub(wrap);
  if (focus) { const f = mbItems(pop)[0]; if (f) f.focus(); }
}
function mbCloseSub(wrap) {
  const pop = wrap.querySelector(':scope > .mb-pop'), btn = wrap.querySelector(':scope > .mb-subbtn');
  if (!pop || pop.hidden) return;
  pop.querySelectorAll('.mb-sub').forEach(mbCloseSub);
  pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); wrap.classList.remove('open');
}
/** The items of a menu (not of its submenus) the keyboard can move to. */
const mbItems = pop => [...pop.querySelectorAll(':scope > .menu-item, :scope > * > .menu-item, :scope > .mb-sub > .mb-subbtn, :scope > [data-mbx] > .menu-item, :scope > [data-mbx] > .mb-sub > .mb-subbtn, :scope > #fmRecent > .menu-item')]
  .filter(b => !b.disabled && b.offsetParent !== null);

// ---- the bar: opening, closing, the keyboard ----
const mbBar = () => document.getElementById('menubar');
const mbMenus = () => [...mbBar().querySelectorAll(':scope > details.mb-menu')];
function mbWire() {
  const bar = mbBar();
  if (!bar) return;
  // (filled and placed as the menu opens -- its open attribute, before the page is drawn again; the toggle event comes a
  // task later, after cfd-ui.js's own for every pop-over has moved it: placed again then)
  const mo = new MutationObserver(recs => {
    for (const r of recs) {
      const d = r.target;
      if (d.open) mbOpened(d);
      else { d._mbFilled = false; d.querySelectorAll('.mb-sub').forEach(mbCloseSub); mbTip(''); }
    }
  });
  for (const d of mbMenus()) {
    mo.observe(d, { attributes: true, attributeFilter: ['open'] });
    d.addEventListener('toggle', () => { if (d.open) mbPlace(d); });
    const s = d.querySelector(':scope > summary');
    // (moving the pointer along the bar while a menu is open opens the next, as desktop menus do)
    s.addEventListener('mouseenter', () => { if (mbMenus().some(o => o.open && o !== d)) d.open = true; });
  }
  bar.addEventListener('click', e => {
    const it = e.target.closest && e.target.closest('[data-mb]');
    if (it) { if (it.disabled) return; const a = MB_ACT.get(it.dataset.mb); mbClose(); mbRun(a); return; }
    const sb = e.target.closest && e.target.closest('.mb-subbtn');
    if (sb) mbSubClick(sb);
  });
  mbHoverSubs(bar);
  // (a command's line in the status bar while it is pointed at or focused)
  const tipOn = e => { const it = e.target.closest && e.target.closest('.menu-item[title]'); mbTip(it ? it.title : ''); };
  bar.addEventListener('mouseover', tipOn); bar.addEventListener('focusin', tipOn); bar.addEventListener('mouseleave', () => mbTip(''));
  bar.addEventListener('keydown', mbKey);
  addEventListener('resize', () => mbMenus().forEach(d => { if (d.open) mbPlace(d); }));
}
/** A menu opened: the others closed, its commands as the page is now (once per opening), where it fits. */
function mbOpened(d) {
  mbMenus().forEach(o => { if (o !== d && o.open) o.open = false; });   // (one menu open at a time)
  if (!d._mbFilled) { d._mbFilled = true; if (d.dataset.mbk) mbFill(d.dataset.mbk); applyKeyLabels(); }
  mbPlace(d);
}
/** A submenu's item clicked: opened (pointed at first, it may be open already: it stays); on a phone, where it opens in its menu, toggled. */
function mbSubClick(sb) { const w = sb.parentElement; if (w.classList.contains('open') && innerWidth < 640) mbCloseSub(w); else mbOpenSub(w, false); }
/** A submenu opens when its item is pointed at, after a moment, and closes when another item of its menu is (as desktop menus do). */
function mbHoverSubs(host) {
  let t = 0;
  host.addEventListener('mouseover', e => {
    const it = e.target.closest && e.target.closest('.menu-item');
    if (!it || innerWidth < 640) return;
    clearTimeout(t);
    const w = it.classList.contains('mb-subbtn') ? it.parentElement : null, level = it.closest('.pop-body');
    t = setTimeout(() => {
      if (!level.isConnected || (w && !w.isConnected) || !level.closest('details[open], .mb-ctx:not([hidden])')) return;   // (the menu closed or rebuilt meanwhile)
      level.querySelectorAll(':scope > .mb-sub, :scope > [data-mbx] > .mb-sub').forEach(o => { if (o !== w) mbCloseSub(o); });
      if (w && !w.classList.contains('open')) mbOpenSub(w, false);
    }, 180);
  });
}
function mbClose() { mbMenus().forEach(d => { d.open = false; }); mbTip(''); }
/** Run a command: its key's action or its own; what it changed is picked up by undo as a page's control's change is. */
function mbRun(a) {
  if (!a) return;
  const s = mbState(a);
  if (!s.on) { if (s.why) imgToast(s.why, 'error'); return; }
  mbRecentAdd(a.id);
  try { a.run(); } catch (e) { imgToast(`${a.l}: ${e.message}`, 'error'); }
}
function mbKey(e) {
  const menus = mbMenus(), sum = e.target.closest && e.target.closest('details.mb-menu > summary');
  const openD = menus.find(d => d.open), k = e.key;
  const step = (d, dir) => { const i = menus.indexOf(d), n = menus[(i + dir + menus.length) % menus.length]; return n; };
  if (sum) {
    const d = sum.parentElement;
    if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); const n = step(d, k === 'ArrowRight' ? 1 : -1); const was = d.open; d.open = false; n.querySelector('summary').focus(); if (was) { n.open = true; mbOpened(n); } }
    else if (k === 'ArrowDown' || k === 'Enter' || k === ' ') { e.preventDefault(); if (!d.open) { d.open = true; mbOpened(d); } const f = mbItems(d.querySelector(':scope > .pop-body'))[0]; if (f) f.focus(); }
    return;
  }
  const it = e.target.closest && e.target.closest('.menu-item');
  if (!it || !openD) return;
  const pop = it.closest('.pop-body'), items = mbItems(pop), i = items.indexOf(it);
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const n = items[(i + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); }
  else if (k === 'Home' || k === 'End') { e.preventDefault(); const n = k === 'Home' ? items[0] : items[items.length - 1]; if (n) n.focus(); }
  else if (k === 'ArrowRight') {
    e.preventDefault();
    if (it.classList.contains('mb-subbtn')) mbOpenSub(it.parentElement, true);
    else { const n = step(openD, 1); openD.open = false; n.open = true; mbOpened(n); n.querySelector('summary').focus(); }
  } else if (k === 'ArrowLeft') {
    e.preventDefault();
    const w = pop.closest('.mb-sub');
    if (w) { mbCloseSub(w); w.querySelector(':scope > .mb-subbtn').focus(); }
    else { const n = step(openD, -1); openD.open = false; n.open = true; mbOpened(n); n.querySelector('summary').focus(); }
  } else if (k === 'Escape') {
    const w = pop.closest('.mb-sub');
    e.preventDefault(); e.stopPropagation();
    if (w) { mbCloseSub(w); w.querySelector(':scope > .mb-subbtn').focus(); }
    else { openD.open = false; openD.querySelector('summary').focus(); }
  }
}
/** F10: the bar to the keyboard (its first menu's title). */
function mbFocusBar() { const s = mbEl('#menubar > details > summary'); if (s) s.focus(); }
function mbTip(t) {
  const el = document.getElementById('sbTip'), sb = el && el.closest('.statusbar');
  if (!el) return;
  el.textContent = t || ''; el.hidden = !t;
  if (sb) sb.classList.toggle('mb-tipping', !!t);
}

// ---- Fit (F): the 2D flow plots' whole domain, or the 3D view's camera again ----
function mbFit() {
  if (onCfd() && zoomClick('fit')) return;
  if (mbView3D() && typeof v3Camera === 'function') v3Camera();
}

// ---- the command palette (Ctrl+Shift+P) ----
const MB_RECENT_STORE = 'bladeCoatDefectLab.commands.v1';
const mbRecent = () => { try { const v = JSON.parse(localStorage.getItem(MB_RECENT_STORE) || '[]'); return Array.isArray(v) ? v.filter(id => MB_ACT.has(id)) : []; } catch (e) { return []; } };
function mbRecentAdd(id) { const r = [id, ...mbRecent().filter(x => x !== id)].slice(0, 8); try { localStorage.setItem(MB_RECENT_STORE, JSON.stringify(r)); } catch (e) { /* not kept */ } }
/** Other words a command is found by in the palette (as users name it: run, generate, show, export results …). */
const MB_KW = { 'sim.3d.run': 'run 3d cfd simulation start', 'sim.2d.runAll': 'run 2d cfd simulation solve start', 'key:run.run': 'run solve start simulation',
  'mesh.2d': 'generate mesh preview 2d', 'mesh.3d': 'generate mesh hexahedra 3d', 'mesh.2d.do': 'generate mesh make 2d', 'mesh.3d.do': 'generate mesh make 3d', 'mesh.page.do': 'generate mesh make stage pool page', 'sim.2d.stop': 'cancel', 'sim.3d.stop': 'cancel', 'key:run.stop': 'cancel',
  'key:view.fitAll': 'fit all zoom extents reset view', 'view.3d.reset': 'reset camera fit', 'sim.2d.conv': 'residuals monitor', 'res.2d.probe': 'add probe',
  'res.3d.xflow': 'diagnostic cross flow', 'mesh.3d.stats': 'quality diagnostics', 'file.imgSave': 'screenshot png svg picture', 'tools.report': 'html',
  'edit.prefs': 'settings options', 'help.about': 'version system information' };
/** Every command with the menu path it is found under (its first), for the palette and the tests. */
function mbPaths() {
  const out = new Map(), T = { file: 'File', edit: 'Edit', view: 'View', geometry: 'Geometry', physics: 'Physics', mesh: 'Mesh', simulation: 'Simulation', results: 'Results', tools: 'Tools', window: 'Window', help: 'Help' };
  const walk = (items, path) => { for (const it of items) { if (typeof it === 'string') { if (it !== '-' && !out.has(it)) out.set(it, path.join(' › ')); } else if (it.sub) walk(it.items, [...path, it.sub]); } };
  for (const [k, items] of Object.entries(MB_MENUS)) walk(items, [T[k]]);
  // (the keys' actions no menu command stands for: found under their key group)
  const covered = new Set([...MB_ACT.values()].filter(x => out.has(x.id) || x.menu).map(x => x.key).filter(Boolean));
  for (const a of KEY_ACTIONS) {
    if (covered.has(a.id)) continue;
    const id = 'key:' + a.id;
    if (!MB_ACT.has(id)) mbA(id, { l: a.l, tip: a.l, run: () => a.run(), on: a.when || null, why: () => 'Not on this page.', key: a.id });
    out.set(id, a.g);
  }
  return out;
}
/** The File, Edit and Help menus' own items, as commands the palette can run (the same buttons clicked). */
function mbStatic() {
  for (const b of document.querySelectorAll('#fileMenu > .pop-body > .menu-item, #editMenu > .pop-body > .menu-item, #helpMenu > .pop-body > .menu-item')) {
    const id = 'static:' + (b.id || b.dataset.helpSec), kb = b.querySelector('kbd[data-key]');
    const menu = b.closest('details').querySelector('summary').textContent.trim();
    if (!MB_ACT.has(id)) mbA(id, { l: b.querySelector('.mi-l') ? b.querySelector('.mi-l').textContent : b.firstChild.textContent.trim(), tip: '', run: () => b.click(), on: () => !b.disabled, why: () => 'Nothing to take back.', menu, key: kb ? kb.dataset.key : '' });
  }
}
function mbPalette() {
  mbClose();
  mbStatic();
  const paths = mbPaths();
  let dlg = document.getElementById('mbPal');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'mbPal'; dlg.className = 'img-dlg mb-pal'; dlg.setAttribute('aria-label', 'Command palette');
    dlg.innerHTML = `<input type="search" id="mbPalQ" placeholder="Type a command: mesh, streamlines, run 3D, export …" aria-label="Command" autocomplete="off" role="combobox" aria-controls="mbPalL" aria-expanded="true">
      <div class="mb-pal-l" id="mbPalL" role="listbox" aria-label="Commands"></div><p class="mb-pal-f">↑ ↓ to move · Enter to run · Esc to close</p>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
  const q = dlg.querySelector('#mbPalQ'), list = dlg.querySelector('#mbPalL');
  let rows = [], sel = 0;
  const pathOf = a => a.menu || paths.get(a.id) || '';
  const draw = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const all = [...MB_ACT.values()].filter(a => a.l && (a.menu || paths.has(a.id)));
    if (!words.length) { const rec = mbRecent(); rows = [...rec.map(id => MB_ACT.get(id)), ...all.filter(a => !rec.includes(a.id))]; }
    else {
      // (every word somewhere: the name, the menu, the line, other words for it; the name counts most -- the whole query at
      // its start most of all, then words that start its words -- and a shorter name first)
      const q = words.join(' ');
      rows = all.map(a => {
        const l = a.l.toLowerCase(), extra = `${MB_KW[a.id] || ''}${a.chk ? ' show hide on off' : ''}${/^exp\./.test(a.id) ? ' results csv' : ''}`;
        const hay = `${l} ${pathOf(a)} ${a.tip || ''} ${extra}`.toLowerCase();
        const score = (l.startsWith(q) ? 8 : 0) + words.reduce((s, w) => s + (new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(l) ? 3 : l.includes(w) ? 2 : extra.includes(w) ? 1.5 : 1), 0);
        return { a, ok: words.every(w => hay.includes(w)), score };
      }).filter(x => x.ok).sort((x, y) => y.score - x.score || x.a.l.length - y.a.l.length).map(x => x.a);
    }
    sel = Math.min(sel, Math.max(0, rows.length - 1));
    const rec = words.length ? [] : mbRecent();
    list.innerHTML = rows.length ? rows.slice(0, 80).map((a, i) => {
      const s = mbState(a), k = a.key ? keyLabel(a.key) : '';
      return `<div class="mb-pal-r${i === sel ? ' sel' : ''}${s.on ? '' : ' off'}" role="option" id="mbPalR${i}" aria-selected="${i === sel}" aria-disabled="${!s.on}" data-i="${i}" title="${mbEsc(s.on ? a.tip || '' : s.why || '')}">
        <span class="mb-pal-n">${s.chk ? '✓ ' : ''}${mbEsc(a.l)}</span><span class="mb-pal-p">${rec.includes(a.id) ? 'recent · ' : ''}${mbEsc(pathOf(a))}${s.on ? '' : ` · ${mbEsc(s.why || 'not now')}`}</span>${k ? `<kbd>${mbEsc(k)}</kbd>` : ''}</div>`;
    }).join('') : '<p class="mb-pal-none">No command by that name.</p>';
    q.setAttribute('aria-activedescendant', rows.length ? 'mbPalR' + sel : '');
    const r = list.querySelector('.sel'); if (r) r.scrollIntoView({ block: 'nearest' });
  };
  const go = i => { const a = rows[i]; if (!a) return; if (!mbState(a).on) return; dlg.close(); mbRun(a); };
  q.value = ''; sel = 0;
  q.oninput = () => { sel = 0; draw(); };
  q.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(rows.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); dlg.close(); }   // (a search box's own Esc clears it: here it closes)
  };
  list.onclick = e => { const r = e.target.closest('[data-i]'); if (r) go(+r.dataset.i); };
  if (!dlg.open) dlg.showModal();
  draw(); q.focus();
}

// ---- right-click menus: the 2D flow plots and the 3D view (Shift + right-click: the browser's own) ----
const MB_CTX = {
  plot2d: () => ['key:view.fitAll', 'key:view.in', 'key:view.out', 'key:view.edge', 'key:view.meniscus', '-', 'res.2d.probe', 'res.2d.cut', '-', { sub: 'Field', items: MB_FIELDS.map(q => 'res.2d.f.' + q[0]) },
    ...MB_FV.map(q => 'view.2d.' + q[1]), '-', { sub: 'Export', items: ['exp.field', 'exp.bounds', 'exp.metrics', 'exp.probes', 'exp.cuts'] }, 'file.imgSave'],
  step2d: () => ({
    geometry: [{ sub: 'Blade shape', items: BLADE_SHAPES.map(q => 'geo.shape.' + q[0]) }, { sub: 'Contact line on the face', items: ['geo.cl.full', 'geo.cl.simple'] },
      { sub: 'Custom profile', items: ['imp.profile.csv', 'imp.profile.dxf', 'imp.profile.stl'] }, '-', 'sim.2d.mesh'],
    mesh: [{ sub: '2D mesh preset', items: ['mesh.2d.coarse', 'mesh.2d.medium', 'mesh.2d.fine', 'mesh.2d.custom'] }, 'mesh.2d.study', 'mesh.2d.acc', '-', 'sim.2d.solve'],
    solve: ['sim.2d.runAll', 'sim.2d.run0', 'sim.2d.run1', 'sim.2d.run2', 'sim.2d.run3', 'sim.2d.stop', '-', 'sim.2d.conv', 'sim.2d.results'],
  }[step2D()] || []).concat(['-', 'file.imgSave']),
  view3d: () => [{ sub: 'Camera', items: [...MB_V3.map(q => 'view.3d.' + q[0]), 'view.3d.reset'] }, 'key:view.fitAll', '-', 'view.3d.show.blade', 'view.3d.show.slurry', 'view.3d.show.web', 'view.3d.show.mesh', 'res.3d.stream',
    { sub: 'Vertical scale', items: [1, 2, 5, 10, 20, 50].map(v => 'view.3d.h' + v) }, ...(step3D() === 'results' ? [{ sub: 'Field', items: Object.keys(C3D_FIELDS).map(k => 'res.3d.f.' + k) }] : []),
    ...(step3D() === 'mesh' ? ['-', { sub: 'Mesh views', items: C3D_SECTIONS.map(q => 'mesh.3d.sec.' + q[0]) }, 'mesh.3d.stats'] : []), '-', 'file.imgSave'],
};
function mbContext(e) {
  if (e.shiftKey) return;
  const where = e.target.closest && (e.target.closest('#cfdPlots') ? 'plot2d' : e.target.closest('#cfdStepView') && tab === 4 && step2D() !== 'results' ? 'step2d'
    : e.target.closest('#v3dHost, #c3dSecHost') ? 'view3d' : null);
  if (!where) return;
  e.preventDefault();
  mbClose();
  let m = document.getElementById('mbCtx');
  if (!m) {
    m = document.createElement('div'); m.id = 'mbCtx'; m.className = 'pop-body pop-menu mb-ctx'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Commands here');
    document.body.appendChild(m);
    m.addEventListener('click', ev => {
      const it = ev.target.closest('[data-mb]');
      if (it) { if (!it.disabled) { const a = MB_ACT.get(it.dataset.mb); mbCtxClose(); mbRun(a); } return; }
      const sb = ev.target.closest('.mb-subbtn'); if (sb) mbSubClick(sb);
    });
    m.addEventListener('keydown', ev => {
      const it = ev.target.closest('.menu-item'); if (!it) return;
      const pop = it.closest('.pop-body'), items = mbItems(pop), i = items.indexOf(it);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); }
      else if (ev.key === 'ArrowRight' && it.classList.contains('mb-subbtn')) { ev.preventDefault(); mbOpenSub(it.parentElement, true); }
      else if (ev.key === 'ArrowLeft' && pop.closest('.mb-sub')) { ev.preventDefault(); const w = pop.closest('.mb-sub'); mbCloseSub(w); w.querySelector('.mb-subbtn').focus(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); mbCtxClose(); }
    });
    mbHoverSubs(m);
  }
  m.innerHTML = mbListHTML(MB_CTX[where]());
  m.hidden = false; m.style.position = 'fixed'; m.style.left = '0px'; m.style.top = '0px';
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = `${Math.round(Math.min(e.clientX, innerWidth - w - 6))}px`; m.style.top = `${Math.round(Math.max(6, Math.min(e.clientY, innerHeight - h - 6)))}px`;
  const f = mbItems(m)[0]; if (f) f.focus({ preventScroll: true });
}
function mbCtxClose() { const m = document.getElementById('mbCtx'); if (m && !m.hidden) { m.querySelectorAll('.mb-sub').forEach(mbCloseSub); m.hidden = true; } }
document.addEventListener('contextmenu', mbContext);
document.addEventListener('mousedown', e => { const m = document.getElementById('mbCtx'); if (m && !m.hidden && !m.contains(e.target)) mbCtxClose(); }, true);
addEventListener('blur', mbCtxClose);
addEventListener('resize', mbCtxClose);
document.addEventListener('scroll', mbCtxClose, true);

// ---- Preferences (the settings the app keeps in this browser) ----
function mbPrefs() {
  let dlg = document.getElementById('mbPrefs');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'mbPrefs'; dlg.className = 'img-dlg mb-dlg'; dlg.setAttribute('aria-labelledby', 'mbPrefsH'); document.body.appendChild(dlg); }
  const wel = (() => { try { return localStorage.getItem(WELCOME_KEY) || ''; } catch (e) { return ''; } })();
  const draw = () => {
    const th = mbTheme();
    dlg.innerHTML = `<h2 id="mbPrefsH">Preferences</h2><p class="img-note">Kept in this browser (not in the project).</p>
      <fieldset class="mb-f"><legend>Appearance</legend>${[['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label class="fv-chk"><input type="radio" name="mbTh" value="${v}"${th === v ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
      <fieldset class="mb-f"><legend>Starting</legend><label class="fv-chk"><input type="checkbox" id="mbWel"${wel === 'show' ? ' checked' : ''}> Show the welcome screen every time the app opens</label></fieldset>
      <fieldset class="mb-f"><legend>Panels</legend><label class="fv-chk"><input type="checkbox" id="mbPIn"${panelHidden('model') ? '' : ' checked'}> Inputs panel shown</label>
        <button type="button" class="btn btn-secondary btn-sm" id="mbPReset">Reset the layout</button></fieldset>
      <fieldset class="mb-f"><legend>Keyboard</legend><button type="button" class="btn btn-secondary btn-sm" id="mbPKeys">Keyboard shortcuts…</button></fieldset>
      <div class="img-actions"><button type="button" class="btn btn-secondary" id="mbPDefaults" title="Theme follows the system, the welcome screen as at first, the layout as at first (keys: their own Reset)">Reset preferences</button><button type="button" class="btn btn-primary" id="mbPClose">Close</button></div>`;
    dlg.querySelectorAll('[name="mbTh"]').forEach(r => { r.onchange = () => mbSetTheme(r.value); });
    dlg.querySelector('#mbWel').onchange = e => { try { localStorage.setItem(WELCOME_KEY, e.target.checked ? 'show' : 'seen'); } catch (err) { /* not kept */ } };
    dlg.querySelector('#mbPIn').onchange = e => setPanelHidden('model', !e.target.checked);
    dlg.querySelector('#mbPReset').onclick = () => { mbResetLayout(); draw(); };
    dlg.querySelector('#mbPKeys').onclick = () => { dlg.close(); openHelp('keys'); };
    dlg.querySelector('#mbPDefaults').onclick = () => { mbResetPrefs(); draw(); };
    dlg.querySelector('#mbPClose').onclick = () => dlg.close();
  };
  draw();
  if (!dlg.open) dlg.showModal();
}
/** The preferences as at first: the theme follows the system, the welcome screen as on a first visit, the layout (not the keys). */
function mbResetPrefs() { mbSetTheme('system'); try { localStorage.removeItem(WELCOME_KEY); } catch (e) { /* not kept */ } mbResetLayout(); }
/** The panels as they were at first (keys.js's PANELS defaults) and the inputs panel at its first width. */
function mbResetLayout() {
  for (const k of Object.keys(PANELS)) delete PANELS[k];
  Object.assign(PANELS, { model: false, dock: false, modDock: true, modelHome: true });
  try { localStorage.setItem(PANELS_STORE, JSON.stringify(PANELS)); } catch (e) { /* not kept */ }
  const body = document.getElementById('wbBody'); if (body) body.style.removeProperty('--tree-w');
  applyPanels(); render();
}

// ---- About ----
function mbAbout() {
  let dlg = document.getElementById('mbAbout');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'mbAbout'; dlg.className = 'img-dlg mb-dlg'; dlg.setAttribute('aria-labelledby', 'mbAboutH'); document.body.appendChild(dlg); }
  const ua = navigator.userAgent, br = (ua.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/) || [''])[0].replace('Version', 'Safari').replace('Edg', 'Edge');
  dlg.innerHTML = `<h2 id="mbAboutH">${mbEsc(PROJ_APP)}</h2>
    <table class="kv"><tr><td>Version</td><td>${mbEsc(APP_VERSION)}</td></tr><tr><td>Project file format</td><td>${PROJ_FORMAT} (.bcdl)</td></tr>
      <tr><td>Browser</td><td>${mbEsc(br || 'unknown')}</td></tr><tr><td>Processor threads</td><td>${navigator.hardwareConcurrency || 'unknown'}</td></tr>
      <tr><td>Saving to files</td><td>${projUseFS() ? 'yes (recent projects kept)' : 'download and upload'}</td></tr>
      <tr><td>This computer's memory</td><td>${c3dDeviceGB() ? `${c3dDeviceGB() >= 8 ? 'at least ' : ''}${c3dDeviceGB()} GB (as the browser reports it)` : 'not reported by this browser'}</td></tr>
      <tr><td>A 3D solve's matrix</td><td>in blocks of ${c3dMem(C3D_BLOCK_BYTES)}: no 2 GB limit; the free memory is the limit</td></tr></table>
    <p class="img-note">Every solver runs here, in this browser, off the page's thread; nothing is sent anywhere.</p>
    <div class="img-actions"><button type="button" class="btn btn-primary" id="mbAboutClose">Close</button></div>`;
  dlg.querySelector('#mbAboutClose').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
}

// ---- start: the bar wired, the keys' labels in it; F1, F10, Ctrl+Shift+P are keys.js's ----
mbWire();
applyKeyLabels();
