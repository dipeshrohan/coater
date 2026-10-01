/*
 * matsets.validate.js — checks of the materials and their data sets (matsets.js). Run: node matsets.validate.js
 *  1. The registry: every card row has one material (or its stage's setup), every material has rows, every contact's
 *     pair is two materials.
 *  2. The generic sets: every row of a material at its default, with a reference.
 *  3. The defaults: their sets give back every card value as it is (v, flag, source); the values the user gave make
 *     "As you told us" (GO: its particle sizes; the slurry: its solids and its measured viscosity), every other material the app's card.
 *  4. Edited cards: any values, flags and sources changed, their sets give them back exactly; a setup row is never
 *     touched; an own set not chosen is kept; the sets as saved (JSON) read back the same.
 *  5. Projects saved before data sets: every one found opens with every card value as it was.
 */
const fs = require('fs'), path = require('path');
const M = require('./materials.js');
Object.assign(globalThis, M);
const S = require('./matsets.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const cards = { slurry: M.MAT_SLURRY, flow: M.MAT_FLOW, rheo: M.MAT_RHEO, orient: M.MAT_ORIENT, dry: M.MAT_DRY, film: M.MAT_FILM, furn: M.MAT_FURN };
const clone = o => JSON.parse(JSON.stringify(o));
/** Every card row of a against b: the rows that differ (v, flag or src). */
const diffs = (a, b) => { const out = []; for (const [card, rows] of Object.entries(cards)) for (const q of rows) { const x = a[card][q[0]], y = b[card][q[0]]; if (x.v !== y.v || x.flag !== y.flag || x.src !== y.src) out.push(`${card}.${q[0]}`); } return out; };

// 1. the registry
{
  const all = Object.entries(cards).flatMap(([card, rows]) => rows.map(q => [card, q[0]]));
  const unmapped = all.filter(([card, k]) => !(k in S.MS_ROWS[card]));
  const extra = Object.entries(S.MS_ROWS).flatMap(([card, r]) => Object.keys(r).filter(k => !cards[card].some(q => q[0] === k)).map(k => `${card}.${k}`));
  const ids = new Set(S.MS_MATERIALS.map(m => m.id));
  const bad = Object.entries(S.MS_ROWS).flatMap(([card, r]) => Object.entries(r).filter(([, m]) => m !== S.MS_SETUP && !ids.has(m)).map(([k]) => `${card}.${k}`));
  check(`every card row has one material or its stage's setup (${all.length} rows)`, !unmapped.length && !extra.length && !bad.length, JSON.stringify({ unmapped, extra, bad }));
  const counts = Object.fromEntries(S.MS_MATERIALS.map(m => [m.id, S.msRowsOf(m.id).length]));
  check('  every material and contact has rows', Object.values(counts).every(n => n > 0), JSON.stringify(counts));
  check('  every contact is between two of the materials', S.MS_MATERIALS.filter(m => m.pair).every(m => m.pair.length === 2 && m.pair.every(p => ids.has(p) && !S.MS_MATERIALS.find(q => q.id === p).pair)));
  const setup = Object.entries(S.MS_ROWS).flatMap(([card, r]) => Object.entries(r).filter(([, m]) => m === S.MS_SETUP).map(([k]) => `${card}.${k}`));
  check('  the setup\'s rows: room, numerics, the roll\'s set and the pre heat treatment\'s creep', JSON.stringify(setup) === JSON.stringify(['orient.nLines', 'orient.nFlakes', 'dry.Troom', 'dry.rhRoom', 'film.setFrac', 'film.creepTau']), setup.join(' '));
}
// 2. the generic sets
{
  const d = M.matDefaults(); let ok = true, n = 0;
  for (const m of S.MS_MATERIALS) { const g = S.msGeneric(m.id); for (const { card, k, id } of S.msRowsOf(m.id)) { n++; const v = g.vals[id]; ok = ok && v.v === d[card][k].v && v.flag === 'assumed' && v.src.trim().length > 0; } }
  check(`the generic sets: every row at its default, assumed, with a reference (${n} rows)`, ok);
}
// 3. the defaults
{
  const d = M.matDefaults(), sets = S.msDerive(d), back = S.msApply(sets, M.matDefaults());
  check('the defaults: their sets give every card value back (v, flag, source)', diffs(back, d).length === 0, diffs(back, d).join(' '));
  const own = Object.values(sets.own).map(s => `${s.mat}: ${s.name} (${Object.keys(s.vals).join(', ')})`);
  check('  what you gave is "As you told us": GO\'s particle sizes, the slurry\'s solids and viscosity; the rest the app\'s card', JSON.stringify(own) === JSON.stringify(['go: As you told us (slurry.dMean, slurry.dMin, slurry.dMax)', 'slurry: As you told us (slurry.phi, flow.mu)'])
    && S.MS_MATERIALS.filter(m => !['go', 'slurry'].includes(m.id)).every(m => sets.sel[m.id] === S.MS_LIT), own.join('; '));
}
// 4. edited cards
{
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let worst = [], keptSetup = true;
  for (let trial = 0; trial < 50; trial++) {
    const e = M.matDefaults();
    for (const [card, rows] of Object.entries(cards)) for (const q of rows) {
      const r = rnd();
      if (r < 0.15) e[card][q[0]].v = +(q[3] + (q[4] - q[3]) * rnd()).toPrecision(4);
      else if (r < 0.2) e[card][q[0]].flag = ['given', 'assumed', 'measured'][Math.floor(rnd() * 3)];
      else if (r < 0.23) e[card][q[0]].src = 'from a test on ' + trial;
    }
    const sets = S.msIn(clone(S.msDerive(e)));   // (as saved and read back)
    const fresh = M.matDefaults(), back = S.msApply(sets, fresh);
    // (the setup's rows: msApply leaves them; the app keeps them in the cards as before)
    for (const [card, r] of Object.entries(S.MS_ROWS)) for (const [k, m] of Object.entries(r)) if (m === S.MS_SETUP) { keptSetup = keptSetup && back[card][k].v === M.matDefaults()[card][k].v; back[card][k] = e[card][k]; }
    const dd = diffs(back, e); if (dd.length > worst.length) worst = dd;
  }
  check('50 projects with values, flags and sources changed at random: their sets (saved, read back) give them back exactly', worst.length === 0, worst.join(' '));
  check('  a setup row is never changed by the sets', keptSetup);
  const e = M.matDefaults(); e.furn.kPl.v = 120; e.furn.kPl.src = 'datasheet';
  const s1 = S.msDerive(e); s1.own.mine = { id: 'mine', mat: 'iso', name: 'Supplier grade X', note: '', vals: { 'furn.kPl': { v: 90, flag: 'given', src: 'grade X' } } };
  const s2 = S.msDerive(e, s1);
  check('  an own set not chosen is kept; the chosen one stays as it is', !!s2.own.mine && s2.sel.iso === s1.sel.iso && s2.own[s1.sel.iso].vals['furn.kPl'].v === 120);
  s2.sel.iso = 'mine'; const b2 = S.msApply(s2, M.matDefaults());
  check('  choosing another set changes the cards: the holder\'s plates k 90 from "Supplier grade X"', b2.furn.kPl.v === 90 && b2.furn.kPl.src === 'grade X' && b2.furn.rhoPl.v === M.matDefaults().furn.rhoPl.v);
}
// 5. projects saved before data sets
{
  const root = process.env.MS_PROJECTS || path.join(__dirname, '..');
  const found = [];
  const walk = (dir, depth) => { if (depth > 3) return; let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; } for (const x of es) { const f = path.join(dir, x.name); if (x.isDirectory() && !x.name.startsWith('.') && x.name !== 'node_modules') walk(f, depth + 1); else if (x.name.endsWith('.bcdl')) found.push(f); } };
  walk(root, 0);
  let n = 0, bad = [];
  for (const f of found.slice(0, 40)) {
    let p; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    const m = p.materials; if (!m) continue;
    // (as the app reads them: the defaults, then each saved card value with its number)
    const cur = M.matDefaults();
    for (const card of Object.keys(cards)) if (m[card]) for (const k of Object.keys(cur[card])) if (m[card][k] && Number.isFinite(m[card][k].v)) cur[card][k] = { ...cur[card][k], ...m[card][k] };
    const back = S.msApply(S.msIn(clone(S.msDerive(cur))), M.matDefaults());
    for (const [card, r] of Object.entries(S.MS_ROWS)) for (const [k, mm] of Object.entries(r)) if (mm === S.MS_SETUP) back[card][k] = cur[card][k];
    const dd = diffs(back, cur); n++; if (dd.length) bad.push(path.basename(f) + ': ' + dd.join(' '));
  }
  check(`projects saved before data sets open with every card value as it was (${n} found)`, n === 0 || !bad.length, bad.slice(0, 3).join(' | '));
}

// 6. editing: one set per material, shared by the cards
{
  const D = M.matDefaults(); let T = S.msDerive(D);
  const gBefore = JSON.stringify(S.msGeneric('iso'));
  T = S.msWrite(T, 'furn', 'kPl', { v: 120 });
  let C = S.msApply(T, M.matDefaults());
  check('writing while the app\'s card is chosen starts "Isostatic graphite (this project)" over it, chosen; the app\'s card unchanged',
    T.sel.iso === 'p-iso' && T.own['p-iso'].name === 'Isostatic graphite (this project)' && C.furn.kPl.v === 120 && C.furn.kPl.flag === 'given' && C.furn.kPl.src === 'you' && C.furn.rhoPl.v === D.furn.rhoPl.v && JSON.stringify(S.msGeneric('iso')) === gBefore);
  T = S.msWrite(T, 'furn', 'kPl', { src: 'supplier datasheet, grade X' }); C = S.msApply(T, M.matDefaults());
  check('  its note written to the same set', C.furn.kPl.src === 'supplier datasheet, grade X' && C.furn.kPl.v === 120);
  T = S.msWrite(T, 'furn', 'Dgal', { v: 88.7, flag: 'measured', src: 'from your first run not puffing' }); C = S.msApply(T, M.matDefaults());
  check('  a fit\'s value: measured, with what it was fitted to', C.furn.Dgal.flag === 'measured' && C.furn.Dgal.v === 88.7 && T.sel.go === 'p-go');
  // the GO's set shared by four cards: a new set changing a row on the Drying, Film and Furnace cards
  let U = S.msNew(T, 'go', 'Batch 12');
  U = S.msWrite(U, 'dry', 'kS', { v: 0.3 }); U = S.msWrite(U, 'film', 'Ep', { v: 25 });
  const cU = S.msApply(U, M.matDefaults()), back = S.msApply(S.msChoose(U, 'go', 'p-go'), M.matDefaults());
  check('a new GO set starts from the values chosen (a copy) and is chosen; its rows on 3 cards follow it',
    U.own[U.sel.go].name === 'Batch 12' && cU.furn.Dgal.v === 88.7 && cU.dry.kS.v === 0.3 && cU.film.Ep.v === 25 && cU.slurry.dMean.flag === 'given');
  check('  choosing the earlier GO set: every card back to it at once', back.dry.kS.v === D.dry.kS.v && back.film.Ep.v === D.film.Ep.v && back.furn.Dgal.v === 88.7);
  const R = S.msRename(U, U.sel.go, 'Batch 12 (dried 2 h)'), X = S.msDelete(R, R.sel.go);
  check('  renamed; deleted: the GO back to the generic set', R.own[R.sel.go].name === 'Batch 12 (dried 2 h)' && X.sel.go === S.MS_LIT && !Object.values(X.own).some(o => o.name.startsWith('Batch 12')));
  // a value written back to the generic one's leaves the own set
  let W = S.msWrite(T, 'furn', 'kPl', { v: D.furn.kPl.v, flag: 'assumed', src: D.furn.kPl.src });
  check('a row written back to exactly the generic value leaves the own set', !W.own['p-iso'].vals['furn.kPl']);
  // Defaults on one card: its rows back as the app's defaults; the other cards' edits stay
  let Y = S.msWrite(S.msWrite(T, 'dry', 'kS', { v: 0.31 }), 'slurry', 'dMean', { v: 7 });
  Y = S.msCardDefaults(Y, 'furn'); const cY = S.msApply(Y, M.matDefaults());
  const furnBack = M.MAT_FURN.every(q => cY.furn[q[0]].v === D.furn[q[0]].v && cY.furn[q[0]].flag === D.furn[q[0]].flag);
  check('Defaults on the Furnace card: its rows as the app\'s defaults; the Drying and Slurry cards\' edits kept', furnBack && cY.dry.kS.v === 0.31 && cY.slurry.dMean.v === 7);
  const Z = S.msCardDefaults(Y, 'slurry'), cZ = S.msApply(Z, M.matDefaults());
  check('  Defaults on the Slurry card: what you told us back (given)', M.MAT_SLURRY.every(q => cZ.slurry[q[0]].v === D.slurry[q[0]].v && cZ.slurry[q[0]].flag === D.slurry[q[0]].flag && cZ.slurry[q[0]].src === D.slurry[q[0]].src), cZ.slurry.dMean.flag);
}

// 7. the slurry's flow rows: the inputs bar's own (CFG: label, unit, range, step, decimals and default all the same)
{
  const src = fs.readFileSync(path.join(__dirname, 'physics.js'), 'utf8');
  const bad = M.MAT_FLOW.filter(([k, l, u, lo, hi, step, d, v]) => {
    const m = src.match(new RegExp(`\\{[^{}]*k: '${k}', l: '([^']*)', min: ([^,]+), max: ([^,]+), step: ([^,]+), u: '([^']*)', d: ([^,]+), v: ([^,}\\s]+)`));
    return !m || m[1] !== l || +m[2] !== lo || +m[3] !== hi || +m[4] !== step || m[5] !== u || +m[6] !== d || +m[7] !== v;
  }).map(q => q[0]);
  check('the slurry\'s flow rows are the inputs bar\'s (label, unit, range, step, default)', bad.length === 0, bad.join(', '));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
