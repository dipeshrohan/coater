/*
 * materials.js — the materials and the process chain (GO-0): the slurry's card (its GO solids, their density and
 * size, the liquid, the dry film's packing), the slurry density that follows from it, the oven's zones, and the mass
 * balance from the wet film under the blade to the dry film peeled off the fibre web.
 *
 * The line (the user's): the slurry is coated onto the PET fibre web, dried in the oven by the air blown up through the
 * web, then peeled off as a free-standing GO film. The fibre web is the carrier; its card is the 2D setup's Fibre.
 *
 * Every value on a card carries its unit, a source and a flag: 'given' (from the user), 'assumed' or 'measured'.
 * Loaded after physics.js (the slurry density, slurryRho, replaces its fixed one) and before cfd-ui.js.
 */

/** The slurry card's values: [key, label, unit, min, max, step, decimals, default, flag, source]. */
const MAT_SLURRY = [
  ['phi', 'Solids', 'vol%', 1, 74, 0.5, 1, 40, 'given', 'you: over 40 vol% solids (the exact fraction not given)'],
  ['rhoS', 'Solids density (GO)', 'g/cm³', 1, 3, 0.05, 2, 1.9, 'assumed', 'you: GO particles; GO 1.8–2.2 g/cm³ reported'],
  ['rhoL', 'Liquid density (water)', 'kg/m³', 900, 1100, 1, 0, 1000, 'assumed', 'water-based (you)'],
  ['dMean', 'Particle size, mean', 'µm', 0.1, 100, 0.1, 1, 5, 'given', 'you: 2–8 µm particles (the mean not given)'],
  ['dMin', 'Particle size, smallest', 'µm', 0.1, 100, 0.1, 1, 2, 'given', 'you: 2–8 µm'],
  ['dMax', 'Particle size, largest', 'µm', 0.1, 100, 0.1, 1, 8, 'given', 'you: 2–8 µm'],
  ['tFlake', 'Flake thickness', 'nm', 0.5, 1000, 0.5, 1, 1, 'assumed', 'a single GO sheet is about 1 nm'],
  ['co', 'C/O ratio', '', 1, 20, 0.1, 1, 2, 'assumed', 'typical for GO (about 2)'],
  ['phiDry', 'Dry film packing', 'fraction', 0.3, 1, 0.01, 2, 0.85, 'assumed', 'solids fraction of the dry film (stacked flakes)'],
];
/**
 * How the slurry flows beyond the sidebar's inputs (GO-1), the same shape: the Carreau–Yasuda and Cross laws'
 * extras ('law') and the structure (thixotropy) model's values ('struct'; rheo.js). All assumed until fitted.
 */
const MAT_RHEO = [
  ['etaInf', 'Viscosity at high shear, η∞', 'Pa·s', 0, 5, 0.001, 3, 0.01, 'assumed', 'Carreau–Yasuda and Cross; at most half the viscosity at 2.7 1/s', 'law'],
  ['lamT', 'Time constant λ', 's', 0.001, 1000, 0.01, 3, 1, 'assumed', 'Carreau–Yasuda and Cross: 1 / the shear rate where the slurry starts to thin', 'law'],
  ['aCY', 'Transition sharpness a', '', 0.2, 5, 0.1, 1, 2, 'assumed', 'Carreau–Yasuda (2: the Carreau law)', 'law'],
  ['tb', 'Rebuild time at rest', 's', 0.1, 100000, 1, 1, 30, 'assumed', 'tens of seconds, typical of GO dispersions in published thixotropy tests', 'struct'],
  ['gdc', 'Shear rate that halves the structure', '1/s', 0.0001, 10000, 0.1, 3, 1, 'assumed', 'steady at this shear rate, half the structure is broken', 'struct'],
  ['cy', 'Yield stress gain when rested, c_y', '', 0, 50, 0.1, 2, 2, 'assumed', 'rested, the yield stress is (1 + c_y)× the fully broken one', 'struct'],
  ['ce', 'Viscosity gain when rested, c_η', '', 0, 50, 0.1, 2, 2, 'assumed', 'rested, the viscosity is (1 + c_η)× the fully broken one', 'struct'],
];
/**
 * The flakes' alignment (GO-2; orient.js, cfd-orient.js), the same shape: the liquid crystal's (Doi–Hess, 'dh') and
 * the suspension's (Folgar–Tucker, 'ft') values; the flakes' shape comes from the slurry card (size and thickness).
 * 'num': how finely it is computed (streamlines through the film, flakes on each).
 */
const MAT_ORIENT = [
  ['U', 'Ordering strength U', '', 0, 50, 0.1, 1, 8, 'assumed', 'above about 4.5 the flakes line up with each other (a liquid crystal); 8: at rest they order to S 0.84', 'dh'],
  ['Dr', 'Rotary diffusion D_r', '1/s', 0, 100, 0.001, 3, 0.025, 'assumed', 'a 5 µm flake turning in water by Brownian motion; slower when crowded', 'dh'],
  ['Ci', 'Interaction coefficient C_i', '', 0, 1, 0.001, 3, 0.01, 'assumed', 'the flow knocks flakes about at C_i × the shear rate; fibre and platelet suspensions 0.001–0.03', 'ft'],
  ['nLines', 'Streamlines through the film', '', 4, 96, 1, 0, 24, 'given', 'each carries an equal share of the flow', 'num'],
  ['nFlakes', 'Flakes on each streamline', '', 100, 16000, 100, 0, 1000, 'given', '1000: the film within 0.02 of 4000 (cfd-orient.validate.js)', 'num'],
];
/**
 * The drying (GO-3; drying.js), the same shape: how the flakes move against the water, the skin, heat, the water the
 * dry GO keeps (its sorption isotherm, GAB), the room between the blade and the oven. All assumed until measured.
 */
const MAT_DRY = [
  ['mul', 'Flakes\' collective diffusion, × the hard-sphere law', '', 0.001, 1e6, 0.1, 3, 1, 'assumed', 'Routh–Russel for hard spheres (Carnahan–Starling) with a thin disc\'s Brownian diffusion; flakes in a gel may move together faster: raise it'],
  ['skinK', 'Water vapour through the skin', '×10⁻¹² kg/(m·s·Pa)', 0.001, 1e6, 0.1, 3, 1, 'assumed', 'GO laminates pass water vapour at about 10⁻⁵ mm·g/(cm²·s·bar) (Nair et al., Science 2012)'],
  ['kS', 'GO\'s heat conductivity through the film', 'W/(m·K)', 0.01, 10, 0.01, 2, 0.2, 'assumed', 'GO paper through its thickness: 0.1–0.3 reported'],
  ['cS', 'GO\'s specific heat', 'J/(kg·K)', 100, 3000, 10, 0, 850, 'assumed', 'graphite 710; GO with its oxygen groups higher'],
  ['emis', 'Film emissivity', '', 0.01, 1, 0.01, 2, 0.95, 'assumed', 'water and GO: nearly black in the infrared; the oven\'s walls radiate at its air\'s temperature'],
  ['irAbs', 'IR absorbed by the film', 'fraction', 0, 1, 0.01, 2, 0.9, 'assumed', 'of the IR heaters\' power reaching the film'],
  ['gabXm', 'Water the dry GO keeps: GAB X_m', 'kg/kg', 0.001, 1, 0.005, 3, 0.07, 'assumed', 'its sorption isotherm; these give about 5 % water at 20 % humidity, 10 % at 50 %, 24 % at 90 % (typical of GO films)'],
  ['gabC', 'Water the dry GO keeps: GAB C', '', 0.1, 1000, 0.5, 1, 8, 'assumed', 'the same isotherm'],
  ['gabK', 'Water the dry GO keeps: GAB K', '', 0.1, 0.99, 0.01, 2, 0.8, 'assumed', 'the same isotherm'],
  ['cpWeb', 'Fibre web\'s specific heat', 'J/(kg·K)', 500, 3000, 10, 0, 1300, 'assumed', 'PET'],
  ['Troom', 'Room temperature', '°C', 0, 60, 1, 0, 25, 'assumed', 'between the blade and the oven: the film enters the oven at it'],
  ['rhRoom', 'Room humidity', '%', 0, 100, 1, 0, 50, 'assumed', 'between the blade and the oven'],
];
const MAT_FLAGS = [['given', 'From you'], ['assumed', 'Assumed'], ['measured', 'Measured']];
const matCard = rows => Object.fromEntries(rows.map(([k, , , , , , , v, flag, src]) => [k, { v, flag, src }]));
// (rheo.side: the sidebar's slurry inputs a rheometer fit set, { k: { v, src } }: Measured while the input keeps that value;
// tests: the rheometer tests imported, rheo-ui.js)
// (orient: the flakes' alignment card, on or off, its model 'dh' (Doi–Hess, the default: Q49) or 'ft' (Folgar–Tucker);
// sem: the measured alignment -- SEM images and tables of flake angles, orient-ui.js;
// dry: the drying card; dryMeas: the drying measured -- temperatures in the oven and values at its exit, drying-ui.js)
const matDefaults = () => ({ slurry: matCard(MAT_SLURRY), rheo: { ...matCard(MAT_RHEO), structOn: true, side: {} }, tests: [],
  orient: { ...matCard(MAT_ORIENT), on: true, model: 'dh' }, sem: { images: [], tables: [] }, dry: matCard(MAT_DRY), dryMeas: { temps: [], exit: [] } });
let MAT = matDefaults();
/** A slurry card value (its number). */
const matV = k => MAT.slurry[k].v;
/** A rheology value (its number). */
const matR = k => MAT.rheo[k].v;
/** The structure model's values for rheo.js, or null when it is off. */
const matStruct = (m = MAT) => m.rheo.structOn ? { tb: m.rheo.tb.v, gdc: m.rheo.gdc.v, cy: m.rheo.cy.v, ce: m.rheo.ce.v } : null;

/** The flakes' thickness / width (the slurry card's thickness over its mean size). */
const matFlakeRatio = (m = MAT) => m.slurry.tFlake.v * 1e-9 / (m.slurry.dMean.v * 1e-6);
/**
 * The alignment's model for the 2D (cfd-orient.js), or null when it is off: { model: orient.js's model (kind, the
 * shape factor β = (r² − 1) / (r² + 1) of r = thickness / width, and its values), nLines, n, seed }.
 */
function matOrient(m = MAT) {
  const o = m.orient;
  if (!o || !o.on) return null;
  const r = matFlakeRatio(m), beta = (r * r - 1) / (r * r + 1);
  const model = o.model === 'ft' ? { kind: 'ft', beta, Ci: o.Ci.v } : { kind: 'dh', beta, Dr: o.Dr.v, U: o.U.v };
  // (collapse: the dried film over the wet one, φ0 / φ_m -- the flakes flattened as it dries, GO-3; none if the packing
  // is below the solids)
  const col = m.slurry.phi.v / 100 / m.slurry.phiDry.v;
  return { model, nLines: Math.round(o.nLines.v), n: Math.round(o.nFlakes.v), seed: 1, ...(col < 1 ? { collapse: +col.toFixed(6) } : {}) };
}

/** The slurry's density (kg/m³) from its solids: phi rho_solids + (1 - phi) rho_liquid. */
function slurryRho(m = MAT) {
  const f = m.slurry.phi.v / 100;
  return f * m.slurry.rhoS.v * 1000 + (1 - f) * m.slurry.rhoL.v;
}
/** The solids' mass fraction (0..1). */
const slurrySolidsMass = (m = MAT) => m.slurry.phi.v / 100 * m.slurry.rhoS.v * 1000 / slurryRho(m);

/**
 * The mass balance of a wet film h (m) on the web: what is left when its water is gone (the solids packed at the dry
 * film's packing) and what must leave. At the line speed U (m/s) over a width W (m): the water per second.
 * Returns { dry (m), coatDry, coatWet (g/m²), water (kg/m²), waterRate (kg/s), rhoDry (kg/m³) }.
 */
function massBalance(h, U, W, m = MAT) {
  const f = m.slurry.phi.v / 100, rS = m.slurry.rhoS.v * 1000, rL = m.slurry.rhoL.v, pd = m.slurry.phiDry.v;
  const water = h * (1 - f) * rL;
  return { dry: h * f / pd, coatDry: h * f * rS * 1000, coatWet: h * slurryRho(m) * 1000, water, waterRate: water * U * W, rhoDry: pd * rS };
}

// ---- the oven: zones in a row along the line, each with its own drying air ----
// (today's single setting -- air blown up through the fibre, 1 m/s, 100 C, over a 100 mm plenum -- is zone 1's; the
// other zones start as it; lengths along the line and the air's humidity are assumed)
const OVEN_ZONE_FIELDS = [['len', 'Length', 'm', 0.1, 100, 0.1, 1], ['airU', 'Air speed up into the fibre', 'm/s', 0, 50, 0.1, 1], ['airT', 'Air temperature', '°C', 0, 400, 5, 0],
  ['plenum', 'Plenum length', 'mm', 1, 5000, 10, 0], ['rh', 'Air humidity', '%', 0, 100, 1, 0]];
// what is above the film in each zone (Q52: every option): nothing blown (the oven's still air), hot air blown on the
// top through slot nozzles, IR heaters, or air and IR; the jets' and the IR's values (assumed)
const OVEN_TOPS = { none: 'Nothing blown (the oven\'s still air)', air: 'Hot air blown on top (slot nozzles)', ir: 'IR heaters', 'air+ir': 'Hot air on top and IR' };
const OVEN_TOP_FIELDS = [['jetU', 'Jet speed at the nozzles', 'm/s', 0.5, 150, 0.5, 1, 'air'], ['jetT', 'Jet air temperature', '°C', 0, 400, 5, 0, 'air'],
  ['jetB', 'Slot width', 'mm', 0.5, 50, 0.5, 1, 'air'], ['jetH', 'Nozzles above the film', 'mm', 1, 500, 1, 0, 'air'], ['jetS', 'Slot pitch along the line', 'mm', 5, 1000, 5, 0, 'air'],
  ['ir', 'IR power reaching the film', 'kW/m²', 0, 200, 0.5, 1, 'ir']];
const OVEN_ZONE_DEFAULT = { len: 2, airU: 1, airT: 100, plenum: 100, rh: 20, top: 'none', jetU: 10, jetT: 100, jetB: 5, jetH: 20, jetS: 100, ir: 5 };
const ovenDefaults = () => ({ zones: [0, 1, 2].map(() => ({ ...OVEN_ZONE_DEFAULT })) });
let OVEN = ovenDefaults();
const OVEN_MAX_ZONES = 8;
/** The oven's length (m) and the time the film spends in it at the line speed U (m/s). */
function ovenTime(U, oven = OVEN) {
  const len = oven.zones.reduce((a, z) => a + z.len, 0);
  return { len, t: U > 0 ? len / U : Infinity };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MAT_DRY, OVEN_TOPS, OVEN_TOP_FIELDS, MAT_SLURRY, MAT_RHEO, MAT_ORIENT, MAT_FLAGS, matDefaults, matStruct, matOrient, matFlakeRatio, slurryRho, slurrySolidsMass, massBalance, OVEN_ZONE_FIELDS, OVEN_ZONE_DEFAULT, ovenDefaults, ovenTime };
