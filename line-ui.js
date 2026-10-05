'use strict';
/*
 * line-ui.js — the Line (view 14): the process at a glance, for the inputs as they are (nothing is typed in here):
 *  - a flow diagram of its eight stages in their order (1 Mixing … 8 Graphene film), each unit with where it stands and
 *    the streams between them numbered S1–S7; a click on a unit opens its stage;
 *  - the streams: what each stage hands on (thickness, water, solids per area, size, flatness, density);
 *  - the checks: every stage's checks against their limits, each judged by the rule its own page uses.
 * Every value is a stage's own computed result, for the film and the way the water leaves chosen for the stages after
 * the coating (DRY.sel, SHEET.way: the same switches as on the stage pages). The stages not solved yet are asked for,
 * and the page is drawn again as they arrive.
 */

/** A stage's state: its word and its colour. 'done': solved, with nothing its page judges. */
const LINE_ST = { ok: ['OK', 'ok'], done: ['Solved', 'ok'], warn: ['Risk', 'warn'], bad: ['Defect', 'bad'], busy: ['Solving', 'muted'], todo: ['Not solved', 'muted'], stale: ['Out of date', 'warn'], none: ['Not modelled', 'muted'], fail: ['Failed', 'bad'] };
const lineNum = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '—';
/** A size change (strain) as a percentage to two significant figures, and what it is over the piece's length L (m). */
const lineSize = (e, L) => !Number.isFinite(e) ? '—' : e === 0 ? '0 %'
  : `${(e * 100).toPrecision(2).replace('-', '−')} %${Number.isFinite(L) ? ` (${e * L * 1e6 >= 0 ? '+' : '−'}${Math.abs(e * L * 1e6).toFixed(0)} µm over ${(L * 1000).toFixed(0)} mm)` : ''}`;
/** The way the water leaves the film that the stages after the drying follow (the Cutting page's switch). */
const lineWay = () => typeof SHEET !== 'undefined' && SHEET.way === 'both' ? 'both' : 'top';
const LINE_WAYS = { top: 'Top only', both: 'Top and bottom' };
const lineSel = () => (typeof DRY !== 'undefined' && DRY.sel) || 'web';
/** The run of a stage's two (top only, top and bottom) for the way followed. */
const linePick = runs => (runs && runs[lineWay() === 'both' ? 1 : 0]) || null;
/** The worst of the levels judged ('bad' over 'warn' over 'ok'); none judged: 'done'. */
const lineWorst = L => { const q = L.filter(Boolean); return !q.length ? 'done' : q.includes('bad') ? 'bad' : q.includes('warn') ? 'warn' : 'ok'; };

/** A stage's tab, on the page shown there last (the coating: its model or its results, as left). */
const lineGo = k => goSection(SECTIONS.findIndex(s => s.k === k));

/**
 * Every stage's checks for the film and the way followed: { mix, coat, dry, peel, cut, stack, furn }, each null while it is
 * not solved, else [{ t, res, lim, v (the result over its limit, or null), lv ('ok' | 'warn' | 'bad'; null: shown, not
 * judged) }]. Each as its page judges it: the mixer's by mixChecks, the coating's by the Results pages' verdicts (contactAcross, edgeOutlook,
 * surfaceOutlook), the drying's by dryWarnings, the peel's by filmChecks and filmWarnings, the stack's by its page (its pull
 * against the film's strength: a risk), the furnace's by its lights (furnLevel). The cut piece's flatness has no limit: shown.
 */
function lineChecks() {
  const C = { mix: null, coat: null, dry: null, peel: null, cut: null, stack: null, furn: null }, way = lineWay(), sel = lineSel();
  if (typeof mixCurrent === 'function' && mixCurrent()) C.mix = mixChecks(MIX.res).map(({ say, ...q }) => q);
  const ca = contactAcross(), ed = edgeOutlook(), sf = surfaceOutlook();
  if (ca && ed && sf) C.coat = [
    { t: 'Contact line below the notch corner', res: `${ca.mx.toFixed(2)} mm up the face`, lim: `${P.face} mm`, v: ca.mx / P.face, lv: ca.over ? 'bad' : 'ok' },
    { t: 'Contact line even across the web', res: `${ca.peakToPeak.toFixed(2)} mm peak to peak`, lim: '0.5 mm', v: ca.peakToPeak / 0.5, lv: ca.peakToPeak > 0.5 ? 'warn' : 'ok' },
    { t: 'Web edge straight at the oven', res: ed.e.arrest ? 'held by its yield stress' : `${(ed.endAmplitude * 2).toFixed(1)} mm peak to peak`, lim: '0.4 mm', v: ed.e.arrest ? 0 : ed.endAmplitude / 0.2, lv: ed.verdict[1] },
    { t: 'Surface level at the oven', res: `${sf.remainMicrons < 10 ? sf.remainMicrons.toFixed(1) : sf.remainMicrons.toFixed(0)} µm ripple`, lim: '5 µm', v: sf.remainMicrons / 5, lv: sf.verdict[1] },
  ];
  const dr = typeof dryCurrent === 'function' && dryCurrent() ? linePick(dryRuns(sel)) : null;
  if (dr) {
    const fib = FIBRES[CFDG.fibre];
    C.dry = [
      { t: 'Dry at the oven exit', res: dr.exit.dry ? `dry at ${dryPlace(dr.events.dry)}` : `${dr.exit.waterPct.toFixed(0)} % water left`, lim: 'dry', v: null, lv: dr.exit.dry ? 'ok' : 'warn' },
      { t: 'Water below its boiling point', res: dr.events.boil != null ? `boils at ${dryPlace(dr.events.boil)}${dr.events.boilSkin ? ', under the skin' : ''}` : 'does not boil', lim: '—', v: null, lv: dr.events.boil != null ? 'bad' : 'ok' },
      { t: 'No condensation as it enters', res: dr.events.condense != null ? 'condenses' : 'none', lim: '—', v: null, lv: dr.events.condense != null ? 'warn' : 'ok' },
      { t: 'Fibre web below its use temperature', res: `${dr.Tmax.toFixed(0)} °C at most`, lim: `${fib.tUse} °C`, v: null, lv: dr.Tmax > fib.tUse ? 'warn' : 'ok' },
    ];
  }
  const fr = typeof filmCurrent === 'function' && filmCurrent() ? linePick(filmRuns(sel)) : null;
  if (fr) {
    const F = MAT.film, tears = fr.peel.byAngle.filter(q => q.tears);
    C.peel = [
      { t: 'Dry at the peel', res: fr.wetAtPeel ? `${fr.atPeel.waterPct.toFixed(0)} % water: wet paste inside` : 'dry', lim: 'dry', v: null, lv: fr.wetAtPeel ? 'bad' : 'ok' },
      { t: 'No cracks on the web', res: fr.worst ? `${fr.worst.ratio.toFixed(2)} × its toughness` : 'not in tension', lim: '1 ×', v: fr.worst ? fr.worst.ratio : 0, lv: fr.worst && fr.worst.ratio >= 1 ? 'bad' : 'ok' },
      { t: 'Peels cleanly', res: fr.peel.selfPeel ? 'comes off by itself' : tears.length ? `tears at ${tears[0].deg}–${tears[tears.length - 1].deg}°` : fr.peel.bits ? 'leaves bits on the web' : `${filmN(fr.peel.hand.f)} N/m by hand`, lim: '—', v: null, lv: fr.peel.selfPeel || tears.length || fr.peel.bits ? 'bad' : 'ok' },
      { t: 'Holds on the roll', res: `${(fr.roll.sMax / 1e6).toFixed(0)} MPa on the ${OVEN.peel.core} mm core`, lim: `${F.sigF.v} MPa`, v: fr.roll.sMax / 1e6 / F.sigF.v, lv: fr.roll.cracks ? 'bad' : 'ok' },
      { t: 'No blisters', res: `${fr.blisters.max.ratio.toFixed(2)} × its hold${fr.blisters.steam ? '; steam under its skin' : ''}`, lim: '1 ×', v: fr.blisters.max.ratio, lv: fr.blisters.max.ratio >= 1 || fr.blisters.steam ? 'bad' : 'ok' },
    ];
  }
  const sr = typeof sheetCurrent === 'function' && sheetCurrent() ? SHEET.res.runs.find(r => r.where === way) : null;
  if (sr) C.cut = [{ t: 'Flatness on a table', res: `corners ${sheetMM(sr.table.corner)} up`, lim: '—', v: null, lv: null }];
  const kr = typeof stackCurrent === 'function' && stackCurrent() ? STACK.res.runs.find(r => r.where === way).stack : null;
  if (kr) {
    const sig = MAT.film.sigF.v;
    C.stack = [
      { t: 'Holds while pressed flat', res: `${kr.peak.MPa.toFixed(0)} MPa at its drying edges`, lim: `${sig} MPa`, v: kr.peak.MPa / sig, lv: kr.peak.MPa >= sig ? 'warn' : 'ok' },
      { t: 'Flatness out of the stack', res: `corners ${sheetMM(kr.shapes.outTable.corner)} up`, lim: '—', v: null, lv: null },
    ];
  }
  if (typeof furnCurrent === 'function' && furnCurrent()) {
    const B = furnBatch(FURN.res), Tmax = Math.max(...FURN.res.hist.map(q => q.T));
    const words = { puff: ['Puffing', 'its layers\' hold'], crack: ['Cracking', 'its strength'], wave: ['Waves', 'its buckling load'], stick: ['Sticking', `${MAT.furn.Tst.v} °C`], even: ['Thickness spread', `${OVEN.furn.sdMax} µm`] };
    C.furn = furnLights(FURN.res).map(q => ({ t: (words[q.k] || [q.t])[0], lim: (words[q.k] || [, '—'])[1], v: Number.isFinite(q.v) ? q.v : null, lv: Number.isFinite(q.v) ? furnLevel(q.v) : null,
      res: q.k === 'stick' ? `${Tmax.toFixed(0)} °C at most` : q.k === 'even' ? `${(B.sd * 1e6).toFixed(1)} µm standard deviation` : furnWord(q) }));
  }
  return C;
}

/** The eight stages: { k (their tabs' keys), t, go (a click: its tab), st (LINE_ST), rows [[label, value]] (its key figures:
 *  the stage pages' heads), checks (lineChecks' for it) }. */
function lineStages(C = lineChecks()) {
  const out = [], worst = L => lineWorst(L.map(q => q.lv));
  // (a stage without its checks: solving (asked for or under way), out of date, could not be solved, or not solved -- Phase 0:
  //  nothing solves until asked)
  const unsolved = k => solvePending(k) ? 'busy' : ({ failed: 'fail', stale: 'stale' })[solveState(k)] || 'todo';
  // 1 Mixing: the batch through its program (MIX-1), with what it makes as Materials holds it
  const c = MAT.slurry, mOk = typeof mixCurrent === 'function' && mixCurrent(), mE = mOk ? MIX.res.end : null;
  out.push({ k: 'mix', t: 'Mixing', go: () => navGo('mix'), st: C.mix ? worst(C.mix) : unsolved('mix'), checks: C.mix,
    rows: [['Solids', `${matPhiTxt()} vol% GO (${(slurrySolidsMass() * 100).toFixed(1)} % by mass)`], ['Slurry density', `${slurryRho().toFixed(0)} kg/m³`],
      ...(mOk ? [['Grind gauge', mixGrind(mE.grind)], ['pH', mE.pH.toFixed(1)], ['Viscosity after mixing', `${mixSig(mE.mu27)} Pa·s at 2.7 1/s`]] : [])] });
  // 2 Coating: the answers (answers.js)
  const web = processWeb();
  out.push({ k: 'coat', t: 'Coating', go: () => lineGo('coat'), st: C.coat ? worst(C.coat) : unsolved('1d'), checks: C.coat,
    rows: web ? [['Wet film, mean', `${(web.mean * 1000).toFixed(3)} mm`]] : [] });
  // 3 Drying
  out.push({ k: 'dry', t: 'Drying', go: () => navGo('dry'), st: C.dry ? worst(C.dry) : unsolved('dry'), checks: C.dry, rows: [] });
  // 4 Peel and wind
  out.push({ k: 'peel', t: 'Peel and wind', go: () => navGo('peel'), st: C.peel ? worst(C.peel) : unsolved('film'), checks: C.peel, rows: [] });
  // 5 Cutting: the piece as cut (its page's head: the piece, its curl, its corners)
  const sOk = typeof sheetCurrent === 'function' && sheetCurrent(), way = lineWay();
  const sRun = sOk ? SHEET.res.runs.find(r => r.where === way) : null, sP = sOk ? SHEET.res.q.pieces.find(x => x.where === way).plate : null;
  out.push({ k: 'cut', t: 'Cutting', go: () => navGo('cut'), st: C.cut ? worst(C.cut) : unsolved('sheet'), checks: C.cut,
    rows: sOk ? [['Piece', `${(SHEET.res.q.Lx * 1000).toFixed(0)} × ${(SHEET.res.q.Ly * 1000).toFixed(0)} mm`], ['Wants to curl to', Math.abs(sP.kS) > 1e-6 ? `R ${(1000 / Math.abs(sP.kS)).toFixed(0)} mm` : 'flat'],
      ['On a table: corners up', sheetMM(sRun.table.corner)], ['Held up: corners off its middle', sheetMM(sRun.free.corner)]] : [] });
  // 6 Pre heat treatment: the pressed stack, the pieces out of it
  const kOk = typeof stackCurrent === 'function' && stackCurrent(), kRun = kOk ? STACK.res.runs.find(r => r.where === way).stack : null, out6 = kOk ? kRun.shapes.outTable : null;
  out.push({ k: 'stack', t: 'Pre heat treatment', go: () => navGo('stack'), st: C.stack ? worst(C.stack) : unsolved('stack'), checks: C.stack,
    rows: kOk ? [['Stack', `pressed, ${OVEN.peel.dryT} °C, ${OVEN.peel.tOven} h`], ['Size out of it, from as cut', lineSize(kRun.sizeOut[0], SHEET.res ? SHEET.res.q.Lx : NaN)],
      ['Out of it: corners up on a table', sheetMM(out6.corner)]] : [] });
  // 7 Furnace: its checks; 8 the graphene film (the furnace's product: its checks are the furnace's)
  const uOk = !!C.furn;
  out.push({ k: 'furn', t: 'Furnace', go: () => navGo('furn'), st: uOk ? worst(C.furn) : unsolved('furn'), checks: C.furn, rows: [] });
  const B = uOk ? furnBatch(FURN.res) : null, e = uOk ? FURN.res.end : null;
  out.push({ k: 'gfilm', t: 'Graphene film', go: () => navGo('gfilm'), st: uOk ? worst(C.furn) : unsolved('furn'), checks: null,
    rows: uOk ? [['Thickness', `${furnUm(B.h)} ± ${(B.sd * 1e6).toFixed(1)} µm (${(B.h / FURN.res.q.P.h).toFixed(2)}× the GO piece)`], ['Density', `${(B.rho / 1000).toFixed(2)} g/cm³`],
      ['Heat along it', `${B.kappa.toFixed(0)} W/(m·K)`], ['C/O', furnCO(e.CO)], ['Graphitized', `${(e.g * 100).toFixed(0)} %`]] : [] });
  return out;
}

/**
 * The streams between the stages, for the film and the way followed: [{ id, t, from, to, cells: { h, x, m, size, flat, rho } }],
 * each cell { v, sub } or null (not a property of that stream, or not computed). h thickness (µm), x water (% of the GO's
 * mass), m solids per area (g/m²: the GO; the graphene film's own), size (mm), flat (mm, the corners up on a table), rho
 * density (g/cm³). From: the slurry card (S1), the wet film the drying starts from and its mass balance (S2), the drying at
 * its exit (S3), the film as it peels -- only its dry (set) part when it is wet inside, as film.js peels it (S4), the piece
 * as cut (S5), out of the pressed stack (S6), the furnace's batch and its middle piece's size (S7).
 */
function lineStreams() {
  // (a stream not solved: '…' while the line solves, else '—' -- Phase 0, nothing solves until asked)
  const c = MAT.slurry, sel = lineSel(), way = lineWay(), busy = SOLVE_LINE.some(solvePending) ? { v: '…', sub: '' } : null;
  const cell = (v, sub = '') => ({ v, sub }), um = h => (h * 1e6).toFixed(0), pct = x => (x * 100).toFixed(1);
  const X0 = (1 - c.phi.v / 100) * c.rhoL.v / (c.phi.v / 100 * c.rhoS.v * 1000);   // (the slurry's water per GO, kg/kg)
  const S = [
    { id: 'S1', t: 'Slurry', from: 'mix', to: 'coat' }, { id: 'S2', t: 'Wet film', from: 'coat', to: 'dry' }, { id: 'S3', t: 'Film at the oven exit', from: 'dry', to: 'peel' },
    { id: 'S4', t: 'Film peeled, on the roll', from: 'peel', to: 'cut' }, { id: 'S5', t: 'Pieces as cut', from: 'cut', to: 'stack' }, { id: 'S6', t: 'Pieces out of the stack', from: 'stack', to: 'furn' },
    { id: 'S7', t: 'Graphene film', from: 'furn', to: 'gfilm' },
  ].map(s => ({ ...s, cells: {} }));
  S[0].cells = { x: cell(pct(X0)), rho: cell((slurryRho() / 1000).toFixed(2)) };
  const f0 = typeof dryFilms === 'function' ? dryFilms().find(f => f.key === sel) : null;
  if (f0) {
    const mb = massBalance(f0.h0, lineSpeed(), webWidth() / 1000);
    S[1].cells = { h: cell(um(f0.h0), sel === 'web' ? 'the web\'s mean' : sel), x: cell(pct(X0)), m: cell(mb.coatDry.toFixed(0)), rho: cell((slurryRho() / 1000).toFixed(2)) };
  } else S[1].cells = { h: busy };
  const dr = typeof dryCurrent === 'function' && dryCurrent() ? linePick(dryRuns(sel)) : null;
  S[2].cells = dr ? { h: cell(um(dr.exit.h)), x: cell(pct(dr.exit.waterPct / 100), dr.exit.dry ? 'dry' : 'wet'), m: f0 ? cell(massBalance(f0.h0, lineSpeed(), webWidth() / 1000).coatDry.toFixed(0)) : null } : { h: busy };
  const fr = typeof filmCurrent === 'function' && filmCurrent() ? linePick(filmRuns(sel)) : null;
  if (fr) {
    const pl = fr.plate, part = fr.wetAtPeel ? 'its dry part only' : '';
    // (and as a gauge reads it: its weight in the room over the dry film's density as a gauge reads it, Materials)
    S[3].cells = { h: cell(um(fr.peel.h), part || `${um(matGaugeThickness(pl.h * pl.rhoG * (1 + pl.Xcut)))} as a gauge reads it`), x: cell(pct(pl.Xcut)), m: cell((pl.h * pl.rhoG * 1000).toFixed(0), part) };
  } else S[3].cells = { h: busy };
  const sOk = typeof sheetCurrent === 'function' && sheetCurrent();
  if (sOk && fr) {
    const q = SHEET.res.q, pl = q.pieces.find(x => x.where === way).plate, run = SHEET.res.runs.find(r => r.where === way);
    S[4].cells = { h: cell(um(pl.h), `${um(matGaugeThickness(pl.h * pl.rhoG * (1 + pl.Xcut)))} as a gauge reads it`), x: cell(pct(pl.Xcut)), m: cell((pl.h * pl.rhoG * 1000).toFixed(0)), size: cell(`${(q.Lx * 1000).toFixed(1)} × ${(q.Ly * 1000).toFixed(1)}`),
      flat: cell((run.table.corner * 1000).toFixed(1)), rho: cell((pl.rhoG / 1000).toFixed(2)) };
  } else S[4].cells = { h: busy };
  const kOk = typeof stackCurrent === 'function' && stackCurrent();
  if (kOk && sOk) {
    const q = SHEET.res.q, pl = q.pieces.find(x => x.where === way).plate, k = STACK.res.runs.find(r => r.where === way).stack;
    S[5].cells = { x: cell(pct(k.Xend[k.Xend.length - 1])), m: cell((pl.h * pl.rhoG * 1000).toFixed(0)),
      size: cell(`${(q.Lx * 1000 * (1 + k.sizeOut[0])).toFixed(1)} × ${(q.Ly * 1000 * (1 + (k.sizeOut[1] ?? k.sizeOut[0]))).toFixed(1)}`, lineSize(k.sizeOut[0]).replace(/ \(.*/, '')),
      flat: cell((k.shapes.outTable.corner * 1000).toFixed(1)) };
  } else S[5].cells = { x: busy };
  const uOk = typeof furnCurrent === 'function' && furnCurrent();
  if (uOk) {
    const r = FURN.res, B = furnBatch(r), L = furnPieces(r), mid = L.find(p => p.name === 'middle') || L[0], pl = mid.plane;
    const k = kOk && sOk ? STACK.res.runs.find(x => x.where === way).stack : null, q = sOk ? SHEET.res.q : null;
    S[6].cells = { h: cell(furnUm(B.h), `± ${(B.sd * 1e6).toFixed(1)}`), m: cell((r.end.mEnd * 1000).toFixed(0)), rho: cell((B.rho / 1000).toFixed(2)),
      size: pl && k && q ? cell(`${(q.Lx * 1000 * (1 + k.sizeOut[0]) * (1 + pl.size.free)).toFixed(1)} × ${(q.Ly * 1000 * (1 + (k.sizeOut[1] ?? k.sizeOut[0])) * (1 + pl.size.free)).toFixed(1)}`, `${(pl.size.free * 100).toFixed(2).replace('-', '−')} %, ${mid.name === 'middle' ? 'the middle piece' : 'the piece'}`) : null };
  } else S[6].cells = { h: busy };
  return S;
}

/** Ask for what is not solved yet (the same solves the stage pages ask for); the page is drawn again as they arrive. */
function lineRequest() {
  oneDRequest(true);
  if (typeof dryRequest === 'function') dryRequest();
  if (typeof filmRequest === 'function' && dryCurrent()) filmRequest();
  if (typeof sheetRequest === 'function' && filmCurrent()) sheetRequest();
  if (typeof stackRequest === 'function' && filmCurrent() && sheetCurrent()) stackRequest();
  if (typeof furnRequest === 'function' && filmCurrent() && sheetCurrent()) furnRequest();
  clearTimeout(lineRequest.t);
  // (drawn again while the line solves -- only what was asked for: Phase 0)
  const busy = SOLVE_LINE.some(solvePending);
  if (busy) lineRequest.t = setTimeout(() => { if (tab === 14) render(); }, 1200);
}

// ---- the flow diagram ----
/** The eight units' equipment, each in a 92 × 64 box, in one style: the equipment's body soft with an ink outline, the
 *  material in its colour (the slurry and the GO film brown, the fibre web beige, the graphene grey-black), heat red. */
const PFD_EQ = {
  // a stirred vessel: its motor, the shaft and the impeller, the slurry in it
  mix: `<rect class="pfd-metal" x="38" y="0" width="16" height="8" rx="1.5"/><path class="pfd-eq" d="M20,11H72V47Q72,59 60,59H32Q20,59 20,47Z"/>
    <path class="pfd-go" d="M21.5,30H70.5V47Q70.5,57.5 60,57.5H32Q21.5,57.5 21.5,47Z"/><line class="pfd-ln" x1="46" y1="8" x2="46" y2="49"/>
    <path class="pfd-ln pfd-fill" d="M34,49L46,45L58,49L46,53Z"/>`,
  // the blade over the web on its backing roll: the slurry pool before it, the wet film after it
  coat: `<circle class="pfd-eq" cx="46" cy="53" r="11"/><line class="pfd-web" x1="0" y1="41" x2="92" y2="41"/>
    <path class="pfd-go" d="M10,39.5Q20,22 38,24V39.5Z"/><rect class="pfd-go" x="48" y="37" width="44" height="2.6"/>
    <path class="pfd-metal pfd-edge" d="M38,2H48V33L43,36.5L38,33Z"/>`,
  // the tunnel oven: three zones, the heat, the web and its film through it
  dry: `<rect class="pfd-eq" x="2" y="6" width="88" height="46" rx="4"/><line class="pfd-div" x1="31.3" y1="6" x2="31.3" y2="52"/><line class="pfd-div" x1="60.7" y1="6" x2="60.7" y2="52"/>
    ${[16.6, 46, 75.4].map(x => `<path class="pfd-heat" d="M${x - 4},13q3,3 0,6t0,6M${x + 4},13q3,3 0,6t0,6"/>`).join('')}
    <line class="pfd-web" x1="-6" y1="44" x2="98" y2="44"/><rect class="pfd-go" x="-6" y="40.6" width="104" height="2.6"/>`,
  // the film lifted off the web to the winder: the roll on its core
  peel: `<line class="pfd-web" x1="0" y1="54" x2="92" y2="54"/><path class="pfd-go-ln" d="M0,51.5H30Q48,50 55,33"/>
    <circle class="pfd-eq" cx="66" cy="22" r="16"/><circle class="pfd-go" cx="66" cy="22" r="11.5"/><circle class="pfd-in" cx="66" cy="22" r="4"/>`,
  // the roll unwound, the knife, a piece cut
  cut: `<circle class="pfd-go" cx="15" cy="28" r="12"/><circle class="pfd-in" cx="15" cy="28" r="4"/><path class="pfd-go-ln" d="M15,40H44"/>
    <path class="pfd-metal pfd-edge" d="M44,10H52V33L48,39L44,33Z"/><path class="pfd-go pfd-edge" d="M60,34H90L83,52H53Z"/>`,
  // the pieces stacked under the aluminium plate, in the oven
  stack: `<rect class="pfd-eq" x="4" y="4" width="84" height="56" rx="4"/>
    <path class="pfd-heat" d="M13,18q3,3 0,6t0,6t0,6M79,18q3,3 0,6t0,6t0,6"/><rect class="pfd-metal pfd-edge" x="24" y="16" width="44" height="7" rx="1"/>
    ${[25, 29.5, 34, 38.5, 43].map(y => `<rect class="pfd-go" x="26" y="${y}" width="40" height="3"/>`).join('')}<rect class="pfd-metal pfd-edge" x="22" y="48" width="48" height="4" rx="1"/>`,
  // the furnace: its walls, the heaters, the holder's graphite plates with the stack between
  furn: `<rect class="pfd-wall" x="3" y="2" width="86" height="60" rx="5"/><rect class="pfd-in" x="13" y="11" width="66" height="42" rx="2"/>
    <path class="pfd-heat" d="M17,15l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3M17,49l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3l4,3l4,-3"/>
    <rect class="pfd-graphite" x="27" y="22" width="38" height="4" rx="1"/>${[27.5, 31, 34.5].map(y => `<rect class="pfd-go" x="29" y="${y}" width="34" height="2.4"/>`).join('')}<rect class="pfd-graphite" x="27" y="38.5" width="38" height="4" rx="1"/>`,
  // the product: graphene film sheets
  gfilm: `<path class="pfd-graphite pfd-edge" d="M20,46H60L76,28H36Z"/><path class="pfd-graphite pfd-edge" d="M14,53H54L70,35H30Z"/><path class="pfd-sheen" d="M36,40H62"/>`,
};
/** The state badge's mark. */
const PFD_MARK = { ok: 'M-3.6,0.2L-1.1,2.8L3.8,-2.6', warn: 'M0,-3.8V1M0,3.4V3.6', bad: 'M-3,-3L3,3M3,-3L-3,3', muted: 'M-3.2,0H3.2' };
const PFD_W = 150, PFD_X0 = 68;
/** The flow diagram: the units in a row, the streams between them, each unit's state (S: lineStages'). */
function linePFD(S) {
  const cx = i => PFD_X0 + i * PFD_W, top = 18;
  const units = S.map((s, i) => {
    const [stT, stC] = LINE_ST[s.st], x = cx(i) - 46;
    return `<g class="pfd-unit pfd-${stC}" data-line="${i}" role="button" tabindex="0" aria-label="${i + 1} ${s.t}: ${stT}. Open ${s.t}">
      <rect class="pfd-hit" x="${cx(i) - 66}" y="4" width="132" height="130" rx="10"/>
      <g transform="translate(${x},${top})">${PFD_EQ[s.k]}</g>
      <g class="pfd-badge" transform="translate(${cx(i) + 44},${top + 2})"><circle r="9"/><path d="${PFD_MARK[stC] || PFD_MARK.muted}"/></g>
      <text class="pfd-name" x="${cx(i)}" y="${top + 88}"><tspan class="pfd-n">${i + 1}</tspan> ${s.t}</text>
      <text class="pfd-st" x="${cx(i)}" y="${top + 106}">${stT}</text></g>`;
  }).join('');
  const streams = S.slice(0, -1).map((s, i) => {
    const a = cx(i) + 52, b = cx(i + 1) - 52, m = (a + b) / 2, y = top + 34;
    return `<g class="pfd-stream"><line x1="${a}" y1="${y}" x2="${m - 14}" y2="${y}"/><line x1="${m + 14}" y1="${y}" x2="${b}" y2="${y}" marker-end="url(#pfdArrow)"/>
      <rect x="${m - 13}" y="${y - 8}" width="26" height="16" rx="8"/><text x="${m}" y="${y + 3.6}">S${i + 1}</text></g>`;
  }).join('');
  const w = PFD_X0 * 2 + PFD_W * (S.length - 1);
  return `<svg class="pfd" viewBox="0 0 ${w} 140" role="group" aria-label="The process flow diagram: eight stages and the streams between them">
    <defs><marker id="pfdArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0.5L7.5,4L0,7.5Z"/></marker></defs>
    ${streams}${units}</svg>`;
}

/** Solve the line (Phase 0: nothing solves until asked): the 1D, the drying, the film, the piece, the stack and the
 *  furnace, each after what it needs; while it solves, what it is on. */
function lineSolveButton() {
  const on = SOLVE_LINE.find(solvePending), left = SOLVE_LINE.filter(k => solveState(k) !== 'solved');
  if (on) return `<span class="ln-solving">${pill(`Solving the line: ${SOLVE_M[on].l}…`, '')}</span>`;
  if (!left.length) return `<button type="button" class="btn btn-secondary btn-sm" disabled title="Every stage of the line is solved for the inputs as they are">${uiIco('play')}Line solved</button>`;
  return `<button type="button" class="btn btn-primary btn-sm" data-solve="line" title="Solve every stage of the line in order: ${left.map(k => SOLVE_M[k].l).join(', ')}">${uiIco('play')}Solve the line</button>`;
}

// ---- the page ----
function viewLine() {
  document.getElementById('setupExtra').innerHTML = '';
  lineRequest();
  const C = lineChecks(), S = lineStages(C), streams = lineStreams(), way = lineWay(), sel = lineSel();
  const icon = c => `<svg class="ln-mark ln-${c}" viewBox="-9 -9 18 18" aria-hidden="true"><circle r="9"/><path d="${PFD_MARK[c] || PFD_MARK.muted}"/></svg>`;
  // the page's head: what stands where
  // (worst first: defects and failures, risks, OK or solved, then the stages still solving or not solved, not modelled)
  const groups = [['bad', ['bad', 'fail'], 'defect', 'defects'], ['warn', ['warn'], 'risk', 'risks'], ['ok', ['ok', 'done'], 'OK', 'OK'], ['warn', ['stale'], 'out of date', 'out of date'], ['muted', ['busy'], 'solving', 'solving'], ['muted', ['todo'], 'not solved yet', 'not solved yet'], ['muted', ['none'], 'not modelled', 'not modelled']];
  const summary = groups.map(([c, sts, one, many]) => { const n = S.filter(s => sts.includes(s.st)).length; return n ? `<span class="ln-count">${icon(c)}<b>${n}</b> ${n === 1 ? one : many}</span>` : ''; }).join('');
  // the switches: the film and the way the water leaves (the stage pages' own)
  const films = [...CFD_LOCS.map((l, i) => [`L${i + 1}`, `<i class="loc-dot" style="background:${locColor(i)}"></i>L${i + 1}`]), ['web', 'The web']];
  const bar = `<div class="vp-bar pg-bar ln-bar" role="toolbar" aria-label="The line: which film">
    <span class="ln-ctl"><span class="ln-ctl-l">Film</span><span class="seg" role="tablist" aria-label="The film the stages follow" id="lnFilm">${films.map(([k, t]) => `<button type="button" role="tab" data-lnfilm="${k}" aria-selected="${k === sel}">${t}</button>`).join('')}</span></span>
    <span class="ln-ctl"><span class="ln-ctl-l">Water leaves</span><span class="seg" role="tablist" aria-label="Where the water leaves the film" id="lnWay">${Object.entries(LINE_WAYS).map(([k, t]) => `<button type="button" role="tab" data-lnway="${k}" aria-selected="${k === way}">${t}</button>`).join('')}</span></span>
    <span class="vp-spacer"></span>${lineSolveButton()}${aboutButton()}</div>`;
  // the streams: one column each
  const rowsDef = [['h', 'Thickness', 'µm'], ['x', 'Water', '% of the GO'], ['m', 'Solids per area', 'g/m²'], ['size', 'Size', 'mm'], ['flat', 'Corners up on a table', 'mm'], ['rho', 'Density', 'g/cm³']];
  const td = q => q ? `<td>${q.v}${q.sub ? `<small>${q.sub}</small>` : ''}</td>` : '<td class="ln-na">—</td>';
  const streamTable = `<div class="table-wrap"><table class="cfd-table ln-streams"><thead><tr><th scope="col">Property</th>${streams.map(s => `<th scope="col"><span class="ln-sid">${s.id}</span>${s.t}<small>${S.find(q => q.k === s.from).t} → ${S.find(q => q.k === s.to).t}</small></th>`).join('')}</tr></thead>
    <tbody>${rowsDef.map(([k, l, u]) => `<tr><th scope="row">${l}<small>${u}</small></th>${streams.map(s => td(s.cells[k])).join('')}</tr>`).join('')}</tbody></table></div>`;
  // the checks: every stage's, grouped by stage
  const util = (v, lv) => v == null ? '<td class="ln-c-util ln-na">—</td>' : `<td class="ln-c-util ln-util ln-${lv || 'na'}"><span class="ln-track"><span class="ln-fill" style="width:${Math.min(100, v / 1.5 * 100).toFixed(1)}%"></span><span class="ln-lim"></span></span><span class="ln-pct">${(v * 100).toFixed(0)} %</span></td>`;
  const stat = lv => lv ? `<td class="ln-c-stat ln-stat ln-${lv}">${icon(lv)}${LINE_ST[lv][0]}</td>` : '<td class="ln-c-stat ln-stat ln-na">not judged</td>';
  const checkRows = S.map((s, i) => {
    const L = s.checks;
    const head = n => `<th scope="rowgroup" rowspan="${n}" class="ln-stage"><button type="button" class="linkish" data-lngo="${i}"><span class="pfd-n">${i + 1}</span> ${s.t}</button></th>`;
    if (!L) return s.k === 'gfilm' ? '' : `<tr class="ln-first">${head(1)}<td colspan="5" class="ln-c-check ln-na">${s.st === 'none' ? 'Not modelled yet' : LINE_ST[s.st][0]}</td></tr>`;
    return L.map((q, j) => `<tr${j ? '' : ' class="ln-first"'}>${j ? '' : head(L.length)}<td class="ln-c-check">${q.t}</td><td class="ln-c-res">${q.res}</td><td class="ln-c-lim${q.lim === '—' ? ' ln-nolim' : ''}"><span class="ln-lim-l">limit </span>${q.lim}</td>${util(q.v, q.lv)}${stat(q.lv)}</tr>`).join('');
  }).join('');
  const checkTable = `<div class="table-wrap"><table class="cfd-table ln-checks"><thead><tr><th scope="col">Stage</th><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Limit</th><th scope="col">Of its limit</th><th scope="col">Status</th></tr></thead><tbody>${checkRows}</tbody></table></div>`;
  view.innerHTML = `<div class="sum-page ln-page">${bar}
    <div class="sum-body">
      <div class="ln-head"><h1>Line</h1><div class="ln-counts" aria-label="Where the stages stand">${summary}</div></div>
      <section class="ln-card" aria-labelledby="lnPfdH"><header><h2 id="lnPfdH">Flow diagram</h2><span class="ln-h-note">${dryFilmName(sel).replace(/^the /, 'The ')} · water leaves ${LINE_WAYS[way].toLowerCase()}</span></header>
        <div class="pfd-wrap">${linePFD(S)}</div></section>
      <section class="ln-card" aria-labelledby="lnStrH"><header><h2 id="lnStrH">Streams</h2></header>${streamTable}</section>
      <section class="ln-card" aria-labelledby="lnChkH"><header><h2 id="lnChkH">Checks</h2></header>${checkTable}</section>
    </div></div>`;
  const open = i => S[i].go();
  view.querySelectorAll('.pfd-unit').forEach(g => {
    g.addEventListener('click', () => open(+g.dataset.line));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(+g.dataset.line); } });
  });
  view.querySelectorAll('[data-lngo]').forEach(b => { b.onclick = () => open(+b.dataset.lngo); });
  view.querySelectorAll('[data-lnfilm]').forEach(b => { b.onclick = () => { DRY.sel = b.dataset.lnfilm; render(); }; });
  view.querySelectorAll('[data-lnway]').forEach(b => { b.onclick = () => { SHEET.way = b.dataset.lnway; render(); }; });
}
