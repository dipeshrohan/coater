/*
 * matsets.js — the materials behind the Materials cards, and their data sets (M-1). Pure computation, no DOM.
 *
 * Each card row belongs to one material (GO, water, the slurry as a mixture, the PET fibre web, flexible graphite paper,
 * isostatic graphite), to a contact between two of them (friction, sticking, bonds, a face's contact resistance), or to
 * its stage's setup (not a material's: moved there with the cards' redesign). Every material has the app's built-in
 * set, "Generic (literature)" (the defaults with their references); the project may hold its own sets, each over the
 * generic one (only the values it changes). One set is chosen per material for the whole project: every card showing
 * that material shows the chosen set's values. The cards keep their values as before (MAT.<card>[k] = { v, flag, src },
 * what every solver reads): they are what the chosen sets give, and a project from before data sets gets its own sets
 * from its values (msDerive), so it opens with every number as it was.
 */
/** The materials and contacts: { id, t (its name), d (what it is), pair (a contact's two materials) }. */
const MS_MATERIALS = [
  { id: 'go', t: 'GO', d: 'graphene oxide: the flakes, their film, reduced and graphitized' },
  { id: 'water', t: 'Water', d: 'the slurry\'s liquid' },
  { id: 'slurry', t: 'The slurry', d: 'GO in water, as mixed: its solids and how it flows' },
  { id: 'pet', t: 'Fibre web (PET)', d: 'the web the slurry is coated onto' },
  { id: 'paper', t: 'Flexible graphite paper', d: 'between the pieces in the furnace' },
  { id: 'iso', t: 'Isostatic graphite', d: 'the furnace holder\'s plates' },
  { id: 'goPet', t: 'GO film on the fibre web', pair: ['go', 'pet'] },
  { id: 'goPaper', t: 'GO film on graphite paper', pair: ['go', 'paper'] },
  { id: 'goIso', t: 'GO film on isostatic graphite', pair: ['go', 'iso'] },
];
/** Not a material's: the stage's setup (room, numerics, the pre heat treatment's time scale). */
const MS_SETUP = 'setup';
/** Every card row's material: card → key → material id (or MS_SETUP). */
const MS_ROWS = {
  slurry: { phi: 'slurry', rhoS: 'go', rhoL: 'water', dMean: 'go', dMin: 'go', dMax: 'go', tFlake: 'go', co: 'go', phiDry: 'go' },
  flow: { mu: 'slurry', n: 'slurry', ty: 'slurry', g: 'slurry' },
  rheo: { etaInf: 'slurry', lamT: 'slurry', aCY: 'slurry', tb: 'slurry', gdc: 'slurry', cy: 'slurry', ce: 'slurry' },
  orient: { U: 'slurry', Dr: 'slurry', Ci: 'slurry', nLines: MS_SETUP, nFlakes: MS_SETUP },
  dry: { mul: 'slurry', skinK: 'go', kS: 'go', kIn: 'go', cS: 'go', emis: 'go', irAbs: 'go', gabXm: 'go', gabC: 'go', gabK: 'go', cpWeb: 'pet', Troom: MS_SETUP, rhRoom: MS_SETUP },
  film: { Ep: 'go', Et: 'go', Gpt: 'go', nup: 'go', nupt: 'go', Xh: 'go', beta: 'go', alphaF: 'go', sigF: 'go', GcF: 'go', Gil: 'go', Gi: 'goPet', setFrac: MS_SETUP,
    Ew: 'pet', soft: 'pet', nuw: 'pet', alphaW: 'pet', Eg: 'go', stackK: 'go', creepTau: MS_SETUP },
  furn: { Tw: 'go', hc: 'go', s1: 'go', T1: 'go', w1: 'go', c1CO2: 'go', c1CO: 'go', s2: 'go', T2: 'go', w2: 'go', c2CO: 'go', T3: 'go', w3: 'go',
    Tg: 'go', wg: 'go', dIn: 'go', La0: 'go', La1: 'go', kG: 'go', ell: 'go', Dgal: 'go', Dmin: 'go', es: 'go', sigZ: 'go',
    rhoP: 'paper', Dp: 'paper', Ez: 'paper', bO: 'go', bG: 'go', am: 'goPaper', mu: 'goPaper', Tst: 'goPaper', pSt: 'goPaper', tauB: 'goPaper',
    Bpl: 'iso', muPl: 'goIso', TstPl: 'goIso', tauPl: 'goIso', Hr: 'go', kPin: 'paper', kPthr: 'paper', Rc: 'goPaper', kPl: 'iso', rhoPl: 'iso', epsF: 'iso' },
};
/** The cards' row tables (materials.js), by card. */
const msCards = () => ({ slurry: MAT_SLURRY, flow: MAT_FLOW, rheo: MAT_RHEO, orient: MAT_ORIENT, dry: MAT_DRY, film: MAT_FILM, furn: MAT_FURN });
/** A row's id across the cards: 'card.key'. */
const msRowId = (card, k) => `${card}.${k}`;
/** The rows of material m: [{ card, k, id }] in the cards' order. */
function msRowsOf(m) {
  const out = [];
  for (const [card, rows] of Object.entries(msCards())) for (const q of rows) if (MS_ROWS[card][q[0]] === m) out.push({ card, k: q[0], id: msRowId(card, q[0]) });
  return out;
}
// (the defaults the user gave, in the generic set: a typical value with what it stands for)
const MS_LIT_SRC = { 'slurry.phi': 'a typical coating slurry\'s solids', 'slurry.dMean': 'GO flakes about 1–10 µm across', 'slurry.dMin': 'GO flakes about 1–10 µm across', 'slurry.dMax': 'GO flakes about 1–10 µm across' };
const MS_LIT = 'lit';
/** The app's card of material m (named after it): every row of m at the app's default, with its reference. */
function msGeneric(m) {
  const vals = {};
  for (const { card, k, id } of msRowsOf(m)) {
    const q = msCards()[card].find(r => r[0] === k);
    vals[id] = { v: q[7], flag: 'assumed', src: MS_LIT_SRC[id] || q[9] };
  }
  return { id: MS_LIT, mat: m, name: MS_MATERIALS.find(q => q.id === m).t, builtin: true, vals };
}
/** The project's sets as saved: { sel: { material: set id }, own: { id: { id, mat, name, note, vals (only what it changes) } } }. */
const msEmpty = () => ({ sel: Object.fromEntries(MS_MATERIALS.map(m => [m.id, MS_LIT])), own: {} });
const msSame = (a, b) => a.v === b.v && a.flag === b.flag && a.src === b.src;
/** A set by id for material m (the generic one, or the project's own), or null. */
const msSet = (S, m, id) => (id === MS_LIT ? msGeneric(m) : S.own[id] && S.own[id].mat === m ? S.own[id] : null);
/** Row id's value under the chosen sets: the chosen set's, else the generic one's. */
function msValue(S, id) {
  const [card, k] = id.split('.'), m = MS_ROWS[card][k], own = S.own[S.sel[m]];
  return own && own.vals[id] ? own.vals[id] : msGeneric(m).vals[id];
}
/**
 * The project's sets in step with its cards' values (a project from before data sets: keep null; else the sets held):
 * each material whose rows differ from its generic set has them in its chosen own set (the cards' values are what
 * counts: a chosen own set takes them); with the generic set chosen, a new own set holds them, chosen ("As you told us"
 * when they are exactly the defaults the user gave, else "This project"). A material back at its generic values keeps
 * its own set but chooses the generic one. Own sets not chosen are kept as they are.
 */
function msDerive(MATc, keep) {
  const S = keep ? msClone(keep) : msEmpty(), D = matDefaults();
  for (const { id: m } of MS_MATERIALS) {
    if (!(m in S.sel)) S.sel[m] = MS_LIT;
    const g = msGeneric(m), vals = {};
    for (const { card, k, id } of msRowsOf(m)) { const v = MATc[card] && MATc[card][k]; if (v && !msSame({ v: v.v, flag: v.flag, src: v.src }, g.vals[id])) vals[id] = { v: v.v, flag: v.flag, src: v.src }; }
    const cur = S.own[S.sel[m]], n = Object.keys(vals).length;
    if (!n) { if (cur && Object.keys(cur.vals).length) S.sel[m] = MS_LIT; continue; }
    if (cur) { cur.vals = vals; continue; }
    const told = Object.entries(vals).every(([id, v]) => { const [card, k] = id.split('.'), d = D[card][k]; return d.flag === 'given' && msSame(v, d); });
    const id = S.own[`p-${m}`] ? msNewId(S, m) : `p-${m}`;
    S.own[id] = { id, mat: m, name: told ? 'As you told us' : `${MS_MATERIALS.find(q => q.id === m).t} (this project)`, note: told ? 'the values you gave when the app was set up' : 'this project\'s values', ...(told ? {} : { auto: true }), vals };
    S.sel[m] = id;
  }
  return S;
}
/** The cards' rows as the chosen sets give them, written into MATc (each { v, flag, src }); the setup's rows untouched. */
function msApply(S, MATc) {
  for (const [card, rows] of Object.entries(MS_ROWS)) for (const [k, m] of Object.entries(rows)) {
    if (m === MS_SETUP || !MATc[card]) continue;
    const v = msValue(S, msRowId(card, k));
    MATc[card][k] = { ...MATc[card][k], v: v.v, flag: v.flag, src: v.src };
  }
  return MATc;
}
/** Saved sets, checked: the known materials, own sets with their material and rows (unknown rows dropped), sel valid. */
function msIn(s) {
  const S = msEmpty();
  if (!s || typeof s !== 'object') return S;
  for (const [id, o] of Object.entries(s.own || {})) {
    if (!o || !MS_MATERIALS.some(m => m.id === o.mat) || id === MS_LIT) continue;
    const rows = new Set(msRowsOf(o.mat).map(r => r.id)), vals = {};
    for (const [rid, v] of Object.entries(o.vals || {})) if (rows.has(rid) && v && Number.isFinite(v.v)) vals[rid] = { v: v.v, flag: ['given', 'assumed', 'measured'].includes(v.flag) ? v.flag : 'given', src: String(v.src || '') };
    S.own[id] = { id, mat: o.mat, name: String(o.name || 'Your set'), note: String(o.note || ''), vals };
  }
  for (const m of MS_MATERIALS) { const id = s.sel && s.sel[m.id]; if (id === MS_LIT || (S.own[id] && S.own[id].mat === m.id)) S.sel[m.id] = id; }
  return S;
}

/** A copy of the sets (the project's own; the generic ones are built in). */
const msClone = S => ({ sel: { ...S.sel }, own: Object.fromEntries(Object.entries(S.own).map(([id, o]) => [id, { ...o, vals: Object.fromEntries(Object.entries(o.vals).map(([r, v]) => [r, { ...v }])) }])) });
/** A new own set's id for material m, not taken. */
const msNewId = (S, m) => { let i = 1; while (S.own[`u-${m}-${i}`]) i++; return `u-${m}-${i}`; };
/**
 * Write row card.k's value (patch: v, src, flag) into its material's chosen set: the generic one is never changed, so
 * writing while it is chosen starts the project's own set ("This project") over it and chooses it. A typed number is
 * the user's ('given') unless the patch says how it was got (a fit: 'measured'); a row written back to exactly the
 * generic one's value leaves the own set. Returns the new sets (S is not changed).
 */
function msWrite(S, card, k, patch) {
  const m = MS_ROWS[card][k];
  if (!m || m === MS_SETUP) return S;
  const T = msClone(S), id = msRowId(card, k), g = msGeneric(m).vals[id];
  let own = T.own[T.sel[m]];
  if (!own) { const nid = T.own[`p-${m}`] ? msNewId(T, m) : `p-${m}`; own = T.own[nid] = { id: nid, mat: m, name: `${MS_MATERIALS.find(q => q.id === m).t} (this project)`, note: 'values changed in this project', auto: true, vals: {} }; T.sel[m] = nid; }
  const cur = own.vals[id] || g, changed = 'v' in patch && patch.v !== cur.v;
  const nv = { v: changed ? patch.v : cur.v, flag: patch.flag || (changed ? 'given' : cur.flag), src: 'src' in patch ? patch.src : changed && !own.vals[id] ? 'you' : cur.src };
  if (msSame(nv, g)) delete own.vals[id]; else own.vals[id] = nv;
  return T;
}
/** Choose set id for material m (the generic one or an own set of m). */
function msChoose(S, m, id) { if (!msSet(S, m, id)) return S; const T = msClone(S); T.sel[m] = id; return T; }
/** A new own set for material m named `name`, starting from the values now chosen (a copy), and chosen. */
function msNew(S, m, name) {
  const T = msClone(S), id = msNewId(T, m), cur = T.own[T.sel[m]];
  T.own[id] = { id, mat: m, name: String(name || 'New set'), note: '', vals: cur ? Object.fromEntries(Object.entries(cur.vals).map(([r, v]) => [r, { ...v }])) : {} };
  T.sel[m] = id; return T;
}
/** Rename an own set. */
function msRename(S, id, name) { if (!S.own[id] || !String(name || '').trim()) return S; const T = msClone(S); T.own[id].name = String(name).trim(); return T; }
/** Delete an own set; a material that had it chosen goes back to the generic one. */
function msDelete(S, id) { if (!S.own[id]) return S; const T = msClone(S), m = T.own[id].mat; delete T.own[id]; if (T.sel[m] === id) T.sel[m] = MS_LIT; return T; }
/** A card back to the app's defaults: each of its material rows written to its default value (the setup's rows aside). */
function msCardDefaults(S, card) {
  const D = matDefaults()[card]; let T = S;
  for (const [k, m] of Object.entries(MS_ROWS[card])) if (m !== MS_SETUP) {
    const d = D[k], id = msRowId(card, k), g = msGeneric(m).vals[id], own = T.own[T.sel[m]];
    if (msSame({ v: d.v, flag: d.flag, src: d.src }, g)) { if (own && own.vals[id]) { T = msClone(T); delete T.own[T.sel[m]].vals[id]; } }
    else T = msWrite(T, card, k, { v: d.v, flag: d.flag, src: d.src });
  }
  return T;
}
/** How a material's rows on a card stand: { set (its name), n, yours (rows the chosen set changes) }. */
function msSummary(S, m, ids) {
  const own = S.own[S.sel[m]], set = own ? own.name : 'Generic (literature)';
  return { set, n: ids.length, yours: own ? ids.filter(id => own.vals[id]).length : 0 };
}

// ---- the app's ----
/** The project's sets (in step with the cards: msSync). */
let MSETS = typeof window !== 'undefined' && typeof MAT !== 'undefined' ? msDerive(MAT) : null;
/** The sets in step with the cards (anything written to the cards directly), returned. */
function msSync() { msFlowFromP(); return (MSETS = msDerive(MAT, MSETS)); }
/** New sets for the project: the cards' values from them (the slurry's flow rows into the inputs bar's sliders too). */
function msUse(T) { MSETS = T; msApply(MSETS, MAT); msFlowToP(); }
/**
 * The slurry's flow rows in step with the inputs bar (P, what the solvers read): a slider moved since is the card's
 * value now -- a rheometer fit's while it keeps the fitted value (measured), the app's card's at its default, else yours.
 */
function msFlowFromP() {
  if (!MAT.flow) MAT.flow = matDefaults().flow;
  for (const q of MAT_FLOW) {
    const k = q[0], v = P[k], cur = MAT.flow[k];
    if (!Number.isFinite(v) || (cur && cur.v === v)) continue;
    const fit = (MAT.rheo.side || {})[k];
    MAT.flow[k] = fit && fit.v === v ? { v, flag: 'measured', src: fit.src } : v === q[7] ? { v, flag: q[8], src: q[9] } : { v, flag: 'given', src: 'you' };
  }
}
/** The flow rows' values into the inputs bar (as its sliders take them: their range and step), then back (msFlowFromP). */
function msFlowToP() {
  if (!MAT.flow || typeof setInput !== 'function') return;
  for (const q of MAT_FLOW) if (MAT.flow[q[0]] && P[q[0]] !== MAT.flow[q[0]].v) setInput(q[0], MAT.flow[q[0]].v);
  for (const q of MAT_FLOW) if (MAT.flow[q[0]] && P[q[0]] !== MAT.flow[q[0]].v) MAT.flow[q[0]] = { ...MAT.flow[q[0]], v: P[q[0]] };
}
/** A row edited on a card (its number, its note, or a fit's value): through its material's chosen set. */
function msEdit(card, k, patch) { msUse(msWrite(msSync(), card, k, patch)); }
/** The stage's setup rows (not a material's; on their stage's inputs now): prop rows with their inputs (prop: the bar's row builder). */
function msSetupProps(ids, prop) {
  return ids.map(id => { const [card, k] = id.split('.'), q = msCards()[card].find(r => r[0] === k);
    return prop(q[1], `msu_${card}_${k}`, `min="${q[3]}" max="${q[4]}" step="${q[5]}" value="${MAT[card][k].v}" data-mssetup="${id}"`, q[2]); }).join('');
}
/** Their inputs wired: the value into its card row, as it always was (typed: yours, as the stage's other inputs); changed(): the page's redraw. */
function wireMsSetup(changed) {
  document.querySelectorAll('input[data-mssetup]').forEach(el => {
    if (el.dataset.wired) return; el.dataset.wired = '1';
    const [card, k] = el.dataset.mssetup.split('.'), q = msCards()[card].find(r => r[0] === k);
    el.addEventListener('change', () => { guardNumber(el, { label: q[1], lo: q[3], hi: q[4], unit: q[2] }, v => { MAT[card][k] = { ...MAT[card][k], v, flag: 'given', src: 'you' }; }); el.value = MAT[card][k].v; changed(); });
  });
}
/** A card row's material card, by name (the report): its material's chosen card; a stage input: none. */
function msFromText(card, k) {
  const m = MS_ROWS[card] && MS_ROWS[card][k];
  if (!m || m === MS_SETUP) return '';
  const own = MSETS.own[MSETS.sel[m]];
  return own ? own.name : MS_MATERIALS.find(q => q.id === m).t;
}
/** The furnace card's topics inside a material (shown when a material has rows in two or more). */
const MS_FURN_TOPICS = { chem: 'Chemistry as it heats', graph: 'Its layers ordering into graphite', gas: 'Gas and puffing', paper: 'Density, gas, stiffness', plane: 'Along the piece', plate: 'Gas through it', heat: 'Heat' };
/** What changed between two sets, as an undo step's name (a set chosen, made, renamed, deleted), or null (values only). */
function msUndoLabel(a, b) {
  if (!a || !b) return null;
  const mt = id => (MS_MATERIALS.find(m => m.id === id) || { t: id }).t, nm = (S, id, m) => (S.own[id] ? S.own[id].name : mt(m));
  const add = Object.keys(b.own).find(id => !a.own[id]), del = Object.keys(a.own).find(id => !b.own[id]);
  // (a set an edit started -- "This project" -- is named by the value it holds, the row's step)
  if (add) return b.own[add].auto ? null : `${mt(b.own[add].mat)}: new card “${b.own[add].name}”`;
  if (del) return `${mt(a.own[del].mat)}: card “${a.own[del].name}” deleted`;
  const ren = Object.keys(b.own).find(id => a.own[id] && a.own[id].name !== b.own[id].name);
  if (ren) return `${mt(b.own[ren].mat)}: card renamed “${b.own[ren].name}”`;
  const ch = Object.keys(b.sel).find(m => a.sel[m] !== b.sel[m]);
  return ch ? `${mt(ch)}: card “${nm(b, b.sel[ch], ch)}”` : null;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MS_MATERIALS, MS_ROWS, MS_SETUP, MS_LIT, msRowsOf, msRowId, msGeneric, msEmpty, msSet, msValue, msDerive, msApply, msIn, msClone, msWrite, msChoose, msNew, msRename, msDelete, msCardDefaults, msSummary };
